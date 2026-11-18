/* Portfolio view: equity curve, stats, P&L calendar (UTC+5), history tabs, CSV. */
(function (root) {
  'use strict';
  const M = root.DemoMarkets;
  const B = root.DemoBook;
  let eqChart = null, eqSeries = null;

  function $(sel, el) { return (el || document).querySelector(sel); }
  function cls(n) { return n > 0 ? 'up' : n < 0 ? 'dn' : ''; }
  function usd(n, d) {
    const x = +n || 0;
    const sign = x < 0 ? '-' : '';
    return sign + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function signedUsd(n) {
    const x = +n || 0;
    const s = x > 0 ? '+' : x < 0 ? '-' : '';
    return s + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(n) {
    const x = +n || 0;
    return (x > 0 ? '+' : '') + x.toFixed(2) + '%';
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function formatEquityAxis(price) {
    const x = +price || 0;
    const sign = x < 0 ? '-' : '';
    return sign + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function equitySeries(book, marks) {
    const log = (B.normalizeEquityLog ? B.normalizeEquityLog(book.equityLog || []) : (book.equityLog || [])).slice();
    const nowEq = B.equity(book, marks);
    const nowT = Date.now();
    if (!log.length || log[log.length - 1].t < nowT - 2000) log.push({ t: nowT, equity: nowEq });
    else log[log.length - 1] = { t: Math.max(log[log.length - 1].t, nowT), equity: nowEq };
    const bySec = Object.create(null);
    log.forEach(function (p) {
      if (!p || !(p.t > 0) || !isFinite(+p.equity)) return;
      bySec[Math.floor(p.t / 1000)] = +p.equity;
    });
    return Object.keys(bySec).map(Number).sort(function (a, b) { return a - b; }).map(function (time) {
      return { time: time, value: bySec[time] };
    });
  }

  function renderEquity(el, book, marks) {
    if (!root.LightweightCharts || !el) return;
    const data = equitySeries(book, marks);
    if (eqChart) {
      try { eqChart.remove(); } catch (e) { /* */ }
      eqChart = null;
    }
    eqChart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { color: '#000' }, textColor: '#B2B5BE', fontFamily: "Trebuchet MS, Segoe UI, Arial, sans-serif" },
      grid: { vertLines: { color: '#2A2A2A' }, horzLines: { color: '#2A2A2A' } },
      rightPriceScale: { borderColor: '#2A2A2A' },
      timeScale: { borderColor: '#2A2A2A', tickMarkFormatter: M.tickMarkFormatter, timeVisible: true },
      localization: { timeFormatter: M.timeFormatter, priceFormatter: formatEquityAxis },
      crosshair: { vertLine: { color: '#787B86' }, horzLine: { color: '#787B86' } },
      handleScroll: true, handleScale: true
    });
    eqSeries = eqChart.addLineSeries({ color: '#22d3ee', lineWidth: 2, priceFormat: { type: 'custom', minMove: 0.01, formatter: formatEquityAxis } });
    if (data.length) eqSeries.setData(data);
    eqChart.timeScale().fitContent();
  }

  function calendarHtml(stats, year, month) {
    const cells = M.monthGrid(year, month);
    const today = M.dayKey(Date.now());
    let monthPnl = 0, monthTrades = 0;
    cells.forEach(function (c) {
      if (!c.inMonth) return;
      const d = stats.daily[c.key];
      if (d) { monthPnl += d.pnl || 0; monthTrades += d.trades || 0; }
    });
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let h = '<div class="cal-wrap"><div class="cal-nav">';
    h += '<button type="button" class="mini-btn" data-cal="-1">←</button>';
    h += '<h3>' + M.monthTitle(year, month) + ' <span class="opt">UTC+5</span></h3>';
    h += '<button type="button" class="mini-btn" data-cal="1">→</button>';
    h += '<div class="cal-total ' + cls(monthPnl) + '">' + signedUsd(monthPnl) + ' · ' + monthTrades + ' trades</div></div>';
    h += '<div class="cal-week">' + wd.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
    h += '<div class="cal-grid">';
    cells.forEach(function (c) {
      const d = stats.daily[c.key] || null;
      const pnl = d ? d.pnl : 0;
      const klass = ['cal-day', c.inMonth ? '' : 'out', d && pnl > 0 ? 'up' : '', d && pnl < 0 ? 'dn' : '', c.key === today ? 'today' : ''].filter(Boolean).join(' ');
      h += '<div class="' + klass + '" data-day="' + c.key + '"><span class="d">' + c.d + '</span>';
      if (d && (d.trades || d.pnl)) {
        h += '<span class="pnl ' + cls(pnl) + '">' + signedUsd(pnl) + '</span>';
        h += '<span class="n">' + (d.trades || 0) + ' trade' + (d.trades === 1 ? '' : 's') + '</span>';
      }
      h += '</div>';
    });
    h += '</div></div>';
    return h;
  }

  function render(el, book, marks, ui) {
    if (!el) return;
    const stats = B.portfolioStats(book, marks || {}, Date.now());
    const now = new Date(Date.now() + M.TZ_OFFSET_SEC * 1000);
    const year = (ui && ui.calYear) || now.getUTCFullYear();
    const month = (ui && ui.calMonth) || (now.getUTCMonth() + 1);
    const best = stats.best ? (stats.best.coin + ' ' + signedUsd(stats.best.net)) : '—';
    const worst = stats.worst ? (stats.worst.coin + ' ' + signedUsd(stats.worst.net)) : '—';
    const pf = !isFinite(stats.profitFactor) ? '∞' : (stats.profitFactor ? stats.profitFactor.toFixed(2) : '—');

    let html = '<section class="desk-stats port-hero">';
    [['ACCOUNT VALUE', usd(stats.equity)], ['P&L 24H', signedUsd(stats.pnl24h), cls(stats.pnl24h)],
      ['P&L 7D', signedUsd(stats.pnl7d), cls(stats.pnl7d)], ['P&L 30D', signedUsd(stats.pnl30d), cls(stats.pnl30d)],
      ['P&L ALL TIME', signedUsd(stats.pnlAll), cls(stats.pnlAll)]
    ].forEach(function (s) {
      html += '<div class="stat"><label>' + s[0] + '</label><b class="' + (s[2] || '') + '">' + s[1] + '</b></div>';
    });
    html += '</section><div class="port-grid">';
    html += '<section class="panel"><div class="panel-head"><div class="ph-title">EQUITY CURVE</div><div class="ph-note">UTC+5</div></div><div id="eqChart" class="eq-chart"></div></section>';
    html += '<section class="panel"><div class="panel-head"><div class="ph-title">STATS</div></div><div class="port-stats">';
    const rows = [
      ['Max drawdown', usd(-Math.abs(stats.maxDrawdown)) + ' (' + stats.maxDrawdownPct.toFixed(2) + '%)'],
      ['Win rate', stats.trades ? stats.winRate.toFixed(1) + '% (' + stats.wins + '/' + stats.trades + ')' : '—'],
      ['Avg win', signedUsd(stats.avgWin)], ['Avg loss', signedUsd(stats.avgLoss)],
      ['Profit factor', pf], ['Best trade', best], ['Worst trade', worst],
      ['Fees paid', usd(stats.feesPaid)], ['Funding paid', usd(stats.fundingPaid)],
      ['Open positions', String((book.positions || []).length)]
    ];
    rows.forEach(function (r) {
      html += '<div class="kv"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
    });
    html += '</div></section></div>';

    html += '<section class="panel" style="margin-top:12px"><div class="panel-head"><div class="ph-title">TRADES BY MARKET</div></div><div class="paper-wrap"><table class="paper-table"><thead><tr><th>Market</th><th>Trades</th><th>Net P&amp;L</th><th>Fees</th></tr></thead><tbody>';
    (stats.byMarket || []).forEach(function (m) {
      html += '<tr><td>' + M.shortName(m.coin) + '</td><td>' + m.trades + '</td><td class="' + cls(m.net) + '">' + signedUsd(m.net) + '</td><td>' + usd(m.fees) + '</td></tr>';
    });
    html += '</tbody></table></div></section>';

    html += '<section class="panel" style="margin-top:12px"><div class="panel-head"><div class="ph-title">P&amp;L CALENDAR</div></div>';
    html += calendarHtml(stats, year, month) + '</section>';

    html += '<section class="panel demo-book" style="margin-top:12px"><div class="panel-head tab-head"><div class="port-tabs book-tabs" id="portTabs">';
    [['pos', 'Positions'], ['ord', 'Open Orders'], ['hist', 'Trade History'], ['fund', 'Funding History'], ['oh', 'Order History']].forEach(function (t, i) {
      html += '<button type="button" class="' + (i === 0 ? 'on' : '') + '" data-ptab="' + t[0] + '">' + t[1] + '</button>';
    });
    html += '</div><div class="csv-btns">';
    html += '<button type="button" class="mini-btn" id="csvTrades">CSV trades</button>';
    html += '<button type="button" class="mini-btn" id="csvFund">CSV funding</button>';
    html += '<button type="button" class="mini-btn" id="csvOrd">CSV orders</button></div></div>';

    html += '<div class="paper-wrap" data-pbody="pos"><table class="paper-table"><thead><tr><th>Market</th><th>ID</th><th>Side</th><th>Size</th><th>Entry</th><th>P&amp;L</th></tr></thead><tbody>';
    if (!(book.positions || []).length) html += '<tr class="ph"><td colspan="6">no open positions</td></tr>';
    (book.positions || []).forEach(function (p) {
      const px = marks[p.coin] || p.entry;
      const u = root.DemoCalc.unrealized(p.side, p.entry, px, p.qty);
      html += '<tr><td>' + M.shortName(p.coin) + '</td><td>' + p.id + '</td><td class="side-pill ' + p.side + '">' + p.side.toUpperCase() + '</td><td>' + p.qty + '</td><td>' + p.entry + '</td><td class="' + cls(u) + '">' + signedUsd(u) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="paper-wrap" data-pbody="ord" hidden><table class="paper-table"><thead><tr><th>Time (UTC+5)</th><th>ID</th><th>Market</th><th>Type</th><th>Side</th><th>Price</th><th>Status</th></tr></thead><tbody>';
    const pend = book.pending || [];
    if (!pend.length) html += '<tr class="ph"><td colspan="7">no open orders</td></tr>';
    pend.forEach(function (o) {
      html += '<tr><td>' + M.formatDateTime(o.t) + '</td><td>' + o.id + '</td><td>' + M.shortName(o.coin) + '</td><td>' + (o.typ || '') + '</td><td>' + o.side + '</td><td>' + (o.limitPx || o.triggerPx || '') + '</td><td>' + (o.status || '') + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="paper-wrap" data-pbody="hist" hidden><table class="paper-table"><thead><tr><th>Closed (UTC+5)</th><th>ID</th><th>Market</th><th>Side</th><th>Entry → Exit</th><th>Reason</th><th>P&amp;L</th></tr></thead><tbody>';
    if (!(book.history || []).length) html += '<tr class="ph"><td colspan="7">no trade history</td></tr>';
    (book.history || []).forEach(function (h) {
      html += '<tr><td>' + M.formatDateTime(Date.parse(h.closedAt)) + '</td><td>' + h.id + '</td><td>' + M.shortName(h.coin) + '</td><td class="side-pill ' + h.side + '">' + h.side + '</td><td>' + h.entry + ' → ' + h.exit + '</td><td>' + (h.reason || '') + '</td><td class="' + cls(h.net) + '">' + signedUsd(h.net) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="paper-wrap" data-pbody="fund" hidden><table class="paper-table"><thead><tr><th>Time (UTC+5)</th><th>Market</th><th>Rate</th><th>Payment</th></tr></thead><tbody>';
    if (!(book.funding || []).length) html += '<tr class="ph"><td colspan="4">no funding history</td></tr>';
    (book.funding || []).slice(0, 200).forEach(function (f) {
      html += '<tr><td>' + M.formatDateTime(f.t) + '</td><td>' + M.shortName(f.coin) + '</td><td>' + f.rate + '</td><td class="' + cls(-f.payment) + '">' + signedUsd(-f.payment) + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="paper-wrap" data-pbody="oh" hidden><table class="paper-table"><thead><tr><th>Time (UTC+5)</th><th>ID</th><th>Market</th><th>Type</th><th>Side</th><th>Status</th><th>Price</th></tr></thead><tbody>';
    if (!(book.orders || []).length) html += '<tr class="ph"><td colspan="7">no order history</td></tr>';
    (book.orders || []).slice(0, 300).forEach(function (o) {
      html += '<tr><td>' + M.formatDateTime(o.t) + '</td><td>' + o.id + '</td><td>' + M.shortName(o.coin) + '</td><td>' + (o.typ || '') + '</td><td>' + (o.side || '') + '</td><td>' + (o.status || '') + '</td><td>' + (o.price || '') + '</td></tr>';
    });
    html += '</tbody></table></div></section>';

    el.innerHTML = html;
    renderEquity($('#eqChart', el), book, marks);

    el.querySelectorAll('[data-cal]').forEach(function (b) {
      b.addEventListener('click', function () {
        let y = year, m = month + (+b.getAttribute('data-cal'));
        if (m < 1) { m = 12; y--; }
        if (m > 12) { m = 1; y++; }
        if (ui) { ui.calYear = y; ui.calMonth = m; B.saveUi(ui); }
        render(el, book, marks, ui);
      });
    });
    el.querySelectorAll('#portTabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        el.querySelectorAll('#portTabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
        const tab = b.getAttribute('data-ptab');
        el.querySelectorAll('[data-pbody]').forEach(function (p) { p.hidden = p.getAttribute('data-pbody') !== tab; });
      });
    });
    const csvTrades = $('#csvTrades', el), csvFund = $('#csvFund', el), csvOrd = $('#csvOrd', el);
    if (csvTrades) csvTrades.onclick = function () { download('demo-trades.csv', B.csvTrades(book)); };
    if (csvFund) csvFund.onclick = function () { download('demo-funding.csv', B.csvFunding(book)); };
    if (csvOrd) csvOrd.onclick = function () { download('demo-orders.csv', B.csvOrders(book)); };
  }

  function destroy() {
    if (eqChart) { try { eqChart.remove(); } catch (e) { /* */ } eqChart = null; }
  }

  root.DemoPortfolio = { render: render, destroy: destroy };
})(typeof window !== 'undefined' ? window : this);
