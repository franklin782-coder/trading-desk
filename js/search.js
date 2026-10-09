/* Tiny autocomplete widget shared by both pages: debounce, keyboard nav (↑ ↓ Enter Esc), "/" to focus */
(function (root) {
  'use strict';
  root.makeSearch = function ({ input, drop, source, render, onPick, hint, debounce = 120, minLen = 1 }) {
    let items = [], sel = -1, timer = null, seq = 0;
    const close = () => { drop.classList.remove('open'); sel = -1; };
    const paint = () => {
      drop.querySelectorAll('.sitem').forEach((e, i) => e.classList.toggle('sel', i === sel));
      const s = drop.querySelector('.sitem.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
    };
    const show = (list, q, msg) => {
      items = list || []; sel = items.length ? 0 : -1;
      drop.innerHTML = (hint ? `<div class="shint">${hint(q, items)}</div>` : '') + (items.length ? items.map((it, i) => `<div class="sitem" role="option" data-i="${i}">${render(it)}</div>`).join('') : `<div class="sempty">${msg || 'no matches'}</div>`);
      drop.classList.add('open'); paint();
    };
    async function run() {
      const q = input.value.trim(); const my = ++seq;
      if (q.length < minLen) { close(); return; }
      drop.innerHTML = '<div class="sempty">searching…</div>'; drop.classList.add('open');
      try { const r = await source(q); if (my === seq) show(r, q); }
      catch (e) { if (my === seq) show([], q, 'search failed: ' + (e && e.message ? e.message : e)); }
    }
    const pick = i => { const it = items[i]; if (!it) return; close(); input.value = ''; input.blur(); onPick(it); };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, debounce); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= minLen) run(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!drop.classList.contains('open')) { run(); return; } if (items.length) { sel = (sel + 1) % items.length; paint(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { sel = (sel - 1 + items.length) % items.length; paint(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (sel >= 0) pick(sel); else run(); }
      else if (e.key === 'Escape') { close(); input.blur(); }
    });
    drop.addEventListener('mousedown', e => { const it = e.target.closest('.sitem'); if (it) { e.preventDefault(); pick(+it.dataset.i); } });
    drop.addEventListener('mousemove', e => { const it = e.target.closest('.sitem'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; paint(); } });
    input.addEventListener('blur', () => setTimeout(close, 150));
    document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); input.focus(); } });
    return { close };
  };
})(window);
