/* GROK $1K -> $5K challenge panel. Reads grok/book.json + grok/skeptic.jsonl (same origin, cache-busted, every 60s).
   Live uPnL from the desk's WS prices (window.__desk.M) with an allMids WS fallback for other coins.
   Draws GROK + desk-bot trade markers on the main focus chart and on its own GROK trade chart. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const root = $('#grokPanel'); if (!root) return;
  const LWC = window.LightweightCharts;
  const API = 'https://api.hyperliquid.xyz/info';
  let book = null, reviews = [], mids = {}, chart = null, cs = null, lines = [], view = { coin: 'BTC', tf: '1h', around: null };
  const fx = (x, d = 2) => (x < 0 ? '-' : '') + '$' + Math.abs(x).toFixed(d);
  const fp = x => x == null ? '—' : (x >= 1000 ? x.toFixed(1) : x >= 1 ? x.toFixed(3) : x.toPrecision(4));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ts = iso => Math.floor(Date.parse(iso) / 1000);
  const px = c => { const d = window.__desk; const m = d && d.M && d.M[c]; return (m && m.price) || mids[c] || null; };
  const upnl = p => { const q = px(p.coin); return q ? (p.side === 'long' ? 1 : -1) * (q - p.entry) * p.size : 0; };

  // --- fallback live prices: one allMids WS sub ---
  (function ws() {
    let s; try { s = new WebSocket('wss://api.hyperliquid.xyz/ws'); } catch (e) { return; }
    s.onopen = () => s.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
    s.onmessage = e => { try { const d = JSON.parse(e.data); if (d.channel === 'allMids') for (const k in d.data.mids) if (k[0] !== '@') mids[k] = +d.data.mids[k]; } catch (x) { } };
    s.onclose = () => setTimeout(ws, 5000);
  })();

  async function load() {
    try {
      const r = await fetch('grok/book.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) book = await r.json();
      const s = await fetch('grok/skeptic.jsonl?t=' + Date.now(), { cache: 'no-store' });
      if (s.ok) reviews = (await s.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { }
    render(); drawTradeChart(false);
  }

  function stats() {
    const app = book.closed.filter(c => c.skeptic && c.skeptic.verdict === 'YES'), rej = (book.shadow || []).filter(s => s.status === 'closed' && !s.skeptic_error);
    const ok = app.filter(c => c.pnl > 0).length + rej.filter(s => s.pnl <= 0).length, n = app.length + rej.length;
    return { acc: n ? Math.round(ok / n * 100) + '% (' + ok + '/' + n + ')' : '—', saved: -rej.reduce((a, s) => a + s.R, 0) };
  }

  function render() {
    if (!book) { $('#gkStats').innerHTML = '<div class="gk-empty">loading GROK book…</div>'; return; }
    const eq = book.cash + book.open.reduce((a, p) => a + upnl(p), 0);
    const prog = Math.max(0, (eq - book.start_equity) / (book.goal_equity - book.start_equity) * 100);
    const risk = book.open.reduce((a, p) => a + Math.abs(p.entry - p.stop) * p.size, 0);
    const w = book.closed.filter(c => c.pnl > 0).length, st = stats();
    const cls = v => v >= 0 ? 'up' : 'dn';
    $('#gkStats').innerHTML = [
      ['EQUITY', `<span class="${cls(eq - book.start_equity)}">${fx(eq)}</span>`],
      ['P&L', `<span class="${cls(eq - book.start_equity)}">${(eq / book.start_equity * 100 - 100).toFixed(2)}%</span>`],
      ['MULTIPLE', (eq / book.start_equity).toFixed(3) + 'x / 5x'],
      ['CASH', fx(book.cash)], ['OPEN RISK', (risk / eq * 100).toFixed(1) + '%'],
      ['TRADES W/L', book.closed.length ? `${w}/${book.closed.length - w}` : '—'],
      ['ΣR', book.closed.reduce((a, c) => a + c.R, 0).toFixed(2)],
      ['SKEPTIC ACC.', st.acc]].map(([l, v]) => `<div class="s"><label>${l}</label><b>${v}</b></div>`).join('');
    $('#gkProg').innerHTML = `<i style="width:${Math.min(100, prog).toFixed(2)}%"></i><span>${prog.toFixed(1)}% to $${book.goal_equity}</span>`;
    $('#gkUpd').textContent = 'updated ' + (book.updated || '').replace('T', ' ').replace('Z', ' UTC');
    // open
    $('#gkOpen').innerHTML = book.open.length ? book.open.map(p => {
      const u = upnl(p), q = px(p.coin), r = u / (Math.abs(p.entry - p.init_stop || p.stop) * p.size || 1);
      return `<div class="gk-row" data-coin="${p.coin}" data-t="${p.opened_at}"><b class="${p.side === 'long' ? 'up' : 'dn'}">${p.side.toUpperCase()}</b> <b>${p.coin}</b> <small>${p.ticket}</small>
        <span class="${cls(u)}" style="float:right">${fx(u)} · ${r >= 0 ? '+' : ''}${r.toFixed(2)}R</span><br>
        <small>entry ${fp(p.entry)} · now ${fp(q)} · stop ${fp(p.stop)} (${q ? (Math.abs(q - p.stop) / q * 100).toFixed(1) : '—'}%) · tgt ${fp(p.target)} (${q ? (Math.abs(p.target - q) / q * 100).toFixed(1) : '—'}%) · ${p.leverage}x</small></div>`;
    }).join('') : '<div class="gk-empty">flat — no open positions</div>';
    // thesis
    const th = book.last_thesis;
    $('#gkThesis').innerHTML = th ? `<b class="${th.side === 'long' ? 'up' : 'dn'}">${th.side.toUpperCase()} ${esc(th.coin)}</b> <small class="mut">${esc(th.ticket)} · ${esc(th.t)}</small><br>${esc(th.thesis)}` : '<span class="gk-empty">no trades yet — GROK starts with $1,000</span>';
    // closed
    $('#gkClosed').innerHTML = book.closed.length ? book.closed.slice().reverse().map(c => `<div class="gk-row" data-coin="${c.coin}" data-t="${c.opened_at}" data-t2="${c.closed_at}">
      <b class="${c.side === 'long' ? 'up' : 'dn'}">${c.side[0].toUpperCase()}</b> <b>${c.coin}</b> <small>${c.ticket} · ${esc(c.reason)}</small>
      <span class="${cls(c.pnl)}" style="float:right">${fx(c.pnl)} · ${c.R >= 0 ? '+' : ''}${c.R.toFixed(2)}R</span>
      ${c.lesson ? `<br><span class="ls">“${esc(c.lesson)}”</span>` : ''}</div>`).join('') : '<div class="gk-empty">no closed trades yet</div>';
    // skeptic + shadows
    const sh = {}; (book.shadow || []).forEach(s => sh[s.id.replace('SX-', 'GK-')] = s);
    $('#gkSkepN').textContent = `${reviews.length} reviews · shadow R saved ${st.saved.toFixed(2)}`;
    $('#gkSkep').innerHTML = reviews.length ? reviews.slice(-25).reverse().map(r => {
      const p = r.proposal || {}, s = sh[r.ticket];
      const out = s ? (s.status === 'closed' ? ` · shadow → <b class="${s.pnl > 0 ? 'up' : 'dn'}">${s.outcome} ${s.R >= 0 ? '+' : ''}${s.R}R</b>` : ' · shadow open') : '';
      return `<div class="gk-row" data-coin="${esc(p.coin)}" data-t="${esc(r.t)}"><b class="${r.verdict === 'YES' ? 'gk-yes' : 'gk-no'}">${r.verdict}</b> ${esc(p.side)} <b>${esc(p.coin)}</b> <small>${esc(r.ticket)} · ${esc((r.model || 'no model').split('/').pop())}${out}</small><br><small>${esc(r.biggest_risk)}${r.error ? ' · <span class="dn">API error → default NO</span>' : ''}</small></div>`;
    }).join('') : '<div class="gk-empty">no skeptic reviews yet</div>';
    curve(eq);
  }

  function curve(eqNow) {
    const cv = $('#gkCurve'), d = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = W * d; cv.height = H * d; const g = cv.getContext('2d'); g.scale(d, d); g.clearRect(0, 0, W, H);
    const pts = book.equity.map(p => [Date.parse(p.t), p.eq]).concat([[Date.now(), eqNow]]);
    const ys = pts.map(p => p[1]).concat([book.start_equity]); let lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 10) { lo -= 5; hi += 5; }
    const t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
    const X = t => 6 + (t - t0) / (t1 - t0) * (W - 50), Y = v => 8 + (hi - v) / (hi - lo) * (H - 18);
    g.strokeStyle = 'rgba(127,139,176,.35)'; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, Y(book.start_equity)); g.lineTo(W, Y(book.start_equity)); g.stroke(); g.setLineDash([]);
    const grd = g.createLinearGradient(0, 0, W, 0); grd.addColorStop(0, '#22d3ee'); grd.addColorStop(1, '#e879f9');
    g.strokeStyle = grd; g.lineWidth = 2; g.shadowColor = '#e879f9'; g.shadowBlur = 8; g.beginPath();
    pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = '#7f8bb0'; g.font = '10px JetBrains Mono, monospace'; g.fillText('$' + hi.toFixed(0), W - 42, 12); g.fillText('$' + lo.toFixed(0), W - 42, H - 4);
  }

  // ---- markers ----
  function grokMarkers(coin, step) {
    if (!book) return [];
    const b = t => Math.floor(t / step) * step, m = [];
    book.open.concat(book.closed).filter(p => p.coin === coin).forEach(p => {
      const L = p.side === 'long';
      m.push({ time: b(ts(p.opened_at)), position: L ? 'belowBar' : 'aboveBar', color: '#e879f9', shape: L ? 'arrowUp' : 'arrowDown', text: 'GROK ' + p.ticket.slice(-11) });
      if (p.closed_at) m.push({ time: b(ts(p.closed_at)), position: L ? 'aboveBar' : 'belowBar', color: p.pnl >= 0 ? '#2bf5a0' : '#ff4d6d', shape: 'circle', text: `x ${fx(p.pnl)} ${p.R >= 0 ? '+' : ''}${p.R.toFixed(2)}R` });
    });
    (book.shadow || []).filter(s => s.coin === coin).forEach(s => {
      m.push({ time: b(ts(s.opened_at)), position: s.side === 'long' ? 'belowBar' : 'aboveBar', color: '#7f8bb0', shape: 'square', text: 'shadow ' + s.id.slice(-2) });
      if (s.closed_at) m.push({ time: b(ts(s.closed_at)), position: 'inBar', color: '#7f8bb0', shape: 'circle', text: `shadow ${s.R >= 0 ? '+' : ''}${s.R}R` });
    });
    return m;
  }
  function deskMarkers(coin, step) {   // main-desk bots' paper trades (local journal + open)
    const d = window.__desk; if (!d) return []; const b = t => Math.floor(t / 1000 / step) * step, m = [];
    (d.journal || []).filter(j => j.coin === coin).slice(-40).forEach(j => {
      const L = j.side === 'LONG';
      m.push({ time: b(j.openedAt), position: L ? 'belowBar' : 'aboveBar', color: '#22d3ee', shape: L ? 'arrowUp' : 'arrowDown', text: (j.bot || '') + (j.ticket ? ' ' + j.ticket.slice(-2) : '') });
      m.push({ time: b(j.closedAt), position: 'aboveBar', color: j.pnl >= 0 ? '#2bf5a0' : '#ff4d6d', shape: 'circle', text: `${fx(j.pnl)} ${j.r >= 0 ? '+' : ''}${j.r.toFixed(2)}R` });
    });
    (d.paper || []).filter(p => p.coin === coin).forEach(p => m.push({ time: b(p.opened), position: p.side === 'LONG' ? 'belowBar' : 'aboveBar', color: '#22d3ee', shape: p.side === 'LONG' ? 'arrowUp' : 'arrowDown', text: p.bot }));
    return m;
  }
  const clip = (m, t0, t1) => m.filter(x => x.time >= t0 && x.time <= t1).sort((a, b) => a.time - b.time);

  // overlay on the main focus chart (no app.js changes needed beyond the exposed __desk.focus)
  let focusKey = '', focusLines = [];
  function paintFocus() {
    const d = window.__desk, f = d && d.focus; if (!f || !f.candle) return;
    const m = d.M[f.coin]; if (!m) return;
    const bars = f.tf === '1m' ? m.candles.slice(-240) : m.secs.slice(-600); if (!bars.length) return;
    const step = f.tf === '1m' ? 60 : 1, t0 = bars[0].time, t1 = (m.cur && m.cur.time) || bars[bars.length - 1].time;
    const mk = clip(grokMarkers(f.coin, step).concat(deskMarkers(f.coin, step)), t0, t1);
    const key = f.coin + f.tf + JSON.stringify(mk) + (book ? book.updated : '');
    if (key !== focusKey || f.rendered === null) { try { f.candle.setMarkers(mk); } catch (e) { } focusKey = key; }
    focusLines.forEach(l => { try { f.candle.removePriceLine(l); } catch (e) { } }); focusLines = [];
    if (book) book.open.filter(p => p.coin === f.coin).forEach(p => {
      focusLines.push(f.candle.createPriceLine({ price: p.stop, color: '#ff4d6d', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'GROK stop' }));
      focusLines.push(f.candle.createPriceLine({ price: p.target, color: '#2bf5a0', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'GROK tgt' }));
    });
  }

  // ---- GROK trade chart (REST candles, any coin / timeframe) ----
  const TF = { '15m': 900, '1h': 3600, '4h': 14400 };
  function buildChart() {
    if (!LWC || chart) return;
    chart = LWC.createChart($('#gkChart'), { autoSize: true, layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7f8bb0', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
      grid: { vertLines: { color: 'rgba(120,160,255,.05)' }, horzLines: { color: 'rgba(120,160,255,.05)' } }, rightPriceScale: { borderColor: 'rgba(120,160,255,.15)' },
      timeScale: { borderColor: 'rgba(120,160,255,.15)', timeVisible: true } });
    cs = chart.addCandlestickSeries({ upColor: '#2bf5a0', downColor: '#ff4d6d', wickUpColor: '#2bf5a0', wickDownColor: '#ff4d6d', borderVisible: false });
  }
  let drawing = false;
  async function drawTradeChart(refetch = true) {
    if (!LWC) return; buildChart(); if (drawing) return; drawing = true;
    try {
      const step = TF[view.tf], now = Date.now() / 1000;
      const end = view.around ? Math.min(now, view.around[1] + 60 * step) : now, start = (view.around ? view.around[0] : now) - 150 * step;
      if (refetch || !view.bars || view.key !== view.coin + view.tf + start) {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'candleSnapshot', req: { coin: view.coin, interval: view.tf, startTime: Math.floor(start * 1000), endTime: Math.floor(end * 1000) } }) });
        const raw = await r.json();
        view.bars = (Array.isArray(raw) ? raw : []).map(c => ({ time: Math.floor(c.t / 1000), open: +c.o, high: +c.h, low: +c.l, close: +c.c }));
        view.key = view.coin + view.tf + start;
        cs.setData(view.bars);
        if (view.bars.length) cs.applyOptions({ priceFormat: { type: 'price', precision: view.bars[0].close >= 100 ? 1 : view.bars[0].close >= 1 ? 3 : 6, minMove: view.bars[0].close >= 100 ? 0.1 : view.bars[0].close >= 1 ? 0.001 : 0.000001 } });
        chart.timeScale().fitContent();
      }
      const bs = view.bars; if (!bs.length) return;
      cs.setMarkers(clip(grokMarkers(view.coin, step).concat(deskMarkers(view.coin, step)), bs[0].time, bs[bs.length - 1].time + step));
      lines.forEach(l => { try { cs.removePriceLine(l); } catch (e) { } }); lines = [];
      if (book) book.open.filter(p => p.coin === view.coin).forEach(p => {
        lines.push(cs.createPriceLine({ price: p.entry, color: '#e2e8f0', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: p.ticket.slice(-2) + ' entry' }));
        lines.push(cs.createPriceLine({ price: p.stop, color: '#ff4d6d', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'stop' }));
        lines.push(cs.createPriceLine({ price: p.target, color: '#2bf5a0', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'target' }));
      });
      $('#gkChartT').textContent = `${view.coin}-PERP · ${view.tf}${view.around ? ' · around trade' : ''}`;
    } catch (e) { } finally { drawing = false; }
  }

  root.addEventListener('click', e => {
    const tf = e.target.closest('.gk-tf button');
    if (tf) { view.tf = tf.dataset.tf; root.querySelectorAll('.gk-tf button').forEach(b => b.classList.toggle('on', b === tf)); drawTradeChart(true); return; }
    const row = e.target.closest('.gk-row'); if (!row || !row.dataset.coin) return;
    const t1 = row.dataset.t ? ts(row.dataset.t) : null, t2 = row.dataset.t2 ? ts(row.dataset.t2) : Date.now() / 1000;
    const span = t2 - (t1 || t2); view.coin = row.dataset.coin; view.tf = span > 3 * 86400 ? '4h' : span > 12 * 3600 ? '1h' : '15m'; view.around = t1 ? [t1, t2] : null;
    root.querySelectorAll('.gk-tf button').forEach(b => b.classList.toggle('on', b.dataset.tf === view.tf));
    drawTradeChart(true);
    const d = window.__desk;   // also flip the main focus chart if the trade is within its 4h 1m window
    if (d && d.setFocus && t1 && Date.now() / 1000 - t1 < 4 * 3600) { try { if (!d.M[view.coin] && d.addCoin) d.addCoin(view.coin); d.setFocus(view.coin, '1m'); } catch (x) { } }
    $('#gkChart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  load(); setInterval(load, 60000);
  setInterval(() => { if (book) { render(); paintFocus(); } }, 2000);
  setInterval(() => drawTradeChart(true), 120000);
  window.addEventListener('resize', () => book && curve(book.cash));
})();
