/* Trading Desk — risk, circuit breakers, journal & stats. Pure functions, no DOM.
 * Works in browser (window.Risk) and Node (module.exports).
 * Concepts (fixed-fractional sizing on current equity, hard limits that config can only tighten,
 * kill-switch style breakers, process-vs-outcome post-trade review) are adapted from
 * galleonlabs/hypergrok-trading-desk (MIT) — skills desk-risk-limits / desk-post-trade-review.
 * Everything here is PAPER ONLY: no orders, no keys. */
(function (root) {
  'use strict';

  // ---------- hard ceilings (code-level; settings can only make these stricter) ----------
  const HARD = Object.freeze({
    riskPerTrade: 0.02,    // max 2% of current equity at risk per trade
    totalOpenRisk: 0.06,   // max 6% of equity at risk across all open positions
    maxLeverage: 3,        // notional / equity
    dailyLoss: 0.05,       // stop new entries after -5% on the day
    maxConsecLosses: 5,    // pause after N losses in a row (at most 5)
    minPauseMin: 15,       // pause lasts at least 15 min
    minDepthUsd: 10000,    // book depth near mid can't be required below this
    maxStaleSec: 30,       // feed silence tolerance can't exceed 30 s
  });
  const DEFAULTS = Object.freeze({
    riskPerTrade: 0.01, totalOpenRisk: 0.04, maxLeverage: 2, dailyLoss: 0.03,
    maxConsecLosses: 3, pauseMin: 30, minDepthUsd: 25000, depthBandPct: 0.5, staleSec: 10,
    feeRate: 0.00045,      // Hyperliquid base taker fee per side (0.045%)
    slippagePct: 0.0005,   // assumed slippage per fill (0.05%)
  });
  const num = (x, d) => (typeof x === 'number' && isFinite(x)) ? x : d;

  // Merge user settings with defaults; anything looser than HARD is clamped back.
  function effectiveLimits(settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    return {
      riskPerTrade: Math.max(0, Math.min(num(s.riskPerTrade, DEFAULTS.riskPerTrade), HARD.riskPerTrade)),
      totalOpenRisk: Math.max(0, Math.min(num(s.totalOpenRisk, DEFAULTS.totalOpenRisk), HARD.totalOpenRisk)),
      maxLeverage: Math.max(0, Math.min(num(s.maxLeverage, DEFAULTS.maxLeverage), HARD.maxLeverage)),
      dailyLoss: Math.max(0, Math.min(num(s.dailyLoss, DEFAULTS.dailyLoss), HARD.dailyLoss)),
      maxConsecLosses: Math.max(1, Math.min(Math.round(num(s.maxConsecLosses, DEFAULTS.maxConsecLosses)), HARD.maxConsecLosses)),
      pauseMin: Math.max(num(s.pauseMin, DEFAULTS.pauseMin), HARD.minPauseMin),
      minDepthUsd: Math.max(num(s.minDepthUsd, DEFAULTS.minDepthUsd), HARD.minDepthUsd),
      depthBandPct: Math.max(0.05, Math.min(num(s.depthBandPct, DEFAULTS.depthBandPct), 2)),
      staleSec: Math.max(1, Math.min(num(s.staleSec, DEFAULTS.staleSec), HARD.maxStaleSec)),
      feeRate: Math.max(num(s.feeRate, DEFAULTS.feeRate), 0),
      slippagePct: Math.max(num(s.slippagePct, DEFAULTS.slippagePct), 0),
    };
  }

  // Worst-case loss per 1 unit if the stop is hit: distance + slippage on both fills + fees on both fills.
  function lossPerUnit(entry, stop, lim) {
    const L = lim || effectiveLimits();
    const dist = Math.abs(entry - stop);
    const slip = (entry + stop) * L.slippagePct;
    const fees = (entry + stop) * L.feeRate;
    return dist + slip + fees;
  }

  // Fixed-fractional sizing on CURRENT equity. Never looks at the last trade's result.
  // opts: { equity, entry, stop, openRiskUsd=0, riskScale=1 (≤1, e.g. ATLAS CAUTION/probation), limits }
  function sizePosition(opts) {
    const L = opts.limits || effectiveLimits();
    const equity = num(opts.equity, 0), entry = num(opts.entry, 0), stop = num(opts.stop, 0);
    const out = { qty: 0, notional: 0, riskUsd: 0, leverage: 0, lossPerUnit: 0, riskPct: 0, cappedBy: null };
    if (!(equity > 0) || !(entry > 0) || !(stop > 0) || entry === stop) { out.cappedBy = 'invalid'; return out; }
    const scale = Math.max(0, Math.min(num(opts.riskScale, 1), 1));
    const lpu = lossPerUnit(entry, stop, L); out.lossPerUnit = lpu;
    let budget = equity * L.riskPerTrade * scale;
    const room = equity * L.totalOpenRisk - Math.max(0, num(opts.openRiskUsd, 0));
    if (room < budget) { budget = Math.max(0, room); out.cappedBy = 'totalOpenRisk'; }
    let qty = budget / lpu;
    const maxQty = equity * L.maxLeverage / entry;
    if (qty > maxQty) { qty = maxQty; out.cappedBy = 'maxLeverage'; }
    out.qty = qty; out.notional = qty * entry; out.riskUsd = qty * lpu;
    out.leverage = out.notional / equity; out.riskPct = out.riskUsd / equity;
    return out;
  }

  // ---------- circuit breakers ----------
  const dayKey = t => new Date(t).toISOString().slice(0, 10); // UTC day
  function trailingLosses(trades) { // trades oldest→newest
    let n = 0; for (let i = trades.length - 1; i >= 0; i--) { if (trades[i].r < 0) n++; else break; } return n;
  }
  // Book depth (USD notional) within band% of mid, per side. levels = [[{px,sz}...bids],[...asks]] (Hyperliquid l2Book shape)
  function bookDepth(levels, bandPct) {
    if (!levels || !levels[0] || !levels[1] || !levels[0].length || !levels[1].length) return null;
    const bb = +levels[0][0].px, ba = +levels[1][0].px, mid = (bb + ba) / 2, band = mid * (bandPct || DEFAULTS.depthBandPct) / 100;
    let bid = 0, ask = 0;
    for (const l of levels[0]) if (mid - +l.px <= band) bid += +l.px * +l.sz;
    for (const l of levels[1]) if (+l.px - mid <= band) ask += +l.px * +l.sz;
    return { bidUsd: bid, askUsd: ask, minUsd: Math.min(bid, ask), mid, spreadPct: (ba - bb) / mid * 100 };
  }

  // ctx: { now, equity, dayStartEquity, trades:[{closedAt,r}] (this bot, oldest→newest),
  //        lastFeedTs, depth:{minUsd}|null, limits }
  // Returns { allowed, fired:[ids], rules:[{id,label,status:'OK'|'TRIP'|'WAIT',detail}] }
  function checkBreakers(ctx) {
    const L = ctx.limits || effectiveLimits(); const now = num(ctx.now, Date.now());
    const rules = [];
    // 1) daily loss cap
    const eq = num(ctx.equity, 0), start = num(ctx.dayStartEquity, eq);
    const dd = start > 0 ? (start - eq) / start : 0;
    rules.push({ id: 'DAILY_LOSS', label: 'Daily loss cap', status: dd >= L.dailyLoss ? 'TRIP' : 'OK',
      detail: `day ${dd > 0 ? '-' : '+'}${(Math.abs(dd) * 100).toFixed(2)}% / limit -${(L.dailyLoss * 100).toFixed(1)}%` });
    // 2) consecutive losses → timed pause
    const tr = ctx.trades || []; const streak = trailingLosses(tr); const last = tr[tr.length - 1];
    const until = last ? last.closedAt + L.pauseMin * 60e3 : 0;
    const paused = streak >= L.maxConsecLosses && now < until;
    rules.push({ id: 'LOSS_STREAK', label: 'Loss streak pause', status: paused ? 'TRIP' : 'OK',
      detail: paused ? `${streak} losses in a row · resumes in ${Math.ceil((until - now) / 60e3)}m` : `${streak}/${L.maxConsecLosses} losses in a row`, until: paused ? until : null });
    // 3) liquidity near mid
    const d = ctx.depth;
    rules.push({ id: 'LIQUIDITY', label: 'Book depth near mid', status: !d ? 'WAIT' : d.minUsd < L.minDepthUsd ? 'TRIP' : 'OK',
      detail: !d ? 'no book data yet' : `thin side $${Math.round(d.minUsd).toLocaleString('en-US')} within ±${L.depthBandPct}% / min $${L.minDepthUsd.toLocaleString('en-US')}` });
    // 4) stale feed
    const age = ctx.lastFeedTs ? (now - ctx.lastFeedTs) / 1000 : Infinity;
    rules.push({ id: 'STALE_FEED', label: 'Live feed fresh', status: age > L.staleSec ? 'TRIP' : 'OK',
      detail: isFinite(age) ? `last WS data ${age.toFixed(1)}s ago / max ${L.staleSec}s` : 'no WS data yet' });
    const fired = rules.filter(r => r.status !== 'OK').map(r => r.id); // WAIT (no data) also blocks
    return { allowed: fired.length === 0, fired, rules };
  }

  // ---------- post-trade review ----------
  // t: { side, entry, exit, stop, target, qty, riskUsd, fees, slippageUsd, reason:'target'|'stop'|'time'|'flip', atlas:'OK'|'CAUTION', sizedOk }
  function reviewTrade(t) {
    const dir = t.side === 'LONG' ? 1 : -1;
    const gross = (t.exit - t.entry) * dir * t.qty;
    const pnl = gross - (t.fees || 0);
    const r = t.riskUsd > 0 ? pnl / t.riskUsd : 0;
    // process: did we follow the plan? (independent of P&L)
    let pts = 0; const notes = [];
    if (t.sizedOk !== false) pts++; else notes.push('size outside limits');
    if (t.atlas === 'OK') pts++; else notes.push('entered on ATLAS CAUTION');
    if (t.reason === 'target' || t.reason === 'stop') pts++; else notes.push(t.reason === 'flip' ? 'exited early on signal flip' : 'plan timed out');
    if (r >= -1.15) pts++; else notes.push('loss beyond 1R (slippage/gap)');
    const process = pts >= 4 ? 'A' : pts === 3 ? 'B' : pts === 2 ? 'C' : 'D';
    const outcome = r >= 1.5 ? 'A' : r >= 0.25 ? 'B' : r > -0.5 ? 'C' : 'D';
    let lesson;
    const good = process <= 'B', won = r > 0;
    if (good && won) lesson = `Plan worked (${r.toFixed(2)}R). Repeat this setup, same size.`;
    else if (good && !won) lesson = `Good process, ${r.toFixed(2)}R loss is normal variance — keep the rules, don't widen stops.`;
    else if (!good && won) lesson = `Won ${r.toFixed(2)}R despite: ${notes.join(', ')}. Luck, not edge — don't repeat.`;
    else lesson = `Lost ${r.toFixed(2)}R with: ${notes.join(', ')}. Fix the process first.`;
    return { pnl, gross, r, process, outcome, notes, lesson };
  }

  // ---------- stats ----------
  function stats(trades) {
    const n = trades.length; if (!n) return { n: 0, winRate: null, avgR: null, expectancy: null, pf: null, pnl: 0, recentExp: null };
    const w = trades.filter(t => t.r > 0), l = trades.filter(t => t.r <= 0);
    const avgW = w.length ? w.reduce((a, t) => a + t.r, 0) / w.length : 0;
    const avgL = l.length ? -l.reduce((a, t) => a + t.r, 0) / l.length : 0;
    const winRate = w.length / n;
    const gw = w.reduce((a, t) => a + (t.pnl || 0), 0), gl = -l.reduce((a, t) => a + (t.pnl || 0), 0);
    const recent = trades.slice(-20);
    return {
      n, winRate, avgR: trades.reduce((a, t) => a + t.r, 0) / n,
      expectancy: winRate * avgW - (1 - winRate) * avgL,
      pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null),
      pnl: trades.reduce((a, t) => a + (t.pnl || 0), 0),
      recentExp: recent.reduce((a, t) => a + t.r, 0) / recent.length,
    };
  }
  // "Learning": a bot whose last-20 expectancy is negative trades at half risk until it recovers. Only ever reduces risk.
  function riskScaleFor(trades) {
    if (trades.length < 10) return 1;
    const s = stats(trades.slice(-20));
    return s.expectancy < 0 ? 0.5 : 1;
  }

  // TD-YYYYMMDD-NN (UTC date); stocks desk uses prefix 'TS'
  function ticketId(now, n, prefix) { return (prefix || 'TD') + '-' + dayKey(now).replace(/-/g, '') + '-' + String(n).padStart(2, '0'); }

  const Risk = { HARD, DEFAULTS, effectiveLimits, lossPerUnit, sizePosition, bookDepth, checkBreakers, trailingLosses, reviewTrade, stats, riskScaleFor, ticketId, dayKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = Risk; else root.Risk = Risk;
})(typeof window !== 'undefined' ? window : globalThis);
