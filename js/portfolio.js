/* PORTFOLIO panel, shared by both pages. Reads both paper books from localStorage (td.* crypto, ts.* stocks),
   marks open positions to live prices (this page: live feed; other desk: Hyperliquid REST allMids), and renders
   balances (80/20 split), every open position and recent closed trades. Paper only. */
(function () {
  'use strict';
  const API = 'https://api.hyperliquid.xyz/info';
  const MK = { crypto: { ls: 'td', dex: '', page: './', label: 'CRYPTO', ic: '◆' }, stocks: { ls: 'ts', dex: 'xyz', page: 'stocks.html', label: 'STOCKS', ic: '▲' } };
  const TRADERS = ['nova', 'luna', 'echo', 'vex'];
  const mids = { crypto: {}, stocks: {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const usd = (x, d = 2) => (x < 0 ? '-$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
  const px = p => { if (!(p > 0)) return '—'; const d = p >= 1000 ? 2 : p >= 1 ? 3 : 6; return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const t = ms => new Date(ms).toLocaleString('en-GB', { hour12: false, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const here = () => (window.__desk && window.__desk.cfg && window.__desk.cfg.market) || 'crypto';
  async function pollMids() {
    for (const m of Object.keys(MK)) {
      if (m === here()) continue;
      try { const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(MK[m].dex ? { type: 'allMids', dex: MK[m].dex } : { type: 'allMids' }) }); const j = await r.json(); const pre = MK[m].dex ? MK[m].dex + ':' : ''; const o = {}; Object.keys(j).forEach(k => o[k.startsWith(pre) ? k.slice(pre.length) : k] = +j[k]); mids[m] = o; } catch (e) { }
    }
  }
  function price(m, coin, p) {
    if (m === here() && window.__desk && window.__desk.M[coin] && window.__desk.M[coin].price) return window.__desk.M[coin].price;
    return mids[m][coin] || (p && p.mark) || (window.__server && window.__server.markets[m].prices && window.__server.markets[m].prices[coin]) || null;
  }
  function load() {
    const R = window.Risk, out = { pos: [], closed: [], bots: {} };
    TRADERS.forEach(id => out.bots[id] = { crypto: null, stocks: null });
    for (const m of Object.keys(MK)) {
      const S = window.__server && window.__server.markets && window.__server.markets[m];
      const start = R.bookStart(m), book = S ? { accts: S.accts, open: S.open } : get(MK[m].ls + '.book.v3'), jr = S ? S.journal : (get(MK[m].ls + '.journal.v1') || []);
      TRADERS.forEach(id => {
        const a = book && book.accts && book.accts[id], realized = a ? a.equity : start;
        const open = ((book && book.open) || []).filter(p => p.bot === id);
        let unreal = 0;
        open.forEach(p => { const now = price(m, p.coin, p); const u = now ? (now - p.entry) * (p.side === 'LONG' ? 1 : -1) * p.qty : 0; unreal += u; out.pos.push(Object.assign({}, p, { market: m, now, upnl: u, upct: now ? (now / p.entry - 1) * 100 * (p.side === 'LONG' ? 1 : -1) : 0 })); });
        out.bots[id][m] = { start, realized, unreal, equity: realized + unreal, nOpen: open.length };
      });
      jr.forEach(j => out.closed.push(Object.assign({ market: m }, j)));
    }
    out.pos.sort((a, b) => b.opened - a.opened); out.closed.sort((a, b) => b.closedAt - a.closedAt);
    return out;
  }
  function render() {
    const root = document.getElementById('portfolio'); if (!root || !window.Engine || !window.Risk) return;
    const B = window.Engine.BOT, d = load(), R = window.Risk;
    let T = { eq: 0, start: 0, real: 0, unr: 0, c: 0, s: 0 };
    const rows = TRADERS.map(id => {
      const c = d.bots[id].crypto, s = d.bots[id].stocks, eq = c.equity + s.equity, st = c.start + s.start, real = (c.realized - c.start) + (s.realized - s.start), unr = c.unreal + s.unreal;
      T.eq += eq; T.start += st; T.real += real; T.unr += unr; T.c += c.equity; T.s += s.equity;
      const bk = (x, m) => `<div class="pf-bk"><b>${usd(x.equity)}</b><small class="${x.equity >= x.start ? 'up' : 'dn'}">${sgn((x.equity / x.start - 1) * 100)}% · ${x.nOpen} open</small><i style="width:${Math.min(100, x.equity / eq * 100).toFixed(1)}%" class="${m}"></i></div>`;
      return `<tr><td><b style="color:${B[id].color}">${B[id].name}</b></td><td class="big">${usd(eq)}</td><td>${bk(c, 'c')}</td><td>${bk(s, 's')}</td><td class="${real >= 0 ? 'up' : 'dn'}">${usd(real)}</td><td class="${unr >= 0 ? 'up' : 'dn'}">${usd(unr)}</td><td class="${eq >= st ? 'up' : 'dn'}">${sgn((eq / st - 1) * 100)}%</td></tr>`;
    }).join('');
    const tot = `<tr class="pf-tot"><td>ALL BOTS</td><td class="big">${usd(T.eq)}</td><td>${usd(T.c)} <small>${(T.c / T.eq * 100).toFixed(0)}%</small></td><td>${usd(T.s)} <small>${(T.s / T.eq * 100).toFixed(0)}%</small></td><td class="${T.real >= 0 ? 'up' : 'dn'}">${usd(T.real)}</td><td class="${T.unr >= 0 ? 'up' : 'dn'}">${usd(T.unr)}</td><td class="${T.eq >= T.start ? 'up' : 'dn'}">${sgn((T.eq / T.start - 1) * 100)}%</td></tr>`;
    const tag = m => `<span class="pf-mk ${m}">${MK[m].ic} ${MK[m].label}</span>`;
    const pos = d.pos.length ? d.pos.map(p => `<tr class="pf-row" data-m="${p.market}" data-c="${esc(p.coin)}" title="open ${esc(p.coin)} chart"><td class="mut">${esc(p.ticket || '—')}</td><td><b style="color:${B[p.bot].color}">${B[p.bot].name}</b></td><td>${tag(p.market)} <b class="asset">${esc(p.coin)}</b></td><td><span class="side-pill ${p.side === 'LONG' ? 'L' : 'S'}">${p.side === 'LONG' ? '▲ LONG' : '▼ SHORT'}</span></td><td>${(+p.qty).toPrecision(4)}<small> ${esc(p.coin)}</small><br><small>${usd(p.notional, 0)}</small></td><td>${px(p.entry)}</td><td><b>${px(p.now)}</b></td><td class="dn">${px(p.stop)}</td><td class="up">${px(p.target)}</td><td class="${p.upnl >= 0 ? 'up' : 'dn'}"><b>${usd(p.upnl)}</b><br><small>${sgn(p.upct)}%</small></td><td class="mut">${t(p.opened)}</td></tr>`).join('') : '<tr class="ph"><td colspan="11">no open paper positions right now · bots open them after a debate when ATLAS allows</td></tr>';
    const cl = d.closed.slice(0, 12).map(j => `<tr class="pf-row" data-m="${j.market}" data-c="${esc(j.coin)}"><td class="mut">${esc(j.ticket || '#' + j.n)}</td><td><b style="color:${B[j.bot].color}">${B[j.bot].name}</b></td><td>${tag(j.market)} <b class="asset">${esc(j.coin)}</b></td><td class="${j.side === 'LONG' ? 'up' : 'dn'}">${j.side}</td><td>${px(j.entry)}</td><td>${px(j.exit)}</td><td class="${j.pnl >= 0 ? 'up' : 'dn'}"><b>${usd(j.pnl)}</b> <small>${sgn(j.r)}R</small></td><td class="mut">${esc(j.reason || '')}</td><td class="mut">${t(j.closedAt)}</td></tr>`).join('') || '<tr class="ph"><td colspan="9">no closed trades yet</td></tr>';
    root.innerHTML = `<div class="panel-head"><div class="ph-title big"><span class="ic spark">₿</span> PORTFOLIO · BALANCES &amp; POSITIONS</div><div class="paper-badge">PAPER · $${R.TOTAL_PER_BOT.toLocaleString('en-US')} per bot = ${R.ALLOC.crypto * 100}% crypto ($${R.bookStart('crypto').toLocaleString('en-US')}) + ${R.ALLOC.stocks * 100}% stocks ($${R.bookStart('stocks').toLocaleString('en-US')}) · ATLAS = risk officer, no book</div></div>
      <div class="pf-src">${window.__server ? `🖥 shared server state · engine runs 24/7 on GitHub Actions · last run <b>${Math.max(0, Math.floor((Date.now() - window.__server.lastRun) / 60000))} min ago</b> (#${window.__server.runs}) · paper period since <b>${new Date(window.__server.startedAt).toLocaleString('en-GB', { hour12: false, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b> · live prices for unrealized P&amp;L` : 'loading server state…'}</div>
      <div class="pf-wrap"><table class="pf-table"><thead><tr><th>BOT</th><th>TOTAL EQUITY</th><th>◆ CRYPTO BOOK (80%)</th><th>▲ STOCKS BOOK (20%)</th><th>REALIZED P&amp;L</th><th>UNREALIZED</th><th>% CHANGE</th></tr></thead><tbody>${rows}${tot}</tbody></table></div>
      <h3 class="pf-h">OPEN POSITIONS <span class="count">${d.pos.length}</span> <small>click a row to open its chart</small></h3>
      <div class="pf-wrap"><table class="pf-table"><thead><tr><th>ID</th><th>BOT</th><th>ASSET</th><th>SIDE</th><th>SIZE</th><th>ENTRY</th><th>NOW</th><th>STOP</th><th>TARGET</th><th>UNREALIZED</th><th>OPENED</th></tr></thead><tbody>${pos}</tbody></table></div>
      <h3 class="pf-h">RECENT CLOSED</h3>
      <div class="pf-wrap"><table class="pf-table"><thead><tr><th>ID</th><th>BOT</th><th>ASSET</th><th>SIDE</th><th>ENTRY</th><th>EXIT</th><th>P&amp;L</th><th>REASON</th><th>CLOSED</th></tr></thead><tbody>${cl}</tbody></table></div>`;
  }
  document.addEventListener('click', e => {
    const r = e.target.closest && e.target.closest('#portfolio .pf-row'); if (!r) return;
    const m = r.dataset.m, c = r.dataset.c;
    if (m === here() && window.__desk && window.__desk.openAsset) window.__desk.openAsset(c); else location.href = MK[m].page + '?coin=' + encodeURIComponent(c);
  });
  function start() { pollMids().then(render); setInterval(pollMids, 10000); setInterval(render, 2000); setTimeout(render, 3000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
