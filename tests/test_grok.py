"""python3 -m unittest discover -s tests -p 'test_grok*.py'"""
import os, sys, json, tempfile, unittest, io, contextlib
TMP = tempfile.mkdtemp()
os.environ["GROK_BOOK"] = os.path.join(TMP, "book.json")
os.environ["GROK_JOURNAL"] = os.path.join(TMP, "journal.jsonl")
os.environ["GROK_SKEPTIC_LOG"] = os.path.join(TMP, "skeptic.jsonl")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grok"))
import book as B, trade, mark, skeptic

T0 = B.parse_iso("2026-10-27T12:00:00Z")
YES = lambda p, b: {"verdict": "YES", "reasons": ["ok"], "biggest_risk": "x", "model": "m", "error": None}
NO = lambda p, b: {"verdict": "NO", "reasons": ["bad"], "biggest_risk": "y", "model": "m", "error": None}


class Risk(unittest.TestCase):
    def setUp(self):
        self.b = B.new_book()

    def op(self, coin="BTC", side="long", stop=95, target=120, mid=100, **kw):
        return B.open_position(self.b, coin, side, stop, target, "test thesis long enough", mid, ts=kw.pop("ts", T0), **kw)

    def test_default_2pct_risk_and_fees(self):
        p = self.op()
        self.assertAlmostEqual(p["risk_usd"], 20, places=1)
        self.assertAlmostEqual(p["entry"], 100.05)
        self.assertLess(self.b["cash"], 1000)
        self.assertEqual(p["ticket"], "GK-20261027-01")

    def test_hard_max_risk(self):
        with self.assertRaises(B.RiskError):
            self.op(risk_pct=3.5)
        self.assertAlmostEqual(self.op(risk_pct=3)["risk_usd"], 30, places=1)

    def test_leverage_cap(self):
        p = self.op(stop=99.7, target=101)
        self.assertLessEqual(p["leverage"], 5.0)
        self.assertIn("capped", p["note"])

    def test_wrong_side_stop_target(self):
        with self.assertRaises(B.RiskError): self.op(stop=105)
        with self.assertRaises(B.RiskError): self.op(side="short", stop=95, target=90)
        with self.assertRaises(B.RiskError): self.op(target=99)

    def test_max_open_and_dupes(self):
        self.op("A"); self.op("B")
        with self.assertRaises(B.RiskError): self.op("A")
        self.op("C", risk_pct=1)
        with self.assertRaises(B.RiskError): self.op("D", risk_pct=1)

    def test_total_open_risk_cap(self):
        self.op("A", risk_pct=3); self.op("B", risk_pct=3)
        with self.assertRaises(B.RiskError): self.op("C", risk_pct=3)

    def test_daily_loss_stop(self):
        self.b["day"] = {"date": "2026-10-27", "start_equity": 1000}
        self.b["cash"] = 939
        with self.assertRaises(B.RiskError) as e: self.op()
        self.assertIn("DAILY", str(e.exception))

    def test_loss_streak_pause(self):
        for i in range(3):
            p = self.op("C%d" % i, ts=T0 + i, risk_pct=1)
            B.close_position(self.b, p["ticket"], 95, "stop", ts=T0 + 100 + i)
        with self.assertRaises(B.RiskError) as e: self.op("X", ts=T0 + 3600)
        self.assertIn("STREAK", str(e.exception))
        self.op("X", ts=T0 + 7 * 3600)  # pause over

    def test_close_R_and_move_stop(self):
        p = self.op()
        with self.assertRaises(B.RiskError): B.move_stop(self.b, p["ticket"], 90)
        B.move_stop(self.b, p["ticket"], 98)
        c = B.close_position(self.b, p["ticket"], 120, "tp", "lesson", ts=T0 + 60, fill_exact=True)
        self.assertGreater(c["R"], 3.5)
        self.assertGreater(self.b["cash"], 1000)

    def test_short_stop_moves_down_only(self):
        p = self.op(side="short", stop=105, target=90)
        with self.assertRaises(B.RiskError): B.move_stop(self.b, p["ticket"], 106)
        B.move_stop(self.b, p["ticket"], 103)


class CLI(unittest.TestCase):
    def setUp(self):
        for f in (os.environ["GROK_BOOK"], os.environ["GROK_JOURNAL"]):
            if os.path.exists(f): os.remove(f)
        B.save(B.new_book())

    def run_cli(self, args, sk=YES):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = trade.main(args, mids_fn=lambda: {"BTC": 100.0}, skeptic_fn=sk, log_fn=lambda r: skeptic.log(r))
        return rc, out.getvalue()

    def test_open_yes_then_close(self):
        rc, o = self.run_cli(["open", "--coin", "btc", "--side", "long", "--stop", "95", "--target", "115", "--thesis", "breakout retest hold"])
        self.assertEqual(rc, 0, o)
        b = B.load(); t = b["open"][0]["ticket"]
        self.assertEqual(b["open"][0]["skeptic"]["verdict"], "YES")
        rc, o = self.run_cli(["close", "--ticket", t, "--reason", "manual", "--lesson", "be patient"])
        self.assertEqual(rc, 0, o)
        self.assertEqual(B.load()["closed"][0]["lesson"], "be patient")

    def test_skeptic_no_blocks_and_shadows(self):
        rc, o = self.run_cli(["open", "--coin", "BTC", "--side", "long", "--stop", "95", "--target", "115", "--thesis", "weak thesis here"], sk=NO)
        self.assertEqual(rc, 3)
        b = B.load()
        self.assertEqual(b["open"], []); self.assertEqual(b["cash"], 1000)
        self.assertEqual(b["shadow"][0]["status"], "open")

    def test_risk_reject_skips_skeptic(self):
        called = []
        rc, o = self.run_cli(["open", "--coin", "BTC", "--side", "long", "--stop", "95", "--target", "115", "--thesis", "too much risk", "--risk", "5"],
                             sk=lambda p, b: called.append(1) or YES(p, b))
        self.assertEqual(rc, 2); self.assertEqual(called, [])

    def test_api_failure_defaults_no(self):
        old = os.environ.pop("OPENROUTER_API_KEY", None)
        try:
            r = skeptic.review({}, "", [])
        finally:
            if old: os.environ["OPENROUTER_API_KEY"] = old
        self.assertEqual(r["verdict"], "NO")
        os.environ["OPENROUTER_API_KEY"] = "k"
        def boom(*a): raise RuntimeError("http 429")
        self.assertEqual(skeptic.review({}, "", [], call=boom)["verdict"], "NO")
        self.assertEqual(skeptic.review({}, "", [], call=lambda *a: 'ok {"verdict":"YES","reasons":[],"biggest_risk":"z"}')["verdict"], "YES")
        if old: os.environ["OPENROUTER_API_KEY"] = old
        else: os.environ.pop("OPENROUTER_API_KEY")

    def test_mark_stop_first_and_shadow(self):
        b = B.load()
        p = B.open_position(b, "BTC", "long", 95, 110, "thesis for mark test", 100, ts=T0)
        s = B.shadow_from(B.open_position(B.new_book(), "ETH", "short", 105, 90, "shadow thesis here", 100, ts=T0), NO(0, 0), ts=T0)
        b["shadow"].append(s); B.save(b)
        def candles(coin, iv, a, z):
            if coin == "BTC": return [{"t": T0 * 1000 + 60000, "T": T0 * 1000 + 119999, "o": 100, "h": 111, "l": 94, "c": 100}]
            return [{"t": T0 * 1000 + 60000, "T": T0 * 1000 + 119999, "o": 100, "h": 101, "l": 89, "c": 90}]
        with contextlib.redirect_stdout(io.StringIO()):
            mark.run(now=T0 + 600, mids_fn=lambda: {}, candles_fn=candles)
        b = B.load()
        self.assertEqual(b["closed"][0]["reason"], "auto: stop hit")
        self.assertLess(b["closed"][0]["R"], -0.9)
        self.assertEqual(b["shadow"][0]["outcome"], "target")
        st = B.skeptic_stats(b)
        self.assertEqual(st["rejected_resolved"], 1); self.assertEqual(st["rejected_right"], 0)


if __name__ == "__main__":
    unittest.main()
