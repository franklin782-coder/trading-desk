/* BNB MEMES: pure analysis for BSC meme tokens (DexScreener + GeckoTerminal data). Browser: window.MemeEngine, node: module.exports */
(function (root) {
  'use strict';
  const TA = (root.Engine && root.Engine.TA) || (typeof require !== 'undefined' ? require('./engine.js').TA : null);

  const ALLOWED_QUOTES = new Set(['WBNB', 'BNB', 'USDT', 'USD1', 'BUSD', 'USDC', 'FDUSD']);
  const EXCLUDE = new Set(['WBNB', 'BNB', 'USDT', 'USDC', 'BUSD', 'USD1', 'FDUSD', 'DAI', 'ETH', 'WETH', 'BTCB', 'CAKE', 'ASTER', 'B2', 'FORM', 'LISTA', 'LISUSD', 'SLISBNB', 'KOGE', 'BNX', 'ALPACA', 'SKYAI', 'BID', 'PUFFER', 'XVS', 'TWT', 'SFP', 'ALPHA', 'BAKE', 'DOGE', 'SHIB', 'ADA', 'XRP', 'DOT', 'LINK', 'UNI', 'TRX', 'SOL', 'FIL', 'LTC', 'AVAX', 'ATOM', 'MATIC', 'POL', 'TON', 'NEAR', 'BCH', 'ETC', 'AAVE', 'INJ', 'STG', 'ID', 'EDU', 'HOOK', 'HFT', 'C98', 'TKO', 'MBOX', 'SXP', 'BETH', 'ANKRBNB', 'STKBNB', 'BNBX', 'WBETH', 'VAI', 'UST', 'TUSD', 'XAUT', 'PAXG']);
  const NAME_EXCLUDE = /binance-peg|wrapped|staked|\busd\b|stable|bridged|xstock|tokenized|liquid staking|vault|dividend|股息/i;
  const MIN_LIQ = 40000, MIN_VOL = 10000;

  const num = x => (x == null || x === '' || !isFinite(+x)) ? null : +x;
  const ratio = (b, s) => (b + s) > 0 ? b / (b + s) : 0.5;

  // classify a DexScreener pair: returns null if OK, or reason string
  function junkReason(p) {
    if (!p || p.chainId !== 'bsc') return 'chain';
    const sym = (p.baseToken.symbol || '').toUpperCase();
    if (EXCLUDE.has(sym) || NAME_EXCLUDE.test(p.baseToken.name || '')) return 'not-meme';
    if (!ALLOWED_QUOTES.has((p.quoteToken.symbol || '').toUpperCase())) return 'odd-quote';
    const liq = num(p.liquidity && p.liquidity.usd) || 0;
    if (liq < MIN_LIQ) return 'low-liq';
    if ((num(p.volume && p.volume.h24) || 0) < MIN_VOL) return 'no-volume';
    if (!num(p.priceUsd)) return 'no-price';
    return null;
  }

  // normalize DexScreener pair → token record
  function toToken(p) {
    const tx = k => ({ buys: (p.txns && p.txns[k] && p.txns[k].buys) || 0, sells: (p.txns && p.txns[k] && p.txns[k].sells) || 0 });
    const pc = p.priceChange || {}, v = p.volume || {};
    return {
      addr: p.baseToken.address, pair: p.pairAddress, symbol: p.baseToken.symbol, name: p.baseToken.name,
      quote: p.quoteToken.symbol, dex: p.dexId + (p.labels && p.labels.length ? ' ' + p.labels[0] : ''),
      price: num(p.priceUsd), chg: { m5: num(pc.m5) || 0, h1: num(pc.h1) || 0, h6: num(pc.h6) || 0, h24: num(pc.h24) || 0 },
      vol: { m5: num(v.m5) || 0, h1: num(v.h1) || 0, h6: num(v.h6) || 0, h24: num(v.h24) || 0 },
      liq: num(p.liquidity && p.liquidity.usd) || 0, mc: num(p.marketCap), fdv: num(p.fdv),
      txns: { m5: tx('m5'), h1: tx('h1'), h6: tx('h6'), h24: tx('h24') },
      created: p.pairCreatedAt || null, boosts: (p.boosts && p.boosts.active) || 0,
      icon: p.info && p.info.imageUrl ? p.info.imageUrl : null, url: p.url,
      socials: p.info && p.info.socials ? p.info.socials.length : 0, websites: p.info && p.info.websites ? p.info.websites.length : 0,
    };
  }

  // choose the main pair per token (highest liquidity among allowed quotes)
  function bestPairs(pairs) {
    const best = new Map();
    for (const p of pairs) {
      if (!p || p.chainId !== 'bsc' || !p.baseToken) continue;
      if (!ALLOWED_QUOTES.has((p.quoteToken.symbol || '').toUpperCase())) continue;
      const a = p.baseToken.address.toLowerCase(), l = num(p.liquidity && p.liquidity.usd) || 0;
      if (!best.has(a) || l > (num(best.get(a).liquidity && best.get(a).liquidity.usd) || 0)) best.set(a, p);
    }
    return [...best.values()];
  }

  // risk score 0..100 (higher = riskier) with human reasons
  function risk(t, all) {
    let s = 0; const why = [];
    const add = (n, w) => { s += n; why.push(w); };
    s = 15; // base: it's a memecoin, it can go to zero
    if (t.liq < 75000) add(35, 'tiny liquidity'); else if (t.liq < 150000) add(25, 'thin liquidity'); else if (t.liq < 400000) add(14, 'modest liquidity'); else if (t.liq < 1e6) add(6, 'sub-$1M liquidity');
    const mc = t.mc || t.fdv;
    if (mc) { const r = t.liq / mc; if (r < 0.02) add(14, 'liq <2% of mcap'); else if (r < 0.05) add(7, 'liq <5% of mcap'); }
    const age = t.created ? (Date.now() - t.created) / 864e5 : null;
    if (age == null) add(8, 'unknown age'); else if (age < 1) add(25, 'pair < 1 day old'); else if (age < 7) add(15, 'pair < 1 week old'); else if (age < 30) add(7, 'pair < 1 month old');
    if (t.fdv && t.mc && t.fdv / t.mc > 1.5) add(5, 'big unlocked supply (FDV≫MC)');
    const a24 = Math.abs(t.chg.h24);
    if (a24 > 60) add(12, `wild 24h move (${t.chg.h24.toFixed(0)}%)`); else if (a24 > 25) add(6, `big 24h move (${t.chg.h24.toFixed(0)}%)`);
    if (ratio(t.txns.h1.buys, t.txns.h1.sells) < 0.38 && t.txns.h1.buys + t.txns.h1.sells > 30) add(8, 'heavy selling 1h');
    if (t.liq > 0 && t.vol.h24 / t.liq > 8) add(6, 'very high churn vs liquidity');
    if (!t.socials && !t.websites) add(5, 'no socials listed');
    if (all) { const twin = all.find(o => o !== t && o.symbol.toUpperCase() === t.symbol.toUpperCase() && o.liq > t.liq * 2); if (twin) add(15, 'possible copycat ticker'); }
    s = Math.min(100, s);
    const level = s < 30 ? 'LOW' : s < 50 ? 'MED' : s < 70 ? 'HIGH' : 'EXTREME';
    return { score: s, level, why };
  }

  // signals; candles = [{time,open,high,low,close,volume}] 1m (optional)
  function signals(t, candles, all) {
    const s = { sym: t.symbol, price: t.price };
    s.chg = t.chg;
    s.br5 = ratio(t.txns.m5.buys, t.txns.m5.sells); s.br1 = ratio(t.txns.h1.buys, t.txns.h1.sells); s.br24 = ratio(t.txns.h24.buys, t.txns.h24.sells);
    s.tx1 = t.txns.h1.buys + t.txns.h1.sells; s.tx6avg = (t.txns.h6.buys + t.txns.h6.sells) / 6;
    s.txAccel = s.tx6avg > 0 ? s.tx1 / s.tx6avg : 1;
    s.volAccel = t.vol.h6 > 0 ? t.vol.h1 / (t.vol.h6 / 6) : 1;
    s.ageDays = t.created ? (Date.now() - t.created) / 864e5 : null;
    s.liq = t.liq; s.mc = t.mc || t.fdv; s.liqMc = s.mc ? t.liq / s.mc * 100 : null;
    s.boosts = t.boosts;
    s.risk = risk(t, all);
    s.rsi = null; s.atrPct = null; s.volSpike = null; s.emaSpread = null;
    const c = candles || [];
    if (TA && c.length >= 20) {
      const closes = c.map(x => x.close); closes[closes.length - 1] = t.price || closes[closes.length - 1];
      s.rsi = TA.rsi(closes.slice(-100), 14);
      const a = TA.atr(c.slice(-60), 14); s.atrPct = a && t.price ? a / t.price * 100 : null;
      const e9 = TA.ema(closes, 9), e21 = TA.ema(closes, 21); s.emaSpread = e9 && e21 ? (e9 / e21 - 1) * 100 : null;
      const v = c.map(x => x.volume);
      if (v.length > 25) { const r = (v[v.length - 1] + v[v.length - 2] + v[v.length - 3]) / 3, b = v.slice(-25, -3).reduce((x, y) => x + y, 0) / 22; s.volSpike = b > 0 ? r / b : null; }
    }
    if (s.atrPct == null) s.atrPct = Math.max(0.5, Math.abs(t.chg.h1) / 3);
    return s;
  }

  const f1 = x => x == null || !isFinite(x) ? '—' : x.toFixed(1);
  const f2 = x => x == null || !isFinite(x) ? '—' : x.toFixed(2);
  const sg = (x, d = 1) => x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d) + '%';
  const pct = x => Math.round(x * 100) + '%';
  function usd(x) { if (x == null || !isFinite(x)) return '—'; const a = Math.abs(x); return a >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : a >= 1e6 ? '$' + (x / 1e6).toFixed(2) + 'M' : a >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : '$' + x.toFixed(0); }
  function px(p) {
    if (p == null || !isFinite(p)) return '—';
    if (p >= 1) return '$' + p.toFixed(p >= 100 ? 2 : 4);
    if (p >= 0.0001) return '$' + p.toPrecision(4);
    const e = Math.floor(Math.log10(p)); const zeros = -e - 1; const sig = (p * Math.pow(10, zeros + 4)).toFixed(0);
    return '$0.0' + String(zeros).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]) + sig;
  }
  function age(ms) { if (!ms) return '—'; const d = (Date.now() - ms) / 864e5; return d >= 365 ? (d / 365).toFixed(1) + 'y' : d >= 1 ? Math.floor(d) + 'd' : Math.max(1, Math.floor(d * 24)) + 'h'; }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  let rnd = Math.random; const pick = a => a[Math.floor(rnd() * a.length)];

  // sides: BUY | AVOID | WAIT (spot memes: no shorting)
  const BOTS = [
    { id: 'nova', name: 'NOVA', color: '#22d3ee', shape: 'triangle', role: 'Meme Momentum',
      rule: 'Buy strength: 1h > +3%, 5m green, buyers > 55% of txns and volume accelerating.',
      analyze(s) {
        const lines = [`> mcap ${usd(s.mc)}  Δ5m ${sg(s.chg.m5)} Δ1h ${sg(s.chg.h1)} Δ6h ${sg(s.chg.h6)}`, `> vol accel 1h/6h-avg = ${f2(s.volAccel)}x  ema Δ ${s.emaSpread == null ? '—' : sg(s.emaSpread, 2)}`];
        let side = 'WAIT', conv = 0, why;
        if (s.chg.h1 > 3 && s.chg.m5 >= 0 && s.br1 > 0.55 && s.volAccel > 1.1) { side = 'BUY'; conv = clamp(0.35 + s.chg.h1 / 40 + (s.volAccel - 1) / 4 + (s.br1 - 0.55), 0, 1); why = `mcap ${usd(s.mc)} and ${sg(s.chg.h1)} in 1h, ${pct(s.br1)} of trades are buys and volume runs ${f2(s.volAccel)}x the 6h pace`; }
        else if (s.chg.h1 < -6 && s.br1 < 0.45) { side = 'AVOID'; conv = clamp(0.4 - s.chg.h1 / 40, 0, 1); why = `trend broke at ${usd(s.mc)} mcap: ${sg(s.chg.h1)} in 1h with sellers in control (${pct(1 - s.br1)} sells)`; }
        else why = `no clean momentum at ${usd(s.mc)} mcap (1h ${sg(s.chg.h1)}, 5m ${sg(s.chg.m5)}, vol ${f2(s.volAccel)}x)`;
        return { side, conv, why, lines };
      },
      say: { BUY: ['${C} is sending 🚀 {why}. Momentum entry on the radar.', 'Trend is your friend on ${C}: {why}.'], AVOID: ['${C} momentum is dead: {why}. Not touching it.', 'Nope on ${C}, {why}.'], WAIT: ['${C}: {why}. Waiting for a real breakout.', 'Flat energy on ${C}. {why}.'] } },
    { id: 'luna', name: 'LUNA', color: '#f472b6', shape: 'circle', role: 'Dip Hunter',
      rule: 'Buy capitulation, not pumps: 24h < −15% that is stabilising with RSI < 38 and deep liquidity.',
      analyze(s) {
        const lines = [`> rsi(14,1m)=${f1(s.rsi)}  Δ24h ${sg(s.chg.h24)}`, `> liquidity ${usd(s.liq)} (${s.liqMc == null ? '—' : f1(s.liqMc) + '% of mcap'})`];
        let side = 'WAIT', conv = 0, why;
        if (s.chg.h24 < -15 && s.chg.h1 > -2 && (s.rsi == null || s.rsi < 45) && s.liq > 200000) { side = 'BUY'; conv = clamp(0.35 + (-s.chg.h24 - 15) / 60 + (s.rsi != null ? (45 - s.rsi) / 40 : 0), 0, 1); why = `flushed ${sg(s.chg.h24)} in 24h to ${usd(s.mc)} mcap but stabilising (1h ${sg(s.chg.h1)}), RSI ${f1(s.rsi)}, liquidity still ${usd(s.liq)}`; }
        else if ((s.rsi != null && s.rsi > 75) || s.chg.h1 > 25) { side = 'AVOID'; conv = clamp(0.4 + ((s.rsi || 70) - 70) / 30 + Math.max(0, s.chg.h1 - 20) / 50, 0, 1); why = `overextended at ${usd(s.mc)} mcap: RSI ${f1(s.rsi)}, ${sg(s.chg.h1)} in 1h. Chasing here is how bags are made`; }
        else why = `no dip to buy at ${usd(s.mc)} mcap (24h ${sg(s.chg.h24)}, RSI ${f1(s.rsi)})`;
        return { side, conv, why, lines };
      },
      say: { BUY: ['Blood on ${C} 🌙 {why}. Nibble zone, small size.', '${C} got nuked and is holding: {why}.'], AVOID: ['${C} is too hot for me: {why}.', 'Let ${C} cool off, {why}.'], WAIT: ['${C}: {why}. Patience.', 'Nothing to catch on ${C}, {why}.'] } },
    { id: 'atlas', name: 'ATLAS', color: '#fbbf24', shape: 'square', role: 'Rug Guard',
      rule: 'Risk score from liquidity, liq/mcap, age, FDV, sell pressure & copycats. HIGH+ = veto.',
      analyze(s) {
        const r = s.risk;
        const lines = [`> risk score ${r.score}/100 → ${r.level}`, `> flags: ${r.why.slice(0, 3).join(', ') || 'none'}`, `> mcap ${usd(s.mc)}  liq ${usd(s.liq)}  age ${s.ageDays == null ? '—' : f1(s.ageDays) + 'd'}`];
        let risk = r.level === 'LOW' ? 'OK' : r.level === 'MED' ? 'CAUTION' : 'VETO';
        if (s.liq < 75000) risk = 'VETO';
        const why = risk === 'OK' ? `risk ${r.score}/100 (${r.level}), ${usd(s.mc)} mcap with ${usd(s.liq)} liquidity${r.why.length ? ', watch: ' + r.why[0] : ''}` : `risk ${r.score}/100 (${r.level}): ${r.why.slice(0, 3).join(', ')}`;
        return { side: 'WAIT', conv: 0, risk, why, lines };
      },
      say: { OK: ['Rug check ${C}: {why}. Acceptable for a tiny paper size ✅', '${C} passes my checks: {why}. Still a memecoin, size like it can go to zero.'], CAUTION: ['Careful with ${C} ⚠️ {why}. Half size, hard stop.', '${C}: {why}. I only sign off with a tight stop.'], VETO: ['VETO ${C} ⛔ {why}.', 'Hard no on ${C}: {why}. That\'s how people get rugged.'] } },
    { id: 'echo', name: 'ECHO', color: '#4ade80', shape: 'hexagon', role: 'Degen Flow',
      rule: 'Follow the crowd: buy ratio 5m/1h > 60%, txn count surging, boosts and socials.',
      analyze(s) {
        const lines = [`> mcap ${usd(s.mc)} · buys/sells 5m ${pct(s.br5)} · 1h ${pct(s.br1)} · 24h ${pct(s.br24)}`, `> txns 1h ${s.tx1} (${f2(s.txAccel)}x 6h pace)  boosts ${s.boosts || 0}`];
        let side = 'WAIT', conv = 0, why;
        if (s.br1 > 0.58 && s.br5 >= 0.5 && s.txAccel > 1.15) { side = 'BUY'; conv = clamp(0.3 + (s.br1 - 0.55) * 2 + (s.txAccel - 1) / 3 + (s.boosts ? 0.1 : 0), 0, 1); why = `${pct(s.br1)} buys in the last hour and txns running ${f2(s.txAccel)}x normal${s.boosts ? `, ${s.boosts} active boosts` : ''}`; }
        else if (s.br1 < 0.42 && s.tx1 > 30) { side = 'AVOID'; conv = clamp(0.3 + (0.45 - s.br1) * 2, 0, 1); why = `sellers dominate: only ${pct(s.br1)} of ${s.tx1} txns in 1h are buys`; }
        else why = `crowd is lukewarm at ${usd(s.mc)} mcap (${pct(s.br1)} buys 1h, txns ${f2(s.txAccel)}x)`;
        return { side, conv, why, lines };
      },
      say: { BUY: ['The degens are piling into ${C} 📡 {why}.', 'CT is gonna notice ${C} soon: {why}.'], AVOID: ['${C} chat is dumping: {why} 📉', 'Exit liquidity alert on ${C}: {why}.'], WAIT: ['${C} vibes are mid: {why}.', 'Listening to ${C} flow… {why}.'] } },
    { id: 'vex', name: 'VEX', color: '#fb7185', shape: 'diamond', role: 'Contrarian',
      rule: 'Fade euphoria (>+60% 24h or 70% buys after a pump); buy despair only if liquidity survived.',
      analyze(s, consensus) {
        const lines = [`> mcap ${usd(s.mc)}  24h ${sg(s.chg.h24)}  buys ${pct(s.br24)}  crowd: ${s.br1 > 0.65 ? 'euphoric' : s.br1 < 0.4 ? 'panicking' : 'meh'}`];
        let side = 'WAIT', conv = 0, why;
        if (s.chg.h24 > 60 || (s.br1 > 0.7 && s.chg.h1 > 15)) { side = 'AVOID'; conv = clamp(0.4 + s.chg.h24 / 300, 0, 1); why = `${sg(s.chg.h24)} in 24h to ${usd(s.mc)} mcap with ${pct(s.br1)} buys: late buyers are the exit liquidity`; }
        else if (s.chg.h24 < -35 && s.liq > 300000 && s.chg.h1 >= 0) { side = 'BUY'; conv = clamp(0.35 + (-s.chg.h24 - 35) / 80, 0, 1); why = `down ${sg(s.chg.h24)} to ${usd(s.mc)} mcap and everyone gave up, but liquidity (${usd(s.liq)}) is still there`; }
        else if (consensus && consensus.side === 'BUY' && consensus.count >= 2) { side = 'AVOID'; conv = 0.25; why = `${consensus.count} of you want to buy. In memeland that's usually the top signal`; }
        else why = `no crowd to fade at ${usd(s.mc)} mcap`;
        lines.push(`> contrarian: ${side}`);
        return { side, conv, why, lines };
      },
      say: { BUY: ['Hot take: ${C} is a buy. {why} 😈', 'Everyone hates ${C}? Good. {why}.'], AVOID: ['Devil\'s advocate on ${C}: {why}.', 'I\'ll be the buzzkill on ${C}: {why}.'], WAIT: ['${C}: {why}.', 'Pass on ${C}, {why}.'] } },
  ];
  const BOT = Object.fromEntries(BOTS.map(b => [b.id, b]));
  const REPLY = { agree: ['Agree with {who}: ', '+1 {who}. ', 'Backing {who}: '], disagree: ['Pushback, {who}: ', 'Hard disagree {who}: ', 'Not so fast {who}: '], neutral: ['{who}, from my seat: ', 'FWIW {who}: ', 'Adding context for {who}: '] };
  const fill = (t, m) => t.replace(/\{(\w+)\}/g, (_, k) => m[k] != null ? m[k] : '');

  function evaluateAll(s) {
    const v = {};
    for (const id of ['nova', 'luna', 'echo']) v[id] = BOT[id].analyze(s);
    const B = ['nova', 'luna', 'echo'].filter(i => v[i].side === 'BUY').length;
    v.vex = BOT.vex.analyze(s, B >= 2 ? { side: 'BUY', count: B } : null);
    v.atlas = BOT.atlas.analyze(s);
    return v;
  }
  function message(id, s, view, replyTo) {
    const b = BOT[id]; const key = id === 'atlas' ? view.risk : view.side;
    let txt = fill(pick(b.say[key]).replace(/\$\{C\}/g, '$' + s.sym), { why: view.why });
    if (replyTo) {
      let kind = 'neutral';
      if (id !== 'atlas' && view.side !== 'WAIT' && replyTo.side !== 'WAIT') kind = view.side === replyTo.side ? 'agree' : 'disagree';
      else if (id === 'atlas' && view.risk === 'VETO' && replyTo.side === 'BUY') kind = 'disagree';
      txt = fill(pick(REPLY[kind]), { who: '@' + BOT[replyTo.bot].name }) + (/^[A-Z][a-z]/.test(txt) ? txt[0].toLowerCase() + txt.slice(1) : txt);
    }
    return txt;
  }
  function stops(s) {
    const p = s.price; const d = clamp(Math.max(0.08, 3 * (s.atrPct || 1) / 100), 0.08, 0.25);
    return { stop: p * (1 - d), target: p * (1 + 2 * d), stopPct: d * 100 };
  }
  function buildIdea(t, s, v, now) {
    if (!s.price) return null;
    const dir = ['nova', 'luna', 'echo', 'vex'];
    const B = dir.filter(i => v[i].side === 'BUY'), A = dir.filter(i => v[i].side === 'AVOID');
    if (v.atlas.risk === 'VETO') return null;
    if (!((B.length >= 2 && A.length <= 1) || (B.length === 1 && A.length === 0 && v[B[0]].conv >= 0.65))) return null;
    const st = stops(s); const conv = B.reduce((a, i) => a + v[i].conv, 0) / B.length;
    const score = B.length + conv - A.length * 0.6 - (v.atlas.risk === 'CAUTION' ? 0.6 : 0);
    return {
      id: t.addr + '-' + now, addr: t.addr, pair: t.pair, sym: t.symbol, side: 'BUY', entry: s.price, stop: st.stop, target: st.target, stopPct: st.stopPct,
      confidence: score >= 3 ? 'MEDIUM' : 'LOW', // memes never get HIGH
      risk: s.risk, atlas: v.atlas.risk, created: now,
      agree: B.concat(['atlas']), reasons: B.map(i => ({ bot: i, why: v[i].why })).concat([{ bot: 'atlas', why: v.atlas.why }]),
      dissent: A.map(i => ({ bot: i, why: v[i].why })),
    };
  }
  const pnl = (i, p) => (p / i.entry - 1) * 100;
  const status = (i, p) => p >= i.target ? 'TARGET' : p <= i.stop ? 'STOPPED' : 'OPEN';

  const MemeEngine = { junkReason, toToken, bestPairs, risk, signals, BOTS, BOT, evaluateAll, message, stops, buildIdea, pnl, status, usd, px, age, sg, f1, f2, pct, MIN_LIQ, setRandom(f) { rnd = f; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = MemeEngine; else root.MemeEngine = MemeEngine;
})(typeof window !== 'undefined' ? window : globalThis);
