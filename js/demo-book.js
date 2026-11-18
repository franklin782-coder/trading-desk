/* Shared paper account: migrate v1, cross/isolated, funding, portfolio stats, CSV. */
(function (root, factory) {
  const api = factory(root.DemoCalc, root.DemoMarkets);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DemoBook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, M) {
  'use strict';
  if (typeof require === 'function') {
    if (!C) C = require('./demo-calc.js');
    if (!M) M = require('./demo-markets.js');
  }

  const LS_V1 = 'td-demo-xyz100-v1';
  const LS_V2 = 'td-demo-account-v2';
  const LS_UI = 'td-demo-ui-v1';
  const START = M.START_BALANCE;

  function nowMs() { return Date.now(); }

  function defaultBook() {
    return {
      version: 2,
      balance: START,
      positions: [],
      pending: [],
      orders: [],
      history: [],
      funding: [],
      equityLog: [{ t: nowMs(), equity: START }],
      seq: 1,
      lastFundingHour: M.currentFundingHour(nowMs()),
      defaultMarginMode: 'cross',
      accountMode: 'unified',
      dexCash: { main: START, xyz: 0 }
    };
  }

  function tagLegacy(list, coin) {
    return (list || []).map(function (x) {
      const o = Object.assign({}, x);
      if (!o.coin) o.coin = coin;
      if (!o.marginMode) o.marginMode = 'isolated';
      return o;
    });
  }

  function migrateV1(raw) {
    const coin = 'xyz:XYZ100';
    const b = defaultBook();
    b.balance = +raw.balance || START;
    b.positions = tagLegacy(raw.positions, coin);
    b.pending = tagLegacy(raw.pending, coin);
    b.orders = tagLegacy(raw.orders || raw.pending, coin);
    b.history = tagLegacy(raw.history, coin);
    b.seq = +raw.seq || 1;
    b.equityLog = [{ t: nowMs(), equity: b.balance }];
    b.migratedFrom = 'v1';
    return b;
  }

  function loadFromStorage(storage) {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return defaultBook();
    try {
      const v2 = ls.getItem(LS_V2);
      if (v2) {
        const b = JSON.parse(v2);
        if (b && typeof b === 'object') {
          if (!Array.isArray(b.funding)) b.funding = [];
          if (!Array.isArray(b.orders)) b.orders = b.pending ? b.pending.slice() : [];
          if (!Array.isArray(b.equityLog)) b.equityLog = [{ t: nowMs(), equity: +b.balance || START }];
          if (!b.lastFundingHour) b.lastFundingHour = M.currentFundingHour(nowMs());
          if (!b.defaultMarginMode) b.defaultMarginMode = 'cross';
          if (!b.accountMode) b.accountMode = 'unified';
          if (!b.dexCash) b.dexCash = { main: +b.balance || START, xyz: 0 };
          b.version = 2;
          return b;
        }
      }
    } catch (e) { /* ignore */ }
    try {
      const v1 = ls.getItem(LS_V1);
      if (v1) {
        const raw = JSON.parse(v1);
        if (raw && typeof raw === 'object') return migrateV1(raw);
      }
    } catch (e) { /* ignore */ }
    return defaultBook();
  }

  function saveToStorage(book, storage) {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return;
    try { ls.setItem(LS_V2, JSON.stringify(book)); } catch (e) { /* quota */ }
  }

  function defaultUi() {
    return {
      view: 'trade',
      layout: 1,
      activePane: 0,
      panes: [{ id: 0, coin: 'xyz:XYZ100', tf: '1m' }],
      calYear: null,
      calMonth: null
    };
  }

  function loadUi(storage) {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const d = defaultUi();
    if (!ls) return d;
    try {
      const raw = ls.getItem(LS_UI);
      if (!raw) return d;
      const u = JSON.parse(raw);
      if (!u || typeof u !== 'object') return d;
      if (u.view === 'portfolio' || u.view === 'trade') d.view = u.view;
      if (u.layout === 1 || u.layout === 2 || u.layout === 4) d.layout = u.layout;
      if (Array.isArray(u.panes) && u.panes.length) {
        d.panes = u.panes.map(function (p, i) {
          const coin = (p && M.byId(p.coin)) ? p.coin : (i === 1 ? 'xyz:SP500' : 'xyz:XYZ100');
          return { id: i, coin: coin, tf: '1m' };
        });
      }
      d.activePane = Math.max(0, Math.min(d.panes.length - 1, +u.activePane || 0));
      if (u.calYear) d.calYear = +u.calYear;
      if (u.calMonth) d.calMonth = +u.calMonth;
      return d;
    } catch (e) { return d; }
  }

  function saveUi(ui, storage) {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return;
    try { ls.setItem(LS_UI, JSON.stringify(ui)); } catch (e) { /* quota */ }
  }

  function panesForLayout(layout, existing) {
    const n = layout === 4 ? 4 : layout === 2 ? 2 : 1;
    const defaults = ['xyz:XYZ100', 'xyz:SP500', 'BTC', 'SOL'];
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = (existing || [])[i];
      out.push({
        id: i,
        coin: (prev && M.byId(prev.coin)) ? prev.coin : defaults[i],
        tf: (prev && prev.tf) || '1m'
      });
    }
    return out;
  }

  function nextId(book, prefix) {
    book.seq = (book.seq || 0) + 1;
    const d = new Date();
    const shift = new Date(d.getTime() + M.TZ_OFFSET_SEC * 1000);
    const y = shift.getUTCFullYear();
    const m = String(shift.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shift.getUTCDate()).padStart(2, '0');
    return prefix + '-' + y + m + day + '-' + String(book.seq).padStart(3, '0');
  }

  function usedMargin(book) {
    return (book.positions || []).reduce(function (s, p) { return s + (p.margin || 0); }, 0);
  }

  function upnlTotal(book, marks) {
    return (book.positions || []).reduce(function (s, p) {
      const px = marks && marks[p.coin] != null ? marks[p.coin] : p.mark || p.entry;
      return s + C.unrealized(p.side, p.entry, px, p.qty);
    }, 0);
  }

  function equity(book, marks) { return (+book.balance || 0) + upnlTotal(book, marks); }

  function totalMM(book, marks) {
    return (book.positions || []).reduce(function (s, p) {
      const px = marks && marks[p.coin] != null ? marks[p.coin] : p.mark || p.entry;
      const lev = p.maxLeverage || p.leverage || 10;
      return s + C.maintenanceUsd(p.qty, px, lev);
    }, 0);
  }

  function freeMargin(book, marks) {
    return equity(book, marks) - usedMargin(book);
  }


  function dexOfCoin(coin) {
    return String(coin || '').indexOf('xyz:') === 0 ? 'xyz' : 'main';
  }

  function ensureDex(book) {
    if (!book.accountMode) book.accountMode = 'unified';
    if (!book.dexCash) book.dexCash = { main: +book.balance || 0, xyz: 0 };
  }

  function adjustCash(book, dex, delta) {
    ensureDex(book);
    book.balance = (+book.balance || 0) + delta;
    if (book.accountMode === 'standard') {
      const k = dex === 'xyz' ? 'xyz' : 'main';
      book.dexCash[k] = (+book.dexCash[k] || 0) + delta;
    }
  }

  function usedMarginOn(book, dex) {
    return (book.positions || []).reduce(function (s, p) {
      if (dex && dexOfCoin(p.coin) !== dex) return s;
      return s + (p.margin || 0);
    }, 0);
  }

  function upnlOn(book, marks, dex, marginMode) {
    return (book.positions || []).reduce(function (s, p) {
      if (dex && dexOfCoin(p.coin) !== dex) return s;
      if (marginMode && (p.marginMode || 'cross') !== marginMode) return s;
      const px = marks && marks[p.coin] != null ? marks[p.coin] : p.mark || p.entry;
      return s + C.unrealized(p.side, p.entry, px, p.qty);
    }, 0);
  }

  function mmOn(book, marks, dex, marginMode) {
    return (book.positions || []).reduce(function (s, p) {
      if (dex && dexOfCoin(p.coin) !== dex) return s;
      if (marginMode && (p.marginMode || 'cross') !== marginMode) return s;
      const px = marks && marks[p.coin] != null ? marks[p.coin] : p.mark || p.entry;
      const lev = p.maxLeverage || p.leverage || 10;
      return s + C.maintenanceUsd(p.qty, px, lev);
    }, 0);
  }

  function cashOf(book, dex) {
    ensureDex(book);
    if (book.accountMode === 'standard') return +book.dexCash[dex === 'xyz' ? 'xyz' : 'main'] || 0;
    return +book.balance || 0;
  }

  function equityOf(book, marks, dex) {
    if (book.accountMode !== 'standard' || !dex) return equity(book, marks);
    return cashOf(book, dex) + upnlOn(book, marks, dex);
  }

  function freeOf(book, marks, dex) {
    if (book.accountMode !== 'standard' || !dex) return freeMargin(book, marks);
    return equityOf(book, marks, dex) - usedMarginOn(book, dex);
  }

  function liqRatioThreshold(book) {
    return book.accountMode === 'portfolio' ? 0.95 : 1;
  }

  // HL: liquidatable when maint / equity > threshold (portfolio 0.95, else 1).
  function crossRatio(book, marks, dex) {
    const eq = equityOf(book, marks, dex);
    const mm = mmOn(book, marks, dex, 'cross');
    if (!(eq > 0)) return Infinity;
    return mm / eq;
  }

  function setAccountMode(book, mode) {
    ensureDex(book);
    const next = mode === 'portfolio' ? 'portfolio' : mode === 'standard' ? 'standard' : 'unified';
    const prev = book.accountMode || 'unified';
    if (next === prev) return book;
    if (next === 'standard' && prev !== 'standard') {
      const xyzUsed = usedMarginOn(book, 'xyz');
      const bal = +book.balance || 0;
      const xyz = Math.min(bal, Math.max(xyzUsed, 0));
      book.dexCash = { xyz: xyz, main: bal - xyz };
    }
    book.accountMode = next;
    if (next !== 'standard') {
      book.balance = (+(book.dexCash && book.dexCash.main) || 0) + (+(book.dexCash && book.dexCash.xyz) || 0) || book.balance;
    }
    return book;
  }

  function transferDex(book, from, to, amount) {
    ensureDex(book);
    if (book.accountMode !== 'standard') return { ok: false, error: 'Transfer is only used in Manual / Standard mode.' };
    const amt = +amount;
    if (!(amt > 0)) return { ok: false, error: 'Enter a transfer amount.' };
    const src = from === 'xyz' ? 'xyz' : 'main';
    const dst = to === 'xyz' ? 'xyz' : 'main';
    if (src === dst) return { ok: false, error: 'Pick two different DEX balances.' };
    if ((+book.dexCash[src] || 0) + 1e-9 < amt) return { ok: false, error: 'Not enough cash on the source DEX.' };
    book.dexCash[src] -= amt;
    book.dexCash[dst] = (+book.dexCash[dst] || 0) + amt;
    return { ok: true };
  }

  function addIsolatedMargin(book, pos, amount, marks) {
    if (!pos || (pos.marginMode || 'cross') !== 'isolated') return { ok: false, error: 'Add margin is only for isolated positions.' };
    const amt = +amount;
    if (!(amt > 0)) return { ok: false, error: 'Enter a margin amount.' };
    const dex = dexOfCoin(pos.coin);
    if (freeOf(book, marks, book.accountMode === 'standard' ? dex : null) + 1e-9 < amt) {
      return { ok: false, error: 'Not enough free margin.' };
    }
    // Isolated IM lives in position.margin; cash stays in the account (reserved via usedMargin).
    pos.margin = (pos.margin || 0) + amt;
    pos.liq = C.liqPrice({
      side: pos.side, entry: pos.entry, leverage: pos.leverage,
      maxLeverage: pos.maxLeverage || pos.leverage, margin: pos.margin, qty: pos.qty
    });
    return { ok: true, margin: pos.margin, liq: pos.liq };
  }

  function removeIsolatedMargin(book, pos, amount, marks) {
    if (!pos || (pos.marginMode || 'cross') !== 'isolated') return { ok: false, error: 'Remove margin is only for isolated positions.' };
    if (pos.strictIsolated) return { ok: false, error: 'This market is strict isolated: margin cannot be removed.' };
    const amt = +amount;
    if (!(amt > 0)) return { ok: false, error: 'Enter a margin amount.' };
    const px = marks && marks[pos.coin] != null ? marks[pos.coin] : pos.mark || pos.entry;
    const notional = (px || pos.entry) * pos.qty;
    const im = notional / (pos.leverage || 1);
    // HL transfer rule: remaining margin >= max(IM, 10% of notional)
    const minLeave = Math.max(im, 0.1 * notional);
    if (pos.margin - amt + 1e-9 < minLeave) {
      return { ok: false, error: 'Remaining margin must stay at least max(initial margin, 10% of notional).' };
    }
    pos.margin -= amt;
    pos.liq = C.liqPrice({
      side: pos.side, entry: pos.entry, leverage: pos.leverage,
      maxLeverage: pos.maxLeverage || pos.leverage, margin: pos.margin, qty: pos.qty
    });
    return { ok: true, margin: pos.margin, liq: pos.liq };
  }

  function snapshotEquity(book, marks, t) {
    const eq = equity(book, marks);
    const ts = t || nowMs();
    if (!book.equityLog) book.equityLog = [];
    const log = book.equityLog;
    const last = log[log.length - 1];
    if (last && ts - last.t < 30000 && Math.abs(last.equity - eq) < 0.01) {
      last.t = ts;
      last.equity = eq;
    } else {
      log.push({ t: ts, equity: eq });
    }
    // cap ~ 60 days of 1-min points, but keep denser recent
    if (log.length > 20000) book.equityLog = log.slice(log.length - 16000);
    return eq;
  }

  function recordOrder(book, rec) {
    if (!book.orders) book.orders = [];
    book.orders.unshift(rec);
    if (book.orders.length > 2000) book.orders.length = 2000;
  }

  function applyFunding(book, marks, rates, now) {
    const ts = now || nowMs();
    const hour = M.currentFundingHour(ts);
    const last = book.lastFundingHour == null ? hour : +book.lastFundingHour;
    if (hour <= last) return [];
    const applied = [];
    for (let h = last + 1; h <= hour; h++) {
      const at = h * M.FUNDING_INTERVAL_SEC * 1000;
      (book.positions || []).forEach(function (p) {
        const opened = p.openedAt ? Date.parse(p.openedAt) || p.openedAt : 0;
        if (opened && opened > at) return;
        const rate = rates && rates[p.coin] != null ? +rates[p.coin] : 0;
        const mark = marks && marks[p.coin] != null ? marks[p.coin] : p.mark || p.entry;
        const pay = C.fundingPayment(p.side, p.qty, mark, rate);
        if (!pay) return;
        adjustCash(book, dexOfCoin(p.coin), -pay);
        p.fundingPaid = (p.fundingPaid || 0) + pay;
        const row = {
          t: at,
          id: nextId(book, 'F'),
          posId: p.id,
          coin: p.coin,
          side: p.side,
          qty: p.qty,
          mark: mark,
          rate: rate,
          payment: pay
        };
        book.funding.unshift(row);
        applied.push(row);
      });
    }
    if (book.funding && book.funding.length > 4000) book.funding.length = 4000;
    book.lastFundingHour = hour;
    if (applied.length) snapshotEquity(book, marks, ts);
    return applied;
  }

  function openPosition(book, spec) {
    const p = Object.assign({
      fundingPaid: 0,
      marginMode: spec.marginMode || book.defaultMarginMode || 'cross',
      openedAt: new Date(spec.openedAt || nowMs()).toISOString()
    }, spec);
    if (!p.id) p.id = nextId(book, 'D');
    book.positions.push(p);
    adjustCash(book, dexOfCoin(p.coin), -(p.openFee || 0));
    recordOrder(book, {
      t: Date.parse(p.openedAt) || nowMs(),
      id: nextId(book, 'O'),
      typ: spec.orderTyp || 'market',
      status: 'filled',
      coin: p.coin,
      side: p.side,
      qty: p.qty,
      price: p.entry,
      fee: p.openFee || 0,
      feeRate: p.feeRate,
      posId: p.id,
      reason: 'open'
    });
    snapshotEquity(book, null, Date.parse(p.openedAt) || nowMs());
    return p;
  }

  function closePosition(book, pos, exitPx, reason, marks) {
    const feeRate = pos.feeRate != null ? +pos.feeRate : C.TAKER;
    const pnl = C.closePnl({
      side: pos.side, entry: pos.entry, exit: exitPx, qty: pos.qty,
      openFee: 0, // already deducted from balance at open
      feeRate: feeRate
    });
    // closePnl with openFee 0 still computes price pnl - closeFee. We already took openFee from balance.
    const funding = pos.fundingPaid || 0;
    const net = pnl.pricePnl - (pos.openFee || 0) - pnl.closeFee - funding;
    // Restore margin conceptually: isolated/cross IM was never subtracted from balance (only fees).
    // Balance changes by realized price pnl - close fee - (funding already applied).
    adjustCash(book, dexOfCoin(pos.coin), pnl.pricePnl - pnl.closeFee);
    const closed = {
      id: pos.id,
      coin: pos.coin,
      side: pos.side,
      qty: pos.qty,
      entry: pos.entry,
      exit: exitPx,
      margin: pos.margin,
      leverage: pos.leverage,
      marginMode: pos.marginMode,
      reason: reason,
      openFee: pos.openFee || 0,
      closeFee: pnl.closeFee,
      fundingPaid: funding,
      pricePnl: pnl.pricePnl,
      net: net,
      roe: C.roePct(net, pos.margin),
      openedAt: pos.openedAt,
      closedAt: new Date(nowMs()).toISOString()
    };
    book.history.unshift(closed);
    if (book.history.length > 2000) book.history.length = 2000;
    book.positions = book.positions.filter(function (x) { return x !== pos && x.id !== pos.id; });
    recordOrder(book, {
      t: nowMs(),
      id: nextId(book, 'O'),
      typ: 'market',
      status: 'filled',
      coin: pos.coin,
      side: pos.side === 'long' ? 'short' : 'long',
      qty: pos.qty,
      price: exitPx,
      fee: pnl.closeFee,
      feeRate: feeRate,
      posId: pos.id,
      reason: reason || 'close'
    });
    snapshotEquity(book, marks, nowMs());
    return closed;
  }

  function checkIsolatedLiquidation(book, marks) {
    const closed = [];
    (book.positions || []).slice().forEach(function (p) {
      if ((p.marginMode || 'cross') !== 'isolated') return;
      const px = marks && marks[p.coin] != null ? marks[p.coin] : p.mark || p.entry;
      const lev = p.maxLeverage || p.leverage;
      const mm = C.maintenanceUsd(p.qty, px, lev);
      const isolatedEquity = (p.margin || 0) + C.unrealized(p.side, p.entry, px, p.qty);
      if (isolatedEquity <= mm) {
        closed.push(closePosition(book, p, px, 'liquidation', marks));
      }
    });
    return closed;
  }

  function checkCrossLiquidation(book, marks) {
    const closed = [];
    const dexs = book.accountMode === 'standard' ? ['main', 'xyz'] : [null];
    const thresh = liqRatioThreshold(book);
    dexs.forEach(function (dex) {
      let guard = 0;
      while (guard++ < 20) {
        const cross = (book.positions || []).filter(function (p) {
          if ((p.marginMode || 'cross') === 'isolated') return false;
          if (dex && dexOfCoin(p.coin) !== dex) return false;
          return true;
        });
        if (!cross.length) break;
        const ratio = crossRatio(book, marks, dex);
        if (!(ratio > thresh)) break;
        cross.sort(function (a, b) {
          const pa = C.unrealized(a.side, a.entry, marks[a.coin] || a.entry, a.qty);
          const pb = C.unrealized(b.side, b.entry, marks[b.coin] || b.entry, b.qty);
          return pa - pb;
        });
        const victim = cross[0];
        const px = marks[victim.coin] || victim.mark || victim.entry;
        closed.push(closePosition(book, victim, px, 'liquidation', marks));
      }
    });
    return closed;
  }

  function positionOn(book, coin, side) {
    return (book.positions || []).find(function (p) {
      return p.coin === coin && (!side || p.side === side);
    }) || null;
  }

  function applyReduceOnly(book, spec, qty) {
    const pos = (book.positions || []).find(function (p) { return p.coin === spec.coin; });
    if (!pos) return { ok: false, error: 'Reduce only: no position on this market.', qty: 0 };
    const closingSide = pos.side === 'long' ? 'short' : 'long';
    if (spec.side !== closingSide) return { ok: false, error: 'Reduce only must be on the opposite side of the position.', qty: 0 };
    const q = Math.min(+qty || 0, pos.qty);
    if (!(q > 0)) return { ok: false, error: 'Reduce only size is zero.', qty: 0 };
    return { ok: true, qty: C.roundQty(q, spec.szDecimals != null ? spec.szDecimals : 4), pos: pos };
  }

  function fillPosition(book, spec, fillPx, reason, marks) {
    const typ = spec.typ || spec.orderTyp || 'market';
    const feeRate = spec.isMaker ? (spec.makerFee != null ? +spec.makerFee : C.MAKER) : (spec.feeRate != null ? +spec.feeRate : C.TAKER);
    let qty = +spec.qty;
    let posRef = null;
    if (spec.reduceOnly) {
      const ro = applyReduceOnly(book, spec, qty);
      if (!ro.ok) return ro;
      qty = ro.qty;
      posRef = ro.pos;
    }
    if (posRef && spec.reduceOnly) {
      // partial close if needed
      if (qty + 1e-12 < posRef.qty) {
        const origQty = posRef.qty, origMgn = posRef.margin, origFee = posRef.openFee || 0;
        const part = Object.assign({}, posRef, {
          qty: qty,
          margin: origMgn * (qty / origQty),
          openFee: origFee * (qty / origQty)
        });
        const closed = closePosition(book, part, fillPx, reason || typ, marks);
        // closePosition removes by id — restore remainder
        const remainQ = C.roundQty(origQty - qty, spec.szDecimals != null ? spec.szDecimals : 4);
        posRef.qty = remainQ;
        posRef.margin = origMgn * (remainQ / origQty);
        posRef.openFee = origFee * (remainQ / origQty);
        book.positions.push(posRef);
        return { ok: true, closed: closed, reduced: true };
      }
      const closed = closePosition(book, posRef, fillPx, reason || typ, marks);
      return { ok: true, closed: closed, reduced: true };
    }
    // if same-side position exists, add to it (HL behavior: one position per coin)
    const existing = (book.positions || []).find(function (p) { return p.coin === spec.coin; });
    if (existing && existing.side === spec.side && !spec.reduceOnly) {
      const nQty = existing.qty + qty;
      const nNotional = existing.entry * existing.qty + fillPx * qty;
      existing.entry = nNotional / nQty;
      existing.qty = nQty;
      existing.margin = (existing.margin || 0) + (spec.margin || (fillPx * qty) / (spec.leverage || existing.leverage || 1));
      existing.openFee = (existing.openFee || 0) + fillPx * qty * feeRate;
      adjustCash(book, dexOfCoin(spec.coin), -(fillPx * qty * feeRate));
      existing.liq = C.liqPrice({
        side: existing.side, entry: existing.entry, leverage: existing.leverage,
        maxLeverage: existing.maxLeverage || existing.leverage, margin: existing.margin, qty: existing.qty
      });
      recordOrder(book, {
        t: Date.now(), id: nextId(book, 'O'), typ: typ, status: 'filled',
        coin: spec.coin, side: spec.side, qty: qty, price: fillPx,
        fee: fillPx * qty * feeRate, feeRate: feeRate, posId: existing.id, reason: 'add'
      });
      return { ok: true, position: existing, added: true };
    }
    if (existing && existing.side !== spec.side && !spec.reduceOnly) {
      // flipping: close then leftover opens
      if (qty <= existing.qty + 1e-12) {
        return fillPosition(book, Object.assign({}, spec, { reduceOnly: true, qty: qty }), fillPx, reason, marks);
      }
      const closeQty = existing.qty;
      fillPosition(book, Object.assign({}, spec, { reduceOnly: true, qty: closeQty }), fillPx, reason, marks);
      return fillPosition(book, Object.assign({}, spec, { qty: qty - closeQty, reduceOnly: false }), fillPx, reason, marks);
    }
    const leverage = +spec.leverage || 10;
    const margin = spec.margin != null ? +spec.margin : (fillPx * qty) / leverage;
    const openFee = fillPx * qty * feeRate;
    const pos = openPosition(book, Object.assign({}, spec, {
      qty: qty, entry: fillPx, margin: margin, openFee: openFee, feeRate: feeRate,
      orderTyp: typ, liq: C.liqPrice({
        side: spec.side, entry: fillPx, leverage: leverage,
        maxLeverage: spec.maxLeverage || leverage, margin: margin, qty: qty
      })
    }));
    return { ok: true, position: pos };
  }

  function canFillLimit(side, typ, tif, limitPx, bid, ask, mark) {
    if (!(limitPx > 0)) return false;
    return C.limitFillable(side, limitPx, bid, ask, mark);
  }

  function aloWouldTake(side, limitPx, bid, ask, mark) {
    return C.limitFillable(side, limitPx, bid, ask, mark);
  }

  function triggerHit(typ, side, triggerPx, mid, mark) {
    const px = mid > 0 ? mid : mark;
    if (!(triggerPx > 0) || !(px > 0)) return false;
    // Stop: long trigger > mid; short trigger < mid (price goes through level against / breakout)
    // Take: long trigger < mid; short trigger > mid
    const isStop = typ === 'stopMarket' || typ === 'stopLimit';
    const isTake = typ === 'takeMarket' || typ === 'takeLimit';
    if (isStop) {
      if (side === 'long') return px >= triggerPx;
      return px <= triggerPx;
    }
    if (isTake) {
      if (side === 'long') return px <= triggerPx;
      return px >= triggerPx;
    }
    return false;
  }

  function marketFillPx(side, bid, ask, mid, mark) {
    return C.entryFromBook(side, 'market', null, bid, ask, mid, mark);
  }

  function twapIntervalSec(notional, minutes) {
    const m = Math.max(5, Math.min(7 * 24 * 60, +minutes || 30));
    const totalSec = m * 60;
    // HL: larger/shorter → as often as 30s; aim ~ notional/80 per slice as a heuristic, min 30s
    const n = Math.max(2, Math.min(Math.floor(totalSec / 30), Math.max(2, Math.round(notional / 80))));
    return Math.max(30, Math.floor(totalSec / n));
  }

  function placeWorkingOrder(book, spec) {
    const o = Object.assign({
      id: spec.id || nextId(book, 'P'),
      t: spec.t || Date.now(),
      status: 'resting',
      filledQty: 0
    }, spec);
    if (!book.pending) book.pending = [];
    book.pending.unshift(o);
    recordOrder(book, {
      t: o.t, id: nextId(book, 'O'), typ: o.typ, status: 'resting',
      coin: o.coin, side: o.side, qty: o.qty, price: o.limitPx || o.triggerPx || null,
      fee: 0, tif: o.tif, reduceOnly: !!o.reduceOnly, reason: 'place', posId: o.id
    });
    return o;
  }

  function cancelOrder(book, id, reason) {
    const o = (book.pending || []).find(function (x) { return x.id === id; });
    if (!o) return { ok: false, error: 'Order not found.' };
    if (o.status === 'filled' || o.status === 'canceled') return { ok: false, error: 'Order already closed.' };
    o.status = 'canceled';
    o.cancelReason = reason || 'canceled';
    book.pending = book.pending.filter(function (x) { return x.id !== id; });
    recordOrder(book, {
      t: Date.now(), id: nextId(book, 'O'), typ: o.typ, status: 'canceled',
      coin: o.coin, side: o.side, qty: o.qty, price: o.limitPx || o.triggerPx,
      fee: 0, reason: reason || 'canceled', posId: o.id
    });
    return { ok: true, order: o };
  }

  function fillWorking(book, o, px, marks, asMaker) {
    const spec = Object.assign({}, o, { qty: (o.qty - (o.filledQty || 0)), isMaker: !!asMaker });
    const res = fillPosition(book, spec, px, o.typ, marks);
    if (!res.ok) return res;
    o.filledQty = o.qty;
    o.status = 'filled';
    o.fillPx = px;
    book.pending = (book.pending || []).filter(function (x) { return x.id !== o.id; });
    return res;
  }

  // Advance working orders: limits, triggers, TWAP, trailing, chase.
  function tickOrders(book, ctx) {
    const marks = ctx.marks || {};
    const mids = ctx.mids || marks;
    const bids = ctx.bids || {};
    const asks = ctx.asks || {};
    const now = ctx.now || Date.now();
    const events = [];

    function px(coin) {
      return {
        mark: marks[coin], mid: mids[coin] || marks[coin],
        bid: bids[coin], ask: asks[coin]
      };
    }

    (book.pending || []).slice().forEach(function (o) {
      if (o.status === 'canceled' || o.status === 'filled') return;
      const q = px(o.coin);
      let typ = o.typ || 'limit';

      // Chase: keep ALO one tick from best bid/ask
      if (typ === 'chase' && q.bid > 0 && q.ask > 0) {
        const tick = o.tickSize || 0.1;
        const spread = q.ask - q.bid;
        if (o.side === 'long') o.limitPx = spread <= tick + 1e-12 ? q.bid : q.bid + tick;
        else o.limitPx = spread <= tick + 1e-12 ? q.ask : q.ask - tick;
        typ = 'limit';
        o.tif = 'Alo';
      }

      // Trailing stop: update watermark, fire market when retrace hits
      if (typ === 'trailingStop') {
        const mark = q.mark;
        if (!(mark > 0)) return;
        const tr = o.trail || (o.trail = {});
        if (tr.activationPx > 0 && !tr.activated) {
          if (o.side === 'short') { // close long / open short: wait for mark >= activation? usually activation is optional
            if (mark >= tr.activationPx) tr.activated = true;
          } else {
            if (mark <= tr.activationPx) tr.activated = true;
          }
          if (!tr.activated) return;
        } else {
          tr.activated = true;
        }
        if (o.side === 'short') {
          tr.watermark = tr.watermark == null ? mark : Math.max(tr.watermark, mark);
          tr.triggerPx = tr.offsetPct > 0 ? tr.watermark * (1 - tr.offsetPct / 100) : tr.watermark - tr.offsetPx;
          if (mark <= tr.triggerPx) {
            const fill = marketFillPx(o.side, q.bid, q.ask, q.mid, q.mark);
            const r = fillWorking(book, o, fill, marks, false);
            events.push({ type: 'trail', order: o, result: r });
          }
        } else {
          tr.watermark = tr.watermark == null ? mark : Math.min(tr.watermark, mark);
          tr.triggerPx = tr.offsetPct > 0 ? tr.watermark * (1 + tr.offsetPct / 100) : tr.watermark + tr.offsetPx;
          if (mark >= tr.triggerPx) {
            const fill = marketFillPx(o.side, q.bid, q.ask, q.mid, q.mark);
            const r = fillWorking(book, o, fill, marks, false);
            events.push({ type: 'trail', order: o, result: r });
          }
        }
        return;
      }

      // TWAP
      if (typ === 'twap') {
        const tw = o.twap || (o.twap = {});
        if (tw.triggerPx > 0 && !tw.triggered) {
          if (!triggerHit(o.side === 'long' ? 'stopMarket' : 'stopMarket', o.side, tw.triggerPx, q.mid, q.mark)) {
            // For TWAP trigger, treat as "activate when mark reaches"
            const hit = o.side === 'long' ? (q.mark >= tw.triggerPx) : (q.mark <= tw.triggerPx);
            if (!hit) return;
          }
          tw.triggered = true;
          tw.startedAt = now;
        }
        if (!tw.startedAt) tw.startedAt = o.t || now;
        const interval = tw.intervalSec || 30;
        const endAt = tw.startedAt + (tw.minutes || 30) * 60 * 1000;
        const elapsed = now - tw.startedAt;
        const total = Math.max(1, endAt - tw.startedAt);
        const targetFrac = Math.min(1, elapsed / total);
        const targetQty = o.qty * targetFrac;
        const already = o.filledQty || 0;
        if (now < (tw.lastSliceAt || tw.startedAt) + interval * 1000 && already + 1e-12 >= targetQty && now < endAt) return;
        if (already + 1e-12 >= o.qty || (now >= endAt && already + 1e-12 >= o.qty * 0.999)) {
          if (already + 1e-12 >= o.qty) {
            o.status = 'filled';
            book.pending = book.pending.filter(function (x) { return x.id !== o.id; });
          }
          return;
        }
        // catch up, cap 3× normal slice
        const nSlices = Math.max(1, Math.round((tw.minutes || 30) * 60 / interval));
        const normal = o.qty / nSlices;
        let slice = Math.min(o.qty - already, Math.max(targetQty - already, normal));
        slice = Math.min(slice, 3 * normal);
        if (tw.randomize) {
          const j = 1 + (Math.random() * 0.4 - 0.2);
          slice = Math.min(o.qty - already, Math.max(0, slice * j));
        }
        slice = C.roundQty(slice, o.szDecimals != null ? o.szDecimals : 4);
        if (!(slice > 0)) return;
        let fill = marketFillPx(o.side, q.bid, q.ask, q.mid, q.mark);
        if (!(fill > 0)) return;
        // 3% slippage cap vs mid
        const mid = q.mid || q.mark;
        if (mid > 0) {
          if (o.side === 'long' && fill > mid * 1.03) fill = mid * 1.03;
          if (o.side === 'short' && fill < mid * 0.97) fill = mid * 0.97;
        }
        if (o.side === 'long' && tw.maxPx > 0 && fill > tw.maxPx) return;
        if (o.side === 'short' && tw.minPx > 0 && fill < tw.minPx) return;
        const part = Object.assign({}, o, { qty: slice, filledQty: 0, reduceOnly: o.reduceOnly });
        const r = fillPosition(book, part, fill, 'twap', marks);
        if (r.ok) {
          o.filledQty = already + slice;
          tw.lastSliceAt = now;
          events.push({ type: 'twap', order: o, result: r, slice: slice, px: fill });
          if (o.filledQty + 1e-12 >= o.qty) {
            o.status = 'filled';
            book.pending = book.pending.filter(function (x) { return x.id !== o.id; });
          }
        }
        return;
      }

      // Stop / Take: wait for trigger, then market or rest limit
      if (typ === 'stopMarket' || typ === 'stopLimit' || typ === 'takeMarket' || typ === 'takeLimit') {
        if (o.status !== 'triggered') {
          if (!triggerHit(typ, o.side, o.triggerPx, q.mid, q.mark)) return;
          o.status = 'triggered';
          o.triggeredAt = now;
        }
        const isMkt = typ === 'stopMarket' || typ === 'takeMarket';
        if (isMkt) {
          const fill = marketFillPx(o.side, q.bid, q.ask, q.mid, q.mark);
          const r = fillWorking(book, o, fill, marks, false);
          events.push({ type: typ, order: o, result: r });
          return;
        }
        // become a GTC/IOC/ALO limit at o.limitPx
        typ = 'limit';
      }

      if ((typ === 'limit' || typ === 'scale') && o.limitPx > 0) {
        const tif = o.tif || 'Gtc';
        const fillable = canFillLimit(o.side, typ, tif, o.limitPx, q.bid, q.ask, q.mark);
        if (tif === 'Alo' || tif === 'ALO') {
          if (o.status === 'resting' && fillable && !o.rested) {
            // first touch would take — cancel (post only)
            cancelOrder(book, o.id, 'ALO canceled (would take liquidity)');
            events.push({ type: 'alo-cancel', order: o });
            return;
          }
          // after resting, fill when market comes to us (maker)
          if (o.rested && fillable) {
            const r = fillWorking(book, o, o.limitPx, marks, true);
            events.push({ type: 'limit', order: o, result: r });
          } else if (!fillable) {
            o.rested = true;
          }
          return;
        }
        if (fillable) {
          const fill = o.side === 'long'
            ? Math.min(o.limitPx, q.ask > 0 ? q.ask : o.limitPx)
            : Math.max(o.limitPx, q.bid > 0 ? q.bid : o.limitPx);
          const r = fillWorking(book, o, fill, marks, tif !== 'Ioc' && tif !== 'IOC');
          events.push({ type: 'limit', order: o, result: r });
        } else if (tif === 'Ioc' || tif === 'IOC') {
          cancelOrder(book, o.id, 'IOC canceled (not immediately fillable)');
          events.push({ type: 'ioc-cancel', order: o });
        }
      }
    });

    events.push.apply(events, checkIsolatedLiquidation(book, marks).map(function (c) { return { type: 'liq', closed: c }; }));
    events.push.apply(events, checkCrossLiquidation(book, marks).map(function (c) { return { type: 'liq', closed: c }; }));
    return events;
  }

  function equityAtOrBefore(book, t) {
    const log = book.equityLog || [];
    let eq = START;
    for (let i = 0; i < log.length; i++) {
      if (log[i].t <= t) eq = log[i].equity;
      else break;
    }
    return eq;
  }

  function sumBy(list, pred, field) {
    return (list || []).reduce(function (s, x) {
      return pred(x) ? s + (+x[field] || 0) : s;
    }, 0);
  }

  function periodPnl(book, marks, now, windowMs) {
    const eqNow = equity(book, marks);
    if (!windowMs) {
      // all time: equity - start, which includes realized, funding, uPnL, fees
      return eqNow - START;
    }
    const start = now - windowMs;
    const eqThen = equityAtOrBefore(book, start);
    // If we have a log point, use equity difference (includes uPnL path).
    if ((book.equityLog || []).some(function (p) { return p.t <= start; })) {
      return eqNow - eqThen;
    }
    const realized = sumBy(book.history, function (h) {
      const t = Date.parse(h.closedAt || h.t) || 0;
      return t >= start;
    }, 'net');
    const fund = sumBy(book.funding, function (f) { return (f.t || 0) >= start; }, 'payment');
    return realized - fund + upnlTotal(book, marks);
  }

  function portfolioStats(book, marks, now) {
    const ts = now || nowMs();
    const hist = book.history || [];
    const wins = hist.filter(function (h) { return h.net > 0; });
    const losses = hist.filter(function (h) { return h.net < 0; });
    const flats = hist.filter(function (h) { return !h.net; });
    const grossWin = wins.reduce(function (s, h) { return s + h.net; }, 0);
    const grossLoss = losses.reduce(function (s, h) { return s + h.net; }, 0); // negative
    const feesPaid = hist.reduce(function (s, h) { return s + (h.openFee || 0) + (h.closeFee || 0); }, 0)
      + (book.positions || []).reduce(function (s, p) { return s + (p.openFee || 0); }, 0)
      + (book.pending || []).reduce(function (s, p) { return s + (p.openFee || 0); }, 0);
    const fundingPaid = (book.funding || []).reduce(function (s, f) { return s + (f.payment || 0); }, 0);
    const byMarket = {};
    M.CATALOG.forEach(function (m) { byMarket[m.id] = { coin: m.id, trades: 0, net: 0, fees: 0, volume: 0 }; });
    hist.forEach(function (h) {
      const id = h.coin || 'xyz:XYZ100';
      if (!byMarket[id]) byMarket[id] = { coin: id, trades: 0, net: 0, fees: 0, volume: 0 };
      byMarket[id].trades += 1;
      byMarket[id].net += h.net || 0;
      byMarket[id].fees += (h.openFee || 0) + (h.closeFee || 0);
      byMarket[id].volume += (h.entry || 0) * (h.qty || 0) + (h.exit || 0) * (h.qty || 0);
    });
    let peak = START, maxDd = 0, maxDdPct = 0;
    (book.equityLog || []).forEach(function (p) {
      if (p.equity > peak) peak = p.equity;
      const dd = peak - p.equity;
      if (dd > maxDd) { maxDd = dd; maxDdPct = peak > 0 ? (dd / peak) * 100 : 0; }
    });
    const eqNow = equity(book, marks);
    if (eqNow > peak) peak = eqNow;
    const ddNow = peak - eqNow;
    if (ddNow > maxDd) { maxDd = ddNow; maxDdPct = peak > 0 ? (ddNow / peak) * 100 : 0; }

    const best = hist.reduce(function (a, h) { return !a || h.net > a.net ? h : a; }, null);
    const worst = hist.reduce(function (a, h) { return !a || h.net < a.net ? h : a; }, null);

    const daily = {};
    hist.forEach(function (h) {
      const t = Date.parse(h.closedAt || h.t) || 0;
      if (!t) return;
      const k = M.dayKey(t);
      if (!daily[k]) daily[k] = { key: k, pnl: 0, trades: 0, funding: 0 };
      daily[k].pnl += h.net || 0;
      daily[k].trades += 1;
    });
    (book.funding || []).forEach(function (f) {
      const k = M.dayKey(f.t || ts);
      if (!daily[k]) daily[k] = { key: k, pnl: 0, trades: 0, funding: 0 };
      daily[k].funding += f.payment || 0;
      daily[k].pnl -= f.payment || 0; // payment already in balance; for daily closed PnL, funding is a cash item
    });
    // Funding is already subtracted from trade nets? No - trade net includes position fundingPaid.
    // Avoid double count: history.net already includes fundingPaid of that trade.
    // So daily from history already has funding of closed trades. Open-position funding
    // that isn't in a closed trade should still appear. Recompute daily more carefully:
    // Reset and do: realized net (which includes fundingPaid on the trade) + funding payments
    // for positions still open (or funding rows whose pos is still open / not in a closed trade).
    const closedIds = {};
    hist.forEach(function (h) { closedIds[h.id] = true; });
    const daily2 = {};
    hist.forEach(function (h) {
      const t = Date.parse(h.closedAt || h.t) || 0;
      if (!t) return;
      const k = M.dayKey(t);
      if (!daily2[k]) daily2[k] = { key: k, pnl: 0, trades: 0, funding: 0 };
      daily2[k].pnl += (h.pricePnl || 0) - (h.openFee || 0) - (h.closeFee || 0) - (h.fundingPaid || 0);
      daily2[k].trades += 1;
      daily2[k].funding += h.fundingPaid || 0;
    });
    (book.funding || []).forEach(function (f) {
      if (f.posId && closedIds[f.posId]) return; // already in closed trade net
      const k = M.dayKey(f.t || ts);
      if (!daily2[k]) daily2[k] = { key: k, pnl: 0, trades: 0, funding: 0 };
      daily2[k].funding += f.payment || 0;
      daily2[k].pnl -= f.payment || 0;
    });

    return {
      equity: eqNow,
      balance: +book.balance || 0,
      upnl: upnlTotal(book, marks),
      usedMargin: usedMargin(book),
      freeMargin: freeMargin(book, marks),
      maint: totalMM(book, marks),
      pnl24h: periodPnl(book, marks, ts, 86400000),
      pnl7d: periodPnl(book, marks, ts, 7 * 86400000),
      pnl30d: periodPnl(book, marks, ts, 30 * 86400000),
      pnlAll: periodPnl(book, marks, ts, 0),
      trades: hist.length,
      wins: wins.length,
      losses: losses.length,
      flats: flats.length,
      winRate: hist.length ? (wins.length / hist.length) * 100 : 0,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      profitFactor: grossLoss < 0 ? (grossWin / -grossLoss) : (grossWin > 0 ? Infinity : 0),
      best: best,
      worst: worst,
      feesPaid: feesPaid,
      fundingPaid: fundingPaid,
      maxDrawdown: maxDd,
      maxDrawdownPct: maxDdPct,
      byMarket: Object.keys(byMarket).map(function (k) { return byMarket[k]; }),
      daily: daily2
    };
  }

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\n');
  }

  function csvTrades(book) {
    const rows = [['Closed (UTC+5)','ID','Market','Side','Qty','Entry','Exit','Reason','Price PnL','Fees','Funding','Net','ROE %','Opened (UTC+5)']];
    (book.history || []).forEach(function (h) {
      rows.push([
        M.formatDateTime(Date.parse(h.closedAt)),
        h.id, h.coin, h.side, h.qty, h.entry, h.exit, h.reason,
        (h.pricePnl || 0).toFixed(2),
        ((h.openFee || 0) + (h.closeFee || 0)).toFixed(2),
        (h.fundingPaid || 0).toFixed(2),
        (h.net || 0).toFixed(2),
        (h.roe || 0).toFixed(2),
        h.openedAt ? M.formatDateTime(Date.parse(h.openedAt)) : ''
      ]);
    });
    return toCsv(rows);
  }

  function csvFunding(book) {
    const rows = [['Time (UTC+5)','ID','Market','Side','Qty','Mark','Rate','Payment','Position']];
    (book.funding || []).forEach(function (f) {
      rows.push([
        M.formatDateTime(f.t), f.id, f.coin, f.side, f.qty, f.mark, f.rate,
        (f.payment || 0).toFixed(6), f.posId || ''
      ]);
    });
    return toCsv(rows);
  }

  function csvOrders(book) {
    const rows = [['Time (UTC+5)','ID','Market','Side','Type','Status','Qty','Price','Fee','Reason','Position']];
    (book.orders || []).forEach(function (o) {
      rows.push([
        M.formatDateTime(o.t), o.id, o.coin, o.side, o.typ, o.status, o.qty, o.price,
        (o.fee || 0).toFixed(4), o.reason || '', o.posId || ''
      ]);
    });
    return toCsv(rows);
  }

  return {
    LS_V1, LS_V2, LS_UI, START,
    defaultBook, migrateV1, loadFromStorage, saveToStorage,
    defaultUi, loadUi, saveUi, panesForLayout,
    nextId, usedMargin, upnlTotal, equity, totalMM, freeMargin,
    snapshotEquity, applyFunding, openPosition, closePosition,
    checkCrossLiquidation, checkIsolatedLiquidation, recordOrder, portfolioStats,
    periodPnl, csvTrades, csvFunding, csvOrders,
    dexOfCoin, adjustCash, cashOf, equityOf, freeOf, usedMarginOn, upnlOn, mmOn,
    liqRatioThreshold, crossRatio, setAccountMode, transferDex,
    addIsolatedMargin, removeIsolatedMargin,
    fillPosition, placeWorkingOrder, cancelOrder, tickOrders,
    twapIntervalSec, triggerHit, aloWouldTake, marketFillPx, positionOn
  };
});
