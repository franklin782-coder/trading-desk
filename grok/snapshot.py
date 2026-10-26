#!/usr/bin/env python3
"""Compact market + book snapshot for GROK decisions (target < 4 KB). Stdlib only.
OIΔ is vs the previous snapshot run (cached in grok/.oi_cache.json, not committed)."""
import sys, os, json, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book as B, hl

CORE = ["BTC", "ETH", "SOL", "HYPE"]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".oi_cache.json")


def ema(xs, n):
    k, e = 2 / (n + 1), xs[0]
    for x in xs[1:]:
        e = x * k + e * (1 - k)
    return e


def rsi(xs, n=14):
    g = l = 0.0
    for i in range(1, n + 1):
        d = xs[i] - xs[i - 1]; g += max(d, 0); l += max(-d, 0)
    g /= n; l /= n
    for i in range(n + 1, len(xs)):
        d = xs[i] - xs[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n; l = (l * (n - 1) + max(-d, 0)) / n
    return 100 if l == 0 else 100 - 100 / (1 + g / l)


def atrp(cs, n=14):
    trs = [max(c["h"] - c["l"], abs(c["h"] - p["c"]), abs(c["l"] - p["c"])) for p, c in zip(cs, cs[1:])]
    a = sum(trs[:n]) / n
    for t in trs[n:]:
        a = (a * (n - 1) + t) / n
    return a / cs[-1]["c"] * 100


def tf(coin, iv, hours):
    try:
        cs = hl.candles(coin, iv, (time.time() - hours * 3600) * 1000)
        if len(cs) < 55:
            return "n/a"
        cl = [c["c"] for c in cs]
        e20, e50 = ema(cl, 20), ema(cl, 50)
        t = "UP" if cl[-1] > e20 > e50 else "DN" if cl[-1] < e20 < e50 else "MIX"
        return "%s r%.0f a%.1f" % (t, rsi(cl), atrp(cs))
    except Exception:
        return "err"


def fp(x):
    return ("%.6g" % x) if x < 1000 else "%.0f" % x


def build():
    ctx = hl.meta_ctx()
    top = [k for k, _ in sorted(ctx.items(), key=lambda kv: -kv[1]["vol"]) if k not in CORE][:10]
    book = B.load()
    watch = CORE + top + [p["coin"] for p in book["open"] if p["coin"] not in CORE + top]
    with ThreadPoolExecutor(8) as ex:
        h1 = dict(zip(watch, ex.map(lambda c: tf(c, "1h", 80), watch)))
        h4 = dict(zip(watch, ex.map(lambda c: tf(c, "4h", 320), watch)))
    try:
        prev = json.load(open(CACHE))
    except Exception:
        prev = {}
    out = ["MKT %s UTC | 1h/4h: trend(px>EMA20>EMA50=UP) rRSI14 aATR%%" % B.now_iso()[:16].replace("T", " ")]
    out.append("coin px 24h% fund8h% OI$M OIΔ% vol$M | 1h | 4h")
    for c in watch:
        x = ctx.get(c)
        if not x:
            continue
        ch = (x["mid"] / x["prev"] - 1) * 100 if x["prev"] else 0
        po = prev.get("oi", {}).get(c)
        oid = "%+.1f" % ((x["oi"] / po - 1) * 100) if po else "-"
        out.append("%s %s %+.1f %+.3f %.0f %s %.0f | %s | %s" % (c, fp(x["mid"]), ch, x["funding"] * 800, x["oi"] / 1e6, oid, x["vol"] / 1e6, h1[c], h4[c]))
    if prev.get("t"):
        out.append("(OIΔ vs %s)" % prev["t"])
    json.dump({"t": B.now_iso()[:16], "oi": {c: v["oi"] for c, v in ctx.items()}}, open(CACHE, "w"))
    mids = {c: v["mid"] for c, v in ctx.items()}
    eq = B.equity(book, mids)
    prog = (eq - book["start_equity"]) / (book["goal_equity"] - book["start_equity"]) * 100
    risk = sum(B.pos_risk(p) for p in book["open"]) / eq * 100 if eq else 0
    out.append("\nBOOK eq $%.2f cash $%.2f | goal $%.0f progress %.1f%% | open risk %.1f%% | day start $%.2f" % (eq, book["cash"], book["goal_equity"], prog, risk, book["day"]["start_equity"]))
    try:
        B.check_breakers(dict(book, day=dict(book["day"])), eq); out.append("breakers OK")
    except B.RiskError as e:
        out.append("BREAKER: %s" % e)
    for p in book["open"]:
        px = mids.get(p["coin"], p["entry"])
        out.append("%s %s %s sz%g e%s now%s uPnL $%.2f | stop %s (%.1f%% away) tgt %s (%.1f%%) | %s" % (
            p["ticket"], p["side"], p["coin"], p["size"], fp(p["entry"]), fp(px), B.upnl(p, px), fp(p["stop"]),
            abs(px - p["stop"]) / px * 100, fp(p["target"]), abs(p["target"] - px) / px * 100, p["opened_at"][5:16]))
    cl = book["closed"]
    if cl:
        w = sum(1 for c in cl if c["pnl"] > 0)
        out.append("closed %d W%d L%d sumR %.2f" % (len(cl), w, len(cl) - w, sum(c["R"] for c in cl)))
    les = [c for c in cl if c.get("lesson")][-5:]
    if les:
        out.append("LESSONS:")
        out += ["- %s %s %+.2fR: %s" % (c["ticket"], c["coin"], c["R"], c["lesson"][:160]) for c in les]
    return "\n".join(out)


if __name__ == "__main__":
    print(build())
