/* Paper trade + TP/SL calculator. Paper only — no exchange orders. */
(function () {
  'use strict';

  const CALC_KEY = 'tpsl-calc';
  const PAPER_KEY = 'td-calc-paper-v1';
  const UI_KEY = 'td-calc-ui-v1';
  const START_BAL = 1000000;
  const BASE_MMR = 0.012;
  const TP_CHIPS = [10, 25, 50, 100];
  const SL_CHIPS = [-10, -25, -50, -75];
  const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const TF_LABEL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1D' };
  const TF_LOOKBACK_MS = { '1m': 12 * 3600e3, '5m': 2 * 86400e3, '15m': 5 * 86400e3, '1h': 14 * 86400e3, '4h': 60 * 86400e3, '1d': 200 * 86400e3 };
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
    SOXL: 'Direxion SOXL', MU: 'Micron', AMD: 'AMD', AVGO: 'Broadcom', TSM: 'TSMC', SKHYNIX: 'SK Hynix', NVDA: 'NVIDIA'
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
    { id: 'ANT', name: 'ANT', aster: { symbol: 'ANTUSDT', max: 20, fallback: 92.72 }, hl: { coin: 'xyz:ANT', max: 10, fallback: 92.72, dex: 'xyz' } }
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
    NVDA: [{min:11,max:20,cap:1000000},{min:6,max:10,cap:2000000},{min:5,max:5,cap:5000000},{min:4,max:4,cap:10000000},{min:3,max:3,cap:20000000},{min:2,max:2,cap:40000000},{min:1,max:1,cap:1000000000}]
  };
  const HL_TIERS_FALLBACK = {
    BTC: [{lower:0,maxLev:40},{lower:150000000,maxLev:20}],
    HYPE: [{lower:0,maxLev:10},{lower:20000000,maxLev:5}],
    SOL: [{lower:0,maxLev:20},{lower:70000000,maxLev:10}],
    VVV: [{lower:0,maxLev:3}],
    MRNA: [{lower:0,maxLev:10}], ANT: [{lower:0,maxLev:10}], SOXL: [{lower:0,maxLev:10}],
    MU: [{lower:0,maxLev:10}], AMD: [{lower:0,maxLev:10}], AVGO: [{lower:0,maxLev:10}],
    TSM: [{lower:0,maxLev:10}], SKHYNIX: [{lower:0,maxLev:10}], NVDA: [{lower:0,maxLev:10}]
  };

  let asterBrackets = JSON.parse(JSON.stringify(ASTER_BRACKETS_FALLBACK));
  let hlTiers = JSON.parse(JSON.stringify(HL_TIERS_FALLBACK));
  let hlCache = { at: 0, map: null };
  let dayChange = {};
  let liveMeta = {};
  let fetchGen = 0;
  let marginFlashTimer = 0;
  let padFresh = true;
  let chart = null, series = null, ws = null, wsCoin = '', wsTf = '', bars = [];
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
    chartLines: { entry: true, tp: true, sl: true, liq: true }
  };

  let book = { balance: START_BAL, positions: [], pending: [], history: [], seq: 1 };

  const $ = (id) => document.getElementById(id);

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
  function markOf(id) {
    const c = COIN_BY_ID[id] || currentCoin();
    if (c.id === state.coin && state.livePrice > 0) return state.livePrice;
    const meta = liveMeta[c.id];
    if (meta && meta.px > 0) return meta.px;
    const s = coinSpec(c);
    return (s && s.fallback) || 0;
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
      const px = parseFloat(ctx && (ctx.markPx || ctx.midPx || ctx.oraclePx));
      const prev = parseFloat(ctx && ctx.prevDayPx);
      const fund = parseFloat(ctx && ctx.funding);
      const oi = parseFloat(ctx && ctx.openInterest);
      const row = {
        px: px > 0 ? px : null,
        max: u.maxLeverage,
        prevDay: prev > 0 ? prev : null,
        funding: isFinite(fund) ? fund : null,
        oi: oi > 0 ? oi : null
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
    try {
      const r = await fetch(ASTER_API + '/premiumIndex?symbol=' + encodeURIComponent(symbol), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        const p = parseFloat(j.markPrice);
        const fund = parseFloat(j.lastFundingRate);
        if (p > 0) return { px: p, funding: isFinite(fund) ? fund : null };
      }
    } catch (e) { /* try last price */ }
    try {
      const r = await fetch(ASTER_API + '/ticker/price?symbol=' + encodeURIComponent(symbol), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        const p = parseFloat(j.price);
        if (p > 0) return { px: p };
      }
    } catch (e) { /* fallback */ }
    return null;
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
        if (last > 0) liveMeta[c.id] = Object.assign({}, liveMeta[c.id], { px: last });
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
        if (row && row.px > 0) return row.px;
      } catch (e) { /* */ }
      return null;
    }
    const got = await fetchAsterPrice(c.aster.symbol);
    if (got && got.px > 0) {
      liveMeta[c.id] = Object.assign({}, liveMeta[c.id], got);
      return got.px;
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
    } else {
      state.livePrice = fallback || state.livePrice || null;
      state.priceStatus = 'fallback';
      if (fillEntry && fallback > 0) state.entry = fallback;
      if (!quiet) toast('No price from ' + platformName() + ', using last known');
    }
    saveCalc();
    tickBook();
    renderAll();
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
    ['markets', 'asset', 'positions'].forEach((v) => {
      const map = { markets: 'screenMarkets', asset: 'screenAsset', positions: 'screenPos' };
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

  function openCoin(id) {
    const coin = COIN_BY_ID[id];
    if (!coin || !coinAvailable(coin)) { toast('Not on ' + platformName()); return; }
    state.coin = coin.id;
    state.lev = clampLev(state.lev);
    clampMarginToLimit({ flash: false });
    saveCalc();
    setView('asset');
    renderAll();
    refreshPrice({ fillEntry: !state.entry, quiet: true });
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
      const px = markOf(c.id);
      const fillNow = rec.side === 'long' ? px <= rec.entry : px >= rec.entry;
      if (!fillNow) {
        book.pending.push(rec);
        savePaper();
        closeOrder();
        toast('Limit resting at ' + fmtPrice(rec.entry, true));
        renderAll();
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
      const px = markOf(o.coin);
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
    if (!confirm('Reset the paper account to $1,000,000? Positions and orders will be cleared.')) return;
    book = { balance: START_BAL, positions: [], pending: [], history: [], seq: 1 };
    savePaper();
    toast('Account reset to $1,000,000');
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
      timeScale: { borderColor: '#1a1a1a', timeVisible: true, secondsVisible: state.tf === '1m' },
      crosshair: { vertLine: { color: '#333', labelBackgroundColor: '#222' }, horzLine: { color: '#333', labelBackgroundColor: '#222' } },
      handleScroll: { pinch: true, mouseWheel: true },
      handleScale: { pinch: true, axisPressedMouseMove: true }
    };
  }
  function candleStyle() {
    return {
      upColor: UP, downColor: DN,
      borderVisible: false,
      wickUpColor: UP, wickDownColor: DN
    };
  }
  function sizeChart() {
    if (chart && $('chart')) chart.applyOptions({ width: $('chart').clientWidth, height: $('chart').clientHeight });
  }
  function parseBar(row) {
    const t = Math.floor((row.t || row.T || 0) / 1000);
    return {
      time: t,
      open: +row.o, high: +row.h, low: +row.l, close: +row.c
    };
  }
  async function loadChart() {
    const host = $('chart');
    if (!host) return;
    const c = currentCoin();
    const coin = c.hl && c.hl.coin;
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
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () { renderOverlay(); });
    const end = Date.now();
    const span = TF_LOOKBACK_MS[state.tf] || 12 * 3600e3;
    try {
      const raw = await hlInfo({ type: 'candleSnapshot', req: { coin: coin, interval: state.tf, startTime: end - span, endTime: end } });
      bars = (raw || []).map(parseBar).filter((b) => b.time && b.close > 0);
      bars.sort((a, b) => a.time - b.time);
      const seen = {};
      bars = bars.filter((b) => { if (seen[b.time]) return false; seen[b.time] = 1; return true; });
      series.setData(bars);
      chart.timeScale().fitContent();
    } catch (e) {
      bars = [];
    }
    subscribeCandles(coin, state.tf);
    renderOverlay();
  }
  function subscribeCandles(coin, tf) {
    if (ws && (wsCoin !== coin || wsTf !== tf)) {
      try { ws.close(); } catch (e) { /* */ }
      ws = null;
    }
    wsCoin = coin; wsTf = tf;
    if (ws && ws.readyState === 1) return;
    try {
      ws = new WebSocket(HL_WS);
      ws.onopen = function () {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: coin, interval: tf } }));
      };
      ws.onmessage = function (ev) {
        try {
          const msg = JSON.parse(ev.data);
          const d = msg.data || (msg.channel === 'candle' && msg.data);
          if (!d || !d.s && !d.T && !d.t) {
            if (msg.data && (msg.data.t || msg.data.T)) applyLiveBar(msg.data);
            return;
          }
          applyLiveBar(d);
        } catch (e) { /* */ }
      };
      ws.onclose = function () { ws = null; };
    } catch (e) { ws = null; }
  }
  function applyLiveBar(row) {
    const bar = parseBar(row);
    if (!bar.time || !(bar.close > 0) || !series) return;
    const last = bars[bars.length - 1];
    if (!last || bar.time > last.time) bars.push(bar);
    else if (bar.time === last.time) bars[bars.length - 1] = bar;
    else return;
    series.update(bar);
    if (isHl() || !state.livePrice) {
      state.livePrice = bar.close;
      liveMeta[state.coin] = Object.assign({}, liveMeta[state.coin], { px: bar.close });
    }
    tickBook();
    renderAssetHead();
    renderAccount();
    renderOverlay();
    if (!$('orderSheet').hidden) renderOrder();
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
          '<div class="tv-pnl' + (u < 0 ? ' neg' : '') + '">' + fmtUsd(u, true) + ' · ' + fmtPct(roe, true) + '</div>' +
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
    el.innerHTML = html;
  }

  /* ——— render ——— */
  function renderAccount() {
    const eq = equity(), upnl = upnlTotal();
    const set = (id, val, cls) => {
      const el = $(id); if (!el) return;
      el.textContent = val;
      if (cls != null) el.className = cls;
    };
    set('hdrBal', fmtUsd(book.balance));
    set('hdrPnl', fmtUsd(upnl, true), 'bal-pnl' + (upnl > 0 ? ' up' : upnl < 0 ? ' dn' : ''));
    set('posBal', fmtUsd(eq));
    set('availBal', fmtUsd(freeMargin()));
  }

  function renderMarkets() {
    const list = $('mktList'); if (!list) return;
    let html = '';
    COINS.forEach((c) => {
      if (state.filter === 'crypto' && kindOf(c) !== 'crypto') return;
      if (state.filter === 'stock' && kindOf(c) === 'crypto') return;
      if (!coinAvailable(c)) return;
      const px = markOf(c.id);
      const chg = dayChange[c.id];
      const max = (coinSpec(c) && coinSpec(c).max) || '';
      html += '<button type="button" class="mkt-row" data-coin="' + c.id + '">' +
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
    const px = markOf(c.id);
    const chg = dayChange[c.id];
    const meta = liveMeta[c.id] || {};
    if ($('assetName')) $('assetName').textContent = c.name;
    const logo = $('assetLogo');
    if (logo) { logo.src = logoSrc(c.id); logo.alt = c.name; }
    if ($('assetLev')) $('assetLev').textContent = levMax() + 'x';
    const fund = meta.funding != null ? ((meta.funding * 100).toFixed(4) + '%') : '—';
    const oi = meta.oi > 0 ? fmtUsd(meta.oi * (px || 0), false) : '';
    if ($('assetMeta')) $('assetMeta').textContent = 'Fund ' + fund + (oi ? ' · OI ' + oi : '');
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
      '<div><span>Entry</span><b>' + fmtPrice(p.entry, true) + '</b></div>' +
      '<div><span>Mark</span><b>' + fmtPrice(markOf(p.coin), true) + '</b></div>' +
      '<div><span>Liq</span><b>' + (p.liq ? fmtPrice(p.liq, true) : '—') + '</b></div>' +
      '<div><span>TP / SL</span><b>' + (p.tp ? fmtPrice(p.tp) : '—') + ' / ' + (p.sl ? fmtPrice(p.sl) : '—') + '</b></div>' +
      '<div><span>PnL</span><b class="' + chgClass(u) + '">' + fmtUsd(u, true) + ' · ' + fmtPct(roe, true) + '</b></div>' +
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

  function renderPositions() {
    renderPosCard();
    const el = $('posList'); if (!el) return;
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
    if ($('amtUsd')) $('amtUsd').textContent = fmtUsd(state.margin);
    if ($('amtCoin')) { const q = qty(); $('amtCoin').textContent = '= ' + (q > 0 ? trimFixed(q, q >= 1 ? 4 : 6) : '0') + ' ' + c.name; }
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
    if ($('tpslPanel')) $('tpslPanel').hidden = !state.showTpsl;
    if ($('sizeTools')) $('sizeTools').hidden = !!state.showTpsl;
    if ($('btnAddTpsl')) $('btnAddTpsl').textContent = state.showTpsl ? 'TP / SL on' : 'Add TP/SL +';
    renderTpslFields();
    if ($('availBal')) $('availBal').textContent = fmtUsd(freeMargin());
    const go = $('btnSubmit');
    if (go) {
      go.textContent = sideWord + ' ' + c.name;
      go.className = 'submit ' + (state.side === 'short' ? 'short' : 'long');
    }
    if ($('pasteTitle')) $('pasteTitle').textContent = 'Enter on ' + platformName();
    if ($('feePct') && !focused.has($('feePct'))) $('feePct').value = String(state.feePct);
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
    if (!$('orderSheet').hidden) renderOrder();
    renderOverlay();
  }

  function openOrder(side) {
    state.side = side;
    state.amountOn = true;
    padFresh = true;
    state.showTpsl = !!(state.tp != null || state.sl != null);
    if (state.typ === 'limit' && !(state.limitPx > 0)) state.limitPx = plannedEntry();
    clampMarginToLimit({ flash: false });
    $('orderSheet').hidden = false;
    $('orderScrim').hidden = false;
    err('');
    renderOrder();
  }
  function closeOrder() {
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

  function setMarginRaw(s) {
    const n = parseNum(s);
    if (!isFinite(n) || n < 0) return;
    state.margin = n;
    const cap = marginCap();
    const lim = sizeLimit();
    if (lim.available && !lim.uncapped && n > lim.maxMargin + 1e-9) {
      state.margin = lim.maxMargin;
      flashMarginMax('Max ' + fmtMaxMargin(lim.maxMargin) + ' at ' + state.lev + 'x');
    } else if (n > freeMargin() + 1e-9) {
      state.margin = Math.max(0, Math.floor(freeMargin() * 100) / 100);
      flashMarginMax('Max available ' + fmtUsd(state.margin));
    }
    saveCalc();
    renderOrder();
  }

  function padKey(k) {
    if (!state.amountOn) state.amountOn = true;
    let v = padFresh ? '' : String(state.margin || '');
    padFresh = false;
    if (k === 'del') v = v.slice(0, -1);
    else if (k === '.') { if (v.indexOf('.') < 0) v = (v || '0') + '.'; }
    else v += k;
    if (v === '' || v === '.') { state.margin = v === '.' ? 0 : 0; $('amtUsd').textContent = v === '' ? '$0' : '$.'; return; }
    setMarginRaw(v);
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
    $('btnOrderClose').onclick = closeOrder;
    $('orderScrim').onclick = closeOrder;
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

    $('amtBox').onclick = () => { state.amountOn = !state.amountOn; padFresh = true; renderOrder(); };
    $('levRange').addEventListener('input', () => setLev($('levRange').value));
    $('btnAddTpsl').onclick = () => { state.showTpsl = true; renderOrder(); };
    $('btnSaveTpsl').onclick = () => { state.showTpsl = false; saveCalc(); renderOrder(); };
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
      state.margin = Math.floor(cap * pct * 100) / 100;
      padFresh = true;
      saveCalc();
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

    window.addEventListener('resize', sizeChart);
  }

  async function init() {
    loadSaved();
    bind();
    renderTf();
    renderAll();
    document.querySelectorAll('#filters [data-filter]').forEach((x) => x.classList.toggle('on', x.getAttribute('data-filter') === state.filter));
    refreshAsterBrackets();
    await refreshDayChange();
    await refreshPrice({ fillEntry: !(state.entry > 0), quiet: true });
    setInterval(() => {
      refreshDayChange();
      refreshPrice({ quiet: true });
    }, 20000);
  }

  init().catch((e) => console.error(e));
})();
