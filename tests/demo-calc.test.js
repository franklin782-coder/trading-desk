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

// --- HIP-3 growth-mode fee scale (docs table) ---
const M = require('../js/demo-markets.js');
almost(M.hip3FeeMultiplier(0, false), 1, 1e-12, 'HIP-3 scale 0 → 1×');
almost(M.hip3FeeMultiplier(0.5, false), 1.5, 1e-12, 'HIP-3 scale 0.5 → 1.5×');
almost(M.hip3FeeMultiplier(1, false), 2, 1e-12, 'HIP-3 scale 1 → 2×');
almost(M.hip3FeeMultiplier(3, false), 6, 1e-12, 'HIP-3 scale 3 → 6×');
almost(M.hip3FeeMultiplier(0, true), 0.1, 1e-12, 'growth scale 0 → 0.1×');
almost(M.hip3FeeMultiplier(0.5, true), 0.15, 1e-12, 'growth scale 0.5 → 0.15×');
almost(M.hip3FeeMultiplier(1, true), 0.2, 1e-12, 'growth scale 1 → 0.2×');
almost(M.hip3FeeMultiplier(3.01, true), 0.602, 1e-12, 'growth scale 3.01 → 0.602×');

const xyzFees = M.feeRatesFor('xyz:XYZ100');
almost(xyzFees.taker, 0.00045 * 0.2, 1e-12, 'XYZ100 growth taker 0.009%');
almost(xyzFees.maker, 0.00015 * 0.2, 1e-12, 'XYZ100 growth maker 0.003%');
const btcFees = M.feeRatesFor('BTC');
almost(btcFees.taker, 0.00045, 1e-12, 'BTC base taker 0.045%');
almost(btcFees.maker, 0.00015, 1e-12, 'BTC base maker 0.015%');
assert(M.isHip3('xyz:SP500') && !M.isHip3('BTC'), 'HIP-3 detection');
almost(M.pxDecimals(5), 1, 0, 'BTC px decimals 1');
almost(M.pxDecimals(3), 3, 0, 'SP500 px decimals 3');
almost(M.maxLevForNotional(M.FALLBACK.BTC.marginTiers, 1e6, 40), 40, 0, 'BTC 40x below $150M');
almost(M.maxLevForNotional(M.FALLBACK.BTC.marginTiers, 150000000, 40), 20, 0, 'BTC 20x at $150M');

// UTC+5 day boundaries: 18 Nov 2026 21:00 Almaty = 16:00 UTC same day
// 19 Nov 2026 00:00 Almaty = 18 Nov 19:00 UTC
const almatyMidnight19 = Date.UTC(2026, 10, 18, 19, 0, 0); // 19:00 UTC Nov 18 = 00:00 Nov 19 Almaty
assert(M.dayKey(almatyMidnight19) === '2026-11-19', 'dayKey at Almaty midnight is the new day');
assert(M.dayKey(almatyMidnight19 - 1) === '2026-11-18', '1ms before Almaty midnight is previous day');
assert(M.formatClock(Date.UTC(2026, 10, 18, 16, 30, 5), true) === '21:30:05', '16:30 UTC → 21:30:05 UTC+5');
assert(M.formatDate(Date.UTC(2026, 10, 18, 19, 0, 0)) === '2026-11-19', 'date rolls at 19:00 UTC');
assert(M.tickMarkFormatter(Date.UTC(2026,10,18,16,45)/1000, 3) === '21:45', 'chart tick in UTC+5');

// Funding: long pays when rate > 0
almost(C.fundingPayment('long', 2, 100, 0.0001), 0.02, 1e-12, 'long funding payment');
almost(C.fundingPayment('short', 2, 100, 0.0001), -0.02, 1e-12, 'short receives funding');

// Book migrate + funding + close net + portfolio
const B = require('../js/demo-book.js');
const mem = (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k,v) => { m[k] = v; }, _m: m }; })();
mem.setItem(B.LS_V1, JSON.stringify({
  balance: 999000, seq: 4,
  positions: [{ id: 'D-1', side: 'long', qty: 1, entry: 100, margin: 10, leverage: 10, openFee: 0.045, openedAt: '2026-11-01T00:00:00.000Z' }],
  pending: [], history: [{ id: 'D-0', side: 'short', qty: 1, entry: 200, exit: 190, net: 80, openFee: 10, closeFee: 10, pricePnl: 100, fundingPaid: 0, roe: 8, closedAt: '2026-11-17T10:00:00.000Z', coin: undefined }]
}));
const book = B.loadFromStorage(mem);
assert(book.positions[0].coin === 'xyz:XYZ100', 'migrate tags positions with XYZ100');
assert(book.history[0].coin === 'xyz:XYZ100', 'migrate tags history');
almost(book.balance, 999000, 0, 'migrated balance kept');

const marks = { 'xyz:XYZ100': 110, BTC: 60000 };
// apply two funding hours after the position opened (2026-11-01)
const fundNow = Date.UTC(2026, 10, 18, 16, 0, 0);
book.lastFundingHour = M.currentFundingHour(fundNow) - 2;
const fundRows = B.applyFunding(book, marks, { 'xyz:XYZ100': 0.0001 }, fundNow);
assert(fundRows.length === 2, 'two hourly funding events applied, got ' + fundRows.length);
almost(fundRows[0].payment, C.fundingPayment('long', 1, 110, 0.0001), 1e-10, 'funding payment on mark');

const before = book.balance;
const closed = B.closePosition(book, book.positions[0], 110, 'manual', marks);
almost(closed.net, (110-100)*1 - 0.045 - (110*1*C.TAKER) - closed.fundingPaid, 1e-8, 'close net includes fees+funding');
almost(book.balance, before + (110-100) - closed.closeFee, 1e-8, 'balance gets price pnl minus close fee (open/funding already applied)');
assert(book.positions.length === 0, 'position removed');

const stats = B.portfolioStats(book, marks, Date.UTC(2026, 10, 18, 16, 0, 0));
assert(stats.trades === 2, 'two closed trades');
assert(stats.daily['2026-11-17'] && stats.daily['2026-11-17'].trades === 1, 'calendar day uses UTC+5 (17 Nov 15:00 Almaty for 10:00 UTC)');

// HIP-3 XYZ100 $100k x30 short −1% with growth fees (0.009%)
const p2 = C.plan({
  side: 'short', sizeUsd: 100000, sizeMode: 'margin', leverage: 30,
  entry: 25000, maxLeverage: 30, szDecimals: 8, feeRate: xyzFees.taker,
  tp: 25000 * 0.99
});
almost(p2.openFee, 3_000_000 * xyzFees.taker, 1e-6, 'XYZ100 growth open fee');
almost(p2.tp.net, 30000 - p2.openFee - 2_970_000 * xyzFees.taker, 1e-4, 'XYZ100 net at −1% with growth fees');



// Account modes, TIF, stop, isolated margin
const book2 = B.defaultBook();
book2.balance = 1000000;
const m2 = { BTC: 100, 'xyz:SP500': 100 };
const opened = B.fillPosition(book2, {
  coin: 'BTC', side: 'long', qty: 10, leverage: 10, maxLeverage: 40,
  marginMode: 'isolated', feeRate: 0, typ: 'market', margin: 100
}, 100, 'market', m2);
assert(opened.ok, 'open isolated BTC');
almost(opened.position.margin, 100, 1e-8, 'isolated margin 100');
const add = B.addIsolatedMargin(book2, opened.position, 50, m2);
assert(add.ok && add.margin === 150, 'add isolated margin');
const tooMuch = B.removeIsolatedMargin(book2, opened.position, 100, m2);
assert(!tooMuch.ok, 'cannot remove below max(IM, 10% notional)');
const okRm = B.removeIsolatedMargin(book2, opened.position, 20, m2);
assert(okRm.ok, 'remove isolated margin within rule');

// ALO would-take cancels; GTC rests; IOC cancels if not fillable
const book3 = B.defaultBook();
const ctx = { marks: { BTC: 100 }, mids: { BTC: 100 }, bids: { BTC: 100 }, asks: { BTC: 100.2 }, now: Date.now() };
B.placeWorkingOrder(book3, { coin: 'BTC', side: 'long', typ: 'limit', tif: 'Alo', qty: 1, leverage: 10, limitPx: 100.2, feeRate: 0, margin: 10 });
const evAlo = B.tickOrders(book3, ctx);
assert(evAlo.some(e => e.type === 'alo-cancel') && book3.positions.length === 0, 'ALO buy at ask is canceled');
B.placeWorkingOrder(book3, { coin: 'BTC', side: 'long', typ: 'limit', tif: 'Ioc', qty: 1, leverage: 10, limitPx: 99, feeRate: 0, margin: 10 });
const evIoc = B.tickOrders(book3, ctx);
assert(evIoc.some(e => e.type === 'ioc-cancel'), 'IOC below market cancels');
B.placeWorkingOrder(book3, { coin: 'BTC', side: 'long', typ: 'limit', tif: 'Gtc', qty: 1, leverage: 10, limitPx: 99, feeRate: 0, margin: 10, maxLeverage: 40 });
const evG = B.tickOrders(book3, ctx);
assert(book3.pending.length === 1 && book3.pending[0].tif === 'Gtc', 'GTC rests below market');
// later price trades down to 99
const evFill = B.tickOrders(book3, { marks:{BTC:99}, mids:{BTC:99}, bids:{BTC:98.9}, asks:{BTC:99}, now: Date.now() });
assert(book3.positions.length === 1 && book3.positions[0].coin === 'BTC', 'GTC fills when ask reaches limit');

// Stop market long triggers only when mid >= trigger (> mid at place)
const book4 = B.defaultBook();
B.placeWorkingOrder(book4, { coin: 'BTC', side: 'long', typ: 'stopMarket', triggerPx: 110, qty: 1, leverage: 10, feeRate: 0, margin: 10, maxLeverage: 40 });
B.tickOrders(book4, { marks:{BTC:100}, mids:{BTC:100}, bids:{BTC:99.9}, asks:{BTC:100.1}, now: Date.now() });
assert(book4.positions.length === 0 && book4.pending.length === 1, 'stop not triggered yet');
B.tickOrders(book4, { marks:{BTC:110}, mids:{BTC:110}, bids:{BTC:109.9}, asks:{BTC:110.1}, now: Date.now() });
assert(book4.positions.length === 1, 'stop market fills once mid reaches trigger');

// Standard mode: cross is per-DEX
const book5 = B.defaultBook();
B.setAccountMode(book5, 'standard');
assert(book5.dexCash.main === 1000000 && book5.dexCash.xyz === 0, 'standard starts with cash on main');
const tr = B.transferDex(book5, 'main', 'xyz', 200000);
assert(tr.ok && book5.dexCash.xyz === 200000, 'transfer main → xyz');
almost(B.liqRatioThreshold({ accountMode: 'portfolio' }), 0.95, 0, 'portfolio margin ratio threshold 0.95');
almost(B.liqRatioThreshold({ accountMode: 'unified' }), 1, 0, 'unified threshold 1');

assert(B.triggerHit('stopMarket', 'long', 110, 110, 110) === true, 'stop long hits at trigger');
assert(B.triggerHit('takeMarket', 'long', 90, 100, 100) === false, 'take long does not hit above trigger');
assert(B.triggerHit('takeMarket', 'long', 90, 90, 90) === true, 'take long hits at/below trigger');



// Default TF is 1m on every load, even if a previous session saved 15m
const memUi = { getItem(k){ return k===B.LS_UI ? JSON.stringify({ layout:2, panes:[{coin:'BTC',tf:'15m'},{coin:'xyz:SP500',tf:'5m'}] }) : null; }, setItem(){} };
const ui = B.loadUi(memUi);
assert(ui.panes[0].tf === '1m' && ui.panes[1].tf === '1m', 'page load forces 1m on every pane, got ' + ui.panes.map(p=>p.tf));
assert(B.defaultUi().panes[0].tf === '1m', 'default pane tf is 1m');

// Sub-minute aggregation from trades
const bars = M.seedBarsFromTrades([
  { px: 100, sz: 1, time: 1000000 },
  { px: 102, sz: 1, time: 1000500 },
  { px: 99,  sz: 2, time: 1000900 },
  { px: 101, sz: 1, time: 1015000 }
], 1);
assert(bars.length === 2, '1s bars split across seconds, got ' + bars.length);
almost(bars[0].open, 100, 0, 'first 1s open');
almost(bars[0].high, 102, 0, 'first 1s high');
almost(bars[0].low, 99, 0, 'first 1s low');
almost(bars[0].close, 99, 0, 'first 1s close');
almost(bars[0].volume, 4, 0, 'first 1s volume');
almost(bars[1].open, 99, 0, 'next bar opens at prior close');
almost(bars[1].close, 101, 0, 'second bar close');
assert(M.isSubMinute('1s') && M.isSubMinute('15s') && M.isSubMinute('30s') && !M.isSubMinute('1m'), 'sub-minute flags');


// Equity log must sort + dedupe; period PnL is always equity change
const nowP = Date.UTC(2026, 10, 18, 16, 0, 0);
const bookP = B.defaultBook();
bookP.balance = 999000;
bookP.equityLog = [
  { t: nowP, equity: 1000000 },
  { t: nowP - 20 * 86400000, equity: 990000 },
  { t: nowP - 86400000, equity: 1012500 },
  { t: nowP, equity: 999000 }
];
const nlog = B.normalizeEquityLog(bookP.equityLog);
assert(nlog.every((pt, i) => i === 0 || pt.t > nlog[i - 1].t), 'normalized equity log is strictly increasing in time');
assert(nlog.filter(pt => Math.floor(pt.t / 1000) === Math.floor(nowP / 1000)).length === 1, 'duplicate timestamps are deduped');
almost(nlog[nlog.length - 1].equity, 999000, 0, 'last value at a duplicate second wins');
almost(B.periodPnl(bookP, {}, nowP, 0), -1000, 0.01, 'all-time PnL is equity − start');
almost(B.periodPnl(bookP, {}, nowP, 86400000), 999000 - 1012500, 0.01, '24h PnL is equity change vs the last log point at or before now−24h');
almost(B.periodPnl(bookP, {}, nowP, 30 * 86400000), 999000 - 1000000, 0.01, '30d uses START when no log point precedes the window');

const bookQ = B.defaultBook();
bookQ.balance = 999500;
bookQ.equityLog = [{ t: nowP - 1000, equity: 1000000 }, { t: nowP, equity: 999500 }];
almost(B.periodPnl(bookQ, {}, nowP, 0), -500, 0.01, 'new account all-time');
almost(B.periodPnl(bookQ, {}, nowP, 86400000), -500, 0.01, '24h equals all-time when the account is newer than 24h');
almost(B.periodPnl(bookQ, {}, nowP, 7 * 86400000), -500, 0.01, '7d equals all-time when the account is newer than 7d');


// Corrupt v2 is backed up; valid v1 is used instead of wiping the account
const memBad = (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k,v) => { m[k] = v; }, _m: m }; })();
memBad.setItem(B.LS_V2, '{not-json');
memBad.setItem(B.LS_V1, JSON.stringify({ balance: 777000, seq: 2, positions: [], pending: [], history: [] }));
const recovered = B.loadFromStorage(memBad);
almost(recovered.balance, 777000, 0, 'corrupt v2 falls back to v1 balance');
assert(memBad.getItem(B.LS_V2 + '-backup') === '{not-json', 'corrupt v2 is backed up, not deleted');

const memOk = (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k,v) => { m[k] = v; }, _m: m }; })();
memOk.setItem(B.LS_V2, JSON.stringify({ balance: 888000, positions: [{ id: 'P', coin: 'BTC', side: 'long', qty: 1, entry: 50, margin: 10, leverage: 5 }], pending: 'oops' }));
const sanitized = B.loadFromStorage(memOk);
almost(sanitized.balance, 888000, 0, 'valid balance kept when pending is malformed');
assert(Array.isArray(sanitized.pending) && sanitized.positions.length === 1, 'malformed arrays are coerced, positions kept');


// New HIP-3 equity perps on dex xyz: growth mode, scale 1 → 0.2× base fees
['xyz:NVDA','xyz:AAPL','xyz:TSLA','xyz:SPCX','xyz:ANT'].forEach(function (id) {
  const r = M.feeRatesFor(id);
  almost(r.taker, 0.00009, 1e-12, id + ' growth taker 0.009%');
  almost(r.maker, 0.00003, 1e-12, id + ' growth maker 0.003%');
  assert(M.byId(id), id + ' is in the catalog');
});
assert(M.FALLBACK['xyz:NVDA'].maxLeverage === 10 && M.FALLBACK['xyz:AAPL'].maxLeverage === 20, 'NVDA 10x / AAPL 20x fallbacks');
assert(M.FALLBACK['xyz:TSLA'].maxLeverage === 20 && M.FALLBACK['xyz:SPCX'].maxLeverage === 20 && M.FALLBACK['xyz:ANT'].maxLeverage === 10, 'TSLA/SPCX 20x, ANT 10x fallbacks');
assert(M.CATALOG.length === 10, 'catalog has 10 markets, got ' + M.CATALOG.length);

if (failed) { console.error('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall tests passed');
