#!/usr/bin/env python3
"""GROK paper-trading CLI. Risk rules are enforced in book.py; violations exit 2 with a clear message.
  python3 grok/trade.py open --coin SOL --side long --stop 180 --target 200 --thesis "..." [--risk 2]
  python3 grok/trade.py close --ticket GK-20261026-01 --reason "..." --lesson "..."
  python3 grok/trade.py move-stop --ticket GK-20261026-01 --stop 185
  python3 grok/trade.py lesson --ticket GK-20261026-01 --lesson "..."   (add/replace lesson on a closed trade)
  python3 grok/trade.py status
"""
import argparse, json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book as B


def get_mids():
    import hl
    return hl.mids()


def default_skeptic(proposal, book):
    import skeptic, snapshot
    try:
        snap = snapshot.build()
    except Exception as e:
        snap = "(snapshot failed: %s)" % e
    lessons = [c["lesson"] for c in book["closed"] if c.get("lesson")][-10:]
    return skeptic.review(proposal, snap, lessons)


def log_review(rec):
    import skeptic
    skeptic.log(rec)


def main(argv=None, mids_fn=get_mids, skeptic_fn=default_skeptic, log_fn=log_review):
    ap = argparse.ArgumentParser(prog="trade.py")
    sp = ap.add_subparsers(dest="cmd", required=True)
    o = sp.add_parser("open"); o.add_argument("--coin", required=True); o.add_argument("--side", required=True, choices=["long", "short"])
    o.add_argument("--stop", type=float, required=True); o.add_argument("--target", type=float, required=True)
    o.add_argument("--thesis", required=True); o.add_argument("--risk", type=float, default=None, help="%% of equity (default 2, max 3)")
    c = sp.add_parser("close"); c.add_argument("--ticket", required=True); c.add_argument("--reason", required=True); c.add_argument("--lesson", default="")
    m = sp.add_parser("move-stop"); m.add_argument("--ticket", required=True); m.add_argument("--stop", type=float, required=True)
    l = sp.add_parser("lesson"); l.add_argument("--ticket", required=True); l.add_argument("--lesson", required=True)
    sp.add_parser("status")
    a = ap.parse_args(argv)
    book = B.load()
    try:
        if a.cmd == "open":
            import copy
            mids = mids_fn()
            trial = copy.deepcopy(book)   # validate all hard risk rules BEFORE spending a skeptic call
            p = B.open_position(trial, a.coin, a.side, a.stop, a.target, a.thesis, mids.get(a.coin.upper(), 0), a.risk, prices=mids)
            prop = {k: p[k] for k in ("ticket", "coin", "side", "entry", "stop", "target", "size", "notional", "leverage", "risk_usd", "risk_pct", "thesis")}
            prop["rr"] = round(abs(p["target"] - p["entry"]) / abs(p["entry"] - p["stop"]), 2)
            rv = skeptic_fn(prop, book)
            log_fn({"t": B.now_iso(), "ticket": p["ticket"], "proposal": prop, **rv})
            if rv["verdict"] != "YES":
                sh = B.shadow_from(p, rv)
                book["shadow"].append(sh)
                B.save(book); B.journal("skeptic-reject", **sh)
                print("SKEPTIC SAID NO -> not opened; tracked as shadow %s. biggest risk: %s" % (sh["id"], rv.get("biggest_risk")))
                for r in rv.get("reasons", []):
                    print("  - " + r)
                if rv.get("error"):
                    print("  (skeptic error: %s)" % rv["error"][:300])
                return 3
            p["skeptic"] = {"verdict": "YES", "biggest_risk": rv.get("biggest_risk", ""), "model": rv.get("model")}
            book = trial
            B.save(book); B.journal("open", **p)
            print("SKEPTIC YES (%s) biggest risk: %s" % (rv.get("model"), rv.get("biggest_risk")))
            print("OPENED %s %s %s size=%g entry=%g stop=%g target=%g notional=$%.2f lev=%.2fx risk=$%.2f (%.2f%%) %s" % (
                p["ticket"], p["side"].upper(), p["coin"], p["size"], p["entry"], p["stop"], p["target"], p["notional"], p["leverage"], p["risk_usd"], p["risk_pct"], p["note"]))
        elif a.cmd == "close":
            p = next((x for x in book["open"] if x["ticket"] == a.ticket), None)
            if not p:
                raise B.RiskError("no open ticket %s" % a.ticket)
            mids = mids_fn()
            cl = B.close_position(book, a.ticket, mids[p["coin"]], a.reason, a.lesson)
            B.add_point(book, B.equity(book, mids))
            B.save(book); B.journal("close", **cl)
            print("CLOSED %s %s exit=%g pnl=$%.2f R=%.2f fees=$%.2f cash=$%.2f" % (cl["ticket"], cl["coin"], cl["exit"], cl["pnl"], cl["R"], cl["fees"], book["cash"]))
        elif a.cmd == "move-stop":
            old = B.move_stop(book, a.ticket, a.stop)
            B.save(book); B.journal("move-stop", ticket=a.ticket, old=old, new=a.stop)
            print("STOP %s %g -> %g" % (a.ticket, old, a.stop))
        elif a.cmd == "lesson":
            cl = next((x for x in book["closed"] if x["ticket"] == a.ticket), None)
            if not cl:
                raise B.RiskError("no closed ticket %s" % a.ticket)
            cl["lesson"] = a.lesson
            B.save(book); B.journal("lesson", ticket=a.ticket, lesson=a.lesson)
            print("LESSON saved for %s" % a.ticket)
        else:
            mids = mids_fn() if book["open"] else {}
            eq = B.equity(book, mids)
            print("skeptic:", json.dumps(B.skeptic_stats(book)))
            print("equity $%.2f cash $%.2f progress %.1f%% of 5x" % (eq, book["cash"], (eq - book["start_equity"]) / (book["goal_equity"] - book["start_equity"]) * 100))
            for p in book["open"]:
                px = mids.get(p["coin"], p["entry"])
                print(" %s %s %s entry %g now %g stop %g tgt %g uPnL $%.2f" % (p["ticket"], p["side"], p["coin"], p["entry"], px, p["stop"], p["target"], B.upnl(p, px)))
            try:
                B.check_breakers(book, eq); print("breakers: OK")
            except B.RiskError as e:
                print("breakers: " + str(e))
    except B.RiskError as e:
        print("REJECTED: " + str(e), file=sys.stderr)
        if a.cmd == "open":
            B.journal("reject", coin=a.coin.upper(), side=a.side, msg=str(e))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
