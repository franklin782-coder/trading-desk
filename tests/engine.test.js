// Run: node tests/engine.test.js — headless engine book logic (js/book.js), no network
const assert = require('assert');
const R = require('../js/risk.js');
const B = require('../js/book.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const NOW = Date.UTC(2026, 9, 26, 12);
const L0 = R.effectiveLimits({ feeRate: 0, slippagePct: 0 });
const depth = { minUsd: 1e6, spreadPct: 0 };
const open = (mk, o) => B.openPosition(mk, Object.assign({ bot: 'nova', coin: 'BTC', side: 'LONG', mid: 100, stop: 98, target: 104, atlas: 'OK', depth, lastFeedTs: NOW, now: NOW, limits: L0 }, o));

console.log('state & sizing');
t('fresh state: $8k crypto / $2k stocks per trading bot', () => { const s = B.newState(NOW); B.TRADERS.forEach(id => { assert.equal(s.markets.crypto.accts[id].equity, 8000); assert.equal(s.markets.stocks.accts[id].equity, 2000); }); assert.equal(s.startedAt, NOW); });
t('crypto position risks 1% of the $8k book', () => { const s = B.newState(NOW); const r = open(s.markets.crypto, {}); near(r.pos.riskUsd, 80); near(r.pos.qty, 40); assert.equal(r.pos.ticket, 'TD-20261026-01'); });
t('stocks position risks 1% of the $2k book, TS ticket', () => { const s = B.newState(NOW); const r = open(s.markets.stocks, { coin: 'NVDA' }); near(r.pos.riskUsd, 20); assert.equal(r.pos.ticket, 'TS-20261026-01'); });
t('one position per bot per coin, max 2 per bot', () => { const s = B.newState(NOW), mk = s.markets.crypto; open(mk, {}); assert.ok(open(mk, {}).skip); open(mk, { coin: 'ETH' }); assert.ok(open(mk, { coin: 'SOL' }).skip); });
t('thin book → ATLAS LIQUIDITY veto', () => { const s = B.newState(NOW); const r = open(s.markets.crypto, { depth: { minUsd: 100 } }); assert.ok(r.veto && r.veto.rules.includes('LIQUIDITY')); });
t('daily loss breaker blocks entries', () => { const s = B.newState(NOW), mk = s.markets.crypto; mk.accts.nova.equity = 7000; mk.accts.nova.day = R.dayKey(NOW); const r = open(mk, {}); assert.ok(r.veto.rules.includes('DAILY_LOSS')); });

console.log('candle scan (stops/targets hit between runs)');
const P = { side: 'LONG', stop: 98, target: 104 };
const k = (t, o, h, l, c) => ({ t: NOW + t * 60e3, o, h, l, c, v: 1 });
t('target touched in a later candle', () => { const h = B.scanExit(P, [k(0, 100, 101, 99, 100), k(1, 100, 104.5, 100, 104)], NOW); assert.equal(h.reason, 'target'); assert.equal(h.price, 104); assert.equal(h.time, NOW + 60e3); });
t('stop before target wins', () => { const h = B.scanExit(P, [k(0, 100, 100, 97.5, 98), k(1, 98, 105, 98, 104)], NOW); assert.equal(h.reason, 'stop'); });
t('both in same candle → stop (conservative)', () => assert.equal(B.scanExit(P, [k(0, 100, 105, 97, 100)], NOW).reason, 'stop'));
t('candles before the window are ignored', () => assert.equal(B.scanExit(P, [k(-5, 100, 105, 97, 100), k(0, 100, 101, 99, 100)], NOW), null));
t('short side mirrors', () => { const S = { side: 'SHORT', stop: 102, target: 96 }; assert.equal(B.scanExit(S, [k(0, 100, 101, 95.5, 96)], NOW).reason, 'target'); assert.equal(B.scanExit(S, [k(0, 100, 102.1, 99, 101)], NOW).reason, 'stop'); });

console.log('close & persistence');
t('close at target books +2R into equity and journal with lesson', () => { const s = B.newState(NOW), mk = s.markets.crypto; const p = open(mk, {}).pos; const j = B.closePosition(mk, p, 104, 'target', NOW + 60e3, L0); near(j.r, 2); near(mk.accts.nova.equity, 8160); assert.equal(mk.open.length, 0); assert.equal(mk.journal.length, 1); assert.ok(j.lesson); assert.equal(j.market, 'crypto'); });
t('stop costs ~1R', () => { const s = B.newState(NOW), mk = s.markets.crypto; const p = open(mk, {}).pos; const j = B.closePosition(mk, p, 98, 'stop', NOW, L0); near(j.r, -1); near(mk.accts.nova.equity, 7920); });
t('JSON round-trip keeps state usable', () => { const s = B.newState(NOW); open(s.markets.crypto, {}); const s2 = JSON.parse(JSON.stringify(s)); const p = s2.markets.crypto.open[0]; B.closePosition(s2.markets.crypto, p, 104, 'target', NOW, L0); assert.equal(s2.markets.crypto.journal.length, 1); assert.equal(B.nextTicket(s2.markets.crypto, NOW), 'TD-20261026-02'); });
t('trim keeps the file bounded', () => { const s = B.newState(NOW); for (let i = 0; i < 2000; i++) { s.markets.crypto.journal.push({ n: i }); s.chat.push({}); s.log.push({}); s.markets.crypto.accts.nova.curve.push([i, 1]); } B.trim(s); assert.equal(s.markets.crypto.journal.length, B.CAPS.journal); assert.equal(s.chat.length, B.CAPS.chat); assert.equal(s.log.length, B.CAPS.log); assert.equal(s.markets.crypto.accts.nova.curve.length, B.CAPS.curve); assert.equal(s.markets.crypto.journal[s.markets.crypto.journal.length - 1].n, 1999); });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
