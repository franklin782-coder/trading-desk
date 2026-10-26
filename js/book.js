/* Paper book: open / scan / close positions, tickets, trimming. Pure, no DOM, no network.
 * Used by the headless engine (engine/run.js, GitHub Actions) — the single source of truth —
 * and loadable in the browser (window.Book) for display helpers. PAPER ONLY. */
(function (root) {
  'use strict';
  const R = (typeof module !== 'undefined' && module.exports) ? require('./risk.js') : root.Risk;
  const TRADERS = ['nova', 'luna', 'echo', 'vex'];
  const PREFIX = { crypto: 'TD', stocks: 'TS' };
  const CAPS = { journal: 1000, curve: 400, ideas: 30, vetoes: 40, chat: 80, log: 120 };
  const MAX_OPEN_PER_BOT = 2, TIME_STOP_MS = 4 * 3600e3; // server runs every ~5–15 min, so the browser's 15-min time stop is too short

  function newMarket(market, now) {
    const start = R.bookStart(market), accts = {};
    TRADERS.forEach(id => accts[id] = { equity: start, start, day: R.dayKey(now), dayStart: start, curve: [[now, start]] });
    return { market, accts, open: [], journal: [], ideas: [], vetoes: [], ticketDay: '', ticketN: 0 };
  }
  function newState(now) {
    return { version: 1, startedAt: now, lastRun: null, runs: 0, note: 'Clean reset at launch: start of the 2-week paper learning period.',
      markets: { crypto: newMarket('crypto', now), stocks: newMarket('stocks', now) }, chat: [], log: [] };
  }
  function nextTicket(mk, now) {
    const k = R.dayKey(now); if (mk.ticketDay !== k) { mk.ticketDay = k; mk.ticketN = 0; }
    mk.ticketN++; return R.ticketId(now, mk.ticketN, PREFIX[mk.market]);
  }
  function rollDay(a, now) { const k = R.dayKey(now); if (a.day !== k) { a.day = k; a.dayStart = a.equity; } }
  const upnl = (p, px) => px ? (px - p.entry) * (p.side === 'LONG' ? 1 : -1) * p.qty : 0;
  function equityNow(mk, bot, prices) { return mk.accts[bot].equity + mk.open.filter(p => p.bot === bot).reduce((a, p) => a + upnl(p, prices && prices[p.coin]), 0); }
  const botTrades = (mk, bot) => mk.journal.filter(j => j.bot === bot);

  // o: { bot, coin, side, mid, stop, target, atlas:'OK'|'CAUTION', why, conv, spreadPct, depth, lastFeedTs, now, limits, prices }
  // returns { pos } | { veto:{rules, why} } | { skip }
  function openPosition(mk, o) {
    const L = o.limits || R.effectiveLimits(), now = o.now, a = mk.accts[o.bot];
    if (mk.open.some(p => p.bot === o.bot && p.coin === o.coin)) return { skip: 'already in' };
    if (mk.open.filter(p => p.bot === o.bot).length >= MAX_OPEN_PER_BOT) return { skip: 'max open' };
    rollDay(a, now);
    const trades = botTrades(mk, o.bot);
    const br = R.checkBreakers({ now, equity: equityNow(mk, o.bot, o.prices), dayStartEquity: a.dayStart, trades: trades.map(j => ({ closedAt: j.closedAt, r: j.r })), lastFeedTs: o.lastFeedTs, depth: o.depth, limits: L });
    if (!br.allowed) return { veto: { rules: br.fired, why: br.rules.filter(r => r.status !== 'OK').map(r => r.detail).join('; ') } };
    const dir = o.side === 'LONG' ? 1 : -1, half = o.spreadPct ? o.spreadPct / 200 : 0;
    const entry = o.mid * (1 + dir * (L.slippagePct + half));
    const scale = (o.atlas === 'CAUTION' ? 0.5 : 1) * R.riskScaleFor(trades);
    const openRisk = mk.open.filter(p => p.bot === o.bot).reduce((s, p) => s + p.riskUsd, 0);
    const sz = R.sizePosition({ equity: equityNow(mk, o.bot, o.prices), entry, stop: o.stop, openRiskUsd: openRisk, riskScale: scale, limits: L });
    if (!(sz.qty > 0)) return { veto: { rules: ['TOTAL_OPEN_RISK'], why: 'no risk budget left' } };
    const pos = { ticket: nextTicket(mk, now), market: mk.market, bot: o.bot, coin: o.coin, side: o.side, entry, mid0: o.mid, stop: o.stop, target: o.target,
      qty: sz.qty, notional: sz.notional, riskUsd: sz.riskUsd, riskPct: sz.riskPct, lev: sz.leverage, cappedBy: sz.cappedBy, scale, atlas: o.atlas,
      why: o.why, conv: o.conv, fees: sz.notional * L.feeRate, opened: now, mark: o.mid, review: o.review || null };
    mk.open.push(pos); return { pos };
  }

  // First 1m candle (time = open ms) after `fromMs` whose range touches stop or target. Same candle → stop (conservative).
  function scanExit(p, candles, fromMs) {
    const L = p.side === 'LONG';
    for (const c of candles || []) {
      if (c.t + 60e3 <= fromMs) continue; // fully before the window
      const hitStop = L ? c.l <= p.stop : c.h >= p.stop, hitTgt = L ? c.h >= p.target : c.l <= p.target;
      if (hitStop) return { reason: 'stop', price: p.stop, time: Math.max(c.t, fromMs) };
      if (hitTgt) return { reason: 'target', price: p.target, time: Math.max(c.t, fromMs) };
    }
    return null;
  }

  // exitMid = price before slippage (stop/target level or current mid)
  function closePosition(mk, p, exitMid, reason, now, limits, spreadPct) {
    const L = limits || R.effectiveLimits();
    const dir = p.side === 'LONG' ? 1 : -1, half = spreadPct ? spreadPct / 200 : 0;
    const exit = exitMid * (1 - dir * (L.slippagePct + half));
    const fees = p.fees + p.qty * exit * L.feeRate;
    const slippageUsd = p.qty * (Math.abs(p.entry - p.mid0) + Math.abs(exitMid - exit));
    const rv = R.reviewTrade({ side: p.side, entry: p.entry, exit, stop: p.stop, target: p.target, qty: p.qty, riskUsd: p.riskUsd, fees, reason, atlas: p.atlas, sizedOk: p.riskPct <= R.HARD.riskPerTrade + 1e-9 });
    const i = mk.open.indexOf(p); if (i >= 0) mk.open.splice(i, 1);
    const a = mk.accts[p.bot]; a.equity += rv.pnl;
    const j = { n: (mk.journal.length ? mk.journal[mk.journal.length - 1].n : 0) + 1, market: mk.market, bot: p.bot, coin: p.coin, side: p.side, ticket: p.ticket,
      openedAt: p.opened, closedAt: now, entry: p.entry, exit, stop: p.stop, target: p.target, qty: p.qty, notional: p.notional,
      riskUsd: p.riskUsd, riskPct: p.riskPct, atlas: p.atlas, scale: p.scale, reason, fees, slippageUsd, pnl: rv.pnl, pct: rv.pnl / p.notional * 100, r: rv.r,
      process: rv.process, outcome: rv.outcome, lesson: rv.lesson, why: p.why, equityAfter: a.equity };
    mk.journal.push(j); return j;
  }

  function pushCapped(arr, x, cap) { arr.push(x); if (arr.length > cap) arr.splice(0, arr.length - cap); }
  function trim(state) {
    for (const mk of Object.values(state.markets)) {
      if (mk.journal.length > CAPS.journal) mk.journal.splice(0, mk.journal.length - CAPS.journal);
      if (mk.ideas.length > CAPS.ideas) mk.ideas.splice(0, mk.ideas.length - CAPS.ideas);
      if (mk.vetoes.length > CAPS.vetoes) mk.vetoes.splice(0, mk.vetoes.length - CAPS.vetoes);
      Object.values(mk.accts).forEach(a => { if (a.curve.length > CAPS.curve) a.curve.splice(0, a.curve.length - CAPS.curve); });
    }
    if (state.chat.length > CAPS.chat) state.chat.splice(0, state.chat.length - CAPS.chat);
    if (state.log.length > CAPS.log) state.log.splice(0, state.log.length - CAPS.log);
    return state;
  }

  const Book = { TRADERS, PREFIX, CAPS, MAX_OPEN_PER_BOT, TIME_STOP_MS, newState, newMarket, nextTicket, equityNow, upnl, openPosition, scanExit, closePosition, pushCapped, trim, rollDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = Book; else root.Book = Book;
})(typeof window !== 'undefined' ? window : globalThis);
