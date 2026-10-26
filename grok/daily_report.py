#!/usr/bin/env python3
"""Last-24h GROK digest. `python3 grok/daily_report.py` -> markdown; `--json` -> JSON; `--hours N` to change window."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book as B


def jl(path):
    try:
        return [json.loads(l) for l in open(path) if l.strip()]
    except FileNotFoundError:
        return []


def build(hours=24, now=None):
    now = now or time.time()
    since = now - hours * 3600
    rec = lambda t: t and B.parse_iso(t) >= since
    b = B.load()
    eqs = [p for p in b["equity"] if B.parse_iso(p["t"]) <= since]
    eq0 = eqs[-1]["eq"] if eqs else b["start_equity"]
    eq1 = b.get("marked_eq") or b["equity"][-1]["eq"]
    opened = [p for p in b["open"] + b["closed"] if rec(p["opened_at"])]
    closed = [c for c in b["closed"] if rec(c["closed_at"])]
    import skeptic
    revs = [r for r in jl(skeptic.LOG) if rec(r["t"])]
    sh_new = [s for s in b["shadow"] if rec(s["opened_at"])]
    sh_res = [s for s in b["shadow"] if s["status"] == "closed" and rec(s.get("closed_at"))]
    rejects = [j for j in jl(B.JOURNAL) if j["event"] == "reject" and rec(j["t"])]
    try:
        B.check_breakers(json.loads(json.dumps(b)), eq1, now); brk = "OK"
    except B.RiskError as e:
        brk = str(e)
    return {"window_h": hours, "generated": B.now_iso(now), "equity_start": eq0, "equity_now": eq1,
            "equity_change_pct": round((eq1 / eq0 - 1) * 100, 2) if eq0 else 0,
            "progress_to_5x_pct": round((eq1 - b["start_equity"]) / (b["goal_equity"] - b["start_equity"]) * 100, 1),
            "opened": [{k: p.get(k) for k in ("ticket", "coin", "side", "entry", "stop", "target", "risk_pct", "thesis")} for p in opened],
            "closed": [{k: c.get(k) for k in ("ticket", "coin", "side", "entry", "exit", "pnl", "R", "reason", "lesson")} for c in closed],
            "realized_pnl": round(sum(c["pnl"] for c in closed), 2), "sum_R": round(sum(c["R"] for c in closed), 2),
            "skeptic_reviews": [{"ticket": r.get("ticket"), "verdict": r["verdict"], "model": r.get("model"), "biggest_risk": r.get("biggest_risk"), "error": bool(r.get("error"))} for r in revs],
            "skeptic_stats_alltime": B.skeptic_stats(b),
            "shadow_new": [s["id"] for s in sh_new],
            "shadow_resolved": [{k: s.get(k) for k in ("id", "coin", "side", "outcome", "pnl", "R")} for s in sh_res],
            "lessons": [c["lesson"] for c in closed if c.get("lesson")],
            "risk_rejections": [j.get("msg") for j in rejects], "breakers_now": brk, "open_positions": len(b["open"])}


def md(r):
    L = ["**GROK $1K→$5K · last %dh**" % r["window_h"],
         "Equity $%.2f → $%.2f (%+.2f%%) · progress to 5x %.1f%%" % (r["equity_start"], r["equity_now"], r["equity_change_pct"], r["progress_to_5x_pct"]),
         "Opened %d · Closed %d · realized $%.2f · ΣR %.2f · open now %d" % (len(r["opened"]), len(r["closed"]), r["realized_pnl"], r["sum_R"], r["open_positions"])]
    L += ["- %s %s %s → $%.2f (%+.2fR) %s" % (c["ticket"], c["side"], c["coin"], c["pnl"], c["R"], c["reason"]) for c in r["closed"]]
    s = r["skeptic_stats_alltime"]
    L.append("Skeptic: %d reviews (%d YES / %d NO) · all-time accuracy %s · shadow R saved %.2f" % (
        len(r["skeptic_reviews"]), sum(x["verdict"] == "YES" for x in r["skeptic_reviews"]), sum(x["verdict"] == "NO" for x in r["skeptic_reviews"]),
        ("%.0f%%" % s["accuracy"]) if s["accuracy"] is not None else "n/a", s["shadow_R_saved"]))
    L += ["- shadow %s %s %s: %s (%+.2fR)" % (x["id"], x["side"], x["coin"], x["outcome"], x["R"]) for x in r["shadow_resolved"]]
    if r["lessons"]:
        L.append("Lessons:"); L += ["- " + l for l in r["lessons"]]
    if r["risk_rejections"]:
        L.append("Risk-rule rejections: %d" % len(r["risk_rejections"])); L += ["- " + str(m) for m in r["risk_rejections"][:5]]
    L.append("Breakers: " + r["breakers_now"])
    return "\n".join(L)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--json", action="store_true"); ap.add_argument("--hours", type=float, default=24)
    a = ap.parse_args()
    r = build(a.hours)
    print(json.dumps(r, indent=1) if a.json else md(r))
