// Run: node tests/risk.test.js
const assert = require('assert');
const R = require('../js/risk.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const L0 = R.effectiveLimits({ feeRate: 0, slippagePct: 0 });

console.log('sizing');
t('1% of current equity / stop distance (no fees)', () => {
  const s = R.sizePosition({ equity: 10000, entry: 100, stop: 98, limits: L0 });
  near(s.riskUsd, 100); near(s.qty, 50); near(s.riskPct, 0.01);
});
t('fees + slippage shrink size so worst-case loss stays 1%', () => {
  const L = R.effectiveLimits();
  const s = R.sizePosition({ equity: 10000, entry: 100, stop: 98, limits: L });
  near(s.lossPerUnit, 2 + 198 * (L.feeRate + L.slippagePct));
  assert.ok(s.qty < 50); near(s.riskUsd, 100);
});
t('size follows current equity, not last trade', () => {
  const a = R.sizePosition({ equity: 8000, entry: 100, stop: 99, limits: L0 });
  near(a.riskUsd, 80);
});
t('settings cannot loosen hard ceilings', () => {
  const L = R.effectiveLimits({ riskPerTrade: 0.5, totalOpenRisk: 1, maxLeverage: 50, dailyLoss: 0.9, maxConsecLosses: 99, minDepthUsd: 1, staleSec: 999, pauseMin: 0 });
  assert.equal(L.riskPerTrade, R.HARD.riskPerTrade); assert.equal(L.totalOpenRisk, R.HARD.totalOpenRisk);
  assert.equal(L.maxLeverage, R.HARD.maxLeverage); assert.equal(L.dailyLoss, R.HARD.dailyLoss);
  assert.equal(L.maxConsecLosses, R.HARD.maxConsecLosses); assert.equal(L.minDepthUsd, R.HARD.minDepthUsd);
  assert.equal(L.staleSec, R.HARD.maxStaleSec); assert.equal(L.pauseMin, R.HARD.minPauseMin);
});
t('settings can tighten', () => { assert.equal(R.effectiveLimits({ riskPerTrade: 0.005 }).riskPerTrade, 0.005); });
t('leverage cap', () => {
  const s = R.sizePosition({ equity: 10000, entry: 100, stop: 99.99, limits: L0 });
  assert.equal(s.cappedBy, 'maxLeverage'); near(s.leverage, L0.maxLeverage);
});
t('total open risk cap', () => {
  const s = R.sizePosition({ equity: 10000, entry: 100, stop: 98, openRiskUsd: 350, limits: L0 });
  assert.equal(s.cappedBy, 'totalOpenRisk'); near(s.riskUsd, 50);
  const z = R.sizePosition({ equity: 10000, entry: 100, stop: 98, openRiskUsd: 500, limits: L0 }); assert.equal(z.qty, 0);
});
t('riskScale halves, never increases', () => {
  near(R.sizePosition({ equity: 10000, entry: 100, stop: 98, riskScale: 0.5, limits: L0 }).riskUsd, 50);
  near(R.sizePosition({ equity: 10000, entry: 100, stop: 98, riskScale: 5, limits: L0 }).riskUsd, 100);
});
t('invalid inputs → zero size', () => {
  assert.equal(R.sizePosition({ equity: 0, entry: 100, stop: 98 }).qty, 0);
  assert.equal(R.sizePosition({ equity: 1e4, entry: 100, stop: 100 }).qty, 0);
});

console.log('breakers');
const now = Date.UTC(2026, 9, 26, 12);
const base = { now, equity: 10000, dayStartEquity: 10000, trades: [], lastFeedTs: now - 1000, depth: { minUsd: 1e6 }, limits: R.effectiveLimits() };
t('all clear → allowed', () => { const b = R.checkBreakers(base); assert.ok(b.allowed, b.fired.join()); });
t('daily loss cap trips', () => {
  const b = R.checkBreakers({ ...base, equity: 9690 }); assert.ok(!b.allowed); assert.deepEqual(b.fired, ['DAILY_LOSS']);
  assert.ok(R.checkBreakers({ ...base, equity: 9750 }).allowed);
});
t('loss streak pauses, then resumes', () => {
  const tr = [{ closedAt: now - 9e5, r: 1 }, { closedAt: now - 6e5, r: -1 }, { closedAt: now - 3e5, r: -1 }, { closedAt: now - 6e4, r: -1 }];
  const b = R.checkBreakers({ ...base, trades: tr }); assert.deepEqual(b.fired, ['LOSS_STREAK']);
  assert.ok(R.checkBreakers({ ...base, trades: tr, now: now + 31 * 60e3, lastFeedTs: now + 31 * 60e3 }).allowed);
  assert.ok(R.checkBreakers({ ...base, trades: tr.slice(0, 3) }).allowed);
});
t('liquidity drop trips; missing book blocks', () => {
  assert.deepEqual(R.checkBreakers({ ...base, depth: { minUsd: 5000 } }).fired, ['LIQUIDITY']);
  assert.deepEqual(R.checkBreakers({ ...base, depth: null }).fired, ['LIQUIDITY']);
});
t('bookDepth sums within band', () => {
  const d = R.bookDepth([[{ px: '99.9', sz: '100' }, { px: '90', sz: '1000' }], [{ px: '100.1', sz: '50' }]], 0.5);
  near(d.bidUsd, 9990); near(d.askUsd, 5005); near(d.minUsd, 5005);
  assert.equal(R.bookDepth([[], []]), null);
});
t('stale feed trips', () => {
  assert.deepEqual(R.checkBreakers({ ...base, lastFeedTs: now - 15000 }).fired, ['STALE_FEED']);
  assert.deepEqual(R.checkBreakers({ ...base, lastFeedTs: 0 }).fired, ['STALE_FEED']);
});

console.log('journal & stats');
t('review: R, process vs outcome grades', () => {
  const win = R.reviewTrade({ side: 'LONG', entry: 100, exit: 104, stop: 98, qty: 50, riskUsd: 100, fees: 0, reason: 'target', atlas: 'OK' });
  near(win.r, 2); assert.equal(win.process, 'A'); assert.equal(win.outcome, 'A');
  const loss = R.reviewTrade({ side: 'SHORT', entry: 100, exit: 102, stop: 102, qty: 50, riskUsd: 100, fees: 0, reason: 'stop', atlas: 'OK' });
  near(loss.r, -1); assert.equal(loss.process, 'A'); assert.equal(loss.outcome, 'D'); assert.ok(loss.lesson.includes('variance'));
  const lucky = R.reviewTrade({ side: 'LONG', entry: 100, exit: 101, stop: 98, qty: 50, riskUsd: 100, fees: 0, reason: 'flip', atlas: 'CAUTION' });
  assert.equal(lucky.process, 'C'); assert.ok(lucky.lesson.includes('Luck'));
});
t('stats: win rate, avg R, expectancy', () => {
  const s = R.stats([{ r: 2, pnl: 200 }, { r: -1, pnl: -100 }, { r: -1, pnl: -100 }, { r: 2, pnl: 200 }]);
  near(s.winRate, 0.5); near(s.avgR, 0.5); near(s.expectancy, 0.5); near(s.pf, 2);
});
t('probation halves risk on negative recent expectancy', () => {
  assert.equal(R.riskScaleFor(Array(12).fill({ r: -1 })), 0.5);
  assert.equal(R.riskScaleFor(Array(12).fill({ r: 1 })), 1);
  assert.equal(R.riskScaleFor(Array(3).fill({ r: -1 })), 1);
});
t('ticket id TD-YYYYMMDD-NN', () => { assert.equal(R.ticketId(now, 7), 'TD-20261026-07'); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
