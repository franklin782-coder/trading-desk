/* Market catalog, Hyperliquid fee/margin helpers, and Asia/Almaty (UTC+5) time. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DemoMarkets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TZ = 'Asia/Almaty';
  const TZ_OFFSET_SEC = 5 * 3600;
  const START_BALANCE = 1000000;
  const BASE_TAKER = 0.00045; // 0.045%
  const BASE_MAKER = 0.00015; // 0.015%
  const FUNDING_INTERVAL_SEC = 3600;
  const PX_DECIMALS_SUM = 6; // Hyperliquid perp: px decimals + szDecimals = 6

  const CATALOG = [
    { id: 'xyz:XYZ100', dex: 'xyz', short: 'XYZ100', name: 'NASDAQ 100', kind: 'index' },
    { id: 'xyz:SP500', dex: 'xyz', short: 'SP500', name: 'S&P 500', kind: 'index' },
    { id: 'xyz:NVDA', dex: 'xyz', short: 'NVDA', name: 'NVIDIA', kind: 'stock' },
    { id: 'xyz:AAPL', dex: 'xyz', short: 'AAPL', name: 'Apple', kind: 'stock' },
    { id: 'xyz:TSLA', dex: 'xyz', short: 'TSLA', name: 'Tesla', kind: 'stock' },
    { id: 'xyz:SPCX', dex: 'xyz', short: 'SPCX', name: 'SpaceX', kind: 'preipo' },
    { id: 'xyz:ANT', dex: 'xyz', short: 'ANT', name: 'Anthropic', kind: 'preipo' },
    { id: 'BTC', dex: '', short: 'BTC', name: 'Bitcoin', kind: 'crypto' },
    { id: 'SOL', dex: '', short: 'SOL', name: 'Solana', kind: 'crypto' },
    { id: 'HYPE', dex: '', short: 'HYPE', name: 'HYPE', kind: 'crypto' }
  ];

  const FALLBACK = {
    'xyz:XYZ100': {
      maxLeverage: 30, szDecimals: 4,
      marginTiers: [{ lowerBound: 0, maxLeverage: 30 }],
      growthMode: true, deployerFeeScale: 1
    },
    'xyz:SP500': {
      maxLeverage: 50, szDecimals: 3,
      marginTiers: [{ lowerBound: 0, maxLeverage: 50 }],
      growthMode: true, deployerFeeScale: 1
    },
    'xyz:NVDA': {
      maxLeverage: 10, szDecimals: 3,
      marginTiers: [{ lowerBound: 0, maxLeverage: 10 }],
      growthMode: true, deployerFeeScale: 1
    },
    'xyz:AAPL': {
      maxLeverage: 20, szDecimals: 3,
      marginTiers: [{ lowerBound: 0, maxLeverage: 20 }],
      growthMode: true, deployerFeeScale: 1
    },
    'xyz:TSLA': {
      maxLeverage: 20, szDecimals: 3,
      marginTiers: [{ lowerBound: 0, maxLeverage: 20 }],
      growthMode: true, deployerFeeScale: 1
    },
    'xyz:SPCX': {
      maxLeverage: 20, szDecimals: 2,
      marginTiers: [{ lowerBound: 0, maxLeverage: 20 }],
      growthMode: true, deployerFeeScale: 1
    },
    'xyz:ANT': {
      maxLeverage: 10, szDecimals: 2,
      marginTiers: [{ lowerBound: 0, maxLeverage: 10 }],
      growthMode: true, deployerFeeScale: 1
    },
    BTC: {
      maxLeverage: 40, szDecimals: 5,
      marginTiers: [{ lowerBound: 0, maxLeverage: 40 }, { lowerBound: 150000000, maxLeverage: 20 }],
      growthMode: false, deployerFeeScale: 0
    },
    SOL: {
      maxLeverage: 20, szDecimals: 2,
      marginTiers: [{ lowerBound: 0, maxLeverage: 20 }, { lowerBound: 70000000, maxLeverage: 10 }],
      growthMode: false, deployerFeeScale: 0
    },
    HYPE: {
      maxLeverage: 10, szDecimals: 2,
      marginTiers: [{ lowerBound: 0, maxLeverage: 10 }, { lowerBound: 20000000, maxLeverage: 5 }],
      growthMode: false, deployerFeeScale: 0
    }
  };

  function byId(id) {
    return CATALOG.find(function (m) { return m.id === id; }) || null;
  }
  function shortName(id) {
    const m = byId(id);
    return m ? m.short : String(id || '').replace(/^xyz:/, '');
  }
  function displayName(id) {
    const m = byId(id);
    return m ? m.name : shortName(id);
  }
  function isHip3(id) { return String(id || '').indexOf(':') >= 0; }
  function dexOf(id) {
    const m = byId(id);
    if (m) return m.dex;
    const i = String(id || '').indexOf(':');
    return i > 0 ? String(id).slice(0, i) : '';
  }

  // HIP-3 fee multiplier from Hyperliquid deployer-actions docs.
  // growth mode cuts protocol fees by 90%; scale 1 in growth mode → user pays 0.2× base.
  function hip3FeeMultiplier(scale, growthMode) {
    const s = Math.max(0, +scale || 0);
    if (growthMode) {
      if (s < 1) return 0.1 + 0.1 * s;
      return 0.2 * s;
    }
    if (s < 1) return 1 + s;
    return 2 * s;
  }

  function feeRates(meta) {
    const m = meta || {};
    const hip = !!m.hip3;
    const growth = !!m.growthMode;
    const scale = m.deployerFeeScale == null ? (hip ? 1 : 0) : +m.deployerFeeScale;
    const mult = hip ? hip3FeeMultiplier(scale, growth) : 1;
    return {
      taker: BASE_TAKER * mult,
      maker: BASE_MAKER * mult,
      multiplier: mult,
      growthMode: growth,
      deployerFeeScale: scale,
      hip3: hip
    };
  }

  function feeRatesFor(id, liveMeta) {
    const fb = FALLBACK[id] || FALLBACK['xyz:XYZ100'];
    const merged = Object.assign({ hip3: isHip3(id) }, fb, liveMeta || {});
    if (liveMeta && liveMeta.growthMode != null) merged.growthMode = !!liveMeta.growthMode;
    return feeRates(merged);
  }

  function pxDecimals(szDecimals) {
    const s = szDecimals == null ? 4 : +szDecimals;
    return Math.max(0, PX_DECIMALS_SUM - s);
  }

  function tickSize(szDecimals) {
    return Math.pow(10, -pxDecimals(szDecimals));
  }

  function parseTiers(raw, fallbackMax) {
    if (Array.isArray(raw) && raw.length) {
      return raw.map(function (t) {
        return { lowerBound: +t.lowerBound || 0, maxLeverage: +t.maxLeverage };
      }).sort(function (a, b) { return a.lowerBound - b.lowerBound; });
    }
    const m = +fallbackMax || 10;
    return [{ lowerBound: 0, maxLeverage: m }];
  }

  function maxLevForNotional(tiers, notional, fallbackMax) {
    const t = parseTiers(tiers, fallbackMax);
    let lev = t[0].maxLeverage;
    const n = +notional || 0;
    for (let i = 0; i < t.length; i++) {
      if (n >= t[i].lowerBound) lev = t[i].maxLeverage;
    }
    return lev;
  }

  function mmRatio(maxLeverage) {
    const m = +maxLeverage;
    if (!(m > 0)) return 0;
    return 0.5 / m;
  }

  function mmRatioForNotional(tiers, notional, fallbackMax) {
    return mmRatio(maxLevForNotional(tiers, notional, fallbackMax));
  }

  // --- Asia/Almaty (UTC+5, no DST) ---
  function shiftMs(utcMs) { return (+utcMs || 0) + TZ_OFFSET_SEC * 1000; }
  function unshiftMs(almatyMs) { return (+almatyMs || 0) - TZ_OFFSET_SEC * 1000; }

  function partsFromMs(utcMs) {
    const d = new Date(shiftMs(utcMs));
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      min: d.getUTCMinutes(),
      s: d.getUTCSeconds(),
      wd: d.getUTCDay()
    };
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function dayKey(utcMs) {
    const p = partsFromMs(utcMs);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }

  function startOfDayMs(utcMs) {
    const p = partsFromMs(utcMs);
    return Date.UTC(p.y, p.m - 1, p.d) - TZ_OFFSET_SEC * 1000;
  }

  function formatClock(utcMs, withSec) {
    const p = partsFromMs(utcMs == null ? Date.now() : utcMs);
    return pad(p.h) + ':' + pad(p.min) + (withSec === false ? '' : ':' + pad(p.s));
  }

  function formatDate(utcMs) {
    const p = partsFromMs(utcMs);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }

  function formatDateTime(utcMs) {
    return formatDate(utcMs) + ' ' + formatClock(utcMs, true);
  }

  function formatDateTimeShort(utcMs) {
    const p = partsFromMs(utcMs);
    return pad(p.d) + '.' + pad(p.m) + ' ' + pad(p.h) + ':' + pad(p.min);
  }

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function monthTitle(year, month) {
    return MONTHS[month - 1] + ' ' + year;
  }

  // Monday-first month grid of Almaty day keys.
  function monthGrid(year, month) {
    const firstUtc = Date.UTC(year, month - 1, 1) - TZ_OFFSET_SEC * 1000;
    const first = partsFromMs(firstUtc);
    // JS wd: 0 Sun .. 6 Sat → Monday-first index
    const lead = (first.wd + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < lead; i++) {
      const ms = firstUtc - (lead - i) * 86400000;
      const p = partsFromMs(ms);
      cells.push({ key: dayKey(ms), inMonth: false, d: p.d, ms: startOfDayMs(ms) });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ms = Date.UTC(year, month - 1, d) - TZ_OFFSET_SEC * 1000;
      cells.push({ key: dayKey(ms), inMonth: true, d: d, ms: ms });
    }
    while (cells.length % 7) {
      const last = cells[cells.length - 1].ms;
      const ms = last + 86400000;
      const p = partsFromMs(ms);
      cells.push({ key: dayKey(ms), inMonth: false, d: p.d, ms: startOfDayMs(ms) });
    }
    return cells;
  }

  function utcSecFromChartTime(time) {
    if (time == null) return 0;
    if (typeof time === 'object') {
      return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
    }
    return +time;
  }

  // Lightweight Charts v4 tick marks, displayed in UTC+5.
  function tickMarkFormatter(time, tickMarkType) {
    const sec = utcSecFromChartTime(time);
    const p = partsFromMs(sec * 1000);
    if (tickMarkType === 0) return String(p.y);
    if (tickMarkType === 1) return MONTHS_SHORT[p.m - 1] + ' ' + p.y;
    if (tickMarkType === 2) return pad(p.d) + ' ' + MONTHS_SHORT[p.m - 1];
    if (tickMarkType === 4) return pad(p.h) + ':' + pad(p.min) + ':' + pad(p.s);
    return pad(p.h) + ':' + pad(p.min);
  }

  function timeFormatter(time) {
    const sec = utcSecFromChartTime(time);
    const p = partsFromMs(sec * 1000);
    return formatDate(sec * 1000) + ' ' + pad(p.h) + ':' + pad(p.min) + ' UTC+5';
  }

  function fundingPayment(side, qty, mark, rate) {
    const q = +qty || 0, px = +mark || 0, r = +rate || 0;
    if (!(q > 0) || !(px > 0)) return 0;
    const signed = side === 'short' ? -1 : 1; // longs pay when rate > 0
    return q * px * r * signed;
  }

  function currentFundingHour(nowMs) {
    return Math.floor((+nowMs || Date.now()) / 1000 / FUNDING_INTERVAL_SEC);
  }

  function feeNote(id, rates) {
    const r = rates || feeRatesFor(id);
    const takerPct = (r.taker * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    const makerPct = (r.maker * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    if (r.hip3) {
      return shortName(id) + ' is a HIP-3 market'
        + (r.growthMode ? ' in growth mode' : '')
        + ' (deployer fee scale ' + r.deployerFeeScale + '): all-in taker '
        + takerPct + '% / maker ' + makerPct + '% ('
        + (Math.round(r.multiplier * 1000) / 1000) + '× the base 0.045% / 0.015%). Funding is applied hourly.';
    }
    return shortName(id) + ' uses the base Hyperliquid perp schedule: taker '
      + takerPct + '% / maker ' + makerPct + '% (tier 0, no volume or staking discount). Funding is applied hourly.';
  }

  const DEFAULT_TF = '1m';
  const TIMEFRAMES = ['1s', '15s', '30s', '1m', '5m', '15m', '1h', '4h', '1d'];
  const TF_SECONDS = { '1s': 1, '15s': 15, '30s': 30, '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
  const SUB_MINUTE = { '1s': 1, '15s': 15, '30s': 30 };
  const TF_LOOKBACK_MS = { '1m': 12 * 3600e3, '5m': 2 * 86400e3, '15m': 5 * 86400e3, '1h': 14 * 86400e3, '4h': 60 * 86400e3, '1d': 200 * 86400e3 };

  function isSubMinute(tf) { return !!SUB_MINUTE[tf]; }
  function tfSeconds(tf) { return TF_SECONDS[tf] || 60; }

  // Build / update OHLC bars from a trade. Mutates bars (sorted ascending by time).
  function aggregateTradeBar(bars, px, sz, timeMs, intervalSec) {
    const price = +px, size = +sz || 0, ms = +timeMs;
    if (!(price > 0) || !(ms > 0) || !(intervalSec > 0)) return null;
    const t = Math.floor(ms / 1000 / intervalSec) * intervalSec;
    let last = bars.length ? bars[bars.length - 1] : null;
    if (!last || last.time < t) {
      const open = last ? last.close : price;
      last = { time: t, open: open, high: price, low: price, close: price, volume: size };
      bars.push(last);
    } else if (last.time === t) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume = (last.volume || 0) + size;
    } else {
      // trade older than last bar: ignore (seed should be sorted)
      return last;
    }
    return last;
  }

  function seedBarsFromTrades(trades, intervalSec) {
    const bars = [];
    const list = (trades || []).slice().sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
    list.forEach(function (tr) {
      aggregateTradeBar(bars, tr.px, tr.sz, tr.time, intervalSec);
    });
    return bars;
  }

  return {
    TZ, TZ_OFFSET_SEC, START_BALANCE, BASE_TAKER, BASE_MAKER, FUNDING_INTERVAL_SEC,
    DEFAULT_TF, TIMEFRAMES, TF_SECONDS, SUB_MINUTE, TF_LOOKBACK_MS,
    isSubMinute, tfSeconds, aggregateTradeBar, seedBarsFromTrades,
    CATALOG, FALLBACK,
    byId, shortName, displayName, isHip3, dexOf,
    hip3FeeMultiplier, feeRates, feeRatesFor, feeNote,
    pxDecimals, tickSize, parseTiers, maxLevForNotional, mmRatio, mmRatioForNotional,
    partsFromMs, dayKey, startOfDayMs, formatClock, formatDate, formatDateTime,
    formatDateTimeShort, monthTitle, monthGrid, MONTHS, MONTHS_SHORT,
    tickMarkFormatter, timeFormatter, utcSecFromChartTime,
    fundingPayment, currentFundingHour
  };
});
