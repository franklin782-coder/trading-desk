/* TradingView-style drawing toolbar + tools for the DEMO chart. */
(function (root) {
  'use strict';

  const LS = 'td-demo-xyz100-drawings-v1';
  const FIBS = [
    { l: 0, c: '#787B86' },
    { l: 0.236, c: '#F23645' },
    { l: 0.382, c: '#FF9800' },
    { l: 0.5, c: '#089981' },
    { l: 0.618, c: '#2962FF' },
    { l: 0.786, c: '#9C27B0' },
    { l: 1, c: '#787B86' },
    { l: 1.618, c: '#E91E63' }
  ];
  const TOOLS = [
    { id: 'cursor', label: 'Cursor', hint: '' },
    { id: 'trend', label: 'Trend line', hint: 'Alt+T' },
    { id: 'hline', label: 'Horizontal line', hint: 'Alt+H' },
    { id: 'hray', label: 'Horizontal ray', hint: 'Alt+J' },
    { id: 'vline', label: 'Vertical line', hint: 'Alt+V' },
    { id: 'ray', label: 'Ray', hint: '' },
    { id: 'rect', label: 'Rectangle', hint: 'Alt+Shift+R' },
    { id: 'fib', label: 'Fib retracement', hint: 'Alt+F' },
    { id: 'longpos', label: 'Long position', hint: '' },
    { id: 'shortpos', label: 'Short position', hint: '' },
    { id: 'text', label: 'Text', hint: '' },
    { id: 'measure', label: 'Measure', hint: 'Shift+Click' },
    { id: 'brush', label: 'Brush', hint: '' }
  ];
  const TOGGLES = [
    { id: 'magnet', label: 'Magnet', hint: '' },
    { id: 'lock', label: 'Lock drawings', hint: '' },
    { id: 'hide', label: 'Hide drawings', hint: '' },
    { id: 'trash', label: 'Remove all drawings', hint: '' }
  ];

  const ICONS = {
    cursor: '<svg viewBox="0 0 24 24"><path d="M5 3l14 11h-7l-2 7z" fill="currentColor" stroke="none"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 18L20 6" stroke-width="1.8" stroke-linecap="round"/></svg>',
    hline: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h18" stroke-width="1.8" stroke-linecap="round"/></svg>',
    hray: '<svg viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M7 12h14" stroke-width="1.8" stroke-linecap="round"/></svg>',
    vline: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v18" stroke-width="1.8" stroke-linecap="round"/></svg>',
    ray: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 19L19 5" stroke-width="1.8" stroke-linecap="round"/><path d="M14 5h5v5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rect: '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="6" width="14" height="12" rx="1" stroke-width="1.7"/></svg>',
    fib: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke-width="1.5"/></svg>',
    longpos: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 14v6h10v-6" stroke-width="1.6"/><path d="M7 14V8h10v6" stroke-width="1.6" fill="currentColor" opacity=".25"/><path d="M12 4v6M9 7l3-3 3 3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shortpos: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 10V4h10v6" stroke-width="1.6"/><path d="M7 10v6h10v-6" stroke-width="1.6" fill="currentColor" opacity=".25"/><path d="M12 20v-6M9 17l3 3 3-3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 6h14M12 6v13" stroke-width="1.8" stroke-linecap="round"/></svg>',
    measure: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 16L16 5" stroke-width="1.7" stroke-linecap="round"/><path d="M5 16h6M16 5v6" stroke-width="1.6" stroke-linecap="round"/></svg>',
    brush: '<svg viewBox="0 0 24 24" fill="none"><path d="M14 4l6 6-8 8H6v-6l8-8z" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 7l4 4" stroke-width="1.5"/></svg>',
    magnet: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 4v8a6 6 0 0012 0V4" stroke-width="1.8" stroke-linecap="round"/><path d="M6 4h4v8a2 2 0 01-4 0V4zm8 0h4v8a2 2 0 01-4 0V4z" stroke-width="1.4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="11" width="12" height="9" rx="1.5" stroke-width="1.7"/><path d="M8 11V8a4 4 0 018 0v3" stroke-width="1.7" stroke-linecap="round"/></svg>',
    hide: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" stroke-width="1.6"/><circle cx="12" cy="12" r="2.5" stroke-width="1.6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  const LS_V2 = 'td-demo-drawings-v2';
  let activeInst = null;
  const INSTANCES = [];

  function allStore() {
    try { return JSON.parse(localStorage.getItem(LS_V2) || 'null') || {}; } catch (e) { return {}; }
  }
  function migrateV1Into(map) {
    try {
      const j = JSON.parse(localStorage.getItem(LS) || 'null');
      if (j && Array.isArray(j.drawings) && j.drawings.length && !map['xyz:XYZ100']) {
        map['xyz:XYZ100'] = { drawings: j.drawings, seq: j.seq || (j.drawings.length + 1), magnet: !!j.magnet };
      }
    } catch (e) { /* */ }
    return map;
  }

  function create(options) {
  let opts = null;
  let tool = 'cursor';

  let magnet = false, locked = false, hidden = false;
  let drawings = [];
  let selected = null;
  let undo = [];
  let draft = null;
  let measureTmp = null;
  let measurePhase = null; // null | 'tracking' | 'fixed'
  let measureHeld = false;
  let measureStartXY = null;
  let measureLab = null;
  let chartInteractive = true;
  let dragging = null;
  let seq = 1;
  let svg, layer, toolbar, tipEl, capture, host;

  function chart() { return opts && opts.getChart(); }
  function series() { return opts && opts.getSeries(); }
  function candles() { return (opts && opts.getCandles && opts.getCandles()) || []; }

  function isTyping(ev) {
    const el = ev.target;
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
  }

  function coinKey() {
    return (opts && opts.getCoin && opts.getCoin()) || 'xyz:XYZ100';
  }
  function load() {
    try {
      const map = migrateV1Into(allStore());
      const j = map[coinKey()];
      if (j && Array.isArray(j.drawings)) {
        drawings = j.drawings;
        seq = j.seq || (drawings.length + 1);
        magnet = !!j.magnet;
      } else { drawings = []; seq = 1; }
    } catch (e) { drawings = []; }
  }
  function persist() {
    try {
      const map = migrateV1Into(allStore());
      map[coinKey()] = { drawings, seq, magnet };
      localStorage.setItem(LS_V2, JSON.stringify(map));
    } catch (e) { /* */ }
  }
  function reloadCoin() {
    selected = null; draft = null; dragging = null;
    clearMeasure();
    load();
    redraw();
  }
  function snapshot() {
    undo.push(JSON.stringify(drawings));
    if (undo.length > 60) undo.shift();
  }
  function doUndo() {
    if (!undo.length || locked) return;
    const prev = undo.pop();
    try { drawings = JSON.parse(prev); } catch (e) { return; }
    selected = null;
    persist();
    redraw();
  }

  function svgEl(name, attrs, html) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
    if (html) e.innerHTML = html;
    return e;
  }

  function plotSize() {
    const c = chart();
    const el = opts && opts.plotEl && opts.plotEl();
    const w = (el && el.clientWidth) || 0;
    const h = (el && el.clientHeight) || 0;
    const axisW = c && c.priceScale ? Math.max(0, c.priceScale('right').width() || 0) : 0;
    const plotW = c && c.timeScale ? (c.timeScale().width() || Math.max(0, w - axisW)) : w;
    return { w, h, plotW, axisW };
  }

  function toXY(pt) {
    const c = chart(), s = series();
    if (!c || !s || !pt) return null;
    const x = c.timeScale().timeToCoordinate(pt.t);
    const y = s.priceToCoordinate(pt.p);
    if (x == null || y == null) return null;
    return { x, y };
  }
  function fromXY(x, y) {
    const c = chart(), s = series();
    if (!c || !s) return null;
    let t = c.timeScale().coordinateToTime(x);
    let p = s.coordinateToPrice(y);
    if (t == null || p == null) return null;
    if (typeof t === 'object' && t.timestamp) t = t.timestamp;
    if (magnet) {
      const bars = candles();
      let best = null, bestD = 1e15;
      for (let i = 0; i < bars.length; i++) {
        const bx = c.timeScale().timeToCoordinate(bars[i].time);
        if (bx == null) continue;
        const d = Math.abs(bx - x);
        if (d < bestD) { bestD = d; best = bars[i]; }
      }
      if (best && bestD < 14) {
        t = best.time;
        const levels = [best.open, best.high, best.low, best.close];
        let closest = levels[0], cd = 1e15;
        levels.forEach(lv => {
          const ly = s.priceToCoordinate(lv);
          if (ly == null) return;
          const d = Math.abs(ly - y);
          if (d < cd) { cd = d; closest = lv; }
        });
        if (cd < 14) p = closest;
      }
    }
    return { t: +t, p: +p };
  }

  function fromXYLoose(x, y) {
    const strict = fromXY(x, y);
    if (strict) return strict;
    const c = chart(), s = series();
    if (!c || !s) return null;
    let t = c.timeScale().coordinateToTime(x);
    let p = s.coordinateToPrice(y);
    if (typeof t === 'object' && t && t.timestamp) t = t.timestamp;
    const bars = candles();
    if ((t == null || t === undefined) && bars.length) {
      const tFirst = bars[0].time, tLast = bars[bars.length - 1].time;
      const x0 = c.timeScale().timeToCoordinate(tFirst);
      const x1 = c.timeScale().timeToCoordinate(tLast);
      if (x0 != null && x1 != null && x1 !== x0) {
        t = tFirst + ((x - x0) / (x1 - x0)) * (tLast - tFirst);
      } else {
        t = x < (x0 == null ? 0 : x0) ? tFirst : tLast;
      }
    }
    if (t == null || p == null) return null;
    return { t: +t, p: +p };
  }

  function extendRay(a, b, bounds) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return b;
    const ts = [];
    if (dx !== 0) {
      ts.push((bounds.left - a.x) / dx);
      ts.push((bounds.right - a.x) / dx);
    }
    if (dy !== 0) {
      ts.push((bounds.top - a.y) / dy);
      ts.push((bounds.bottom - a.y) / dy);
    }
    let tBest = 0;
    ts.forEach(t => { if (t > tBest) tBest = t; });
    return { x: a.x + dx * Math.max(tBest, 1), y: a.y + dy * Math.max(tBest, 1) };
  }

  function fmtP(p) {
    if (!(p > 0) && p !== 0) return '—';
    const d = p >= 1000 ? 1 : p >= 100 ? 2 : 3;
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtDelta(a, b) {
    const d = b - a;
    const pct = a ? (d / a) * 100 : 0;
    const sign = d > 0 ? '+' : '';
    return sign + d.toFixed(Math.abs(d) >= 100 ? 1 : 2) + '  (' + sign + pct.toFixed(2) + '%)';
  }

  function nextId() { return 'dr' + (seq++); }

  function setTool(id) {
    if (id === 'trash') {
      if (!drawings.length) return;
      if (!confirm('Remove all drawings?')) return;
      snapshot();
      drawings = [];
      selected = null;
      persist();
      redraw();
      return;
    }
    if (id === 'magnet') { magnet = !magnet; persist(); syncToolbar(); return; }
    if (id === 'lock') { locked = !locked; selected = locked ? null : selected; syncToolbar(); redraw(); return; }
    if (id === 'hide') { hidden = !hidden; selected = hidden ? null : selected; syncToolbar(); redraw(); return; }
    tool = id;
    draft = null;
    clearMeasure();
    syncToolbar();
    updateCapture();
  }

  function syncToolbar() {
    if (!toolbar) return;
    toolbar.querySelectorAll('[data-tool]').forEach(b => {
      const id = b.dataset.tool;
      b.classList.toggle('on', id === tool || (id === 'magnet' && magnet) || (id === 'lock' && locked) || (id === 'hide' && hidden));
    });
  }
  function updateCapture() {
    if (!capture) return;
    const tracking = measurePhase === 'tracking';
    const need = tool !== 'cursor' || !!draft || !!dragging || tracking;
    capture.style.pointerEvents = need ? 'auto' : 'none';
    if (layer) {
      layer.classList.toggle('drawing', tool !== 'cursor' || tracking);
      layer.classList.toggle('measuring', tracking);
    }
  }

  function setChartInteractive(on) {
    chartInteractive = !!on;
    const c = chart();
    if (!c) return;
    try { c.applyOptions({ handleScroll: !!on, handleScale: !!on }); } catch (e) { /* */ }
  }

  function eventInPlot(ev) {
    if (!host || !svg) return false;
    if (ev.target && ev.target.closest && ev.target.closest('.tv-toolbar')) return false;
    const r = svg.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  }

  function fmtSpan(sec) {
    sec = Math.abs(+sec || 0);
    if (sec < 1) return '<1s';
    if (sec < 60) return Math.round(sec) + 's';
    if (sec < 3600) {
      const m = Math.floor(sec / 60), s = Math.round(sec % 60);
      return s && m < 15 ? m + 'm ' + s + 's' : m + 'm';
    }
    if (sec < 86400) {
      const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
      return m ? h + 'h ' + m + 'm' : h + 'h';
    }
    const d = Math.floor(sec / 86400), h = Math.round((sec % 86400) / 3600);
    return h ? d + 'd ' + h + 'h' : d + 'd';
  }

  function barCount(t0, t1) {
    const a = Math.min(t0, t1), b = Math.max(t0, t1);
    const bars = candles();
    let n = bars.filter(function (z) { return z.time >= a && z.time <= b; }).length;
    if (n >= 2) return n;
    let iv = 60;
    if (bars.length >= 2) {
      const d = Math.abs(bars[bars.length - 1].time - bars[0].time);
      iv = d / Math.max(1, bars.length - 1) || 60;
    }
    return Math.max(1, Math.round(Math.abs(b - a) / iv) + 1);
  }

  function fmtUsdSigned(n) {
    if (!isFinite(n)) return '—';
    const sign = n > 0 ? '+' : n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function measureInfo(d) {
    if (!d || !d.points || !d.points[0] || !d.points[1]) return null;
    const p0 = d.points[0].p, p1 = d.points[1].p;
    const t0 = d.points[0].t, t1 = d.points[1].t;
    const delta = p1 - p0;
    const pct = p0 ? (delta / p0) * 100 : 0;
    let tickSize = 0.01, qty = 0, side = 'long';
    const ctx = opts && opts.getMeasureInfo && opts.getMeasureInfo();
    if (ctx) {
      if (ctx.tickSize > 0) tickSize = ctx.tickSize;
      if (ctx.qty > 0) qty = ctx.qty;
      if (ctx.side) side = ctx.side;
    }
    const ticks = tickSize > 0 ? Math.abs(delta) / tickSize : 0;
    const pnl = side === 'short' ? qty * (p0 - p1) : qty * (p1 - p0);
    return {
      up: p1 >= p0, delta: delta, pct: pct, ticks: ticks,
      bars: barCount(t0, t1), span: fmtSpan(t1 - t0),
      pnl: pnl, hasPnl: qty > 0
    };
  }

  function syncMeasureLabel(d) {
    if (!measureLab || !layer) return;
    const info = measureInfo(d);
    const a = d && d.points && d.points[0] && toXY(d.points[0]);
    const b = d && d.points && d.points[1] && toXY(d.points[1]);
    if (!info || !a || !b) { measureLab.hidden = true; return; }
    const sign = info.delta > 0 ? '+' : '';
    const tickStr = (info.ticks >= 10 ? String(Math.round(info.ticks)) : info.ticks.toFixed(1)) + ' ticks';
    let html = '<div class="m-delta">' + sign + info.delta.toFixed(Math.abs(info.delta) >= 100 ? 1 : 2) + '  (' + sign + info.pct.toFixed(2) + '%)</div>';
    html += '<div class="m-sub">' + tickStr + '</div>';
    html += '<div class="m-sub">' + info.bars + ' bars · ' + info.span + '</div>';
    if (info.hasPnl) html += '<div class="m-sub">Est. PnL ' + fmtUsdSigned(info.pnl) + '</div>';
    measureLab.innerHTML = html;
    measureLab.classList.toggle('up', info.up);
    measureLab.classList.toggle('dn', !info.up);
    measureLab.hidden = false;
    const lw = measureLab.offsetWidth || 140;
    const lh = measureLab.offsetHeight || 70;
    const maxW = layer.clientWidth || 0;
    const maxH = layer.clientHeight || 0;
    let lx = b.x + 10;
    let ly = b.y - lh / 2;
    if (lx + lw > maxW - 8) lx = b.x - lw - 10;
    if (lx < 40) lx = 40;
    if (ly < 8) ly = 8;
    if (ly + lh > maxH - 8) ly = Math.max(8, maxH - lh - 8);
    measureLab.style.left = lx + 'px';
    measureLab.style.top = ly + 'px';
  }

  function clearOtherMeasures() {
    INSTANCES.forEach(function (inst) {
      if (inst !== api && inst.clearMeasure) inst.clearMeasure();
    });
  }

  function startMeasureAt(ev) {
    if (!svg) return false;
    const xy = eventXY(ev);
    const pt = fromXYLoose(xy.x, xy.y);
    if (!pt) return false;
    clearOtherMeasures();
    activeInst = api;
    measureTmp = { id: 'tmp', type: 'measure', points: [pt, { t: pt.t, p: pt.p }], color: '#2962FF' };
    measurePhase = 'tracking';
    measureHeld = true;
    measureStartXY = { x: ev.clientX, y: ev.clientY };
    dragging = { kind: 'measure' };
    setChartInteractive(false);
    updateCapture();
    redraw();
    return true;
  }

  function fixMeasure() {
    if (!measureTmp || !measureTmp.points || !measureTmp.points[0] || !measureTmp.points[1]) {
      clearMeasure();
      return;
    }
    const a = toXY(measureTmp.points[0]), b = toXY(measureTmp.points[1]);
    const moved = a && b && (Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2);
    const same = measureTmp.points[0].t === measureTmp.points[1].t && measureTmp.points[0].p === measureTmp.points[1].p;
    if (!moved && same) { clearMeasure(); return; }
    measurePhase = 'fixed';
    measureHeld = false;
    if (dragging && dragging.kind === 'measure') dragging = null;
    setChartInteractive(true);
    updateCapture();
    redraw();
  }

  function clearMeasure() {
    measureTmp = null;
    measurePhase = null;
    measureHeld = false;
    measureStartXY = null;
    if (dragging && dragging.kind === 'measure') dragging = null;
    setChartInteractive(true);
    if (measureLab) measureLab.hidden = true;
    updateCapture();
    if (svg) redraw();
  }

  function updateMeasureEnd(ev) {
    if (measurePhase !== 'tracking' || !measureTmp || !svg) return;
    const xy = eventXY(ev);
    const pt = fromXYLoose(xy.x, xy.y);
    if (!pt) return;
    measureTmp.points[1] = pt;
    redraw();
  }

  function onHostPointerDown(ev) {
    if (ev.button !== 0 || isTyping(ev)) return;
    if (!eventInPlot(ev)) return;
    if (measurePhase === 'tracking') {
      ev.preventDefault();
      ev.stopPropagation();
      fixMeasure();
      return;
    }
    if (measurePhase === 'fixed') {
      ev.preventDefault();
      ev.stopPropagation();
      const again = ev.shiftKey || tool === 'measure';
      clearMeasure();
      if (again) startMeasureAt(ev);
      return;
    }
    if (ev.shiftKey || tool === 'measure') {
      ev.preventDefault();
      ev.stopPropagation();
      startMeasureAt(ev);
    }
  }

  function showTip(btn, ev) {
    if (!tipEl) return;
    const name = btn.getAttribute('data-label') || '';
    const hint = btn.getAttribute('data-hint') || '';
    tipEl.textContent = hint ? name + '  ' + hint : name;
    const r = btn.getBoundingClientRect();
    const hostR = host.getBoundingClientRect();
    tipEl.style.left = (r.right - hostR.left + 8) + 'px';
    tipEl.style.top = (r.top - hostR.top + r.height / 2) + 'px';
    tipEl.hidden = false;
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; }

  function buildToolbar(parent) {
    toolbar = document.createElement('div');
    toolbar.className = 'tv-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Drawing tools');
    function addBtn(spec) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tool = spec.id;
      b.setAttribute('data-label', spec.label);
      b.setAttribute('data-hint', spec.hint || '');
      b.setAttribute('aria-label', spec.hint ? spec.label + ' (' + spec.hint + ')' : spec.label);
      b.innerHTML = ICONS[spec.id] || '';
      b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); setTool(spec.id); });
      b.addEventListener('mouseenter', () => showTip(b));
      b.addEventListener('mouseleave', hideTip);
      toolbar.appendChild(b);
    }
    TOOLS.forEach(addBtn);
    const sep = document.createElement('div');
    sep.className = 'tv-tsep';
    toolbar.appendChild(sep);
    TOGGLES.forEach(addBtn);
    parent.appendChild(toolbar);
    tipEl = document.createElement('div');
    tipEl.className = 'tv-tool-tip';
    tipEl.hidden = true;
    parent.appendChild(tipEl);
  }

  function visibleDrawings() {
    if (hidden) return [];
    return drawings;
  }

  function hitWidth() { return 10; }

  function renderItem(g, d, isDraft) {
    const { plotW, h } = plotSize();
    const LEFT = 42;
    const col = d.color || '#2962FF';
    const pts = (d.points || []).map(toXY);
    const sel = !isDraft && selected === d.id;
    const sw = sel ? 2.2 : 1.5;

    function hit(el, extra) {
      if (isDraft) return;
      el.style.pointerEvents = 'stroke';
      el.setAttribute('data-id', d.id);
      el.classList.add('tv-hit');
      if (extra) extra(el);
    }
    function line(x1, y1, x2, y2, color, width, dash) {
      const vis = svgEl('line', { x1, y1, x2, y2, stroke: color || col, 'stroke-width': width || sw, fill: 'none', 'stroke-linecap': 'round' });
      if (dash) vis.setAttribute('stroke-dasharray', dash);
      g.appendChild(vis);
      if (!isDraft) {
        const hline = svgEl('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': hitWidth(), fill: 'none', 'data-id': d.id });
        hline.style.pointerEvents = 'stroke';
        hline.classList.add('tv-hit');
        g.appendChild(hline);
      }
      return vis;
    }
    function label(x, y, text, color, anchor) {
      const t = svgEl('text', {
        x, y, fill: color || '#B2B5BE', 'font-size': 10,
        'font-family': "Trebuchet MS, Segoe UI, Arial, sans-serif",
        'text-anchor': anchor || 'start'
      });
      t.textContent = text;
      t.style.pointerEvents = 'none';
      g.appendChild(t);
      return t;
    }

    if (d.type === 'hline' && pts[0]) {
      line(0, pts[0].y, plotW, pts[0].y);
      label(LEFT, pts[0].y - 4, fmtP(d.points[0].p), col);
    } else if (d.type === 'hray' && pts[0]) {
      line(pts[0].x, pts[0].y, plotW, pts[0].y);
      label(Math.max(pts[0].x + 6, LEFT), pts[0].y - 4, fmtP(d.points[0].p), col);
    } else if (d.type === 'vline' && pts[0]) {
      line(pts[0].x, 0, pts[0].x, h);
    } else if ((d.type === 'trend' || d.type === 'ray') && pts[0] && pts[1]) {
      if (d.type === 'ray') {
        const end = extendRay(pts[0], pts[1], { left: 0, right: plotW, top: 0, bottom: h });
        line(pts[0].x, pts[0].y, end.x, end.y);
      } else {
        line(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      }
    } else if (d.type === 'rect' && pts[0] && pts[1]) {
      const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
      const w = Math.abs(pts[1].x - pts[0].x), hh = Math.abs(pts[1].y - pts[0].y);
      const r = svgEl('rect', { x, y, width: w, height: hh, fill: col, 'fill-opacity': 0.08, stroke: col, 'stroke-width': sw });
      g.appendChild(r);
      if (!isDraft) {
        const hitR = svgEl('rect', { x, y, width: w, height: hh, fill: 'transparent', stroke: 'transparent', 'stroke-width': hitWidth(), 'data-id': d.id });
        hitR.style.pointerEvents = 'all';
        hitR.classList.add('tv-hit');
        g.appendChild(hitR);
      }
    } else if (d.type === 'fib' && pts[0] && pts[1]) {
      const p1 = d.points[0].p, p2 = d.points[1].p;
      const x1 = Math.min(pts[0].x, pts[1].x), x2 = Math.max(pts[0].x, pts[1].x);
      FIBS.forEach(f => {
        const price = p2 + (p1 - p2) * f.l;
        const xy = toXY({ t: d.points[0].t, p: price });
        if (!xy) return;
        line(Math.min(x1, 0), xy.y, plotW, xy.y, f.c, 1, null);
        label(Math.max(Math.min(a.x, b.x) + 6, LEFT), xy.y - 3, f.l.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '  (' + fmtP(price) + ')', f.c);
      });
    } else if ((d.type === 'longpos' || d.type === 'shortpos') && pts[0] && d.points[1] && d.points[2]) {
      const entry = d.points[0], tgt = d.points[1], stp = d.points[2];
      const e = toXY(entry), tpt = toXY(tgt), spt = toXY(stp);
      if (!e || !tpt || !spt) return;
      const x0 = e.x, x1 = Math.max(e.x + 80, tpt.x, spt.x, e.x + (d.widthX || 80));
      const yE = e.y, yT = tpt.y, yS = spt.y;
      const profit = svgEl('rect', {
        x: x0, y: Math.min(yE, yT), width: Math.max(8, x1 - x0), height: Math.abs(yT - yE),
        fill: '#089981', 'fill-opacity': 0.22, stroke: '#089981', 'stroke-width': 1
      });
      const loss = svgEl('rect', {
        x: x0, y: Math.min(yE, yS), width: Math.max(8, x1 - x0), height: Math.abs(yS - yE),
        fill: '#F23645', 'fill-opacity': 0.22, stroke: '#F23645', 'stroke-width': 1
      });
      if (!isDraft) {
        profit.setAttribute('data-id', d.id); profit.classList.add('tv-hit'); profit.style.pointerEvents = 'all';
        loss.setAttribute('data-id', d.id); loss.classList.add('tv-hit'); loss.style.pointerEvents = 'all';
      }
      g.appendChild(loss);
      g.appendChild(profit);
      line(x0, yE, x1, yE, '#d1d4dc', 1);
      const risk = Math.abs(entry.p - stp.p) || 1;
      const reward = Math.abs(tgt.p - entry.p);
      const rr = reward / risk;
      label(x0 + 6, (yE + yT) / 2 + 4, fmtDelta(entry.p, tgt.p) + '   RR ' + rr.toFixed(2), '#089981');
      label(x0 + 6, (yE + yS) / 2 + 4, fmtDelta(entry.p, stp.p), '#F23645');
    } else if (d.type === 'text' && pts[0]) {
      const bg = svgEl('text', {
        x: pts[0].x, y: pts[0].y, fill: col, 'font-size': 13, 'font-weight': 700,
        'font-family': "Trebuchet MS, Segoe UI, Arial, sans-serif"
      });
      bg.textContent = d.text || '';
      if (!isDraft) { bg.setAttribute('data-id', d.id); bg.classList.add('tv-hit'); bg.style.pointerEvents = 'all'; }
      g.appendChild(bg);
    } else if (d.type === 'measure' && pts[0] && pts[1]) {
      const x = Math.min(pts[0].x, pts[1].x), y = Math.min(pts[0].y, pts[1].y);
      const w = Math.abs(pts[1].x - pts[0].x), hh = Math.abs(pts[1].y - pts[0].y);
      const up = d.points[1].p >= d.points[0].p;
      const colM = up ? '#2962FF' : '#F23645';
      const r = svgEl('rect', { x: x, y: y, width: Math.max(w, 1), height: Math.max(hh, 1), fill: colM, 'fill-opacity': 0.16, stroke: colM, 'stroke-width': 1, 'stroke-dasharray': '4 3' });
      if (!isDraft) { r.setAttribute('data-id', d.id); r.classList.add('tv-hit'); r.style.pointerEvents = 'all'; }
      g.appendChild(r);
    } else if (d.type === 'brush' && pts.length) {
      const ok = pts.filter(Boolean);
      if (ok.length) {
        const path = ok.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ');
        const vis = svgEl('path', { d: path, fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        g.appendChild(vis);
        if (!isDraft) {
          const hitP = svgEl('path', { d: path, fill: 'none', stroke: 'transparent', 'stroke-width': hitWidth(), 'data-id': d.id });
          hitP.style.pointerEvents = 'stroke';
          hitP.classList.add('tv-hit');
          g.appendChild(hitP);
        }
      }
    }
  }

  function renderHandles(g, d) {
    if (locked || hidden || selected !== d.id) return;
    const pts = d.points || [];
    pts.forEach((pt, i) => {
      const xy = toXY(pt);
      if (!xy) return;
      const c = svgEl('circle', { cx: xy.x, cy: xy.y, r: 5, fill: '#131722', stroke: '#2962FF', 'stroke-width': 1.6, 'data-id': d.id, 'data-handle': i });
      c.style.pointerEvents = 'all';
      c.classList.add('tv-handle');
      g.appendChild(c);
    });
  }

  function redraw() {
    if (!svg) return;
    const vis = svg.querySelector('#drawVis');
    const han = svg.querySelector('#drawHandles');
    const dft = svg.querySelector('#drawDraft');
    if (!vis) return;
    vis.innerHTML = '';
    han.innerHTML = '';
    dft.innerHTML = '';
    visibleDrawings().forEach(d => renderItem(vis, d, false));
    visibleDrawings().forEach(d => renderHandles(han, d));
    if (draft) renderItem(dft, draft, true);
    if (measureTmp) renderItem(dft, measureTmp, true);
    syncMeasureLabel(measureTmp);
    updateCapture();
  }

  function addDrawing(d) {
    snapshot();
    if (!d.id) d.id = nextId();
    drawings.push(d);
    selected = d.id;
    persist();
    redraw();
    return d;
  }

  function finishDraft() {
    if (!draft) return;
    const d = draft;
    draft = null;
    if (d.type === 'text') {
      promptText(d);
      return;
    }
    if ((d.points || []).length < minPoints(d.type)) return;
    addDrawing(d);
  }

  function minPoints(type) {
    if (type === 'hline' || type === 'hray' || type === 'vline' || type === 'text') return 1;
    if (type === 'brush') return 2;
    if (type === 'longpos' || type === 'shortpos') return 3;
    return 2;
  }

  function promptText(d) {
    const xy = toXY(d.points[0]);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'tv-text-input';
    inp.placeholder = 'Text';
    inp.maxLength = 80;
    if (xy) {
      inp.style.left = xy.x + 'px';
      inp.style.top = xy.y + 'px';
    }
    layer.appendChild(inp);
    inp.focus();
    const done = commit => {
      if (inp._done) return;
      inp._done = true;
      const val = (inp.value || '').trim();
      inp.remove();
      if (commit && val) {
        d.text = val;
        addDrawing(d);
      } else redraw();
    };
    inp.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
    });
    inp.addEventListener('blur', () => done(!!inp.value.trim()));
  }

  function eventXY(ev) {
    const r = svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function defaultStop(type, entry, target) {
    const dist = target.p - entry.p;
    return { t: entry.t, p: entry.p - dist };
  }

  function onPointerDown(ev) {
    if (ev.button !== 0) return;
    if (locked && tool !== 'cursor' && !ev.shiftKey) return;
    const { x, y } = eventXY(ev);
    const pt = fromXY(x, y);
    if (!pt) return;

    if (measurePhase === 'tracking' || measurePhase === 'fixed' || ev.shiftKey || tool === 'measure') {
      // Host capture handler owns the measure gesture.
      return;
    }

    if (tool === 'cursor') {
      const handle = ev.target.closest && ev.target.closest('.tv-handle');
      const hit = ev.target.closest && ev.target.closest('.tv-hit');
      if (handle && !locked) {
        ev.preventDefault(); ev.stopPropagation();
        selected = handle.getAttribute('data-id');
        dragging = { kind: 'handle', id: selected, index: +handle.getAttribute('data-handle') };
        snapshot();
        return;
      }
      if (hit && !locked) {
        ev.preventDefault(); ev.stopPropagation();
        selected = hit.getAttribute('data-id');
        const d = drawings.find(z => z.id === selected);
        const start = fromXY(x, y);
        dragging = { kind: 'move', id: selected, last: start, orig: d ? JSON.parse(JSON.stringify(d.points)) : null };
        snapshot();
        redraw();
        return;
      }
      selected = null;
      redraw();
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    if (tool === 'brush') {
      draft = { id: nextId(), type: 'brush', points: [pt], color: '#2962FF' };
      dragging = { kind: 'brush' };
      redraw();
      return;
    }

    if (tool === 'hline' || tool === 'hray' || tool === 'vline') {
      addDrawing({ type: tool, points: [pt], color: '#2962FF' });
      return;
    }
    if (tool === 'text') {
      draft = { type: 'text', points: [pt], color: '#d1d4dc', text: '' };
      finishDraft();
      return;
    }

    // two/three point tools: start draft
    if (draft && (draft.type === tool || (tool === 'measure' && draft.type === 'measure'))) {
      if (tool === 'longpos' || tool === 'shortpos') {
        // second click sets target; stop auto-filled, then complete
        draft.points[1] = pt;
        draft.points[2] = defaultStop(tool, draft.points[0], pt);
        finishDraft();
        return;
      }
      draft.points[1] = pt;
      finishDraft();
      return;
    }

    if (tool === 'longpos' || tool === 'shortpos') {
      const tgt = { t: pt.t, p: pt.p };
      draft = { type: tool, points: [pt, tgt, defaultStop(tool, pt, tgt)], color: '#2962FF' };
      dragging = { kind: 'draft' };
      redraw();
      return;
    }

    draft = { type: tool, points: [pt, pt], color: '#2962FF' };
    dragging = { kind: 'draft' };
    redraw();
  }

  function onPointerMove(ev) {
    if (measurePhase === 'tracking' && measureTmp) {
      updateMeasureEnd(ev);
      return;
    }
    if (!dragging && !draft) return;
    const { x, y } = eventXY(ev);
    const pt = fromXY(x, y);
    if (!pt) return;
    if (dragging && dragging.kind === 'brush' && draft) {
      draft.points.push(pt);
      redraw();
      return;
    }
    if (dragging && dragging.kind === 'draft' && draft) {
      if (draft.type === 'longpos' || draft.type === 'shortpos') {
        draft.points[1] = pt;
        draft.points[2] = defaultStop(draft.type, draft.points[0], pt);
        // keep a time width
        const dx = pt.t - draft.points[0].t;
        draft.points[1].t = draft.points[0].t + Math.max(dx, 60);
      } else {
        draft.points[1] = pt;
      }
      redraw();
      return;
    }
    if (locked) return;
    if (dragging && dragging.kind === 'handle') {
      const d = drawings.find(z => z.id === dragging.id);
      if (d && d.points[dragging.index]) {
        d.points[dragging.index] = pt;
        if ((d.type === 'longpos' || d.type === 'shortpos') && dragging.index === 1) {
          // leave stop unless it was still the auto one — keep user's stop
        }
        redraw();
      }
      return;
    }
    if (dragging && dragging.kind === 'move') {
      const d = drawings.find(z => z.id === dragging.id);
      if (d && dragging.last) {
        const dt = pt.t - dragging.last.t;
        const dp = pt.p - dragging.last.p;
        d.points = d.points.map(q => ({ t: q.t + dt, p: q.p + dp }));
        dragging.last = pt;
        redraw();
      }
    }
  }

  function onPointerUp(ev) {
    if (measureHeld && measurePhase === 'tracking' && measureTmp) {
      measureHeld = false;
      const sx = measureStartXY;
      const moved = sx && (Math.abs(ev.clientX - sx.x) > 4 || Math.abs(ev.clientY - sx.y) > 4);
      if (dragging && dragging.kind === 'measure') dragging = null;
      if (moved) fixMeasure();
      else { updateCapture(); redraw(); }
      return;
    }
    if (!dragging) return;
    if (dragging.kind === 'measure') {
      if (dragging && dragging.kind === 'measure') dragging = null;
      updateCapture();
      redraw();
      return;
    }
    if (dragging.kind === 'brush' && draft) {
      finishDraft();
    }
    if (dragging.kind === 'draft' && draft) {
      const a = draft.points[0], b = draft.points[1];
      const A = toXY(a), B = b && toXY(b);
      const moved = A && B && (Math.abs(A.x - B.x) > 4 || Math.abs(A.y - B.y) > 4);
      if (moved) finishDraft();
      // else keep draft for a second click
    }
    if (dragging.kind === 'handle' || dragging.kind === 'move') persist();
    dragging = null;
    updateCapture();
    redraw();
  }

  function onKey(ev) {
    if (activeInst !== api) return;
    if (isTyping(ev)) return;
    const alt = ev.altKey, sh = ev.shiftKey, ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (draft || measureTmp || measurePhase) { draft = null; dragging = null; clearMeasure(); return; }
      if (selected) { selected = null; redraw(); return; }
      setTool('cursor');
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected && !locked) {
      ev.preventDefault();
      snapshot();
      drawings = drawings.filter(d => d.id !== selected);
      selected = null;
      persist();
      redraw();
      return;
    }
    if (ctrl && (ev.key === 'z' || ev.key === 'Z') && !sh) {
      ev.preventDefault();
      doUndo();
      return;
    }
    if (!alt) return;
    const map = {
      t: 'trend', T: 'trend',
      h: 'hline', H: 'hline',
      j: 'hray', J: 'hray',
      v: 'vline', V: 'vline',
      f: 'fib', F: 'fib'
    };
    if (sh && (ev.key === 'r' || ev.key === 'R')) {
      ev.preventDefault();
      setTool('rect');
      return;
    }
    if (!sh && map[ev.key]) {
      ev.preventDefault();
      setTool(map[ev.key]);
    }
  }

  function attach(options) {
    opts = options;
    host = options.host || document.querySelector('.demo-chart-body');
    if (!host) return;
    if (host.querySelector('.tv-toolbar')) return;
    load();
    layer = document.createElement('div');
    layer.className = 'tv-draw-layer';
    svg = svgEl('svg', { class: 'tv-draw-svg' });
    capture = svgEl('rect', { id: 'drawCapture', x: 0, y: 0, width: '100%', height: '100%', fill: 'transparent' });
    capture.style.pointerEvents = 'none';
    svg.appendChild(capture);
    svg.appendChild(svgEl('g', { id: 'drawVis' }));
    svg.appendChild(svgEl('g', { id: 'drawDraft' }));
    svg.appendChild(svgEl('g', { id: 'drawHandles' }));
    layer.appendChild(svg);
    measureLab = document.createElement('div');
    measureLab.className = 'tv-measure-lab';
    measureLab.hidden = true;
    layer.appendChild(measureLab);
    host.appendChild(layer);
    buildToolbar(host);
    syncToolbar();

    layer.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey, true);
    host.addEventListener('pointerdown', onHostPointerDown, true);

    redraw();
    requestAnimationFrame(redraw);
  }

  const api = {
    attach,
    redraw,
    setTool,
    add: addDrawing,
    clear() { snapshot(); drawings = []; selected = null; persist(); redraw(); },
    list: () => drawings.slice(),
    getTool: () => tool,
    flags: () => ({ magnet, locked, hidden }),
    toXY, fromXY,
    reloadCoin,
    clearMeasure,
    measureState() {
      return {
        phase: measurePhase,
        tool: tool,
        hasTmp: !!measureTmp,
        points: measureTmp && measureTmp.points ? measureTmp.points.map(function (p) { return { t: p.t, p: p.p }; }) : null,
        label: measureLab && !measureLab.hidden ? (measureLab.innerText || '') : '',
        interactive: chartInteractive
      };
    },
    activate() { activeInst = api; syncToolbar(); },
    candleSpan() {
      const c = candles();
      if (!c.length) return null;
      const n = c.length;
      return { first: c[0].time, last: c[n - 1].time, a: c[Math.floor(n * 0.25)].time, b: c[Math.floor(n * 0.55)].time, c: c[Math.floor(n * 0.8)].time, n };
    },
    debug() {
      const { plotW, h } = plotSize();
      return {
        plotW, h, nDraw: drawings.length,
        hidden, svgKids: svg ? svg.querySelector('#drawVis') && svg.querySelector('#drawVis').childElementCount : -1,
        pts: drawings.map(d => ({ type: d.type, xy: (d.points||[]).map(toXY) }))
      };
    }
  };
  INSTANCES.push(api);
  if (options) attach(options);
  if (!activeInst) activeInst = api;
  return api;
  } // create

  root.DemoDraw = {
    create,
    attach(options) { return create(options); },
    setActive(inst) { activeInst = inst; if (inst && inst.activate) inst.activate(); },
    getActive() { return activeInst; }
  };
})(typeof window !== 'undefined' ? window : this);
