(function (root) {
  'use strict';

  // Pre-flop decision rules: fold, free check, or leave the hand to the user. Pure.

  const ranges = (typeof module === 'object' && module.exports) ? require('./ranges.js') : root.PNAF.ranges;

  // Parsed ranges per config object: { key: { set, errors } }.
  const cache = new WeakMap();

  function parsed(config) {
    const cacheable = config !== null && typeof config === 'object';
    let entry = cacheable ? cache.get(config) : undefined;
    if (!entry) {
      entry = {};
      const src = (config && config.ranges) || {};
      for (const key of Object.keys(src)) {
        const r = ranges.parseRange(src[key]);
        entry[key] = { set: new Set(r.hands), errors: r.errors.length };
      }
      if (cacheable) cache.set(config, entry);
    }
    return entry;
  }

  const SEAT_RANGE = { first2: 'first2', middle: 'middle', cutoff: 'cutoff', button: 'button' };
  // How ranges are named in the reasons the user sees (badge, alert, popup, log).
  const RANGE_NAMES = {
    first2: 'first-2 range', middle: 'middle range', cutoff: 'cutoff range', button: 'button range',
    limpersExtraLate: 'behind-limper extras', vsRaiseIP: 'facing-a-raise list',
    vsRaiseSB: 'small-blind facing-a-raise list', bbVsOpen: 'big-blind call list', neverFold: 'never-fold list',
  };
  const rangeName = (keys) => keys.map((k) => RANGE_NAMES[k] || k).join(' + ');

  function decide(s, config) {
    const hand = s.hand || null;
    const label = s.label || null;
    const result = (action, spot, inRange, reason) => ({ action, spot, inRange, hand, label, reason });
    const leave = (spot, reason) => result('leave', spot, null, reason);

    if (!s.ok) return leave('unknown', s.reason || 'table not readable');
    if (s.variant !== 'NLH' || !Array.isArray(s.heroCards) || s.heroCards.length !== 2) return leave('not_holdem', 'not a Hold\'em hand');
    if (s.board > 0) return leave('postflop', 'community cards are out');
    if (label == null) return leave('seat_unknown', 'seat position unknown');

    const table = parsed(config);
    // A range that is missing or has unreadable tokens is never used to fold or check.
    const lookup = (keys) => {
      const set = new Set();
      for (const key of keys) {
        const r = table[key];
        if (!r || r.errors) return { bad: key };
        for (const h of r.set) set.add(h);
      }
      return { set };
    };

    const never = lookup(['neverFold']);
    if (never.bad) return leave('unknown', 'your ' + rangeName([never.bad]) + ' is missing or has errors');
    if (never.set.has(hand)) return leave('never_fold', hand + ' is on your never-fold list');
    if (s.heroActed) return leave('second_decision', 'second decision this round');
    if (s.raises >= 2) return leave('three_bet', '3-bet or more');

    // Range spot: in range → leave, out → fold. Free check: in set → leave, out → check.
    const judge = (spot, keys, outAction) => {
      const r = lookup(keys);
      if (r.bad) return leave('unknown', 'your ' + rangeName([r.bad]) + ' is missing or has errors');
      const name = rangeName(keys);
      if (r.set.has(hand)) return result('leave', spot, true, hand + ' is in your ' + name);
      return result(outAction, spot, false, hand + ' is not in your ' + name);
    };
    const freeCheck = (key) => judge('free_check', [key], 'check');

    let d;
    if (s.headsUp) {
      if (s.raises === 0 && s.canCheck && (label === 'sb' || label === 'bb')) d = freeCheck(label === 'sb' ? 'cutoff' : 'bbVsOpen');
      else return leave('heads_up', 'heads-up hand');
    } else if (label === 'sb') {
      if (s.raises === 0) d = s.canCheck ? freeCheck('cutoff') : judge('sb_unequal', ['cutoff'], 'fold');
      else d = judge('vs_raise', ['vsRaiseSB'], 'fold');
    } else if (label === 'bb') {
      if (s.raises === 0) {
        if (!s.canCheck) return leave('unknown', 'big blind owes chips without a raise');
        d = freeCheck('bbVsOpen');
      } else if (s.straddle) {
        return leave('straddled_blind', 'big blind facing a raise in a straddled pot');
      } else {
        const max = Number(config && config.bbOpenMaxBB);
        if (!(s.raiseToBB <= max)) return leave('big_raise', 'raise larger than ' + max + ' big blinds');
        d = judge('bb_vs_open', ['bbVsOpen'], 'fold');
      }
    } else if (label === 'straddle') {
      if (s.raises === 0) {
        if (!s.canCheck) return leave('unknown', 'straddler owes chips without a raise');
        d = freeCheck('bbVsOpen');
      } else {
        return leave('straddled_blind', 'straddler facing a raise');
      }
    } else if (SEAT_RANGE[label]) {
      if (s.raises === 1) d = judge('vs_raise', ['vsRaiseIP'], 'fold');
      else if (s.limpers > 0) {
        const keys = (label === 'cutoff' || label === 'button') ? [label, 'limpersExtraLate'] : [label];
        d = judge('limpers', keys, 'fold');
      } else d = judge('unopened', [label], 'fold');
    } else {
      return leave('seat_unknown', 'seat position unknown');
    }

    if (d.action === 'fold' && s.canCheck) d = result('check', d.spot, d.inRange, d.reason + '; checking is free');
    if ((d.action === 'fold' && !s.canFold) || (d.action === 'check' && !s.canCheck)) {
      return result('leave', 'no_button', d.inRange, d.reason + '; no ' + d.action + ' button');
    }
    return d;
  }

  // Callable as PNAF.decide(s, config) and as PNAF.decide.decide(s, config).
  const api = decide;
  api.decide = decide;

  root.PNAF = root.PNAF || {};
  root.PNAF.decide = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
