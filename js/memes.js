/* BNB MEMES: DexScreener + GeckoTerminal data, bots, debate, ideas (paper only) */
(() => {
  'use strict';
  const ME = window.MemeEngine, TA = window.Engine.TA, LWC = window.LightweightCharts;
  const BOTS = ME.BOTS, BOT = ME.BOT;
  const DS = 'https://api.dexscreener.com';
  const GT = 'https://api.geckoterminal.com/api/v2/networks/bsc/pools/';
  const $ = s => document.querySelector(s);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ---- market-cap helpers: implied supply = marketCap (or FDV) / priceUsd from DexScreener ----
  const supOf = t => { const mc = t && (t.mc || t.fdv); return (mc && t.price) ? mc / t.price : null; };
  const capKind = t => t.mc ? 'MC' : t.fdv ? 'FDV' : 'PRICE';
  const MCv = (sup, p) => sup ? ME.usd(p * sup) : ME.px(p);         // display market cap for a price
  const MC = (t, p = t.price) => MCv(supOf(t), p);
  const axisMc = v => { const a = Math.abs(v); return a >= 1e9 ? '$' + (v / 1e9).toFixed(3) + 'B' : a >= 1e6 ? '$' + (v / 1e6).toFixed(3) + 'M' : a >= 1e3 ? '$' + (v / 1e3).toFixed(2) + 'K' : '$' + v.toFixed(2); };
  const hhmmss = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
  const T0 = Date.now();
  const SEEDS = ['BANANAS31', '币安人生', 'Mubarak', 'KOMA', 'FLOKI', 'GIGGLE', 'BabyDoge', 'Broccoli', 'TUT', 'Simons Cat', 'Cheems', 'TST', 'SIREN', 'PALU', 'Wojak', 'PUP', 'CZ dog', 'Binance Life', 'BNB meme', 'bsc meme', 'four.meme', 'doge bsc', 'pepe bsc', 'inu bsc', 'frog bsc', 'cat bsc', 'pump bsc', 'meme coin wbnb', 'dog wbnb', 'ai meme bsc', 'shib bsc', 'elon bsc', 'trump bsc', 'baby bsc', 'panda bsc', 'monkey bsc', 'hippo bsc', 'chill bsc', 'bull bsc', 'meme usdt bsc'];
  const TRACK_MAX = 40, WALL_N = 6;

  // ---------- state ----------
  const T = new Map(); // addr(lower) -> token
  let tracked = []; let junk = 0; let lastRefresh = 0;
  const apiLog = [];
  let focusAddr = null, pinnedUntil = 0, view = 'dex';
  let wall = []; // addrs
  const userAdded = new Set(); let pendingAddr = null;

  // ---------- fetch with accounting ----------
  async function getJSON(url) {
    apiLog.push(Date.now());
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status + ' ' + url.split('?')[0].slice(-40));
    return r.json();
  }
  function upsert(p) {
    const t = ME.toToken(p), k = t.addr.toLowerCase();
    const old = T.get(k);
    if (old) { t.candles = old.candles; t.pts = old.pts; t.prevPx = old.price; t.candleAt = old.candleAt; t.flash = old.price && t.price !== old.price ? (t.price > old.price ? 'u' : 'd') : null; }
    else { t.candles = null; t.pts = []; t.prevPx = null; }
    if (t.price) { const now = Math.floor(Date.now() / 1000); const last = t.pts[t.pts.length - 1]; if (!last || now > last.time) t.pts.push({ time: now, value: t.price }); else last.value = t.price; if (t.pts.length > 600) t.pts.shift(); }
    T.set(k, t); return t;
  }
  function recompute() {
    const all = [...T.values()];
    for (const t of all) { t.sig = ME.signals(t, t.candles, all); }
  }

  // ---------- discovery ----------
  async function discover() {
    log('SCAN', `discovering BSC memecoins (${SEEDS.length} DexScreener searches)`, '#f0b90b');
    const pairs = [];
    for (const q of SEEDS) {
      try { const j = await getJSON(`${DS}/latest/dex/search?q=${encodeURIComponent(q)}`); (j.pairs || []).forEach(p => p.chainId === 'bsc' && pairs.push(p)); } catch (e) { log('ERR', e.message, '#ff4d6d'); }
      await sleep(250);
    }
    // boosts + profiles (BSC only)
    const extra = new Set();
    for (const path of ['/token-boosts/top/v1', '/token-boosts/latest/v1', '/token-profiles/latest/v1']) {
      try { const j = await getJSON(DS + path); (Array.isArray(j) ? j : []).forEach(x => x.chainId === 'bsc' && x.tokenAddress && extra.add(x.tokenAddress)); } catch (e) { }
      await sleep(250);
    }
    if (extra.size) {
      const list = [...extra].slice(0, 30);
      try { const j = await getJSON(`${DS}/tokens/v1/bsc/${list.join(',')}`); (Array.isArray(j) ? j : []).forEach(p => pairs.push(p)); log('BOOST', `${extra.size} boosted/profiled BSC tokens checked`, '#f0b90b'); } catch (e) { }
    }
    const best = ME.bestPairs(pairs);
    let j = 0; const keep = [];
    for (const p of best) { const r = ME.junkReason(p); if (r) { j++; continue; } keep.push(p); }
    keep.sort((a, b) => (b.volume.h24 || 0) - (a.volume.h24 || 0));
    keep.slice(0, TRACK_MAX).forEach(upsert);
    junk = j;
    tracked = keep.slice(0, TRACK_MAX).map(p => p.baseToken.address.toLowerCase());
    userAdded.forEach(a => { if (!tracked.includes(a) && T.has(a)) tracked.push(a); });
    recompute(); lastRefresh = Date.now();
    log('DATA', `tracking ${tracked.length} memecoins · filtered ${j} junk/non-meme pairs`, '#2bf5a0');
  }
  async function refreshAll() {
    if (!tracked.length) return;
    try {
      const pairs = [];
      for (let i = 0; i < tracked.length; i += 30) {
        const addrs = tracked.slice(i, i + 30).map(a => T.get(a).addr);
        const j = await getJSON(`${DS}/tokens/v1/bsc/${addrs.join(',')}`); (Array.isArray(j) ? j : []).forEach(p => pairs.push(p));
      }
      ME.bestPairs(pairs).forEach(p => { if (tracked.includes(p.baseToken.address.toLowerCase())) upsert(p); });
      recompute(); lastRefresh = Date.now(); setFeed(true);
    } catch (e) { log('ERR', 'refresh: ' + e.message, '#ff4d6d'); setFeed(false); }
  }
  async function refreshHot() {
    const addrs = [...new Set(wall.concat(focusAddr ? [focusAddr] : []))].filter(a => T.get(a));
    if (!addrs.length) return;
    try {
      const j = await getJSON(`${DS}/latest/dex/pairs/bsc/${addrs.map(a => T.get(a).pair).join(',')}`);
      (j.pairs || []).forEach(p => { if (T.has(p.baseToken.address.toLowerCase())) upsert(p); });
      recompute(); lastRefresh = Date.now(); setFeed(true);
    } catch (e) { setFeed(false); }
  }
  // GeckoTerminal candles, rate-limited queue (≤ ~20/min)
  const gtQueue = []; let gtBusy = false;
  function needCandles(addr, force, priority) {
    const t = T.get(addr); if (!t) return;
    if (!force && t.candleAt && Date.now() - t.candleAt < 240000) return;
    const i = gtQueue.indexOf(addr); if (i >= 0) { if (!priority) return; gtQueue.splice(i, 1); }
    if (priority) gtQueue.unshift(addr); else gtQueue.push(addr);
    pumpGT();
  }
  let gtPauseUntil = 0, gtFails = 0;
  async function pumpGT() {
    if (gtBusy) return; gtBusy = true;
    while (gtQueue.length) {
      if (Date.now() < gtPauseUntil) { await sleep(gtPauseUntil - Date.now()); continue; }
      const a = gtQueue.shift(), t = T.get(a); if (!t) continue;
      try {
        const j = await getJSON(`${GT}${t.pair}/ohlcv/minute?aggregate=1&limit=180&currency=usd`);
        const list = (j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
        t.candles = clean(list.map(r => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })).sort((x, y) => x.time - y.time), 'ohlc');
        t.candleAt = Date.now(); t.gtTries = 0; gtFails = 0;
        log('GT', `1m candles $${t.symbol} · ${t.candles.length} bars`, '#a78bfa');
        recompute(); renderWallChart(a, true); if (a === focusAddr && view === 'desk') renderDesk(true);
      } catch (e) {
        // most likely rate-limited (429 without CORS headers): back off, retry once, fall back to polled prices
        gtFails++; t.gtTries = (t.gtTries || 0) + 1;
        gtPauseUntil = Date.now() + Math.min(360000, 120000 * gtFails);
        log('WARN', `GeckoTerminal busy, pausing candles ${Math.round((gtPauseUntil - Date.now()) / 1000)}s (using DexScreener ticks)`, '#fbbf24');
        if (t.gtTries < 2) gtQueue.push(a); else t.candleAt = Date.now();
      }
      await sleep(10000);
    }
    gtBusy = false;
  }
  function setFeed(ok) { $('#livePill').classList.toggle('off', !ok); $('#liveTxt').textContent = ok ? 'LIVE' : 'RETRYING'; }

  // ---------- avatars ----------
  let avN = 0;
  function shade(hex, f = 0.45) { const n = parseInt(hex.slice(1), 16); return `rgb(${((n >> 16) & 255) * (1 - f) | 0},${((n >> 8) & 255) * (1 - f) | 0},${(n & 255) * (1 - f) | 0})`; }
  function avatar(b, cls = 'av') {
    const id = 'mg' + (avN++);
    const S = { triangle: '<polygon points="20,2 38.5,35.5 1.5,35.5" stroke-linejoin="round"/>', circle: '<circle cx="20" cy="20" r="17.5"/>', square: '<rect x="2.5" y="2.5" width="35" height="35" rx="9"/>', hexagon: '<polygon points="20,1.5 36.5,10.8 36.5,29.2 20,38.5 3.5,29.2 3.5,10.8"/>', diamond: '<polygon points="20,1 39,20 20,39 1,20"/>' };
    const y = b.shape === 'triangle' ? 25 : 19;
    return `<svg class="avsvg ${cls}" viewBox="0 0 40 40" aria-label="${b.name}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b.color}"/><stop offset="1" stop-color="${shade(b.color)}"/></linearGradient></defs><g fill="url(#${id})" stroke="rgba(255,255,255,.45)" stroke-width="1">${S[b.shape]}</g><g class="eye"><ellipse cx="14.5" cy="${y}" rx="3.3" ry="3.8" fill="#fff"/><ellipse cx="25.5" cy="${y}" rx="3.3" ry="3.8" fill="#fff"/><circle cx="15.3" cy="${y + .7}" r="1.7" fill="#0b1020"/><circle cx="26.3" cy="${y + .7}" r="1.7" fill="#0b1020"/></g><path d="M16.5 ${y + 6.5} Q20 ${y + 9.5} 23.5 ${y + 6.5}" stroke="#0b1020" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>`;
  }
  function icon(t, cls = 'ticon') { return t.icon ? `<img class="${cls}" src="${esc(t.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<span class="${cls} ph">${esc((t.symbol || '?')[0])}</span>`; }
  const rbadge = r => `<span class="rbadge ${r.level}" title="${esc(r.why.join(', '))}">${r.level === 'EXTREME' ? '☠ ' : ''}${r.level} ${r.score}</span>`;
  const cls = x => x >= 0 ? 'up' : 'dn';

  // ---------- charts ----------
  const chartBase = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7f8bb0', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
    grid: { vertLines: { color: 'rgba(120,160,255,.05)' }, horzLines: { color: 'rgba(120,160,255,.05)' } },
    rightPriceScale: { borderColor: 'rgba(120,160,255,.15)' },
    timeScale: { borderColor: 'rgba(120,160,255,.15)', timeVisible: true, secondsVisible: false, tickMarkFormatter: t => new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
    localization: { timeFormatter: t => new Date(t * 1000).toLocaleTimeString('en-GB'), priceFormatter: p => ME.px(p) },
    crosshair: { mode: 0 },
  };
  // sanitize series data: finite positive values, strictly increasing integer times
  function clean(arr, key = 'value') {
    const out = []; let lastT = -Infinity;
    for (const d of arr) {
      if (!d) continue; const t = Math.floor(d.time);
      const ok = key === 'ohlc' ? [d.open, d.high, d.low, d.close].every(v => isFinite(v) && v > 0) : (isFinite(d[key]) && d[key] > 0);
      if (!ok || !isFinite(t)) continue;
      if (t === lastT) { out[out.length - 1] = Object.assign({}, d, { time: t }); continue; }
      if (t < lastT) continue;
      out.push(Object.assign({}, d, { time: t })); lastT = t;
    }
    return out;
  }
  const scaleOf = p => (p > 0 && isFinite(p)) ? Math.pow(10, -Math.floor(Math.log10(p))) : 1;
  const pfFor = p => { const d = Math.min(12, Math.max(2, Math.ceil(-Math.log10(p || 1)) + 4)); return { type: 'price', precision: d, minMove: Math.pow(10, -d) }; };
  // desk (own) focus chart
  let desk = null;
  function buildDesk() {
    if (!LWC) return;
    const c = LWC.createChart($('#deskChart'), chartBase);
    desk = { chart: c, candle: c.addCandlestickSeries({ upColor: '#2bf5a0', downColor: '#ff4d6d', wickUpColor: '#2bf5a0', wickDownColor: '#ff4d6d', borderVisible: false }), vol: c.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }), lines: [] };
    c.priceScale('').applyOptions({ scaleMargins: { top: .84, bottom: 0 } });
    c.priceScale('right').applyOptions({ scaleMargins: { top: .08, bottom: .2 } });
  }
  function renderDesk(full) {
    const t = T.get(focusAddr); if (!desk || !t || !t.candles || !t.candles.length) return;
    const c = clean(t.candles, 'ohlc'); if (!c.length) return; const last = c[c.length - 1];
    const nowMin = Math.floor(Date.now() / 60000) * 60;
    if (t.price) { if (last.time === nowMin) { last.close = t.price; last.high = Math.max(last.high, t.price); last.low = Math.min(last.low, t.price); } else if (nowMin > last.time) c.push({ time: nowMin, open: last.close, high: Math.max(last.close, t.price), low: Math.min(last.close, t.price), close: t.price, volume: 0 }); }
    try {
      const k = supOf(t) || 1, fmtAx = supOf(t) ? axisMc : ME.px;
      const f = scaleOf(t.price * k); desk.f = f;
      desk.chart.applyOptions({ localization: { priceFormatter: v => fmtAx(v / f), timeFormatter: chartBase.localization.timeFormatter } });
      desk.candle.applyOptions({ priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
      desk.candle.setData(c.map(b => ({ time: b.time, open: b.open * k * f, high: b.high * k * f, low: b.low * k * f, close: b.close * k * f })));
      desk.vol.setData(c.map(b => ({ time: b.time, value: isFinite(b.volume) ? b.volume : 0, color: b.close >= b.open ? 'rgba(43,245,160,.35)' : 'rgba(255,77,109,.35)' })));
      desk.lines.forEach(l => desk.candle.removePriceLine(l)); desk.lines = [];
      ideas.filter(i => i.addr === t.addr && i.status === 'OPEN').slice(0, 1).forEach(i => {
        desk.lines.push(desk.candle.createPriceLine({ price: i.entry * k * f, color: '#e2e8f0', lineStyle: 2, lineWidth: 1, title: 'idea entry mcap' }));
        desk.lines.push(desk.candle.createPriceLine({ price: i.stop * k * f, color: '#ff4d6d', lineStyle: 2, lineWidth: 1, title: 'stop mcap' }));
        desk.lines.push(desk.candle.createPriceLine({ price: i.target * k * f, color: '#2bf5a0', lineStyle: 2, lineWidth: 1, title: 'target mcap' }));
      });
      if (full) desk.chart.timeScale().fitContent();
    } catch (e) { }
  }
  // wall of mini charts
  const wallCharts = {}; // slot index -> {chart, series, addr}
  function buildWall() {
    const w = $('#wall');
    for (let i = 0; i < WALL_N; i++) {
      const p = el('div', 'panel mini'); p.dataset.slot = i;
      p.innerHTML = `<div class="mh"><span class="sym" id="ws-${i}">—</span><span class="px" id="wp-${i}">—</span></div><div class="ms"><span id="wc-${i}">1h —</span><span id="wb-${i}">buys —</span></div><div class="mc"><div class="chart" id="wch-${i}"></div><div class="watchers" id="ww-${i}"></div><span class="opened-by" id="wo-${i}"></span></div><div class="rsi-bar"><i id="wr-${i}"></i></div>`;
      p.onclick = () => { const a = wall[i]; if (a) userFocus(a); };
      w.appendChild(p);
      if (!LWC) continue;
      const ch = LWC.createChart(document.getElementById('wch-' + i), Object.assign({}, chartBase, {
        handleScroll: false, handleScale: false, layout: Object.assign({}, chartBase.layout, { attributionLogo: false }),
        grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(120,160,255,.04)' } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: .15, bottom: .1 } },
        timeScale: Object.assign({}, chartBase.timeScale, { visible: false, rightOffset: 3 }),
        crosshair: { mode: 0, vertLine: { visible: false, labelVisible: false }, horzLine: { visible: true, color: 'rgba(255,255,255,.2)' } },
      }));
      wallCharts[i] = { chart: ch, series: ch.addAreaSeries({ lineColor: '#f0b90b', topColor: '#f0b90b55', bottomColor: '#f0b90b00', lineWidth: 2, lastPriceAnimation: 1, priceLineStyle: 2 }), addr: null, lastT: 0 };
    }
  }
  function wallData(t) {
    const out = [];
    if (t.candles && t.candles.length) t.candles.forEach(c => out.push({ time: c.time, value: c.close }));
    else if (t.price) { // coarse real path from DexScreener change anchors until candles arrive
      const now = (t.pts && t.pts.length ? t.pts[0].time : Math.floor(Date.now() / 1000)) - 1;
      [[86400, 'h24'], [21600, 'h6'], [3600, 'h1'], [300, 'm5']].forEach(([sec, k]) => out.push({ time: now - sec, value: t.price / (1 + (t.chg[k] || 0) / 100) }));
    }
    const lastT = out.length ? out[out.length - 1].time : 0;
    (t.pts || []).forEach(p => { if (p.time > lastT) out.push(p); });
    return out;
  }
  function renderWallChart(addr, full) {
    const i = wall.indexOf(addr); if (i < 0 || !wallCharts[i]) return;
    const wc = wallCharts[i], t = T.get(addr); if (!t) return;
    const data = clean(wallData(t)); if (!data.length) return;
    try {
      const col = (t.sig && t.sig.chg.h1 >= 0) ? '#2bf5a0' : '#ff4d6d';
      const k = supOf(t) || 1, fmtAx = supOf(t) ? axisMc : ME.px;
      const f = (wc.addr === addr && wc.f) ? wc.f : scaleOf(t.price * k);
      const sd = data.map(d => ({ time: d.time, value: d.value * k * f }));
      if (full || wc.addr !== addr || data[data.length - 1].time < wc.lastT) {
        wc.f = f;
        wc.chart.applyOptions({ localization: { priceFormatter: v => fmtAx(v / f), timeFormatter: chartBase.localization.timeFormatter } });
        wc.series.applyOptions({ priceFormat: { type: 'price', precision: 4, minMove: 0.0001 }, lineColor: col, topColor: col + '44', bottomColor: col + '00' });
        wc.series.setData(sd); wc.chart.timeScale().fitContent(); wc.addr = addr;
      } else wc.series.update(sd[sd.length - 1]);
      wc.lastT = data[data.length - 1].time;
    } catch (e) { wc.lastT = 0; }
  }
  function renderWallHeads() {
    wall.forEach((a, i) => {
      const t = T.get(a); if (!t) return;
      const s = t.sig;
      const ws = document.getElementById('ws-' + i); const html = `${icon(t)}<span>$${esc(t.symbol)}</span><small>${t.candles && t.candles.length ? '1m · live' : '24h path · live'}</small>`; if (ws.dataset.a !== a + !!(t.candles && t.candles.length)) { ws.innerHTML = html; ws.dataset.a = a + !!(t.candles && t.candles.length); }
      const wp = document.getElementById('wp-' + i); wp.textContent = capKind(t) + ' ' + MC(t); wp.className = 'px ' + (t.flash === 'u' ? 'up' : t.flash === 'd' ? 'dn' : '');
      const wc = document.getElementById('wc-' + i); wc.innerHTML = `1h <span class="${cls(t.chg.h1)}">${ME.sg(t.chg.h1)}</span> · 24h <span class="${cls(t.chg.h24)}">${ME.sg(t.chg.h24)}</span>`;
      document.getElementById('wb-' + i).innerHTML = `buys ${ME.pct(s.br1)}<span class="bp"><i style="width:${Math.round(s.br1 * 100)}%"></i></span>`;
      const r = document.getElementById('wr-' + i); const rs = s.rsi == null ? 50 : s.rsi; r.style.width = rs + '%'; r.style.background = rs > 70 ? 'var(--dn)' : rs < 30 ? 'var(--up)' : 'linear-gradient(90deg,#f0b90b,#ff8a00)';
      const p = document.querySelector(`.mini[data-slot="${i}"]`); p.classList.toggle('active', a === focusAddr);
      renderWallChart(a, false);
    });
  }
  function putOnWall(addr, bot) {
    let i = wall.indexOf(addr);
    if (i < 0) {
      // replace the slot not focused and least recently opened
      let best = -1, bestT = Infinity;
      for (let k = 0; k < WALL_N; k++) { if (wall[k] === focusAddr) continue; const tt = wallOpened[k] || 0; if (tt < bestT) { bestT = tt; best = k; } }
      i = best < 0 ? 0 : best; wall[i] = addr;
      const p = document.querySelector(`.mini[data-slot="${i}"]`); p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap');
      document.getElementById('ws-' + i).dataset.a = '';
      needCandles(addr);
    }
    wallOpened[i] = Date.now();
    const ob = document.getElementById('wo-' + i);
    if (bot) { ob.textContent = 'opened by ' + bot.name; ob.style.background = bot.color; }
    renderWallChart(addr, true); renderWallHeads();
    return i;
  }
  const wallOpened = {};

  // ---------- focus ----------
  function setFocus(addr, bot) {
    const t = T.get(addr); if (!t) return;
    const changed = addr !== focusAddr;
    focusAddr = addr;
    if (changed) {
      const f = $('#dexFrame');
      f.classList.add('fade');
      f.onload = () => f.classList.remove('fade');
      f.src = `https://dexscreener.com/bsc/${t.pair}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=marketCap&interval=5`;
      setTimeout(() => f.classList.remove('fade'), 4000);
      $('#dsLink').href = t.url || `https://dexscreener.com/bsc/${t.pair}`;
      needCandles(addr, false, true);
    }
    $('#focusIcon').outerHTML = t.icon ? `<img class="ticon big" id="focusIcon" src="${esc(t.icon)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<span class="ticon big ph" id="focusIcon">${esc(t.symbol[0])}</span>`;
    updateFocusHead();
    if (view === 'desk') renderDesk(true);
    if (bot) {
      const fp = $('#focusPanel'); fp.style.setProperty('--bc', bot.color); fp.classList.add('glow');
      const av = $('#focusAv'); av.innerHTML = avatar(bot, ''); av.classList.remove('pop'); void av.offsetWidth; av.classList.add('pop');
      const ov = $('#openOverlay'); ov.style.setProperty('--bc', bot.color);
      ov.innerHTML = `${avatar(bot, '')}<span><span style="color:${bot.color}">${bot.name}</span> opened $${esc(t.symbol)} · BSC</span>`;
      ov.classList.remove('show'); void ov.offsetWidth; ov.classList.add('show');
      const sc = $('#scan'); sc.style.background = `linear-gradient(90deg,transparent,${bot.color}22,${bot.color}66 92%,transparent)`; sc.classList.remove('go'); void sc.offsetWidth; sc.classList.add('go');
      $('#focusSub').innerHTML = `<b style="color:${bot.color}">${bot.name}</b> · ${bot.role} · ${esc(t.dex)} · ${esc(t.symbol)}/${esc(t.quote)} · pair ${t.pair.slice(0, 6)}…${t.pair.slice(-4)}`;
    }
    renderTable();
  }
  function userFocus(addr) {
    pinnedUntil = Date.now() + 60000;
    setFocus(addr, null);
    const t = T.get(addr);
    $('#focusSub').innerHTML = `pinned by <b style="color:var(--bnb)">you</b> · ${esc(t.dex)} · ${esc(t.symbol)}/${esc(t.quote)} · bots resume driving in 60s`;
    const pn = $('#pinNote'); pn.textContent = '📌 PINNED · click to release'; pn.classList.add('show');
  }
  $('#toDesk').onclick = () => document.querySelector('#viewSwitch button[data-v="desk"]').click();
  $('#pinNote').onclick = () => { pinnedUntil = 0; $('#pinNote').classList.remove('show'); };
  function updateFocusHead() {
    const t = T.get(focusAddr); if (!t) return;
    $('#focusSym').textContent = '$' + t.symbol; $('#focusName').textContent = t.name;
    const px = $('#focusPx'); px.textContent = capKind(t) + ' ' + MC(t); px.className = 'px ' + (t.flash === 'u' ? 'up' : t.flash === 'd' ? 'dn' : '');
    const c = $('#focusChg'); c.textContent = ME.sg(t.chg.h24) + ' 24h'; c.className = 'chg ' + (t.chg.h24 >= 0 ? 'bg-up' : 'bg-dn');
    const s = t.sig; if (!s) return;
    $('#focusRisk').innerHTML = rbadge(s.risk);
    $('#focusChips').innerHTML = [['LIQ', ME.usd(t.liq)], ['PRICE', ME.px(t.price)], ['FDV', ME.usd(t.fdv)], ['BUYS 1H', ME.pct(s.br1)], ['TX 1H', s.tx1], ['RSI', ME.f1(s.rsi)], ['AGE', ME.age(t.created)]].map(c => `<span class="chip">${c[0]} <b>${c[1]}</b></span>`).join('');
  }
  document.querySelectorAll('#viewSwitch button').forEach(b => b.onclick = () => {
    view = b.dataset.v; document.querySelectorAll('#viewSwitch button').forEach(x => x.classList.toggle('on', x === b));
    $('#dexFrame').classList.toggle('hidden', view !== 'dex'); $('#deskChart').classList.toggle('hidden', view !== 'desk'); $('#embedHint').classList.toggle('hidden', view !== 'dex');
    if (view === 'desk') { needCandles(focusAddr, true); setTimeout(() => renderDesk(true), 50); }
  });

  // ---------- ranking table ----------
  let sortK = 'vol', sortDir = -1;
  const SORTERS = { symbol: t => t.symbol.toLowerCase(), price: t => t.price, fdv: t => t.fdv || 0, m5: t => t.chg.m5, h1: t => t.chg.h1, h6: t => t.chg.h6, h24: t => t.chg.h24, vol: t => t.vol.h24, liq: t => t.liq, mc: t => t.mc || t.fdv || 0, tx: t => t.txns.h24.buys + t.txns.h24.sells, age: t => -(t.created || 0), risk: t => t.sig ? t.sig.risk.score : 0 };
  const SORT_LBL = { symbol: 'name', price: 'price', fdv: 'FDV', m5: '5m change', h1: '1h change', h6: '6h change', h24: '24h change', vol: '24h volume', liq: 'liquidity', mc: 'market cap', tx: '24h txns', age: 'age', risk: 'risk score' };
  document.querySelectorAll('.mtable th[data-k]').forEach(th => th.onclick = () => { const k = th.dataset.k; if (sortK === k) sortDir *= -1; else { sortK = k; sortDir = k === 'symbol' ? 1 : -1; } renderTable(); });
  function ranked() { const f = SORTERS[sortK]; return tracked.map(a => T.get(a)).filter(Boolean).sort((a, b) => { const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; }); }
  function renderTable() {
    const rows = ranked(); if (!rows.length) return;
    document.querySelectorAll('.mtable th[data-k]').forEach(th => th.classList.toggle('sorted', th.dataset.k === sortK));
    $('#sortLbl').textContent = SORT_LBL[sortK] + (sortDir < 0 ? ' ↓' : ' ↑');
    $('#rankCount').textContent = rows.length;
    const ch = x => `<td class="r ${cls(x)}">${ME.sg(x)}</td>`;
    $('#rankBody').innerHTML = rows.map((t, i) => {
      const s = t.sig, tb = t.txns.h24.buys, ts = t.txns.h24.sells, br = (tb + ts) ? tb / (tb + ts) : .5;
      const w = BOTS.filter(b => botWatch[b.id] === t.addr.toLowerCase()).map(b => `<span title="${b.name}">${avatar(b)}</span>`).join('');
      return `<tr data-a="${t.addr.toLowerCase()}" class="${t.addr.toLowerCase() === focusAddr ? 'focus' : ''}">
        <td class="rk ${i < 3 ? 'top' : ''}">${i + 1}</td>
        <td><div class="tkn">${icon(t)}<div><b>$${esc(t.symbol)}</b>${t.boosts ? `<span class="boost" title="active DexScreener boosts">⚡${t.boosts}</span>` : ''}<span class="sub2"><small>${esc(t.name)}</small> · ${esc(t.dex)}</span></div></div></td>
        <td class="r ${t.flash === 'u' ? 'fu' : t.flash === 'd' ? 'fd' : ''}"><b>${MC(t)}</b><span class="sub2">${t.mc ? 'mcap' : t.fdv ? 'FDV (no MC)' : 'price'} · ${ME.px(t.price)}</span></td>
        ${ch(t.chg.m5)}${ch(t.chg.h1)}${ch(t.chg.h6)}${ch(t.chg.h24)}
        <td class="r">${ME.usd(t.vol.h24)}</td><td class="r">${ME.usd(t.liq)}</td>
        <td class="r">${ME.usd(t.fdv)}<span class="sub2">price ${ME.px(t.price)}</span></td>
        <td><div class="txbar"><span class="bar"><i style="width:${Math.round(br * 100)}%"></i></span><span><span class="up">${tb.toLocaleString('en-US')}</span>/<span class="dn">${ts.toLocaleString('en-US')}</span></span></div></td>
        <td class="r">${ME.age(t.created)}</td>
        <td>${s ? rbadge(s.risk) : ''}</td>
        <td><div class="wt">${w}</div></td></tr>`;
    }).join('');
    T.forEach(t => t.flash = null);
  }
  $('#rankBody').addEventListener('click', e => { const tr = e.target.closest('tr[data-a]'); if (tr) { userFocus(tr.dataset.a); $('#focusPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });

  // ---------- stats ----------
  function renderStats() {
    const ts = tracked.map(a => T.get(a)).filter(Boolean); if (!ts.length) return;
    $('#hTokens').textContent = ts.length; $('#hJunk').textContent = junk;
    const tot = ts.reduce((a, t) => a + t.vol.h24, 0); $('#sVol').textContent = ME.usd(tot);
    const by = f => ts.slice().sort((a, b) => f(b) - f(a));
    const g = by(t => t.chg.h1)[0], l = by(t => -t.chg.h1)[0], b = by(t => t.txns.h1.buys + t.txns.h1.sells > 20 ? t.sig.br1 : 0)[0], y = by(t => t.created || 0)[0];
    $('#sGain').innerHTML = `$${esc(g.symbol)} <span class="${cls(g.chg.h1)}">${ME.sg(g.chg.h1)}</span> <small>${MC(g)}</small>`;
    $('#sLose').innerHTML = `$${esc(l.symbol)} <span class="${cls(l.chg.h1)}">${ME.sg(l.chg.h1)}</span> <small>${MC(l)}</small>`;
    $('#sBuy').innerHTML = `$${esc(b.symbol)} <small>${ME.pct(b.sig.br1)} buys 1h</small>`;
    $('#sYoung').innerHTML = `$${esc(y.symbol)} <small>${ME.age(y.created)} · ${MC(y)}</small>`;
    const mix = { LOW: 0, MED: 0, HIGH: 0, EXTREME: 0 }; ts.forEach(t => mix[t.sig.risk.level]++);
    $('#sRisk').innerHTML = `<span class="up">${mix.LOW}</span>·<span class="warn">${mix.MED}</span>·<span style="color:#fb923c">${mix.HIGH}</span>·<span class="dn">${mix.EXTREME}</span> <small>L/M/H/X</small>`;
    const ago = Math.round((Date.now() - lastRefresh) / 1000); const hr = $('#hRefresh'); hr.textContent = lastRefresh ? ago + 's ago' : 'loading…'; hr.className = ago < 30 ? 'ok' : 'warn';
    while (apiLog.length && Date.now() - apiLog[0] > 60000) apiLog.shift(); $('#hApi').textContent = apiLog.length;
  }

  // ---------- bots UI ----------
  const botWatch = {};
  function buildBots() {
    const w = $('#bots');
    BOTS.forEach((b, i) => {
      const d = el('div', 'bot'); d.id = 'bot-' + b.id; d.style.setProperty('--bc', b.color); d.style.animationDelay = (i * 80) + 'ms';
      d.innerHTML = `<div class="bh"><div class="bav">${avatar(b, '')}</div><div><div class="bn">${b.name}</div><div class="br">${b.role.toUpperCase()}</div></div><div class="state" id="bs-${b.id}">IDLE</div></div>
        <div class="rule">${esc(b.rule)}</div>
        <div class="watch"><span>watching <b id="bw-${b.id}">—</b></span><span>view <span class="view" id="bv-${b.id}">—</span></span></div>
        <div class="term" id="bt-${b.id}"><div>> boot ${b.name.toLowerCase()}.meme ok</div><div><span class="cur"></span></div></div>`;
      w.appendChild(d);
    });
  }
  function termPush(id, txt, c = '') { const t = document.getElementById('bt-' + id); if (!t) return; const l = el('div', c); l.textContent = txt; t.insertBefore(l, t.lastElementChild); while (t.children.length > 9) t.removeChild(t.firstElementChild); }
  function setWatch(id, addr) { botWatch[id] = addr; const t = T.get(addr); document.getElementById('bw-' + id).textContent = t ? '$' + t.symbol : '—'; renderWatchers(); }
  function renderWatchers() {
    wall.forEach((a, i) => {
      const w = document.getElementById('ww-' + i); const ids = BOTS.filter(b => botWatch[b.id] === a).map(b => b.id); const k = a + ids.join();
      if (w.dataset.k === k) return; w.dataset.k = k;
      w.innerHTML = ids.map(id => `<span class="w" style="--bc:${BOT[id].color}">${avatar(BOT[id], '')}</span>`).join('');
    });
  }
  const viewCol = v => v === 'BUY' || v === 'OK' ? 'var(--up)' : v === 'AVOID' || v === 'VETO' ? 'var(--dn)' : v === 'CAUTION' ? 'var(--am)' : 'var(--mut)';
  const botViews = {};
  function setView(id, v) { botViews[id] = v; const k = id === 'atlas' ? v.risk : v.side; const e = document.getElementById('bv-' + id); e.textContent = k; e.style.color = viewCol(k); }
  let activeId = null;
  function setActive(id) { activeId = id; BOTS.forEach(b => { document.getElementById('bot-' + b.id).classList.toggle('active', b.id === id); document.getElementById('bs-' + b.id).textContent = b.id === id ? 'ACTIVE' : botWatch[b.id] ? 'WATCHING' : 'IDLE'; }); }
  const cursorEl = $('#cursor');
  async function moveCursor(bot, target) {
    if (!target) return; const r = target.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) { cursorEl.style.opacity = 0; return; }
    cursorEl.style.setProperty('--bc', bot.color);
    if (cursorEl.dataset.bot !== bot.id) { cursorEl.dataset.bot = bot.id; cursorEl.innerHTML = `<svg class="ptr" viewBox="0 0 14 14"><path d="M1 1 L13 6 L7 7.5 L5.5 13 Z" fill="${bot.color}" stroke="#000" stroke-width=".8"/></svg><div class="avwrap">${avatar(bot, '')}</div><span class="lab">${bot.name}</span>`; }
    cursorEl.style.opacity = 1;
    cursorEl.style.transform = `translate(${r.left + scrollX + r.width * rand(.4, .7)}px,${r.top + scrollY + r.height * rand(.35, .6)}px)`;
    await sleep(1050); cursorEl.classList.remove('click'); void cursorEl.offsetWidth; cursorEl.classList.add('click'); await sleep(250);
  }
  const STAGE_COL = ['#f0b90b', '#22d3ee', '#f472b6', '#fbbf24', '#2bf5a0'];
  function stage(i, text) {
    document.querySelectorAll('.stg').forEach(s => { const k = +s.dataset.i; s.classList.toggle('on', k === i); s.classList.toggle('done', k < i); s.style.setProperty('--sc', STAGE_COL[k]); });
    $('#plFill').style.width = ((i + 1) / 5 * 100) + '%'; if (text) $('#plStatus').innerHTML = text; $('#plCycle').textContent = '#' + String(cycle).padStart(4, '0');
  }

  // ---------- chat / log ----------
  let msgCount = 0; const chatEl = $('#chat');
  function fmtMsg(t) {
    let h = esc(t);
    h = h.replace(/\$([^\s.,:;!?)]+)/g, '<span class="coin">$$$1</span>');
    h = h.replace(/@(NOVA|LUNA|ATLAS|ECHO|VEX)\b/g, (m, n) => `<span class="at" style="color:${BOTS.find(b => b.name === n).color}">@${n}</span>`);
    return h.replace(/(\+\d+(\.\d+)?%)/g, '<span class="up">$1</span>').replace(/(-\d+(\.\d+)?%)/g, '<span class="dn">$1</span>');
  }
  function post(id, text, opt = {}) {
    const b = BOT[id], v = botViews[id], vv = v ? (id === 'atlas' ? v.risk : v.side) : '';
    const m = el('div', 'msg' + (opt.idea ? ' idea' : '')); m.style.setProperty('--bc', b.color);
    const tc = opt.idea ? '#fbbf24' : viewCol(vv).replace('var(--up)', '#2bf5a0').replace('var(--dn)', '#ff4d6d').replace('var(--am)', '#fbbf24').replace('var(--mut)', '#7f8bb0');
    m.innerHTML = `<div class="av">${avatar(b, '')}</div><div class="bub"><div class="who"><b>${b.name}</b><span class="tag" style="color:${tc};border-color:${tc}55">${opt.idea ? 'IDEA' : vv || b.role}</span><time>${hhmmss()}</time></div><div class="txt">${fmtMsg(text)}</div></div>`;
    chatEl.appendChild(m); while (chatEl.children.length > 80) chatEl.removeChild(chatEl.firstElementChild); chatEl.scrollTop = chatEl.scrollHeight;
    msgCount++; $('#chatCount').textContent = msgCount;
  }
  function sysMsg(t) { chatEl.appendChild(el('div', 'msg sys', `<div class="bub">${esc(t)}</div>`)); chatEl.scrollTop = chatEl.scrollHeight; }
  async function typing(id, ms) { const b = BOT[id]; $('#typing').innerHTML = `<span class="av">${avatar(b, '')}</span><span style="color:${b.color}">${b.name}</span> is typing <span class="dots"><i></i><i></i><i></i></span>`; await sleep(ms); $('#typing').innerHTML = ''; }
  function log(k, t, c = '#7f8bb0') { const l = el('div', 'll', `<time>${hhmmss()}</time><span class="k" style="color:${c}">${esc(k)}</span><span class="t">${esc(t)}</span>`); const L = $('#log'); L.prepend(l); while (L.children.length > 30) L.removeChild(L.lastElementChild); }
  function toast(h) { const t = $('#toast'); t.innerHTML = h; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 5000); }

  // ---------- paper bags ----------
  const paper = [], closed = []; const NOTIONAL = 1000;
  function openPaper(id, t, s) {
    if (paper.some(p => p.bot === id && p.addr === t.addr) || paper.filter(p => p.bot === id).length >= 2) return;
    const st = ME.stops(s); const p = { sup: supOf(t), bot: id, addr: t.addr, sym: t.symbol, entry: t.price, stop: st.stop, target: st.target, opened: Date.now(), isNew: true };
    paper.push(p); termPush(id, `> paper buy $${t.symbol} at ${MC(t)} mcap (sim, $1K)`, 'cmd'); log('PAPER', `${BOT[id].name} paper-buys $${t.symbol} at ${MC(t)} mcap`, BOT[id].color);
  }
  function renderPaper() {
    for (const p of paper.slice()) {
      const t = T.get(p.addr.toLowerCase()); if (!t) continue; const st = ME.status(p, t.price);
      if (st !== 'OPEN' || Date.now() - p.opened > 30 * 60e3) {
        const r = ME.pnl(p, t.price); paper.splice(paper.indexOf(p), 1); closed.unshift({ bot: p.bot, sym: p.sym, pnl: r, usd: r / 100 * NOTIONAL, why: st === 'OPEN' ? 'time' : st.toLowerCase() });
        log('PAPER', `${BOT[p.bot].name} closes $${p.sym} ${ME.sg(r)} (${closed[0].why})`, r >= 0 ? '#2bf5a0' : '#ff4d6d');
      }
    }
    $('#paperBody').innerHTML = paper.length ? paper.map(p => {
      const t = T.get(p.addr.toLowerCase()), r = ME.pnl(p, t.price), b = BOT[p.bot];
      const h = `<tr class="${p.isNew ? 'new' : ''}"><td><span class="bn">${avatar(b)}<span style="color:${b.color}">${b.name}</span></span></td><td><b>$${esc(p.sym)}</b></td><td>${MCv(p.sup, p.entry)}</td><td>${MCv(p.sup, t.price)}</td><td class="${cls(r)}">${ME.sg(r, 2)}<br><small>${r >= 0 ? '+' : '-'}$${Math.abs(r / 100 * NOTIONAL).toFixed(2)}</small></td></tr>`;
      p.isNew = false; return h;
    }).join('') : '<tr class="ph"><td colspan="5">no open paper bags</td></tr>';
    $('#paperClosed').innerHTML = closed.length ? closed.slice(0, 12).map(c => `<span><span style="color:${BOT[c.bot].color}">${BOT[c.bot].name}</span> $${esc(c.sym)} <b class="${cls(c.pnl)}">${ME.sg(c.pnl)}</b></span>`).join('') : '—';
    const tot = closed.reduce((a, c) => a + c.usd, 0) + paper.reduce((a, p) => a + ME.pnl(p, T.get(p.addr.toLowerCase()).price) / 100 * NOTIONAL, 0);
    $('#paperTot').innerHTML = `<span class="${cls(tot)}">${tot >= 0 ? '+' : '-'}$${Math.abs(tot).toFixed(2)}</span>`;
  }

  // ---------- ideas ----------
  const ideas = []; let lastIdeaAt = 0;
  function addIdea(i) {
    i.status = 'OPEN'; ideas.unshift(i); const e = $('#ideasEmpty'); if (e) e.remove();
    const t = T.get(i.addr.toLowerCase());
    const reasons = i.reasons.map(r => `<li>${avatar(BOT[r.bot])}<span><b style="color:${BOT[r.bot].color}">${BOT[r.bot].name}:</b> ${esc(r.why)}</span></li>`).join('') + i.dissent.map(r => `<li class="dis">${avatar(BOT[r.bot])}<span><b style="color:${BOT[r.bot].color}">${BOT[r.bot].name} disagrees:</b> ${esc(r.why)}</span></li>`).join('');
    const c = el('div', 'idea L'); c.id = 'idea-' + i.id.replace(/[^a-z0-9]/gi, '');
    c.innerHTML = `<div class="ih">${icon(t)}<span class="coin" style="color:var(--bnb)">$${esc(i.sym)}</span><span class="side-pill L">▲ PAPER BUY</span>${rbadge(i.risk)}<span class="conf ${i.confidence}">CONFIDENCE<b>${i.confidence}</b></span></div>
      <div class="levels"><div><label>ENTRY MCAP</label><b>${MCv(i.sup, i.entry)}</b></div><div><label>STOP MCAP</label><b class="dn">${MCv(i.sup, i.stop)}</b></div><div><label>TARGET MCAP</label><b class="up">${MCv(i.sup, i.target)}</b></div><div><label>R:R</label><b>1:2</b></div></div>
      <div class="prog"><span class="entry"></span><span class="now" data-r="now"></span></div>
      <div class="prog-l"><span>STOP −${i.stopPct.toFixed(1)}%</span><span>ENTRY</span><span>TARGET +${(i.stopPct * 2).toFixed(1)}%</span></div>
      <div class="live-pnl"><span>since idea · <span data-r="age">0s</span> · now <b data-r="px" style="font-size:11px">${MCv(i.sup, i.entry)}</b> mcap</span><b data-r="pnl">+0.00%</b></div>
      <ul class="reasons">${reasons}</ul>
      <div class="agree-row">AGREED ${i.agree.map(id => `<span title="${BOT[id].name}">${avatar(BOT[id])}</span>`).join('')}${i.atlas === 'CAUTION' ? '<span class="warn" style="margin-left:auto">⚠ ATLAS: half size</span>' : ''}</div>
      <div class="warn-line">☠ Memecoin risk: ${esc(i.risk.why.slice(0, 3).join(', ') || 'can go to zero')}. Liquidity ${ME.usd(t.liq)}. Paper idea only, not financial advice. Verify the contract (${i.addr.slice(0, 6)}…${i.addr.slice(-4)}) yourself.</div>`;
    const L = $('#ideas'); L.prepend(c); const cards = L.querySelectorAll('.idea'); if (cards.length > 6) cards[cards.length - 1].remove();
  }
  function renderIdeas() {
    for (const i of ideas) {
      const t = T.get(i.addr.toLowerCase()); if (!t) continue; const c = document.getElementById('idea-' + i.id.replace(/[^a-z0-9]/gi, ''));
      if (i.status === 'OPEN') { const st = ME.status(i, t.price); if (st !== 'OPEN' || Date.now() - i.created > 60 * 60e3) { i.status = st === 'OPEN' ? 'EXPIRED' : st; i.final = ME.pnl(i, t.price); log('IDEA', `$${i.sym} idea → ${i.status} (${ME.sg(i.final)})`, i.final >= 0 ? '#2bf5a0' : '#ff4d6d'); if (c) { c.classList.add('done'); c.appendChild(el('div', 'stamp ' + i.status, i.status === 'TARGET' ? 'TARGET HIT' : i.status)); } } }
      if (!c) continue;
      const r = i.status === 'OPEN' ? ME.pnl(i, t.price) : i.final; const q = k => c.querySelector(`[data-r="${k}"]`);
      q('pnl').textContent = ME.sg(r, 2); q('pnl').className = cls(r);
      if (i.status === 'OPEN') { q('px').textContent = MCv(i.sup, t.price); q('now').style.left = Math.max(0, Math.min(1, (t.price - i.stop) / (i.target - i.stop))) * 100 + '%'; const a = Math.floor((Date.now() - i.created) / 1000); q('age').textContent = a < 60 ? a + 's' : Math.floor(a / 60) + 'm ' + (a % 60) + 's'; }
    }
  }

  // ---------- desk loop ----------
  let cycle = 0; const recent = [];
  function chooseToken(bot) {
    const ts = tracked.map(a => T.get(a)).filter(t => t && t.sig);
    const sc = ts.map(t => {
      const s = t.sig; let x;
      if (bot.id === 'atlas') x = s.risk.score / 50 + (paper.some(p => p.addr === t.addr) ? .5 : 0);
      else { const v = bot.id === 'vex' ? BOT.vex.analyze(s, null) : bot.analyze(s); x = v.conv + (v.side !== 'WAIT' ? .5 : 0) + Math.min(.4, Math.abs(t.chg.h1) / 30) + Math.log10(1 + t.vol.h24) / 20; }
      if (recent.includes(t.addr)) x -= .7;
      return { t, x: x + Math.random() * .5 };
    }).sort((a, b) => b.x - a.x);
    return sc.length ? sc[0].t : null;
  }
  async function runCycle() {
    cycle++; $('#cycle').textContent = '#' + String(cycle).padStart(4, '0');
    const bot = BOTS[(cycle - 1) % BOTS.length]; setActive(bot.id);
    stage(0, `<b style="color:${bot.color}">${bot.name}</b> scanning ${tracked.length} BSC memes`);
    termPush(bot.id, `> GET dexscreener /tokens/v1/bsc [${tracked.length}]`, 'cmd');
    const top3 = ranked().slice(0, 3); for (const t of top3) { termPush(bot.id, `  $${t.symbol.slice(0, 8).padEnd(8)} mc ${MC(t)} 1h ${ME.sg(t.chg.h1)}`); await sleep(160); }
    let t = chooseToken(bot);
    if (pendingAddr && T.get(pendingAddr)) { t = T.get(pendingAddr); pendingAddr = null; termPush(bot.id, `> user request: inspect $${t.symbol}`, 'cmd'); }
    if (!t) return;
    recent.unshift(t.addr); recent.length = Math.min(recent.length, 3);
    const addr = t.addr.toLowerCase();
    log('CYCLE', `#${cycle} ${bot.name} picks $${t.symbol}`, bot.color);
    const slot = putOnWall(addr, bot);
    await moveCursor(bot, document.querySelector(`.mini[data-slot="${slot}"]`));
    setWatch(bot.id, addr);
    stage(1, `<b style="color:${bot.color}">${bot.name}</b> opened <b>$${esc(t.symbol)}</b> chart`);
    if (Date.now() > pinnedUntil) { $('#pinNote').classList.remove('show'); setFocus(addr, bot); }
    log('OPEN', `${bot.name} opened $${t.symbol} chart (${t.pair.slice(0, 8)}…)`, bot.color);
    termPush(bot.id, `> open dexscreener.com/bsc/${t.pair.slice(0, 10)}…`, 'cmd'); await sleep(400);
    termPush(bot.id, `> GET geckoterminal ohlcv 1m [${t.candles ? t.candles.length : 'queued'}] → plot as mcap`, 'cmd'); await sleep(250);
    termPush(bot.id, `> mcap ${MC(t)} (${capKind(t)}) · liq ${ME.usd(t.liq)} · vol24 ${ME.usd(t.vol.h24)}`, 'res'); await sleep(400);
    const s = ME.signals(t, t.candles, [...T.values()]); t.sig = s;
    const v = ME.evaluateAll(s);
    for (const l of v[bot.id].lines) { termPush(bot.id, l, 'res'); await sleep(380); }
    const mv = v[bot.id]; termPush(bot.id, bot.id === 'atlas' ? `> verdict: ${mv.risk}` : `> verdict: ${mv.side} conv=${mv.conv.toFixed(2)}`, 'cmd');
    setView(bot.id, mv);
    await typing(bot.id, rand(1100, 1800)); post(bot.id, ME.message(bot.id, s, mv));
    stage(2, `debate on <b>$${esc(t.symbol)}</b>`);
    const pool = BOTS.map(b => b.id).filter(i => i !== bot.id); const dir = i => i !== 'atlas' && v[i].side !== 'WAIT';
    const chosen = [];
    const opp = pool.filter(i => dir(i) && mv.side !== 'WAIT' && v[i].side !== mv.side), same = pool.filter(i => dir(i) && v[i].side === mv.side);
    if (opp.length) chosen.push(pick(opp)); if (same.length) chosen.push(pick(same));
    if (bot.id !== 'atlas') chosen.push('atlas');
    while (chosen.length < 2) { const r = pick(pool); if (!chosen.includes(r)) chosen.push(r); }
    for (const r of chosen.slice(0, 3)) {
      setWatch(r, addr); termPush(r, `> inspect $${t.symbol} --as ${BOT[r].role.toLowerCase().replace(/ /g, '-')}`, 'cmd'); await sleep(300);
      for (const l of v[r].lines.slice(0, 2)) { termPush(r, l, 'res'); await sleep(220); }
      setView(r, v[r]); await typing(r, rand(1200, 2100));
      post(r, ME.message(r, s, v[r], { bot: bot.id, side: mv.side })); await sleep(rand(400, 800));
    }
    stage(3, `rug check <b>$${esc(t.symbol)}</b> · risk ${s.risk.score}/100 ${s.risk.level} · ATLAS ${v.atlas.risk}`);
    await sleep(700);
    if (v.atlas.risk !== 'VETO') for (const id of ['nova', 'luna', 'echo', 'vex']) if (v[id].side === 'BUY' && v[id].conv >= .5) openPaper(id, t, s);
    const idea = ME.buildIdea(t, s, v, Date.now()); if (idea) idea.sup = supOf(t);
    if (idea && !ideas.some(i => i.addr === t.addr && i.status === 'OPEN') && Date.now() - lastIdeaAt > 45000) {
      lastIdeaAt = Date.now(); const pres = idea.agree.includes(bot.id) && bot.id !== 'atlas' ? bot.id : idea.agree[0];
      await typing(pres, 1500);
      post(pres, `📌 Meme idea (PAPER): buy $${t.symbol} at ${MCv(idea.sup, idea.entry)} mcap, stop ${MCv(idea.sup, idea.stop)} mcap (−${idea.stopPct.toFixed(1)}%), target ${MCv(idea.sup, idea.target)} mcap. Agreed: ${idea.agree.map(i => BOT[i].name).join(', ')}. Risk ${idea.risk.level}. Could go to zero. Not advice.`, { idea: true });
      addIdea(idea); stage(4, `<b style="color:var(--am)">PAPER IDEA</b> · $${esc(t.symbol)} · risk ${idea.risk.level}`);
      log('IDEA', `paper buy $${t.symbol} at ${MCv(idea.sup, idea.entry)} mcap · ${idea.confidence}`, '#fbbf24');
      toast(`<b style="color:var(--am)">✦ Meme idea:</b> <span class="up">BUY</span> <b>$${esc(t.symbol)}</b> at ${MCv(idea.sup, idea.entry)} mcap · <small>paper only · extreme risk · not advice</small>`);
    } else {
      stage(4, `no idea on $${esc(t.symbol)}${v.atlas.risk === 'VETO' ? ' · ATLAS veto ⛔' : idea ? ' · already tracking one' : ' · no consensus'}`);
      if (v.atlas.risk === 'VETO' && Math.random() < .6) sysMsg(`ATLAS vetoed $${t.symbol} · risk ${s.risk.score}/100`);
      else if (!idea && Math.random() < .3) sysMsg(`no consensus on $${t.symbol} · moving on`);
    }
    renderTable();
  }
  async function deskLoop() {
    for (let i = 0; i < 120 && !tracked.length; i++) await sleep(500);
    sysMsg('meme desk online · 5 bots scanning BSC memecoins · paper only');
    for (; ;) { try { await runCycle(); } catch (e) { console.error(e); log('ERR', e.message, '#ff4d6d'); } await sleep(rand(2500, 4000)); }
  }
  function idle() {
    BOTS.forEach(b => {
      if (b.id === activeId || Math.random() < .5) return; const t = T.get(botWatch[b.id] || pick(tracked)); if (!t || !t.sig) return; const s = t.sig;
      const L = { nova: `> $${t.symbol} mc ${MC(t)} Δ5m ${ME.sg(t.chg.m5)} vol ${ME.f2(s.volAccel)}x`, luna: `> $${t.symbol} mc ${MC(t)} rsi ${ME.f1(s.rsi)} 24h ${ME.sg(t.chg.h24)}`, atlas: `> $${t.symbol} risk ${s.risk.score} liq ${ME.usd(t.liq)}`, echo: `> $${t.symbol} buys 5m ${ME.pct(s.br5)} tx1h ${s.tx1}`, vex: `> $${t.symbol} crowd ${s.br1 > .65 ? 'euphoric' : s.br1 < .4 ? 'scared' : 'meh'}` };
      termPush(b.id, L[b.id]);
    });
  }

  // ---------- search (DexScreener, BSC only; accepts token or pair address) ----------
  async function searchDS(q) {
    let pairs = [];
    if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
      try { const j = await getJSON(`${DS}/tokens/v1/bsc/${q}`); pairs = Array.isArray(j) ? j : []; } catch (e) { }
      if (!pairs.length) { try { const j = await getJSON(`${DS}/latest/dex/pairs/bsc/${q}`); pairs = j.pairs || (j.pair ? [j.pair] : []); } catch (e) { } }
    } else {
      const j = await getJSON(`${DS}/latest/dex/search?q=${encodeURIComponent(q)}`); pairs = j.pairs || [];
    }
    pairs = pairs.filter(p => p && p.chainId === 'bsc' && p.baseToken && p.priceUsd);
    const best = new Map();
    for (const p of pairs) { const a = p.baseToken.address.toLowerCase(), l = (p.liquidity && p.liquidity.usd) || 0; if (!best.has(a) || l > ((best.get(a).liquidity || {}).usd || 0)) best.set(a, p); }
    const all = [...T.values()];
    return [...best.values()].sort((a, b) => ((b.volume || {}).h24 || 0) - ((a.volume || {}).h24 || 0)).slice(0, 10).map(p => { const t = ME.toToken(p); return { p, t, r: ME.risk(t, all), junk: ME.junkReason(p) }; });
  }
  function addToken(p) {
    const t = upsert(p), a = t.addr.toLowerCase();
    if (!tracked.includes(a)) { tracked.push(a); userAdded.add(a); }
    recompute(); putOnWall(a, null); userFocus(a);
    pendingAddr = a;
    log('SEARCH', `you opened $${t.symbol} (${t.pair.slice(0, 8)}…) · bots will inspect it next`, '#f0b90b');
    sysMsg(`you asked the desk to look at $${t.symbol} · next bot on rotation will inspect it`);
    toast(`<b style="color:var(--bnb)">⌕ $${esc(t.symbol)}</b> opened · ${MC(t)} mcap · ${ME.usd(t.liq)} liquidity · bots will discuss it next · <small>extreme risk, paper only</small>`);
    renderTable(); renderStats();
  }
  function buildSearch() {
    if (!window.makeSearch) return;
    window.makeSearch({
      input: $('#dsInput'), drop: $('#dsDrop'), debounce: 350, minLen: 2,
      hint: (q, it) => /^0x/.test(q) ? `address lookup on BSC · ${it.length} result(s)` : `DexScreener search · BSC only · ${it.length} token(s) · ↑↓ Enter`,
      source: searchDS,
      render: ({ t, r, junk }) => `${icon(t)}<span class="nm"><b>$${esc(t.symbol)}</b>${t.liq < ME.MIN_LIQ ? '<span class="lev" style="color:var(--dn)">⚠ LOW LIQ</span>' : junk === 'no-volume' ? '<span class="lev" style="color:var(--am)">⚠ NO VOL</span>' : ''}<small>${esc(t.name)} · ${esc(t.dex)} · /${esc(t.quote)} · ${ME.age(t.created)}</small></span><span class="rt">${capKind(t)} ${MC(t)}<small>liq ${ME.usd(t.liq)} · ${rbadge(r)}</small></span>`,
      onPick: it => addToken(it.p),
    });
  }

  // ---------- boot ----------
  async function init() {
    buildWall(); buildBots(); buildDesk(); buildSearch();
    log('BOOT', 'BNB meme desk starting', '#f0b90b');
    await discover();
    if (!tracked.length) { log('ERR', 'no tokens found, retrying in 30s', '#ff4d6d'); setTimeout(init, 30000); return; }
    wall = ranked().slice(0, WALL_N).map(t => t.addr.toLowerCase());
    wall.forEach((a, i) => { wallOpened[i] = 0; needCandles(a); });
    setFocus(wall[0]); renderTable(); renderStats(); renderWallHeads();
    setInterval(refreshHot, 6000);
    setInterval(refreshAll, 30000);
    setInterval(discover, 6 * 60000);
    setInterval(() => { wall.forEach(a => needCandles(a)); }, 60000);
    setInterval(() => { renderWallHeads(); updateFocusHead(); renderStats(); renderPaper(); renderIdeas(); if (view === 'desk') renderDesk(false); }, 2000);
    setInterval(renderTable, 6000);
    setInterval(idle, 3000);
    deskLoop();
    window.__memes = { addToken, searchDS, get pendingAddr() { return pendingAddr; }, T, get tracked() { return tracked; }, ideas, paper, get cycle() { return cycle; }, get junk() { return junk; } };
  }
  setInterval(() => { const u = Math.floor((Date.now() - T0) / 1000); $('#uptime').textContent = [u / 3600, (u % 3600) / 60, u % 60].map(x => String(Math.floor(x)).padStart(2, '0')).join(':'); }, 1000);
  init();
})();
