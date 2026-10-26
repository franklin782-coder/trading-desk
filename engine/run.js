#!/usr/bin/env node
/* Headless desk engine: one run = fetch Hyperliquid data, manage open paper positions (scan 1m candles since the last
 * run for stop/target hits), let the five bots evaluate every market, ATLAS vetoes / circuit breakers, open paper
 * positions, publish desk ideas, write journal + lessons. State = one JSON file (data branch). PAPER ONLY, no keys.
 * Usage: node engine/run.js <state.json>   (env DRY=1 → don't write) */
'use strict';
const fs = require('fs');
const E = require('../js/engine.js');
const R = require('../js/risk.js');
const B = require('../js/book.js');
const H = require('./hooks.js');

const API = 'https://api.hyperliquid.xyz/info';
const MARKETS = {
  crypto: { dex: '', majors: ['BTC', 'ETH', 'SOL', 'BNB'], dynamicTop: 6 },
  stocks: { dex: 'xyz', majors: ['NVDA', 'AMZN', 'GOOGL', 'AMD', 'AVGO', 'MU', 'TSLA', 'MSFT', 'META', 'CRWV', 'IREN', 'PLTR', 'COIN', 'ANT', 'SP500', 'XYZ100'], dynamicTop: 0 },
};
const LOOKBACK_MS = 240 * 60e3, MAX_GAP_MS = 6 * 3600e3, CURVE_EVERY_MS = 20 * 60e3, IDEA_COOLDOWN_MS = 60 * 60e3;

async function post(body, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json();
    } catch (e) { if (i >= tries - 1) throw e; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
}
const W = (m, c) => (MARKETS[m].dex ? MARKETS[m].dex + ':' : '') + c;
const S = (m, n) => { const p = MARKETS[m].dex ? MARKETS[m].dex + ':' : ''; return p && n.startsWith(p) ? n.slice(p.length) : n; };

async function loadMarket(m, since) {
  const cfg = MARKETS[m];
  const [meta, ctxs] = await post(Object.assign({ type: 'metaAndAssetCtxs' }, cfg.dex ? { dex: cfg.dex } : {}));
  const uni = meta.universe.map((u, i) => ({ name: S(m, u.name), delisted: !!u.isDelisted, ctx: ctxs[i] || {} })).filter(u => !u.delisted);
  const coins = cfg.majors.filter(c => uni.some(u => u.name === c));
  coins.push(...R.pickTopByVolume(uni.map(u => ({ name: u.name, vol: +u.ctx.dayNtlVlm || 0 })), coins, cfg.dynamicTop));
  return { uni, coins, since };
}
async function candles(m, coin, startMs) {
  const j = await post({ type: 'candleSnapshot', req: { coin: W(m, coin), interval: '1m', startTime: startMs } });
  return j.map(k => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
}
async function depth(m, coin, band) {
  try { const b = await post({ type: 'l2Book', coin: W(m, coin) }); const d = R.bookDepth(b.levels, band); return d; } catch (e) { return null; }
}

function say(state, now, bot, market, coin, text, kind) { B.pushCapped(state.chat, { t: now, bot, market, coin, text, kind: kind || 'msg' }, B.CAPS.chat); }
function logl(state, now, k, text) { B.pushCapped(state.log, { t: now, k, text }, B.CAPS.log); }

async function runMarket(state, m, now, limits) {
  const mk = state.markets[m];
  const from = Math.max(now - MAX_GAP_MS, Math.min(state.lastRun || now - LOOKBACK_MS, now - LOOKBACK_MS));
  const { uni, coins } = await loadMarket(m);
  const want = [...new Set(coins.concat(mk.open.map(p => p.coin)))];
  const data = {};
  for (const c of want) {
    try {
      const k = await candles(m, c, from);
      const u = uni.find(x => x.name === c) || { ctx: {} };
      const mid = +u.ctx.midPx || +u.ctx.markPx || (k.length ? k[k.length - 1].c : 0);
      data[c] = { k, ctx: u.ctx, mid };
    } catch (e) { logl(state, now, 'ERR', `${m} ${c}: ${e.message}`); }
  }
  const prices = {}; Object.entries(data).forEach(([c, d]) => prices[c] = d.mid);

  // 1) manage open positions: candle scan since last run, then time stop
  const scanFrom = state.lastRun || now - 10 * 60e3;
  for (const p of mk.open.slice()) {
    const d = data[p.coin]; if (!d || !d.mid) continue;
    const hit = B.scanExit(p, d.k, Math.max(p.opened, scanFrom));
    let j = null;
    if (hit) j = B.closePosition(mk, p, hit.price, hit.reason, hit.time, limits);
    else if (now - p.opened > B.TIME_STOP_MS) j = B.closePosition(mk, p, d.mid, 'time', now, limits);
    else p.mark = d.mid;
    if (j) { say(state, now, j.bot, m, j.coin, `closed ${j.ticket} ${j.side} ${j.coin} ${j.r >= 0 ? '+' : ''}${j.r.toFixed(2)}R ($${j.pnl.toFixed(2)}, ${j.reason}) · ${j.lesson}`, 'close'); logl(state, now, 'CLOSE', `${j.ticket} ${j.bot} ${j.coin} ${j.reason} ${j.pnl.toFixed(2)}`); }
  }

  // 2) evaluate every market, bots open positions
  let opened = 0;
  for (const c of coins) {
    const d = data[c]; if (!d || d.k.length < 30 || !d.mid) continue;
    const st = { coin: c, candles: d.k.slice(-240).map(x => ({ time: x.t / 1000, open: x.o, high: x.h, low: x.l, close: x.c, volume: x.v })), secs: [], ctx: d.ctx, price: d.mid };
    const sig = E.computeSignals(st); if (!sig.ready) continue;
    const views = E.evaluateAll(sig);
    let dep = null;
    for (const id of B.TRADERS) {
      const v = views[id];
      const ex = mk.open.find(p => p.bot === id && p.coin === c);
      if (ex && v.side !== 'FLAT' && v.side !== ex.side) { const j = B.closePosition(mk, ex, d.mid, 'flip', now, limits); say(state, now, id, m, c, `flip: closed ${j.ticket} ${j.coin} ${j.r.toFixed(2)}R · ${j.lesson}`, 'close'); }
      if (v.side === 'FLAT' || v.conv < 0.5) continue;
      if (mk.open.some(p => p.bot === id && p.coin === c)) continue;
      if (views.atlas.risk === 'VETO') { B.pushCapped(mk.vetoes, { t: now, who: id, coin: c, rules: [views.atlas.rule || 'VOLATILITY'], why: views.atlas.why }, B.CAPS.vetoes); continue; }
      if (dep === null) dep = (await depth(m, c, limits.depthBandPct)) || false;
      const stp = E.stopsFor(sig, v.side);
      const review = await H.reviewIdea({ bot: id, market: m, coin: c, side: v.side, sig, views, stop: stp.stop, target: stp.target });
      if (!review.approve) { B.pushCapped(mk.vetoes, { t: now, who: id, coin: c, rules: ['REVIEW'], why: review.note || 'reviewer rejected' }, B.CAPS.vetoes); continue; }
      const res = B.openPosition(mk, { bot: id, coin: c, side: v.side, mid: d.mid, stop: stp.stop, target: stp.target, atlas: views.atlas.risk, why: v.why, conv: v.conv,
        spreadPct: dep ? dep.spreadPct : 0, depth: dep || null, lastFeedTs: now, now, limits, prices, review: review.reviewer === 'none' ? null : review });
      if (res.veto) B.pushCapped(mk.vetoes, { t: now, who: id, coin: c, rules: res.veto.rules, why: res.veto.why }, B.CAPS.vetoes);
      if (res.pos) { opened++; const p = res.pos; say(state, now, id, m, c, `${p.ticket}: paper ${p.side} ${c} @ ${E.fmtPx(p.entry)} stop ${E.fmtPx(p.stop)} target ${E.fmtPx(p.target)} · ${(p.riskPct * 100).toFixed(2)}% risk · ${v.why}`, 'open'); logl(state, now, 'OPEN', `${p.ticket} ${id} ${p.side} ${c}`); }
    }
    // desk idea (consensus), one per coin per hour
    const idea = E.buildIdea(sig, views, now);
    if (idea && dep === null) dep = (await depth(m, c, limits.depthBandPct)) || false;
    const ideaLiq = !dep || dep.minUsd < limits.minDepthUsd;
    if (idea && ideaLiq && !mk.ideas.some(i => i.coin === c && now - i.created < IDEA_COOLDOWN_MS)) { B.pushCapped(mk.vetoes, { t: now, who: 'desk idea', coin: c, rules: ['LIQUIDITY'], why: dep ? `thin side $${Math.round(dep.minUsd)}` : 'no book' }, B.CAPS.vetoes); }
    else if (idea && !mk.ideas.some(i => i.coin === c && now - i.created < IDEA_COOLDOWN_MS)) {
      idea.ticket = B.nextTicket(mk, now); idea.market = m; idea.size = R.sizePosition({ equity: R.bookStart(m), entry: idea.entry, stop: idea.stop, riskScale: idea.risk === 'CAUTION' ? 0.5 : 1, limits });
      mk.ideas.push(idea);
      say(state, now, idea.agree[0], m, c, `📌 ${idea.ticket}: desk idea ${idea.side} ${c} @ ${E.fmtPx(idea.entry)} stop ${E.fmtPx(idea.stop)} target ${E.fmtPx(idea.target)} · ${idea.confidence} · agreed ${idea.agree.join(', ')}`, 'idea');
    } else if (views.atlas.risk === 'VETO' && Math.random() < 0.15) say(state, now, 'atlas', m, c, E.message('atlas', sig, views.atlas), 'msg');
  }

  // 3) equity curve (mark-to-market), bounded
  for (const id of B.TRADERS) {
    const a = mk.accts[id]; B.rollDay(a, now);
    const last = a.curve[a.curve.length - 1];
    if (!last || now - last[0] >= CURVE_EVERY_MS) a.curve.push([now, +B.equityNow(mk, id, prices).toFixed(2)]);
  }
  mk.prices = prices; mk.coins = coins;
  return { coins: coins.length, opened, open: mk.open.length };
}

async function main() {
  const file = process.argv[2] || 'desk.json';
  const now = Date.now();
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : B.newState(now);
  const limits = R.effectiveLimits();
  const summary = {};
  for (const m of Object.keys(MARKETS)) {
    try { summary[m] = await runMarket(state, m, now, limits); } catch (e) { summary[m] = { error: e.message }; logl(state, now, 'ERR', `${m}: ${e.message}`); }
  }
  state.lastRun = now; state.runs = (state.runs || 0) + 1; state.lastSummary = summary;
  B.trim(state);
  if (!process.env.DRY) fs.writeFileSync(file, JSON.stringify(state));
  console.log(new Date(now).toISOString(), JSON.stringify(summary));
  if (Object.values(summary).every(s => s.error)) process.exit(1);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { runMarket, MARKETS };
