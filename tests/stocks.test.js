// Run: node tests/stocks.test.js
const assert = require('assert');
const R = require('../js/risk.js');
const MH = require('../js/market-hours.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } }
console.log('tickets');
t('crypto default prefix TD', () => assert.equal(R.ticketId(Date.UTC(2026, 9, 26, 12), 3), 'TD-20261026-03'));
t('stocks prefix TS', () => assert.equal(R.ticketId(Date.UTC(2026, 9, 26, 12), 7, 'TS'), 'TS-20261026-07'));
console.log('US market hours (America/New_York, EDT=UTC-4 in Oct)');
t('Mon 14:00 UTC = 10:00 NY → OPEN', () => assert.equal(MH.usMarketStatus(Date.UTC(2026, 9, 26, 14)).state, 'OPEN'));
t('Mon 13:29 UTC = 9:29 NY → PRE', () => assert.equal(MH.usMarketStatus(Date.UTC(2026, 9, 26, 13, 29)).state, 'PRE'));
t('Mon 20:00 UTC = 16:00 NY → AFTER', () => assert.equal(MH.usMarketStatus(Date.UTC(2026, 9, 26, 20)).state, 'AFTER'));
t('Tue 02:00 UTC = Mon 22:00 NY → CLOSED', () => assert.equal(MH.usMarketStatus(Date.UTC(2026, 9, 27, 2)).state, 'CLOSED'));
t('Saturday → CLOSED', () => assert.equal(MH.usMarketStatus(Date.UTC(2026, 9, 31, 15)).state, 'CLOSED'));
t('winter EST: Jan 5 14:45 UTC = 9:45 NY → OPEN', () => assert.equal(MH.usMarketStatus(Date.UTC(2026, 0, 5, 14, 45)).state, 'OPEN'));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
