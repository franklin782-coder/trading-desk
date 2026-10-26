#!/usr/bin/env python3
"""Mark-to-market for the GROK book (run by GitHub Actions every 10 min). No AI, no secrets.
Closes positions whose stop/target was touched by 1m candle high/low since max(opened_at, last_mark);
if both are touched in the same candle the STOP is assumed first. Exits fill at the stop/target level
(stop gets adverse slippage). Records an equity point hourly or when something changed.
Exit code 0 always unless API fails; prints CHANGED if book was written."""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book as B, hl


def scan(p, cs):
    """Return (kind, price, candle_ts) of first stop/target hit or None."""
    long = p["side"] == "long"
    for c in cs:
        hit_stop = c["l"] <= p["stop"] if long else c["h"] >= p["stop"]
        hit_tgt = c["h"] >= p["target"] if long else c["l"] <= p["target"]
        if hit_stop:
            return "stop", p["stop"], c["T"] / 1000
        if hit_tgt:
            return "target", p["target"], c["T"] / 1000
    return None


def run(now=None, mids_fn=hl.mids, candles_fn=hl.candles):
    now = now or time.time()
    book = B.load()
    changed = False
    last_mark = B.parse_iso(book["last_mark"]) if book.get("last_mark") else 0
    for p in list(book["open"]):
        start = max(B.parse_iso(p["opened_at"]), last_mark - 120)
        cs = [c for c in candles_fn(p["coin"], "1m", start * 1000, now * 1000) if c["T"] / 1000 >= B.parse_iso(p["opened_at"])]
        hit = scan(p, cs)
        if hit:
            kind, px, ts = hit
            R = book.get("rules", B.RULES)
            d = 1 if p["side"] == "long" else -1
            fill = px * (1 - d * R["slippage"]) if kind == "stop" else px
            cl = B.close_position(book, p["ticket"], fill, "auto: %s hit" % kind, "", ts=min(ts, now), fill_exact=True)
            B.journal("close", **cl)
            print("CLOSED", cl["ticket"], kind, cl["pnl"])
            changed = True
    for s in book["shadow"]:
        if s["status"] != "open":
            continue
        start = max(B.parse_iso(s["opened_at"]), last_mark - 120)
        cs = [c for c in candles_fn(s["coin"], "1m", start * 1000, now * 1000) if c["T"] / 1000 >= B.parse_iso(s["opened_at"])]
        hit = scan(s, cs)
        if hit:
            B.resolve_shadow(s, hit[0], hit[1], min(hit[2], now), book.get("rules", B.RULES))
            B.journal("shadow-close", **s)
            print("SHADOW", s["id"], hit[0], s["pnl"])
            changed = True
    mids = mids_fn() if book["open"] else {}
    eq = B.equity(book, mids)
    last_pt = B.parse_iso(book["equity"][-1]["t"]) if book["equity"] else 0
    if changed or (book["open"] and now - last_pt >= 600) or now - last_pt >= 3600:
        B.add_point(book, eq, now)
        changed = True
    if changed:
        book["last_mark"] = B.now_iso(now)
        book["marked_eq"] = round(eq, 2)
        B.roll_day(book, eq, now)
        B.save(book)
        print("CHANGED eq=%.2f" % eq)
    return changed


if __name__ == "__main__":
    run()
