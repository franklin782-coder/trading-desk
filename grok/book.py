"""GROK paper book: storage, risk rules and accounting. Pure logic; prices are passed in."""
import json, os, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BOOK = os.environ.get("GROK_BOOK", os.path.join(HERE, "book.json"))
JOURNAL = os.environ.get("GROK_JOURNAL", os.path.join(HERE, "journal.jsonl"))

RULES = {
    "fee_rate": 0.00045,        # per side
    "slippage": 0.0005,         # adverse, per fill
    "risk_default_pct": 2.0,
    "risk_max_pct": 3.0,
    "max_leverage": 5.0,
    "max_open": 3,
    "max_open_risk_pct": 8.0,
    "daily_loss_stop_pct": 6.0,
    "loss_streak": 3,
    "loss_streak_pause_h": 6,
}


class RiskError(Exception):
    pass


def now_iso(ts=None):
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def new_book():
    t = "2026-10-26T00:00:00Z"
    return {"account": "GROK", "currency": "USDC", "created": "2026-10-26", "start_equity": 1000.0, "goal_equity": 5000.0,
            "cash": 1000.0, "rules": RULES, "open": [], "closed": [], "equity": [{"t": t, "eq": 1000.0}],
            "day": {"date": "2026-10-26", "start_equity": 1000.0}, "shadow": [], "last_mark": None, "last_thesis": None, "updated": t}


def load(path=None):
    path = path or BOOK
    if not os.path.exists(path):
        return new_book()
    with open(path) as f:
        b = json.load(f)
    b.setdefault("shadow", [])
    return b


def save(book, path=None):
    path = path or BOOK
    book["updated"] = now_iso()
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(book, f, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def journal(event, path=None, **kw):
    rec = {"t": now_iso(), "event": event}
    rec.update(kw)
    with open(path or JOURNAL, "a") as f:
        f.write(json.dumps(rec) + "\n")


def r2(x):
    return round(x, 6)


def upnl(p, px):
    d = 1 if p["side"] == "long" else -1
    return d * (px - p["entry"]) * p["size"]


def equity(book, prices=None):
    prices = prices or {}
    return book["cash"] + sum(upnl(p, prices.get(p["coin"], p["entry"])) for p in book["open"])


def pos_risk(p):
    return abs(p["entry"] - p["stop"]) * p["size"]


def roll_day(book, eq, ts=None):
    d = now_iso(ts)[:10]
    if book["day"]["date"] != d:
        book["day"] = {"date": d, "start_equity": round(eq, 2)}


def next_ticket(book, ts=None):
    d = now_iso(ts)[:10].replace("-", "")
    pre = "GK-%s-" % d
    n = [int(p["ticket"].split("-")[-1]) for p in book["open"] + book["closed"] if p["ticket"].startswith(pre)]
    return "%s%02d" % (pre, max(n, default=0) + 1)


def check_breakers(book, eq, ts=None):
    ts = ts if ts is not None else time.time()
    R = book.get("rules", RULES)
    roll_day(book, eq, ts)
    dd = (eq / book["day"]["start_equity"] - 1) * 100
    if dd <= -R["daily_loss_stop_pct"]:
        raise RiskError("DAILY LOSS STOP: equity %.2f%% today (limit -%.1f%%). No new entries until next UTC day." % (dd, R["daily_loss_stop_pct"]))
    last = book["closed"][-R["loss_streak"]:]
    if len(last) == R["loss_streak"] and all(c["pnl"] < 0 for c in last):
        since = (ts - parse_iso(last[-1]["closed_at"])) / 3600
        if since < R["loss_streak_pause_h"]:
            raise RiskError("LOSS-STREAK PAUSE: %d losses in a row, last %.1fh ago; paused for %dh (%.1fh left)." % (R["loss_streak"], since, R["loss_streak_pause_h"], R["loss_streak_pause_h"] - since))


def open_position(book, coin, side, stop, target, thesis, mid, risk_pct=None, prices=None, ts=None):
    R = book.get("rules", RULES)
    ts = ts if ts is not None else time.time()
    coin = coin.upper()
    if side not in ("long", "short"):
        raise RiskError("side must be long or short")
    if not thesis or len(thesis.strip()) < 10:
        raise RiskError("thesis required (>=10 chars)")
    if not (mid > 0):
        raise RiskError("no price for %s" % coin)
    risk_pct = R["risk_default_pct"] if risk_pct is None else float(risk_pct)
    if risk_pct <= 0 or risk_pct > R["risk_max_pct"]:
        raise RiskError("risk %.2f%% outside (0, %.1f%%] hard max" % (risk_pct, R["risk_max_pct"]))
    if any(p["coin"] == coin for p in book["open"]):
        raise RiskError("already have an open %s position" % coin)
    if len(book["open"]) >= R["max_open"]:
        raise RiskError("max %d open positions reached" % R["max_open"])
    prices = dict(prices or {})
    prices[coin] = mid
    eq = equity(book, prices)
    check_breakers(book, eq, ts)
    d = 1 if side == "long" else -1
    entry = mid * (1 + d * R["slippage"])
    if d * (entry - stop) <= 0:
        raise RiskError("stop %s is on the wrong side of entry %.6g for a %s" % (stop, entry, side))
    if d * (target - entry) <= 0:
        raise RiskError("target %s is on the wrong side of entry %.6g for a %s" % (target, entry, side))
    stop_dist = abs(entry - stop) / entry
    if stop_dist < 0.002:
        raise RiskError("stop too tight (%.3f%% < 0.2%%) — fees+slippage would dominate" % (stop_dist * 100))
    risk_usd = eq * risk_pct / 100
    size = risk_usd / abs(entry - stop)
    note = ""
    lev = size * entry / eq
    if lev > R["max_leverage"]:
        size = R["max_leverage"] * eq / entry
        note = "size capped by %.0fx leverage (risk reduced)" % R["max_leverage"]
        risk_usd = size * abs(entry - stop)
        lev = R["max_leverage"]
    open_risk = sum(pos_risk(p) for p in book["open"])
    if (open_risk + risk_usd) / eq * 100 > R["max_open_risk_pct"] + 1e-9:
        raise RiskError("total open risk would be %.2f%% > %.1f%% cap (current %.2f%%)" % ((open_risk + risk_usd) / eq * 100, R["max_open_risk_pct"], open_risk / eq * 100))
    fee = size * entry * R["fee_rate"]
    book["cash"] = r2(book["cash"] - fee)
    p = {"ticket": next_ticket(book, ts), "coin": coin, "side": side, "entry": r2(entry), "stop": float(stop), "init_stop": float(stop),
         "target": float(target), "size": r2(size), "notional": round(size * entry, 2), "leverage": round(lev, 2),
         "risk_usd": round(risk_usd, 2), "risk_pct": round(risk_usd / eq * 100, 3), "fees": round(fee, 4),
         "opened_at": now_iso(ts), "thesis": thesis.strip(), "note": note}
    book["open"].append(p)
    book["last_thesis"] = {"ticket": p["ticket"], "coin": coin, "side": side, "thesis": p["thesis"], "t": p["opened_at"]}
    return p


def close_position(book, ticket, px, reason, lesson="", ts=None, fill_exact=False):
    """px = trigger/mid price. Slippage is applied adversely unless fill_exact."""
    R = book.get("rules", RULES)
    ts = ts if ts is not None else time.time()
    p = next((x for x in book["open"] if x["ticket"] == ticket), None)
    if not p:
        raise RiskError("no open ticket %s" % ticket)
    d = 1 if p["side"] == "long" else -1
    exitpx = px if fill_exact else px * (1 - d * R["slippage"])
    gross = d * (exitpx - p["entry"]) * p["size"]
    fee = p["size"] * exitpx * R["fee_rate"]
    fees = p["fees"] + fee
    pnl = gross - fees
    book["cash"] = r2(book["cash"] + gross - fee)
    init_risk = abs(p["entry"] - p["init_stop"]) * p["size"]
    c = dict(p)
    c.update({"exit": r2(exitpx), "closed_at": now_iso(ts), "reason": reason, "lesson": lesson or "",
              "gross": round(gross, 4), "fees": round(fees, 4), "pnl": round(pnl, 4),
              "R": round(pnl / init_risk, 2) if init_risk else 0.0,
              "hold_h": round((ts - parse_iso(p["opened_at"])) / 3600, 2)})
    book["open"].remove(p)
    book["closed"].append(c)
    return c


def move_stop(book, ticket, stop):
    p = next((x for x in book["open"] if x["ticket"] == ticket), None)
    if not p:
        raise RiskError("no open ticket %s" % ticket)
    d = 1 if p["side"] == "long" else -1
    if d * (stop - p["stop"]) <= 0:
        raise RiskError("stop can only move toward reducing risk (%s %s: current %s, requested %s)" % (p["side"], p["coin"], p["stop"], stop))
    old = p["stop"]
    p["stop"] = float(stop)
    return old


def add_point(book, eq, ts=None):
    book["equity"].append({"t": now_iso(ts), "eq": round(eq, 2)})
    if len(book["equity"]) > 3000:   # thin old history
        h = book["equity"]
        book["equity"] = h[:1] + h[1:-1000:2] + h[-1000:]


def shadow_from(p, review, ts=None):
    """Turn a rejected proposal into a shadow trade (tracked, never affects cash)."""
    s = {k: p[k] for k in ("coin", "side", "entry", "stop", "target", "size", "risk_usd", "thesis")}
    s.update(id=p["ticket"].replace("GK-", "SX-"), opened_at=now_iso(ts), status="open", verdict=review["verdict"],
             skeptic_error=bool(review.get("error")), biggest_risk=review.get("biggest_risk", ""))
    return s


def resolve_shadow(s, kind, px, ts, rules=RULES):
    d = 1 if s["side"] == "long" else -1
    fill = px * (1 - d * rules["slippage"]) if kind == "stop" else px
    gross = d * (fill - s["entry"]) * s["size"]
    fees = s["size"] * (s["entry"] + fill) * rules["fee_rate"]
    s.update(status="closed", outcome=kind, exit=r2(fill), closed_at=now_iso(ts), pnl=round(gross - fees, 4),
             R=round((gross - fees) / s["risk_usd"], 2) if s["risk_usd"] else 0.0)
    return s


def skeptic_stats(book):
    """Skeptic is 'right' if an approved trade made money or a rejected (shadow) trade would have lost."""
    app = [c for c in book["closed"] if c.get("skeptic", {}).get("verdict") == "YES"]
    rej = [s for s in book.get("shadow", []) if s["status"] == "closed" and not s.get("skeptic_error")]
    a_ok = sum(1 for c in app if c["pnl"] > 0)
    r_ok = sum(1 for s in rej if s["pnl"] <= 0)
    n = len(app) + len(rej)
    return {"approved_closed": len(app), "approved_right": a_ok, "rejected_resolved": len(rej), "rejected_right": r_ok,
            "accuracy": round((a_ok + r_ok) / n * 100, 1) if n else None,
            "shadow_R_saved": round(-sum(s["R"] for s in rej), 2),
            "shadow_open": sum(1 for s in book.get("shadow", []) if s["status"] == "open")}
