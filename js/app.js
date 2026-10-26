/* AI Trading Desk: live data, charts, bots, debate orchestration */
(() => {
  'use strict';
  const E = window.Engine;
  const LWC = window.LightweightCharts;
  const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'DOGE', 'XRP'];
  const COIN_COLOR = { BTC: '#f7931a', ETH: '#8b9cff', SOL: '#14f195', HYPE: '#5eead4', DOGE: '#e0c25a', XRP: '#c7d2fe' };
  const EXTRA = []; const ALL = () => COINS.concat(EXTRA);
  const EXTRA_PAL = ['#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#34d399', '#60a5fa', '#f97316', '#e879f9', '#2dd4bf', '#facc15'];
  let UNIVERSE = [], uniAt = 0, pendingCoin = null, pinUntil = 0;
  const API = 'https://api.hyperliquid.xyz/info';
  const WSURL = 'wss://api.hyperliquid.xyz/ws';
  const BOTS = E.BOTS, BOT = E.BOT;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hhmmss = (d = new Date()) => d.toLocaleTimeString('en-GB', { hour12: false });
  const T0 = Date.now();
  const precision = p => p >= 10000 ? 1 : p >= 100 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : 6;

  // ---------- market state ----------
  const M = {};
  COINS.forEach(c => M[c] = { coin: c, candles: [], secs: [], cur: null, price: null, prev: null, ctx: {}, seeded: false, hist: false });
  let tickCount = 0, ticksTotal = 0, tps = 0, feedMode = 'connecting';

  function roll(m, sec) {
    if (m.cur && m.cur.time < sec) {
      const last = m.cur; m.secs.push(last); m.cur = null;
      let t = last.time + 1;
      while (t < sec && sec - t < 180) { const p = last.close; m.secs.push({ time: t, open: p, high: p, low: p, close: p, volume: 0, buy: 0, sell: 0 }); t++; }
      if (m.secs.length > 900) m.secs.splice(0, m.secs.length - 900);
    }
  }
  function tick(c, px, sz, side) {
    const m = M[c]; if (!m || !(px > 0)) return;
    const sec = Math.floor(Date.now() / 1000);
    roll(m, sec);
    if (!m.cur) m.cur = { time: sec, open: px, high: px, low: px, close: px, volume: 0, buy: 0, sell: 0 };
    const b = m.cur; b.high = Math.max(b.high, px); b.low = Math.min(b.low, px); b.close = px;
    if (sz) { b.volume += sz; if (side === 'B') b.buy += sz; else b.sell += sz; }
    m.price = px; tickCount++;
    const mt = Math.floor(sec / 60) * 60, lc = m.candles[m.candles.length - 1];
    if (lc && lc.time === mt) { lc.close = px; lc.high = Math.max(lc.high, px); lc.low = Math.min(lc.low, px); }
    else if (!lc || mt > lc.time) { m.candles.push({ time: mt, open: lc ? lc.close : px, high: px, low: px, close: px, volume: 0 }); if (m.candles.length > 400) m.candles.shift(); }
  }
  function seedTrades(c, trades) { // initial snapshot of recent trades → real 1s bars
    const m = M[c]; if (m.seeded) return; m.seeded = true;
    const nowSec = Math.floor(Date.now() / 1000);
    const bars = new Map();
    trades.slice().sort((a, b) => a.time - b.time).forEach(t => {
      const s = Math.floor(t.time / 1000); if (s >= nowSec || nowSec - s > 300) return;
      const px = +t.px, sz = +t.sz; let b = bars.get(s);
      if (!b) { b = { time: s, open: px, high: px, low: px, close: px, volume: 0, buy: 0, sell: 0 }; bars.set(s, b); }
      b.high = Math.max(b.high, px); b.low = Math.min(b.low, px); b.close = px; b.volume += sz; if (t.side === 'B') b.buy += sz; else b.sell += sz;
    });
    const arr = [...bars.values()]; if (!arr.length || m.secs.length) return;
    const filled = []; for (const b of arr) { const p = filled[filled.length - 1]; if (p) for (let t = p.time + 1; t < b.time && b.time - t < 60; t++) filled.push({ time: t, open: p.close, high: p.close, low: p.close, close: p.close, volume: 0, buy: 0, sell: 0 }); filled.push(b); }
    if (m.cur && filled.length && filled[filled.length - 1].time >= m.cur.time) return;
    m.secs = filled.slice(-900);
  }

  async function loadHistory(c) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'candleSnapshot', req: { coin: c, interval: '1m', startTime: Date.now() - 240 * 60e3 } }) });
      const j = await r.json();
      const hist = j.map(k => ({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }));
      const m = M[c];
      const live = m.candles.filter(x => !hist.length || x.time > hist[hist.length - 1].time);
      m.candles = hist.concat(live).slice(-400);
      if (!m.price && hist.length) m.price = hist[hist.length - 1].close;
      m.hist = true;
      log('DATA', `candleSnapshot ${c} 1m · ${hist.length} bars`, '#22d3ee');
    } catch (e) { log('ERR', `history ${c}: ${e.message}`, '#ff4d6d'); }
  }
  async function loadCtx() {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) });
      const [meta, ctxs] = await r.json();
      UNIVERSE = meta.universe.map((u, i) => ({ name: u.name, lev: u.maxLeverage, delisted: !!u.isDelisted, ctx: ctxs[i] || {} })).filter(u => !u.delisted);
      uniAt = Date.now();
      meta.universe.forEach((u, i) => { if (M[u.name] && ctxs[i]) M[u.name].ctx = Object.assign({}, ctxs[i], M[u.name].ctx); });
    } catch (e) { /* ws will fill it */ }
  }

  // ---------- websocket ----------
  let ws, wsBackoff = 1000, lastMsg = 0, pollTimer = null;
  function connect() {
    setFeed('connecting', 'warn');
    try { ws = new WebSocket(WSURL); } catch (e) { scheduleReconnect(); return; }
    ws.onopen = () => {
      wsBackoff = 1000; setFeed('WS live', 'ok'); log('WS', 'connected wss://api.hyperliquid.xyz/ws', '#2bf5a0');
      for (const c of ALL()) for (const sub of [{ type: 'bbo', coin: c }, { type: 'trades', coin: c }, { type: 'candle', coin: c, interval: '1m' }, { type: 'activeAssetCtx', coin: c }, { type: 'l2Book', coin: c }])
        ws.send(JSON.stringify({ method: 'subscribe', subscription: sub }));
      log('WS', `subscribed bbo/trades/candle/ctx × ${ALL().length} coins`, '#2bf5a0');
      stopPoll();
    };
    ws.onmessage = ev => {
      lastMsg = Date.now();
      let j; try { j = JSON.parse(ev.data); } catch (e) { return; }
      const d = j.data;
      switch (j.channel) {
        case 'bbo': if (d && d.bbo && d.bbo[0] && d.bbo[1]) { tick(d.coin, (+d.bbo[0].px + +d.bbo[1].px) / 2); if (M[d.coin]) { M[d.coin].exTs = d.time; const bp = +d.bbo[0].px, ap = +d.bbo[1].px; M[d.coin].spreadPct = (ap - bp) / ((ap + bp) / 2) * 100; } } break;
        case 'l2Book': if (d && M[d.coin] && d.levels) { M[d.coin].book = d.levels; M[d.coin].bookTs = Date.now(); } break;
        case 'trades':
          if (Array.isArray(d) && d.length) {
            const c = d[0].coin;
            if (!M[c]) break;
            if (!M[c].seeded) { seedTrades(c, d); break; }
            for (const t of d) tick(t.coin, +t.px, +t.sz, t.side);
          } break;
        case 'candle': if (d && M[d.s]) {
          const m = M[d.s], t = d.t / 1000, lc = m.candles[m.candles.length - 1];
          const bar = { time: t, open: +d.o, high: +d.h, low: +d.l, close: +d.c, volume: +d.v };
          if (lc && lc.time === t) { lc.open = bar.open; lc.high = Math.max(bar.high, lc.high); lc.low = Math.min(bar.low, lc.low); lc.volume = bar.volume; }
          else if (!lc || t > lc.time) { m.candles.push(bar); if (m.candles.length > 400) m.candles.shift(); }
        } break;
        case 'activeAssetCtx': if (d && M[d.coin]) M[d.coin].ctx = d.ctx; break;
      }
    };
    ws.onclose = () => { setFeed('reconnecting', 'warn'); log('WS', 'disconnected, retrying', '#fbbf24'); scheduleReconnect(); };
    ws.onerror = () => { /* onclose follows */ };
  }
  function scheduleReconnect() {
    startPoll();
    setTimeout(connect, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 15000);
  }
  setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"method":"ping"}'); }, 30000);
  setInterval(() => { if (ws && ws.readyState === 1 && Date.now() - lastMsg > 20000) { try { ws.close(); } catch (e) { } } }, 5000);
  // REST fallback while WS is down
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"allMids"}' });
        const mids = await r.json(); ALL().forEach(c => mids[c] && tick(c, +mids[c]));
        setFeed('REST poll', 'warn');
      } catch (e) { setFeed('offline', 'bad'); }
    }, 2000);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function setFeed(t, cls) {
    feedMode = t; const f = $('#feed'); f.textContent = t; f.className = cls;
    $('#livePill').classList.toggle('off', cls === 'bad'); $('#liveTxt').textContent = cls === 'bad' ? 'OFFLINE' : 'LIVE';
  }

  // ---------- avatars ----------
  let avN = 0;
  function shade(hex, f = 0.45) { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return `rgb(${r * (1 - f) | 0},${g * (1 - f) | 0},${b * (1 - f) | 0})`; }
  function avatar(b, cls = 'av') {
    const id = 'ag' + (avN++);
    const S = { triangle: '<polygon points="20,2 38.5,35.5 1.5,35.5" stroke-linejoin="round"/>', circle: '<circle cx="20" cy="20" r="17.5"/>', square: '<rect x="2.5" y="2.5" width="35" height="35" rx="9"/>', hexagon: '<polygon points="20,1.5 36.5,10.8 36.5,29.2 20,38.5 3.5,29.2 3.5,10.8"/>', diamond: '<polygon points="20,1 39,20 20,39 1,20"/>' };
    const y = b.shape === 'triangle' ? 25 : 19;
    return `<svg class="avsvg ${cls}" viewBox="0 0 40 40" aria-label="${b.name}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b.color}"/><stop offset="1" stop-color="${shade(b.color)}"/></linearGradient></defs><g fill="url(#${id})" stroke="rgba(255,255,255,.45)" stroke-width="1">${S[b.shape]}</g><g class="eye"><ellipse cx="14.5" cy="${y}" rx="3.3" ry="3.8" fill="#fff"/><ellipse cx="25.5" cy="${y}" rx="3.3" ry="3.8" fill="#fff"/><circle cx="15.3" cy="${y + .7}" r="1.7" fill="#0b1020"/><circle cx="26.3" cy="${y + .7}" r="1.7" fill="#0b1020"/></g><path d="M16.5 ${y + 6.5} Q20 ${y + 9.5} 23.5 ${y + 6.5}" stroke="#0b1020" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="11" cy="${y + 5}" r="1.8" fill="#fff" opacity=".25"/><circle cx="29" cy="${y + 5}" r="1.8" fill="#fff" opacity=".25"/></svg>`;
  }

  // ---------- chart helpers ----------
  const chartBase = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7f8bb0', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
    grid: { vertLines: { color: 'rgba(120,160,255,.05)' }, horzLines: { color: 'rgba(120,160,255,.05)' } },
    rightPriceScale: { borderColor: 'rgba(120,160,255,.15)' },
    timeScale: { borderColor: 'rgba(120,160,255,.15)', timeVisible: true, secondsVisible: true, tickMarkFormatter: t => { const d = new Date(t * 1000); return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: d.getSeconds() ? '2-digit' : undefined }); } },
    localization: { timeFormatter: t => new Date(t * 1000).toLocaleTimeString('en-GB') },
    crosshair: { mode: 0, vertLine: { color: 'rgba(34,211,238,.4)', labelBackgroundColor: '#0e7490' }, horzLine: { color: 'rgba(34,211,238,.4)', labelBackgroundColor: '#0e7490' } },
  };
  const pf = p => { const d = precision(p || 1); return { type: 'price', precision: d, minMove: Math.pow(10, -d) }; };

  // focus chart
  let focus = { coin: 'BTC', tf: '1m', chart: null, candle: null, e9: null, e21: null, vol: null, lastT: 0, lines: [], bot: null };
  function buildFocus() {
    if (!LWC) return;
    const c = LWC.createChart($('#focusChart'), Object.assign({}, chartBase, { timeScale: Object.assign({}, chartBase.timeScale, { rightOffset: 6, barSpacing: 7 }) }));
    focus.chart = c;
    focus.candle = c.addCandlestickSeries({ upColor: '#2bf5a0', downColor: '#ff4d6d', wickUpColor: '#2bf5a0', wickDownColor: '#ff4d6d', borderVisible: false });
    focus.e9 = c.addLineSeries({ color: '#22d3ee', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    focus.e21 = c.addLineSeries({ color: '#a78bfa', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    focus.vol = c.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    c.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
  }
  function focusBars() {
    const m = M[focus.coin];
    if (focus.tf === '1m') return m.candles.slice(-240);
    const a = m.secs.slice(-600); if (m.cur) a.push(m.cur); return a;
  }
  function renderFocus(full) {
    if (!focus.chart) return;
    const key = focus.coin + '|' + focus.tf; if (focus.rendered !== key) full = true;
    const bars = focusBars();
    if (!bars.length) { if (full) { [focus.candle, focus.e9, focus.e21, focus.vol].forEach(x => x.setData([])); focus.rendered = null; focus.lastT = 0; } return; }
    const closes = bars.map(b => b.close);
    const e9 = E.TA.emaSeries(closes, 9), e21 = E.TA.emaSeries(closes, 21);
    const volColor = b => b.close >= b.open ? 'rgba(43,245,160,.35)' : 'rgba(255,77,109,.35)';
    const last = bars[bars.length - 1];
    try {
      if (full || last.time < focus.lastT) {
        focus.candle.applyOptions({ priceFormat: pf(last.close) });
        focus.candle.setData(bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
        focus.e9.setData(bars.map((b, i) => e9[i] == null ? { time: b.time } : { time: b.time, value: e9[i] }));
        focus.e21.setData(bars.map((b, i) => e21[i] == null ? { time: b.time } : { time: b.time, value: e21[i] }));
        focus.vol.setData(bars.map(b => ({ time: b.time, value: b.volume || 0, color: volColor(b) })));
        focus.chart.timeScale().applyOptions({ secondsVisible: focus.tf === '1s', barSpacing: focus.tf === '1s' ? 5 : 7 });
        focus.chart.timeScale().scrollToRealTime();
      } else {
        // push any bars newer than lastT (in order), then last
        const start = bars.findIndex(b => b.time >= focus.lastT);
        for (let i = Math.max(0, start); i < bars.length; i++) {
          const b = bars[i];
          focus.candle.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
          if (e9[i] != null) focus.e9.update({ time: b.time, value: e9[i] });
          if (e21[i] != null) focus.e21.update({ time: b.time, value: e21[i] });
          focus.vol.update({ time: b.time, value: b.volume || 0, color: volColor(b) });
        }
      }
      focus.lastT = last.time; if (full) focus.rendered = key;
    } catch (e) { focus.lastT = 0; focus.rendered = null; }
  }
  function setFocus(coin, tf, bot) {
    if (tf) focus.tf = tf;
    focus.coin = coin; focus.lastT = 0;
    renderFocus(true); drawIdeaLines(); updateFocusHead(true);
    document.querySelectorAll('#tfSwitch button').forEach(b => b.classList.toggle('on', b.dataset.tf === focus.tf));
    document.querySelectorAll('.mini').forEach(p => p.classList.toggle('active', p.dataset.coin === coin));
    if (bot) {
      focus.bot = bot;
      const fp = $('#focusPanel'); fp.style.setProperty('--bc', bot.color); fp.classList.add('glow');
      document.querySelectorAll('.mini').forEach(p => p.style.setProperty('--bc', bot.color));
      const av = $('#focusAv'); av.innerHTML = avatar(bot, ''); av.classList.remove('pop'); void av.offsetWidth; av.classList.add('pop');
      const ov = $('#openOverlay'); ov.style.setProperty('--bc', bot.color);
      ov.innerHTML = `${avatar(bot, '')}<span><span style="color:${bot.color}">${bot.name}</span> opened ${coin}-PERP · ${focus.tf}</span>`;
      ov.classList.remove('show'); void ov.offsetWidth; ov.classList.add('show');
      const sc = $('#scan'); sc.style.background = `linear-gradient(90deg,transparent,${bot.color}22,${bot.color}66 92%,transparent)`; sc.classList.remove('go'); void sc.offsetWidth; sc.classList.add('go');
      $('#focusSub').innerHTML = `<b style="color:${bot.color}">${bot.name}</b> · ${bot.role} · analyzing ${coin} on real Hyperliquid data`;
    }
  }
  function drawIdeaLines() {
    if (!focus.candle) return;
    focus.lines.forEach(l => { try { focus.candle.removePriceLine(l); } catch (e) { } }); focus.lines = [];
    ideas.filter(i => i.coin === focus.coin && i.status === 'OPEN').slice(0, 2).forEach(i => {
      const mk = (price, color, title) => focus.lines.push(focus.candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }));
      mk(i.entry, '#e2e8f0', `IDEA ${i.side} entry`); mk(i.stop, '#ff4d6d', 'stop'); mk(i.target, '#2bf5a0', 'target');
    });
  }
  function updateFocusHead(force) {
    const m = M[focus.coin]; if (!m.price) return;
    $('#focusCoin').textContent = focus.coin;
    const px = $('#focusPx'); px.textContent = E.fmtPx(m.price);
    px.className = 'px ' + (m.prevFocus != null && m.price !== m.prevFocus ? (m.price > m.prevFocus ? 'up' : 'dn') : '');
    m.prevFocus = m.price;
    const ch = m.ctx.prevDayPx ? (m.price / +m.ctx.prevDayPx - 1) * 100 : null;
    const ce = $('#focusChg'); ce.textContent = ch == null ? '' : E.sg(ch, 2) + ' 24h'; ce.className = 'chg ' + (ch >= 0 ? 'bg-up' : 'bg-dn');
    if (force || Date.now() % 3 === 0) {
      const s = E.computeSignals(M[focus.coin]);
      const chips = [
        ['RSI', E.f1(s.rsi), s.rsi > 70 ? 'hot' : s.rsi < 30 ? 'cold' : ''],
        ['EMA Δ', E.sg(s.emaSpread, 3), ''],
        ['σ1m', E.f2(s.vol) + '%', s.vol > 0.25 ? 'hot' : ''],
        ['ATR', E.f2(s.atrPct) + '%', ''],
        ['FLOW', E.sg(s.flowImb * 100, 0), ''],
        ['VOLx', E.f2(s.volSpike), s.volSpike > 1.5 ? 'hot' : ''],
        ['FUND', s.funding == null ? '—' : s.funding.toFixed(4) + '%', ''],
      ];
      $('#focusChips').innerHTML = chips.map(c => `<span class="chip ${c[2]}">${c[0]} <b>${c[1]}</b></span>`).join('');
    }
  }

  // minis
  const minis = {};
  function buildMinis() {
    const wrap = $('#minis');
    COINS.forEach(c => {
      const p = el('div', 'panel mini'); p.dataset.coin = c;
      p.innerHTML = `<div class="mh"><span class="sym" style="color:${COIN_COLOR[c]}">${c}<small>1s · live</small></span><span class="px" id="mpx-${c}">—</span></div>
        <div class="ms"><span id="mchg-${c}">Δ60s —</span><span id="mrsi-${c}">RSI —</span></div>
        <div class="mc"><div class="chart" id="mch-${c}"></div><div class="watchers" id="mw-${c}"></div></div>
        <div class="rsi-bar"><i id="mrb-${c}"></i></div>`;
      p.onclick = () => { setFocus(c); pinUntil = Date.now() + 45000; };
      wrap.appendChild(p);
      if (!LWC) return;
      const ch = LWC.createChart(document.getElementById('mch-' + c), Object.assign({}, chartBase, {
        handleScroll: false, handleScale: false,
        layout: Object.assign({}, chartBase.layout, { attributionLogo: false }),
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(120,160,255,.04)' } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: .15, bottom: .1 } },
        timeScale: Object.assign({}, chartBase.timeScale, { visible: false, rightOffset: 4 }),
        crosshair: { mode: 0, vertLine: { visible: false, labelVisible: false }, horzLine: { visible: true, color: 'rgba(255,255,255,.2)' } },
      }));
      const col = COIN_COLOR[c];
      const s = ch.addAreaSeries({ lineColor: col, topColor: col + '55', bottomColor: col + '00', lineWidth: 2, priceLineVisible: true, priceLineColor: col + '88', priceLineStyle: 2, lastPriceAnimation: 1, crosshairMarkerRadius: 3 });
      minis[c] = { chart: ch, series: s, lastT: 0, n: 0 };
    });
  }
  function renderMini(c) {
    const mi = minis[c], m = M[c]; if (!mi || !m.price) return;
    const bars = m.secs.slice(-300); if (m.cur) bars.push(m.cur);
    if (!bars.length) return;
    try {
      if (!mi.lastT || bars[bars.length - 1].time < mi.lastT) {
        mi.series.applyOptions({ priceFormat: pf(m.price) });
        mi.series.setData(bars.map(b => ({ time: b.time, value: b.close })));
      } else {
        for (const b of bars) if (b.time >= mi.lastT) mi.series.update({ time: b.time, value: b.close });
      }
      mi.lastT = bars[bars.length - 1].time;
      const n = bars.length;
      mi.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 180), to: n + 3 });
    } catch (e) { mi.lastT = 0; }
  }

  // tickers
  function buildTickers() {
    const w = $('#tickers');
    COINS.forEach((c, i) => {
      const t = el('div', 'tk'); t.id = 'tk-' + c; t.style.animationDelay = (i * 60) + 'ms';
      t.innerHTML = `<div class="top"><span class="sym" style="color:${COIN_COLOR[c]}">${c}</span><span class="c24" id="tc-${c}">—</span></div><div class="p" id="tp-${c}">—</div><div class="s"><span id="tv-${c}">vol —</span><span id="tf-${c}">fund —</span></div><canvas id="tsp-${c}" width="200" height="28"></canvas>`;
      t.onclick = () => { setFocus(c); pinUntil = Date.now() + 45000; };
      w.appendChild(t);
    });
  }
  function renderTicker(c) {
    const m = M[c]; if (!m || !m.price) return;
    const p = document.getElementById('tp-' + c); p.textContent = E.fmtPx(m.price);
    const box = document.getElementById('tk-' + c);
    if (m.prev != null && m.price !== m.prev) {
      const up = m.price > m.prev; p.className = 'p ' + (up ? 'up' : 'dn');
      box.classList.remove('flash-up', 'flash-dn'); void box.offsetWidth; box.classList.add(up ? 'flash-up' : 'flash-dn');
      clearTimeout(box._t); box._t = setTimeout(() => { box.classList.remove('flash-up', 'flash-dn'); p.className = 'p'; }, 700);
    }
    m.prev = m.price;
    const ctx = m.ctx;
    if (ctx.prevDayPx) { const ch = (m.price / +ctx.prevDayPx - 1) * 100; const e = document.getElementById('tc-' + c); e.textContent = E.sg(ch, 2); e.className = 'c24 ' + (ch >= 0 ? 'bg-up' : 'bg-dn'); }
    if (ctx.dayNtlVlm) document.getElementById('tv-' + c).textContent = 'vol ' + E.fmtUsd(+ctx.dayNtlVlm);
    if (ctx.funding != null) document.getElementById('tf-' + c).textContent = 'fund ' + (+ctx.funding * 100).toFixed(4) + '%';
    // sparkline (last 2 minutes of 1s closes)
    const cv = document.getElementById('tsp-' + c), g = cv.getContext('2d');
    const pts = m.secs.slice(-120).map(b => b.close); if (m.cur) pts.push(m.cur.close);
    g.clearRect(0, 0, cv.width, cv.height);
    if (pts.length > 2) {
      const mn = Math.min(...pts), mx = Math.max(...pts), rg = (mx - mn) || 1;
      g.beginPath(); pts.forEach((v, i) => { const x = i / (pts.length - 1) * cv.width, y = cv.height - 3 - (v - mn) / rg * (cv.height - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = COIN_COLOR[c]; g.lineWidth = 1.5; g.stroke();
      g.lineTo(cv.width, cv.height); g.lineTo(0, cv.height); g.closePath();
      const gr = g.createLinearGradient(0, 0, 0, cv.height); gr.addColorStop(0, COIN_COLOR[c] + '55'); gr.addColorStop(1, COIN_COLOR[c] + '00'); g.fillStyle = gr; g.fill();
    }
    // mini header
    const mp = document.getElementById('mpx-' + c); if (mp) { mp.textContent = E.fmtPx(m.price); mp.className = 'px ' + p.className.replace('p', '').trim(); }
    const secs = m.secs; if (secs.length > 60) { const ch = (m.price / secs[secs.length - 60].close - 1) * 100; const e = document.getElementById('mchg-' + c); e.textContent = 'Δ60s ' + E.sg(ch); e.className = ch >= 0 ? 'up' : 'dn'; }
  }
  function renderRsi() {
    ALL().forEach(c => {
      const s = E.computeSignals(M[c]); M[c].sig = s;
      if (s.rsi == null || !document.getElementById('mrsi-' + c)) return;
      document.getElementById('mrsi-' + c).textContent = 'RSI ' + E.f1(s.rsi);
      const b = document.getElementById('mrb-' + c); b.style.width = s.rsi + '%';
      b.style.background = s.rsi > 70 ? 'var(--dn)' : s.rsi < 30 ? 'var(--up)' : 'linear-gradient(90deg,var(--cy),var(--vi))';
    });
    const ups = COINS.filter(c => M[c].sig && M[c].sig.chg60m > 0).length;
    $('#stMood').innerHTML = ups >= 4 ? `<span class="up">RISK-ON</span> <small>${ups}/6 up 1h</small>` : ups <= 2 ? `<span class="dn">RISK-OFF</span> <small>${ups}/6 up 1h</small>` : `<span class="warn">MIXED</span> <small>${ups}/6 up 1h</small>`;
  }

  // ---------- bots UI ----------
  const botState = {}; // id -> {watching, view, term}
  function buildBots() {
    const w = $('#bots');
    BOTS.forEach((b, i) => {
      const d = el('div', 'bot'); d.id = 'bot-' + b.id; d.style.setProperty('--bc', b.color); d.style.animationDelay = (i * 80) + 'ms';
      d.innerHTML = `<div class="bh"><div class="bav">${avatar(b, '')}</div><div><div class="bn">${b.name}</div><div class="br">${b.role.toUpperCase()}</div></div><div class="state" id="bs-${b.id}">IDLE</div></div>
        <div class="rule">${esc(b.rule)}</div>
        <div class="watch"><span>watching <b id="bw-${b.id}">—</b></span><span>view <span class="view" id="bv-${b.id}">—</span></span></div>
        <div class="term" id="bt-${b.id}"><div>> boot ${b.name.toLowerCase()}.persona ok</div><div><span class="cur"></span></div></div>`;
      w.appendChild(d);
      botState[b.id] = { watching: null, view: null };
    });
  }
  function termPush(id, txt, cls = '') {
    const t = document.getElementById('bt-' + id); if (!t) return;
    const cur = t.lastElementChild;
    const line = el('div', cls); line.textContent = txt;
    t.insertBefore(line, cur);
    while (t.children.length > 9) t.removeChild(t.firstElementChild);
  }
  function setWatching(id, coin) {
    botState[id].watching = coin;
    document.getElementById('bw-' + id).textContent = coin;
    COINS.forEach(c => {
      const w = document.getElementById('mw-' + c);
      const ids = BOTS.filter(b => botState[b.id].watching === c).map(b => b.id);
      const key = ids.join(',');
      if (w.dataset.k === key) return; w.dataset.k = key;
      w.innerHTML = ids.map(i => `<span class="w" style="--bc:${BOT[i].color}" title="${BOT[i].name}">${avatar(BOT[i], '')}</span>`).join('');
    });
  }
  function setView(id, view) {
    botState[id].view = view; setLevel(id, view, botState[id].watching);
    const e = document.getElementById('bv-' + id);
    const v = id === 'atlas' ? view.risk : view.side;
    e.textContent = v; e.style.color = v === 'LONG' || v === 'OK' ? 'var(--up)' : v === 'SHORT' || v === 'VETO' ? 'var(--dn)' : v === 'CAUTION' ? 'var(--am)' : 'var(--mut)';
  }
  let activeId = null;
  function setActive(id) {
    activeId = id;
    BOTS.forEach(b => { document.getElementById('bot-' + b.id).classList.toggle('active', b.id === id); document.getElementById('bs-' + b.id).textContent = b.id === id ? 'ACTIVE' : (botState[b.id].watching ? 'WATCHING' : 'IDLE'); });
    const b = BOT[id]; const s = $('#stActive'); s.innerHTML = `<span style="color:${b.color}">${b.name}</span> <small style="color:var(--mut)">${b.role}</small>`; bump(s);
  }
  const cursorEl = $('#cursor');
  async function moveCursor(bot, target) {
    const r = target.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) { cursorEl.style.opacity = 0; return; }
    cursorEl.style.setProperty('--bc', bot.color);
    if (cursorEl.dataset.bot !== bot.id) {
      cursorEl.dataset.bot = bot.id;
      cursorEl.innerHTML = `<svg class="ptr" viewBox="0 0 14 14"><path d="M1 1 L13 6 L7 7.5 L5.5 13 Z" fill="${bot.color}" stroke="#000" stroke-width=".8"/></svg><div class="avwrap">${avatar(bot, '')}</div><span class="lab">${bot.name}</span>`;
    }
    cursorEl.style.opacity = 1;
    const x = r.left + scrollX + r.width * rand(0.45, 0.7), y = r.top + scrollY + r.height * rand(0.35, 0.6);
    cursorEl.style.transform = `translate(${x}px,${y}px)`;
    await sleep(1050);
    cursorEl.classList.remove('click'); void cursorEl.offsetWidth; cursorEl.classList.add('click');
    await sleep(250);
  }

  // ---------- chat & log ----------
  let msgCount = 0;
  const chatEl = $('#chat');
  function fmtMsg(t) {
    let h = esc(t);
    h = h.replace(/\b(BTC|ETH|SOL|HYPE|DOGE|XRP)\b/g, '<span class="coin">$1</span>');
    h = h.replace(/@(NOVA|LUNA|ATLAS|ECHO|VEX)\b/g, (m, n) => `<span class="at" style="color:${BOTS.find(b => b.name === n).color}">@${n}</span>`);
    h = h.replace(/(\+\d+(\.\d+)?%)/g, '<span class="up">$1</span>').replace(/(-\d+(\.\d+)?%)/g, '<span class="dn">$1</span>');
    return h;
  }
  function post(id, text, opts = {}) {
    const b = BOT[id];
    const m = el('div', 'msg' + (opts.idea ? ' idea' : ''));
    m.style.setProperty('--bc', b.color);
    const v = botState[id].view; const vv = v ? (id === 'atlas' ? v.risk : v.side) : '';
    const tagCol = vv === 'LONG' || vv === 'OK' ? '#2bf5a0' : vv === 'SHORT' || vv === 'VETO' ? '#ff4d6d' : vv === 'CAUTION' ? '#fbbf24' : '#7f8bb0';
    m.innerHTML = `<div class="av">${avatar(b, '')}</div><div class="bub"><div class="who"><b>${b.name}</b><span class="tag" style="color:${tagCol};border-color:${tagCol}55">${opts.idea ? 'IDEA' : vv || b.role}</span><time>${hhmmss()}</time></div><div class="txt">${fmtMsg(text)}</div></div>`;
    chatEl.appendChild(m);
    while (chatEl.children.length > 80) chatEl.removeChild(chatEl.firstElementChild);
    chatEl.scrollTop = chatEl.scrollHeight;
    msgCount++; $('#chatCount').textContent = msgCount; $('#hdrMsgs').textContent = msgCount; const s = $('#stMsgs'); s.textContent = msgCount; bump(s);
  }
  function sysMsg(t) { const m = el('div', 'msg sys', `<div class="bub">${esc(t)}</div>`); chatEl.appendChild(m); chatEl.scrollTop = chatEl.scrollHeight; }
  async function typing(id, ms) {
    const b = BOT[id];
    $('#typing').innerHTML = `<span class="av">${avatar(b, '')}</span><span style="color:${b.color}">${b.name}</span> is typing <span class="dots"><i></i><i></i><i></i></span>`;
    await sleep(ms);
    $('#typing').innerHTML = '';
  }
  const logEl = $('#log');
  function log(k, t, color = '#7f8bb0') {
    if (!logEl) return;
    const l = el('div', 'll', `<time>${hhmmss()}</time><span class="k" style="color:${color}">${esc(k)}</span><span class="t">${esc(t)}</span>`);
    logEl.prepend(l);
    while (logEl.children.length > 30) logEl.removeChild(logEl.lastElementChild);
  }
  function bump(e) { e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }
  function toast(html) { const t = $('#toast'); t.innerHTML = html; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 4200); }

  // ---------- paper book (per-bot $10k accounts, risk-sized, persisted) ----------
  // Sizing, limits and breakers live in js/risk.js (pure, unit-tested). This section only wires them to the UI.
  const RK = window.Risk;
  const START_EQ = 10000, REF_EQ = 10000, TRADERS = ['nova', 'luna', 'echo', 'vex'];
  const LS_BOOK = 'td.book.v2', LS_JOURNAL = 'td.journal.v1', JOURNAL_MAX = 3000;
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota / private mode */ } };
  const book = lsGet(LS_BOOK, null) || { accts: {}, open: [], ticketDay: '', ticketN: 0, settings: {} };
  TRADERS.forEach(id => { if (!book.accts[id]) book.accts[id] = { equity: START_EQ, day: '', dayStart: START_EQ, curve: [[Date.now(), START_EQ]] }; });
  const journal = lsGet(LS_JOURNAL, []);
  const paper = book.open, closed = journal; // closed = journal (oldest→newest)
  let limits = RK.effectiveLimits(book.settings);
  let journalDirty = true;
  const saveBook = () => lsSet(LS_BOOK, book);
  const botTrades = id => journal.filter(j => j.bot === id);
  function mtm(p) { const m = M[p.coin]; const px = m && m.price; if (!px) return 0; return (px - p.entry) * (p.side === 'LONG' ? 1 : -1) * p.qty; }
  function equityNow(id) { return book.accts[id].equity + paper.filter(p => p.bot === id).reduce((a, p) => a + mtm(p), 0); }
  function rollDay(id) { const a = book.accts[id], k = RK.dayKey(Date.now()); if (a.day !== k) { a.day = k; a.dayStart = a.equity; } }
  function depthFor(coin) { const m = M[coin]; if (!m || !m.book || Date.now() - (m.bookTs || 0) > 30000) return null; return RK.bookDepth(m.book, limits.depthBandPct); }
  function breakersFor(id, coin) {
    if (id) rollDay(id);
    const a = id ? book.accts[id] : null;
    return RK.checkBreakers({ now: Date.now(), equity: id ? equityNow(id) : 1, dayStartEquity: id ? a.dayStart : 1,
      trades: id ? botTrades(id).map(j => ({ closedAt: j.closedAt, r: j.r })) : [], lastFeedTs: lastMsg, depth: depthFor(coin), limits });
  }
  const atlasLog = [];
  function atlasVeto(who, coin, fired, why) {
    const line = `${hhmmss()} VETO ${who} ${coin} · rule ${fired.join('+')}${why ? ' · ' + why : ''}`;
    atlasLog.unshift(line); if (atlasLog.length > 8) atlasLog.pop();
    log('ATLAS', line, '#fbbf24');
  }
  function openPaper(id, sig, view, atlasRisk) {
    if (paper.some(p => p.bot === id && p.coin === sig.coin)) return;
    if (paper.filter(p => p.bot === id).length >= 2) return;
    const br = breakersFor(id, sig.coin);
    if (!br.allowed) { atlasVeto(BOT[id].name, sig.coin, br.fired); termPush(id, `> ATLAS blocked entry: ${br.fired.join(', ')}`, 'res'); return; }
    const st = E.stopsFor(sig, view.side), dir = view.side === 'LONG' ? 1 : -1;
    const half = M[sig.coin].spreadPct ? M[sig.coin].spreadPct / 200 : 0;
    const entry = sig.price * (1 + dir * (limits.slippagePct + half));
    const trades = botTrades(id), scale = (atlasRisk === 'CAUTION' ? 0.5 : 1) * RK.riskScaleFor(trades);
    const openRisk = paper.filter(p => p.bot === id).reduce((a, p) => a + p.riskUsd, 0);
    const sz = RK.sizePosition({ equity: equityNow(id), entry, stop: st.stop, openRiskUsd: openRisk, riskScale: scale, limits });
    if (!(sz.qty > 0)) { atlasVeto(BOT[id].name, sig.coin, ['TOTAL_OPEN_RISK'], 'no risk budget left'); return; }
    const p = { id: id + sig.coin + Date.now(), bot: id, coin: sig.coin, side: view.side, entry, mid0: sig.price, stop: st.stop, target: st.target, qty: sz.qty, notional: sz.notional, riskUsd: sz.riskUsd, riskPct: sz.riskPct, lev: sz.leverage, cappedBy: sz.cappedBy, scale, atlas: atlasRisk, why: view.why, conv: view.conv, fees: sz.notional * limits.feeRate, opened: Date.now(), isNew: true };
    paper.push(p); saveBook();
    termPush(id, `> paper ${p.side.toLowerCase()} ${p.coin} qty ${p.qty.toPrecision(4)} @ ${E.fmtPx(p.entry)} risk $${p.riskUsd.toFixed(0)} (sim)`, 'cmd');
    log('PAPER', `${BOT[id].name} opens PAPER ${p.side} ${p.coin} @ ${E.fmtPx(p.entry)} · ${(p.riskPct * 100).toFixed(2)}% risk · ${p.lev.toFixed(2)}x${scale < 1 ? ' · size×' + scale : ''}`, BOT[id].color);
  }
  function closePaper(p, reason) {
    const mid = M[p.coin] && M[p.coin].price; if (!mid) return;
    const dir = p.side === 'LONG' ? 1 : -1, half = M[p.coin].spreadPct ? M[p.coin].spreadPct / 200 : 0;
    const exit = mid * (1 - dir * (limits.slippagePct + half));
    const fees = p.fees + p.qty * exit * limits.feeRate;
    const slippageUsd = p.qty * (Math.abs(p.entry - p.mid0) + Math.abs(mid - exit));
    const rv = RK.reviewTrade({ side: p.side, entry: p.entry, exit, stop: p.stop, target: p.target, qty: p.qty, riskUsd: p.riskUsd, fees, reason, atlas: p.atlas, sizedOk: p.riskPct <= RK.HARD.riskPerTrade + 1e-9 });
    paper.splice(paper.indexOf(p), 1);
    const a = book.accts[p.bot]; a.equity += rv.pnl; a.curve.push([Date.now(), a.equity]); if (a.curve.length > 500) a.curve.splice(0, a.curve.length - 500);
    const j = { n: (journal.length ? journal[journal.length - 1].n : 0) + 1, bot: p.bot, coin: p.coin, side: p.side, ticket: p.ticket || null,
      openedAt: p.opened, closedAt: Date.now(), entry: p.entry, exit, stop: p.stop, target: p.target, qty: p.qty, notional: p.notional,
      riskUsd: p.riskUsd, riskPct: p.riskPct, atlas: p.atlas, scale: p.scale, reason, fees, slippageUsd, pnl: rv.pnl, pct: rv.pnl / p.notional * 100, r: rv.r,
      process: rv.process, outcome: rv.outcome, lesson: rv.lesson, why: p.why, equityAfter: a.equity };
    journal.push(j); if (journal.length > JOURNAL_MAX) journal.splice(0, journal.length - JOURNAL_MAX);
    lsSet(LS_JOURNAL, journal); saveBook(); journalDirty = true;
    log('PAPER', `${BOT[p.bot].name} closes ${p.side} ${p.coin} ${rv.r >= 0 ? '+' : ''}${rv.r.toFixed(2)}R $${rv.pnl.toFixed(2)} (${reason}) · process ${rv.process} / outcome ${rv.outcome}`, rv.pnl >= 0 ? '#2bf5a0' : '#ff4d6d');
    termPush(p.bot, `> close paper ${p.coin}: ${rv.r.toFixed(2)}R [${reason}] · ${rv.lesson}`, 'res');
  }
  function renderPaper() {
    for (const p of paper.slice()) {
      const m = M[p.coin]; if (!m || !m.price) continue;
      const st = E.ideaStatus(p, m.price);
      if (st === 'TARGET') closePaper(p, 'target'); else if (st === 'STOPPED') closePaper(p, 'stop'); else if (Date.now() - p.opened > 15 * 60e3) closePaper(p, 'time');
    }
    const body = $('#paperBody');
    if (!paper.length) body.innerHTML = '<tr class="ph"><td colspan="6">no open paper positions</td></tr>';
    else body.innerHTML = paper.map(p => {
      const px = M[p.coin] && M[p.coin].price, u = mtm(p), r = p.riskUsd ? u / p.riskUsd : 0, b = BOT[p.bot];
      const row = `<tr class="${p.isNew ? 'new' : ''}"><td><span class="bn">${avatar(b, 'av')}<span style="color:${b.color}">${b.name}</span></span></td><td><b>${p.coin}</b><br><small class="mut">${p.lev.toFixed(2)}x · risk $${p.riskUsd.toFixed(0)}</small></td><td class="${p.side === 'LONG' ? 'up' : 'dn'}">${p.side}</td><td>${E.fmtPx(p.entry)}<br><small class="dn">${E.fmtPx(p.stop)}</small></td><td>${E.fmtPx(px)}</td><td class="${u >= 0 ? 'up' : 'dn'}">${r >= 0 ? '+' : ''}${r.toFixed(2)}R<br><small>${u >= 0 ? '+' : '-'}$${Math.abs(u).toFixed(2)}</small></td></tr>`;
      p.isNew = false; return row;
    }).join('');
    const last = journal.slice(-12).reverse();
    $('#paperClosed').innerHTML = last.length ? last.map(c => `<span style="border-color:${BOT[c.bot].color}44"><span style="color:${BOT[c.bot].color}">${BOT[c.bot].name}</span> ${c.coin} ${c.side[0]} <b class="${c.r >= 0 ? 'up' : 'dn'}">${c.r >= 0 ? '+' : ''}${c.r.toFixed(2)}R</b></span>`).join('') : '—';
    const tot = TRADERS.reduce((a, id) => a + equityNow(id) - START_EQ, 0);
    $('#stPnl').innerHTML = `<span class="${tot >= 0 ? 'up' : 'dn'}">${tot >= 0 ? '+' : '-'}$${Math.abs(tot).toFixed(2)}</span>`;
    $('#stWin').textContent = journal.length ? `${Math.round(journal.filter(c => c.r > 0).length / journal.length * 100)}% (${journal.length})` : '—';
    renderAtlas();
    if (journalDirty) { journalDirty = false; renderJournal(); }
  }

  // ---------- ATLAS circuit breakers panel ----------
  function renderAtlas() {
    const coin = focus.coin, desk = breakersFor(null, coin);
    const daily = TRADERS.map(id => ({ id, b: breakersFor(id, coin) }));
    const dl = daily.map(x => ({ id: x.id, r: x.b.rules.find(r => r.id === 'DAILY_LOSS') })), ls = daily.map(x => ({ id: x.id, r: x.b.rules.find(r => r.id === 'LOSS_STREAK') }));
    const pill = s => `<span class="brk-st ${s}">${s === 'OK' ? 'OK' : s === 'TRIP' ? 'TRIPPED' : 'NO DATA'}</span>`;
    const worst = arr => arr.some(x => x.r.status === 'TRIP') ? 'TRIP' : 'OK';
    const per = arr => arr.map(x => `<span class="${x.r.status === 'TRIP' ? 'dn' : ''}"><b style="color:${BOT[x.id].color}">${BOT[x.id].name}</b> ${esc(x.r.detail)}</span>`).join('');
    const liq = desk.rules.find(r => r.id === 'LIQUIDITY'), stale = desk.rules.find(r => r.id === 'STALE_FEED');
    $('#atlasRules').innerHTML = `
      <div class="brk"><div class="brk-h"><b>Daily loss cap</b>${pill(worst(dl))}</div><div class="brk-d">${per(dl)}</div></div>
      <div class="brk"><div class="brk-h"><b>Loss-streak pause</b>${pill(worst(ls))}</div><div class="brk-d">${per(ls)}</div></div>
      <div class="brk"><div class="brk-h"><b>Liquidity · ${esc(coin)}</b>${pill(liq.status)}</div><div class="brk-d"><span>${esc(liq.detail)}</span></div></div>
      <div class="brk"><div class="brk-h"><b>Stale feed</b>${pill(stale.status)}</div><div class="brk-d"><span>${esc(stale.detail)}</span></div></div>`;
    $('#atlasLimits').textContent = `risk/trade ${(limits.riskPerTrade * 100).toFixed(2)}% · open risk ≤ ${(limits.totalOpenRisk * 100).toFixed(1)}% · lev ≤ ${limits.maxLeverage}x · day stop -${(limits.dailyLoss * 100).toFixed(1)}% · pause after ${limits.maxConsecLosses} losses (${limits.pauseMin}m) · fees ${(limits.feeRate * 100).toFixed(3)}%/side + slip ${(limits.slippagePct * 100).toFixed(2)}%`;
    $('#atlasLog').innerHTML = atlasLog.length ? atlasLog.map(l => `<div>${esc(l)}</div>`).join('') : '<div class="mut">no vetoes yet</div>';
  }
  function buildSettings() {
    const f = $('#atlasSettings'); if (!f) return;
    const fields = [['riskPerTrade', 'Risk / trade %', 100, RK.HARD.riskPerTrade], ['dailyLoss', 'Daily loss stop %', 100, RK.HARD.dailyLoss], ['maxConsecLosses', 'Pause after N losses', 1, RK.HARD.maxConsecLosses], ['maxLeverage', 'Max leverage x', 1, RK.HARD.maxLeverage]];
    f.innerHTML = fields.map(([k, l, m, h]) => `<label>${l}<input type="number" step="any" min="0" data-k="${k}" data-m="${m}" value="${+(limits[k] * m).toFixed(3)}" title="hard max ${h * m}"></label>`).join('') + '<button type="button" id="setReset">defaults</button><small class="mut">can only tighten · hard caps are in code</small>';
    f.querySelectorAll('input').forEach(i => i.onchange = () => {
      const v = parseFloat(i.value); if (isFinite(v)) book.settings[i.dataset.k] = v / +i.dataset.m;
      limits = RK.effectiveLimits(book.settings); saveBook(); buildSettings();
    });
    $('#setReset').onclick = () => { book.settings = {}; limits = RK.effectiveLimits(); saveBook(); buildSettings(); };
  }

  // ---------- journal & per-bot stats ----------
  function spark(curve, color) {
    const pts = curve.slice(-80); if (pts.length < 2) return '<svg class="spk" viewBox="0 0 100 24"></svg>';
    const ys = pts.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), rg = hi - lo || 1;
    const d = pts.map((p, i) => `${(i / (pts.length - 1) * 100).toFixed(1)},${(22 - (p[1] - lo) / rg * 20).toFixed(1)}`).join(' ');
    return `<svg class="spk" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${d}"/></svg>`;
  }
  const fR = x => x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + 'R';
  function renderJournal() {
    $('#botStats').innerHTML = `<tr><th>BOT</th><th>EQUITY</th><th>TRADES</th><th>WIN</th><th>AVG R</th><th>EXPECTANCY</th><th>LAST 20</th><th>PF</th><th>CURVE</th></tr>` + TRADERS.map(id => {
      const s = RK.stats(botTrades(id)), b = BOT[id], eq = book.accts[id].equity, scale = RK.riskScaleFor(botTrades(id));
      return `<tr><td><span class="bn">${avatar(b, 'av')}<span style="color:${b.color}">${b.name}</span></span>${scale < 1 ? '<small class="warn" title="negative expectancy over last 20 trades → half risk"> probation</small>' : ''}</td>
        <td class="${eq >= START_EQ ? 'up' : 'dn'}">$${eq.toFixed(2)}</td><td>${s.n}</td><td>${s.winRate == null ? '—' : Math.round(s.winRate * 100) + '%'}</td>
        <td class="${s.avgR >= 0 ? 'up' : 'dn'}">${fR(s.avgR)}</td><td class="${s.expectancy >= 0 ? 'up' : 'dn'}">${fR(s.expectancy)}</td><td class="${s.recentExp >= 0 ? 'up' : 'dn'}">${fR(s.recentExp)}</td>
        <td>${s.pf == null ? '—' : s.pf === Infinity ? '∞' : s.pf.toFixed(2)}</td><td>${spark(book.accts[id].curve, b.color)}</td></tr>`;
    }).join('');
    const rows = journal.slice(-30).reverse();
    $('#journalList').innerHTML = rows.length ? rows.map(j => `<div class="jr"><div class="jr-h"><span class="mut">#${j.n}</span><b style="color:${BOT[j.bot].color}">${BOT[j.bot].name}</b><b>${esc(j.coin)}</b><span class="${j.side === 'LONG' ? 'up' : 'dn'}">${j.side}</span>${j.ticket ? `<span class="tkt">${esc(j.ticket)}</span>` : ''}<b class="${j.r >= 0 ? 'up' : 'dn'}">${fR(j.r)}</b><span class="mut">$${j.pnl.toFixed(2)} · fees $${j.fees.toFixed(2)} · slip ~$${j.slippageUsd.toFixed(2)} · ${esc(j.reason)}</span><span class="grade g${j.process}" title="process grade">P ${j.process}</span><span class="grade g${j.outcome}" title="outcome grade">O ${j.outcome}</span><span class="mut jr-t">${new Date(j.closedAt).toLocaleString('en-GB', { hour12: false })}</span></div><div class="jr-l">💡 ${esc(j.lesson)}</div></div>`).join('') : '<div class="empty">no closed paper trades yet · every closed trade is reviewed here</div>';
    $('#journalCount').textContent = journal.length;
  }
  function exportJournal() {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), note: 'paper trades only', limits, accounts: book.accts, journal }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `trading-desk-journal-${RK.dayKey(Date.now())}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function resetBook() {
    if (!confirm('Reset paper accounts to $10k each and clear open paper positions? The journal is kept (append-only).')) return;
    paper.splice(0); TRADERS.forEach(id => book.accts[id] = { equity: START_EQ, day: '', dayStart: START_EQ, curve: [[Date.now(), START_EQ]] }); saveBook(); journalDirty = true;
  }
  function nextTicket() {
    const k = RK.dayKey(Date.now()); if (book.ticketDay !== k) { book.ticketDay = k; book.ticketN = 0; }
    book.ticketN++; saveBook(); return RK.ticketId(Date.now(), book.ticketN);
  }

  // ---------- ideas for you ----------
  const ideas = []; let ideaCount = 0, lastIdeaAt = 0;
  function addIdea(idea) {
    idea.status = 'OPEN'; ideas.unshift(idea); ideaCount++;
    const s = $('#stIdeas'); s.textContent = ideaCount; bump(s);
    const empty = $('#ideasEmpty'); if (empty) empty.remove();
    const L = idea.side === 'LONG';
    const card = el('div', 'idea ' + (L ? 'L' : 'S')); card.id = 'idea-' + idea.id;
    const reasons = idea.reasons.map(r => `<li>${avatar(BOT[r.bot], 'av')}<span><b style="color:${BOT[r.bot].color}">${BOT[r.bot].name}:</b> ${esc(r.why)}</span></li>`).join('')
      + idea.dissent.map(r => `<li class="dis">${avatar(BOT[r.bot], 'av')}<span><b style="color:${BOT[r.bot].color}">${BOT[r.bot].name} disagrees:</b> ${esc(r.why)}</span></li>`).join('');
    const riskPct = Math.abs(idea.entry - idea.stop) / idea.entry * 100;
    card.innerHTML = `<div class="ih"><span class="tkt">${idea.ticket || ''}</span><span class="coin" style="color:${COIN_COLOR[idea.coin]}">${idea.coin}</span><span class="side-pill ${L ? 'L' : 'S'}">${L ? '▲ LONG' : '▼ SHORT'}</span><span class="conf ${idea.confidence}">CONFIDENCE<b>${idea.confidence}</b></span></div>
      <div class="levels"><div><label>ENTRY</label><b>${E.fmtPx(idea.entry)}</b></div><div><label>STOP</label><b class="dn">${E.fmtPx(idea.stop)}</b></div><div><label>TARGET</label><b class="up">${E.fmtPx(idea.target)}</b></div><div><label>R:R</label><b>1:${idea.rr}</b></div></div>
      ${idea.size ? `<div class="levels sz"><div><label>SIZE / $10K</label><b>${idea.size.qty.toPrecision(4)}</b></div><div><label>NOTIONAL</label><b>$${idea.size.notional.toFixed(0)}</b></div><div><label>RISK</label><b class="dn">$${idea.size.riskUsd.toFixed(0)} · ${(idea.size.riskPct * 100).toFixed(2)}%</b></div><div><label>LEVERAGE</label><b>${idea.size.leverage.toFixed(2)}x</b></div></div>` : ''}
      <div class="prog"><span class="entry"></span><span class="now" data-r="now"></span></div>
      <div class="prog-l"><span>STOP −${riskPct.toFixed(2)}%</span><span>ENTRY</span><span>TARGET +${(riskPct * 2).toFixed(2)}%</span></div>
      <div class="live-pnl"><span>since idea · <span data-r="age">0s</span> · now <b data-r="px" style="font-size:11px">${E.fmtPx(idea.entry)}</b></span><b data-r="pnl">+0.00%</b></div>
      <ul class="reasons">${reasons}</ul>
      <div class="agree-row">AGREED ${idea.agree.map(id => `<span title="${BOT[id].name}">${avatar(BOT[id], 'av')}</span>`).join('')}${idea.risk === 'CAUTION' ? '<span class="warn" style="margin-left:auto">⚠ ATLAS: half size</span>' : ''}</div>`;
    const list = $('#ideas'); list.prepend(card);
    const cards = list.querySelectorAll('.idea'); if (cards.length > 6) cards[cards.length - 1].remove();
    drawIdeaLines();
  }
  function renderIdeas() {
    let changed = false;
    for (const i of ideas) {
      const card = document.getElementById('idea-' + i.id); const px = M[i.coin].price;
      if (i.status === 'OPEN') {
        const st = E.ideaStatus(i, px);
        if (st !== 'OPEN' || Date.now() - i.created > 30 * 60e3) {
          i.status = st !== 'OPEN' ? st : 'EXPIRED'; i.final = E.ideaPnl(i, px); changed = true;
          log('IDEA', `${i.coin} ${i.side} idea → ${i.status} (${E.sg(i.final)})`, i.final >= 0 ? '#2bf5a0' : '#ff4d6d');
          if (card) { card.classList.add('done'); card.appendChild(el('div', 'stamp ' + i.status, i.status === 'TARGET' ? 'TARGET HIT' : i.status)); }
        }
      }
      if (!card) continue;
      const pnl = i.status === 'OPEN' ? E.ideaPnl(i, px) : i.final;
      const q = r => card.querySelector(`[data-r="${r}"]`);
      const pe = q('pnl'); pe.textContent = E.sg(pnl); pe.className = pnl >= 0 ? 'up' : 'dn';
      if (i.status === 'OPEN') {
        q('px').textContent = E.fmtPx(px);
        // bar: left=stop(0) entry at 1/3, right=target(1)
        const prog = i.side === 'LONG' ? (px - i.stop) / (i.target - i.stop) : (i.stop - px) / (i.stop - i.target);
        q('now').style.left = (Math.max(0, Math.min(1, prog)) * 100) + '%';
        const a = Math.floor((Date.now() - i.created) / 1000); q('age').textContent = a < 60 ? a + 's' : Math.floor(a / 60) + 'm ' + (a % 60) + 's';
      }
    }
    if (changed) drawIdeaLines();
  }

  // ---------- the desk: cycles of analysis + debate ----------
  let cycle = 0;
  function chooseCoin(bot, views) {
    const scored = COINS.map(c => {
      const s = M[c].sig || E.computeSignals(M[c]); const v = views[c][bot.id];
      let score = bot.id === 'atlas' ? (s.vol || 0) * 10 + (paper.some(p => p.coin === c) ? 1 : 0) : v.conv + (v.side !== 'FLAT' ? 0.5 : 0);
      if (c === lastCoins[0]) score -= 0.6; if (c === lastCoins[1]) score -= 0.3;
      return { c, score: score + Math.random() * 0.35 };
    }).sort((a, b) => b.score - a.score);
    return scored[0].c;
  }
  const lastCoins = [];
  async function runCycle() {
    cycle++;
    $('#cycle').textContent = '#' + String(cycle).padStart(4, '0'); bump($('#cycle'));
    const bot = BOTS[(cycle - 1) % BOTS.length];
    const cyc0 = performance.now();
    const prevActive = activeId;
    BOTS.forEach(b => setState(b.id, botState[b.id].watching ? 'watching' : 'idle'));
    setActive(bot.id);
    if (prevActive) sendPacket(prevActive, bot.id, 'HANDOFF');
    setState(bot.id, 'scanning'); stage(0, `<b style="color:${bot.color}">${bot.name}</b> scanning ${COINS.length} markets`);
    const allViews = {}; ALL().forEach(c => { M[c].sig = E.computeSignals(M[c]); allViews[c] = E.evaluateAll(M[c].sig); });
    termPush(bot.id, `> scan --markets ${COINS.length} --tf 1m`, 'cmd');
    log('CYCLE', `#${cycle} ${bot.name} (${bot.role}) takes the desk`, bot.color);
    for (const c of COINS.slice(0, 3).concat(COINS.slice(3)).slice(0, 4)) { const s = M[c].sig; termPush(bot.id, `  ${c.padEnd(4)} rsi ${E.f1(s.rsi)} Δ5m ${E.sg(s.chg5m)}`); await sleep(140); }
    let coin = chooseCoin(bot, allViews);
    const asked = pendingCoin && M[pendingCoin] && M[pendingCoin].price ? pendingCoin : null;
    if (asked) { coin = asked; pendingCoin = null; termPush(bot.id, `> user request: analyze ${coin}`, 'cmd'); }
    lastCoins.unshift(coin); lastCoins.length = 2;
    const panel = document.querySelector(`.mini[data-coin="${coin}"]`);
    await moveCursor(bot, panel || $('#focusPanel'));
    setWatching(bot.id, coin);
    if (Date.now() > pinUntil || coin === focus.coin) setFocus(coin, null, bot); else $('#focusSub').innerHTML = `pinned by <b style="color:var(--cy)">you</b> · <span style="color:${bot.color}">${bot.name}</span> is looking at ${coin} in the background`;
    log('OPEN', `${bot.name} opened ${coin}-PERP chart`, bot.color);
    setState(bot.id, 'analyzing'); stage(1, `<b style="color:${bot.color}">${bot.name}</b> analyzing ${coin} (${bot.role.toLowerCase()})`);
    termPush(bot.id, `> fetch candles ${coin} 1m n=${M[coin].candles.length}`, 'cmd'); await sleep(350);
    termPush(bot.id, `> stream ${coin} 1s · last ${E.fmtPx(M[coin].price)}`, 'cmd'); await sleep(450);
    const tc0 = performance.now();
    const sig = E.computeSignals(M[coin]);
    const views = E.evaluateAll(sig);
    let compMs = performance.now() - tc0;
    for (const l of views[bot.id].lines) { termPush(bot.id, l, 'res'); await sleep(380); }
    const mv = views[bot.id];
    termPush(bot.id, bot.id === 'atlas' ? `> verdict: ${mv.risk}` : `> verdict: ${mv.side} conv=${mv.conv.toFixed(2)}`, 'cmd');
    setView(bot.id, mv);
    const L = ['nova', 'luna', 'echo', 'vex'].filter(i => views[i].side === 'LONG').length, S = ['nova', 'luna', 'echo', 'vex'].filter(i => views[i].side === 'SHORT').length;
    const domSide = mv.side !== 'FLAT' ? mv.side : (L >= S ? 'LONG' : 'SHORT');
    await typing(bot.id, rand(1100, 1800));
    post(bot.id, E.message(bot.id, sig, mv, { side: domSide }));
    setState(bot.id, 'debating'); stage(2, `debate on <b>${coin}</b> · ${bot.name} opened with ${bot.id === 'atlas' ? mv.risk : mv.side}`);
    // debate
    const pool = BOTS.map(b => b.id).filter(i => i !== bot.id);
    const dir = i => i !== 'atlas' && views[i].side !== 'FLAT';
    const chosen = [];
    const opp = pool.filter(i => dir(i) && mv.side !== 'FLAT' && views[i].side !== mv.side);
    const same = pool.filter(i => dir(i) && views[i].side === mv.side);
    if (opp.length) chosen.push(pick(opp));
    if (same.length) chosen.push(pick(same));
    if (bot.id !== 'atlas') chosen.push('atlas');
    while (chosen.length < 2) { const r = pick(pool); if (!chosen.includes(r)) chosen.push(r); }
    if (!chosen.includes('vex') && bot.id !== 'vex' && L + S >= 2 && Math.random() < 0.6) chosen.splice(chosen.length - 1, 0, 'vex');
    for (const r of chosen.slice(0, 4)) {
      setWatching(r, coin); sendPacket(bot.id, r, 'ASK ' + coin); setState(r, 'analyzing');
      termPush(r, `> analyze ${coin} --as ${BOT[r].role.toLowerCase().replace(/ /g, '-')}`, 'cmd');
      await sleep(300);
      for (const l of views[r].lines.slice(0, 2)) { termPush(r, l, 'res'); await sleep(220); }
      setView(r, views[r]);
      await typing(r, rand(1200, 2200));
      setState(r, 'debating'); sendPacket(r, bot.id, r === 'atlas' ? views[r].risk : views[r].side);
      post(r, E.message(r, sig, views[r], { side: domSide, replyTo: { bot: bot.id, side: mv.side } }));
      await sleep(rand(400, 900));
    }
    // paper trades (hypothetical) for bots with conviction
    for (const id of ['nova', 'luna', 'echo', 'vex']) {
      const v = views[id];
      const existing = paper.find(p => p.bot === id && p.coin === coin);
      if (existing && v.side !== 'FLAT' && v.side !== existing.side) closePaper(existing, 'flip');
      if (v.side !== 'FLAT' && v.conv >= 0.5) { if (views.atlas.risk === 'VETO') { if (!existing) atlasVeto(BOT[id].name, coin, [views.atlas.rule || 'VOLATILITY'], views.atlas.why); } else openPaper(id, sig, v, views.atlas.risk); }
    }
    // idea for the user
    stage(3, `consensus check on <b>${coin}</b> · ATLAS risk ${views.atlas.risk}`);
    const tb0 = performance.now();
    const idea = E.buildIdea(sig, views, Date.now());
    compMs += performance.now() - tb0;
    BOTS.forEach(b => setLevel(b.id, views[b.id], coin));
    renderDecision(coin, views, idea && !ideas.some(i => i.coin === coin && i.status === 'OPEN') && Date.now() - lastIdeaAt > 35000 ? idea : null, compMs, performance.now() - cyc0);
    await sleep(700);
    const deskBr = idea ? breakersFor(null, coin) : null;
    if (idea && !deskBr.allowed) atlasVeto('desk idea', coin, deskBr.fired);
    if (idea && deskBr.allowed && !ideas.some(i => i.coin === coin && i.status === 'OPEN') && Date.now() - lastIdeaAt > 35000) {
      idea.ticket = nextTicket();
      idea.size = RK.sizePosition({ equity: REF_EQ, entry: idea.entry, stop: idea.stop, riskScale: idea.risk === 'CAUTION' ? 0.5 : 1, limits });
      lastIdeaAt = Date.now();
      const presenter = idea.agree.includes(bot.id) && bot.id !== 'atlas' ? bot.id : idea.agree[0];
      await typing(presenter, 1500);
      post(presenter, `📌 ${idea.ticket}: ${idea.side} ${coin} @ ${E.fmtPx(idea.entry)}, stop ${E.fmtPx(idea.stop)}, target ${E.fmtPx(idea.target)} (1:2), size ${idea.size.qty.toPrecision(4)} ${coin} ≈ $${idea.size.notional.toFixed(0)} per $10k (risk $${idea.size.riskUsd.toFixed(0)}). Agreed: ${idea.agree.map(i => BOT[i].name).join(', ')}${idea.dissent.length ? '. Dissent: ' + idea.dissent.map(d => BOT[d.bot].name).join(', ') : ''}. Idea only, not advice.`, { idea: true });
      addIdea(idea);
      stage(4, `<b style="color:var(--am)">IDEA PUBLISHED</b> · ${idea.side} ${coin}`);
      BOTS.forEach(b => sendPacket(presenter, b.id, 'IDEA'));
      log('IDEA', `${idea.side} ${coin} @ ${E.fmtPx(idea.entry)} · ${idea.confidence}`, '#fbbf24');
      toast(`<b style="color:var(--am)">✦ New idea:</b> ${idea.side === 'LONG' ? '<span class="up">LONG</span>' : '<span class="dn">SHORT</span>'} <b>${coin}</b> @ ${E.fmtPx(idea.entry)} · <small>paper idea, not financial advice</small>`);
    } else {
      stage(4, `no new idea on ${coin}${views.atlas.risk === 'VETO' ? ' · ATLAS veto' : idea ? ' · already tracking one' : ' · no consensus'}`);
      if (!idea && Math.random() < 0.35) sysMsg(`no consensus on ${coin}${views.atlas.risk === 'VETO' ? ' · ATLAS veto' : ''} · moving on`);
    }
  }
  async function deskLoop() {
    // wait for data
    for (let i = 0; i < 60; i++) { if (COINS.filter(c => M[c].hist && M[c].price).length >= 4) break; await sleep(500); }
    sysMsg('desk online · 5 bots connected to live Hyperliquid data');
    BOTS.forEach(b => { termPush(b.id, `> connect hyperliquid ws ✓`, 'res'); });
    await sleep(800);
    for (;;) {
      try { await runCycle(); } catch (e) { console.error(e); log('ERR', e.message, '#ff4d6d'); }
      await sleep(rand(2000, 3500));
    }
  }
  // idle chatter in terminals (real values)
  function idleTerm() {
    BOTS.forEach(b => {
      if (b.id === activeId || Math.random() < 0.45) return;
      const c = botState[b.id].watching || pick(COINS); const m = M[c]; if (!m || !m.price) return;
      const s = M[c].sig || E.computeSignals(m);
      const lines = {
        nova: () => `> ${c} ema9-ema21 ${E.sg(s.emaSpread, 3)} Δ10s ${E.sg(s.chg10s)}`,
        luna: () => `> ${c} z=${E.f2(s.bollZ)} rsi=${E.f1(s.rsi)}`,
        atlas: () => `> ${c} atr ${E.f2(s.atrPct)}% open paper ${paper.length}`,
        echo: () => `> ${c} flow ${E.sg(s.flowImb * 100, 0)} vol ${E.f2(s.volSpike)}x`,
        vex: () => `> ${c} 24h ${E.sg(s.chg24)} crowd? ${s.rsi > 65 ? 'greedy' : s.rsi < 35 ? 'fearful' : 'meh'}`,
      };
      termPush(b.id, lines[b.id]());
    });
  }

  // ---------- ops: pipeline, network, bus, status, radar, heatmap, decision ----------
  const STAGE_COL = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#2bf5a0'];
  function stage(i, text) {
    document.querySelectorAll('.stg').forEach(s => { const k = +s.dataset.i; s.classList.toggle('on', k === i); s.classList.toggle('done', k < i); s.style.setProperty('--sc', STAGE_COL[k]); });
    $('#plFill').style.width = ((i + 1) / 5 * 100) + '%';
    if (text) $('#plStatus').innerHTML = text;
    $('#plCycle').textContent = '#' + String(cycle).padStart(4, '0');
  }
  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return { g, w: r.width, h: r.height };
  }
  const packets = []; let busCount = 0;
  function sendPacket(from, to, label) {
    if (!from || !to || from === to) return;
    packets.push({ from, to, label, t0: performance.now(), dur: 1200 });
    busCount++; $('#busCount').textContent = busCount; bump($('#busCount'));
    $('#busLast').textContent = `${BOT[from].name} → ${BOT[to].name} · ${label}`;
  }
  function drawShape(g, shape, x, y, r) {
    g.beginPath();
    if (shape === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
    else {
      const pts = shape === 'triangle' ? [[0, -1.05], [1, .8], [-1, .8]] : shape === 'square' ? [[-.85, -.85], [.85, -.85], [.85, .85], [-.85, .85]] : shape === 'diamond' ? [[0, -1.1], [1.1, 0], [0, 1.1], [-1.1, 0]] : [0, 1, 2, 3, 4, 5].map(i => [Math.cos(Math.PI / 3 * i - Math.PI / 2), Math.sin(Math.PI / 3 * i - Math.PI / 2)]);
      pts.forEach((p, i) => i ? g.lineTo(x + p[0] * r, y + p[1] * r) : g.moveTo(x + p[0] * r, y + p[1] * r)); g.closePath();
    }
  }
  function drawBotNode(g, b, x, y, r, active, t) {
    if (active) { const pr = r + 8 + Math.sin(t / 200) * 3; const gr = g.createRadialGradient(x, y, r, x, y, pr + 14); gr.addColorStop(0, b.color + '88'); gr.addColorStop(1, b.color + '00'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, pr + 14, 0, Math.PI * 2); g.fill(); }
    drawShape(g, b.shape, x, y + (b.shape === 'triangle' ? 2 : 0), r);
    const gr = g.createLinearGradient(x - r, y - r, x + r, y + r); gr.addColorStop(0, b.color); gr.addColorStop(1, shade(b.color)); g.fillStyle = gr; g.fill();
    g.lineWidth = active ? 2 : 1; g.strokeStyle = active ? '#fff' : 'rgba(255,255,255,.35)'; g.stroke();
    const blink = (t / 1000 + b.name.length) % 4.5 < 0.12; const ey = y + (b.shape === 'triangle' ? r * .3 : -r * .05);
    g.fillStyle = '#fff'; [-1, 1].forEach(s => { g.beginPath(); g.ellipse(x + s * r * .32, ey, r * .17, blink ? r * .03 : r * .2, 0, 0, Math.PI * 2); g.fill(); });
    if (!blink) { g.fillStyle = '#0b1020'; [-1, 1].forEach(s => { g.beginPath(); g.arc(x + s * r * .32 + r * .04, ey + r * .04, r * .09, 0, Math.PI * 2); g.fill(); }); }
  }
  const edgePhase = {};
  function drawNet(t) {
    const cv = $('#netCanvas'); if (!cv) return; const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + 4, R = Math.min(w * .36, h * .38);
    const pos = {}; BOTS.forEach((b, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; pos[b.id] = [cx + Math.cos(a) * R * 1.25, cy + Math.sin(a) * R]; });
    // edges + flowing particles
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      const a = pos[BOTS[i].id], b = pos[BOTS[j].id], k = i + '-' + j;
      const hot = activeId && (BOTS[i].id === activeId || BOTS[j].id === activeId);
      g.strokeStyle = hot ? 'rgba(160,190,255,.22)' : 'rgba(120,160,255,.08)'; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      if (!edgePhase[k]) edgePhase[k] = [Math.random(), Math.random(), Math.random()];
      edgePhase[k].forEach((ph, n) => {
        const p = ((t / (hot ? 2200 : 5200)) + ph) % 1, dir = n % 2 ? 1 - p : p;
        const x = a[0] + (b[0] - a[0]) * dir, y = a[1] + (b[1] - a[1]) * dir;
        g.fillStyle = (n % 2 ? BOTS[j] : BOTS[i]).color + (hot ? 'cc' : '55'); g.fillRect(x - 1, y - 1, 2, 2);
      });
    }
    // hub
    g.strokeStyle = 'rgba(34,211,238,.25)'; BOTS.forEach(b => { g.setLineDash([2, 4]); g.beginPath(); g.moveTo(cx, cy); g.lineTo(pos[b.id][0], pos[b.id][1]); g.stroke(); }); g.setLineDash([]);
    g.fillStyle = 'rgba(5,7,13,.9)'; g.strokeStyle = 'rgba(34,211,238,.6)'; g.beginPath(); g.arc(cx, cy, 20, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(cx, cy, 24 + (t / 60 % 14), 0, Math.PI * 2); g.strokeStyle = `rgba(34,211,238,${.35 - (t / 60 % 14) / 40})`; g.stroke();
    g.fillStyle = COIN_COLOR[focus.coin] || '#fff'; g.font = "700 10px 'JetBrains Mono',monospace"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(focus.coin, cx, cy);
    // packets
    const now = performance.now();
    packets.forEach(pk => {
      const p = Math.min(1, (now - pk.t0) / pk.dur), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const a = pos[pk.from], b = pos[pk.to]; const mx = (a[0] + b[0]) / 2 + (cy - (a[1] + b[1]) / 2) * .25, my = (a[1] + b[1]) / 2 - (cx - (a[0] + b[0]) / 2) * .25;
      for (let s = 0; s < 6; s++) { const q = Math.max(0, e - s * .03); const x = (1 - q) * (1 - q) * a[0] + 2 * (1 - q) * q * mx + q * q * b[0], y = (1 - q) * (1 - q) * a[1] + 2 * (1 - q) * q * my + q * q * b[1]; g.globalAlpha = 1 - s / 6; g.fillStyle = BOT[pk.from].color; g.beginPath(); g.arc(x, y, 3.5 - s * .45, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    });
    BOTS.forEach(b => {
      const [x, y] = pos[b.id], act = b.id === activeId; drawBotNode(g, b, x, y, act ? 17 : 14, act, t);
      g.font = "700 9px 'JetBrains Mono',monospace"; g.fillStyle = act ? b.color : 'rgba(216,226,255,.6)'; g.textAlign = 'center'; g.fillText(b.name, x, y + 27);
    });
  }
  function drawBus(t) {
    const cv = $('#busCanvas'); if (!cv) return; const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const y = h - 20, pad = 30, xs = {}; BOTS.forEach((b, i) => xs[b.id] = pad + i * (w - 2 * pad) / 4);
    g.strokeStyle = 'rgba(120,160,255,.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(pad - 14, y); g.lineTo(w - pad + 14, y); g.stroke();
    g.setLineDash([3, 6]); g.lineDashOffset = -t / 40; g.strokeStyle = 'rgba(34,211,238,.35)'; g.beginPath(); g.moveTo(pad - 14, y); g.lineTo(w - pad + 14, y); g.stroke(); g.setLineDash([]);
    BOTS.forEach(b => drawBotNode(g, b, xs[b.id], y, b.id === activeId ? 9 : 7.5, b.id === activeId, t));
    const now = performance.now();
    for (let i = packets.length - 1; i >= 0; i--) {
      const pk = packets[i], p = (now - pk.t0) / pk.dur;
      if (p >= 1.15) { packets.splice(i, 1); continue; }
      const q = Math.min(1, p), x = xs[pk.from] + (xs[pk.to] - xs[pk.from]) * q, yy = y - Math.sin(q * Math.PI) * (h - 34) - 2;
      g.fillStyle = BOT[pk.from].color; g.shadowColor = BOT[pk.from].color; g.shadowBlur = 10;
      g.fillRect(x - 5, yy - 4, 10, 8); g.shadowBlur = 0;
      g.font = "600 8.5px 'JetBrains Mono',monospace"; g.textAlign = 'center'; g.fillStyle = 'rgba(230,237,255,.85)'; g.fillText(pk.label, x, yy - 9);
    }
  }
  let frames = 0, fpsT = performance.now();
  function rafLoop(t) {
    frames++; if (t - fpsT >= 1000) { $('#fps').textContent = Math.round(frames * 1000 / (t - fpsT)); frames = 0; fpsT = t; }
    try { drawNet(t); drawBus(t); } catch (e) { }
    requestAnimationFrame(rafLoop);
  }
  // bot status panel
  const bstat = {};
  function buildBotStatus() {
    const w = $('#botStatus');
    BOTS.forEach(b => {
      bstat[b.id] = { state: 'idle', level: 0.08 };
      const r = el('div', 'bs'); r.style.setProperty('--bc', b.color);
      r.innerHTML = `${avatar(b, 'av')}<span class="nm" style="color:${b.color}">${b.name}</span><span class="bar"><i id="bsb-${b.id}" style="background:${b.color};width:8%"></i></span><span class="stt" id="bss-${b.id}">IDLE</span><span class="bs-sub" id="bsx-${b.id}">${esc(b.role)} · waiting</span>`;
      w.appendChild(r);
    });
  }
  function setState(id, state) {
    const s = bstat[id]; if (!s) return; s.state = state;
    const e = document.getElementById('bss-' + id); e.textContent = state.toUpperCase(); e.classList.toggle('act', state !== 'idle' && state !== 'watching');
    document.getElementById('bsb-' + id).classList.toggle('busy', state === 'scanning' || state === 'analyzing' || state === 'debating');
  }
  function setLevel(id, view, coin) {
    const lvl = id === 'atlas' ? ({ OK: .85, CAUTION: .5, VETO: .2 }[view.risk] || .1) : Math.max(.08, view.conv);
    document.getElementById('bsb-' + id).style.width = Math.round(lvl * 100) + '%';
    const v = id === 'atlas' ? 'risk ' + view.risk : view.side + ' · conv ' + view.conv.toFixed(2);
    document.getElementById('bsx-' + id).textContent = `${coin || ''} · ${v}`;
  }
  // radar
  const RADAR_AX = ['MOMENTUM', 'TREND', 'VOLATILITY', 'VOLUME', 'FLOW', 'RSI'];
  function radarVals(s) {
    const th = Math.tanh;
    return [.5 + .5 * th((s.chg5m || 0) / .15), .5 + .5 * th((s.emaSpread || 0) / .05), th((s.vol || 0) / .12), th((s.volSpike || 0) / 1.6), .5 + .5 * (s.flowImb || 0), (s.rsi == null ? 50 : s.rsi) / 100];
  }
  function drawRadar() {
    const cv = $('#radarCanvas'); if (!cv) return; const { g, w, h } = fitCanvas(cv);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + 2, R = Math.min(w, h) / 2 - 30, n = 6;
    const pt = (i, v) => [cx + Math.cos(-Math.PI / 2 + i * 2 * Math.PI / n) * R * v, cy + Math.sin(-Math.PI / 2 + i * 2 * Math.PI / n) * R * v];
    g.strokeStyle = 'rgba(120,160,255,.14)'; g.lineWidth = 1;
    [.25, .5, .75, 1].forEach(r => { g.beginPath(); for (let i = 0; i < n; i++) { const p = pt(i, r); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.closePath(); g.stroke(); });
    g.font = "600 8.5px 'JetBrains Mono',monospace"; g.fillStyle = 'rgba(127,139,176,.9)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < n; i++) { const p = pt(i, 1); g.beginPath(); g.moveTo(cx, cy); g.lineTo(p[0], p[1]); g.stroke(); const q = pt(i, 1.2); g.fillText(RADAR_AX[i], q[0], q[1]); }
    const poly = (coin, alpha, dash) => {
      const s = M[coin].sig; if (!s || !s.ready) return; const v = radarVals(s), col = COIN_COLOR[coin];
      g.beginPath(); v.forEach((x, i) => { const p = pt(i, Math.max(.04, x)); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.closePath();
      g.setLineDash(dash ? [3, 3] : []); g.strokeStyle = col; g.lineWidth = dash ? 1 : 2; g.stroke(); g.setLineDash([]);
      if (!dash) { g.fillStyle = col + alpha; g.fill(); v.forEach((x, i) => { const p = pt(i, Math.max(.04, x)); g.fillStyle = col; g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fill(); }); }
    };
    if (focus.coin !== 'BTC') poly('BTC', '00', true);
    poly(focus.coin, '40', false);
    const s = M[focus.coin].sig;
    $('#radarCoin').innerHTML = `<span style="color:${COIN_COLOR[focus.coin]}">${focus.coin}</span>${focus.coin !== 'BTC' ? ' <span style="color:var(--dim)">vs BTC┄</span>' : ''}`;
    if (s) $('#radarLegend').innerHTML = `<span>Δ5m <b>${E.sg(s.chg5m)}</b></span><span>EMAΔ <b>${E.sg(s.emaSpread, 3)}</b></span><span>σ <b>${E.f2(s.vol)}%</b></span><span>VOLx <b>${E.f2(s.volSpike)}</b></span><span>FLOW <b>${E.sg(s.flowImb * 100, 0)}</b></span><span>RSI <b>${E.f1(s.rsi)}</b></span>`;
  }
  // heatmap
  const HEAT_TF = [['1m', 'chg1m'], ['5m', 'chg5m'], ['15m', 'chg15m'], ['1h', 'chg60m'], ['24h', 'chg24']];
  function drawHeat() {
    const colMax = HEAT_TF.map(([, k]) => Math.max(1e-9, ...ALL().map(c => Math.abs((M[c].sig || {})[k] || 0))));
    let h = '<span></span>' + HEAT_TF.map(([l]) => `<span class="hh">${l}</span>`).join('');
    ALL().forEach(c => {
      h += `<span class="hc" style="color:${COIN_COLOR[c]}">${c}</span>`;
      HEAT_TF.forEach(([, k], j) => {
        const v = (M[c].sig || {})[k]; if (v == null) { h += '<span class="cell">—</span>'; return; }
        const a = .12 + .6 * Math.min(1, Math.abs(v) / colMax[j]);
        h += `<span class="cell" style="background:${v >= 0 ? `rgba(43,245,160,${a})` : `rgba(255,77,109,${a})`}">${v >= 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 1 ? 2 : 1)}</span>`;
      });
    });
    $('#heatmap').innerHTML = h;
  }
  // decision box
  function renderDecision(coin, views, idea, compMs, cycleMs) {
    const dir = ['nova', 'luna', 'echo', 'vex'];
    const L = dir.filter(i => views[i].side === 'LONG'), S = dir.filter(i => views[i].side === 'SHORT');
    const maj = L.length >= S.length ? L : S, side = L.length === S.length ? null : (L.length > S.length ? 'LONG' : 'SHORT');
    const agreement = side ? (maj.length - (side === 'LONG' ? S.length : L.length) * 0.5) / 4 : 0;
    const conv = maj.length ? maj.reduce((a, i) => a + views[i].conv, 0) / maj.length : 0;
    const conf = Math.round(Math.max(0, Math.min(1, agreement * .6 + conv * .4 - (views.atlas.risk === 'VETO' ? .3 : views.atlas.risk === 'CAUTION' ? .1 : 0))) * 100);
    const lag = M[coin].exTs ? Math.max(0, Date.now() - M[coin].exTs) : null;
    const res = idea ? `<span class="side-pill ${idea.side === 'LONG' ? 'L' : 'S'}">IDEA ${idea.side}</span>` : side ? `<span class="side-pill" style="border:1px solid var(--line2);color:var(--mut)">LEAN ${side} · NO IDEA</span>` : `<span class="side-pill" style="border:1px solid var(--line2);color:var(--mut)">NO CONSENSUS</span>`;
    const col = conf >= 60 ? 'var(--up)' : conf >= 35 ? 'var(--am)' : 'var(--mut)';
    const d = $('#decision');
    d.querySelector('.dbody').innerHTML = `<div class="dec-top"><span class="coin" style="color:${COIN_COLOR[coin]}">${coin}</span>${res}<span class="dec-conf">CONFIDENCE<b style="color:${col}">${conf}%</b></span></div>
      <div class="dec-meter"><i style="width:${conf}%;background:${col}"></i></div>
      <div class="dec-votes">${BOTS.map(b => { const v = views[b.id]; const t = b.id === 'atlas' ? v.risk : v.side; const c = t === 'LONG' || t === 'OK' ? 'var(--up)' : t === 'SHORT' || t === 'VETO' ? 'var(--dn)' : t === 'CAUTION' ? 'var(--am)' : 'var(--mut)'; return `<span>${avatar(b, 'av')}<b style="color:${c}">${t}</b></span>`; }).join('')}</div>
      <div class="dec-lat"><span>compute <b>${compMs.toFixed(2)}ms</b></span><span>feed lag <b>${lag == null ? '—' : lag + 'ms'}</b></span><span>cycle <b>${(cycleMs / 1000).toFixed(1)}s</b></span></div>`;
    d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
  }

  // ---------- search any Hyperliquid perp ----------
  async function ensureUniverse() { if (!UNIVERSE.length || Date.now() - uniAt > 60000) await loadCtx(); return UNIVERSE; }
  function addCoin(name) {
    if (!M[name]) {
      if (EXTRA.length >= 10) { const old = EXTRA.find(c => c !== focus.coin && !paper.some(p => p.coin === c) && !ideas.some(i => i.coin === c && i.status === 'OPEN')); if (old) removeCoin(old); }
      M[name] = { coin: name, candles: [], secs: [], cur: null, price: null, prev: null, ctx: {}, seeded: false, hist: false };
      EXTRA.push(name); COIN_COLOR[name] = COIN_COLOR[name] || EXTRA_PAL[(EXTRA.length - 1) % EXTRA_PAL.length];
      const u = UNIVERSE.find(x => x.name === name); if (u) { M[name].ctx = u.ctx; if (u.ctx.midPx) M[name].price = +u.ctx.midPx; }
      if (ws && ws.readyState === 1) for (const sub of [{ type: 'bbo', coin: name }, { type: 'trades', coin: name }, { type: 'candle', coin: name, interval: '1m' }, { type: 'activeAssetCtx', coin: name }, { type: 'l2Book', coin: name }]) ws.send(JSON.stringify({ method: 'subscribe', subscription: sub }));
      log('WS', `subscribed ${name} (bbo/trades/candle/ctx)`, '#2bf5a0');
      loadHistory(name).then(() => { if (focus.coin === name) setFocus(name); renderRsi(); drawHeat(); });
    }
    setFocus(name); pinUntil = Date.now() + 45000;
    $('#focusSub').innerHTML = `pinned by <b style="color:var(--cy)">you</b> · ${name}-PERP live from Hyperliquid · bots will discuss it next`;
    pendingCoin = name;
    sysMsg(`you asked the desk to look at ${name} · next bot on rotation will analyze it`);
    toast(`<b style="color:var(--cy)">⌕ ${esc(name)}-PERP</b> opened · live feed subscribed · bots will discuss it next`);
  }
  function removeCoin(c) {
    const i = EXTRA.indexOf(c); if (i < 0) return; EXTRA.splice(i, 1);
    if (ws && ws.readyState === 1) for (const sub of [{ type: 'bbo', coin: c }, { type: 'trades', coin: c }, { type: 'candle', coin: c, interval: '1m' }, { type: 'activeAssetCtx', coin: c }, { type: 'l2Book', coin: c }]) ws.send(JSON.stringify({ method: 'unsubscribe', subscription: sub }));
    delete M[c];
  }
  function buildSearch() {
    if (!window.makeSearch) return;
    window.makeSearch({
      input: $('#hlInput'), drop: $('#hlDrop'),
      hint: (q, it) => `${it.length} of ${UNIVERSE.length} Hyperliquid perps · ↑↓ to move · Enter to open`,
      source: async q => {
        const U = await ensureUniverse(); const Q = q.toUpperCase();
        const score = u => { const n = u.name.toUpperCase(); return n === Q ? 0 : n.startsWith(Q) ? 1 : n.includes(Q) ? 2 : 9; };
        return U.filter(u => score(u) < 9).sort((a, b) => score(a) - score(b) || (+b.ctx.dayNtlVlm || 0) - (+a.ctx.dayNtlVlm || 0)).slice(0, 12);
      },
      render: u => {
        const px = +u.ctx.midPx || +u.ctx.markPx, ch = u.ctx.prevDayPx ? (px / +u.ctx.prevDayPx - 1) * 100 : null;
        const tracked = M[u.name] ? '<span class="lev" style="color:var(--up)">LIVE</span>' : '';
        return `<span class="badge-ic" style="background:${COIN_COLOR[u.name] || 'var(--cy)'}">${esc(u.name[0])}</span><span class="nm"><b>${esc(u.name)}</b><span class="lev">${u.lev}x</span>${tracked}<small>vol 24h ${E.fmtUsd(+u.ctx.dayNtlVlm)} · OI ${E.fmtUsd((+u.ctx.openInterest || 0) * px)}</small></span><span class="rt">${E.fmtPx(px)}<small class="${ch >= 0 ? 'up' : 'dn'}">${ch == null ? '' : E.sg(ch)}</small></span>`;
      },
      onPick: u => addCoin(u.name),
    });
  }

  // ---------- main loops ----------
  function everySecond() {
    const sec = Math.floor(Date.now() / 1000);
    COINS.forEach(c => { const m = M[c]; roll(m, sec); if (!m.cur && m.price) m.cur = { time: sec, open: m.price, high: m.price, low: m.price, close: m.price, volume: 0, buy: 0, sell: 0 }; renderMini(c); renderTicker(c); });
    EXTRA.forEach(c => { const m = M[c]; roll(m, sec); if (!m.cur && m.price) m.cur = { time: sec, open: m.price, high: m.price, low: m.price, close: m.price, volume: 0, buy: 0, sell: 0 }; });
    renderFocus(false); updateFocusHead(false);
    renderPaper(); renderIdeas();
    tps = tickCount; ticksTotal += tickCount; tickCount = 0; $('#tps').textContent = tps; $('#ticksTot').textContent = ticksTotal.toLocaleString('en-US');
    const up = Math.floor((Date.now() - T0) / 1000);
    $('#uptime').textContent = [up / 3600, (up % 3600) / 60, up % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':');
    $('#clock').textContent = hhmmss();
  }

  function init() {
    buildTickers(); buildMinis(); buildSettings(); renderJournal();
    $('#jExport').onclick = exportJournal; $('#jReset').onclick = resetBook;
    setTimeout(() => paper.forEach(p => { if (!M[p.coin]) { try { addCoin(p.coin); } catch (e) { } } }), 4000); buildBots(); buildFocus(); buildBotStatus(); buildSearch(); requestAnimationFrame(rafLoop);
    if (!LWC) log('ERR', 'chart library failed to load', '#ff4d6d');
    document.querySelectorAll('#tfSwitch button').forEach(b => b.onclick = () => setFocus(focus.coin, b.dataset.tf));
    log('BOOT', 'AI trading desk starting', '#a78bfa');
    loadCtx();
    Promise.all(COINS.map(loadHistory)).then(() => { setFocus(focus.coin); renderRsi(); drawRadar(); drawHeat(); });
    connect();
    setInterval(everySecond, 1000);
    setInterval(() => { renderRsi(); drawRadar(); drawHeat(); }, 3000);
    setInterval(idleTerm, 2600);
    deskLoop();
    window.__desk = { M, ideas, paper, closed, book, journal, get limits() { return limits; }, EXTRA, addCoin, get pendingCoin() { return pendingCoin; }, get cycle() { return cycle; } }; // for debugging
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
