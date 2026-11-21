'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/ranges.js');
const defaults = require('../src/defaults.js');
const slider = require('../src/slider.js');
const handrank = require('../src/handrank.js');

const ALL = [];
for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) ALL.push(R.gridCell(r, c));
const playbook = defaults.config().ranges;
const parse = (text) => {
  const res = R.parseRange(text);
  assert.deepEqual(res.errors, [], text);
  return res.hands;
};
const sameSet = (a, b, msg) => assert.deepEqual([...a].sort(), [...b].sort(), msg);

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('toText writes the playbook first-2 range in its usual compact form', () => {
  assert.equal(R.toText(parse(playbook.first2)), '22+, A9s+, KTs+, QTs+, JTs, T9s, AJo+, KQo');
});

test('toText: single pairs, pair runs, kicker-plus and kicker runs', () => {
  assert.equal(R.toText(parse('TT-77, AA, K8s-K6s, KQs, Q9o')), 'AA, TT-77, KQs, K8s-K6s, Q9o');
  assert.equal(R.toText(parse('KQs, KJs, A2o')), 'KJs+, A2o');
  assert.equal(R.toText([]), '');
});

test('toText round-trips every default range and 300 random hand sets exactly', () => {
  for (const key of defaults.RANGE_KEYS) sameSet(parse(R.toText(parse(playbook[key]))), parse(playbook[key]), key);
  const rand = mulberry32(20261120);
  for (let i = 0; i < 300; i++) {
    const density = rand();
    const set = ALL.filter(() => rand() < density);
    const text = R.toText(set);
    sameSet(parse(text), set, text);
  }
});

test('slider order is every hand class exactly once, strongest first', () => {
  assert.equal(slider.ORDER.length, 169);
  sameSet(slider.ORDER, ALL);
  assert.equal(slider.ORDER[0], 'AA');
  assert.equal(slider.CUMULATIVE[169], 1326);
  for (let k = 1; k <= 169; k++) assert.ok(slider.CUMULATIVE[k] > slider.CUMULATIVE[k - 1]);
});

test('slider marks give exactly the playbook seat ranges', () => {
  assert.deepEqual(slider.MARKS, { first2: 29, middle: 44, cutoff: 55, button: 72 });
  const pct = { first2: '13.1', middle: '19.5', cutoff: '25.2', button: '35.1' };
  for (const key of Object.keys(slider.MARKS)) {
    const top = slider.top(slider.MARKS[key]);
    sameSet(top, parse(playbook[key]), key);
    assert.equal(R.percent(top).toFixed(1), pct[key]);
  }
});

test('inside a playbook tier the stronger hand comes first', () => {
  const strength = new Map(handrank.ORDER.map((h, i) => [h, i]));
  const tier = slider.ORDER.slice(slider.MARKS.first2, slider.MARKS.middle);
  for (let i = 1; i < tier.length; i++) assert.ok(strength.get(tier[i - 1]) < strength.get(tier[i]), tier[i]);
});

test('closest slider position for a range', () => {
  assert.equal(slider.closest(parse(playbook.first2)), slider.MARKS.first2);
  assert.equal(slider.closest([]), 0);
  assert.equal(slider.closest(ALL), 169);
  assert.deepEqual(slider.top(-5), []);
  assert.equal(slider.top(500).length, 169);
});
