"""Tiny Hyperliquid public-API helpers (stdlib only)."""
import json, time, urllib.request

API = "https://api.hyperliquid.xyz/info"


def post(body, retries=3):
    data = json.dumps(body).encode()
    for i in range(retries):
        try:
            req = urllib.request.Request(API, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def mids():
    return {k: float(v) for k, v in post({"type": "allMids"}).items() if not k.startswith("@")}


def candles(coin, interval, start_ms, end_ms=None):
    end_ms = end_ms or int(time.time() * 1000)
    raw = post({"type": "candleSnapshot", "req": {"coin": coin, "interval": interval, "startTime": int(start_ms), "endTime": int(end_ms)}})
    return [{"t": c["t"], "T": c["T"], "o": float(c["o"]), "h": float(c["h"]), "l": float(c["l"]), "c": float(c["c"]), "v": float(c["v"])} for c in raw]


def meta_ctx():
    meta, ctxs = post({"type": "metaAndAssetCtxs"})
    out = {}
    for a, c in zip(meta["universe"], ctxs):
        if a.get("isDelisted"):
            continue
        out[a["name"]] = {
            "mid": float(c.get("midPx") or c.get("markPx") or 0),
            "prev": float(c.get("prevDayPx") or 0),
            "funding": float(c.get("funding") or 0),
            "oi": float(c.get("openInterest") or 0) * float(c.get("markPx") or 0),
            "vol": float(c.get("dayNtlVlm") or 0),
            "maxLev": a.get("maxLeverage"),
        }
    return out
