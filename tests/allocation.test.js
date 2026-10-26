// Run: node tests/allocation.test.js
const assert = require('assert');
const R = require('../js/risk.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
console.log('80/20 capital allocation');
t('$10k per bot', () => assert.equal(R.TOTAL_PER_BOT, 10000));
t('crypto book = $8k', () => assert.equal(R.bookStart('crypto'), 8000));
t('stocks book = $2k', () => assert.equal(R.bookStart('stocks'), 2000));
t('books sum to total', () => assert.equal(R.bookStart('crypto') + R.bookStart('stocks'), R.TOTAL_PER_BOT));
t('crypto is 4x stocks', () => assert.equal(R.bookStart('crypto') / R.bookStart('stocks'), 4));
t('unknown market throws', () => assert.throws(() => R.bookStart('forex')));
t('1% risk sized off the crypto book, not $10k', () => { const s = R.sizePosition({ equity: R.bookStart('crypto'), entry: 100, stop: 98, limits: R.effectiveLimits({ feeRate: 0, slippagePct: 0 }) }); assert.ok(Math.abs(s.riskUsd - 80) < 1e-9); });
t('1% risk sized off the stocks book', () => { const s = R.sizePosition({ equity: R.bookStart('stocks'), entry: 100, stop: 98, limits: R.effectiveLimits({ feeRate: 0, slippagePct: 0 }) }); assert.ok(Math.abs(s.riskUsd - 20) < 1e-9); });
console.log('dynamic universe');
const U = [{ name: 'BTC', vol: 9e9 }, { name: 'HYPE', vol: 5e8 }, { name: 'DOGE', vol: 3e8 }, { name: 'kPEPE', vol: 4e8 }, { name: 'XRP', vol: 2e8 }, { name: 'DEAD', vol: 0 }];
t('top-N by volume excludes majors, odd names and zero volume', () => assert.deepEqual(R.pickTopByVolume(U, ['BTC', 'ETH'], 3), ['HYPE', 'DOGE', 'XRP']));
t('respects N', () => assert.equal(R.pickTopByVolume(U, [], 1)[0], 'BTC'));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
