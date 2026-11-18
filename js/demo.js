/* DEMO desk: multi-market paper trading, TV chart, HL-style ticket. */
(function () {
  'use strict';
  const C = window.DemoCalc, M = window.DemoMarkets, B = window.DemoBook;
  const $ = function (s, el) { return (el || document).querySelector(s); };
  const $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  const INFO = 'https://api.hyperliquid.xyz/info';
  const WSURL = 'wss://api.hyperliquid.xyz/ws';
  const TV = { up: '#089981', dn: '#F23645', pnlUp: '#25E2B7', blue: '#2962FF', orange: '#fb923c' };
  const DEFAULT_TF = M.DEFAULT_TF || '1m';

  let book = B.loadFromStorage();
  let ui = B.loadUi();
  const live = {};
  M.CATALOG.forEach(function (m) {
    const fb = M.FALLBACK[m.id];
    live[m.id] = {
      mark: 0, mid: 0, bid: 0, ask: 0, oracle: 0, funding: 0, prevDay: 0, vol: 0,
      maxLeverage: fb.maxLeverage, szDecimals: fb.szDecimals, marginTiers: fb.marginTiers,
      growthMode: !!fb.growthMode, deployerFeeScale: fb.deployerFeeScale,
      fees: M.feeRatesFor(m.id), book: { bids: [], asks: [] }, tape: []
    };
  });
  const candleCache = {};
  const panes = [];
  let activePane = 0;
  let ws = null, wsRetry = 0, pollTimer = null;
  let proView = false;
  let side = 'long', tab = 'market', proType = 'stopMarket', tif = 'Gtc';
  let sizeMode = 'margin', marginMode = book.defaultMarginMode || 'cross';
  let leverage = 10, dragging = null;

  function coin() {
    const p = panes[activePane];
    return (p && p.coin) || (ui.panes[0] && ui.panes[0].coin) || 'xyz:XYZ100';
  }
  function L(id) { return live[id] || live['xyz:XYZ100']; }
  function lastPx(id) {
    const x = L(id || coin());
    return x.mark || x.mid || x.ask || x.bid || 0;
  }
  function marksMap() {
    const o = {};
    M.CATALOG.forEach(function (m) { const p = lastPx(m.id); if (p) o[m.id] = p; });
    return o;
  }
  function pxDec(id) { return M.pxDecimals(L(id).szDecimals); }
  function fmtPx(p, id) {
    if (!(p > 0)) return '—';
    return (+p).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: pxDec(id) });
  }
  function fmtUsd(n, d) {
    const x = +n || 0, s = x < 0 ? '-' : '';
    return s + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function signedUsd(n) {
    const x = +n || 0, s = x > 0 ? '+' : x < 0 ? '-' : '';
    return s + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPnlUsd(n) {
    const x = +n || 0, s = x > 0 ? '+' : x < 0 ? '-' : '';
    return s + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD';
  }
  function clsPnL(n) { return n > 0 ? 'up' : n < 0 ? 'dn' : ''; }
  function toast(msg) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }
  function setFeed(txt, cls) {
    const el = $('#feed'); if (!el) return;
    el.textContent = txt; el.className = cls || '';
  }
  function persist() { B.saveToStorage(book); }
  function persistUi() { B.saveUi(ui); }

  async function info(body) {
    const r = await fetch(INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('info ' + r.status);
    return r.json();
  }

  function applyMeta(id, u, ctx) {
    const x = L(id);
    if (u) {
      if (u.maxLeverage) x.maxLeverage = +u.maxLeverage;
      if (u.szDecimals != null) x.szDecimals = +u.szDecimals;
      if (u.growthMode != null) x.growthMode = u.growthMode === true || u.growthMode === 'enabled';
      if (u.deployerFeeScale != null) x.deployerFeeScale = +u.deployerFeeScale;
      x.onlyIsolated = !!u.onlyIsolated;
      x.fees = M.feeRatesFor(id, { hip3: M.isHip3(id), growthMode: x.growthMode, deployerFeeScale: x.deployerFeeScale });
    }
    if (ctx) {
      if (ctx.markPx) x.mark = +ctx.markPx;
      if (ctx.midPx) x.mid = +ctx.midPx;
      if (ctx.oraclePx) x.oracle = +ctx.oraclePx;
      if (ctx.funding != null) x.funding = +ctx.funding;
      if (ctx.prevDayPx) x.prevDay = +ctx.prevDayPx;
      if (ctx.dayNtlVlm) x.vol = +ctx.dayNtlVlm;
      if (ctx.impactPxs && ctx.impactPxs.length >= 2) {
        x.bid = +ctx.impactPxs[0] || x.bid;
        x.ask = +ctx.impactPxs[1] || x.ask;
      }
    }
  }

  async function loadMeta() {
    const res = await Promise.all([
      info({ type: 'metaAndAssetCtxs' }).then(function (arr) { return arr; }),
      info({ type: 'metaAndAssetCtxs', dex: 'xyz' }).then(function (arr) { return arr; })
    ]);
    res.forEach(function (pack) {
      const meta = pack[0], ctxs = pack[1];
      const tables = {};
      (meta.marginTables || []).forEach(function (t) { tables[t[0]] = t[1]; });
      (meta.universe || []).forEach(function (u, i) {
        if (!live[u.name]) return;
        const tab = tables[u.marginTableId];
        if (tab && tab.marginTiers) L(u.name).marginTiers = tab.marginTiers;
        applyMeta(u.name, u, ctxs[i]);
      });
    });
  }

  function cacheKey(c, tf) { return c + '|' + tf; }

  async function loadCandles(c, tf) {
    if (M.isSubMinute(tf)) {
      let bars = candleCache[cacheKey(c, tf)] || [];
      try {
        const raw = await info({ type: 'recentTrades', coin: c });
        if (Array.isArray(raw) && raw.length) bars = M.seedBarsFromTrades(raw, M.tfSeconds(tf));
      } catch (e) { /* keep */ }
      candleCache[cacheKey(c, tf)] = bars;
      return bars;
    }
    const span = M.TF_LOOKBACK_MS[tf] || 12 * 3600e3;
    const end = Date.now();
    const raw = await info({ type: 'candleSnapshot', req: { coin: c, interval: tf, startTime: end - span, endTime: end } });
    const bars = (raw || []).map(function (d) {
      return { time: Math.floor((d.t || d.T) / 1000), open: +d.o, high: +d.h, low: +d.l, close: +d.c, volume: +(d.v || 0) };
    });
    candleCache[cacheKey(c, tf)] = bars;
    return bars;
  }

  function upsertCandle(c, tf, bar) {
    const key = cacheKey(c, tf);
    const bars = candleCache[key] || (candleCache[key] = []);
    const next = { time: bar.time, open: +bar.open, high: +bar.high, low: +bar.low, close: +bar.close, volume: +(bar.volume || 0) };
    const last = bars[bars.length - 1];
    if (!last || last.time < next.time) bars.push(next);
    else if (last.time === next.time) bars[bars.length - 1] = next;
    panes.forEach(function (p) {
      if (p.coin === c && p.tf === tf && p.series) p.series.update(bars[bars.length - 1]);
    });
  }

  function applyTrade(c, px, sz, timeMs, sideCode) {
    const x = L(c);
    if (x && px) {
      x.tape.unshift({ px: +px, sz: +sz, t: timeMs, side: sideCode || '' });
      if (x.tape.length > 80) x.tape.length = 80;
    }
    panes.forEach(function (p) {
      if (p.coin !== c || !M.isSubMinute(p.tf)) return;
      const key = cacheKey(c, p.tf);
      const bars = candleCache[key] || (candleCache[key] = []);
      const last = M.aggregateTradeBar(bars, px, sz, timeMs, M.tfSeconds(p.tf));
      if (last && p.series) p.series.update(last);
    });
  }

  function chartOptions(el, tf) {
    const sub = M.isSubMinute(tf);
    return {
      width: el.clientWidth || 400,
      height: el.clientHeight || 400,
      autoSize: false,
      layout: { background: { color: '#000000' }, textColor: '#B2B5BE', fontFamily: "Trebuchet MS, Segoe UI, Arial, sans-serif" },
      grid: { vertLines: { color: '#2A2A2A', style: 1 }, horzLines: { color: '#2A2A2A', style: 1 } },
      crosshair: { mode: 0, vertLine: { color: '#787B86', width: 1, style: 3 }, horzLine: { color: '#787B86', width: 1, style: 3 } },
      rightPriceScale: { borderColor: '#2A2A2A' },
      timeScale: { borderColor: '#2A2A2A', timeVisible: true, secondsVisible: sub, tickMarkFormatter: M.tickMarkFormatter },
      localization: { timeFormatter: M.timeFormatter }
    };
  }
  function candleStyle() {
    return {
      upColor: '#FFFFFF', downColor: '#000000',
      borderUpColor: '#FFFFFF', borderDownColor: '#FFFFFF',
      wickUpColor: '#FFFFFF', wickDownColor: '#FFFFFF', borderVisible: true
    };
  }
  function snapTime(ms, tf) {
    const sec = M.tfSeconds(tf);
    return Math.floor((+ms || 0) / 1000 / sec) * sec;
  }
  function collectFills(c) {
    const out = [];
    function push(isLong, t, kind) {
      if (!t) return;
      out.push({ timeMs: t, buy: kind === 'open' ? isLong : !isLong, kind: kind });
    }
    (book.positions || []).forEach(function (p) {
      if (p.coin === c) push(p.side === 'long', Date.parse(p.openedAt) || p.openedAt, 'open');
    });
    (book.history || []).forEach(function (h) {
      if (h.coin !== c) return;
      push(h.side === 'long', Date.parse(h.openedAt) || 0, 'open');
      push(h.side === 'long', Date.parse(h.closedAt) || 0, 'close');
    });
    return out;
  }
  function applyFillMarkers(pane) {
    if (!pane || !pane.series) return;
    const markers = collectFills(pane.coin).map(function (f) {
      return {
        time: snapTime(f.timeMs, pane.tf),
        position: f.buy ? 'belowBar' : 'aboveBar',
        color: f.buy ? TV.up : TV.dn,
        shape: f.buy ? 'arrowUp' : 'arrowDown',
        text: f.buy ? 'B' : 'S'
      };
    }).sort(function (a, b) { return a.time - b.time; });
    try { pane.series.setMarkers(markers); } catch (e) { /* */ }
  }

  function workingPrice(o) {
    if (!o) return 0;
    const typ = o.typ || 'limit';
    if (typ === 'trailingStop') return (o.trail && (o.trail.triggerPx || o.trail.watermark)) || o.triggerPx || 0;
    if ((typ === 'stopMarket' || typ === 'stopLimit' || typ === 'takeMarket' || typ === 'takeLimit') && o.status !== 'triggered') {
      return +o.triggerPx || 0;
    }
    return +o.limitPx || +o.triggerPx || 0;
  }
  function orderKind(o) {
    const typ = (o && o.typ) || 'limit';
    const map = {
      limit: 'LMT', scale: 'LMT', chase: 'LMT',
      stopMarket: 'STP', stopLimit: 'STP LMT',
      takeMarket: 'TAKE', takeLimit: 'TAKE LMT',
      trailingStop: 'TRAIL', twap: 'TWAP'
    };
    return map[typ] || 'LMT';
  }
  function plotMetrics(pane) {
    const r = pane.plot.getBoundingClientRect();
    const ts = pane.chart && pane.chart.timeScale();
    const axisW = 64;
    return { w: r.width, h: r.height, plotW: ts && ts.width ? (ts.width() || Math.max(0, r.width - axisW)) : Math.max(0, r.width - axisW), axisW: axisW };
  }
  function yAtPrice(pane, price) {
    if (!pane.series || !(price > 0)) return null;
    const y = pane.series.priceToCoordinate(price);
    return y == null ? null : y;
  }
  function priceAtY(pane, y) {
    if (!pane.series) return null;
    return pane.series.coordinateToPrice(y);
  }
  function fmtQtyLabel(q, id) {
    return (+q || 0).toLocaleString('en-US', { maximumFractionDigits: L(id).szDecimals });
  }
  function candleCountdown(pane) {
    const sec = M.tfSeconds(pane.tf);
    const rem = sec - ((Date.now() / 1000) % sec);
    if (sec < 60) return String(Math.max(0, Math.floor(rem))).padStart(2, '0') + 's';
    const m = Math.floor(rem / 60), s = Math.floor(rem % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function ensureOverlay(pane) {
    let lines = pane.overlay.querySelector('.tv-lines');
    if (!lines) { lines = document.createElement('div'); lines.className = 'tv-lines'; pane.overlay.appendChild(lines); }
    let last = pane.overlay.querySelector('.tv-last');
    if (!last) {
      last = document.createElement('div');
      last.className = 'tv-last';
      last.innerHTML = '<div class="tv-last-line"></div><div class="tv-last-col"><div class="tv-last-px"></div><div class="tv-last-cd"></div></div>';
      pane.overlay.appendChild(last);
    }
    pane.linesEl = lines;
    pane.lastEl = last;
  }
  function placeRow(row, y, plotW) {
    row.style.top = y + 'px';
    const line = row.querySelector('.tv-hline');
    const badge = row.querySelector('.tv-badge.center');
    if (line) line.style.width = plotW + 'px';
    if (badge) badge.style.left = (plotW / 2) + 'px';
  }
  function rowHtml(clsName, color, left, kind, px, xid, dash) {
    return '<div class="tv-row ' + clsName + '" style="--lc:' + color + '" data-xid="' + xid + '">' +
      '<div class="tv-hline' + (dash ? ' dash pend' : '') + '"></div>' +
      '<div class="tv-badge center"><span class="tv-qty">' + (left || '') + '</span><span class="tv-kind">' + kind + '</span>' +
      '<button type="button" class="tv-x" data-act="' + xid + '">×</button></div>' +
      '<div class="tv-axis' + (dash ? ' pend' : '') + '">' + px + '</div></div>';
  }
  function bindOverlayClicks(pane) {
    pane.overlay.addEventListener('click', function (ev) {
      const btn = ev.target.closest && ev.target.closest('.tv-x');
      if (!btn) return;
      ev.preventDefault(); ev.stopPropagation();
      const act = btn.getAttribute('data-act') || '';
      if (act.indexOf('pend:') === 0) {
        const r = B.cancelOrder(book, act.slice(5), 'canceled');
        if (r.ok) { persist(); renderAll(); toast('Order canceled'); }
        return;
      }
      if (act.indexOf('pos:') === 0) {
        const p = (book.positions || []).find(function (x) { return x.id === act.slice(4); });
        if (!p) return;
        B.closePosition(book, p, lastPx(p.coin), 'manual', marksMap());
        persist(); renderAll(); toast('Position closed');
        return;
      }
      if (act.indexOf('sl:') === 0 || act.indexOf('tp:') === 0) {
        const p = (book.positions || []).find(function (x) { return x.id === act.slice(3); });
        if (!p) return;
        if (act.indexOf('sl:') === 0) p.sl = null; else p.tp = null;
        persist(); renderOverlay(pane);
      }
    });
    pane.overlay.addEventListener('pointerdown', function (ev) {
      const row = ev.target.closest && ev.target.closest('.tv-row.pend');
      if (!row || ev.target.closest('.tv-x')) return;
      const xid = row.getAttribute('data-xid') || '';
      if (xid.indexOf('pend:') !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const o = (book.pending || []).find(function (x) { return x.id === xid.slice(5); });
      if (!o) return;
      dragging = { order: o, pane: pane };
    });
  }
  window.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    const pane = dragging.pane;
    const y = ev.clientY - pane.plot.getBoundingClientRect().top;
    const px = priceAtY(pane, y);
    if (!(px > 0)) return;
    const tick = M.tickSize(L(dragging.order.coin).szDecimals);
    const snapped = Math.round(px / tick) * tick;
    const o = dragging.order, typ = o.typ || 'limit';
    if (typ === 'stopMarket' || typ === 'stopLimit' || typ === 'takeMarket' || typ === 'takeLimit') {
      if (o.status === 'triggered' && o.limitPx) o.limitPx = snapped;
      else o.triggerPx = snapped;
    } else o.limitPx = snapped;
    renderOverlay(pane);
  });
  window.addEventListener('pointerup', function () {
    if (!dragging) return;
    persist();
    dragging = null;
  });

  function renderOverlay(pane) {
    if (!pane || !pane.chart) return;
    ensureOverlay(pane);
    const m = plotMetrics(pane);
    const c = pane.coin;
    const pos = (book.positions || []).filter(function (p) { return p.coin === c; });
    const pends = (book.pending || []).filter(function (o) { return o.coin === c && o.status !== 'filled' && o.status !== 'canceled'; });
    let html = '';
    pos.forEach(function (p) {
      const mark = lastPx(p.coin);
      const u = C.unrealized(p.side, p.entry, mark, p.qty);
      const lc = p.side === 'long' ? TV.up : TV.dn;
      if (yAtPrice(pane, p.entry) != null) {
        html += '<div class="tv-row" style="--lc:' + lc + '" data-xid="pos:' + p.id + '">' +
          '<div class="tv-hline"></div>' +
          '<div class="tv-badge" style="left:80px;transform:translate(0,-50%)"><span class="tv-qty">' + fmtQtyLabel(p.qty, c) + '</span></div>' +
          '<div class="tv-badge center" style="left:50%;transform:translate(-50%,-50%)"><span class="tv-pnl' + (u < 0 ? ' neg' : '') + '">' + fmtPnlUsd(u) + '</span>' +
          '<button type="button" class="tv-x" data-act="pos:' + p.id + '">×</button></div>' +
          '<div class="tv-axis">' + fmtPx(p.entry, c) + '</div></div>';
      }
      if (p.sl > 0 && yAtPrice(pane, p.sl) != null) {
        html += rowHtml('', TV.blue, '', p.side === 'long' ? 'Sell STP' : 'Buy STP', fmtPx(p.sl, c), 'sl:' + p.id, false);
      }
      if (p.tp > 0 && yAtPrice(pane, p.tp) != null) {
        html += rowHtml('', TV.blue, '', p.side === 'long' ? 'Sell LMT' : 'Buy LMT', fmtPx(p.tp, c), 'tp:' + p.id, false);
      }
      if (p.liq > 0 && yAtPrice(pane, p.liq) != null) {
        html += '<div class="tv-row" data-xid="liq:' + p.id + '" style="--lc:' + TV.orange + '"><div class="tv-hline dash"></div><div class="tv-axis liq">Liq ' + fmtPx(p.liq, c) + '</div></div>';
      }
    });
    pends.forEach(function (o) {
      const pr = workingPrice(o);
      if (!(pr > 0) || yAtPrice(pane, pr) == null) return;
      const buy = o.side === 'long';
      const kind = (buy ? 'Buy ' : 'Sell ') + orderKind(o) + ' ' + fmtPx(pr, c);
      html += rowHtml('pend', buy ? TV.up : TV.dn, fmtQtyLabel(o.qty - (o.filledQty || 0), c), kind, fmtPx(pr, c), 'pend:' + o.id, true);
    });
    pane.linesEl.innerHTML = html;
    pane.linesEl.querySelectorAll('.tv-row').forEach(function (row) {
      const xid = row.getAttribute('data-xid') || '';
      let price = null;
      if (xid.indexOf('pend:') === 0) {
        const o = pends.find(function (x) { return x.id === xid.slice(5); });
        price = o && workingPrice(o);
      } else if (xid.indexOf('pos:') === 0) {
        const p = pos.find(function (x) { return x.id === xid.slice(4); });
        price = p && p.entry;
      } else if (xid.indexOf('sl:') === 0) {
        const p = pos.find(function (x) { return x.id === xid.slice(3); });
        price = p && p.sl;
      } else if (xid.indexOf('tp:') === 0) {
        const p = pos.find(function (x) { return x.id === xid.slice(3); });
        price = p && p.tp;
      } else if (xid.indexOf('liq:') === 0) {
        const p = pos.find(function (x) { return x.id === xid.slice(4); });
        price = p && p.liq;
      }
      const y = yAtPrice(pane, price);
      if (y != null) placeRow(row, y, m.plotW);
    });
    const px = lastPx(c);
    if (px > 0) {
      const y = yAtPrice(pane, px);
      if (y != null) {
        pane.lastEl.hidden = false;
        pane.lastEl.style.top = y + 'px';
        const pEl = pane.lastEl.querySelector('.tv-last-px');
        const cEl = pane.lastEl.querySelector('.tv-last-cd');
        if (pEl) pEl.textContent = fmtPx(px, c);
        if (cEl) cEl.textContent = candleCountdown(pane);
        const line = pane.lastEl.querySelector('.tv-last-line');
        if (line) line.style.width = m.plotW + 'px';
      } else pane.lastEl.hidden = true;
    }
    applyFillMarkers(pane);
    if (pane.draw) pane.draw.redraw();
  }

  function sizePane(pane) {
    if (!pane.chart || !pane.plot) return;
    const w = pane.plot.clientWidth, h = pane.plot.clientHeight;
    if (w > 0 && h > 0) pane.chart.resize(w, h);
    renderOverlay(pane);
  }
  function sizeAll() { panes.forEach(sizePane); }

  function setActivePane(i) {
    activePane = i;
    ui.activePane = i;
    panes.forEach(function (p, n) {
      p.root.classList.toggle('active', n === i);
      if (n === i && p.draw && window.DemoDraw && DemoDraw.setActive) DemoDraw.setActive(p.draw);
    });
    persistUi();
    syncTicketHeader();
    updateCalc();
    renderMarketBar();
    if (proView) renderProDock();
  }

  function paneTemplate(i, spec) {
    const div = document.createElement('div');
    div.className = 'chart-pane' + (i === activePane ? ' active' : '');
    div.dataset.pane = String(i);
    const short = M.shortName(spec.coin);
    const tfs = M.TIMEFRAMES.map(function (tf) {
      return '<button type="button" data-tf="' + tf + '"' + (tf === spec.tf ? ' class="on"' : '') + '>' + tf + '</button>';
    }).join('');
    div.innerHTML =
      '<div class="pane-head">' +
        '<button type="button" class="pane-mkt" data-pane="' + i + '">' + short + '</button>' +
        '<div class="tf">' + tfs + '</div>' +
        '<span class="tf-note"' + (M.isSubMinute(spec.tf) ? '' : ' hidden') + '>live-built, history from page open</span>' +
      '</div>' +
      '<div class="demo-chart-body">' +
        '<div class="chart"></div>' +
        '<div class="tv-overlay"><div class="tv-legend">' + M.displayName(spec.coin) + ' · ' + short + '</div></div>' +
      '</div>';
    return div;
  }

  function buildPane(i, spec, host) {
    const root = paneTemplate(i, spec);
    host.appendChild(root);
    const plot = root.querySelector('.chart');
    const overlay = root.querySelector('.tv-overlay');
    const chart = LightweightCharts.createChart(plot, chartOptions(plot, spec.tf));
    const series = chart.addCandlestickSeries(Object.assign({
      priceFormat: { type: 'price', precision: pxDec(spec.coin), minMove: M.tickSize(L(spec.coin).szDecimals) }
    }, candleStyle()));
    const pane = { id: i, coin: spec.coin, tf: spec.tf, root: root, plot: plot, overlay: overlay, chart: chart, series: series, draw: null };
    panes[i] = pane;
    series.applyOptions({
      autoscaleInfoProvider: function (orig) {
        const res = orig ? orig() : null;
        if (!res || !res.priceRange) return res;
        const prices = [];
        (book.positions || []).forEach(function (pos) {
          if (pos.coin !== pane.coin) return;
          [pos.entry, pos.sl, pos.tp].forEach(function (v) { if (v > 0) prices.push(+v); });
        });
        (book.pending || []).forEach(function (o) {
          if (o.coin !== pane.coin) return;
          const v = workingPrice(o);
          if (v > 0) prices.push(+v);
        });
        if (!prices.length) return res;
        let min = res.priceRange.minValue, max = res.priceRange.maxValue;
        prices.forEach(function (v) { if (v < min) min = v; if (v > max) max = v; });
        const pad = (max - min) * 0.05 || 1;
        return { priceRange: { minValue: min - pad, maxValue: max + pad } };
      }
    });
    ensureOverlay(pane);
    bindOverlayClicks(pane);
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () { renderOverlay(pane); });
    root.addEventListener('pointerdown', function () { setActivePane(i); });
    $$('.tf button', root).forEach(function (b) {
      b.addEventListener('click', function (ev) { ev.stopPropagation(); setPaneTf(i, b.getAttribute('data-tf')); });
    });
    root.querySelector('.pane-mkt').addEventListener('click', function (ev) {
      ev.stopPropagation(); openMarketPicker(i, ev.currentTarget);
    });
    if (window.DemoDraw && DemoDraw.create) {
      pane.draw = DemoDraw.create({
        getChart: function () { return pane.chart; },
        getSeries: function () { return pane.series; },
        getCandles: function () { return candleCache[cacheKey(pane.coin, pane.tf)] || []; },
        getCoin: function () { return pane.coin; },
        host: root.querySelector('.demo-chart-body'),
        plotEl: function () { return pane.plot; }
      });
    }
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(function () { sizePane(pane); });
      ro.observe(root); ro.observe(plot);
    }
    return pane;
  }

  async function fillPaneData(pane) {
    try {
      const bars = await loadCandles(pane.coin, pane.tf);
      if (pane.series) pane.series.setData(bars || []);
      if (bars && bars.length) pane.chart.timeScale().fitContent();
    } catch (e) { console.warn('candles', pane.coin, e); }
    applyFillMarkers(pane);
    sizePane(pane);
    renderOverlay(pane);
    resubscribe();
  }

  async function setPaneTf(i, tf) {
    const pane = panes[i];
    if (!pane) return;
    $$('.tf button', pane.root).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tf') === tf); });
    if (pane.tf === tf) return;
    pane.tf = tf;
    if (ui.panes[i]) ui.panes[i].tf = tf;
    persistUi();
    const note = pane.root.querySelector('.tf-note');
    if (note) note.hidden = !M.isSubMinute(tf);
    pane.chart.applyOptions(chartOptions(pane.plot, tf));
    await fillPaneData(pane);
  }

  async function setPaneMarket(i, c) {
    const pane = panes[i];
    if (!pane || !live[c]) return;
    pane.coin = c;
    if (ui.panes[i]) ui.panes[i].coin = c;
    persistUi();
    const short = M.shortName(c);
    const btn = pane.root.querySelector('.pane-mkt');
    if (btn) btn.textContent = short;
    const leg = pane.root.querySelector('.tv-legend');
    if (leg) leg.textContent = M.displayName(c) + ' · ' + short;
    pane.series.applyOptions({ priceFormat: { type: 'price', precision: pxDec(c), minMove: M.tickSize(L(c).szDecimals) } });
    if (pane.draw && pane.draw.reloadCoin) pane.draw.reloadCoin();
    setActivePane(i);
    await fillPaneData(pane);
    renderMarketBar();
    syncTicketHeader();
  }

  function rebuildGrid() {
    const host = $('#chartGrid');
    if (!host) return;
    const layout = ui.layout || 1;
    ui.panes = B.panesForLayout(layout, ui.panes);
    host.className = 'chart-grid layout-' + layout;
    host.innerHTML = '';
    panes.length = 0;
    ui.panes.forEach(function (spec, i) { buildPane(i, spec, host); });
    if (activePane >= panes.length) activePane = 0;
    setActivePane(activePane);
    $$('.layout-switch button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-layout') === layout); });
    Promise.all(panes.map(fillPaneData)).then(function () { sizeAll(); resubscribe(); });
  }

  function openMarketPicker(i, anchor) {
    let drop = $('#mktPicker');
    if (drop) drop.remove();
    drop = document.createElement('div');
    drop.id = 'mktPicker';
    drop.className = 'mkt-drop';
    drop.style.position = 'absolute';
    drop.style.minWidth = '220px';
    M.CATALOG.forEach(function (m) {
      const px = lastPx(m.id), x = L(m.id);
      const chg = x.prevDay > 0 && px ? ((px / x.prevDay) - 1) * 100 : 0;
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span>' + m.name + ' · ' + m.short + '</span><span class="' + clsPnL(chg) + '">' + fmtPx(px, m.id) + ' ' + (px ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '') + '</span>';
      b.addEventListener('click', function () { drop.remove(); setPaneMarket(i, m.id); });
      drop.appendChild(b);
    });
    document.body.appendChild(drop);
    const r = anchor.getBoundingClientRect();
    drop.style.left = r.left + 'px';
    drop.style.top = (r.bottom + 4) + 'px';
    drop.style.right = 'auto';
    const close = function (ev) {
      if (!drop.contains(ev.target) && ev.target !== anchor) { drop.remove(); document.removeEventListener('mousedown', close); }
    };
    setTimeout(function () { document.addEventListener('mousedown', close); }, 0);
  }
  let subs = [];
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function wantedSubs() {
    const out = [], coins = {};
    panes.forEach(function (p) { coins[p.coin] = true; });
    M.CATALOG.forEach(function (m) { coins[m.id] = true; });
    Object.keys(coins).forEach(function (c) {
      out.push({ type: 'activeAssetCtx', coin: c });
      out.push({ type: 'bbo', coin: c });
      out.push({ type: 'trades', coin: c });
    });
    panes.forEach(function (p) {
      if (!M.isSubMinute(p.tf)) out.push({ type: 'candle', coin: p.coin, interval: p.tf });
    });
    if (proView) out.push({ type: 'l2Book', coin: coin() });
    return out;
  }
  function sameSub(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function resubscribe() {
    const next = wantedSubs();
    subs.forEach(function (s) {
      if (!next.some(function (n) { return sameSub(n, s); })) send({ method: 'unsubscribe', subscription: s });
    });
    next.forEach(function (s) {
      if (!subs.some(function (o) { return sameSub(o, s); })) send({ method: 'subscribe', subscription: s });
    });
    subs = next;
  }
  function handleWs(msg) {
    const ch = msg.channel, data = msg.data;
    if (!data) return;
    if (ch === 'activeAssetCtx') {
      const id = data.coin;
      if (id && live[id]) applyMeta(id, null, data.ctx || data);
      onPrice();
    } else if (ch === 'bbo') {
      const id = data.coin;
      if (id && live[id] && data.bbo) {
        if (data.bbo[0]) L(id).bid = +data.bbo[0].px || +data.bbo[0][0] || L(id).bid;
        if (data.bbo[1]) L(id).ask = +data.bbo[1].px || +data.bbo[1][0] || L(id).ask;
      }
      onPrice();
    } else if (ch === 'candle') {
      const id = data.s || data.coin, interval = data.i || data.interval;
      if (id && interval) upsertCandle(id, interval, { time: Math.floor((data.t || 0) / 1000), open: +data.o, high: +data.h, low: +data.l, close: +data.c, volume: +data.v });
    } else if (ch === 'trades') {
      const list = Array.isArray(data) ? data : [data];
      list.forEach(function (t) {
        if (t && t.coin && t.px) applyTrade(t.coin, +t.px, +t.sz, t.time || Date.now(), t.side);
      });
      if (proView) renderProDock();
    } else if (ch === 'l2Book') {
      const id = data.coin;
      if (id && live[id] && data.levels) {
        L(id).book = { bids: data.levels[0] || [], asks: data.levels[1] || [] };
        if (proView && id === coin()) renderProDock();
      }
    }
  }
  function connect() {
    try { if (ws) ws.close(); } catch (e) { /* */ }
    ws = new WebSocket(WSURL);
    ws.onopen = function () {
      wsRetry = 0; setFeed('WS live', 'ok');
      const lp = $('#livePill'); if (lp) lp.classList.remove('off');
      subs = []; resubscribe();
    };
    ws.onmessage = function (ev) { try { handleWs(JSON.parse(ev.data)); } catch (e) { /* */ } };
    ws.onclose = function () {
      setFeed('reconnecting…', 'warn');
      const lp = $('#livePill'); if (lp) lp.classList.add('off');
      setTimeout(connect, Math.min(8000, 600 * Math.pow(1.6, wsRetry++)));
    };
    ws.onerror = function () { try { ws.close(); } catch (e) { /* */ } };
  }
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(function () {
      loadMeta().then(function () { onPrice(); renderMarketBar(); }).catch(function () {});
    }, 15000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function feesOf(id) { return L(id).fees || M.feeRatesFor(id); }
  function currentTyp() {
    if (tab === 'market') return 'market';
    if (tab === 'limit') return 'limit';
    return proType;
  }
  function plannedEntry() {
    const x = L(coin()), typ = currentTyp();
    if (typ === 'limit' || typ === 'stopLimit' || typ === 'takeLimit' || typ === 'scale' || typ === 'chase') {
      return +$('#inpLimit').value || +$('#inpScaleStart').value || lastPx();
    }
    return C.entryFromBook(side, 'market', null, x.bid, x.ask, x.mid, x.mark);
  }
  function syncTicketHeader() {
    const c = coin();
    const t = $('#ticketTitle');
    if (t) t.textContent = '◈ ORDER · ' + M.shortName(c);
    const badge = $('#btnAcctMode');
    const label = ({ unified: 'Unified', portfolio: 'Portfolio margin', standard: 'Manual / Standard' }[book.accountMode] || 'Unified');
    if (badge) badge.textContent = label;
    const hm = $('#hdrMode'); if (hm) hm.textContent = label;
    const max = L(c).maxLeverage || 10;
    leverage = Math.min(leverage, max);
    const hint = $('#levMaxHint'); if (hint) hint.textContent = 'max ' + max + 'x';
    const lv = $('#levVal'); if (lv) lv.textContent = leverage + 'x';
    const inp = $('#inpLev'); if (inp) { inp.max = max; inp.value = leverage; }
    $('#btnCross').classList.toggle('on', marginMode === 'cross');
    $('#btnIso').classList.toggle('on', marginMode === 'isolated');
    const note = $('#calcNote');
    if (note) note.textContent = M.feeNote(c, feesOf(c)) + ' Liquidation is approximate (MM = half of IM at max leverage).';
  }
  function showTicketFields() {
    const typ = currentTyp();
    const isTrig = typ === 'stopMarket' || typ === 'stopLimit' || typ === 'takeMarket' || typ === 'takeLimit';
    $('#proTypeFld').hidden = tab !== 'pro';
    $('#tifRow').hidden = !(typ === 'limit' || typ === 'stopLimit' || typ === 'takeLimit' || typ === 'scale');
    $('#triggerFld').hidden = !isTrig;
    $('#limitFld').hidden = !(typ === 'limit' || typ === 'stopLimit' || typ === 'takeLimit' || typ === 'chase');
    $('#scaleFlds').hidden = typ !== 'scale';
    $('#twapFlds').hidden = typ !== 'twap';
    $('#trailFlds').hidden = typ !== 'trailingStop';
    const go = $('#btnOpen');
    if (go) {
      go.textContent = (side === 'short' ? 'Sell / Short' : 'Buy / Long');
      go.classList.toggle('short', side === 'short');
    }
  }
  function updateCalc() {
    const c = coin(), x = L(c), entry = plannedEntry(), sizeUsd = +$('#inpSize').value;
    const plan = C.plan({
      side: side, sizeUsd: sizeUsd, sizeMode: sizeMode, leverage: leverage,
      entry: entry, maxLeverage: x.maxLeverage, szDecimals: x.szDecimals,
      feeRate: currentTyp() === 'limit' && tif === 'Alo' ? feesOf(c).maker : feesOf(c).taker,
      tp: +$('#inpTpPx').value, sl: +$('#inpSlPx').value
    });
    const g = $('#calcGrid'); if (!g) return;
    if (!plan.ok) { g.innerHTML = '<div class="kv wide"><span>Calculator</span><b>—</b></div>'; return; }
    const kvs = [
      ['POSITION SIZE', fmtUsd(plan.notional)], ['MARGIN', fmtUsd(plan.margin)],
      ['ENTRY PRICE', fmtPx(plan.entry, c)], ['SIZE (CONTRACTS)', String(plan.qty)],
      ['LIQUIDATION ≈', plan.liq ? fmtPx(plan.liq, c) : '—'], ['ENTRY FEE', fmtUsd(plan.openFee)],
      ['ROUND-TRIP FEES ≈', fmtUsd(plan.feesRoundTripAtEntry)]
    ];
    if (plan.tp) kvs.push(['P&L AT TP', signedUsd(plan.tp.net) + '  (' + plan.tp.roe.toFixed(2) + '%)']);
    if (plan.sl) kvs.push(['P&L AT SL', signedUsd(plan.sl.net) + '  (' + plan.sl.roe.toFixed(2) + '%)']);
    g.innerHTML = kvs.map(function (r) { return '<div class="kv"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('');
    const tb = $('#scTable tbody');
    if (tb) {
      tb.innerHTML = plan.scenarios.map(function (s) {
        return '<tr><td>' + s.label + '</td><td>' + fmtPx(s.price, c) + '</td><td class="' + clsPnL(s.net) + '">' + signedUsd(s.net) + '</td><td class="' + clsPnL(s.roe) + '">' + (s.roe > 0 ? '+' : '') + s.roe.toFixed(2) + '%</td></tr>';
      }).join('');
    }
  }
  function syncLinked(which, from) {
    const entry = plannedEntry();
    if (!(entry > 0)) return;
    if (which === 'tp') {
      if (from === 'px') {
        const p = +$('#inpTpPx').value;
        if (p > 0) $('#inpTpPct').value = (C.favorablePct(side, entry, p) || 0).toFixed(3);
      } else {
        const pct = +$('#inpTpPct').value;
        if (pct) $('#inpTpPx').value = C.favorablePrice(side, entry, pct);
      }
    } else {
      if (from === 'px') {
        const p = +$('#inpSlPx').value;
        if (p > 0) $('#inpSlPct').value = ((C.favorablePct(side, entry, p) || 0) * -1).toFixed(3);
      } else {
        const pct = +$('#inpSlPct').value;
        if (pct) $('#inpSlPx').value = C.adversePrice(side, entry, pct);
      }
    }
    updateCalc();
  }
  function renderAccount() {
    const m = marksMap();
    const eq = B.equity(book, m), free = B.freeOf(book, m), upnl = B.upnlTotal(book, m);
    const set = function (id, val, cls) {
      const el = $(id); if (!el) return;
      el.textContent = val;
      if (cls != null) el.className = cls;
    };
    set('#hdrBal', fmtUsd(book.balance));
    set('#hdrEq', fmtUsd(eq));
    set('#hdrFree', fmtUsd(free));
    set('#hdrUpnl', signedUsd(upnl), clsPnL(upnl));
  }
  function renderMarketBar() {
    const bar = $('#mktBar'); if (!bar) return;
    const active = coin();
    let html = '';
    M.CATALOG.forEach(function (m) {
      const px = lastPx(m.id), x = L(m.id);
      const chg = x.prevDay > 0 && px ? ((px / x.prevDay) - 1) * 100 : 0;
      html += '<button type="button" class="mkt-chip' + (m.id === active ? ' on' : '') + '" data-coin="' + m.id + '">' +
        '<div class="mc-name">' + m.short + ' · ' + m.name + '</div>' +
        '<div><span class="mc-px">' + fmtPx(px, m.id) + '</span><span class="mc-chg ' + clsPnL(chg) + '">' + (px ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '—') + '</span></div></button>';
    });
    bar.innerHTML = html;
    $$('.mkt-chip', bar).forEach(function (b) {
      b.addEventListener('click', function () { setPaneMarket(activePane, b.getAttribute('data-coin')); });
    });
  }
  function renderProDock() {
    if (!proView) return;
    const c = coin(), x = L(c);
    const title = $('#bookTitle'); if (title) title.textContent = 'ORDER BOOK · ' + M.shortName(c);
    const bookEl = $('#orderBook');
    const asks = (x.book.asks || []).slice(0, 12).reverse();
    const bids = (x.book.bids || []).slice(0, 12);
    let h = '';
    asks.forEach(function (lvl) {
      const p = +lvl.px, s = +lvl.sz;
      h += '<div class="ob-row ask"><span>' + fmtPx(p, c) + '</span><span>' + s + '</span><span>' + fmtUsd(p * s, 0) + '</span></div>';
    });
    h += '<div class="ob-row mid"><span>' + fmtPx(lastPx(c), c) + '</span><span>mid / mark</span><span></span></div>';
    bids.forEach(function (lvl) {
      const p = +lvl.px, s = +lvl.sz;
      h += '<div class="ob-row bid"><span>' + fmtPx(p, c) + '</span><span>' + s + '</span><span>' + fmtUsd(p * s, 0) + '</span></div>';
    });
    if (bookEl) bookEl.innerHTML = h || '<div class="ob-empty">Waiting for book…</div>';
    const tape = $('#tradeTape');
    if (tape) {
      tape.innerHTML = (x.tape || []).slice(0, 24).map(function (t) {
        return '<div class="tape-row ' + (t.side || '') + '"><span>' + fmtPx(t.px, c) + '</span><span>' + t.sz + '</span><span>' + M.formatClock(t.t, true) + '</span></div>';
      }).join('');
    }
  }
  function reasonLabel(r) {
    return ({ sl: 'Stop loss', tp: 'Take profit', liquidation: 'Liquidation', manual: 'Manual close', market: 'Market', twap: 'TWAP' })[r] || r || '';
  }
  function renderPositions() {
    const body = $('#posBody'); if (!body) return;
    const list = book.positions || [];
    if (!list.length) body.innerHTML = '<tr class="ph"><td colspan="12">no open positions</td></tr>';
    else body.innerHTML = list.map(function (p) {
      const mark = lastPx(p.coin);
      const u = C.unrealized(p.side, p.entry, mark, p.qty);
      const roe = C.roePct(u - (p.openFee || 0), p.margin);
      return '<tr><td>' + M.shortName(p.coin) + '</td><td>' + p.id + '</td>' +
        '<td class="side-pill ' + p.side + '">' + p.side.toUpperCase() + '</td>' +
        '<td>' + (p.marginMode || 'cross') + ' ' + (p.leverage || '') + 'x</td>' +
        '<td>' + fmtQtyLabel(p.qty, p.coin) + '</td><td>' + fmtPx(p.entry, p.coin) + '</td><td>' + fmtPx(mark, p.coin) + '</td>' +
        '<td>' + (p.liq ? fmtPx(p.liq, p.coin) : '—') + '</td>' +
        '<td class="' + clsPnL(u) + '">' + signedUsd(u) + '</td>' +
        '<td class="' + clsPnL(roe) + '">' + (roe > 0 ? '+' : '') + roe.toFixed(2) + '%</td>' +
        '<td>' + (p.tp ? fmtPx(p.tp, p.coin) : '—') + ' / ' + (p.sl ? fmtPx(p.sl, p.coin) : '—') + '</td>' +
        '<td class="pos-actions"><button type="button" class="close" data-close="' + p.id + '">Close</button>' +
        (p.marginMode === 'isolated' ? '<button type="button" data-mgn="' + p.id + '">Margin</button>' : '') +
        '</td></tr>';
    }).join('');
    const pend = book.pending || [];
    const ob = $('#ordBody');
    if (ob) {
      if (!pend.length) ob.innerHTML = '<tr class="ph"><td colspan="9">no open orders</td></tr>';
      else ob.innerHTML = pend.map(function (o) {
        return '<tr><td>' + M.formatDateTime(o.t) + '</td><td>' + o.id + '</td><td>' + M.shortName(o.coin) + '</td><td>' + (o.typ || '') + '</td>' +
          '<td class="side-pill ' + o.side + '">' + o.side + '</td><td>' + fmtQtyLabel(o.qty, o.coin) + '</td><td>' + fmtPx(workingPrice(o), o.coin) + '</td><td>' + (o.tif || '') + '</td>' +
          '<td><button type="button" class="mini-btn" data-cancel="' + o.id + '">Cancel</button></td></tr>';
      }).join('');
    }
    const tw = pend.filter(function (o) { return o.typ === 'twap' || o.typ === 'scale'; });
    const tb = $('#twapBody');
    if (tb) {
      if (!tw.length) tb.innerHTML = '<tr class="ph"><td colspan="8">no TWAP or scale orders</td></tr>';
      else tb.innerHTML = tw.map(function (o) {
        return '<tr><td>' + M.formatDateTime(o.t) + '</td><td>' + o.id + '</td><td>' + M.shortName(o.coin) + '</td><td>' + o.typ + '</td><td>' + o.side + '</td>' +
          '<td>' + fmtQtyLabel(o.filledQty || 0, o.coin) + ' / ' + fmtQtyLabel(o.qty, o.coin) + '</td><td>' + (o.status || '') + '</td>' +
          '<td><button type="button" class="mini-btn" data-cancel="' + o.id + '">Cancel</button></td></tr>';
      }).join('');
    }
    const hb = $('#histBody');
    if (hb) {
      const hist = book.history || [];
      if (!hist.length) hb.innerHTML = '<tr class="ph"><td colspan="8">no trade history</td></tr>';
      else hb.innerHTML = hist.slice(0, 80).map(function (h) {
        return '<tr><td>' + M.formatDateTime(Date.parse(h.closedAt)) + '</td><td>' + h.id + '</td><td>' + M.shortName(h.coin) + '</td>' +
          '<td class="side-pill ' + h.side + '">' + h.side + '</td><td>' + fmtPx(h.entry, h.coin) + ' → ' + fmtPx(h.exit, h.coin) + '</td>' +
          '<td>' + reasonLabel(h.reason) + '</td><td class="' + clsPnL(h.net) + '">' + signedUsd(h.net) + '</td>' +
          '<td class="' + clsPnL(h.roe) + '">' + (h.roe > 0 ? '+' : '') + (+h.roe).toFixed(2) + '%</td></tr>';
      }).join('');
    }
  }
  function renderAll() {
    renderAccount(); renderMarketBar(); renderPositions();
    syncTicketHeader(); updateCalc();
    panes.forEach(renderOverlay);
    if (proView) renderProDock();
    if (ui.view === 'portfolio' && window.DemoPortfolio) DemoPortfolio.render($('#portfolioView'), book, marksMap(), ui);
  }
  function checkTpsl() {
    const m = marksMap();
    (book.positions || []).slice().forEach(function (p) {
      const mark = m[p.coin];
      const hit = C.hitLevel(p.side, mark, p.tp, p.sl, p.marginMode === 'isolated' ? p.liq : null);
      if (hit === 'tp' || hit === 'sl' || hit === 'liquidation') {
        const px = hit === 'tp' ? p.tp : hit === 'sl' ? p.sl : mark;
        B.closePosition(book, p, px || mark, hit === 'liquidation' ? 'liquidation' : hit, m);
        toast((hit === 'tp' ? 'Take profit' : hit === 'sl' ? 'Stop loss' : 'Liquidation') + ' on ' + M.shortName(p.coin));
      }
    });
  }
  function tickCtx() {
    const m = marksMap();
    return {
      marks: m,
      mids: Object.fromEntries(M.CATALOG.map(function (x) { return [x.id, L(x.id).mid || L(x.id).mark]; })),
      bids: Object.fromEntries(M.CATALOG.map(function (x) { return [x.id, L(x.id).bid]; })),
      asks: Object.fromEntries(M.CATALOG.map(function (x) { return [x.id, L(x.id).ask]; })),
      now: Date.now()
    };
  }
  function onPrice() {
    const m = marksMap(), rates = {};
    M.CATALOG.forEach(function (x) { rates[x.id] = L(x.id).funding; });
    B.applyFunding(book, m, rates, Date.now());
    B.tickOrders(book, tickCtx());
    checkTpsl();
    persist();
    renderAccount();
    panes.forEach(renderOverlay);
    updateCalc();
  }
  function err(msg) {
    const el = $('#orderErr'); if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.textContent = msg;
  }

  function placeTicket() {
    err('');
    const c = coin(), typ = currentTyp(), x = L(c);
    const sizeUsd = +$('#inpSize').value;
    const entryGuess = plannedEntry();
    const reduceOnly = $('#inpReduce').checked;
    const tpslOn = $('#inpTpslOn').checked;
    const tp = tpslOn ? +$('#inpTpPx').value : 0;
    const sl = tpslOn ? +$('#inpSlPx').value : 0;
    const fee = (typ === 'limit' && (tif === 'Alo' || tif === 'ALO')) ? feesOf(c).maker : feesOf(c).taker;
    const plan = C.plan({
      side: side, sizeUsd: sizeUsd, sizeMode: sizeMode, leverage: leverage,
      entry: entryGuess, maxLeverage: x.maxLeverage, szDecimals: x.szDecimals, feeRate: fee, tp: tp, sl: sl
    });
    if (!plan.ok && typ !== 'twap') { err('Cannot size this order.'); return; }
    const free = B.freeOf(book, marksMap(), book.accountMode === 'standard' ? B.dexOfCoin(c) : null);
    if (!reduceOnly && typ !== 'twap' && plan.ok && plan.margin > free + 1e-6) { err('Not enough free margin.'); return; }
    const base = {
      coin: c, side: side, typ: typ, tif: tif, qty: plan.qty, leverage: leverage,
      maxLeverage: x.maxLeverage, szDecimals: x.szDecimals, feeRate: fee, makerFee: feesOf(c).maker,
      marginMode: marginMode, margin: plan.margin, reduceOnly: reduceOnly, tp: tp || null, sl: sl || null,
      tickSize: M.tickSize(x.szDecimals)
    };
    if (typ === 'market') {
      const fill = C.entryFromBook(side, 'market', null, x.bid, x.ask, x.mid, x.mark);
      const r = B.fillPosition(book, base, fill, 'market', marksMap());
      if (!r.ok) { err(r.error || 'Order rejected.'); return; }
      persist(); renderAll(); toast((side === 'long' ? 'Long' : 'Short') + ' ' + M.shortName(c) + ' filled at ' + fmtPx(fill, c));
      return;
    }
    if (typ === 'scale') {
      const a = +$('#inpScaleStart').value, bpx = +$('#inpScaleEnd').value, n = Math.max(2, Math.min(20, +$('#inpScaleN').value || 5));
      if (!(a > 0) || !(bpx > 0)) { err('Enter a start and end price for Scale.'); return; }
      const slice = plan.qty / n;
      for (let i = 0; i < n; i++) {
        const px = a + (bpx - a) * (n === 1 ? 0 : i / (n - 1));
        B.placeWorkingOrder(book, Object.assign({}, base, { typ: 'limit', tif: tif || 'Gtc', qty: C.roundQty(slice, x.szDecimals), limitPx: px, id: B.nextId(book, 'P') }));
      }
      B.tickOrders(book, tickCtx());
      persist(); renderAll(); toast('Scale: ' + n + ' limit orders placed');
      return;
    }
    if (typ === 'twap') {
      const minutes = Math.max(5, Math.min(10080, +$('#inpTwapMin').value || 60));
      const notional = plan.ok ? plan.notional : sizeUsd;
      if (!(notional >= 100)) { err('TWAP minimum size is $100.'); return; }
      B.placeWorkingOrder(book, Object.assign({}, base, {
        typ: 'twap', qty: plan.qty || C.roundQty((sizeUsd * leverage) / lastPx(c), x.szDecimals),
        twap: {
          minutes: minutes, randomize: $('#inpTwapRand').checked,
          intervalSec: B.twapIntervalSec(notional, minutes),
          triggerPx: +$('#inpTwapTrig').value || 0,
          maxPx: side === 'long' ? (+$('#inpTwapCap').value || 0) : 0,
          minPx: side === 'short' ? (+$('#inpTwapCap').value || 0) : 0,
          startedAt: $('#inpTwapTrig').value ? 0 : Date.now()
        }
      }));
      persist(); renderAll(); toast('TWAP started (' + minutes + ' min)');
      return;
    }
    if (typ === 'trailingStop') {
      const pct = +$('#inpTrailPct').value, dist = +$('#inpTrailDist').value, act = +$('#inpTrailAct').value;
      if (!(pct > 0) && !(dist > 0)) { err('Set a retracement % or distance.'); return; }
      B.placeWorkingOrder(book, Object.assign({}, base, {
        typ: 'trailingStop', trail: { offsetPct: pct || 0, offsetPx: dist || 0, activationPx: act || 0, activated: !act }
      }));
      persist(); renderAll(); toast('Trailing stop placed');
      return;
    }
    const limitPx = +$('#inpLimit').value, triggerPx = +$('#inpTrigger').value;
    if ((typ === 'stopMarket' || typ === 'stopLimit' || typ === 'takeMarket' || typ === 'takeLimit') && !(triggerPx > 0)) {
      err('Enter a trigger price.'); return;
    }
    if (typ === 'limit' || typ === 'chase') {
      if (typ === 'limit' && !(limitPx > 0)) { err('Enter a limit price.'); return; }
      const o = B.placeWorkingOrder(book, Object.assign({}, base, { typ: typ, tif: typ === 'chase' ? 'Alo' : tif, limitPx: typ === 'chase' ? (x.bid || lastPx(c)) : limitPx }));
      B.tickOrders(book, tickCtx());
      persist(); renderAll();
      const still = (book.pending || []).some(function (p) { return p.id === o.id; });
      toast(still ? (M.shortName(c) + ' ' + typ + ' resting') : (M.shortName(c) + ' filled'));
      return;
    }
    B.placeWorkingOrder(book, Object.assign({}, base, { typ: typ, tif: tif, limitPx: limitPx || null, triggerPx: triggerPx }));
    B.tickOrders(book, tickCtx());
    persist(); renderAll();
    toast(orderKind({ typ: typ }) + ' order placed on ' + M.shortName(c));
  }

  function setView(name) {
    ui.view = name === 'portfolio' ? 'portfolio' : 'trade';
    persistUi();
    const trade = $('#tradeView'), port = $('#portfolioView');
    if (trade) trade.hidden = ui.view === 'portfolio';
    if (port) port.hidden = ui.view !== 'portfolio';
    if ($('#navTrade')) $('#navTrade').classList.toggle('on', ui.view === 'trade');
    if ($('#navPort')) $('#navPort').classList.toggle('on', ui.view === 'portfolio');
    if (ui.view === 'portfolio' && window.DemoPortfolio) DemoPortfolio.render(port, book, marksMap(), ui);
    if (ui.view === 'trade') requestAnimationFrame(sizeAll);
    const want = ui.view === 'portfolio' ? '#portfolio' : '';
    if (location.hash !== want && location.hash !== (want || '#')) {
      history.replaceState(null, '', want || (location.pathname + location.search));
    }
  }

  function refreshXfer() {
    const row = $('#xferRow');
    row.hidden = book.accountMode !== 'standard';
    if (book.accountMode === 'standard') {
      const d = book.dexCash || { main: 0, xyz: 0 };
      $('#xferBal').textContent = 'Main: ' + fmtUsd(d.main) + '   xyz: ' + fmtUsd(d.xyz);
    }
    $$('#modeList input[name=acctMode]').forEach(function (r) { r.checked = r.value === book.accountMode; });
  }
  function openSettings() { refreshXfer(); $('#setModal').showModal(); }
  function openLev() {
    const c = coin(), max = L(c).maxLeverage || 10;
    $('#inpLev').max = max; $('#inpLev').value = leverage;
    $('#levModalVal').textContent = leverage + 'x';
    $('#levModalSub').textContent = (marginMode === 'isolated' ? 'Isolated' : 'Cross') + ' margin · max ' + max + 'x · ' + M.shortName(c);
    $$('#levModalMm [data-mm]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mm') === marginMode); });
    $('#levModal').showModal();
  }

  function bind() {
    $$('.layout-switch button').forEach(function (b) {
      b.addEventListener('click', function () { ui.layout = +b.getAttribute('data-layout'); persistUi(); rebuildGrid(); });
    });
    $('#btnLong').onclick = function () { side = 'long'; $('#btnLong').classList.add('on'); $('#btnShort').classList.remove('on'); showTicketFields(); updateCalc(); };
    $('#btnShort').onclick = function () { side = 'short'; $('#btnShort').classList.add('on'); $('#btnLong').classList.remove('on'); showTicketFields(); updateCalc(); };
    $('#btnTabMkt').onclick = function () { tab = 'market'; $$('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); }); showTicketFields(); updateCalc(); };
    $('#btnTabLmt').onclick = function () { tab = 'limit'; $$('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); }); showTicketFields(); updateCalc(); };
    $('#btnTabPro').onclick = function () { tab = 'pro'; $$('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); }); showTicketFields(); updateCalc(); };
    $('#inpProType').onchange = function () { proType = this.value; showTicketFields(); updateCalc(); };
    $$('#tifRow [data-tif]').forEach(function (b) {
      b.addEventListener('click', function () {
        tif = b.getAttribute('data-tif');
        $$('#tifRow [data-tif]').forEach(function (x) { x.classList.toggle('on', x === b); });
        updateCalc();
      });
    });
    $('#btnCross').onclick = function () { marginMode = 'cross'; book.defaultMarginMode = 'cross'; persist(); syncTicketHeader(); };
    $('#btnIso').onclick = function () { marginMode = 'isolated'; book.defaultMarginMode = 'isolated'; persist(); syncTicketHeader(); };
    $('#btnMargin').onclick = function () { sizeMode = 'margin'; $('#btnMargin').classList.add('on'); $('#btnNotional').classList.remove('on'); $('#sizeLabel').textContent = 'Margin, USD'; updateCalc(); };
    $('#btnNotional').onclick = function () { sizeMode = 'notional'; $('#btnNotional').classList.add('on'); $('#btnMargin').classList.remove('on'); $('#sizeLabel').textContent = 'Position size, USD'; updateCalc(); };
    $$('#quickSize button').forEach(function (b) {
      b.addEventListener('click', function () { $('#inpSize').value = b.getAttribute('data-q'); updateCalc(); });
    });
    ['inpSize', 'inpLimit', 'inpTrigger'].forEach(function (id) {
      const el = $('#' + id); if (el) el.addEventListener('input', updateCalc);
    });
    $('#inpTpPx').addEventListener('input', function () { syncLinked('tp', 'px'); });
    $('#inpTpPct').addEventListener('input', function () { syncLinked('tp', 'pct'); });
    $('#inpSlPx').addEventListener('input', function () { syncLinked('sl', 'px'); });
    $('#inpSlPct').addEventListener('input', function () { syncLinked('sl', 'pct'); });
    $('#btnOpen').onclick = placeTicket;
    $('#btnReset').onclick = function () {
      if (!confirm('Reset the demo account to $1,000,000? Positions, orders and history will be cleared. Drawings stay.')) return;
      book = B.defaultBook(); persist(); renderAll(); toast('Account reset to $1,000,000');
    };
    document.addEventListener('click', function (ev) {
      const cbtn = ev.target.closest && ev.target.closest('[data-close]');
      if (cbtn) {
        const p = (book.positions || []).find(function (x) { return x.id === cbtn.getAttribute('data-close'); });
        if (!p) return;
        B.closePosition(book, p, lastPx(p.coin), 'manual', marksMap());
        persist(); renderAll(); toast('Position closed');
      }
      const k = ev.target.closest && ev.target.closest('[data-cancel]');
      if (k) { B.cancelOrder(book, k.getAttribute('data-cancel'), 'canceled'); persist(); renderAll(); toast('Order canceled'); }
      const mg = ev.target.closest && ev.target.closest('[data-mgn]');
      if (mg) {
        const p = (book.positions || []).find(function (x) { return x.id === mg.getAttribute('data-mgn'); });
        if (!p) return;
        const amt = prompt('Add isolated margin (USD). Use a negative number to remove.', '100');
        if (amt == null) return;
        const n = +amt;
        const r = n >= 0 ? B.addIsolatedMargin(book, p, n, marksMap()) : B.removeIsolatedMargin(book, p, -n, marksMap());
        if (!r.ok) { toast(r.error); return; }
        persist(); renderAll();
      }
    });
    $$('#bookTabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#bookTabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
        const tabn = b.getAttribute('data-btab');
        $('#tabPos').hidden = tabn !== 'pos';
        $('#tabOrd').hidden = tabn !== 'ord';
        $('#tabTwap').hidden = tabn !== 'twap';
        $('#tabHist').hidden = tabn !== 'hist';
      });
    });
    $('#btnProView').onclick = function () {
      proView = !proView;
      document.body.classList.toggle('pro-view', proView);
      $('#proDock').hidden = !proView;
      $('#btnProView').classList.toggle('on', proView);
      $('#btnProView').setAttribute('aria-pressed', proView ? 'true' : 'false');
      resubscribe(); sizeAll();
      if (proView) renderProDock();
    };
    $('#btnSettings').onclick = openSettings;
    $('#btnAcctMode').onclick = openSettings;
    $('#setClose').onclick = function () { $('#setModal').close(); };
    $('#btnXfer').onclick = function () {
      const r = B.transferDex(book, $('#xferFrom').value, $('#xferTo').value, +$('#xferAmt').value);
      if (!r.ok) { toast(r.error); return; }
      persist(); renderAll(); refreshXfer(); toast('Transfer complete');
    };
    $$('#modeList input[name=acctMode]').forEach(function (r) {
      r.addEventListener('change', function () {
        B.setAccountMode(book, r.value);
        persist(); renderAll(); refreshXfer();
        toast('Account mode: ' + r.parentElement.querySelector('b').textContent);
      });
    });
    $('#btnLevModal').onclick = openLev;
    $('#levCancel').onclick = function () { $('#levModal').close(); };
    $('#levConfirm').onclick = function () {
      leverage = +$('#inpLev').value;
      const mm = $('#levModalMm .seg-btn.on');
      if (mm) marginMode = mm.getAttribute('data-mm');
      $('#levModal').close(); syncTicketHeader(); updateCalc();
    };
    $('#inpLev').addEventListener('input', function () { $('#levModalVal').textContent = this.value + 'x'; $('#levVal').textContent = this.value + 'x'; });
    $$('#levModalMm [data-mm]').forEach(function (b) {
      b.addEventListener('click', function () { $$('#levModalMm [data-mm]').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    });
    window.addEventListener('hashchange', function () { setView(location.hash === '#portfolio' ? 'portfolio' : 'trade'); });
    window.addEventListener('resize', sizeAll);
    setInterval(function () {
      const el = $('#clock');
      if (el) el.textContent = M.formatClock(Date.now(), true);
      panes.forEach(function (p) {
        if (p.lastEl) {
          const cEl = p.lastEl.querySelector('.tv-last-cd');
          if (cEl) cEl.textContent = candleCountdown(p);
        }
      });
    }, 250);
    setInterval(function () { B.snapshotEquity(book, marksMap()); persist(); }, 60000);
  }

  async function init() {
    bind();
    showTicketFields();
    setView(location.hash === '#portfolio' ? 'portfolio' : (ui.view || 'trade'));
    rebuildGrid();
    renderAll();
    try { await loadMeta(); } catch (e) { setFeed('REST error', 'warn'); }
    renderAll();
    connect();
    startPoll();
  }

  window.DemoDesk = {
    ready: function () { return lastPx() > 0; },
    lastPx: lastPx,
    getBook: function () { return book; },
    getLive: function () { return live; },
    setLayout: function (n) { ui.layout = n; persistUi(); rebuildGrid(); },
    setPaneMarket: setPaneMarket,
    setPaneTf: setPaneTf,
    placeOrder: placeTicket,
    placeLimit: function (opts) {
      side = opts.side || side;
      tab = 'limit'; tif = opts.tif || 'Gtc';
      if (opts.limit) $('#inpLimit').value = opts.limit;
      if (opts.size) $('#inpSize').value = opts.size;
      showTicketFields(); placeTicket();
    },
    resetSilent: function () { book = B.defaultBook(); persist(); renderAll(); },
    setForm: function (o) {
      if (o.side) { side = o.side; $('#btnLong').classList.toggle('on', side === 'long'); $('#btnShort').classList.toggle('on', side === 'short'); }
      if (o.size != null) $('#inpSize').value = o.size;
      if (o.lev != null) leverage = o.lev;
      if (o.tp != null) $('#inpTpPx').value = o.tp;
      if (o.sl != null) $('#inpSlPx').value = o.sl;
      if (o.limit != null) { tab = 'limit'; $('#inpLimit').value = o.limit; }
      syncTicketHeader(); showTicketFields(); updateCalc();
    },
    setView: setView,
    candleCount: function (i) {
      const p = panes[i || 0];
      return p ? (candleCache[cacheKey(p.coin, p.tf)] || []).length : 0;
    },
    sizeChart: sizeAll,
    renderOverlay: function () { panes.forEach(renderOverlay); },
    panes: function () { return panes; },
    fmtPnlUsd: fmtPnlUsd,
    Draw: function () { return window.DemoDraw; },
    activeCoin: coin,
    tf: function (i) { return panes[i || 0] && panes[i || 0].tf; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
