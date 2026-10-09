/* AI Trading Desk — pure analysis engine (no DOM). Works in browser (window.Engine) and node (module.exports). */
(function (root) {
  'use strict';

  // ---------- technical analysis ----------
  const TA = {
    sma(v, p) { if (v.length < p) return null; let s = 0; for (let i = v.length - p; i < v.length; i++) s += v[i]; return s / p; },
    ema(v, p) {
      if (v.length < p) return null;
      const k = 2 / (p + 1); let e = 0;
      for (let i = 0; i < p; i++) e += v[i]; e /= p;
      for (let i = p; i < v.length; i++) e = v[i] * k + e * (1 - k);
      return e;
    },
    emaSeries(v, p) {
      const out = new Array(v.length).fill(null); if (v.length < p) return out;
      const k = 2 / (p + 1); let e = 0;
      for (let i = 0; i < p; i++) e += v[i]; e /= p; out[p - 1] = e;
      for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); out[i] = e; }
      return out;
    },
    rsi(v, p = 14) {
      if (v.length < p + 1) return null;
      let g = 0, l = 0;
      for (let i = 1; i <= p; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else l -= d; }
      g /= p; l /= p;
      for (let i = p + 1; i < v.length; i++) {
        const d = v[i] - v[i - 1];
        g = (g * (p - 1) + Math.max(d, 0)) / p;
        l = (l * (p - 1) + Math.max(-d, 0)) / p;
      }
      if (l === 0 && g === 0) return 50;
      if (l === 0) return 100;
      return 100 - 100 / (1 + g / l);
    },
    stdev(v) {
      if (v.length < 2) return 0;
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1));
    },
    returnsPct(v) { const r = []; for (let i = 1; i < v.length; i++) if (v[i - 1]) r.push((v[i] / v[i - 1] - 1) * 100); return r; },
    pct(a, b) { return (a && b) ? (b / a - 1) * 100 : 0; },
    bollZ(v, p = 20) {
      if (v.length < p) return 0;
      const w = v.slice(-p); const m = w.reduce((a, b) => a + b, 0) / p; const sd = TA.stdev(w);
      return sd ? (v[v.length - 1] - m) / sd : 0;
    },
    atr(c, p = 14) {
      if (c.length < p + 1) return null;
      const tr = [];
      for (let i = 1; i < c.length; i++) {
        const h = c[i].high, l = c[i].low, pc = c[i - 1].close;
        tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
      }
      let a = 0; for (let i = 0; i < p; i++) a += tr[i]; a /= p;
      for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p;
      return a;
    },
  };

  // ---------- signals from real market state ----------
  // st = { coin, candles:[{time,open,high,low,close,volume}], secs:[{time,open,high,low,close,volume,buy,sell}], ctx:{prevDayPx,funding,dayNtlVlm,openInterest}, price }
  function computeSignals(st) {
    const c = st.candles || [];
    const closes = c.map(x => x.close);
    const price = st.price || (closes.length ? closes[closes.length - 1] : 0);
    if (closes.length) closes[closes.length - 1] = price; // live close
    const s = { coin: st.coin, price, ready: closes.length >= 30 };
    const ctx = st.ctx || {};
    s.chg24 = ctx.prevDayPx ? TA.pct(+ctx.prevDayPx, price) : null;
    s.funding = ctx.funding != null ? +ctx.funding * 100 : null; // % per hour
    s.dayVlm = ctx.dayNtlVlm != null ? +ctx.dayNtlVlm : null;
    s.oi = ctx.openInterest != null ? +ctx.openInterest * price : null;
    const at = n => closes.length > n ? closes[closes.length - 1 - n] : closes[0];
    s.chg1m = TA.pct(at(1), price);
    s.chg5m = TA.pct(at(5), price);
    s.chg15m = TA.pct(at(15), price);
    s.chg60m = TA.pct(at(60), price);
    s.rsi = TA.rsi(closes.slice(-120), 14);
    s.ema9 = TA.ema(closes.slice(-120), 9);
    s.ema21 = TA.ema(closes.slice(-120), 21);
    s.emaSpread = (s.ema9 && s.ema21) ? (s.ema9 / s.ema21 - 1) * 100 : 0;
    // recent EMA cross within last 5 bars
    s.cross = null;
    if (closes.length > 30) {
      const e9 = TA.emaSeries(closes, 9), e21 = TA.emaSeries(closes, 21);
      for (let i = closes.length - 5; i < closes.length; i++) {
        if (e9[i - 1] == null || e21[i - 1] == null) continue;
        if (e9[i - 1] <= e21[i - 1] && e9[i] > e21[i]) s.cross = { dir: 'bull', ago: closes.length - 1 - i };
        if (e9[i - 1] >= e21[i - 1] && e9[i] < e21[i]) s.cross = { dir: 'bear', ago: closes.length - 1 - i };
      }
    }
    s.bollZ = TA.bollZ(closes, 20);
    s.vol = TA.stdev(TA.returnsPct(closes.slice(-31))); // stdev of 1m returns, %
    s.atr = TA.atr(c.slice(-60), 14) || price * 0.002;
    s.atrPct = price ? s.atr / price * 100 : 0;
    // volume spike: last 3 finished minutes vs previous 30
    const vols = c.map(x => x.volume);
    if (vols.length > 35) {
      const recent = (vols[vols.length - 2] + vols[vols.length - 3] + vols[vols.length - 4]) / 3;
      const base = vols.slice(-34, -4).reduce((a, b) => a + b, 0) / 30;
      s.volSpike = base > 0 ? recent / base : 1;
    } else s.volSpike = 1;
    // order flow from 1s bars (taker buys vs sells, last 60s)
    const secs = (st.secs || []).slice(-60);
    let b = 0, se = 0; for (const x of secs) { b += x.buy || 0; se += x.sell || 0; }
    s.flowBuy = b * price; s.flowSell = se * price;
    s.flowImb = (b + se) > 0 ? (b - se) / (b + se) : 0;
    s.chg10s = secs.length > 10 ? TA.pct(secs[secs.length - 11].close, price) : 0;
    s.chg60s = secs.length > 1 ? TA.pct(secs[0].close, price) : 0;
    s.tickVol = TA.stdev(TA.returnsPct(secs.map(x => x.close))) || 0;
    return s;
  }

  // ---------- helpers ----------
  function fmtPx(p) {
    if (p == null || !isFinite(p)) return '—';
    const d = p >= 10000 ? 1 : p >= 100 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : 6;
    return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const f1 = x => (x == null || !isFinite(x)) ? '—' : x.toFixed(1);
  const f2 = x => (x == null || !isFinite(x)) ? '—' : x.toFixed(2);
  const sg = (x, d) => (x == null || !isFinite(x)) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d != null ? d : (Math.abs(x) < 0.1 ? 3 : 2)) + '%';
  function fmtUsd(x) {
    if (x == null || !isFinite(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
    return '$' + x.toFixed(0);
  }
  let rnd = Math.random;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- bot personas ----------
  // analyze(sig, ctx) -> { side:'LONG'|'SHORT'|'FLAT', conv:0..1, why:string, lines:[terminal lines] }
  const BOTS = [
    {
      id: 'nova', name: 'NOVA', color: '#22d3ee', shape: 'triangle', role: 'Momentum',
      rule: 'Ride the trend: EMA9 > EMA21 and RSI 52–75 → long. Never fight the tape.',
      analyze(s) {
        const lines = [`> ema(9)=${fmtPx(s.ema9)} ema(21)=${fmtPx(s.ema21)} spread=${sg(s.emaSpread, 3)}`, `> rsi(14,1m)=${f1(s.rsi)}  Δ5m=${sg(s.chg5m)}`];
        let side = 'FLAT', conv = 0, why;
        if (s.emaSpread > 0 && s.chg5m > 0 && s.rsi >= 52 && s.rsi <= 75) {
          side = 'LONG'; conv = clamp(0.35 + s.emaSpread * 8 + s.chg5m * 0.6 + (s.cross && s.cross.dir === 'bull' ? 0.2 : 0), 0, 1);
          why = `EMA9 above EMA21 (${sg(s.emaSpread, 3)}), ${sg(s.chg5m)} in 5m, RSI ${f1(s.rsi)} has room`;
        } else if (s.emaSpread < 0 && s.chg5m < 0 && s.rsi <= 48 && s.rsi >= 25) {
          side = 'SHORT'; conv = clamp(0.35 - s.emaSpread * 8 - s.chg5m * 0.6 + (s.cross && s.cross.dir === 'bear' ? 0.2 : 0), 0, 1);
          why = `EMA9 under EMA21 (${sg(s.emaSpread, 3)}), ${sg(s.chg5m)} in 5m, RSI ${f1(s.rsi)} trending down`;
        } else {
          why = `no clean trend — EMA spread ${sg(s.emaSpread, 3)}, RSI ${f1(s.rsi)}`;
        }
        if (s.cross) lines.push(`> ema cross: ${s.cross.dir.toUpperCase()} ${s.cross.ago}m ago`);
        return { side, conv, why, lines };
      },
      say: {
        LONG: [
          '{C} is trending. {why}. I want to be long, momentum is our friend 🚀',
          'Trend check on {C}: {why}. Buying strength, not dips.',
          '{C} tape looks strong. {why}. Long bias.',
        ],
        SHORT: [
          '{C} is bleeding. {why}. Momentum says short.',
          'Trend is down on {C}: {why}. Shorting into weakness.',
        ],
        FLAT: [
          '{C} is chop city. {why}. I sit on my hands.',
          'Nothing to ride on {C} right now: {why}.',
        ],
      },
    },
    {
      id: 'luna', name: 'LUNA', color: '#f472b6', shape: 'circle', role: 'Mean Reversion',
      rule: 'Fade the extremes: RSI < 32 or band z < −1.8 → buy; RSI > 68 or z > +1.8 → sell.',
      analyze(s) {
        const lines = [`> bollinger(20,1m) z=${f2(s.bollZ)}`, `> rsi(14)=${f1(s.rsi)}  σ(1m)=${f2(s.vol)}%`];
        let side = 'FLAT', conv = 0, why;
        if ((s.rsi != null && s.rsi > 68) || s.bollZ > 1.8) {
          side = 'SHORT'; conv = clamp(0.3 + Math.max(0, (s.rsi - 65) / 20) + Math.max(0, (s.bollZ - 1.5) / 2), 0, 1);
          why = `stretched: RSI ${f1(s.rsi)}, ${f2(s.bollZ)}σ above the 20-bar mean`;
        } else if ((s.rsi != null && s.rsi < 32) || s.bollZ < -1.8) {
          side = 'LONG'; conv = clamp(0.3 + Math.max(0, (35 - s.rsi) / 20) + Math.max(0, (-s.bollZ - 1.5) / 2), 0, 1);
          why = `oversold: RSI ${f1(s.rsi)}, ${f2(Math.abs(s.bollZ))}σ below the mean`;
        } else {
          why = `inside the bands (z=${f2(s.bollZ)}, RSI ${f1(s.rsi)}), nothing to fade`;
        }
        return { side, conv, why, lines };
      },
      say: {
        LONG: ['{C} is {why}. Rubber band snaps back — I like a bounce long 🌙', 'Everyone is panicking on {C}. {why}. Mean says buy.'],
        SHORT: ['{C} got ahead of itself, {why}. I\'d fade it.', 'Too hot: {C} is {why}. Gravity wins, short-term short.'],
        FLAT: ['{C} sits {why}. Patience.', 'Meh. {C} is {why}.'],
      },
    },
    {
      id: 'atlas', name: 'ATLAS', color: '#fbbf24', shape: 'square', role: 'Risk Manager',
      rule: 'Max risk 1R per idea, stop = 1.5×ATR. σ too high or crowded funding → veto.',
      analyze(s) {
        const lines = [`> atr(14,1m)=${fmtPx(s.atr)} (${f2(s.atrPct)}%)`, `> σ(1m ret)=${f2(s.vol)}%  funding=${s.funding == null ? '—' : s.funding.toFixed(4) + '%/h'}`];
        let risk = 'OK', why;
        if (s.vol > 0.45 || s.atrPct > 0.7) { risk = 'VETO'; why = `volatility is hot (σ ${f2(s.vol)}%, ATR ${f2(s.atrPct)}%), stops would get run`; }
        else if (s.vol > 0.25 || (s.funding != null && Math.abs(s.funding) > 0.003)) { risk = 'CAUTION'; why = `elevated risk (σ ${f2(s.vol)}%, funding ${s.funding == null ? '—' : s.funding.toFixed(4)}%/h), half size`; }
        else why = `risk is fine: ATR ${f2(s.atrPct)}%, σ ${f2(s.vol)}%`;
        lines.push(`> risk check: ${risk}`);
        return { side: 'FLAT', conv: 0, risk, why, lines };
      },
      say: {
        OK: ['Risk check {C}: {why}. Stop at 1.5×ATR ≈ {stop}. Approved ✅', '{C}: {why}. If we do it, size so a stop at {stop} = 1R.'],
        CAUTION: ['Careful on {C}: {why}. Half size or skip ⚠️', '{C} — {why}. I\'ll sign off only with a tight stop near {stop}.'],
        VETO: ['Hard no on {C} for now: {why} ⛔', 'VETO {C}: {why}. We live to trade another day.'],
      },
    },
    {
      id: 'echo', name: 'ECHO', color: '#4ade80', shape: 'hexagon', role: 'Flow & Sentiment',
      rule: 'Follow the crowd’s money: taker flow imbalance + volume spikes + funding.',
      analyze(s) {
        const lines = [`> taker flow 60s: buy ${fmtUsd(s.flowBuy)} / sell ${fmtUsd(s.flowSell)} imb=${f2(s.flowImb)}`, `> vol spike(3m/30m)=${f2(s.volSpike)}x  24h=${sg(s.chg24)}`];
        let side = 'FLAT', conv = 0, why;
        const spike = s.volSpike > 1.4;
        if (s.flowImb > 0.25 && (spike || s.chg60s > 0)) {
          side = 'LONG'; conv = clamp(0.3 + s.flowImb * 0.6 + (spike ? 0.2 : 0), 0, 1);
          why = `buyers dominate (flow ${sg(s.flowImb * 100, 0)}), volume ${f2(s.volSpike)}x normal`;
        } else if (s.flowImb < -0.25 && (spike || s.chg60s < 0)) {
          side = 'SHORT'; conv = clamp(0.3 - s.flowImb * 0.6 + (spike ? 0.2 : 0), 0, 1);
          why = `sellers hitting bids (flow ${sg(s.flowImb * 100, 0)}), volume ${f2(s.volSpike)}x normal`;
        } else {
          why = `flow is balanced (${sg(s.flowImb * 100, 0)}), volume ${f2(s.volSpike)}x normal`;
        }
        return { side, conv, why, lines };
      },
      say: {
        LONG: ['Vibes on {C} are bullish 📡 {why}.', 'Smart money is lifting offers on {C}: {why}.'],
        SHORT: ['{C} flow turned ugly: {why} 📉', 'People are dumping {C}. {why}.'],
        FLAT: ['{C} crowd is undecided: {why}.', 'Listening to {C} tape… {why}.'],
      },
    },
    {
      id: 'vex', name: 'VEX', color: '#fb7185', shape: 'diamond', role: 'Contrarian',
      rule: 'When everyone agrees, look the other way. Fade big 24h moves at RSI extremes.',
      analyze(s, consensus) {
        const lines = [`> 24h=${sg(s.chg24)}  1h=${sg(s.chg60m)}  rsi=${f1(s.rsi)}`];
        let side = 'FLAT', conv = 0, why;
        if (s.chg24 != null && s.chg24 > 4 && s.rsi > 60) { side = 'SHORT'; conv = clamp(0.3 + (s.chg24 - 4) / 10 + (s.rsi - 60) / 40, 0, 1); why = `up ${sg(s.chg24)} in 24h with RSI ${f1(s.rsi)}, late longs are the exit liquidity`; }
        else if (s.chg24 != null && s.chg24 < -4 && s.rsi < 40) { side = 'LONG'; conv = clamp(0.3 + (-s.chg24 - 4) / 10 + (40 - s.rsi) / 40, 0, 1); why = `down ${sg(s.chg24)} in 24h with RSI ${f1(s.rsi)}, max pain is already priced`; }
        else if (consensus && consensus.count >= 2) {
          side = consensus.side === 'LONG' ? 'SHORT' : 'LONG'; conv = 0.25;
          why = `${consensus.count} of you agree on ${consensus.side}. That's exactly when it reverses`;
        } else why = `no crowd to fade yet (24h ${sg(s.chg24)})`;
        lines.push(`> contrarian view: ${side}`);
        return { side, conv, why, lines };
      },
      say: {
        LONG: ['Hot take: {C} long. {why} 😈', 'Everyone hates {C}? Good. {why}.'],
        SHORT: ['Devil\'s advocate on {C}: {why}.', 'I\'ll be the bear on {C}. {why}.'],
        FLAT: ['{C} isn\'t crowded enough for me: {why}.', 'Pass on {C}: {why}.'],
      },
    },
  ];
  const BOT = Object.fromEntries(BOTS.map(b => [b.id, b]));

  const REPLY = {
    agree: ['Agree with {who}: ', '+1 {who}. ', 'Same read as {who}: ', 'Backing {who} here: '],
    disagree: ['Pushback, {who}: ', 'Not so fast {who}: ', 'Hard disagree {who}: ', 'Respectfully, {who}, no: '],
    neutral: ['{who}, from my seat: ', 'Adding context for {who}: ', 'FWIW {who}: '],
  };

  function fill(t, m) { return t.replace(/\{(\w+)\}/g, (_, k) => m[k] != null ? m[k] : ''); }

  // Evaluate all bots on one coin
  function evaluateAll(sig) {
    const views = {};
    for (const b of BOTS) if (b.id !== 'vex' && b.id !== 'atlas') views[b.id] = b.analyze(sig);
    let L = 0, S = 0; for (const v of Object.values(views)) { if (v.side === 'LONG') L++; if (v.side === 'SHORT') S++; }
    const consensus = L > S ? { side: 'LONG', count: L } : S > L ? { side: 'SHORT', count: S } : null;
    views.vex = BOT.vex.analyze(sig, consensus);
    views.atlas = BOT.atlas.analyze(sig);
    return views;
  }

  function stopsFor(sig, side) {
    const p = sig.price;
    const dist = clamp(1.5 * (sig.atr || p * 0.002), p * 0.0025, p * 0.03);
    return side === 'LONG' ? { stop: p - dist, target: p + 2 * dist } : { stop: p + dist, target: p - 2 * dist };
  }

  function message(botId, sig, view, opts = {}) {
    const b = BOT[botId];
    const key = botId === 'atlas' ? view.risk : view.side;
    const st = stopsFor(sig, opts.side || 'LONG');
    let txt = fill(pick(b.say[key]), { C: sig.coin, why: view.why, stop: fmtPx(st.stop) });
    if (opts.replyTo) {
      const other = opts.replyTo;
      let kind = 'neutral';
      if (botId !== 'atlas' && view.side !== 'FLAT' && other.side !== 'FLAT') kind = view.side === other.side ? 'agree' : 'disagree';
      else if (botId === 'atlas' && view.risk === 'VETO' && other.side !== 'FLAT') kind = 'disagree';
      txt = fill(pick(REPLY[kind]), { who: '@' + BOT[other.bot].name }) + (/^[A-Z][a-z]/.test(txt) ? txt.charAt(0).toLowerCase() + txt.slice(1) : txt);
    }
    return txt;
  }

  // Build an idea for the user from a debate, or null
  function buildIdea(sig, views, now) {
    if (!sig.ready || !sig.price) return null;
    const dirBots = ['nova', 'luna', 'echo', 'vex'];
    const L = dirBots.filter(id => views[id].side === 'LONG');
    const S = dirBots.filter(id => views[id].side === 'SHORT');
    let side, agree, dissent;
    if (L.length >= 2 && S.length <= 1) { side = 'LONG'; agree = L; dissent = S; }
    else if (S.length >= 2 && L.length <= 1) { side = 'SHORT'; agree = S; dissent = L; }
    else if (L.length === 1 && S.length === 0 && views[L[0]].conv >= 0.6) { side = 'LONG'; agree = L; dissent = []; }
    else if (S.length === 1 && L.length === 0 && views[S[0]].conv >= 0.6) { side = 'SHORT'; agree = S; dissent = []; }
    else return null;
    const risk = views.atlas.risk;
    if (risk === 'VETO') return null;
    const st = stopsFor(sig, side);
    const conv = agree.reduce((a, id) => a + views[id].conv, 0) / agree.length;
    const score = agree.length + conv - dissent.length * 0.5 - (risk === 'CAUTION' ? 0.5 : 0);
    const confidence = score >= 3 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW';
    return {
      id: sig.coin + '-' + now, coin: sig.coin, side, entry: sig.price, stop: st.stop, target: st.target,
      rr: 2, risk, confidence, created: now,
      agree: agree.concat(['atlas']),
      reasons: agree.map(id => ({ bot: id, why: views[id].why })).concat([{ bot: 'atlas', why: views.atlas.why }]),
      dissent: dissent.map(id => ({ bot: id, why: views[id].why })),
    };
  }

  function ideaPnl(idea, price) {
    const r = (price / idea.entry - 1) * 100;
    return idea.side === 'LONG' ? r : -r;
  }
  function ideaProgress(idea, price) { // 0 = stop, 1 = target
    return clamp((price - idea.stop) / (idea.target - idea.stop), 0, 1);
  }
  function ideaStatus(idea, price) {
    if (idea.side === 'LONG') { if (price >= idea.target) return 'TARGET'; if (price <= idea.stop) return 'STOPPED'; }
    else { if (price <= idea.target) return 'TARGET'; if (price >= idea.stop) return 'STOPPED'; }
    return 'OPEN';
  }

  const Engine = { TA, computeSignals, BOTS, BOT, evaluateAll, buildIdea, stopsFor, message, ideaPnl, ideaProgress, ideaStatus, fmtPx, fmtUsd, sg, f1, f2, setRandom(f) { rnd = f; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
