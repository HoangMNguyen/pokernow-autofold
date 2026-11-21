'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/ranges.js');
const H = require('../src/handrank.js');
// Importing the generator must not run a generation (its main block is guarded by import.meta.main).
const G = require('../tools/rank-hands.mjs');

const score = (text) => G.evalCards(text.split(' '));
const cat = (text) => G.CATEGORY[G.category(score(text))];

test('attaches to globalThis.PNAF', () => {
  assert.equal(globalThis.PNAF.handrank, H);
});

test('evaluator names every category', () => {
  assert.equal(cat('As Ks Qs Js Ts 2d 3c'), 'straight flush');
  assert.equal(cat('9h 9d 9s 9c Ks 2d 3c'), 'quads');
  assert.equal(cat('9h 9d 9s Kc Ks 2d 3c'), 'full house');
  assert.equal(cat('Ah 9h 7h 4h 2h Kd 3c'), 'flush');
  assert.equal(cat('9h Td Js Qc Ks 2d 3c'), 'straight');
  assert.equal(cat('9h 9d 9s Qc Ks 2d 3c'), 'trips');
  assert.equal(cat('9h 9d Qs Qc Ks 2d 3c'), 'two pair');
  assert.equal(cat('9h 9d 7s Qc Ks 2d 3c'), 'pair');
  assert.equal(cat('9h Jd 7s Qc Ks 2d 3c'), 'high card');
});

test('category ordering: straight flush > quads > full house > flush > straight > trips > two pair > pair > high card', () => {
  const ladder = [
    'As Ks Qs Js Ts 2d 3c', // royal flush
    '9s 8s 7s 6s 5s 2d 3c', // straight flush
    '2h 2d 2s 2c 3s 4d 6c', // lowest quads
    '2h 2d 2s 3c 3s 7d 9c', // lowest full house
    '2h 3h 4h 5h 7h 9d Jc', // lowest flush
    'Ah 2d 3s 4c 5s 9d Jc', // wheel
    '2h 2d 2s 4c 5s 9d Jc', // trips
    '2h 2d 3s 3c 5s 9d Jc', // two pair
    '2h 2d 3s 4c 6s 9d Jc', // pair
    '2h 3d 4s 5c 7s 9d Jc' // high card
  ].map(score);
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i - 1] > ladder[i], 'step ' + i);
  assert.ok(score('Ah Kh Qh Jh Th 9h 8h') > score('Kh Qh Jh Th 9h 8h 7h'), 'royal beats king-high straight flush');
});

test('wheel is the lowest straight and a steel wheel the lowest straight flush', () => {
  const wheel = score('Ah 2d 3s 4c 5s 9d Kc');
  assert.equal(G.category(wheel), 4);
  assert.ok(score('2h 3d 4s 5c 6s 9d Kc') > wheel, 'six-high beats the wheel');
  assert.ok(score('Ah Kd Qs Jc Ts 2d 3c') > score('Kh Qd Js Tc 9s 2d 3c'), 'broadway beats king-high');
  assert.ok(wheel > score('Ah Ad As Kc Qs 9d 3c'), 'wheel still beats trips');
  assert.equal(score('Ah 2d 3s 4c 5s 6d Kc'), score('2h 3d 4s 5c 6s Td Kc'), 'six-high straight ignores the ace');
  const steel = score('Ah 2h 3h 4h 5h 9d Kc');
  assert.equal(G.category(steel), 8);
  assert.ok(score('2h 3h 4h 5h 6h 9d Kc') > steel);
  assert.equal(G.category(score('Qh Kh Ah 2h 3h 9d 8c')), 5, 'no wrap-around straight flush');
  assert.equal(G.category(score('Qh Kd As 2c 3s 9d 8c')), 0, 'no wrap-around straight');
});

test('flush beats straight when both are present', () => {
  const both = score('5h 6h 7d 8h 9s Kh 2h');
  assert.equal(G.category(both), 5);
  assert.ok(score('2h 3h 4h 5h 7h 9d Jc') > score('Ah Kd Qs Jc Ts 2d 3c'));
});

test('best five of seven is chosen', () => {
  // Board pair plus hole pair: two pair, with the best remaining card as kicker.
  assert.equal(score('8h 8d Ks Kc 4s 2d Ac'), score('8s 8c Kh Kd As 3d 2c'));
  assert.ok(score('8h 8d Ks Kc 4s 2d Ac') > score('8h 8d Ks Kc 4s 2d Qc'), 'ace kicker beats queen kicker');
  // Three pairs: the lowest pair cannot be the kicker if a higher single card exists, and vice versa.
  assert.equal(score('Ah Ad Ks Kc 2s 2d Qc'), score('Ah Ad Ks Kc 3s 4d Qc'));
  assert.equal(score('Ah Ad Ks Kc Qs Qd 2c'), score('Ah Ad Ks Kc Qs 3d 2c'));
  // Two trips make a full house with the higher trips on top.
  assert.equal(G.category(score('9h 9d 9s 4c 4s 4d Kc')), 6);
  assert.equal(score('9h 9d 9s 4c 4s 4d Kc'), score('9h 9d 9s 4c 4s 2d Kc'));
  assert.ok(score('Ah Ad As 8c 8s 8d Kc') > score('9h 9d 9s 4c 4s 4d Kc'), 'aces full beats nines full');
  // Trips plus two pairs: the higher pair fills the boat.
  assert.equal(score('9h 9d 9s Kc Ks 4d 4c'), score('9h 9d 9s Kc Ks 2d 3c'));
  // Quads take the highest other card even when it sits in a pair or trips.
  assert.equal(score('9h 9d 9s 9c Ks Kd 2c'), score('9h 9d 9s 9c Ks 3d 2c'));
  assert.equal(score('9h 9d 9s 9c Ks Kd Kc'), score('9h 9d 9s 9c Ks 3d 2c'));
  // Six-card flush plays its top five.
  assert.equal(score('Ah Kh 9h 7h 4h 2h 3c'), score('Ah Kh 9h 7h 4h 3h 2c'));
  // A seventh card can extend a straight upward.
  assert.equal(score('5h 6d 7s 8c 9s Td 2c'), score('6h 7d 8s 9c Ts 2d 3c'));
});

test('kicker comparisons', () => {
  assert.ok(score('Ah Ad Ks 7c 5s 3d 2c') > score('Ah Ad Qs Jc Ts 3d 2c'), 'pair: first kicker');
  assert.ok(score('Ah Ad Ks Qc 5s 3d 2c') > score('Ah Ad Ks Jc Ts 3d 2c'), 'pair: second kicker');
  assert.ok(score('Ah Ad Ks Qc 6s 3d 2c') > score('Ah Ad Ks Qc 5s 4d 2c'), 'pair: third kicker');
  assert.equal(score('Ah Ad Ks Qc 6s 5d 4c'), score('Ah Ad Ks Qc 6s 3d 2c'), 'pair: only three kickers count');
  assert.ok(score('Ah Kd Qs Jc 9s 3d 2c') > score('Ah Kd Qs Jc 8s 7d 6c'), 'high card: fifth card');
  assert.equal(score('Ah Kd Qs Jc 9s 3d 2c'), score('Ah Kd Qs Jc 9s 4d 3c'), 'high card: only five count');
  assert.ok(score('7h 7d 7s Kc 4s 3d 2c') > score('7h 7d 7s Qc Js 3d 2c'), 'trips: first kicker');
  assert.equal(score('7h 7d 7s Kc Qs 4d 2c'), score('7h 7d 7s Kc Qs 3d 2c'), 'trips: only two kickers count');
  assert.ok(score('Ah Ad 3s 3c 2s 7d 8c') > score('Kh Kd Qs Qc 2s 7d 8c'), 'two pair: top pair first');
  assert.ok(score('Ah Ad 3s 3c 2s 4d Kc') > score('Ah Ad 3s 3c 2s 4d Qc'), 'two pair: kicker');
  assert.ok(score('Ah 9h 7h 4h 3h Kd 2c') > score('Ah 9h 7h 4h 2h Kd 3c'), 'flush: last card');
  assert.ok(score('Kh Kd Ks 2c 2s 4d 5c') > score('Qh Qd Qs Ac As 4d 5c'), 'full house: trips first');
  assert.ok(score('2h 2d 2s 2c As 4d 5c') > score('2h 2d 2s 2c Ks Qd Jc'), 'quads: kicker');
});

const GRID = [];
for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) GRID.push(R.gridCell(r, c));

test('ORDER is a permutation of the 169 grid classes and EQUITY covers exactly those', () => {
  assert.equal(H.ORDER.length, 169);
  assert.deepEqual([...H.ORDER].sort(), [...GRID].sort());
  assert.deepEqual(Object.keys(H.EQUITY).sort(), [...GRID].sort());
  for (const h of GRID) {
    assert.equal(typeof H.EQUITY[h], 'number', h);
    assert.ok(H.EQUITY[h] > 0 && H.EQUITY[h] < 1, h);
  }
});

test('AA first, near 73.4% against two random hands', () => {
  assert.equal(H.ORDER[0], 'AA');
  assert.ok(Math.abs(H.EQUITY.AA - 0.734) <= 0.006, 'AA equity ' + H.EQUITY.AA);
});

test('top pairs strictly ordered', () => {
  const pairs = ['AA', 'KK', 'QQ', 'JJ', 'TT'];
  for (let i = 1; i < pairs.length; i++) assert.ok(H.EQUITY[pairs[i - 1]] > H.EQUITY[pairs[i]], pairs[i - 1] + ' > ' + pairs[i]);
});

test('every suited class beats its offsuit twin', () => {
  for (const h of GRID) {
    if (!h.endsWith('s')) continue;
    const off = h.slice(0, 2) + 'o';
    assert.ok(H.EQUITY[h] > H.EQUITY[off], h + ' ' + H.EQUITY[h] + ' vs ' + off + ' ' + H.EQUITY[off]);
  }
});

test('EQUITY descends along ORDER, ties in grid order', () => {
  for (let i = 1; i < H.ORDER.length; i++) {
    const a = H.ORDER[i - 1];
    const b = H.ORDER[i];
    assert.ok(H.EQUITY[a] >= H.EQUITY[b], a + ' before ' + b);
    if (H.EQUITY[a] === H.EQUITY[b]) assert.ok(R.gridIndex(a) < R.gridIndex(b), 'tie ' + a + ' ' + b);
  }
});

test('classCombos gives 6 / 4 / 12 distinct combos of the right shape', () => {
  for (const h of GRID) {
    const list = G.classCombos(h);
    assert.equal(list.length, R.combos(h), h);
    const seen = new Set(list.map(([x, y]) => Math.min(x, y) * 52 + Math.max(x, y)));
    assert.equal(seen.size, list.length, h);
  }
  assert.deepEqual(G.classCombos('AKs').map(([x, y]) => [x & 3, y & 3]), [[0, 0], [1, 1], [2, 2], [3, 3]]);
});
