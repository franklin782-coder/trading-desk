// node tests/demo-calc.test.js
const C = require('../js/demo-calc.js');
let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL:', msg); }
  else console.log('ok  ', msg);
}
function almost(a, b, eps, msg) {
  const e = eps == null ? 1e-6 : eps;
  assert(Math.abs(a - b) <= e, (msg || '') + `  got ${a} expected ${b} ±${e}`);
}

// Example from the brief: $100k margin × 30 short, price −1%
// notional $3M, profit ≈ $30,000 minus fees (~$2.7k), ROE ≈ +27%
const p = C.plan({
  side: 'short', sizeUsd: 100000, sizeMode: 'margin', leverage: 30,
  entry: 25000, maxLeverage: 30, szDecimals: 8, feeRate: C.TAKER,
  tp: 25000 * 0.99
});
almost(p.notional, 3_000_000, 1e-6, 'notional is $3M');
almost(p.margin, 100000, 1e-6, 'margin is $100k');
almost(p.qty, 120, 1e-8, 'qty = 3e6 / 25000');
almost(p.openFee, 1350, 1e-8, 'open taker fee 0.045% of 3M');
almost(p.tp.pricePnl, 30000, 1e-6, 'price PnL at −1% is $30k');
almost(p.tp.closeFee, 2970000 * 0.00045, 1e-6, 'close fee on $2.97M');
almost(p.tp.totalFees, 1350 + 1336.5, 1e-6, 'round-trip fees ≈ $2,686.50');
almost(p.tp.net, 30000 - 2686.5, 1e-6, 'net ≈ $27,313.50');
almost(p.tp.roe, 27.3135, 1e-6, 'ROE ≈ +27.3135%');

const row1 = p.scenarios.find(s => s.label === '-1%');
almost(row1.net, 27313.5, 1e-6, 'scenario −1% matches TP');

// Isolated liq: MM = 1/(2*30) = 1/60
almost(C.mmRatio(30), 1 / 60, 1e-12, 'MM is half of 1/maxLev');
const liq = C.liqPrice({ side: 'short', entry: 25000, leverage: 30, maxLeverage: 30, margin: 100000, qty: 120 });
const expectedLiq = (25000 * 120 + 100000) / (120 * (1 + 1 / 60));
almost(liq, expectedLiq, 1e-8, 'short liq formula');
almost(liq, 25000 * 62 / 61, 1e-8, 'short 30x liq ≈ entry * 62/61');

const liqL = C.liqPrice({ side: 'long', entry: 25000, leverage: 30, maxLeverage: 30, margin: 100000, qty: 120 });
almost(liqL, (25000 * 120 - 100000) / (120 * (1 - 1 / 60)), 1e-8, 'long liq formula');

assert(C.hitLevel('short', 25300, 24750, 25250, expectedLiq) === 'sl', 'SL hits before waiting for TP');
assert(C.hitLevel('short', expectedLiq + 1, 24750, 26000, expectedLiq) === 'liquidation', 'liq has priority');
assert(C.hitLevel('long', 25500, 25500, 24500, 24000) === 'tp', 'long TP hit');
assert(C.favorablePrice('short', 25000, 1) === 24750, 'short +1% favorable is −1% price');
assert(C.adversePrice('short', 25000, 1) === 25250, 'short 1% adverse is +1% price');

assert(C.limitFillable('short', 24900, 25000, 25010, 25005) === true, 'short limit above bid fills');
assert(C.limitFillable('short', 25001, 25000, 25010, 25005) === false, 'short limit below market rests');
assert(C.limitFillable('long', 25010, 25000, 25010, 25005) === true, 'long limit at ask fills');

const e = C.entryFromBook('short', 'market', null, 26949, 26953, 26951.5, 26966);
almost(e, 26949, 0, 'market short uses bid/impact');

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall tests passed');
