/* Manual demo trading desk for xyz:XYZ100. Pure client-side, no AI. */
(() => {
  'use strict';
  const C = window.DemoCalc;
  const LWC = window.LightweightCharts;
  const API = 'https://api.hyperliquid.xyz/info';
  const WSURL = 'wss://api.hyperliquid.xyz/ws';
  const COIN = 'xyz:XYZ100';
  const SHORT = 'XYZ100';
  const START = 1_000_000;
  const LS_KEY = 'td-demo-xyz100-v1';
  const TFS = { '1m': 12 * 3600e3, '5m': 2 * 86400e3, '15m': 5 * 86400e3, '1h': 14 * 86400e3, '4h': 60 * 86400e3, '1d': 200 * 86400e3 };

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function precision(p) { return p >= 10000 ? 1 : p >= 1000 ? 1 : p >= 100 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : 6; }
  function fmtPx(p) {
    if (!(p > 0) && p !== 0) return '—';
    const d = precision(p);
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtUsd(n, d) {
    if (!isFinite(n)) return '—';
    const dec = d == null ? 2 : d;
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function fmtPct(n, d) {
    if (!isFinite(n)) return '—';
    const dec = d == null ? 2 : d;
    const sign = n > 0 ? '+' : '';
    return sign + n.toFixed(dec) + '%';
  }
  function clsPnL(n) { return n > 0 ? 'up' : n < 0 ? 'dn' : ''; }
  function nowIso() { return new Date().toISOString(); }
  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' UTC+5';
    } catch (e) { return iso; }
  }

  const mkt = {
    mark: null, mid: null, bid: null, ask: null, funding: null, prevDay: null,
    maxLev: 30, szDecimals: 4, dayNtl: null, oracle: null
  };
  let book = { balance: START, positions: [], pending: [], history: [], seq: 1 };
  let tf = '15m';
  let candles = [];
  let form = { side: 'long', typ: 'market', sizeMode: 'margin' };
  let preview = null;
  let lastPlanKey = '';
  const tpSrc = { tp: null, sl: null }; // 'px' | 'pct'
  let chart, series, volSeries, priceLines = [];
  let ws, wsBackoff = 1000, lastMsg = 0, pollTimer = null, candleSub = null;

  function defaultBook() { return { balance: START, positions: [], pending: [], history: [], seq: 1 }; }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (typeof j.balance === 'number' && Array.isArray(j.positions)) book = Object.assign(defaultBook(), j);
    } catch (e) { book = defaultBook(); }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(book)); } catch (e) { /* quota */ }
  }
  function nextId(prefix) {
    const id = prefix + String(book.seq).padStart(3, '0');
    book.seq += 1;
    return id;
  }

  function usedMargin() { return book.positions.reduce((s, p) => s + (p.margin || 0), 0); }
  function upnlTotal(px) {
    const mark = px || lastPx();
    return book.positions.reduce((s, p) => s + C.unrealized(p.side, p.entry, mark, p.qty), 0);
  }
  function lastPx() { return mkt.mark || mkt.mid || mkt.ask || mkt.bid || null; }
  function equity() { return book.balance + upnlTotal(); }
  function freeMargin() { return book.balance - usedMargin(); }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function setFeed(txt, cls) {
    const f = $('#feed');
    f.textContent = txt;
    f.className = cls;
    $('#livePill').classList.toggle('off', cls === 'bad');
    $('#liveTxt').textContent = cls === 'bad' ? 'OFFLINE' : 'LIVE';
  }

  function applyCtx(ctx) {
    if (!ctx) return;
    if (ctx.markPx != null) mkt.mark = +ctx.markPx;
    if (ctx.midPx != null) mkt.mid = +ctx.midPx;
    if (ctx.oraclePx != null) mkt.oracle = +ctx.oraclePx;
    if (ctx.funding != null) mkt.funding = +ctx.funding;
    if (ctx.prevDayPx != null) mkt.prevDay = +ctx.prevDayPx;
    if (ctx.dayNtlVlm != null) mkt.dayNtl = +ctx.dayNtlVlm;
    if (Array.isArray(ctx.impactPxs) && ctx.impactPxs.length >= 2) {
      mkt.bid = +ctx.impactPxs[0];
      mkt.ask = +ctx.impactPxs[1];
    }
    onPrice();
  }

  async function info(body) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function loadMeta() {
    const data = await info({ type: 'metaAndAssetCtxs', dex: 'xyz' });
    const meta = data[0], ctxs = data[1];
    const i = (meta.universe || []).findIndex(u => u.name === COIN);
    if (i < 0) throw new Error('xyz:XYZ100 not found');
    const u = meta.universe[i];
    mkt.maxLev = +u.maxLeverage || 30;
    mkt.szDecimals = u.szDecimals == null ? 4 : +u.szDecimals;
    const sl = $('#inpLev');
    sl.max = String(mkt.maxLev);
    if (+sl.value > mkt.maxLev) sl.value = String(mkt.maxLev);
    $('#levMaxHint').textContent = 'max ' + mkt.maxLev + 'x';
    $('#stLev').textContent = mkt.maxLev + 'x';
    applyCtx(ctxs[i]);
  }

  async function loadCandles(interval) {
    const span = TFS[interval] || TFS['15m'];
    let data = null, lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        data = await info({ type: 'candleSnapshot', req: { coin: COIN, interval, startTime: Date.now() - span } });
        if (Array.isArray(data) && data.length) break;
      } catch (e) { lastErr = e; }
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
    if (!Array.isArray(data) || !data.length) throw lastErr || new Error('empty candleSnapshot');
    candles = data.map(d => ({
      time: Math.floor(d.t / 1000),
      open: +d.o, high: +d.h, low: +d.l, close: +d.c, volume: +d.v
    }));
    renderChart(true);
    setTimeout(() => renderChart(true), 120);
  }

  function upsertCandle(bar) {
    const last = candles[candles.length - 1];
    if (last && last.time === bar.time) {
      last.open = bar.open; last.high = Math.max(last.high, bar.high); last.low = Math.min(last.low, bar.low);
      last.close = bar.close; last.volume = bar.volume;
    } else if (!last || bar.time > last.time) {
      candles.push(bar);
      if (candles.length > 800) candles.shift();
    }
    if (series) {
      series.update(bar);
      if (volSeries) volSeries.update({ time: bar.time, value: bar.volume || 0, color: bar.close >= bar.open ? 'rgba(43,245,160,.35)' : 'rgba(255,77,109,.35)' });
    }
  }

  function connect() {
    setFeed('connecting…', 'warn');
    try { ws = new WebSocket(WSURL); } catch (e) { scheduleReconnect(); return; }
    ws.onopen = () => {
      wsBackoff = 1000;
      setFeed('WS live', 'ok');
      subscribeTf(tf, true);
      startWatchdog();
      stopPoll();
    };
    ws.onmessage = ev => {
      lastMsg = Date.now();
      let j; try { j = JSON.parse(ev.data); } catch (e) { return; }
      const d = j.data;
      if (j.channel === 'pong' || j.channel === 'subscriptionResponse') return;
      if (j.channel === 'bbo' && d && d.bbo && d.bbo[0] && d.bbo[1]) {
        mkt.bid = +d.bbo[0].px; mkt.ask = +d.bbo[1].px;
        mkt.mid = (mkt.bid + mkt.ask) / 2;
        onPrice();
      } else if (j.channel === 'trades' && Array.isArray(d) && d.length) {
        const last = d[d.length - 1];
        if (+last.px > 0 && !mkt.mark) mkt.mid = +last.px;
        onPrice();
      } else if (j.channel === 'candle' && d && (d.s === COIN || d.s === SHORT)) {
        if (d.i && d.i !== tf) return;
        upsertCandle({ time: d.t / 1000, open: +d.o, high: +d.h, low: +d.l, close: +d.c, volume: +d.v });
      } else if (j.channel === 'activeAssetCtx' && d && d.ctx) {
        applyCtx(d.ctx);
      }
    };
    ws.onclose = () => { setFeed('reconnecting…', 'warn'); scheduleReconnect(); };
    ws.onerror = () => { /* onclose follows */ };
  }
  function subscribeTf(interval, alsoBase) {
    if (!ws || ws.readyState !== 1) return;
    if (candleSub && candleSub !== interval) {
      ws.send(JSON.stringify({ method: 'unsubscribe', subscription: { type: 'candle', coin: COIN, interval: candleSub } }));
    }
    if (alsoBase) {
      ['bbo', 'trades', 'activeAssetCtx'].forEach(type => {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type, coin: COIN } }));
      });
    }
    ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: COIN, interval } }));
    candleSub = interval;
  }
  function scheduleReconnect() {
    startPoll();
    setTimeout(connect, wsBackoff);
    wsBackoff = Math.min(wsBackoff * 2, 15000);
  }
  function startWatchdog() {
    if (startWatchdog._ping) return;
    startWatchdog._ping = setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"method":"ping"}'); }, 30000);
    startWatchdog._wd = setInterval(() => {
      if (ws && ws.readyState === 1 && lastMsg && Date.now() - lastMsg > 20000) {
        try { ws.close(); } catch (e) { /* */ }
      }
    }, 5000);
  }
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const mids = await info({ type: 'allMids', dex: 'xyz' });
        const px = mids && (mids[COIN] != null ? +mids[COIN] : null);
        if (px > 0) { mkt.mid = px; if (!mkt.mark) mkt.mark = px; }
        try { await loadMeta(); } catch (e) { /* keep last */ }
        setFeed('REST poll', 'warn');
        onPrice();
      } catch (e) { setFeed('offline', 'bad'); }
    }, 2500);
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function buildChart() {
    if (!LWC || chart) return;
    const el = $('#focusChart');
    chart = LWC.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7f8bb0', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
      grid: { vertLines: { color: 'rgba(120,160,255,.05)' }, horzLines: { color: 'rgba(120,160,255,.05)' } },
      rightPriceScale: { borderColor: 'rgba(120,160,255,.15)', scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: { borderColor: 'rgba(120,160,255,.15)', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      crosshair: { mode: 0, vertLine: { color: 'rgba(34,211,238,.4)', labelBackgroundColor: '#0e7490' }, horzLine: { color: 'rgba(34,211,238,.4)', labelBackgroundColor: '#0e7490' } }
    });
    series = chart.addCandlestickSeries({ upColor: '#2bf5a0', downColor: '#ff4d6d', wickUpColor: '#2bf5a0', wickDownColor: '#ff4d6d', borderVisible: false });
    volSeries = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  }
  function renderChart(fit) {
    if (!series) return;
    const d = precision(lastPx() || 1000);
    series.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: Math.pow(10, -d) } });
    series.setData(candles);
    if (volSeries) {
      volSeries.setData(candles.map(b => ({ time: b.time, value: b.volume || 0, color: b.close >= b.open ? 'rgba(43,245,160,.35)' : 'rgba(255,77,109,.35)' })));
    }
    drawLines();
    if (fit && chart && candles.length) chart.timeScale().fitContent();
  }
  function drawLines() {
    if (!series) return;
    priceLines.forEach(l => { try { series.removePriceLine(l); } catch (e) { /* */ } });
    priceLines = [];
    function add(price, color, title, style) {
      if (!(price > 0)) return;
      const line = series.createPriceLine({
        price, color, lineWidth: 1, lineStyle: style == null ? LWC.LineStyle.Dashed : style,
        axisLabelVisible: true, title
      });
      priceLines.push(line);
    }
    // Preview levels
    if (preview && preview.ok) {
      add(preview.entry, '#22d3ee', 'вход', LWC.LineStyle.Dotted);
      if (preview.tp) add(preview.tp.price, '#2bf5a0', 'TP');
      if (preview.sl) add(preview.sl.price, '#ff4d6d', 'SL');
      add(preview.liq, '#fb923c', 'liq ≈');
    }
    book.positions.forEach(p => {
      const tag = p.id;
      add(p.entry, p.side === 'short' ? '#fb7185' : '#4ade80', tag + ' вход', LWC.LineStyle.Solid);
      if (p.tp) add(p.tp, '#2bf5a0', tag + ' TP');
      if (p.sl) add(p.sl, '#ff4d6d', tag + ' SL');
      if (p.liq) add(p.liq, '#fb923c', tag + ' liq');
    });
  }

  function plannedEntry() {
    const limit = +$('#inpLimit').value;
    return C.entryFromBook(form.side, form.typ, limit, mkt.bid, mkt.ask, mkt.mid, mkt.mark);
  }
  function previewEntry() {
    if (form.typ === 'limit') {
      const limit = +$('#inpLimit').value;
      if (limit > 0) return limit;
    }
    return plannedEntry() || lastPx();
  }

  function syncLinked(which, from) {
    const entry = previewEntry();
    if (!(entry > 0)) return;
    tpSrc[which] = from;
    if (which === 'tp' && from === 'pct') {
      const pct = +$('#inpTpPct').value;
      if (isFinite(pct)) {
        const px = C.favorablePrice(form.side, entry, pct);
        if (px > 0) $('#inpTpPx').value = fmtPlain(px);
      }
    } else if (which === 'tp' && from === 'px') {
      const px = +$('#inpTpPx').value;
      const fav = C.favorablePct(form.side, entry, px);
      if (fav != null) $('#inpTpPct').value = trimNum(fav);
    } else if (which === 'sl' && from === 'pct') {
      const pct = +$('#inpSlPct').value;
      if (isFinite(pct)) {
        const px = C.adversePrice(form.side, entry, pct);
        if (px > 0) $('#inpSlPx').value = fmtPlain(px);
      }
    } else if (which === 'sl' && from === 'px') {
      const px = +$('#inpSlPx').value;
      const fav = C.favorablePct(form.side, entry, px);
      if (fav != null) $('#inpSlPct').value = trimNum(-fav);
    }
  }
  function refreshLinkedFromEntry() {
    if (tpSrc.tp === 'pct' && $('#inpTpPct').value !== '') syncLinked('tp', 'pct');
    else if ($('#inpTpPx').value !== '') syncLinked('tp', 'px');
    if (tpSrc.sl === 'pct' && $('#inpSlPct').value !== '') syncLinked('sl', 'pct');
    else if ($('#inpSlPx').value !== '') syncLinked('sl', 'px');
  }
  function fmtPlain(p) {
    const d = Math.max(precision(p), 1);
    return String(Number(p.toFixed(d)));
  }
  function trimNum(n) {
    if (!isFinite(n)) return '';
    return String(Number(n.toFixed(4)));
  }

  function updateCalc() {
    const entry = previewEntry();
    const sizeUsd = +$('#inpSize').value;
    const leverage = +$('#inpLev').value;
    $('#levVal').textContent = leverage + 'x';
    const tp = +$('#inpTpPx').value || null;
    const sl = +$('#inpSlPx').value || null;
    preview = C.plan({
      side: form.side, sizeUsd, sizeMode: form.sizeMode, leverage,
      entry, maxLeverage: mkt.maxLev, szDecimals: mkt.szDecimals, feeRate: C.TAKER, tp, sl
    });
    const g = $('#calcGrid');
    const err = $('#orderErr');
    const btn = $('#btnOpen');
    if (!preview.ok) {
      const map = {
        'no-entry': 'Жду живую цену…',
        'no-size': 'Укажи размер в USD',
        'no-leverage': 'Укажи плечо',
        'leverage-max': 'Плечо выше максимума рынка (' + mkt.maxLev + 'x)',
        'qty-zero': 'Размер слишком маленький для шага контракта'
      };
      g.innerHTML = '<div class="kv wide"><span>статус</span><b>' + esc(map[preview.error] || preview.error || '—') + '</b></div>';
      $('#scTable tbody').innerHTML = '';
      btn.disabled = true;
      err.hidden = true;
      drawLines();
      return;
    }
    const need = preview.margin + preview.openFee;
    const free = freeMargin();
    const blocked = need > free + 1e-8;
    const rows = [
      ['Размер позиции', fmtUsd(preview.notional, 2)],
      ['Маржа', fmtUsd(preview.margin, 2)],
      ['Цена входа', fmtPx(preview.entry)],
      ['Кол-во контрактов', preview.qty.toFixed(mkt.szDecimals)],
      ['Ликвидация ≈', fmtPx(preview.liq)],
      ['Комиссия входа', fmtUsd(preview.openFee, 2)],
      ['Комиссии туда-обратно ≈', fmtUsd(preview.feesRoundTripAtEntry, 2)]
    ];
    if (preview.tp) {
      rows.push(['P&L при TP', fmtUsd(preview.tp.net, 2) + '  ·  ROE ' + fmtPct(preview.tp.roe)]);
    }
    if (preview.sl) {
      rows.push(['P&L при SL', fmtUsd(preview.sl.net, 2) + '  ·  ROE ' + fmtPct(preview.sl.roe)]);
    }
    if (preview.rr != null) rows.push(['Risk / Reward', preview.rr.toFixed(2) + 'R']);
    g.innerHTML = rows.map((r, i) => {
      const wide = r[0].indexOf('P&L') >= 0 || r[0].indexOf('Risk') >= 0 || r[0].indexOf('туда') >= 0;
      let val = r[1];
      let extra = '';
      if (r[0].indexOf('при TP') >= 0) extra = clsPnL(preview.tp.net);
      if (r[0].indexOf('при SL') >= 0) extra = clsPnL(preview.sl.net);
      return '<div class="kv' + (wide ? ' wide' : '') + '"><span>' + esc(r[0]) + '</span><b class="' + extra + '">' + esc(val) + '</b></div>';
    }).join('');
    const tb = $('#scTable tbody');
    tb.innerHTML = preview.scenarios.map(s =>
      '<tr><td>' + esc(s.label) + '</td><td>' + fmtPx(s.price) + '</td><td class="' + clsPnL(s.net) + '">' + fmtUsd(s.net, 2) + '</td><td class="' + clsPnL(s.roe) + '">' + fmtPct(s.roe) + '</td></tr>'
    ).join('');
    if (blocked) {
      err.hidden = false;
      err.textContent = 'Недостаточно свободной маржи: нужно ' + fmtUsd(need) + ', свободно ' + fmtUsd(free) + '.';
      btn.disabled = true;
    } else {
      err.hidden = true;
      btn.disabled = false;
    }
    const key = [form.side, preview.entry, preview.liq, tp, sl, book.positions.length].join('|');
    if (key !== lastPlanKey) { lastPlanKey = key; drawLines(); }
  }

  function renderAccount() {
    const px = lastPx();
    const u = upnlTotal(px);
    const eq = book.balance + u;
    const free = freeMargin();
    $('#hdrBal').textContent = fmtUsd(book.balance);
    $('#hdrEq').textContent = fmtUsd(eq);
    $('#hdrEq').className = clsPnL(eq - START);
    $('#hdrFree').textContent = fmtUsd(free);
    $('#hdrUpnl').textContent = fmtUsd(u);
    $('#hdrUpnl').className = clsPnL(u);
    if (px > 0) {
      $('#stMark').textContent = fmtPx(mkt.mark || px);
      $('#stMid').textContent = fmtPx(mkt.mid || px);
      $('#focusPx').textContent = fmtPx(mkt.mark || px);
      if (mkt.prevDay > 0) {
        const chg = ((px / mkt.prevDay) - 1) * 100;
        $('#stChg').textContent = fmtPct(chg);
        $('#stChg').className = clsPnL(chg);
        const chip = $('#focusChg');
        chip.textContent = fmtPct(chg);
        chip.className = 'chg ' + (chg >= 0 ? 'bg-up' : 'bg-dn');
      }
    }
    if (mkt.funding != null) {
      const f = mkt.funding * 100;
      const fd = Math.abs(f) < 0.001 ? 6 : 4;
      $('#stFund').textContent = f.toFixed(fd) + '%';
      $('#stFund').className = f > 0 ? 'up' : f < 0 ? 'dn' : '';
    }
    if (mkt.dayNtl != null) {
      const v = mkt.dayNtl;
      $('#stVol').textContent = v >= 1e6 ? ('$' + (v / 1e6).toFixed(2) + 'M') : fmtUsd(v, 0);
    }
    $('#stLev').textContent = mkt.maxLev + 'x';
    const chips = [];
    if (mkt.bid && mkt.ask) chips.push('<span class="chip">bid <b>' + fmtPx(mkt.bid) + '</b></span><span class="chip">ask <b>' + fmtPx(mkt.ask) + '</b></span>');
    if (mkt.oracle) chips.push('<span class="chip">oracle <b>' + fmtPx(mkt.oracle) + '</b></span>');
    chips.push('<span class="chip">fee <b>0.045%</b> taker</span>');
    chips.push('<span class="chip">isolated · MM≈' + (C.mmRatio(mkt.maxLev) * 100).toFixed(3) + '%</span>');
    $('#focusChips').innerHTML = chips.join('');
  }

  function renderPositions() {
    const px = lastPx();
    $('#posCount').textContent = String(book.positions.length);
    const body = $('#posBody');
    if (!book.positions.length) {
      body.innerHTML = '<tr class="ph"><td colspan="10">нет открытых позиций</td></tr>';
    } else {
      body.innerHTML = book.positions.map(p => {
        const u = C.unrealized(p.side, p.entry, px, p.qty);
        const roe = C.roePct(u, p.margin);
        return '<tr data-id="' + esc(p.id) + '">' +
          '<td>' + esc(p.id) + '</td>' +
          '<td><span class="side-pill ' + p.side + '">' + (p.side === 'short' ? 'SHORT' : 'LONG') + '</span> ' + p.leverage + 'x</td>' +
          '<td>' + p.qty.toFixed(mkt.szDecimals) + ' · ' + fmtUsd(p.qty * (px || p.entry), 0) + '</td>' +
          '<td>' + fmtPx(p.entry) + '</td>' +
          '<td>' + fmtPx(px) + '</td>' +
          '<td>' + fmtPx(p.liq) + '</td>' +
          '<td class="' + clsPnL(u) + '">' + fmtUsd(u) + '</td>' +
          '<td class="' + clsPnL(roe) + '">' + fmtPct(roe) + '</td>' +
          '<td><div class="edit-tpsl">' +
            '<input data-ed="tp" title="TP" placeholder="TP" value="' + (p.tp ? esc(fmtPlain(p.tp)) : '') + '">' +
            '<input data-ed="sl" title="SL" placeholder="SL" value="' + (p.sl ? esc(fmtPlain(p.sl)) : '') + '">' +
          '</div></td>' +
          '<td><div class="pos-actions"><button type="button" class="close" data-act="close">Закрыть</button></div></td>' +
          '</tr>';
      }).join('');
    }
    const pend = $('#pendPanel');
    if (!book.pending.length) {
      pend.hidden = true;
    } else {
      pend.hidden = false;
      $('#pendCount').textContent = String(book.pending.length);
      $('#pendBody').innerHTML = book.pending.map(o =>
        '<tr data-id="' + esc(o.id) + '">' +
        '<td>' + esc(o.id) + '</td>' +
        '<td><span class="side-pill ' + o.side + '">' + (o.side === 'short' ? 'SHORT' : 'LONG') + '</span></td>' +
        '<td>' + fmtPx(o.limit) + '</td>' +
        '<td>' + esc(o.sizeMode === 'notional' ? 'позиция ' : 'маржа ') + fmtUsd(o.sizeUsd) + '</td>' +
        '<td>' + o.leverage + 'x</td>' +
        '<td>' + (o.tp ? fmtPx(o.tp) : '—') + ' / ' + (o.sl ? fmtPx(o.sl) : '—') + '</td>' +
        '<td><button type="button" class="mini-btn kill" data-act="cancel">Отмена</button></td>' +
        '</tr>'
      ).join('');
    }
    const hb = $('#histBody');
    if (!book.history.length) {
      hb.innerHTML = '<tr class="ph"><td colspan="7">история пуста</td></tr>';
    } else {
      hb.innerHTML = book.history.slice().reverse().slice(0, 80).map(h =>
        '<tr>' +
        '<td>' + esc(fmtTime(h.closedAt)) + '</td>' +
        '<td>' + esc(h.id) + '</td>' +
        '<td><span class="side-pill ' + h.side + '">' + (h.side === 'short' ? 'SHORT' : 'LONG') + '</span></td>' +
        '<td>' + fmtPx(h.entry) + ' → ' + fmtPx(h.exit) + '</td>' +
        '<td>' + esc(reasonRu(h.reason)) + '</td>' +
        '<td class="' + clsPnL(h.net) + '">' + fmtUsd(h.net) + '</td>' +
        '<td class="' + clsPnL(h.roe) + '">' + fmtPct(h.roe) + '</td>' +
        '</tr>'
      ).join('');
    }
  }
  function reasonRu(r) {
    return ({ market: 'Market close', tp: 'Take Profit', sl: 'Stop Loss', liquidation: 'Ликвидация ≈', limit: 'Limit fill' }[r] || r);
  }

  function onPrice() {
    renderAccount();
    checkExits();
    fillPending();
    updateCalc();
    renderPositions();
  }

  function fillPending() {
    if (!book.pending.length) return;
    const left = [];
    let changed = false;
    book.pending.forEach(o => {
      if (C.limitFillable(o.side, o.limit, mkt.bid, mkt.ask, lastPx())) {
        const entry = C.entryFromBook(o.side, 'limit', o.limit, mkt.bid, mkt.ask, mkt.mid, mkt.mark) || o.limit;
        const res = openPosition(Object.assign({}, o, { typ: 'limit', entryHint: entry }), true);
        if (res === true) { toast(o.id + ' исполнен по ' + fmtPx(entry)); changed = true; }
        else { left.push(o); }
      } else left.push(o);
    });
    if (changed || left.length !== book.pending.length) { book.pending = left; save(); }
  }

  function checkExits() {
    const px = lastPx();
    if (!(px > 0) || !book.positions.length) return;
    const keep = [];
    let changed = false;
    book.positions.forEach(p => {
      const hit = C.hitLevel(p.side, px, p.tp, p.sl, p.liq);
      if (hit) {
        const exit = hit === 'liquidation' && p.liq > 0 ? p.liq : px;
        closePosition(p, exit, hit, false);
        changed = true;
        toast(p.id + ' · ' + reasonRu(hit) + ' @ ' + fmtPx(exit));
      } else keep.push(p);
    });
    if (changed) { book.positions = keep; save(); renderAccount(); }
  }

  function openPosition(spec, fromPending) {
    const entry = spec.entryHint || plannedEntry();
    if (!(entry > 0)) return 'Нет цены для входа';
    const p = C.plan({
      side: spec.side, sizeUsd: spec.sizeUsd, sizeMode: spec.sizeMode, leverage: spec.leverage,
      entry, maxLeverage: mkt.maxLev, szDecimals: mkt.szDecimals, feeRate: C.TAKER, tp: spec.tp, sl: spec.sl
    });
    if (!p.ok) return 'Нельзя рассчитать ордер';
    if (p.margin + p.openFee > freeMargin() + 1e-8) return 'Недостаточно свободной маржи';
    book.balance -= p.openFee;
    const pos = {
      id: spec.id || nextId('D-'),
      side: p.side,
      qty: p.qty,
      entry: p.entry,
      margin: p.margin,
      leverage: p.leverage,
      notional: p.notional,
      openFee: p.openFee,
      liq: p.liq,
      tp: spec.tp > 0 ? +spec.tp : null,
      sl: spec.sl > 0 ? +spec.sl : null,
      openedAt: nowIso()
    };
    book.positions.push(pos);
    if (!fromPending) save();
    return true;
  }

  function closePosition(p, exitPx, reason, remove) {
    let exit = +exitPx;
    if (!(exit > 0)) return;
    const cap = reason === 'liquidation' && exit && p.liq ? p.liq : exit;
    const raw = C.closePnl({ side: p.side, entry: p.entry, exit: cap, qty: p.qty, openFee: p.openFee, feeRate: C.TAKER });
    // Isolated: cannot lose more than margin after the already-paid open fee.
    let net = raw.net;
    if (net < -p.margin) net = -p.margin;
    book.balance += (raw.pricePnl - raw.closeFee);
    // If clamped, pull balance back so the isolated loss equals margin.
    const realizedWithoutOpen = raw.pricePnl - raw.closeFee;
    if (raw.net < -p.margin) {
      // raw.net = realizedWithoutOpen - openFee, we wanted net = -margin
      // so realizedWithoutOpen should be -margin + openFee
      book.balance -= realizedWithoutOpen;
      book.balance += (-p.margin + p.openFee);
      net = -p.margin;
    }
    const rec = {
      id: p.id, side: p.side, qty: p.qty, entry: p.entry, exit: cap,
      leverage: p.leverage, margin: p.margin, reason,
      pricePnl: raw.pricePnl, closeFee: raw.closeFee, openFee: p.openFee,
      net, roe: C.roePct(net, p.margin),
      openedAt: p.openedAt, closedAt: nowIso()
    };
    book.history.push(rec);
    if (remove !== false) {
      book.positions = book.positions.filter(x => x !== p && x.id !== p.id);
      save();
    }
  }

  function placeOrder() {
    const sizeUsd = +$('#inpSize').value;
    const leverage = +$('#inpLev').value;
    const tp = +$('#inpTpPx').value || null;
    const sl = +$('#inpSlPx').value || null;
    const spec = { side: form.side, typ: form.typ, sizeMode: form.sizeMode, sizeUsd, leverage, tp, sl };
    if (form.typ === 'limit') {
      const limit = +$('#inpLimit').value;
      if (!(limit > 0)) { $('#orderErr').hidden = false; $('#orderErr').textContent = 'Укажи цену лимита'; return; }
      spec.limit = limit;
      const entry = C.entryFromBook(form.side, 'limit', limit, mkt.bid, mkt.ask, mkt.mid, mkt.mark);
      if (entry == null) {
        const p = C.plan({ side: form.side, sizeUsd, sizeMode: form.sizeMode, leverage, entry: limit, maxLeverage: mkt.maxLev, szDecimals: mkt.szDecimals, feeRate: C.TAKER, tp, sl });
        if (!p.ok) { $('#orderErr').hidden = false; $('#orderErr').textContent = 'Нельзя поставить ордер'; return; }
        if (p.margin + p.openFee > freeMargin() + 1e-8) { $('#orderErr').hidden = false; $('#orderErr').textContent = 'Недостаточно свободной маржи, чтобы зарезервировать лимит'; return; }
        const o = Object.assign({ id: nextId('L-'), limit }, spec);
        book.pending.push(o);
        save();
        toast('Лимитный ордер ' + o.id + ' принят @ ' + fmtPx(limit));
        renderPositions();
        return;
      }
      spec.entryHint = entry;
    }
    const res = openPosition(spec, false);
    if (res !== true) {
      $('#orderErr').hidden = false;
      $('#orderErr').textContent = res;
      return;
    }
    toast('Позиция открыта @ ' + fmtPx(spec.entryHint || plannedEntry()));
    onPrice();
  }

  function resetAccount() {
    if (!confirm('Сбросить демо-счёт до $1,000,000 и очистить позиции и историю?')) return;
    book = defaultBook();
    save();
    toast('Счёт сброшен · $1,000,000');
    onPrice();
    renderChart(false);
  }

  function bind() {
    $('#btnLong').onclick = () => setSide('long');
    $('#btnShort').onclick = () => setSide('short');
    $('#btnMkt').onclick = () => setTyp('market');
    $('#btnLmt').onclick = () => setTyp('limit');
    $('#btnMargin').onclick = () => setMode('margin');
    $('#btnNotional').onclick = () => setMode('notional');
    $('#inpLev').addEventListener('input', () => { $('#levVal').textContent = $('#inpLev').value + 'x'; refreshLinkedFromEntry(); updateCalc(); });
    $('#inpSize').addEventListener('input', updateCalc);
    $('#inpLimit').addEventListener('input', () => { refreshLinkedFromEntry(); updateCalc(); });
    $('#inpTpPx').addEventListener('input', () => { syncLinked('tp', 'px'); updateCalc(); });
    $('#inpTpPct').addEventListener('input', () => { syncLinked('tp', 'pct'); updateCalc(); });
    $('#inpSlPx').addEventListener('input', () => { syncLinked('sl', 'px'); updateCalc(); });
    $('#inpSlPct').addEventListener('input', () => { syncLinked('sl', 'pct'); updateCalc(); });
    $('#quickSize').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-q]');
      if (!b) return;
      $('#inpSize').value = b.dataset.q;
      $$('#quickSize button').forEach(x => x.classList.toggle('on', x === b));
      updateCalc();
    });
    $('#btnOpen').onclick = placeOrder;
    $('#btnReset').onclick = resetAccount;
    $('#tfSwitch').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-tf]');
      if (!b || b.dataset.tf === tf) return;
      tf = b.dataset.tf;
      $$('#tfSwitch button').forEach(x => x.classList.toggle('on', x === b));
      loadCandles(tf).then(() => subscribeTf(tf, false)).catch(e => toast('Не удалось загрузить свечи: ' + e.message));
    });
    $('#posTable').addEventListener('click', ev => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      const p = book.positions.find(x => x.id === tr.dataset.id);
      if (!p) return;
      if (ev.target.closest('[data-act="close"]')) {
        const px = lastPx();
        if (!(px > 0)) return toast('Нет цены для закрытия');
        closePosition(p, px, 'market', true);
        toast(p.id + ' закрыт @ ' + fmtPx(px));
        onPrice();
      }
    });
    $('#posTable').addEventListener('change', ev => {
      const inp = ev.target.closest('input[data-ed]');
      if (!inp) return;
      const tr = inp.closest('tr[data-id]');
      const p = book.positions.find(x => x.id === tr.dataset.id);
      if (!p) return;
      const v = inp.value === '' ? null : +inp.value;
      if (v != null && !(v > 0)) return;
      p[inp.dataset.ed] = v;
      save();
      drawLines();
      toast(p.id + ' · ' + inp.dataset.ed.toUpperCase() + (v ? ' = ' + fmtPx(v) : ' снят'));
    });
    $('#pendTable').addEventListener('click', ev => {
      if (!ev.target.closest('[data-act="cancel"]')) return;
      const tr = ev.target.closest('tr[data-id]');
      book.pending = book.pending.filter(o => o.id !== tr.dataset.id);
      save();
      toast('Ордер отменён');
      renderPositions();
    });
  }
  function setSide(s) {
    form.side = s;
    $('#btnLong').classList.toggle('on', s === 'long');
    $('#btnShort').classList.toggle('on', s === 'short');
    const go = $('#btnOpen');
    go.textContent = s === 'short' ? 'Открыть Short' : 'Открыть Long';
    go.classList.toggle('short', s === 'short');
    refreshLinkedFromEntry();
    updateCalc();
  }
  function setTyp(t) {
    form.typ = t;
    $('#btnMkt').classList.toggle('on', t === 'market');
    $('#btnLmt').classList.toggle('on', t === 'limit');
    $('#limitFld').hidden = t !== 'limit';
    refreshLinkedFromEntry();
    updateCalc();
  }
  function setMode(m) {
    form.sizeMode = m;
    $('#btnMargin').classList.toggle('on', m === 'margin');
    $('#btnNotional').classList.toggle('on', m === 'notional');
    $('#sizeLabel').textContent = m === 'notional' ? 'Размер позиции, USD (номинал)' : 'Маржа, USD';
    updateCalc();
  }

  function tickClock() {
    const el = $('#clock');
    if (!el) return;
    el.textContent = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Almaty', hour12: false });
  }

  async function init() {
    load();
    bind();
    setSide('long');
    setMode('margin');
    buildChart();
    tickClock();
    setInterval(tickClock, 1000);
    renderAccount();
    renderPositions();
    updateCalc();
    try { await loadMeta(); if (!$('#feed').classList.contains('ok')) setFeed('REST', 'warn'); }
    catch (e) { setFeed('meta error', 'bad'); toast('Не удалось загрузить рынок: ' + e.message); }
    try { await loadCandles(tf); }
    catch (e) { console.warn('candles', e); toast('Свечи не загрузились: ' + e.message); }
    connect();
    setTimeout(() => { if (!ws || ws.readyState !== 1) startPoll(); }, 3000);
    onPrice();
  }

  async function runSelfTest() {
    const report = { ok: false, errors: [], checks: [], consoleErrors: window.__demoConsoleErrors || [] };
    function check(name, cond, detail) {
      report.checks.push({ name, ok: !!cond, detail: detail == null ? '' : String(detail) });
      if (!cond) report.errors.push(name + (detail ? ': ' + detail : ''));
    }
    const start = Date.now();
    while (!window.DemoDesk || !window.DemoDesk.ready() || window.DemoDesk.candleCount() < 10) {
      if (Date.now() - start > 20000) break;
      await new Promise(r => setTimeout(r, 200));
    }
    check('price-loaded', window.DemoDesk && window.DemoDesk.ready(), 'px=' + (window.DemoDesk && window.DemoDesk.lastPx()));
    check('candles-loaded', window.DemoDesk && window.DemoDesk.candleCount() > 50, window.DemoDesk && window.DemoDesk.candleCount());
    try {
      const D = window.DemoDesk;
      D.resetSilent();
      const px = D.lastPx();
      document.getElementById('inpSize').value = '100000';
      document.getElementById('inpLev').value = String(Math.min(30, D.mkt.maxLev || 30));
      document.getElementById('inpTpPct').value = '1';
      D.setForm({ side: 'short', typ: 'market', sizeMode: 'margin' });
      document.getElementById('inpTpPct').dispatchEvent(new Event('input'));
      D.updateCalc();
      const pr = D.preview();
      check('maxLev-30', D.mkt.maxLev === 30, D.mkt.maxLev);
      check('coin-loaded', D.mkt.maxLev > 0 && px > 0, 'mark=' + px);
      check('notional-3m', Math.abs(pr.notional - 3e6) < 50, pr.notional);
      check('margin-100k', Math.abs(pr.margin - 1e5) < 5, pr.margin);
      const row = (pr.scenarios || []).find(s => s.label === '-1%');
      check('scenario-minus-1', row && Math.abs(row.pricePnl - 30000) < 1, row && row.pricePnl);
      check('fees-around-2700', row && Math.abs(row.totalFees - 2686.5) < 2, row && row.totalFees);
      check('roe-around-27', row && Math.abs(row.roe - 27.3135) < 0.05, row && row.roe);
      // small live open/close
      document.getElementById('inpSize').value = '1000';
      document.getElementById('inpLev').value = '5';
      document.getElementById('inpTpPx').value = '';
      document.getElementById('inpTpPct').value = '';
      document.getElementById('inpSlPx').value = '';
      document.getElementById('inpSlPct').value = '';
      D.setForm({ side: 'long', typ: 'market', sizeMode: 'margin' });
      D.updateCalc();
      D.placeOrder();
      const afterOpen = D.getBook();
      check('opened-one', afterOpen.positions.length === 1, afterOpen.positions.length);
      check('fee-deducted', afterOpen.balance < START && afterOpen.balance > START - 50, afterOpen.balance);
      const pos = afterOpen.positions[0];
      D.closePosition(pos, D.lastPx(), 'market', true);
      const afterClose = D.getBook();
      check('closed', afterClose.positions.length === 0, afterClose.positions.length);
      check('history', afterClose.history.length === 1, afterClose.history.length);
      D.resetSilent();
      check('reset', D.getBook().balance === START && D.getBook().positions.length === 0, D.getBook().balance);
    } catch (e) {
      report.errors.push('exception: ' + (e && e.stack || e));
    }
    report.ok = report.errors.length === 0 && report.checks.every(c => c.ok);
    window.__DEMO_TEST__ = report;
    let pre = document.getElementById('testReport');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'testReport'; document.body.appendChild(pre); }
    pre.textContent = JSON.stringify(report, null, 2);
    document.title = report.ok ? 'DEMO TEST OK' : 'DEMO TEST FAIL';
    return report;
  }
  if (/\btest=1\b/.test(location.search)) {
    window.__demoConsoleErrors = [];
    const orig = console.error;
    console.error = function () { window.__demoConsoleErrors.push(Array.from(arguments).map(String).join(' ')); return orig.apply(console, arguments); };
    window.addEventListener('error', ev => { window.__demoConsoleErrors.push(String(ev.message || ev.error)); });
    setTimeout(() => { runSelfTest(); }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed for headless tests
  window.DemoDesk = {
    C, mkt, getBook: () => book, preview: () => preview, lastPx, plannedEntry, updateCalc,
    openPosition, closePosition, placeOrder, resetSilent() { book = defaultBook(); save(); onPrice(); },
    setForm(p) { Object.assign(form, p); if (p.side) setSide(p.side); if (p.typ) setTyp(p.typ); if (p.sizeMode) setMode(p.sizeMode); },
    ready: () => lastPx() > 0, candleCount: () => candles.length
  };
})();
