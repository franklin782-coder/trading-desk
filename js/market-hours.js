/* US equity session status (NYSE regular hours 9:30–16:00 America/New_York, Mon–Fri).
   Pure + unit-tested. Exchange holidays are not modelled. Hyperliquid HIP-3 stock perps trade 24/7;
   outside regular hours their price is set by perp traders only, so the stocks desk shows this badge. */
(function (root) {
  'use strict';
  function nyParts(now) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    const o = {}; f.formatToParts(new Date(now)).forEach(p => o[p.type] = p.value);
    return { wd: o.weekday, min: (+o.hour % 24) * 60 + +o.minute };
  }
  function usMarketStatus(now) {
    const { wd, min } = nyParts(now == null ? Date.now() : now);
    if (wd === 'Sat' || wd === 'Sun') return { state: 'CLOSED', label: 'US MARKET CLOSED · weekend' };
    if (min >= 570 && min < 960) return { state: 'OPEN', label: 'US MARKET OPEN' };
    if (min >= 240 && min < 570) return { state: 'PRE', label: 'PRE-MARKET' };
    if (min >= 960 && min < 1200) return { state: 'AFTER', label: 'AFTER-HOURS' };
    return { state: 'CLOSED', label: 'US MARKET CLOSED' };
  }
  const MH = { usMarketStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = MH;
  else {
    root.MarketHours = MH;
    const paint = () => { const e = document.getElementById('mktStatus'); if (!e) return; const s = usMarketStatus(); e.textContent = s.label + ' · perps 24/7'; e.className = 'mkt-st ' + s.state.toLowerCase(); };
    if (typeof document !== 'undefined') { document.addEventListener('DOMContentLoaded', paint); setInterval(paint, 30000); }
  }
})(typeof window !== 'undefined' ? window : globalThis);
