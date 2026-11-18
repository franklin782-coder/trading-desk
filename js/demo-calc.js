/* Pure demo-trading math. Works in the browser and in Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DemoCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAKER = 0.00045; // 0.045% per side, Hyperliquid taker default

  function mmRatio(maxLeverage) {
    const m = +maxLeverage;
    if (!(m > 0)) return 0;
    // Maintenance margin ≈ half of initial margin at max leverage.
    return 0.5 / m;
  }

  function roundQty(qty, szDecimals) {
    const d = Math.max(0, Math.min(8, szDecimals == null ? 4 : +szDecimals));
    const f = Math.pow(10, d);
    return Math.round((+qty || 0) * f) / f;
  }

  function clampPrice(p, precision) {
    if (!(p > 0)) return null;
    const d = precision == null ? 2 : +precision;
    const f = Math.pow(10, d);
    return Math.round(p * f) / f;
  }

  function favorablePrice(side, entry, pct) {
    if (!(entry > 0) || !isFinite(+pct)) return null;
    const s = side === 'short' ? -1 : 1;
    return entry * (1 + s * (+pct) / 100);
  }

  function adversePrice(side, entry, pct) {
    return favorablePrice(side, entry, -pct);
  }

  function movePct(entry, price) {
    if (!(entry > 0) || !(price > 0)) return null;
    return ((price / entry) - 1) * 100;
  }

  function favorablePct(side, entry, price) {
    const m = movePct(entry, price);
    if (m == null) return null;
    return side === 'short' ? -m : m;
  }

  function liqPrice({ side, entry, leverage, maxLeverage, margin, qty }) {
    if (!(entry > 0) || !(qty > 0) || !(leverage > 0)) return null;
    const mm = mmRatio(maxLeverage || leverage);
    const mgn = margin != null ? +margin : (entry * qty) / leverage;
    if (side === 'short') {
      const den = qty * (1 + mm);
      if (!(den > 0)) return null;
      return (entry * qty + mgn) / den;
    }
    const den = qty * (1 - mm);
    if (!(den > 0)) return null;
    return (entry * qty - mgn) / den;
  }

  function closePnl({ side, entry, exit, qty, openFee, feeRate }) {
    const fee = feeRate == null ? TAKER : +feeRate;
    const sign = side === 'short' ? -1 : 1;
    const q = +qty || 0;
    const pricePnl = (exit - entry) * q * sign;
    const closeFee = Math.abs(exit * q) * fee;
    const open = openFee == null ? Math.abs(entry * q) * fee : +openFee;
    const net = pricePnl - open - closeFee;
    return { pricePnl, openFee: open, closeFee, totalFees: open + closeFee, net };
  }

  function roePct(net, margin) {
    if (!(margin > 0)) return 0;
    return (net / margin) * 100;
  }

  function riskReward(tpNet, slNet) {
    if (!(slNet < 0) || !(tpNet > 0)) return null;
    return tpNet / -slNet;
  }

  function plan(input) {
    const side = input.side === 'short' ? 'short' : 'long';
    const entry = +input.entry;
    const leverage = +input.leverage;
    const maxLeverage = +(input.maxLeverage || leverage);
    const feeRate = input.feeRate == null ? TAKER : +input.feeRate;
    const szDecimals = input.szDecimals == null ? 4 : +input.szDecimals;
    const sizeUsd = +input.sizeUsd;
    const sizeMode = input.sizeMode === 'notional' ? 'notional' : 'margin';

    const out = {
      ok: false,
      error: null,
      side,
      sizeMode,
      leverage,
      maxLeverage,
      feeRate,
      entry: entry || null,
      qty: 0,
      notional: 0,
      margin: 0,
      openFee: 0,
      closeFeeAtEntry: 0,
      feesRoundTripAtEntry: 0,
      liq: null,
      mmRatio: mmRatio(maxLeverage),
      tp: null,
      sl: null,
      rr: null,
      scenarios: []
    };

    if (!(entry > 0)) { out.error = 'no-entry'; return out; }
    if (!(leverage > 0)) { out.error = 'no-leverage'; return out; }
    if (!(sizeUsd > 0)) { out.error = 'no-size'; return out; }
    if (leverage > maxLeverage + 1e-9) { out.error = 'leverage-max'; return out; }

    let qty;
    if (sizeMode === 'notional') qty = roundQty(sizeUsd / entry, szDecimals);
    else qty = roundQty((sizeUsd * leverage) / entry, szDecimals);
    if (!(qty > 0)) { out.error = 'qty-zero'; return out; }

    const notional = qty * entry;
    const margin = notional / leverage;
    const openFee = notional * feeRate;
    const closeFeeAtEntry = notional * feeRate;
    out.ok = true;
    out.qty = qty;
    out.notional = notional;
    out.margin = margin;
    out.openFee = openFee;
    out.closeFeeAtEntry = closeFeeAtEntry;
    out.feesRoundTripAtEntry = openFee + closeFeeAtEntry;
    out.liq = liqPrice({ side, entry, leverage, maxLeverage, margin, qty });

    function atPrice(price, tag) {
      if (!(price > 0)) return null;
      const p = closePnl({ side, entry, exit: price, qty, openFee, feeRate });
      return {
        tag,
        price,
        movePct: movePct(entry, price),
        pricePnl: p.pricePnl,
        closeFee: p.closeFee,
        totalFees: p.totalFees,
        net: p.net,
        roe: roePct(p.net, margin)
      };
    }

    if (input.tp > 0) {
      out.tp = atPrice(+input.tp, 'tp');
      out.tp.favPct = favorablePct(side, entry, +input.tp);
    }
    if (input.sl > 0) {
      out.sl = atPrice(+input.sl, 'sl');
      out.sl.advPct = -favorablePct(side, entry, +input.sl);
    }
    if (out.tp && out.sl) out.rr = riskReward(out.tp.net, out.sl.net);

    const moves = [0.5, 1, 2, 5];
    out.scenarios = [];
    moves.forEach(function (m) {
      [-m, m].forEach(function (signed) {
        const price = entry * (1 + signed / 100);
        const row = atPrice(price, signed);
        row.label = (signed > 0 ? '+' : '') + signed + '%';
        out.scenarios.push(row);
      });
    });
    return out;
  }

  function unrealized(side, entry, mark, qty) {
    const sign = side === 'short' ? -1 : 1;
    if (!(entry > 0) || !(mark > 0) || !(qty > 0)) return 0;
    return (mark - entry) * qty * sign;
  }

  function hitLevel(side, mark, tp, sl, liq) {
    if (!(mark > 0)) return null;
    // Liquidation first, then SL, then TP — worst case wins if several would trigger.
    if (liq > 0) {
      if (side === 'long' && mark <= liq) return 'liquidation';
      if (side === 'short' && mark >= liq) return 'liquidation';
    }
    if (sl > 0) {
      if (side === 'long' && mark <= sl) return 'sl';
      if (side === 'short' && mark >= sl) return 'sl';
    }
    if (tp > 0) {
      if (side === 'long' && mark >= tp) return 'tp';
      if (side === 'short' && mark <= tp) return 'tp';
    }
    return null;
  }

  function limitFillable(side, limit, bid, ask, mark) {
    if (!(limit > 0)) return false;
    if (side === 'long') {
      const px = ask > 0 ? ask : mark;
      return px > 0 && limit >= px;
    }
    const px = bid > 0 ? bid : mark;
    return px > 0 && limit <= px;
  }

  function entryFromBook(side, typ, limit, bid, ask, mid, mark) {
    if (typ === 'limit' && limit > 0) {
      if (limitFillable(side, limit, bid, ask, mark || mid)) {
        if (side === 'long') {
          const px = ask > 0 ? ask : (mid || mark);
          return Math.min(limit, px);
        }
        const px = bid > 0 ? bid : (mid || mark);
        return Math.max(limit, px);
      }
      return null; // rests
    }
    if (side === 'long') return ask > 0 ? ask : (mid || mark);
    return bid > 0 ? bid : (mid || mark);
  }

  return {
    TAKER, mmRatio, roundQty, clampPrice,
    favorablePrice, adversePrice, movePct, favorablePct,
    liqPrice, closePnl, roePct, riskReward, plan,
    unrealized, hitLevel, limitFillable, entryFromBook
  };
});
