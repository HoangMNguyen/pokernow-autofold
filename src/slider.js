(function (root) {
  'use strict';

  // Order behind the settings page's "% of hands" sliders. The playbook's seat tiers come first (first 2, then
  // the hands the middle, cutoff and button ranges add), then every other hand; inside each tier, strongest first
  // by all-in equity against two random hands. So at each tier boundary the top hands are exactly the playbook's
  // range for that seat. Pure.

  const isNode = typeof module === 'object' && module.exports;
  const ranges = isNode ? require('./ranges.js') : root.PNAF.ranges;
  const defaults = isNode ? require('./defaults.js') : root.PNAF.defaults;
  const handrank = isNode ? require('./handrank.js') : root.PNAF.handrank;

  const TIER_KEYS = ['first2', 'middle', 'cutoff', 'button'];

  function build() {
    const strength = new Map(handrank.ORDER.map((h, i) => [h, i]));
    const byStrength = (a, b) => strength.get(a) - strength.get(b);
    const playbook = defaults.config().ranges;
    const order = [];
    const placed = new Set();
    const marks = {};
    for (const key of TIER_KEYS) {
      const tier = ranges.parseRange(playbook[key]).hands.filter((h) => !placed.has(h)).sort(byStrength);
      for (const h of tier) {
        placed.add(h);
        order.push(h);
      }
      marks[key] = order.length;
    }
    for (const h of handrank.ORDER) if (!placed.has(h)) order.push(h);
    return { order, marks };
  }

  const { order: ORDER, marks: MARKS } = build();

  // CUMULATIVE[k] = combos in the top k hands.
  const CUMULATIVE = [0];
  for (const h of ORDER) CUMULATIVE.push(CUMULATIVE[CUMULATIVE.length - 1] + ranges.combos(h));

  function top(k) {
    return ORDER.slice(0, Math.max(0, Math.min(ORDER.length, k)));
  }

  // Slider position whose top hands have the combo count closest to this range (the smaller one on a tie).
  function closest(hands) {
    const target = hands.reduce((n, h) => n + ranges.combos(h), 0);
    let best = 0;
    for (let k = 1; k < CUMULATIVE.length; k++) {
      if (Math.abs(CUMULATIVE[k] - target) < Math.abs(CUMULATIVE[best] - target)) best = k;
    }
    return best;
  }

  const api = { ORDER, MARKS, CUMULATIVE, top, closest };

  root.PNAF = root.PNAF || {};
  root.PNAF.slider = api;
  if (isNode) module.exports = api;
})(globalThis);
