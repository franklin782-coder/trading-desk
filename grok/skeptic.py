#!/usr/bin/env python3
"""SKEPTIC gate: one OpenRouter call per proposed trade. Returns {verdict, reasons, biggest_risk, model, error}.
Any failure => verdict NO. The API key is read from env OPENROUTER_API_KEY and never printed/logged."""
import json, os, re, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import book as B

LOG = os.environ.get("GROK_SKEPTIC_LOG", os.path.join(B.HERE, "skeptic.jsonl"))
MODELS = ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"]
URL = "https://openrouter.ai/api/v1/chat/completions"
SYSTEM = ("You are SKEPTIC, a hard-nosed risk reviewer for a $1,000 crypto paper-trading account (Hyperliquid perps). "
          "Your job is to ARGUE AGAINST the proposed trade: look for weak theses, trading against the higher timeframe, "
          "stops inside noise (compare stop distance to ATR%), poor reward:risk after fees, crowded funding, chasing extended moves, "
          "repeating mistakes listed in past lessons, correlation with open positions. Approve (YES) only if the trade survives your best "
          "counter-arguments. Note: this is a perp; notional/leverage is exposure, risk_usd is the actual loss if the stop fills (sized ~2% of equity). Reply with STRICT JSON only, no prose, no code fences: "
          '{"verdict":"YES"|"NO","reasons":["..."],"biggest_risk":"..."}')


def _call(model, msgs, key, timeout=90):
    body = json.dumps({"model": model, "messages": msgs, "temperature": 0.2, "max_tokens": 1500}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                                                          "HTTP-Referer": "https://franklin782-coder.github.io/trading-desk/", "X-Title": "GROK trading desk skeptic"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    return d["choices"][0]["message"]["content"] or ""


def parse(txt):
    m = re.search(r"\{.*\}", txt, re.S)
    j = json.loads(m.group(0))
    v = str(j.get("verdict", "")).upper().strip()
    if v not in ("YES", "NO"):
        raise ValueError("bad verdict %r" % v)
    return {"verdict": v, "reasons": [str(x)[:300] for x in (j.get("reasons") or [])][:6], "biggest_risk": str(j.get("biggest_risk", ""))[:300]}


def review(proposal, snapshot_text, lessons, call=_call):
    key = os.environ.get("OPENROUTER_API_KEY", "")
    user = ("PROPOSED TRADE:\n%s\n\nMARKET SNAPSHOT:\n%s\n\nLAST LESSONS:\n%s\n\nReturn the JSON verdict." %
            (json.dumps(proposal), snapshot_text, "\n".join("- " + l for l in lessons) or "(none yet)"))
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
    errs = []
    if not key:
        errs.append("OPENROUTER_API_KEY not set")
    else:
        for m in MODELS:
            try:
                r = parse(call(m, msgs, key))
                r.update(model=m, error=None)
                return r
            except Exception as e:
                msg = str(e).replace(key, "***")[:200]
                errs.append("%s: %s" % (m, msg))
    return {"verdict": "NO", "reasons": ["skeptic unavailable — default NO"], "biggest_risk": "no review", "model": None, "error": "; ".join(errs)}


def log(rec, path=None):
    with open(path or LOG, "a") as f:
        f.write(json.dumps(rec) + "\n")
