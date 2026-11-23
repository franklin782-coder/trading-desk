/* Paper trade + TP/SL calculator. Paper only — no exchange orders. */
(function () {
  'use strict';

  const CALC_KEY = 'tpsl-calc';
  const PAPER_KEY = 'td-calc-paper-v1';
  const UI_KEY = 'td-calc-ui-v1';
  const START_BAL = 30000;
  const OLD_START_BAL = 1000000;
  const BASE_MMR = 0.012;
  const TP_CHIPS = [10, 25, 50, 100];
  const SL_CHIPS = [-10, -25, -50, -75];
  const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const TF_LABEL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D' };
  const TF_MS = { '1m': 60e3, '5m': 5 * 60e3, '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3, '1d': 86400e3 };
  /* Initial window per TF. 1m is at least 7 days (multiple API pages; HL caps a snapshot at 5000 candles). */
  const TF_INIT_MS = { '1m': 7 * 86400e3, '5m': 14 * 86400e3, '15m': 30 * 86400e3, '1h': 90 * 86400e3, '4h': 365 * 86400e3, '1d': 2000 * 86400e3 };
  const HL_CANDLE_CAP = 5000;
  const ASTER_KLINE_LIMIT = 1500;
  const ASTER_API = 'https://fapi.asterdex.com/fapi/v1';
  const ASTER_BRACKET_URL = 'https://www.asterdex.com/bapi/futures/v1/friendly/future/common/brackets';
  const HL_INFO = 'https://api.hyperliquid.xyz/info';
  const HL_WS = 'wss://api.hyperliquid.xyz/ws';
  const FEE_DEFAULTS = { aster: 0.05, hyperliquid: 0.045 };
  const UP = '#86e8a8';
  const DN = '#f6465d';
  const ORANGE = '#fb923c';

  const NAMES = {
    BTC: 'Bitcoin', HYPE: 'HYPE', VVV: 'VVV', SOL: 'Solana', MRNA: 'Moderna', ANT: 'Anthropic',
    SOXL: 'Direxion SOXL', MU: 'Micron', AMD: 'AMD', AVGO: 'Broadcom', TSM: 'TSMC', SKHYNIX: 'SK Hynix', NVDA: 'NVIDIA',
    TSLA: 'Tesla', SPCX: 'SpaceX', ASML: 'ASML', AMAT: 'Applied Materials', LRCX: 'Lam Research',
    SAMSUNG: 'Samsung', SMCI: 'Super Micro', SMH: 'VanEck SMH', SP500: 'S&P 500', XYZ100: 'XYZ 100'
  };
  const CRYPTO = { BTC: 1, HYPE: 1, VVV: 1, SOL: 1 };

  const COINS = [
    { id: 'BTC', name: 'BTC', aster: { symbol: 'BTCUSDT', max: 40, fallback: 61313 }, hl: { coin: 'BTC', max: 40, fallback: 61313 } },
    { id: 'HYPE', name: 'HYPE', aster: { symbol: 'HYPEUSDT', max: 300, fallback: 64.01 }, hl: { coin: 'HYPE', max: 10, fallback: 64.01 } },
    { id: 'SOL', name: 'SOL', aster: { symbol: 'SOLUSDT', max: 100, fallback: 72.20 }, hl: { coin: 'SOL', max: 20, fallback: 72.20 } },
    { id: 'VVV', name: 'VVV', aster: { symbol: 'VVVUSDT', max: 10, fallback: 26.06 }, hl: { coin: 'VVV', max: 3, fallback: 26.06 } },
    { id: 'NVDA', name: 'NVDA', aster: { symbol: 'NVDAUSDT', max: 20, fallback: 136.53 }, hl: { coin: 'xyz:NVDA', max: 10, fallback: 136.53, dex: 'xyz' } },
    { id: 'AMD', name: 'AMD', aster: { symbol: 'AMDUSDT', max: 50, fallback: 446.31 }, hl: { coin: 'xyz:AMD', max: 10, fallback: 446.31, dex: 'xyz' } },
    { id: 'MU', name: 'MU', aster: { symbol: 'MUUSD1', max: 20, fallback: 633.52 }, hl: { coin: 'xyz:MU', max: 10, fallback: 633.52, dex: 'xyz' } },
    { id: 'AVGO', name: 'AVGO', aster: { symbol: 'AVGOUSDT', max: 20, fallback: 321.54 }, hl: { coin: 'xyz:AVGO', max: 10, fallback: 321.54, dex: 'xyz' } },
    { id: 'TSM', name: 'TSM', aster: { symbol: 'TSMUSDT', max: 20, fallback: 342.13 }, hl: { coin: 'xyz:TSM', max: 10, fallback: 342.13, dex: 'xyz' } },
    { id: 'SKHYNIX', name: 'SKHYNIX', aster: { symbol: 'SKHYNIXUSD1', max: 20, fallback: 815.85 }, hl: { coin: 'xyz:SKHX', max: 10, fallback: 815.85, dex: 'xyz' } },
    { id: 'SOXL', name: 'SOXL', aster: { symbol: 'SOXLUSDT', max: 50, fallback: 36.39 }, hl: { coin: 'xyz:SOXL', max: 10, fallback: 36.39, dex: 'xyz' } },
    { id: 'MRNA', name: 'MRNA', aster: { symbol: 'MRNAUSDT', max: 20, fallback: 200.77 }, hl: { coin: 'xyz:MRNA', max: 10, fallback: 200.77, dex: 'xyz' } },
    { id: 'ANT', name: 'ANT', aster: { symbol: 'ANTUSDT', max: 20, fallback: 89.32 }, hl: { coin: 'xyz:ANT', max: 10, fallback: 89.19, dex: 'xyz' } },
    { id: 'TSLA', name: 'TSLA', aster: { symbol: 'TSLAUSDT', max: 50, fallback: 363.38 }, hl: { coin: 'xyz:TSLA', max: 20, fallback: 362.82, dex: 'xyz' } },
    { id: 'SPCX', name: 'SPCX', aster: { symbol: 'SPCXUSDT', max: 50, fallback: 131.98 }, hl: { coin: 'xyz:SPCX', max: 20, fallback: 131.83, dex: 'xyz' } },
    { id: 'ASML', name: 'ASML', aster: { symbol: 'ASMLUSDT', max: 20, fallback: 1347.37 }, hl: { coin: 'xyz:ASML', max: 10, fallback: 1345.7, dex: 'xyz' } },
    { id: 'AMAT', name: 'AMAT', aster: { symbol: 'AMATUSDT', max: 20, fallback: 322.86 }, hl: { coin: 'xyz:AMAT', max: 10, fallback: 322.17, dex: 'xyz' } },
    { id: 'LRCX', name: 'LRCX', hl: { coin: 'xyz:LRCX', max: 10, fallback: 196.59, dex: 'xyz' } },
    { id: 'SAMSUNG', name: 'SAMSUNG', aster: { symbol: 'SAMSUNGUSDT', max: 50, fallback: 133.06 }, hl: { coin: 'xyz:SMSN', max: 10, fallback: 133.04, dex: 'xyz' } },
    { id: 'SMCI', name: 'SMCI', hl: { coin: 'xyz:SMCI', max: 10, fallback: 24.37, dex: 'xyz' } },
    { id: 'SMH', name: 'SMH', hl: { coin: 'xyz:SMH', max: 20, fallback: 424.66, dex: 'xyz' } },
    { id: 'SP500', name: 'SP500', hl: { coin: 'xyz:SP500', max: 50, fallback: 7101.8, dex: 'xyz' } },
    { id: 'XYZ100', name: 'XYZ100', hl: { coin: 'xyz:XYZ100', max: 30, fallback: 25945, dex: 'xyz' } }
  ];
  const COIN_BY_ID = Object.fromEntries(COINS.map((c) => [c.id, c]));

  const ASTER_BRACKETS_FALLBACK = {
    BTC: [{min:151,max:200,cap:400},{min:101,max:150,cap:300000},{min:76,max:100,cap:800000},{min:51,max:75,cap:3000000},{min:26,max:50,cap:12000000},{min:21,max:25,cap:70000000},{min:11,max:20,cap:100000000},{min:6,max:10,cap:230000000},{min:5,max:5,cap:480000000},{min:4,max:4,cap:600000000},{min:3,max:3,cap:800000000},{min:2,max:2,cap:1200000000},{min:1,max:1,cap:1800000000}],
    HYPE: [{min:151,max:300,cap:1000},{min:101,max:150,cap:2000},{min:76,max:100,cap:3000},{min:51,max:75,cap:200000},{min:21,max:50,cap:1000000},{min:11,max:20,cap:5000000},{min:6,max:10,cap:20000000},{min:5,max:5,cap:30000000},{min:4,max:4,cap:40000000},{min:3,max:3,cap:50000000},{min:2,max:2,cap:100000000},{min:1,max:1,cap:1000000000}],
    MRNA: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    ANT: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    VVV: [{min:6,max:10,cap:500000},{min:5,max:5,cap:1000000},{min:4,max:4,cap:2500000},{min:3,max:3,cap:5000000},{min:2,max:2,cap:10000000},{min:1,max:1,cap:1000000000}],
    SOXL: [{min:21,max:50,cap:1000000},{min:11,max:20,cap:5000000},{min:6,max:10,cap:10000000},{min:5,max:5,cap:20000000},{min:4,max:4,cap:30000000},{min:3,max:3,cap:40000000},{min:2,max:2,cap:100000000},{min:1,max:1,cap:1000000000}],
    MU: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    AMD: [{min:21,max:50,cap:1000000},{min:11,max:20,cap:5000000},{min:6,max:10,cap:10000000},{min:5,max:5,cap:20000000},{min:4,max:4,cap:30000000},{min:3,max:3,cap:40000000},{min:2,max:2,cap:100000000},{min:1,max:1,cap:1000000000}],
    AVGO: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    TSM: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    SKHYNIX: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    SOL: [{min:76,max:100,cap:50000},{min:51,max:75,cap:400000},{min:26,max:50,cap:1000000},{min:21,max:25,cap:4000000},{min:16,max:20,cap:8000000},{min:11,max:15,cap:20000000},{min:9,max:10,cap:40000000},{min:7,max:8,cap:50000000},{min:6,max:6,cap:60000000},{min:5,max:5,cap:80000000},{min:4,max:4,cap:100000000},{min:3,max:3,cap:150000000},{min:2,max:2,cap:200000000},{min:1,max:1,cap:400000000}],
    NVDA: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    TSLA: [{min:21,max:50,cap:1000000},{min:11,max:20,cap:5000000},{min:6,max:10,cap:10000000},{min:5,max:5,cap:20000000},{min:4,max:4,cap:30000000},{min:3,max:3,cap:40000000},{min:2,max:2,cap:100000000},{min:1,max:1,cap:1000000000}],
    SPCX: [{min:21,max:50,cap:1000000},{min:11,max:20,cap:5000000},{min:6,max:10,cap:10000000},{min:5,max:5,cap:20000000},{min:4,max:4,cap:30000000},{min:3,max:3,cap:40000000},{min:2,max:2,cap:100000000},{min:1,max:1,cap:1000000000}],
    ASML: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    AMAT: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}],
    SAMSUNG: [{min:21,max:50,cap:1000000},{min:11,max:20,cap:5000000},{min:6,max:10,cap:10000000},{min:5,max:5,cap:20000000},{min:4,max:4,cap:30000000},{min:3,max:3,cap:40000000},{min:2,max:2,cap:100000000},{min:1,max:1,cap:1000000000}]
  };
  const HL_TIERS_FALLBACK = {
    BTC: [{lower:0,maxLev:40},{lower:150000000,maxLev:20}],
    HYPE: [{lower:0,maxLev:10},{lower:20000000,maxLev:5}],
    SOL: [{lower:0,maxLev:20},{lower:70000000,maxLev:10}],
    VVV: [{lower:0,maxLev:3}],
    MRNA: [{lower:0,maxLev:10}], ANT: [{lower:0,maxLev:10}], SOXL: [{lower:0,maxLev:10}],
    MU: [{lower:0,maxLev:10}], AMD: [{lower:0,maxLev:10}], AVGO: [{lower:0,maxLev:10}],
    TSM: [{lower:0,maxLev:10}], SKHYNIX: [{lower:0,maxLev:10}], NVDA: [{lower:0,maxLev:10}],
    TSLA: [{lower:0,maxLev:20}], SPCX: [{lower:0,maxLev:20}], ASML: [{lower:0,maxLev:10}],
    AMAT: [{lower:0,maxLev:10}], LRCX: [{lower:0,maxLev:10}], SAMSUNG: [{lower:0,maxLev:10}],
    SMCI: [{lower:0,maxLev:10}], SMH: [{lower:0,maxLev:20}], SP500: [{lower:0,maxLev:50}],
    XYZ100: [{lower:0,maxLev:30}]
  };

  let asterBrackets = JSON.parse(JSON.stringify(ASTER_BRACKETS_FALLBACK));
  let hlTiers = JSON.parse(JSON.stringify(HL_TIERS_FALLBACK));
  let hlCache = { at: 0, map: null };
  let dayChange = {};
  let liveMeta = {};
  let fetchGen = 0;
  let marginFlashTimer = 0;
  let padFresh = true;
  let marginDraft = null;
  let chart = null, series = null, ws = null, wsCoin = '', wsTf = '', bars = [];
  let wsKind = '', wsKey = '', lastTickAt = 0, liveRaf = 0, pendingTick = null, wsRetry = 0;
  let drawTool = 'cursor', drawColor = '#3b8aff', drawings = {}, selectedDraw = null;
  let measure = null, crosshair = null, longPressTimer = 0, chartPanOff = false, pendingTrend = null;
  let histLoading = false, histEOF = false, histGen = 0;
  let obRaw = { bids: [], asks: [] }, tape = [], obGroup = 0, obTab = 'book', obRaf = 0, obSteps = [];
  const DRAW_KEY = 'td-calc-draw-v1';
  const DRAW_COLORS = ['#3b8aff', '#86e8a8', '#f6465d', '#fbbf24', '#ffffff', '#c084fc'];
  const focused = new Set();

  const state = {
    view: 'markets',
    filter: 'all',
    platform: 'aster',
    coin: 'BTC',
    side: 'long',
    typ: 'market',
    marginMode: 'isolated',
    margin: 1000,
    lev: 10,
    entry: 0,
    livePrice: null,
    limitPx: 0,
    tp: null,
    sl: null,
    feePct: FEE_DEFAULTS.aster,
    fees: { aster: FEE_DEFAULTS.aster, hyperliquid: FEE_DEFAULTS.hyperliquid },
    priceStatus: 'idle',
    tf: '1m',
    showTpsl: false,
    amountOn: true,
    chartLines: { entry: true, tp: true, sl: true, liq: true },
    mktQuery: '',
    bookTab: 'positions',
    rightTab: 'trade'
  };

  let book = { balance: START_BAL, positions: [], pending: [], history: [], seq: 1 };

  const $ = (id) => document.getElementById(id);
  const DESK_MQ = window.matchMedia('(min-width: 1024px)');
  function isDesktop() { return DESK_MQ.matches; }

  function toast(text) {
    const el = $('toast'); if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function isHl() { return state.platform === 'hyperliquid'; }
  function platformName() { return isHl() ? 'Hyperliquid' : 'Aster'; }
  function currentCoin() { return COIN_BY_ID[state.coin] || COINS[0]; }
  function coinSpec(coin) {
    const c = coin || currentCoin();
    return isHl() ? c.hl : c.aster;
  }
  function coinAvailable(coin) { return !!(coin && coinSpec(coin)); }
  function logoSrc(id) { return 'logos/' + id + '.png'; }
  function levMax() {
    const s = coinSpec();
    return (s && s.max) || 10;
  }
  function clampLev(v) {
    const n = Math.round(+v || 1);
    return Math.max(1, Math.min(levMax(), n));
  }
  function metaOf(id) {
    const c = COIN_BY_ID[id] || currentCoin();
    return liveMeta[c.id] || {};
  }
  function displayPx(id) {
    const c = COIN_BY_ID[id] || currentCoin();
    const meta = metaOf(c.id);
    if (c.id === state.coin && state.livePrice > 0) return state.livePrice;
    if (meta.trade > 0) return meta.trade;
    if (meta.mid > 0) return meta.mid;
    if (meta.px > 0) return meta.px;
    if (meta.mark > 0) return meta.mark;
    const spec = coinSpec(c);
    return (spec && spec.fallback) || 0;
  }
  function markOf(id) {
    const meta = metaOf(id);
    if (meta.mark > 0) return meta.mark;
    return displayPx(id);
  }
  function setMeta(id, extra) {
    liveMeta[id] = Object.assign({}, liveMeta[id], extra);
  }
  function posNotional(p) {
    const px = displayPx(p.coin) || markOf(p.coin);
    return (p.qty || 0) * (px || 0);
  }
  function kindOf(c) { return CRYPTO[c.id] ? 'crypto' : 'stock'; }

  function parseNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    s = s.replace(/[\s$\u00a0]/g, '').replace(/[−–—]/g, '-');
    const neg = s.startsWith('-') || s.startsWith('+') ? s[0] : '';
    if (neg) s = s.slice(1);
    if (s.includes(',') && s.includes('.')) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const frac = s.split(',').pop();
      s = (frac.length === 3 && s.split(',').every((p, i) => i === 0 ? /^\d{1,3}$/.test(p) : p.length === 3))
        ? s.replace(/,/g, '')
        : s.replace(',', '.');
    }
    const n = parseFloat(s);
    return neg === '-' ? -n : n;
  }
  function priceDecimals(x) {
    const a = Math.abs(x);
    if (a >= 1000) return 2;
    if (a >= 100) return 3;
    if (a >= 1) return 4;
    if (a >= 0.01) return 6;
    if (a >= 0.0001) return 8;
    return 10;
  }
  function trimFixed(x, d) {
    if (!isFinite(x)) return '';
    let s = Math.abs(x).toFixed(d);
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return (x < 0 ? '-' : '') + s;
  }
  function fmtPrice(x, withDollar) {
    if (!isFinite(x) || !(x > 0) && x !== 0) return '—';
    const d = priceDecimals(x);
    const abs = Math.abs(x);
    const s = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
    return (x < 0 ? '−' : '') + (withDollar ? '$' + s : s);
  }
  function copyPrice(x) {
    if (!isFinite(x)) return '';
    return trimFixed(x, priceDecimals(x));
  }
  function fmtUsd(x, signed) {
    if (!isFinite(x)) return '—';
    const body = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sign = x < 0 || Object.is(x, -0) ? '−' : (signed && x > 0 ? '+' : '');
    return sign + '$' + body;
  }
  function fmtPct(x, signed) {
    if (!isFinite(x)) return '—';
    const body = trimFixed(Math.abs(x), 2);
    const sign = x < 0 ? '−' : (signed && x > 0 ? '+' : '');
    return sign + body + '%';
  }
  function fmtCap(x) {
    if (!isFinite(x)) return '—';
    if (Math.abs(x) >= 1000) return '$' + Math.round(x).toLocaleString('en-US');
    return fmtUsd(x);
  }
  function fmtMaxMargin(x) {
    if (!isFinite(x)) return '—';
    if (Math.abs(x - Math.round(x)) < 0.001 && Math.abs(x) >= 1) return fmtCap(x);
    return fmtUsd(x);
  }
  function fmtChgPct(p) {
    if (!isFinite(p)) return '—';
    return (p > 0 ? '+' : '') + p.toFixed(2) + '%';
  }
  function chgClass(p) {
    if (!isFinite(p) || Math.abs(p) < 0.0000001) return 'chg flat';
    return p > 0 ? 'chg up' : 'chg dn';
  }

  function maxMarginOf(cap, lev) {
    if (!(cap > 0) || !(lev > 0)) return NaN;
    return Math.floor((cap / lev) * 100) / 100;
  }
  function sizeLimit() {
    const lev = state.lev;
    if (!(lev >= 1)) return { available: false };
    if (isHl()) {
      const tiers = hlTiers[currentCoin().id];
      if (!Array.isArray(tiers) || !tiers.length) return { available: false };
      const next = tiers.find((t) => t.maxLev < lev);
      if (!next) return { available: true, uncapped: true };
      const cap = Number(next.lower);
      if (!(cap > 0)) return { available: true, uncapped: true };
      return { available: true, uncapped: false, cap: cap, maxMargin: maxMarginOf(cap, lev) };
    }
    const rows = asterBrackets[currentCoin().id];
    if (!Array.isArray(rows) || !rows.length) return { available: false };
    const br = rows.find((r) => lev >= r.min && lev <= r.max);
    if (!br || !(br.cap > 0)) return { available: false };
    return { available: true, uncapped: false, cap: br.cap, maxMargin: maxMarginOf(br.cap, lev) };
  }
  function marginCap() {
    const lim = sizeLimit();
    const free = freeMargin();
    const caps = [free];
    if (lim.available && !lim.uncapped && lim.maxMargin > 0) caps.push(lim.maxMargin);
    return Math.max(0, Math.min.apply(null, caps));
  }
  function clampMarginToLimit({ flash } = {}) {
    const lim = sizeLimit();
    if (!lim.available || lim.uncapped) return false;
    if (!(lim.maxMargin >= 0)) return false;
    if (state.margin > lim.maxMargin + 1e-9) {
      state.margin = lim.maxMargin;
      if (flash) flashMarginMax('Max ' + fmtMaxMargin(lim.maxMargin) + ' at ' + state.lev + 'x');
      return true;
    }
    return false;
  }
  function flashMarginMax(text) {
    const line = $('maxLine');
    const box = $('amtBox');
    if (line) { line.textContent = text; line.classList.add('warn'); }
    if (box) box.classList.add('flash-max');
    clearTimeout(marginFlashTimer);
    marginFlashTimer = setTimeout(() => {
      if (box) box.classList.remove('flash-max');
    }, 700);
  }

  function validBase() { return state.margin > 0 && plannedEntry() > 0 && state.lev >= 1; }
  function plannedEntry() {
    if (state.typ === 'limit' && state.limitPx > 0) return state.limitPx;
    return state.livePrice > 0 ? state.livePrice : state.entry;
  }
  function qty() {
    const e = plannedEntry();
    if (!(e > 0)) return 0;
    return (state.margin * state.lev) / e;
  }
  function positionNotional() { return state.margin * state.lev; }
  function pnlAt(exit) {
    const q = qty(), e = plannedEntry();
    return state.side === 'long' ? q * (exit - e) : q * (e - exit);
  }
  function exitFromPnl(target) {
    const q = qty(), e = plannedEntry();
    if (!(q > 0)) return NaN;
    return state.side === 'long' ? e + target / q : e - target / q;
  }
  function exitFromRoi(roiPct) { return exitFromPnl(state.margin * (roiPct / 100)); }
  function feesAt(exit) {
    const rate = Math.max(0, state.feePct) / 100;
    const open = positionNotional() * rate;
    const close = qty() * exit * rate;
    return { open, close, total: open + close };
  }
  function mmr() {
    const maxL = levMax() || 40;
    if (isHl()) return 1 / (2 * maxL);
    const cap = Math.max(0.0001, 1 / maxL - 0.0005);
    return Math.min(BASE_MMR, cap);
  }
  function liqPriceOf(side, entry, lev, maxL, plat) {
    if (!(entry > 0) || !(lev >= 1)) return NaN;
    const hl = plat === 'hyperliquid';
    const m = hl ? 1 / (2 * (maxL || lev)) : Math.min(BASE_MMR, Math.max(0.0001, 1 / (maxL || lev) - 0.0005));
    if (side === 'long') {
      const k = 1 - 1 / lev + m;
      return (k > 0 && k < 1) ? entry * k : NaN;
    }
    const k = 1 + 1 / lev - m;
    return (k > 1) ? entry * k : NaN;
  }
  function liqPrice() { return liqPriceOf(state.side, plannedEntry(), state.lev, levMax(), state.platform); }
  function liqMovePct(liq) {
    const e = plannedEntry();
    if (!isFinite(liq) || !(e > 0)) return NaN;
    return ((liq - e) / e) * 100;
  }
  function slBeyondLiq(slExit, liq) {
    if (!isFinite(slExit) || !isFinite(liq)) return false;
    return state.side === 'long' ? slExit <= liq : slExit >= liq;
  }

  function usedMargin() {
    let s = 0;
    (book.positions || []).forEach((p) => { s += +p.margin || 0; });
    (book.pending || []).forEach((p) => { s += +p.margin || 0; });
    return s;
  }
  function upnlTotal() {
    let s = 0;
    (book.positions || []).forEach((p) => { s += posPnl(p); });
    return s;
  }
  function freeMargin() {
    return Math.max(0, book.balance - usedMargin());
  }
  function equity() { return book.balance + upnlTotal(); }
  function posPnl(p) {
    const px = markOf(p.coin);
    if (!(px > 0) || !(p.qty > 0)) return 0;
    return p.side === 'long' ? p.qty * (px - p.entry) : p.qty * (p.entry - px);
  }
  function posRoe(p) {
    if (!(p.margin > 0)) return 0;
    return (posPnl(p) / p.margin) * 100;
  }

  function savePaper() {
    try { localStorage.setItem(PAPER_KEY, JSON.stringify(book)); } catch (e) { /* */ }
  }
  function saveCalc() {
    try {
      localStorage.setItem(CALC_KEY, JSON.stringify({
        coin: state.coin, platform: state.platform, side: state.side,
        margin: state.margin, lev: state.lev, entry: plannedEntry(),
        tp: state.tp, sl: state.sl, fees: state.fees, feePct: state.feePct
      }));
    } catch (e) { /* */ }
  }
  function saveUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        tf: state.tf, chartLines: state.chartLines, filter: state.filter, typ: state.typ, marginMode: state.marginMode
      }));
    } catch (e) { /* */ }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(CALC_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (COIN_BY_ID[o.coin]) state.coin = o.coin;
        if (o.platform === 'aster' || o.platform === 'hyperliquid') state.platform = o.platform;
        if (o.side === 'long' || o.side === 'short') state.side = o.side;
        if (o.margin > 0) state.margin = +o.margin;
        if (o.lev >= 1) state.lev = +o.lev;
        if (o.entry > 0) state.entry = +o.entry;
        if (isFinite(o.tp)) state.tp = o.tp;
        if (isFinite(o.sl)) state.sl = o.sl;
        if (o.fees) state.fees = Object.assign({}, state.fees, o.fees);
        if (isFinite(o.feePct) && o.feePct >= 0) state.fees[state.platform] = o.feePct;
      }
    } catch (e) { /* */ }
    state.feePct = state.fees[state.platform];
    try {
      const u = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
      if (u) {
        if (TFS.indexOf(u.tf) >= 0) state.tf = u.tf;
        if (u.chartLines) state.chartLines = Object.assign(state.chartLines, u.chartLines);
        if (u.filter) state.filter = u.filter;
        if (u.typ === 'limit' || u.typ === 'market') state.typ = u.typ;
        if (u.marginMode === 'cross' || u.marginMode === 'isolated') state.marginMode = u.marginMode;
      }
    } catch (e) { /* */ }
    try {
      const b = JSON.parse(localStorage.getItem(PAPER_KEY) || 'null');
      if (b && isFinite(b.balance)) {
        book.balance = +b.balance;
        book.positions = Array.isArray(b.positions) ? b.positions : [];
        book.pending = Array.isArray(b.pending) ? b.pending : [];
        book.history = Array.isArray(b.history) ? b.history : [];
        book.seq = +b.seq || book.positions.length + 1;
        if (Math.abs(book.balance - OLD_START_BAL) < 0.005) {
          book.balance = START_BAL;
          try { localStorage.setItem(PAPER_KEY, JSON.stringify(book)); } catch (err) { /* */ }
        }
      }
    } catch (e) { /* */ }
    state.lev = clampLev(state.lev);
  }

  function nextId(prefix) {
    book.seq = (book.seq || 1) + 1;
    return prefix + book.seq;
  }

  function hlTickerRow(map, coin) {
    const spec = coin.hl;
    if (!spec || !map) return null;
    const raw = spec.coin;
    const short = raw.replace(/^xyz:/, '');
    return map[raw] || map[short] || map['xyz:' + short] || map['xyz:xyz:' + short] || null;
  }

  async function hlInfo(body) {
    const r = await fetch(HL_INFO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    if (!r.ok) throw new Error('hl ' + r.status);
    return r.json();
  }

  function ingestHl(pair, dex) {
    const meta = pair && pair[0];
    const ctxs = pair && pair[1];
    const uni = (meta && meta.universe) || [];
    const out = {};
    uni.forEach((u, i) => {
      const ctx = ctxs && ctxs[i];
      const mark = parseFloat(ctx && ctx.markPx);
      const mid = parseFloat(ctx && ctx.midPx);
      const px = mid > 0 ? mid : (mark > 0 ? mark : parseFloat(ctx && ctx.oraclePx));
      const prev = parseFloat(ctx && ctx.prevDayPx);
      const fund = parseFloat(ctx && ctx.funding);
      const oi = parseFloat(ctx && ctx.openInterest);
      const vol = parseFloat(ctx && (ctx.dayNtlVlm || ctx.dayNtlVlM));
      const row = {
        px: px > 0 ? px : null,
        mid: mid > 0 ? mid : null,
        mark: mark > 0 ? mark : null,
        max: u.maxLeverage,
        prevDay: prev > 0 ? prev : null,
        funding: isFinite(fund) ? fund : null,
        oi: oi > 0 ? oi : null,
        volume: vol > 0 ? vol : null
      };
      const key = dex ? (dex + ':' + u.name) : u.name;
      out[key] = row;
      out[u.name] = row;
    });
    return out;
  }

  function applyHlTiers(pair, dex) {
    const meta = pair && pair[0];
    if (!meta) return;
    const tables = {};
    (meta.marginTables || []).forEach((item) => {
      if (Array.isArray(item)) tables[item[0]] = item[1];
    });
    const byName = {};
    (meta.universe || []).forEach((u) => { byName[u.name] = u; });
    COINS.forEach((c) => {
      if (!c.hl) return;
      const wantDex = c.hl.dex || null;
      if ((wantDex || null) !== (dex || null)) return;
      const raw = c.hl.coin;
      const short = raw.replace(/^xyz:/, '');
      const u = byName[raw] || byName[short] || byName['xyz:' + short];
      if (!u) return;
      const tid = u.marginTableId;
      const tbl = tables[tid];
      let tiers = null;
      if (tbl && Array.isArray(tbl.marginTiers) && tbl.marginTiers.length) {
        tiers = tbl.marginTiers.map((row) => ({
          lower: parseFloat(row.lowerBound),
          maxLev: row.maxLeverage
        }));
      } else if (tid != null && tid < 50) {
        tiers = [{ lower: 0, maxLev: u.maxLeverage || tid }];
      }
      if (tiers && tiers.length) hlTiers[c.id] = tiers;
    });
  }

  async function fetchHlMap(force) {
    if (!force && hlCache.map && (Date.now() - hlCache.at) < 15000) return hlCache.map;
    const [main, xyz] = await Promise.all([
      hlInfo({ type: 'metaAndAssetCtxs' }),
      hlInfo({ type: 'metaAndAssetCtxs', dex: 'xyz' })
    ]);
    const map = Object.assign({}, ingestHl(main, null), ingestHl(xyz, 'xyz'));
    COINS.forEach((c) => {
      if (!c.hl) return;
      const row = hlTickerRow(map, c);
      if (row && row.max > 0) c.hl.max = row.max;
      if (row) {
        liveMeta[c.id] = Object.assign({}, liveMeta[c.id], row);
        if (row.prevDay > 0 && row.px > 0) dayChange[c.id] = ((row.px / row.prevDay) - 1) * 100;
      }
    });
    applyHlTiers(main, null);
    applyHlTiers(xyz, 'xyz');
    hlCache = { at: Date.now(), map: map };
    return map;
  }

  async function fetchAsterPrice(symbol) {
    let mark = 0, fund = NaN, last = 0;
    try {
      const r = await fetch(ASTER_API + '/premiumIndex?symbol=' + encodeURIComponent(symbol), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        mark = parseFloat(j.markPrice);
        fund = parseFloat(j.lastFundingRate);
      }
    } catch (e) { /* try last price */ }
    try {
      const r = await fetch(ASTER_API + '/ticker/price?symbol=' + encodeURIComponent(symbol), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        last = parseFloat(j.price);
      }
    } catch (e) { /* fallback */ }
    if (!(mark > 0) && !(last > 0)) return null;
    const out = {};
    if (mark > 0) out.mark = mark;
    if (isFinite(fund)) out.funding = fund;
    if (last > 0) { out.trade = last; out.px = last; }
    else out.px = mark;
    return out;
  }

  async function refreshAsterDayChange() {
    try {
      const r = await fetch(ASTER_API + '/ticker/24hr', { cache: 'no-store' });
      if (!r.ok) return;
      const list = await r.json();
      const by = {};
      (Array.isArray(list) ? list : []).forEach((row) => { by[row.symbol] = row; });
      COINS.forEach((c) => {
        if (!c.aster) return;
        const row = by[c.aster.symbol];
        if (!row) return;
        const pct = parseFloat(row.priceChangePercent);
        if (isFinite(pct)) dayChange[c.id] = pct;
        const last = parseFloat(row.lastPrice);
        const vol = parseFloat(row.quoteVolume || row.volume);
        const patch = {};
        if (last > 0) patch.px = last;
        if (vol > 0) patch.volume = vol;
        if (Object.keys(patch).length) liveMeta[c.id] = Object.assign({}, liveMeta[c.id], patch);
      });
    } catch (e) { /* keep last */ }
  }

  async function refreshAsterBrackets() {
    try {
      const r = await fetch(ASTER_BRACKET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
        cache: 'no-store'
      });
      if (!r.ok) return;
      const j = await r.json();
      const list = j && j.data && j.data.brackets;
      if (!Array.isArray(list)) return;
      const by = {};
      list.forEach((item) => { by[item.symbol] = item.riskBrackets || []; });
      COINS.forEach((c) => {
        const rows = c.aster && by[c.aster.symbol];
        if (!rows || !rows.length) return;
        asterBrackets[c.id] = rows.map((row) => ({
          min: row.minOpenPosLeverage,
          max: row.maxOpenPosLeverage,
          cap: Number(row.bracketNotionalCap)
        }));
      });
      clampMarginToLimit({ flash: false });
    } catch (e) { /* snapshot */ }
  }

  async function fetchLiveFor(coin) {
    const c = coin || currentCoin();
    if (isHl()) {
      try {
        const map = await fetchHlMap(true);
        const row = hlTickerRow(map, c);
        if (row) {
          setMeta(c.id, row);
          if (row.trade > 0) return row.trade;
          return null;
        }
      } catch (e) { /* */ }
      return null;
    }
    if (!c.aster || !c.aster.symbol) return null;
    const got = await fetchAsterPrice(c.aster.symbol);
    if (got) {
      setMeta(c.id, got);
      if (got.trade > 0) return got.trade;
      return null;
    }
    return null;
  }

  async function refreshPrice({ fillEntry, quiet } = {}) {
    const coin = currentCoin();
    const spec = coinSpec(coin);
    const gen = ++fetchGen;
    state.priceStatus = 'loading';
    const live = await fetchLiveFor(coin);
    if (gen !== fetchGen) return;
    const fallback = spec && spec.fallback;
    if (live > 0) {
      state.livePrice = live;
      state.priceStatus = 'live';
      if (fillEntry) state.entry = live;
    } else if (state.livePrice > 0) {
      state.priceStatus = wsIsLive() || lastTickAt ? 'live' : state.priceStatus;
      if (fillEntry) state.entry = state.livePrice;
    } else {
      const mid = (liveMeta[coin.id] && (liveMeta[coin.id].mid || liveMeta[coin.id].px || liveMeta[coin.id].mark)) || 0;
      state.livePrice = mid || fallback || null;
      state.priceStatus = mid ? 'live' : 'fallback';
      if (fillEntry && state.livePrice > 0) state.entry = state.livePrice;
      if (!quiet && !(state.livePrice > 0)) toast('No price from ' + platformName() + ', using last known');
    }
    if (!quiet) saveCalc();
    tickBook();
    renderAll();
    renderLiveSrc();
  }

  async function refreshDayChange() {
    try {
      if (isHl()) await fetchHlMap(true);
      else await Promise.all([
        refreshAsterDayChange().catch(function () {}),
        fetchHlMap(false).catch(function () {})
      ]);
    } catch (e) { /* keep last */ }
    renderMarkets();
    renderAssetHead();
  }

  function setView(name) {
    state.view = name;
    if (isDesktop()) {
      if (name === 'calc') setRightTab('calc');
      else if (name === 'asset' || name === 'markets') setRightTab('trade');
      document.querySelectorAll('#tabbar [data-view]').forEach((b) => {
        b.classList.toggle('on', b.getAttribute('data-view') === name);
      });
      requestAnimationFrame(() => { sizeChart(); renderOverlay(); renderDrawings(); });
      renderPositions();
      renderAccount();
      return;
    }
    ['markets', 'asset', 'positions', 'calc'].forEach((v) => {
      const map = { markets: 'screenMarkets', asset: 'screenAsset', positions: 'screenPos', calc: 'screenCalc' };
      const el = $(map[v]);
      if (el) el.classList.toggle('on', v === name);
    });
    document.querySelectorAll('#tabbar [data-view]').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-view') === name);
    });
    if (name === 'asset') {
      requestAnimationFrame(() => { sizeChart(); renderOverlay(); });
    }
    renderPositions();
    renderAccount();
  }

  function setRightTab(tab) {
    state.rightTab = tab === 'calc' ? 'calc' : 'trade';
    const dock = $('deskRight');
    if (dock) dock.classList.toggle('calc-on', state.rightTab === 'calc');
    document.querySelectorAll('#deskRightTabs [data-rtab]').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-rtab') === state.rightTab);
    });
    if (isDesktop()) {
      if ($('orderSheet')) $('orderSheet').hidden = state.rightTab === 'calc';
      if ($('orderScrim')) $('orderScrim').hidden = true;
      if (state.rightTab === 'trade') renderOrder();
    }
  }

  function setBookTab(tab) {
    if (tab !== 'positions' && tab !== 'orders' && tab !== 'history') tab = 'positions';
    state.bookTab = tab;
    document.querySelectorAll('#bookTabs [data-book]').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-book') === tab);
    });
    const title = $('screenPos') && $('screenPos').querySelector('.sec-title');
    if (title) title.textContent = tab === 'orders' ? 'Open orders' : tab === 'history' ? 'History' : 'Positions';
    renderPositions();
  }

  function openCoin(id) {
    const coin = COIN_BY_ID[id];
    if (!coin || !coinAvailable(coin)) { toast('Not on ' + platformName()); return; }
    state.coin = coin.id;
    state.livePrice = null;
    lastTickAt = 0;
    clearCrosshair();
    resetOrderBook();
    state.lev = clampLev(state.lev);
    clampMarginToLimit({ flash: false });
    saveCalc();
    setView('asset');
    renderAll();
    refreshPrice({ fillEntry: true, quiet: true });
    loadChart();
  }

  function setPlatform(id) {
    if (id !== 'aster' && id !== 'hyperliquid') return;
    if (state.platform === id) return;
    state.platform = id;
    state.feePct = state.fees[id];
    if (!coinAvailable(currentCoin())) {
      const first = COINS.find((c) => coinAvailable(c));
      if (first) state.coin = first.id;
    }
    state.lev = clampLev(state.lev);
    state.livePrice = null;
    clampMarginToLimit({ flash: true });
    saveCalc();
    renderAll();
    refreshPrice({ fillEntry: true, quiet: true });
    refreshDayChange();
    subscribeLive();
    if (state.view === 'asset' || isDesktop()) loadChart();
  }

  /* ——— paper engine ——— */
  function err(msg) {
    const el = $('orderErr');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.textContent = msg;
  }

  function placeOrder() {
    err('');
    const c = currentCoin();
    const entry = plannedEntry();
    if (!(state.margin > 0)) { err('Enter a margin amount.'); return; }
    if (!(entry > 0)) { err('No price yet.'); return; }
    clampMarginToLimit({ flash: true });
    if (state.margin > freeMargin() + 1e-8) { err('Not enough available margin.'); return; }
    const q = qty();
    if (!(q > 0)) { err('Size is too small.'); return; }
    const liq = liqPrice();
    const tpPx = state.tp == null ? null : exitFromRoi(state.tp);
    const slPx = state.sl == null ? null : exitFromRoi(state.sl);
    const rate = Math.max(0, state.feePct) / 100;
    const rec = {
      id: nextId('P'),
      coin: c.id,
      platform: state.platform,
      side: state.side,
      typ: state.typ,
      marginMode: state.marginMode,
      margin: state.margin,
      lev: state.lev,
      maxLev: levMax(),
      qty: q,
      entry: entry,
      tp: isFinite(tpPx) ? tpPx : null,
      sl: isFinite(slPx) ? slPx : null,
      liq: isFinite(liq) ? liq : null,
      feeRate: rate,
      openFee: positionNotional() * rate,
      t: Date.now()
    };
    if (state.typ === 'limit') {
      const px = displayPx(c.id);
      const fillNow = rec.side === 'long' ? px <= rec.entry : px >= rec.entry;
      if (!fillNow) {
        book.pending.push(rec);
        savePaper();
        closeOrder();
        clearCrosshair();
        toast('Limit resting at ' + fmtPrice(rec.entry, true));
        renderAll();
        renderOverlay();
        return;
      }
    }
    fillPosition(rec, rec.entry, 'market');
  }

  function fillPosition(rec, fill, reason) {
    rec.entry = fill;
    rec.liq = liqPriceOf(rec.side, rec.entry, rec.lev, rec.maxLev, rec.platform);
    rec.openFee = Math.abs(rec.entry * rec.qty) * (rec.feeRate || 0);
    rec.openedAt = Date.now();
    book.balance -= rec.openFee;
    book.positions.push(rec);
    book.pending = (book.pending || []).filter((p) => p.id !== rec.id);
    savePaper();
    closeOrder();
    clearCrosshair();
    toast((rec.side === 'long' ? 'Long' : 'Short') + ' ' + rec.coin + ' filled at ' + fmtPrice(fill, true));
    setView('asset');
    renderAll();
    renderOverlay();
  }

  function closePosition(id, reason) {
    const i = book.positions.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = book.positions[i];
    const exit = markOf(p.coin);
    if (!(exit > 0)) { toast('No price to close.'); return; }
    const pnl = p.side === 'long' ? p.qty * (exit - p.entry) : p.qty * (p.entry - exit);
    const closeFee = Math.abs(exit * p.qty) * (p.feeRate || 0);
    const net = pnl - closeFee;
    book.balance += net;
    book.history.unshift({
      id: p.id, coin: p.coin, side: p.side, entry: p.entry, exit: exit,
      pnl: net, reason: reason || 'manual', t: Date.now()
    });
    book.positions.splice(i, 1);
    savePaper();
    toast((reason === 'tp' ? 'Take profit' : reason === 'sl' ? 'Stop loss' : reason === 'liq' ? 'Liquidated' : 'Closed') +
      ' ' + p.coin + ' · ' + fmtUsd(net, true));
    renderAll();
    renderOverlay();
  }

  function tickBook() {
    const pending = (book.pending || []).slice();
    pending.forEach((o) => {
      const px = displayPx(o.coin);
      if (!(px > 0)) return;
      const hit = o.side === 'long' ? px <= o.entry : px >= o.entry;
      if (hit) fillPosition(o, o.entry, 'limit');
    });
    (book.positions || []).slice().forEach((p) => {
      const px = markOf(p.coin);
      if (!(px > 0)) return;
      if (p.liq > 0) {
        const hitLiq = p.side === 'long' ? px <= p.liq : px >= p.liq;
        if (hitLiq) { closePosition(p.id, 'liq'); return; }
      }
      if (p.sl > 0) {
        const hitSl = p.side === 'long' ? px <= p.sl : px >= p.sl;
        if (hitSl) { closePosition(p.id, 'sl'); return; }
      }
      if (p.tp > 0) {
        const hitTp = p.side === 'long' ? px >= p.tp : px <= p.tp;
        if (hitTp) { closePosition(p.id, 'tp'); }
      }
    });
  }

  function resetAccount() {
    if (!confirm('Reset the paper account to $30,000? Positions and orders will be cleared.')) return;
    book = { balance: START_BAL, positions: [], pending: [], history: [], seq: 1 };
    savePaper();
    toast('Account reset to $30,000');
    renderAll();
    renderOverlay();
  }

  /* ——— chart ——— */
  function chartOptions() {
    return {
      layout: { background: { color: '#000000' }, textColor: '#8a8a8a', fontSize: 11 },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#222222', style: 2, visible: true }
      },
      rightPriceScale: { borderColor: '#1a1a1a', scaleMargins: { top: 0.08, bottom: 0.12 } },
      timeScale: {
        borderColor: '#1a1a1a', timeVisible: true, secondsVisible: state.tf === '1m',
        barSpacing: 8, minBarSpacing: 3, rightOffset: 6
      },
      crosshair: { vertLine: { color: '#333', labelBackgroundColor: '#222' }, horzLine: { color: '#333', labelBackgroundColor: '#222' } },
      handleScroll: { pinch: true, mouseWheel: true },
      handleScale: { pinch: true, axisPressedMouseMove: true }
    };
  }
  function candleStyle() {
    return {
      upColor: UP, downColor: DN,
      borderVisible: true,
      borderUpColor: UP, borderDownColor: DN,
      wickUpColor: UP, wickDownColor: DN
    };
  }
  function sizeChart() {
    if (chart && $('chart')) chart.applyOptions({ width: $('chart').clientWidth, height: $('chart').clientHeight });
  }
  function tfSeconds(tf) {
    return (TF_MS[tf || state.tf] || 60e3) / 1000;
  }
  function toUnixSec(t) {
    t = Number(t);
    if (!isFinite(t) || t <= 0) return 0;
    if (t > 1e11) t = t / 1000;
    return Math.floor(t);
  }
  function bucketTime(t, tf) {
    const step = tfSeconds(tf);
    t = toUnixSec(t);
    if (!t || !step) return 0;
    return Math.floor(t / step) * step;
  }
  function parseBar(row, tf) {
    if (!row) return null;
    const time = bucketTime(row.t || row.T || row.time, tf);
    const open = +row.o, high = +row.h, low = +row.l, close = +row.c;
    if (!time || !(close > 0) || !(open > 0)) return null;
    return {
      time: time,
      open: open,
      high: high > 0 ? Math.max(high, open, close) : Math.max(open, close),
      low: low > 0 ? Math.min(low, open, close) : Math.min(open, close),
      close: close
    };
  }
  function normalizeBars(list, tf) {
    const map = new Map();
    (list || []).forEach((raw) => {
      let b = null;
      if (raw && raw.time && raw.close != null && raw.open != null && raw.o == null) {
        const time = bucketTime(raw.time, tf) || toUnixSec(raw.time);
        if (!time || !(+raw.close > 0) || !(+raw.open > 0)) return;
        b = {
          time: time,
          open: +raw.open,
          high: Math.max(+raw.high || 0, +raw.open, +raw.close),
          low: Math.min(+raw.low || +raw.open, +raw.open, +raw.close),
          close: +raw.close
        };
      } else {
        b = parseBar(raw, tf);
      }
      if (!b || !b.time || !(b.close > 0)) return;
      const prev = map.get(b.time);
      if (!prev) map.set(b.time, b);
      else {
        map.set(b.time, {
          time: b.time,
          open: prev.open,
          high: Math.max(prev.high, b.high),
          low: Math.min(prev.low, b.low),
          close: b.close
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }
  function showRecentBars() {
    if (!chart || !bars.length) return;
    const vis = state.tf === '1m' ? 180 : state.tf === '5m' ? 160 : state.tf === '15m' ? 140 : 120;
    const from = Math.max(0, bars.length - vis);
    try { chart.timeScale().setVisibleLogicalRange({ from: from, to: bars.length + 4 }); } catch (e) { /* */ }
  }
  async function loadChart() {
    const host = $('chart');
    if (!host) return;
    const c = currentCoin();
    histGen += 1;
    const gen = histGen;
    histLoading = false;
    histEOF = false;
    if (!window.LightweightCharts) {
      host.innerHTML = '<div style="padding:20px;color:#8a8a8a">Chart library failed to load.</div>';
      return;
    }
    if (chart) {
      try { chart.remove(); } catch (e) { /* */ }
      chart = series = null;
    }
    host.innerHTML = '';
    chart = LightweightCharts.createChart(host, Object.assign({ width: host.clientWidth, height: host.clientHeight }, chartOptions()));
    series = chart.addCandlestickSeries(candleStyle());
    chart.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
      renderOverlay(); renderDrawings();
      maybeLoadOlder(range);
    });
    bars = [];
    const end = Date.now();
    const want = end - (TF_INIT_MS[state.tf] || 7 * 86400e3);
    try {
      if (useAsterChart(c)) bars = await fetchCandlePages(state.tf, want, end, function (startMs, endMs) {
        return fetchAsterKlines(c.aster.symbol, state.tf, endMs, ASTER_KLINE_LIMIT);
      });
      else bars = await fetchCandlePages(state.tf, want, end, function (startMs, endMs) {
        return fetchHlKlines(c.hl && c.hl.coin, state.tf, startMs, endMs);
      });
      if (gen !== histGen) return;
      bars = normalizeBars(bars, state.tf);
      series.setData(bars);
      showRecentBars();
      if (bars.length && bars[bars.length - 1].close > 0) {
        const close = bars[bars.length - 1].close;
        state.livePrice = close;
        setMeta(c.id, { trade: close, px: close });
      }
    } catch (e) {
      if (gen !== histGen) return;
      bars = [];
      try { series.setData([]); } catch (err) { /* */ }
      host.insertAdjacentHTML('beforeend', '<div class="chart-empty">No candles from ' + (useAsterChart(c) ? 'Aster' : 'Hyperliquid') + '</div>');
    }
    subscribeLive();
    renderOverlay();
    renderDrawings();
    renderLiveSrc();
    renderAssetHead();
  }
  async function fetchCandlePages(tf, wantStartMs, endMs, fetchPage) {
    let end = endMs || Date.now();
    const want = wantStartMs || (end - (TF_INIT_MS[tf] || 7 * 86400e3));
    let all = [];
    for (let i = 0; i < 8 && end > want; i++) {
      const chunk = await fetchPage(want, end);
      if (!chunk || !chunk.length) break;
      all = chunk.concat(all);
      const oldest = chunk[0].time * 1000;
      if (oldest <= want + tfSeconds(tf) * 1000) break;
      if (chunk.length < 5) break;
      end = oldest - 1;
    }
    return normalizeBars(all, tf);
  }
  async function maybeLoadOlder(range) {
    if (!range || histLoading || histEOF || !bars.length || !chart || !series) return;
    if (!(range.from < 12)) return;
    histLoading = true;
    const gen = histGen;
    const oldest = bars[0].time;
    const endMs = oldest * 1000 - 1;
    const tf = state.tf;
    const c = currentCoin();
    let more = [];
    try {
      if (useAsterChart(c)) more = await fetchAsterKlines(c.aster.symbol, tf, endMs, ASTER_KLINE_LIMIT);
      else more = await fetchHlKlines(c.hl && c.hl.coin, tf, endMs - (TF_MS[tf] || 60e3) * HL_CANDLE_CAP, endMs);
    } catch (e) { more = []; }
    if (gen !== histGen) { histLoading = false; return; }
    more = normalizeBars(more, tf).filter((b) => b.time < oldest);
    if (!more.length) { histEOF = true; histLoading = false; return; }
    let vr = null;
    try { vr = chart.timeScale().getVisibleRange(); } catch (e) { /* */ }
    bars = normalizeBars(more.concat(bars), tf);
    series.setData(bars);
    if (vr) {
      try { chart.timeScale().setVisibleRange(vr); } catch (e) { /* */ }
    }
    histLoading = false;
    renderOverlay(); renderDrawings();
  }

  function yAt(price) {
    if (!series || !(price > 0)) return null;
    const y = series.priceToCoordinate(price);
    return y == null ? null : y;
  }
  function renderOverlay() {
    const el = $('chartOverlay');
    if (!el) return;
    const lines = state.chartLines || {};
    const list = (book.positions || []).filter((p) => p.coin === state.coin);
    let html = '';
    list.forEach((p) => {
      const lc = p.side === 'long' ? UP : DN;
      const u = posPnl(p), roe = posRoe(p);
      if (lines.entry !== false && yAt(p.entry) != null) {
        const y = yAt(p.entry);
        html += '<div class="tv-row" style="top:' + y + 'px;--lc:' + lc + '">' +
          '<div class="tv-hline solid"></div>' +
          '<div class="tv-pnl' + (u < 0 ? ' neg' : '') + '">' + fmtUsd(u, true) + ' · ' + fmtPct(roe, true) +
          '<button type="button" class="tv-x" data-close="' + p.id + '" aria-label="Close position">×</button></div>' +
          '<div class="tv-lab">Entry ' + fmtPrice(p.entry) + '</div></div>';
      }
      if (lines.tp !== false && p.tp > 0 && yAt(p.tp) != null) {
        html += '<div class="tv-row" style="top:' + yAt(p.tp) + 'px;--lc:' + UP + '"><div class="tv-hline"></div><div class="tv-lab">TP ' + fmtPrice(p.tp) + '</div></div>';
      }
      if (lines.sl !== false && p.sl > 0 && yAt(p.sl) != null) {
        html += '<div class="tv-row" style="top:' + yAt(p.sl) + 'px;--lc:' + DN + '"><div class="tv-hline"></div><div class="tv-lab">SL ' + fmtPrice(p.sl) + '</div></div>';
      }
      if (lines.liq !== false && p.liq > 0 && yAt(p.liq) != null) {
        html += '<div class="tv-row" style="top:' + yAt(p.liq) + 'px;--lc:' + ORANGE + '"><div class="tv-hline"></div><div class="tv-lab liq">Liq ' + fmtPrice(p.liq) + '</div></div>';
      }
    });
    (book.pending || []).filter((o) => o.coin === state.coin).forEach((o) => {
      if (!(o.entry > 0) || yAt(o.entry) == null) return;
      const y = yAt(o.entry);
      const side = o.side === 'short' ? 'Short' : 'Long';
      const qty = trimFixed(o.qty, o.qty >= 1 ? 4 : 6);
      html += '<div class="tv-row tv-limit-row" style="top:' + y + 'px;--lc:#fff">' +
        '<div class="tv-hline tv-limit-line"></div>' +
        '<div class="tv-limit-box" data-drag-limit="' + o.id + '">Limit ' + side + ' ' + qty + ' @ ' + fmtPrice(o.entry) +
        '<button type="button" class="tv-x" data-cancel="' + o.id + '" aria-label="Cancel order">×</button></div></div>';
    });
    el.innerHTML = html;
  }

  function movePending(id, price) {
    if (!(price > 0)) return;
    const o = (book.pending || []).find((p) => p.id === id);
    if (!o) return;
    o.entry = price;
    o.liq = liqPriceOf(o.side, o.entry, o.lev, o.maxLev, o.platform);
    savePaper();
    renderOverlay();
    renderPositions();
  }

  /* ——— render ——— */
  function renderAccount() {
    const eq = equity(), upnl = upnlTotal();
    const set = (id, val, cls) => {
      const el = $(id); if (!el) return;
      el.textContent = val;
      if (cls != null) el.className = cls;
    };
    const pnlCls = 'bal-pnl' + (upnl > 0 ? ' up' : upnl < 0 ? ' dn' : '');
    set('hdrBal', fmtUsd(book.balance));
    set('hdrPnl', fmtUsd(upnl, true), pnlCls);
    set('deskBal', fmtUsd(book.balance));
    set('deskPnl', fmtUsd(upnl, true), pnlCls);
    set('posBal', fmtUsd(eq));
    set('availBal', fmtUsd(freeMargin()));
  }

  function renderMarkets() {
    const list = $('mktList'); if (!list) return;
    const q = (state.mktQuery || '').trim().toLowerCase();
    let html = '';
    COINS.forEach((c) => {
      if (state.filter === 'crypto' && kindOf(c) !== 'crypto') return;
      if (state.filter === 'stock' && kindOf(c) === 'crypto') return;
      if (!coinAvailable(c)) return;
      if (q) {
        const blob = (c.name + ' ' + (NAMES[c.id] || '') + ' ' + c.id).toLowerCase();
        if (blob.indexOf(q) < 0) return;
      }
      const px = displayPx(c.id);
      const chg = dayChange[c.id];
      const max = (coinSpec(c) && coinSpec(c).max) || '';
      const on = c.id === state.coin ? ' on' : '';
      html += '<button type="button" class="mkt-row' + on + '" data-coin="' + c.id + '">' +
        '<img class="logo" src="' + logoSrc(c.id) + '" alt="">' +
        '<div class="mkt-id"><b>' + c.name + '</b><span>' + (NAMES[c.id] || c.name) + '</span></div>' +
        '<span class="lev-badge">' + max + 'x</span>' +
        '<div class="mkt-px"><b>' + fmtPrice(px, true) + '</b><span class="' + chgClass(chg) + '">' + fmtChgPct(chg) + '</span></div>' +
        '</button>';
    });
    list.innerHTML = html || '<div class="pos-empty">No markets</div>';
  }

  function renderAssetHead() {
    const c = currentCoin();
    const px = displayPx(c.id);
    const chg = dayChange[c.id];
    const meta = liveMeta[c.id] || {};
    if ($('assetName')) $('assetName').textContent = c.name;
    const logo = $('assetLogo');
    if (logo) { logo.src = logoSrc(c.id); logo.alt = c.name; }
    if ($('assetLev')) $('assetLev').textContent = levMax() + 'x';
    const fund = meta.funding != null ? ((meta.funding * 100).toFixed(4) + '%') : '—';
    const oi = meta.oi > 0 ? fmtUsd(meta.oi * (px || 0), false) : '';
    const markBit = meta.mark > 0 ? 'Mark ' + fmtPrice(meta.mark, true) + ' · ' : '';
    if ($('assetMeta')) $('assetMeta').textContent = markBit + 'Fund ' + fund + (oi ? ' · OI ' + oi : '');
    if ($('assetPx')) $('assetPx').textContent = fmtPrice(px, true);
    const chgEl = $('assetChg');
    if (chgEl) { chgEl.textContent = fmtChgPct(chg); chgEl.className = chgClass(chg); }
  }

  function posHtml(p, compact) {
    const u = posPnl(p), roe = posRoe(p);
    return '<div class="pos-item" data-open="' + p.coin + '">' +
      '<div class="pos-h"><span class="side ' + p.side + '">' + p.side.toUpperCase() + '</span><b>' + p.coin + '</b>' +
      '<span class="meta">' + (p.marginMode || 'isolated') + ' ' + p.lev + 'x</span></div>' +
      '<div class="pos-grid">' +
      '<div><span>Size</span><b>' + trimFixed(p.qty, 6) + '</b></div>' +
      '<div><span>Margin</span><b data-margin="' + p.id + '">' + fmtUsd(p.margin || 0) + '</b></div>' +
      '<div><span>Position</span><b data-notional="' + p.id + '">' + fmtUsd(posNotional(p)) + '</b></div>' +
      '<div><span>Entry</span><b>' + fmtPrice(p.entry, true) + '</b></div>' +
      '<div><span>Mark</span><b data-mark="' + p.coin + '">' + fmtPrice(displayPx(p.coin), true) + '</b></div>' +
      '<div><span>Liq</span><b>' + (p.liq ? fmtPrice(p.liq, true) : '—') + '</b></div>' +
      '<div><span>TP / SL</span><b>' + (p.tp ? fmtPrice(p.tp) : '—') + ' / ' + (p.sl ? fmtPrice(p.sl) : '—') + '</b></div>' +
      '<div><span>PnL</span><b class="' + chgClass(u) + '" data-pnl="' + p.id + '">' + fmtUsd(u, true) + ' · ' + fmtPct(roe, true) + '</b></div>' +
      '</div>' +
      '<button type="button" class="pos-close" data-close="' + p.id + '">Close position</button></div>';
  }

  function renderPosCard() {
    const el = $('posCard'); if (!el) return;
    const list = (book.positions || []).filter((p) => p.coin === state.coin);
    if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = list.map((p) => posHtml(p)).join('');
  }

  function reasonLabel(r) {
    return r === 'tp' ? 'Take profit' : r === 'sl' ? 'Stop loss' : r === 'liq' ? 'Liquidated' : r === 'limit' ? 'Limit' : 'Closed';
  }
  function fmtTime(t) {
    if (!t) return '—';
    try {
      return new Date(t).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return new Date(t).toLocaleString();
    }
  }
  function renderBookTable() {
    const el = $('posList'); if (!el) return;
    const tab = state.bookTab || 'positions';
    document.querySelectorAll('#bookTabs [data-book]').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-book') === tab);
    });
    const title = $('screenPos') && $('screenPos').querySelector('.sec-title');
    if (title) title.textContent = tab === 'orders' ? 'Open orders' : tab === 'history' ? 'History' : 'Positions';
    if (tab === 'orders') {
      const pend = book.pending || [];
      if (!pend.length) { el.innerHTML = '<div class="pos-empty">No open orders</div>'; return; }
      el.innerHTML = '<table class="book-table"><thead><tr><th>Side</th><th>Market</th><th class="num">Limit</th><th class="num">Margin</th><th>Lev</th><th></th></tr></thead><tbody>' +
        pend.map((o) =>
          '<tr data-open="' + o.coin + '"><td class="side ' + o.side + '">' + o.side.toUpperCase() + '</td><td><b>' + o.coin + '</b></td>' +
          '<td class="num">' + fmtPrice(o.entry, true) + '</td><td class="num">' + fmtUsd(o.margin) + '</td><td>' + o.lev + 'x</td>' +
          '<td><button type="button" class="pos-close" data-cancel="' + o.id + '">Cancel</button></td></tr>'
        ).join('') + '</tbody></table>';
      return;
    }
    if (tab === 'history') {
      const hist = book.history || [];
      if (!hist.length) { el.innerHTML = '<div class="pos-empty">No history yet</div>'; return; }
      el.innerHTML = '<table class="book-table"><thead><tr><th>Time</th><th>Side</th><th>Market</th><th class="num">Entry</th><th class="num">Exit</th><th class="num">PnL</th><th>Reason</th></tr></thead><tbody>' +
        hist.map((h) =>
          '<tr data-open="' + h.coin + '"><td>' + fmtTime(h.t) + '</td><td class="side ' + h.side + '">' + (h.side || '').toUpperCase() + '</td><td><b>' + h.coin + '</b></td>' +
          '<td class="num">' + fmtPrice(h.entry, true) + '</td><td class="num">' + fmtPrice(h.exit, true) + '</td>' +
          '<td class="num ' + chgClass(h.pnl) + '">' + fmtUsd(h.pnl, true) + '</td><td>' + reasonLabel(h.reason) + '</td></tr>'
        ).join('') + '</tbody></table>';
      return;
    }
    const list = book.positions || [];
    if (!list.length) { el.innerHTML = '<div class="pos-empty">No open positions</div>'; return; }
    el.innerHTML = '<table class="book-table"><thead><tr><th>Side</th><th>Market</th><th>Mode</th><th class="num">Size</th><th class="num">Margin</th><th class="num">Position</th><th class="num">Entry</th><th class="num">Mark</th><th class="num">Liq</th><th>TP / SL</th><th class="num">PnL</th><th></th></tr></thead><tbody>' +
      list.map((p) => {
        const u = posPnl(p), roe = posRoe(p);
        return '<tr data-open="' + p.coin + '"><td class="side ' + p.side + '">' + p.side.toUpperCase() + '</td><td><b>' + p.coin + '</b></td>' +
          '<td>' + (p.marginMode || 'isolated') + ' ' + p.lev + 'x</td>' +
          '<td class="num">' + trimFixed(p.qty, 6) + '</td>' +
          '<td class="num" data-margin="' + p.id + '">' + fmtUsd(p.margin || 0) + '</td>' +
          '<td class="num" data-notional="' + p.id + '">' + fmtUsd(posNotional(p)) + '</td>' +
          '<td class="num">' + fmtPrice(p.entry, true) + '</td>' +
          '<td class="num" data-mark="' + p.coin + '">' + fmtPrice(markOf(p.coin), true) + '</td>' +
          '<td class="num">' + (p.liq ? fmtPrice(p.liq, true) : '—') + '</td>' +
          '<td>' + (p.tp ? fmtPrice(p.tp) : '—') + ' / ' + (p.sl ? fmtPrice(p.sl) : '—') + '</td>' +
          '<td class="num ' + chgClass(u) + '" data-pnl="' + p.id + '">' + fmtUsd(u, true) + ' · ' + fmtPct(roe, true) + '</td>' +
          '<td><button type="button" class="pos-close" data-close="' + p.id + '">Close</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function renderPositions() {
    renderPosCard();
    const el = $('posList'); if (!el) return;
    if (isDesktop()) { renderBookTable(); return; }
    const list = book.positions || [];
    const pend = book.pending || [];
    if (!list.length && !pend.length) {
      el.innerHTML = '<div class="pos-empty">No open positions</div>';
      return;
    }
    let html = list.map((p) => posHtml(p)).join('');
    if (pend.length) {
      html += pend.map((o) =>
        '<div class="pos-item"><div class="pos-h"><span class="side ' + o.side + '">' + o.side.toUpperCase() + '</span><b>' + o.coin + '</b><span class="meta">Limit ' + fmtPrice(o.entry, true) + '</span></div>' +
        '<button type="button" class="pos-close" data-cancel="' + o.id + '">Cancel order</button></div>'
      ).join('');
    }
    el.innerHTML = html;
  }
  function patchLiveUi() {
    document.querySelectorAll('.mkt-row[data-coin]').forEach((row) => {
      const id = row.getAttribute('data-coin');
      const px = displayPx(id);
      const chg = dayChange[id];
      const b = row.querySelector('.mkt-px b');
      const c = row.querySelector('.mkt-px .chg, .mkt-px [class*="chg"]');
      if (b) b.textContent = fmtPrice(px, true);
      if (c) { c.textContent = fmtChgPct(chg); c.className = chgClass(chg); }
    });
    document.querySelectorAll('[data-mark]').forEach((el) => {
      el.textContent = fmtPrice(markOf(el.getAttribute('data-mark')), true);
    });
    document.querySelectorAll('[data-notional]').forEach((el) => {
      const p = (book.positions || []).find((x) => x.id === el.getAttribute('data-notional'));
      if (p) el.textContent = fmtUsd(posNotional(p));
    });
    document.querySelectorAll('[data-pnl]').forEach((el) => {
      const p = (book.positions || []).find((x) => x.id === el.getAttribute('data-pnl'));
      if (!p) return;
      const u = posPnl(p), roe = posRoe(p);
      el.textContent = fmtUsd(u, true) + ' · ' + fmtPct(roe, true);
      el.className = (el.className || '').replace(/\b(chg|up|dn)\b/g, '').trim() + ' ' + chgClass(u);
    });
    renderAccount();
  }

  function renderTf() {
    const row = $('tfRow'); if (!row) return;
    row.innerHTML = TFS.map((tf) =>
      '<button type="button" data-tf="' + tf + '"' + (tf === state.tf ? ' class="on"' : '') + '>' + TF_LABEL[tf] + '</button>'
    ).join('');
  }

  function renderPlatform() {
    if ($('btnAster')) $('btnAster').classList.toggle('on', !isHl());
    if ($('btnHl')) $('btnHl').classList.toggle('on', isHl());
  }

  function renderOrder() {
    const c = currentCoin();
    const sideWord = state.side === 'short' ? 'Short' : 'Long';
    if ($('orderTitle')) $('orderTitle').textContent = sideWord + ' ' + c.name;
    if ($('orderSub')) $('orderSub').textContent = fmtPrice(markOf(c.id), true) + ' · ' + platformName() + ' · paper';
    if ($('isoLabel')) $('isoLabel').textContent = state.marginMode === 'cross' ? 'Cross' : 'Isolated';
    if ($('typLabel')) $('typLabel').textContent = state.typ === 'limit' ? 'Limit' : 'Market';
    const lf = $('limitFld'); if (lf) lf.hidden = state.typ !== 'limit';
    if (state.typ === 'limit' && !focused.has($('limitPx'))) {
      if ($('limitPx') && state.limitPx > 0) $('limitPx').value = copyPrice(state.limitPx);
      else if ($('limitPx') && plannedEntry() > 0) $('limitPx').value = copyPrice(plannedEntry());
    }
    const amtInput = $('amtInput');
    if (amtInput && !focused.has(amtInput) && marginDraft == null) {
      amtInput.value = isFinite(state.margin) ? trimFixed(state.margin, 2) : '';
    } else if (amtInput && marginDraft != null && !focused.has(amtInput)) {
      amtInput.value = marginDraft;
    }
    const posNotional = (state.margin || 0) * state.lev;
    if ($('amtSub')) {
      const q = qty();
      const qtyBit = q > 0 ? ' · ' + trimFixed(q, q >= 1 ? 4 : 6) + ' ' + c.name : '';
      $('amtSub').textContent = 'Margin ' + fmtUsd(state.margin || 0) + ' · Position ' + fmtUsd(posNotional) + qtyBit;
    }
    if ($('amtBox')) $('amtBox').classList.toggle('on', !!state.amountOn);
    const max = levMax();
    const range = $('levRange');
    if (range) { range.max = max; range.value = state.lev; }
    const pill = $('levPill');
    if (pill) {
      pill.textContent = state.lev + 'x';
      const pct = max <= 1 ? 0 : (state.lev - 1) / (max - 1);
      pill.style.left = (pct * 100) + '%';
    }
    if ($('maxHint')) $('maxHint').textContent = 'max ' + max + 'x';
    const lim = sizeLimit();
    const line = $('maxLine');
    if (line) {
      line.classList.remove('warn');
      if (!lim.available) line.textContent = '';
      else if (lim.uncapped) line.textContent = 'No extra margin cap at ' + state.lev + 'x';
      else line.textContent = 'Max position at ' + state.lev + 'x: ' + fmtCap(lim.cap) + ' (max margin ' + fmtMaxMargin(lim.maxMargin) + ')';
    }
    const liq = liqPrice();
    if ($('estLiq')) $('estLiq').textContent = isFinite(liq) ? fmtPrice(liq, true) : '—';
    if ($('estLiqPct')) $('estLiqPct').textContent = isFinite(liq) ? fmtPct(liqMovePct(liq), true) : '';
    const slExit = state.sl == null ? NaN : exitFromRoi(state.sl);
    const alert = $('liqAlert');
    if (alert) alert.hidden = !slBeyondLiq(slExit, liq);
    const hasTpsl = state.tp != null || state.sl != null;
    if ($('tpslPanel')) $('tpslPanel').hidden = !state.showTpsl;
    if ($('sizeTools')) $('sizeTools').hidden = !!state.showTpsl;
    if ($('btnAddTpsl')) {
      $('btnAddTpsl').hidden = !!(state.showTpsl || hasTpsl);
      $('btnAddTpsl').textContent = hasTpsl ? 'Edit TP/SL' : 'Add TP/SL +';
    }
    const sum = $('tpslSum');
    if (sum) {
      sum.hidden = !(!state.showTpsl && hasTpsl);
      if (!sum.hidden) {
        const parts = [];
        if (state.tp != null) parts.push('TP ' + fmtUsd(pnlAt(exitFromRoi(state.tp)), true) + ' (' + trimFixed(state.tp, 2) + '%)');
        if (state.sl != null) parts.push('SL ' + fmtUsd(pnlAt(exitFromRoi(state.sl)), true) + ' (' + trimFixed(state.sl, 2) + '%)');
        sum.textContent = parts.join(' · ') || 'TP / SL';
      }
    }
    renderTpslFields();
    if ($('availBal')) $('availBal').textContent = fmtUsd(freeMargin());
    const go = $('btnSubmit');
    if (go) {
      go.textContent = sideWord + ' ' + c.name;
      go.className = 'submit ' + (state.side === 'short' ? 'short' : 'long');
    }
    if ($('pasteTitle')) $('pasteTitle').textContent = 'Enter on ' + platformName();
    if ($('feePct') && !focused.has($('feePct'))) $('feePct').value = String(state.feePct);
    if ($('btnSideLong')) $('btnSideLong').classList.toggle('on', state.side === 'long');
    if ($('btnSideShort')) $('btnSideShort').classList.toggle('on', state.side === 'short');
  }

  function renderTpslFields() {
    const tpExit = state.tp == null ? NaN : exitFromRoi(state.tp);
    const slExit = state.sl == null ? NaN : exitFromRoi(state.sl);
    if ($('tpPrice') && !focused.has($('tpPrice'))) $('tpPrice').value = isFinite(tpExit) ? copyPrice(tpExit) : '';
    if ($('tpPct') && !focused.has($('tpPct'))) $('tpPct').value = state.tp == null ? '' : trimFixed(state.tp, 2);
    if ($('slPrice') && !focused.has($('slPrice'))) $('slPrice').value = isFinite(slExit) ? copyPrice(slExit) : '';
    if ($('slPct') && !focused.has($('slPct'))) $('slPct').value = state.sl == null ? '' : trimFixed(state.sl, 2);
    const tpPnl = isFinite(tpExit) ? pnlAt(tpExit) : NaN;
    const slPnl = isFinite(slExit) ? pnlAt(slExit) : NaN;
    if ($('tpLine')) $('tpLine').textContent = 'Gain: ' + (isFinite(tpPnl) ? fmtUsd(tpPnl, true) : '—');
    if ($('slLine')) $('slLine').textContent = 'Loss: ' + (isFinite(slPnl) ? fmtUsd(slPnl, true) : '—');
    if ($('outTp')) $('outTp').textContent = isFinite(tpExit) ? fmtPrice(tpExit, true) : '—';
    if ($('outSl')) $('outSl').textContent = isFinite(slExit) ? fmtPrice(slExit, true) : '—';
    if ($('outLiq')) $('outLiq').textContent = isFinite(liqPrice()) ? fmtPrice(liqPrice(), true) : '—';
  }

  function renderAll() {
    renderPlatform();
    renderAccount();
    renderMarkets();
    renderAssetHead();
    renderTf();
    renderPositions();
    if (!$('orderSheet').hidden || isDesktop()) renderOrder();
    renderOverlay();
    renderDrawings();
    renderAbout();
    renderLiveSrc();
    if (isDesktop()) renderOb();
  }

  function openOrder(side) {
    state.side = side;
    state.amountOn = true;
    padFresh = true;
    state.showTpsl = !!(state.tp != null || state.sl != null);
    if (state.typ === 'limit' && !(state.limitPx > 0)) state.limitPx = plannedEntry();
    clampMarginToLimit({ flash: false });
    if (isDesktop()) {
      setRightTab('trade');
      $('orderSheet').hidden = false;
      if ($('orderScrim')) $('orderScrim').hidden = true;
    } else {
      $('orderSheet').hidden = false;
      $('orderScrim').hidden = false;
    }
    err('');
    renderOrder();
  }
  function closeOrder() {
    if (isDesktop()) {
      if ($('orderScrim')) $('orderScrim').hidden = true;
      return;
    }
    $('orderSheet').hidden = true;
    $('orderScrim').hidden = true;
  }
  function closeMinis() {
    ['isoSheet', 'typSheet', 'lineSheet', 'setSheet', 'miniScrim'].forEach((id) => { const el = $(id); if (el) el.hidden = true; });
  }
  function openMini(id) {
    closeMinis();
    $('miniScrim').hidden = false;
    $(id).hidden = false;
  }

  function bindInput(el, onCommit, { live } = {}) {
    if (!el) return;
    el.addEventListener('focus', () => focused.add(el));
    el.addEventListener('blur', () => {
      focused.delete(el);
      onCommit(el.value);
      renderOrder();
    });
    if (live) el.addEventListener('input', () => onCommit(el.value));
  }

  function setLev(v) {
    state.lev = clampLev(v);
    clampMarginToLimit({ flash: true });
    saveCalc();
    renderOrder();
  }

  function commitMargin(n, { flash } = {}) {
    if (!isFinite(n) || n < 0) n = 0;
    state.margin = n;
    const lim = sizeLimit();
    const free = freeMargin();
    if (lim.available && !lim.uncapped && n > lim.maxMargin + 1e-9) {
      state.margin = lim.maxMargin;
      if (flash) flashMarginMax('Max ' + fmtMaxMargin(lim.maxMargin) + ' at ' + state.lev + 'x');
    } else if (n > free + 1e-9) {
      state.margin = Math.max(0, Math.floor(free * 100) / 100);
      if (flash) flashMarginMax('Max available ' + fmtUsd(state.margin));
    }
    marginDraft = null;
    saveCalc();
  }

  function setMarginRaw(s, { commit } = {}) {
    const raw = String(s == null ? '' : s);
    const n = parseNum(raw);
    if (raw === '' || raw === '.' || raw === '0.') {
      marginDraft = raw;
      state.margin = 0;
      if (commit) commitMargin(0, { flash: false });
      else renderOrder();
      return;
    }
    if (!isFinite(n) || n < 0) return;
    if (commit) {
      commitMargin(n, { flash: true });
      renderOrder();
      return;
    }
    marginDraft = raw;
    state.margin = n;
    renderOrder();
  }

  function padKey(k) {
    state.amountOn = true;
    state.showTpsl = false;
    let v = padFresh ? '' : (marginDraft != null ? marginDraft : String(state.margin || ''));
    padFresh = false;
    if (k === 'del') v = v.slice(0, -1);
    else if (k === '.') { if (v.indexOf('.') < 0) v = (v || '0') + '.'; }
    else v += k;
    if (v === '' || v === '.') {
      marginDraft = v;
      state.margin = 0;
      if ($('amtInput')) $('amtInput').value = v === '.' ? '0.' : '';
      if ($('amtSub')) $('amtSub').textContent = 'Margin $0.00 · Position $0.00';
      return;
    }
    setMarginRaw(v, { commit: false });
    if ($('amtInput')) $('amtInput').value = marginDraft != null ? marginDraft : v;
  }

  async function copy(kind) {
    let val = '';
    if (kind === 'tp') val = copyPrice(exitFromRoi(state.tp));
    else if (kind === 'sl') val = copyPrice(exitFromRoi(state.sl));
    else val = copyPrice(liqPrice());
    if (!val) return;
    try { await navigator.clipboard.writeText(val); toast('Copied ' + val); }
    catch (e) { toast('Could not copy'); }
  }

  function bind() {
    $('mktList').addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-coin]');
      if (row) openCoin(row.getAttribute('data-coin'));
    });
    document.querySelectorAll('#filters [data-filter]').forEach((b) => {
      b.addEventListener('click', () => {
        state.filter = b.getAttribute('data-filter');
        document.querySelectorAll('#filters [data-filter]').forEach((x) => x.classList.toggle('on', x === b));
        saveUi();
        renderMarkets();
      });
    });
    $('btnAster').onclick = () => setPlatform('aster');
    $('btnHl').onclick = () => setPlatform('hyperliquid');
    $('btnBack').onclick = () => { setView('markets'); };
    $('btnLong').onclick = () => openOrder('long');
    $('btnShort').onclick = () => openOrder('short');
    if ($('btnSideLong')) $('btnSideLong').onclick = () => openOrder('long');
    if ($('btnSideShort')) $('btnSideShort').onclick = () => openOrder('short');
    $('btnOrderClose').onclick = closeOrder;
    $('orderScrim').onclick = closeOrder;
    if ($('btnDeskDeposit')) $('btnDeskDeposit').onclick = resetAccount;
    if ($('btnDeskGear')) $('btnDeskGear').onclick = () => openMini('setSheet');
    if ($('mktSearch')) {
      $('mktSearch').addEventListener('input', () => {
        state.mktQuery = $('mktSearch').value || '';
        renderMarkets();
      });
      $('mktSearch').addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); $('mktSearch').value = ''; state.mktQuery = ''; renderMarkets(); $('mktSearch').blur(); }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const first = document.querySelector('#mktList .mkt-row');
          if (first) openCoin(first.getAttribute('data-coin'));
        }
      });
    }
    if ($('deskRightTabs')) $('deskRightTabs').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-rtab]');
      if (b) setRightTab(b.getAttribute('data-rtab'));
    });
    if ($('bookTabs')) $('bookTabs').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-book]');
      if (b) setBookTab(b.getAttribute('data-book'));
    });
    if ($('obTabs')) $('obTabs').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-obtab]');
      if (!b) return;
      obTab = b.getAttribute('data-obtab') || 'book';
      $('obTabs').querySelectorAll('[data-obtab]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-obtab') === obTab));
      renderOb();
    });
    if ($('obGroup')) $('obGroup').addEventListener('change', () => {
      obGroup = parseFloat($('obGroup').value) || 0;
      renderOb();
    });
    if ($('deskBook')) $('deskBook').addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-ob-px]');
      if (row) useObPrice(parseFloat(row.getAttribute('data-ob-px')));
    });
    $('btnIso').onclick = () => openMini('isoSheet');
    $('btnTyp').onclick = () => openMini('typSheet');
    $('btnChartGear').onclick = () => {
      ['entry', 'tp', 'sl', 'liq'].forEach((k) => {
        const box = $('line' + k.charAt(0).toUpperCase() + k.slice(1));
        if (box) box.checked = state.chartLines[k] !== false;
      });
      openMini('lineSheet');
    };
    $('btnGear').onclick = () => openMini('setSheet');
    $('btnDeposit').onclick = resetAccount;
    $('miniScrim').onclick = closeMinis;
    $('isoSheet').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-mm]');
      if (!b) return;
      state.marginMode = b.getAttribute('data-mm');
      saveUi(); closeMinis(); renderOrder();
    });
    $('typSheet').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-typ]');
      if (!b) return;
      state.typ = b.getAttribute('data-typ');
      if (state.typ === 'limit' && !(state.limitPx > 0)) state.limitPx = plannedEntry();
      saveUi(); closeMinis(); renderOrder();
    });
    $('btnLineDone').onclick = () => {
      state.chartLines = {
        entry: $('lineEntry').checked, tp: $('lineTp').checked,
        sl: $('lineSl').checked, liq: $('lineLiq').checked
      };
      saveUi(); closeMinis(); renderOverlay();
    };
    $('btnSetDone').onclick = closeMinis;
    bindInput($('feePct'), (v) => {
      const n = parseNum(v);
      if (!isFinite(n) || n < 0) return;
      state.feePct = n;
      state.fees[state.platform] = n;
      saveCalc();
    }, { live: true });

    function revealAmountPad() {
      state.amountOn = true;
      state.showTpsl = false;
      padFresh = true;
      renderOrder();
    }
    $('amtBox').addEventListener('click', (ev) => {
      revealAmountPad();
      const inp = $('amtInput');
      if (!inp) return;
      if (ev.target !== inp) inp.focus();
      try { inp.select(); } catch (e) { /* */ }
    });
    bindInput($('amtInput'), (v) => {
      setMarginRaw(v, { commit: !focused.has($('amtInput')) });
    }, { live: true });
    if ($('amtInput')) {
      $('amtInput').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          $('amtInput').blur();
          if (isDesktop()) placeOrder();
        }
      });
      const origCommit = $('amtInput').onblur;
      $('amtInput').addEventListener('focus', () => {
        state.amountOn = true;
        state.showTpsl = false;
        padFresh = true;
        renderOrder();
        try { $('amtInput').select(); } catch (e) { /* */ }
      });
    }
    $('levRange').addEventListener('input', () => setLev($('levRange').value));
    $('btnAddTpsl').onclick = () => { state.showTpsl = true; state.amountOn = false; renderOrder(); };
    $('btnSaveTpsl').onclick = () => { state.showTpsl = false; state.amountOn = true; saveCalc(); renderOrder(); };
    if ($('tpslSum')) $('tpslSum').onclick = () => { state.showTpsl = true; state.amountOn = false; renderOrder(); };
    $('clearTp').onclick = () => { state.tp = null; saveCalc(); renderOrder(); };
    $('clearSl').onclick = () => { state.sl = null; saveCalc(); renderOrder(); };
    bindInput($('tpPrice'), (v) => {
      if (!String(v).trim()) { state.tp = null; saveCalc(); return; }
      const n = parseNum(v);
      if (!isFinite(n) || !validBase()) return;
      const roi = pnlAt(n) / state.margin * 100;
      if (isFinite(roi)) state.tp = roi;
      saveCalc();
    }, { live: true });
    bindInput($('tpPct'), (v) => {
      if (!String(v).trim()) { state.tp = null; saveCalc(); return; }
      const n = parseNum(v);
      if (!isFinite(n)) return;
      state.tp = n;
      saveCalc();
    }, { live: true });
    bindInput($('slPrice'), (v) => {
      if (!String(v).trim()) { state.sl = null; saveCalc(); return; }
      const n = parseNum(v);
      if (!isFinite(n) || !validBase()) return;
      const roi = pnlAt(n) / state.margin * 100;
      if (isFinite(roi)) state.sl = roi;
      saveCalc();
    }, { live: true });
    bindInput($('slPct'), (v) => {
      if (!String(v).trim()) { state.sl = null; saveCalc(); return; }
      const n = parseNum(v);
      if (!isFinite(n)) return;
      state.sl = n;
      saveCalc();
    }, { live: true });
    bindInput($('limitPx'), (v) => {
      const n = parseNum(v);
      if (n > 0) state.limitPx = n;
      saveCalc();
    }, { live: true });

    const tpChips = $('tpChips');
    TP_CHIPS.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = '+' + n + '%';
      b.onclick = () => { state.tp = n; saveCalc(); renderOrder(); };
      tpChips.appendChild(b);
    });
    const slChips = $('slChips');
    SL_CHIPS.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = n + '%';
      b.onclick = () => { state.sl = n; saveCalc(); renderOrder(); };
      slChips.appendChild(b);
    });
    $('copyTp').onclick = () => copy('tp');
    $('copySl').onclick = () => copy('sl');
    $('copyLiq').onclick = () => copy('liq');

    $('pcts').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pct]');
      if (!b) return;
      const pct = +b.getAttribute('data-pct') / 100;
      let cap = marginCap();
      state.amountOn = true;
      state.showTpsl = false;
      commitMargin(Math.floor(cap * pct * 100) / 100, { flash: false });
      padFresh = true;
      renderOrder();
    });
    $('pad').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-key]');
      if (b) padKey(b.getAttribute('data-key'));
    });
    $('btnSubmit').onclick = placeOrder;

    $('tfRow').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tf]');
      if (!b) return;
      state.tf = b.getAttribute('data-tf');
      saveUi();
      renderTf();
      loadChart();
    });

    document.addEventListener('click', (ev) => {
      const cl = ev.target.closest && ev.target.closest('[data-close]');
      if (cl) { closePosition(cl.getAttribute('data-close'), 'manual'); ev.stopPropagation(); return; }
      const can = ev.target.closest && ev.target.closest('[data-cancel]');
      if (can) {
        book.pending = book.pending.filter((p) => p.id !== can.getAttribute('data-cancel'));
        savePaper(); toast('Order canceled'); renderAll(); ev.stopPropagation(); return;
      }
      const open = ev.target.closest && ev.target.closest('[data-open]');
      if (open && ev.target.closest('[data-close]')) return;
      if (open) openCoin(open.getAttribute('data-open'));
    });

    document.querySelectorAll('#tabbar [data-view]').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.getAttribute('data-view');
        if (v === 'asset' && !state.coin) setView('markets');
        else setView(v);
        if (v === 'asset') loadChart();
      });
    });

    window.addEventListener('resize', () => { syncDesktopLayout(); sizeChart(); });
    if (DESK_MQ.addEventListener) DESK_MQ.addEventListener('change', syncDesktopLayout);
    else if (DESK_MQ.addListener) DESK_MQ.addListener(syncDesktopLayout);
    window.addEventListener('keydown', (ev) => {
      if (!isDesktop()) return;
      const tag = ((ev.target && ev.target.tagName) || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (ev.target && ev.target.isContentEditable);
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeMinis();
        clearCrosshair();
        if (measure) { measure = null; }
        pendingTrend = null;
        selectedDraw = null;
        if (drawTool !== 'cursor') setDrawTool('cursor');
        else renderDrawings();
        if (typing && ev.target && ev.target.blur) ev.target.blur();
        return;
      }
      if (ev.key === '/' && !typing && !ev.metaKey && !ev.ctrlKey) {
        ev.preventDefault();
        if ($('mktSearch')) $('mktSearch').focus();
        return;
      }
      if (typing || ev.metaKey || ev.ctrlKey) return;
      if (ev.altKey && !ev.shiftKey) {
        if (ev.code === 'KeyH') { ev.preventDefault(); setDrawTool('hline'); }
        else if (ev.code === 'KeyT') { ev.preventDefault(); setDrawTool('trend'); }
        else if (ev.code === 'KeyC') { ev.preventDefault(); clearAllDraws(); }
        else if (ev.code === 'KeyM') { ev.preventDefault(); setDrawTool('measure'); }
        return;
      }
      if (ev.altKey) return;
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedDraw) {
        ev.preventDefault();
        deleteSelectedDraw();
        return;
      }
      if (ev.key === 'l' || ev.key === 'L') openOrder('long');
      else if (ev.key === 's' || ev.key === 'S') openOrder('short');
      else if (ev.key === 'c' || ev.key === 'C') setRightTab(state.rightTab === 'calc' ? 'trade' : 'calc');
    });
  }

  function syncDesktopLayout() {
    const desk = isDesktop();
    document.body.classList.toggle('is-desk', desk);
    if (desk) {
      if ($('orderScrim')) $('orderScrim').hidden = true;
      setRightTab(state.rightTab || 'trade');
      const tools = $('chartTools');
      if (tools) tools.classList.remove('collapsed');
      requestAnimationFrame(() => { sizeChart(); renderOverlay(); renderDrawings(); renderPositions(); });
      if (!chart) loadChart();
      else sizeChart();
    } else {
      const dock = $('deskRight');
      if (dock) dock.classList.remove('calc-on');
      if ($('orderSheet') && state.view !== 'calc') {
        /* keep sheet closed when returning to the phone layout unless it was mid-ticket */
        if ($('orderScrim') && $('orderScrim').hidden) $('orderSheet').hidden = true;
      }
      const map = { markets: 'screenMarkets', asset: 'screenAsset', positions: 'screenPos', calc: 'screenCalc' };
      ['markets', 'asset', 'positions', 'calc'].forEach((v) => {
        const el = $(map[v]);
        if (el) el.classList.toggle('on', v === state.view);
      });
      renderPositions();
    }
  }


  function useAsterChart(c) {
    c = c || currentCoin();
    return !isHl() && !!(c && c.aster && c.aster.symbol);
  }
  function wsIsLive() {
    return !!(ws && ws.readyState === 1 && lastTickAt && (Date.now() - lastTickAt) < 5000);
  }
  function renderLiveSrc() {
    const el = $('liveSrc');
    const lbl = $('liveSrcLbl');
    if (!el || !lbl) return;
    const src = useAsterChart() ? 'Aster' : 'HL';
    lbl.textContent = src;
    const age = lastTickAt ? (Date.now() - lastTickAt) : 1e9;
    const connected = !!(ws && ws.readyState === 1);
    el.className = 'live-src' + (age < 2500 ? ' on' : connected || age < 8000 ? ' stale' : ' off');
  }

  async function fetchHlKlines(coin, tf, startMs, endMs) {
    if (!coin) return [];
    const end = endMs || Date.now();
    const start = startMs || (end - (TF_MS[tf] || 60e3) * HL_CANDLE_CAP);
    const raw = await hlInfo({ type: 'candleSnapshot', req: { coin: coin, interval: tf, startTime: start, endTime: end } });
    return normalizeBars(raw, tf);
  }

  async function fetchAsterKlines(symbol, tf, endMs, limit) {
    const interval = tf === '1d' ? '1d' : tf;
    let url = ASTER_API + '/klines?symbol=' + encodeURIComponent(symbol) + '&interval=' + interval + '&limit=' + (limit || ASTER_KLINE_LIMIT);
    if (endMs) url += '&endTime=' + Math.floor(endMs);
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('klines ' + r.status);
    const raw = await r.json();
    const list = (Array.isArray(raw) ? raw : []).map((row) => ({
      time: toUnixSec(row[0]), open: +row[1], high: +row[2], low: +row[3], close: +row[4]
    }));
    return normalizeBars(list, tf);
  }

  function closeLiveWs() {
    if (ws) {
      try { ws.onclose = null; ws.onerror = null; ws.close(); } catch (e) { /* */ }
      ws = null;
    }
  }

  function liveWantKey() {
    const c = currentCoin();
    if (useAsterChart(c)) return 'aster:' + c.aster.symbol + ':' + state.tf;
    return 'hl:' + ((c.hl && c.hl.coin) || '') + ':' + state.tf;
  }

  function subscribeLive() {
    const key = liveWantKey();
    if (ws && wsKey === key && ws.readyState === 1) return;
    closeLiveWs();
    wsKey = key;
    wsCoin = key;
    wsTf = state.tf;
    if (key.startsWith('aster:')) openAsterWs();
    else openHlWs();
  }

  function wsBackoff() {
    wsRetry = Math.min(8, (wsRetry || 0) + 1);
    const ms = Math.min(10000, 600 * Math.pow(2, wsRetry - 1));
    setTimeout(() => {
      if (liveWantKey() === wsKey) subscribeLive();
    }, ms);
  }

  function openHlWs() {
    const c = currentCoin();
    const coin = c.hl && c.hl.coin;
    if (!coin) return;
    wsKind = 'hl';
    try {
      ws = new WebSocket(HL_WS);
      ws.onopen = function () {
        wsRetry = 0;
        const subs = [
          { type: 'candle', coin: coin, interval: state.tf },
          { type: 'trades', coin: coin },
          { type: 'l2Book', coin: coin },
          { type: 'allMids' },
          { type: 'allMids', dex: 'xyz' },
          { type: 'activeAssetCtx', coin: coin }
        ];
        if (c.hl.dex) subs.push({ type: 'activeAssetCtx', coin: coin, dex: c.hl.dex });
        subs.forEach((subscription) => {
          try { ws.send(JSON.stringify({ method: 'subscribe', subscription: subscription })); } catch (e) { /* */ }
        });
      };
      ws.onmessage = function (ev) {
        try { handleHlMessage(JSON.parse(ev.data), coin); } catch (e) { /* */ }
      };
      ws.onclose = function () { if (wsKind === 'hl') { ws = null; wsBackoff(); } };
      ws.onerror = function () { try { ws.close(); } catch (e) { /* */ } };
    } catch (e) { ws = null; wsBackoff(); }
  }

  function openAsterWs() {
    const c = currentCoin();
    const sym = (c.aster && c.aster.symbol || '').toLowerCase();
    if (!sym) return;
    const tf = state.tf === '1d' ? '1d' : state.tf;
    const streams = '!markPrice@arr@1s/' + sym + '@markPrice@1s/' + sym + '@aggTrade/' + sym + '@kline_' + tf + '/' + sym + '@depth20@100ms';
    const url = 'wss://fstream.asterdex.com/stream?streams=' + streams;
    wsKind = 'aster';
    try {
      ws = new WebSocket(url);
      ws.onopen = function () { wsRetry = 0; };
      ws.onmessage = function (ev) {
        try { handleAsterMessage(JSON.parse(ev.data)); } catch (e) { /* */ }
      };
      ws.onclose = function () { if (wsKind === 'aster') { ws = null; wsBackoff(); } };
      ws.onerror = function () { try { ws.close(); } catch (e) { /* */ } };
    } catch (e) { ws = null; wsBackoff(); }
  }

  function handleHlMessage(msg, coin) {
    if (isHl() === false) return;
    const ch = msg.channel || msg.type;
    const d = msg.data;
    if (!d) return;
    if (ch === 'candle') {
      const bar = parseBar(d, state.tf);
      if (bar) {
        applyOfficialBar(bar);
        applyTradeTick(bar.close, 'hl');
      }
    } else if (ch === 'trades') {
      const list = Array.isArray(d) ? d : [d];
      list.forEach((t) => applyHlTrade(t));
    } else if (ch === 'l2Book') {
      applyL2FromHl(d);
    } else if (ch === 'allMids' || d.mids) {
      const mids = d.mids || d;
      applyMids(mids);
      const px = midForCoin(mids, currentCoin());
      if (px > 0) {
        setMeta(state.coin, { mid: px, px: (metaOf(state.coin).trade > 0 ? metaOf(state.coin).px : px) });
        if (!(state.livePrice > 0)) { state.livePrice = px; renderAssetHead(); }
        patchLiveUi();
      }
    } else if (ch === 'activeAssetCtx') {
      const ctx = d.ctx || d;
      const mark = parseFloat(ctx.markPx);
      const mid = parseFloat(ctx.midPx);
      const extra = {};
      if (mark > 0) extra.mark = mark;
      if (mid > 0) extra.mid = mid;
      const fund = parseFloat(ctx.funding);
      const oi = parseFloat(ctx.openInterest);
      const vol = parseFloat(ctx.dayNtlVlm);
      if (isFinite(fund)) extra.funding = fund;
      if (oi > 0) extra.oi = oi;
      if (vol > 0) extra.volume = vol;
      setMeta(state.coin, extra);
      renderAssetHead();
    }
  }

  function midForCoin(mids, c) {
    if (!mids || !c || !c.hl) return 0;
    const raw = c.hl.coin;
    const short = raw.replace(/^xyz:/, '');
    const v = mids[raw] || mids[short] || mids['xyz:' + short];
    const n = parseFloat(v);
    return n > 0 ? n : 0;
  }

  function applyMids(mids) {
    if (!mids) return;
    COINS.forEach((c) => {
      const px = midForCoin(mids, c);
      if (px > 0) {
        const extra = { mid: px };
        if (!(liveMeta[c.id] && liveMeta[c.id].trade > 0)) extra.px = px;
        setMeta(c.id, extra);
      }
    });
  }

  function handleAsterMessage(msg) {
    const d = msg.data || msg;
    if (!d) return;
    if (Array.isArray(d)) {
      d.forEach((row) => {
        if (!row || !row.s) return;
        const px = parseFloat(row.p);
        if (!(px > 0)) return;
        const coin = COINS.find((c) => c.aster && c.aster.symbol === row.s);
        if (!coin) return;
        const extra = {};
        const fund = parseFloat(row.r);
        if (isFinite(fund)) extra.funding = fund;
        setMeta(coin.id, Object.assign({ mark: px }, extra));
        if (coin.id === state.coin) renderAssetHead();
      });
      if (state.view === 'markets' && !liveRaf) liveRaf = requestAnimationFrame(function () { liveRaf = 0; renderMarkets(); renderLiveSrc(); });
      return;
    }
    const type = d.e;
    if (isHl()) return;
    if (type === 'markPriceUpdate' || (d.s && d.p && d.i && !d.k && !d.a && d.e !== 'aggTrade' && type !== 'depthUpdate')) {
      const px = parseFloat(d.p || d.markPrice);
      const extra = {};
      const fund = parseFloat(d.r);
      if (isFinite(fund)) extra.funding = fund;
      if (px > 0) extra.mark = px;
      setMeta(state.coin, extra);
      renderAssetHead();
    }
    if (type === 'aggTrade') {
      const px = parseFloat(d.p);
      const sz = parseFloat(d.q);
      if (px > 0) applyTradeTick(px, 'aster');
      if (px > 0 && sz > 0) pushTape(px, sz, d.m ? 'sell' : 'buy', d.T);
    }
    if (type === 'kline' && d.k) {
      const k = d.k;
      const bar = normalizeBars([{ time: toUnixSec(k.t), open: +k.o, high: +k.h, low: +k.l, close: +k.c }], state.tf)[0];
      if (bar) {
        applyOfficialBar(bar);
        applyTradeTick(bar.close, 'aster');
      }
    }
    if (type === 'depthUpdate' || d.b || d.a || d.bids || d.asks) {
      applyL2FromAster(d);
    }
  }

  function applyOfficialBar(bar) {
    if (!bar || !bar.time || !(bar.close > 0) || !series) return;
    bar = normalizeBars([bar], state.tf)[0];
    if (!bar) return;
    const last = bars[bars.length - 1];
    if (!last) {
      bars = [bar];
      series.setData(bars);
      return;
    }
    lastTickAt = Date.now();
    if (bar.time === last.time) {
      bars[bars.length - 1] = {
        time: bar.time, open: last.open,
        high: Math.max(last.high, bar.high),
        low: Math.min(last.low, bar.low),
        close: bar.close
      };
      series.update(bars[bars.length - 1]);
    } else if (bar.time > last.time) {
      bars.push(bar);
      series.update(bar);
    }
  }

  function venueOk(src) {
    if (src === 'aster') return !isHl();
    if (src === 'hl') return isHl();
    return true;
  }
  function applyTradeTick(px, src) {
    if (!(px > 0) || !venueOk(src)) return;
    pendingTick = { px: px, src: src, t: Date.now() };
    if (!liveRaf) liveRaf = requestAnimationFrame(flushTick);
  }
  function applyPriceTick(px, extra) {
    /* legacy: treat as trade only when no separate mark path is used */
    if (extra && (extra.mark || extra.funding || extra.oi)) {
      if (extra.mark > 0 || px > 0) setMeta(state.coin, Object.assign({}, extra, extra.mark ? {} : {}));
      return;
    }
    applyTradeTick(px, isHl() ? 'hl' : 'aster');
  }
  function flushTick() {
    liveRaf = 0;
    const t = pendingTick;
    if (!t) return;
    pendingTick = null;
    if (!venueOk(t.src)) return;
    lastTickAt = t.t;
    state.livePrice = t.px;
    state.priceStatus = 'live';
    setMeta(state.coin, { trade: t.px, px: t.px });
    if (series && bars.length) {
      const buck = bucketTime(t.t / 1000 || Date.now() / 1000, state.tf);
      const last = bars[bars.length - 1];
      if (last && last.time === buck) {
        const bar = {
          time: last.time,
          open: last.open,
          high: Math.max(last.high, t.px),
          low: Math.min(last.low, t.px),
          close: t.px
        };
        bars[bars.length - 1] = bar;
        series.update(bar);
      } else if (last && buck > last.time) {
        const bar = {
          time: buck,
          open: last.close,
          high: Math.max(last.close, t.px),
          low: Math.min(last.close, t.px),
          close: t.px
        };
        bars.push(bar);
        series.update(bar);
      }
    }
    tickBook();
    renderAssetHead();
    renderOverlay();
    renderDrawings();
    renderLiveSrc();
    if (crosshair) renderCrosshair();
    if (!$('orderSheet').hidden || isDesktop()) {
      if ($('orderSub')) $('orderSub').textContent = fmtPrice(t.px, true) + ' · ' + platformName() + ' · paper';
    }
    patchLiveUi();
  }

  function applyHlTrade(t) {
    if (!t) return;
    const px = parseFloat(t.px);
    const sz = parseFloat(t.sz);
    if (px > 0) applyTradeTick(px, 'hl');
    if (px > 0 && sz > 0) {
      const side = (t.side === 'A' || t.side === 'sell') ? 'sell' : 'buy';
      pushTape(px, sz, side, t.time);
    }
  }
  function applyL2FromHl(d) {
    if (!d || !d.levels || d.levels.length < 2) return;
    const bids = (d.levels[0] || []).map((x) => [parseFloat(x.px || x[0]), parseFloat(x.sz || x[1])]).filter((r) => r[0] > 0 && r[1] > 0);
    const asks = (d.levels[1] || []).map((x) => [parseFloat(x.px || x[0]), parseFloat(x.sz || x[1])]).filter((r) => r[0] > 0 && r[1] > 0);
    lastTickAt = Date.now();
    obRaw = { bids: bids, asks: asks };
    scheduleOb();
  }
  function applyL2FromAster(d) {
    const bidsRaw = d.b || d.bids || [];
    const asksRaw = d.a || d.asks || [];
    if (!bidsRaw.length && !asksRaw.length) return;
    const bids = bidsRaw.map((x) => [parseFloat(x[0]), parseFloat(x[1])]).filter((r) => r[0] > 0 && r[1] > 0);
    const asks = asksRaw.map((x) => [parseFloat(x[0]), parseFloat(x[1])]).filter((r) => r[0] > 0 && r[1] > 0);
    lastTickAt = Date.now();
    obRaw = { bids: bids, asks: asks };
    scheduleOb();
  }
  function pushTape(px, sz, side, t) {
    tape.unshift({ px: px, sz: sz, side: side, t: t || Date.now() });
    if (tape.length > 80) tape.length = 80;
    scheduleOb();
  }
  function resetOrderBook() {
    obRaw = { bids: [], asks: [] };
    tape = [];
    scheduleOb();
  }
  function scheduleOb() {
    if (!isDesktop()) return;
    if (!obRaf) obRaf = requestAnimationFrame(function () { obRaf = 0; renderOb(); });
  }
  function groupSteps(px) {
    if (px >= 10000) return [1, 2, 5, 10, 50, 100];
    if (px >= 1000) return [0.1, 0.5, 1, 2, 5, 10];
    if (px >= 100) return [0.01, 0.05, 0.1, 0.5, 1, 5];
    if (px >= 10) return [0.001, 0.01, 0.05, 0.1, 0.5, 1];
    return [0.0001, 0.001, 0.01, 0.05, 0.1];
  }
  function groupLevels(rows, step, isBid) {
    const map = new Map();
    const s = step || 0;
    rows.forEach((r) => {
      const px = s > 0 ? (isBid ? Math.floor(r[0] / s) * s : Math.ceil(r[0] / s) * s) : r[0];
      map.set(px, (map.get(px) || 0) + r[1]);
    });
    const out = Array.from(map.entries()).map((e) => [e[0], e[1]]);
    out.sort((a, b) => isBid ? b[0] - a[0] : a[0] - b[0]);
    return out;
  }
  function renderOb() {
    if (!isDesktop()) return;
    const bookEl = $('obBook');
    const tradesEl = $('obTrades');
    if (!bookEl || !tradesEl) return;
    const sel = $('obGroup');
    const mid = displayPx(state.coin) || ((obRaw.bids[0] && obRaw.bids[0][0]) || 0);
    const steps = groupSteps(mid || 1);
    if (sel && (obSteps.join() !== steps.join())) {
      obSteps = steps;
      const cur = obGroup;
      sel.innerHTML = '<option value="0">Tick</option>' + steps.map((g) => '<option value="' + g + '"' + (g === cur ? ' selected' : '') + '>' + g + '</option>').join('');
      if (cur && steps.indexOf(cur) < 0) { obGroup = 0; sel.value = '0'; }
    }
    if (obTab === 'trades') {
      bookEl.hidden = true; tradesEl.hidden = false;
      if (!tape.length) { tradesEl.innerHTML = '<div class="ob-empty">No trades yet</div>'; return; }
      tradesEl.innerHTML = '<div class="ob-head"><span>Price</span><span class="sz">Size</span><span class="t">Time</span></div>' +
        tape.map((t) => {
          const d = new Date(t.t > 1e12 ? t.t : t.t);
          const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
          return '<div class="ob-tr ' + t.side + '"><span class="px">' + fmtPrice(t.px) + '</span><span class="sz">' + trimFixed(t.sz, t.sz >= 1 ? 3 : 5) + '</span><span class="t">' + hh + '</span></div>';
        }).join('');
      return;
    }
    bookEl.hidden = false; tradesEl.hidden = true;
    const step = obGroup > 0 ? obGroup : 0;
    const bids = groupLevels(obRaw.bids, step, true).slice(0, 14);
    const asks = groupLevels(obRaw.asks, step, false).slice(0, 14).reverse();
    if (!bids.length && !asks.length) { bookEl.innerHTML = '<div class="ob-empty">No book</div>'; return; }
    const bestBid = bids.length ? bids[0][0] : 0;
    const bestAsk = asks.length ? asks[asks.length - 1][0] : 0;
    const spread = (bestBid && bestAsk) ? (bestAsk - bestBid) : 0;
    const midPx = (bestBid && bestAsk) ? (bestBid + bestAsk) / 2 : mid;
    let acc = 0;
    const askRows = asks.map((r) => { acc += r[1]; return [r[0], r[1], acc]; });
    acc = 0;
    const bidRows = bids.map((r) => { acc += r[1]; return [r[0], r[1], acc]; });
    const maxTot = Math.max.apply(null, askRows.map((r) => r[2]).concat(bidRows.map((r) => r[2])).concat([1]));
    function rowHtml(r, kind) {
      const pct = Math.max(2, Math.min(100, (r[2] / maxTot) * 100));
      return '<button type="button" class="ob-row ' + kind + '" data-ob-px="' + r[0] + '">' +
        '<i class="ob-bar" style="width:' + pct.toFixed(1) + '%"></i>' +
        '<span class="px">' + fmtPrice(r[0]) + '</span><span class="sz">' + trimFixed(r[1], r[1] >= 1 ? 3 : 5) + '</span>' +
        '<span class="tot">' + trimFixed(r[2], r[2] >= 1 ? 3 : 5) + '</span></button>';
    }
    bookEl.innerHTML = '<div class="ob-head"><span>Price</span><span class="sz">Size</span><span class="tot">Total</span></div>' +
      askRows.map((r) => rowHtml(r, 'ask')).join('') +
      '<div class="ob-mid"><span>' + fmtPrice(midPx, true) + '</span><span class="spr">' + (spread ? fmtPrice(spread) : '—') + '</span><span></span></div>' +
      bidRows.map((r) => rowHtml(r, 'bid')).join('');
  }
  function useObPrice(px) {
    if (!(px > 0)) return;
    state.typ = 'limit';
    state.limitPx = px;
    saveUi();
    setRightTab('trade');
    openOrder(state.side || 'long');
    renderOrder();
  }

  /* ——— about ——— */
  const ASSET_INFO = {
    BTC: { blurb: 'Bitcoin is the first and largest cryptocurrency, used as a benchmark for crypto markets.', more: ' BTC perpetual futures let you trade its price with leverage, long or short, without holding the coin.', web: 'https://bitcoin.org' },
    HYPE: { blurb: 'HYPE is the token of Hyperliquid, a decentralized perpetual futures exchange.', more: ' It is one of the most active perps on both Hyperliquid and Aster.', web: 'https://hyperliquid.xyz', x: 'https://x.com/HyperliquidX' },
    SOL: { blurb: 'Solana is a high-throughput smart-contract blockchain. SOL is its native token.', more: ' SOL perps are among the most liquid crypto contracts after Bitcoin and Ethereum.', web: 'https://solana.com', x: 'https://x.com/solana' },
    VVV: { blurb: 'VVV is a perpetual market listed on Aster and Hyperliquid.', more: '' },
    NVDA: { blurb: 'NVIDIA designs GPUs that power most AI training and inference today. Its earnings often move the whole AI sector.', more: ' Data-center demand for H100/Blackwell chips is the main driver of the stock.', web: 'https://www.nvidia.com', x: 'https://x.com/nvidia' },
    AMD: { blurb: 'AMD is NVIDIA’s main rival in data-center GPUs and also sells CPUs.', more: ' Its MI-series accelerators are the closest large-scale alternative to NVIDIA in AI clusters.', web: 'https://www.amd.com', x: 'https://x.com/AMD' },
    MU: { blurb: 'Micron makes DRAM and HBM memory used in AI GPUs. Its reports are an early read on memory demand.', more: ' HBM supply is tight when AI capex is strong, which often lifts Micron with SK Hynix.', web: 'https://www.micron.com', x: 'https://x.com/MicronTech' },
    AVGO: { blurb: 'Broadcom makes custom AI accelerators for Google and Meta, plus networking silicon for data centers.', more: ' It is a core way to follow AI capex outside of NVIDIA itself.', web: 'https://www.broadcom.com' },
    TSM: { blurb: 'TSMC manufactures chips for NVIDIA, Apple, AMD and others. Monthly revenue is an early industry signal.', more: ' Almost every leading AI GPU is built on TSMC process nodes.', web: 'https://www.tsmc.com' },
    SKHYNIX: { blurb: 'SK Hynix is the leading supplier of HBM, the high-bandwidth memory stacked on AI GPUs.', more: ' This contract tracks the pre-IPO / overseas listing used on Aster and Hyperliquid, not the Korean cash equity itself.', web: 'https://www.skhynix.com' },
    SOXL: { blurb: 'Direxion Daily Semiconductor Bull 3X is a leveraged ETF on semiconductor stocks.', more: ' It is much more volatile than the underlying SOX/SOXX sector and is meant for short-term trading.', web: 'https://www.direxion.com' },
    MRNA: { blurb: 'Moderna is a biotechnology company known for mRNA vaccines and therapeutics.', more: '', web: 'https://www.modernatx.com', x: 'https://x.com/moderna_tx' },
    ANT: { blurb: 'Anthropic is an AI research company that builds the Claude models. This is a pre-IPO perpetual, not a listed stock.', more: ' The contract trades on Aster and on Hyperliquid’s xyz dex.', web: 'https://www.anthropic.com', x: 'https://x.com/AnthropicAI' },
    TSLA: { blurb: 'Tesla makes electric vehicles, energy storage, and is expanding in autonomy and robotics.', more: '', web: 'https://www.tesla.com', x: 'https://x.com/Tesla' },
    SPCX: { blurb: 'SpaceX is a private space and satellite-internet company. This is a pre-IPO perpetual, not a listed share.', more: ' The contract trades on Aster and on Hyperliquid’s xyz dex.', web: 'https://www.spacex.com', x: 'https://x.com/SpaceX' },
    ASML: { blurb: 'ASML builds the extreme-ultraviolet lithography machines that leading chipmakers need to make advanced chips.', more: ' Its order book is often read as a one-year-ahead signal for semiconductor capex.', web: 'https://www.asml.com' },
    AMAT: { blurb: 'Applied Materials supplies equipment used to fabricate semiconductors inside chip plants.', more: ' It sits in the same factory-equipment group as Lam Research and KLA.', web: 'https://www.appliedmaterials.com' },
    LRCX: { blurb: 'Lam Research makes wafer-fabrication equipment, especially etch and deposition tools used in memory and logic plants.', more: ' Listed as a Hyperliquid xyz perpetual; it is not on Aster yet.', web: 'https://www.lamresearch.com' },
    SAMSUNG: { blurb: 'Samsung is a major producer of DRAM, NAND and HBM, and also a large contract chip manufacturer.', more: ' On Hyperliquid this contract is xyz:SMSN; on Aster it is SAMSUNGUSDT.', web: 'https://www.samsung.com' },
    SMCI: { blurb: 'Super Micro builds AI servers and racks. The stock often reacts first when AI hardware hype rises or fades.', more: ' This perpetual is listed on Hyperliquid’s xyz dex and is not on Aster yet.', web: 'https://www.supermicro.com' },
    SMH: { blurb: 'VanEck Semiconductor ETF (SMH) is a liquid way to trade the chip sector as a group.', more: ' It is the closest SOX/SOXX-style product on Hyperliquid. SOXL, a 3x bull ETF, is also listed. SOXX itself is not on Aster or Hyperliquid.', web: 'https://www.vaneck.com' },
    SP500: { blurb: 'This contract tracks the S&P 500, the main US large-cap equity index.', more: ' It trades on Hyperliquid as xyz:SP500 (index level, around seven thousand). Aster lists SPY and a meme coin called SPX, not this index, so the market appears only on Hyperliquid.', web: 'https://www.spglobal.com/spdji/en/indices/equity/sp-500/' },
    XYZ100: { blurb: 'XYZ100 is TradeXYZ’s US 100 index: 100 large non-financial US-listed companies, weighted by modified market cap.', more: ' It trades on Hyperliquid’s xyz dex with up to 30× leverage. It is not a licensed Nasdaq-100 contract and is not listed on Aster.', web: 'https://trade.xyz' }
  };

  function fundingApr(rate) {
    if (!isFinite(rate)) return null;
    const perYear = isHl() ? rate * 24 * 365 : rate * 3 * 365;
    return perYear * 100;
  }

  function renderAbout() {
    const box = $('aboutPanel');
    if (!box) return;
    const c = currentCoin();
    const info = ASSET_INFO[c.id] || {};
    const meta = liveMeta[c.id] || {};
    const ticker = c.name;
    const short = info.blurb || ('Perpetual market for ' + (NAMES[c.id] || c.name) + '.');
    const more = info.more || '';
    let chips = '<button type="button" id="copyTicker">Copy $' + ticker + '</button>';
    chips += '<a href="https://x.com/search?q=' + encodeURIComponent('$' + ticker) + '&src=typed_query" target="_blank" rel="noopener noreferrer">Search on X</a>';
    if (info.web) chips += '<a href="' + info.web + '" target="_blank" rel="noopener noreferrer">Website</a>';
    if (info.x) chips += '<a href="' + info.x + '" target="_blank" rel="noopener noreferrer">X account</a>';
    const fund = meta.funding;
    const fundTxt = fund == null ? '—' : ((fund * 100).toFixed(4) + '%');
    const apr = fundingApr(fund);
    const fundLine = apr == null ? fundTxt : (fundTxt + '  ·  APR ' + (apr >= 0 ? '+' : '') + apr.toFixed(1) + '%');
    const px = markOf(c.id);
    const oiUsd = meta.oi > 0 ? fmtUsd(meta.oi * (px || 0)) : '—';
    const vol = meta.volume > 0 ? fmtUsd(meta.volume) : '—';
    box.innerHTML = '<h3>Overview</h3>' +
      '<div class="about-blurb' + (more ? '' : ' open') + '" id="aboutBlurb">' + short +
      (more ? '<span class="more">' + more + '</span> <button type="button" class="about-more" id="aboutMore">Show more</button>' : '') +
      '</div>' +
      '<div class="about-chips">' + chips + '</div>' +
      '<div class="about-stats">' +
      '<div class="row"><span class="k">Open interest</span><span class="v">' + oiUsd + '</span></div>' +
      '<div class="row"><span class="k">24h volume</span><span class="v">' + vol + '</span></div>' +
      '<div class="row"><span class="k">Funding</span><span class="v">' + fundLine + '</span></div>' +
      '</div>';
    const moreBtn = $('aboutMore');
    if (moreBtn) moreBtn.onclick = function () {
      const el = $('aboutBlurb');
      const open = el.classList.toggle('open');
      moreBtn.textContent = open ? 'Show less' : 'Show more';
    };
    const copyBtn = $('copyTicker');
    if (copyBtn) copyBtn.onclick = async function () {
      try { await navigator.clipboard.writeText('$' + ticker); toast('Copied $' + ticker); }
      catch (e) { toast('Could not copy'); }
    };
  }

  /* ——— drawings + long-press limit ——— */
  function loadDrawings() {
    try { drawings = JSON.parse(localStorage.getItem(DRAW_KEY) || '{}') || {}; }
    catch (e) { drawings = {}; }
  }
  function saveDrawings() {
    try { localStorage.setItem(DRAW_KEY, JSON.stringify(drawings)); } catch (e) { /* */ }
  }
  function coinDraws() {
    const id = state.coin;
    if (!Array.isArray(drawings[id])) drawings[id] = [];
    return drawings[id];
  }
  function xAtTime(t) {
    if (!chart || t == null) return null;
    const x = chart.timeScale().timeToCoordinate(t);
    return x == null ? null : x;
  }
  function timeAtX(x) {
    if (!chart) return null;
    return chart.timeScale().coordinateToTime(x);
  }
  function priceAtY(y) {
    if (!series) return null;
    const p = series.coordinateToPrice(y);
    return p > 0 ? p : null;
  }

  function setChartInteractive(on) {
    if (!chart) return;
    chartPanOff = !on;
    chart.applyOptions({
      handleScroll: on ? { pinch: true, mouseWheel: true } : false,
      handleScale: on ? { pinch: true, axisPressedMouseMove: true } : false
    });
  }

  function renderDrawings() {
    const host = $('chartDraw');
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!(w > 0 && h > 0)) { host.innerHTML = ''; return; }
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
    coinDraws().forEach((d) => {
      const col = d.color || '#3b8aff';
      const thick = selectedDraw === d.id ? 2.4 : 1.4;
      if (d.type === 'hline') {
        const y = yAt(d.price);
        if (y == null) return;
        svg += '<line x1="0" y1="' + y + '" x2="' + (w - 48) + '" y2="' + y + '" stroke="' + col + '" stroke-width="' + thick + '" stroke-dasharray="4 3"/>';
      } else if (d.type === 'trend') {
        const x1 = xAtTime(d.t1), y1 = yAt(d.p1), x2 = xAtTime(d.t2), y2 = yAt(d.p2);
        if (x1 == null || y1 == null || x2 == null || y2 == null) return;
        svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + col + '" stroke-width="' + thick + '"/>';
      }
    });
    if (measure && measure.a && measure.b) {
      const x1 = measure.a.x, y1 = measure.a.y, x2 = measure.b.x, y2 = measure.b.y;
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
      svg += '<rect x="' + rx + '" y="' + ry + '" width="' + rw + '" height="' + rh + '" fill="rgba(59,138,255,.16)" stroke="rgba(59,138,255,.75)"/>';
    }
    if (crosshair && yAt(crosshair.price) != null) {
      const y = yAt(crosshair.price);
      const x = crosshair.x != null ? crosshair.x : (w / 2);
      svg += '<line x1="0" y1="' + y + '" x2="' + (w - 48) + '" y2="' + y + '" stroke="#fff" stroke-width="1" stroke-dasharray="5 4"/>';
      svg += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="#fff"/>';
    }
    svg += '</svg>';
    let extra = '';
    if (crosshair && yAt(crosshair.price) != null) {
      extra += '<div class="xh-lab" style="top:' + yAt(crosshair.price) + 'px">' + fmtPrice(crosshair.price, true) + '</div>';
    }
    if (measure && measure.a && measure.b) {
      const p1 = measure.a.price, p2 = measure.b.price;
      const dp = p2 - p1;
      const pct = p1 ? (dp / p1) * 100 : 0;
      let barsN = 0, dur = '';
      if (measure.a.time != null && measure.b.time != null) {
        const dt = Math.abs(measure.b.time - measure.a.time);
        const step = (bars.length >= 2) ? Math.abs(bars[bars.length - 1].time - bars[bars.length - 2].time) : 60;
        barsN = step ? Math.round(dt / step) : 0;
        dur = fmtDuration(dt);
      }
      const lab = (dp >= 0 ? '+' : '') + fmtPrice(dp, true) + '  (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)' +
        (barsN ? ('  ·  ' + barsN + ' bars') : '') + (dur ? ('  ·  ' + dur) : '');
      const x = Math.max(8, Math.min(host.clientWidth - 180, (measure.a.x + measure.b.x) / 2));
      const y = Math.max(8, Math.min(host.clientHeight - 40, (measure.a.y + measure.b.y) / 2));
      extra += '<div class="meas-lab" style="left:' + x + 'px;top:' + y + 'px">' + lab + '</div>';
    }
    host.innerHTML = svg + extra;
  }

  function fmtDuration(sec) {
    if (!(sec > 0)) return '';
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.round(sec / 60) + 'm';
    if (sec < 86400) {
      const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
      return h + 'h' + (m ? (' ' + m + 'm') : '');
    }
    const d = Math.floor(sec / 86400), h = Math.round((sec % 86400) / 3600);
    return d + 'd' + (h ? (' ' + h + 'h') : '');
  }

  function renderCrosshair() {
    const btn = $('limitOrderBtn');
    if (!btn) { renderDrawings(); return; }
    if (!crosshair || !(crosshair.price > 0)) { btn.hidden = true; renderDrawings(); return; }
    const y = yAt(crosshair.price);
    const host = $('chartWrap') || $('chart');
    if (y == null || !host) { btn.hidden = true; renderDrawings(); return; }
    btn.hidden = false;
    const top = Math.max(18, Math.min(host.clientHeight - 18, y));
    const x = Math.max(70, Math.min(host.clientWidth - 120, (crosshair.x || 80) + 16));
    btn.style.top = top + 'px';
    btn.style.left = x + 'px';
    renderDrawings();
  }

  function clearCrosshair() {
    crosshair = null;
    const btn = $('limitOrderBtn');
    if (btn) btn.hidden = true;
    if (chartPanOff && drawTool === 'cursor' && !measure) setChartInteractive(true);
    renderDrawings();
  }

  function openLimitAt(price) {
    if (!(price > 0)) return;
    state.typ = 'limit';
    state.limitPx = price;
    saveUi();
    clearCrosshair();
    openOrder(state.side || 'long');
  }

  function localXY(ev, host) {
    const r = host.getBoundingClientRect();
    const pt = ev.touches ? ev.touches[0] || ev.changedTouches[0] : ev;
    return { x: pt.clientX - r.left, y: pt.clientY - r.top };
  }

  function hitDrawing(x, y) {
    const list = coinDraws();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (d.type === 'hline') {
        const yy = yAt(d.price);
        if (yy != null && Math.abs(yy - y) <= 7) return d;
      } else if (d.type === 'trend') {
        const x1 = xAtTime(d.t1), y1 = yAt(d.p1), x2 = xAtTime(d.t2), y2 = yAt(d.p2);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        if (distToSeg(x, y, x1, y1, x2, y2) <= 7) return d;
      }
    }
    return null;
  }
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function setDrawTool(t) {
    if (t !== 'cursor' && t !== 'hline' && t !== 'trend' && t !== 'measure') return;
    drawTool = t;
    pendingTrend = null;
    if (t !== 'measure') measure = null;
    const list = $('toolList');
    if (list) list.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-tool') === t));
    setChartInteractive(t === 'cursor');
    renderDrawings();
  }
  function deleteSelectedDraw() {
    if (!selectedDraw) return false;
    drawings[state.coin] = coinDraws().filter((d) => d.id !== selectedDraw);
    selectedDraw = null;
    saveDrawings();
    renderDrawings();
    return true;
  }
  function clearAllDraws() {
    if (!coinDraws().length) return;
    if (!confirm('Clear all drawings on ' + state.coin + '?')) return;
    drawings[state.coin] = [];
    selectedDraw = null;
    saveDrawings();
    renderDrawings();
  }

  function bindChartUi() {
    loadDrawings();
    const colors = $('toolColors');
    if (colors && !colors.childElementCount) {
      DRAW_COLORS.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.background = c;
        b.setAttribute('data-color', c);
        if (c === drawColor) b.classList.add('on');
        colors.appendChild(b);
      });
    }
    const toggle = $('toolsToggle');
    const tools = $('chartTools');
    if (toggle && tools) {
      if (window.matchMedia && window.matchMedia('(max-width: 480px)').matches) tools.classList.add('collapsed');
      else tools.classList.remove('collapsed');
      toggle.onclick = function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        tools.classList.toggle('collapsed');
      };
    }
    if ($('toolList')) $('toolList').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const col = ev.target.closest && ev.target.closest('[data-color]');
      if (col) {
        drawColor = col.getAttribute('data-color');
        $('toolColors').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === col));
        if (selectedDraw) {
          const d = coinDraws().find((x) => x.id === selectedDraw);
          if (d) { d.color = drawColor; saveDrawings(); renderDrawings(); }
        }
        return;
      }
      const b = ev.target.closest && ev.target.closest('[data-tool]');
      if (!b) return;
      const t = b.getAttribute('data-tool');
      if (t === 'del') { deleteSelectedDraw(); return; }
      if (t === 'clear') { clearAllDraws(); return; }
      setDrawTool(t);
    });
    if ($('limitOrderBtn')) $('limitOrderBtn').onclick = function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (crosshair && crosshair.price > 0) openLimitAt(crosshair.price);
    };

    const host = $('chartWrap');
    if (!host) return;
    let start = null;
    let moved = false;

    let dragLimit = null;
    function onDown(ev) {
      if (ev.target.closest && (ev.target.closest('#chartTools') || ev.target.closest('#limitOrderBtn') || ev.target.closest('.tv-x'))) return;
      const dragEl = ev.target.closest && ev.target.closest('[data-drag-limit]');
      if (dragEl) {
        ev.preventDefault();
        dragLimit = dragEl.getAttribute('data-drag-limit');
        start = { x: 0, y: 0, t: Date.now() };
        moved = false;
        setChartInteractive(false);
        return;
      }
      const pt = localXY(ev, host);
      start = { x: pt.x, y: pt.y, t: Date.now(), shift: !!(ev.shiftKey && ev.pointerType !== 'touch'), btn: ev.button };
      moved = false;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = 0; }
      const useMeasure = drawTool === 'measure' || (start.shift && ev.button === 0);
      if (useMeasure) {
        ev.preventDefault();
        setChartInteractive(false);
        const price = priceAtY(pt.y), time = timeAtX(pt.x);
        measure = { a: { x: pt.x, y: pt.y, price: price, time: time }, b: null };
        renderDrawings();
        return;
      }
      if (drawTool === 'hline' || drawTool === 'trend') {
        ev.preventDefault();
        setChartInteractive(false);
        return;
      }
      if (!(isDesktop() && ev.pointerType !== 'touch')) {
        longPressTimer = setTimeout(() => {
          longPressTimer = 0;
          if (!start || moved) return;
          const price = priceAtY(start.y);
          if (!(price > 0)) return;
          setChartInteractive(false);
          crosshair = { price: price, x: start.x, drag: true };
          renderCrosshair();
        }, 300);
      }
    }
    function onMove(ev) {
      if (!start) return;
      const pt = localXY(ev, host);
      if (Math.hypot(pt.x - start.x, pt.y - start.y) > 8) moved = true;
      if (measure && measure.a) {
        ev.preventDefault();
        measure.b = { x: pt.x, y: pt.y, price: priceAtY(pt.y), time: timeAtX(pt.x) };
        renderDrawings();
        return;
      }
      if (crosshair && crosshair.drag) {
        ev.preventDefault();
        const price = priceAtY(pt.y);
        if (price > 0) { crosshair.price = price; crosshair.x = pt.x; renderCrosshair(); }
        return;
      }
      if (dragLimit) {
        ev.preventDefault();
        const price = priceAtY(pt.y);
        if (price > 0) movePending(dragLimit, price);
        return;
      }
      if (drawTool === 'trend' && pendingTrend) {
        ev.preventDefault();
        pendingTrend.preview = pt;
        // preview via temporary measure-like line
        measure = null;
        renderDrawings();
        const hostEl = $('chartDraw');
        if (hostEl && pendingTrend) {
          const x1 = pendingTrend.x, y1 = pendingTrend.y, x2 = pt.x, y2 = pt.y;
          const prev = hostEl.querySelector('svg');
          if (prev) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1); line.setAttribute('y1', y1);
            line.setAttribute('x2', x2); line.setAttribute('y2', y2);
            line.setAttribute('stroke', drawColor); line.setAttribute('stroke-width', '1.4');
            line.setAttribute('stroke-dasharray', '4 3');
            prev.appendChild(line);
          }
        }
      }
    }
    function onUp(ev) {
      const pt = localXY(ev, host);
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = 0; }
      if (measure && measure.a) {
        measure.b = { x: pt.x, y: pt.y, price: priceAtY(pt.y), time: timeAtX(pt.x) };
        renderDrawings();
        start = null;
        if (drawTool !== 'measure') setChartInteractive(true);
        return;
      }
      if (dragLimit) {
        setChartInteractive(true);
        dragLimit = null;
        start = null;
        return;
      }
      if (crosshair && crosshair.drag) {
        crosshair.drag = false;
        crosshair.pinned = true;
        start = null;
        setChartInteractive(true);
        return;
      }
      if (drawTool === 'hline' && start && !moved) {
        const price = priceAtY(pt.y);
        if (price > 0) {
          coinDraws().push({ id: 'd' + Date.now(), type: 'hline', price: price, color: drawColor });
          saveDrawings(); renderDrawings();
        }
      } else if (drawTool === 'trend') {
        const price = priceAtY(pt.y), time = timeAtX(pt.x);
        if (!pendingTrend) {
          pendingTrend = { x: pt.x, y: pt.y, price: price, time: time };
        } else {
          coinDraws().push({
            id: 'd' + Date.now(), type: 'trend',
            t1: pendingTrend.time, p1: pendingTrend.price,
            t2: time, p2: price, color: drawColor
          });
          pendingTrend = null;
          saveDrawings(); renderDrawings();
        }
      } else if (drawTool === 'cursor' && start && !moved) {
        const hit = hitDrawing(pt.x, pt.y);
        if (hit) {
          selectedDraw = hit.id;
          if (hit.color) {
            drawColor = hit.color;
            if ($('toolColors')) $('toolColors').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.getAttribute('data-color') === drawColor));
          }
          renderDrawings();
        } else if (isDesktop() && ev.pointerType !== 'touch') {
          const price = priceAtY(pt.y);
          if (price > 0) {
            selectedDraw = null;
            crosshair = { price: price, x: pt.x, pinned: true };
            renderCrosshair();
            renderDrawings();
          }
        } else if (crosshair) {
          /* keep mobile long-press pin */
        } else if (measure) { measure = null; renderDrawings(); }
        else {
          selectedDraw = null;
          renderDrawings();
        }
      }
      start = null;
    }

    function onHover(ev) {
      /* Hover must not show the Limit order pill. Built-in chart crosshair is enough. */
    }
    function onLeave(ev) { /* keep a pinned limit crosshair */ }
    document.addEventListener('pointerdown', function (ev) {
      if (!crosshair || !crosshair.pinned) return;
      if (ev.target.closest && (ev.target.closest('#chartWrap') || ev.target.closest('#limitOrderBtn'))) return;
      clearCrosshair();
    }, true);
    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    host.addEventListener('pointermove', onHover);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('contextmenu', (ev) => {
      if (drawTool !== 'cursor' || crosshair) ev.preventDefault();
    });
    window.pendingTrendRef = function () { return pendingTrend; };
  }

  function onCalcMessage(ev) {
    const d = ev.data;
    if (!d || d.type !== 'td-calc-open' || !d.payload) return;
    applyHandoff(d.payload);
  }
  function consumeHandoff() {
    try {
      const raw = localStorage.getItem('td-calc-handoff');
      if (!raw) return;
      const p = JSON.parse(raw);
      localStorage.removeItem('td-calc-handoff');
      if (p && p.v && Date.now() - (p.at || 0) < 60000) applyHandoff(p);
    } catch (e) { /* */ }
  }
  function applyHandoff(p) {
    if (!p) return;
    if (p.platform === 'aster' || p.platform === 'hyperliquid') {
      state.platform = p.platform;
      state.feePct = state.fees[p.platform];
    }
    if (p.coin && COIN_BY_ID[p.coin]) state.coin = p.coin;
    if (p.side === 'long' || p.side === 'short') state.side = p.side;
    if (p.margin > 0) state.margin = +p.margin;
    if (p.lev >= 1) state.lev = clampLev(p.lev);
    if (p.entry > 0) { state.entry = +p.entry; state.livePrice = state.livePrice || +p.entry; }
    if (p.typ === 'limit' || p.typ === 'market') state.typ = p.typ;
    if (p.limit > 0) state.limitPx = +p.limit;
    if (p.tp > 0 && state.margin > 0) {
      const roi = pnlAt(p.tp) / state.margin * 100;
      if (isFinite(roi)) state.tp = roi;
    }
    if (p.sl > 0 && state.margin > 0) {
      const roi = pnlAt(p.sl) / state.margin * 100;
      if (isFinite(roi)) state.sl = roi;
    }
    saveCalc();
    openOrder(state.side || 'long');
  }


  async function init() {
    loadSaved();
    bind();
    syncDesktopLayout();
    renderTf();
    renderAll();
    document.querySelectorAll('#filters [data-filter]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-filter') === state.filter));
    refreshAsterBrackets();
    await refreshDayChange();
    await refreshPrice({ fillEntry: !(state.entry > 0), quiet: true });
    window.addEventListener('message', onCalcMessage);
    consumeHandoff();
    bindChartUi();
    if (isDesktop()) loadChart();
    subscribeLive();
    setInterval(() => { refreshDayChange(); }, 30000);
    setInterval(() => {
      if (!wsIsLive()) refreshPrice({ quiet: true });
      renderLiveSrc();
    }, 8000);
  }

  init().catch((e) => console.error(e));
})();
