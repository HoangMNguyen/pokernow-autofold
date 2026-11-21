'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/ranges.js');

const hands = (text) => {
  const r = R.parseRange(text);
  assert.deepEqual(r.errors, [], 'unexpected errors for ' + JSON.stringify(text));
  return r.hands;
};
const sorted = (list) => [...list].sort((a, b) => R.gridIndex(a) - R.gridIndex(b));

test('attaches to globalThis.PNAF', () => {
  assert.equal(globalThis.PNAF.ranges, R);
  assert.equal(R.RANKS, 'AKQJT98765432');
});

test('empty and blank input give no hands and no errors', () => {
  for (const t of ['', '   ', ',, ;\n', '\n\n']) assert.deepEqual(R.parseRange(t), { hands: [], errors: [] });
});

test('pairs, pair-plus and pair runs in both orders', () => {
  assert.deepEqual(hands('77'), ['77']);
  assert.deepEqual(hands('77+'), ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77']);
  assert.deepEqual(hands('AA+'), ['AA']);
  assert.equal(hands('22+').length, 13);
  assert.deepEqual(hands('22-66'), ['66', '55', '44', '33', '22']);
  assert.deepEqual(hands('66-22'), hands('22-66'));
  assert.deepEqual(hands('99-99'), ['99']);
});

test('non-pair hands: suited, offsuit, both', () => {
  assert.deepEqual(hands('AKs'), ['AKs']);
  assert.deepEqual(hands('AKo'), ['AKo']);
  assert.deepEqual(hands('AK'), ['AKs', 'AKo']);
  assert.deepEqual(hands('72o, 72s'), ['72s', '72o']);
});

test('kicker-plus goes up to one rank below the high card', () => {
  assert.deepEqual(hands('A9s+'), ['AKs', 'AQs', 'AJs', 'ATs', 'A9s']);
  assert.deepEqual(hands('AJo+'), ['AKo', 'AQo', 'AJo']);
  assert.deepEqual(sorted(hands('AT+')), sorted(['AKs', 'AQs', 'AJs', 'ATs', 'AKo', 'AQo', 'AJo', 'ATo']));
  assert.deepEqual(hands('KQs+'), ['KQs']);
  assert.deepEqual(hands('K2s+').length, 11);
  assert.ok(!hands('K9s+').includes('AKs'), 'K9s+ must not reach AKs');
});

test('kicker runs in both orders', () => {
  const expect = ['A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s'];
  assert.deepEqual(hands('A2s-A8s'), expect);
  assert.deepEqual(hands('A8s-A2s'), expect);
  assert.deepEqual(hands('A5o-A8o'), ['A8o', 'A7o', 'A6o', 'A5o']);
  assert.deepEqual(sorted(hands('K8-K6')), sorted(['K8s', 'K7s', 'K6s', 'K8o', 'K7o', 'K6o']));
});

test('connector runs in both orders, including gapped runs', () => {
  const expect = ['T9s', '98s', '87s', '76s', '65s', '54s'];
  assert.deepEqual(hands('54s-T9s'), expect);
  assert.deepEqual(hands('T9s-54s'), expect);
  assert.deepEqual(hands('54s-98s'), ['98s', '87s', '76s', '65s', '54s']);
  assert.deepEqual(hands('64s-T8s'), ['T8s', '97s', '86s', '75s', '64s']);
  assert.deepEqual(hands('KQo-JTo'), ['KQo', 'QJo', 'JTo']);
});

test('en dash, em dash, 10 for T, lowercase, mixed separators', () => {
  assert.deepEqual(hands('A2s\u2013A8s'), hands('A2s-A8s'));
  assert.deepEqual(hands('54s\u2014T9s'), hands('54s-T9s'));
  assert.deepEqual(hands('A10s'), ['ATs']);
  assert.deepEqual(hands('1010'), ['TT']);
  assert.deepEqual(hands('109s'), ['T9s']);
  assert.deepEqual(hands('aks'), ['AKs']);
  assert.deepEqual(hands('AKS'), ['AKs']);
  assert.deepEqual(hands('t9s, kqO'), ['KQo', 'T9s']);
  assert.deepEqual(hands('a9s+'), hands('A9s+'));
  assert.deepEqual(hands(' AA ;KK\nQQ\r\nJJ , '), ['AA', 'KK', 'QQ', 'JJ']);
});

test('result is unique and in grid order', () => {
  const r = hands('AKo, 22, AKs, AA, AK, 22-33, 32o');
  assert.deepEqual(r, ['AA', 'AKs', 'AKo', '33', '32o', '22']);
  const all = [];
  for (let row = 0; row < 13; row++) for (let col = 0; col < 13; col++) all.push(R.gridCell(row, col));
  const everything = hands('22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32');
  assert.deepEqual(everything, all);
  assert.equal(R.percent(everything), 100);
});

test('bad tokens are errors and contribute no hands', () => {
  const bad = ['77++', 'AKx', 'A2s-K8s', '54s-T8s', 'XX', 'AA s', 'AAs', '77o', 'KAs', 'A', 'AKs+-AQs',
    '22-A5s', 'A2s-A8o', '22-33-44', '77+-99', 'A2s-', '-A2s', '1', 'AK s', 'A1s', 'AAA', 'A2s- A8s'];
  for (const token of bad) {
    const r = R.parseRange('KK, ' + token + ', QQ');
    assert.deepEqual(r.hands, ['KK', 'QQ'], token + ' must contribute no hands');
    assert.equal(r.errors.length, 1, token + ' must be one error');
    assert.equal(r.errors[0].token, token);
    assert.equal(typeof r.errors[0].message, 'string');
    assert.ok(r.errors[0].message.length > 0);
  }
});

test('every bad token gets its own error', () => {
  const r = R.parseRange('XX, AA, 77++; YY');
  assert.deepEqual(r.hands, ['AA']);
  assert.deepEqual(r.errors.map((e) => e.token), ['XX', '77++', 'YY']);
});

test('non-string input is empty', () => {
  assert.deepEqual(R.parseRange(undefined), { hands: [], errors: [] });
  assert.deepEqual(R.parseRange(null), { hands: [], errors: [] });
});

test('handClass', () => {
  assert.equal(R.handClass('As', 'Ks'), 'AKs');
  assert.equal(R.handClass('Ks', 'As'), 'AKs');
  assert.equal(R.handClass('Kd', 'Ah'), 'AKo');
  assert.equal(R.handClass('7c', '7d'), '77');
  assert.equal(R.handClass('2c', '7c'), '72s');
  assert.equal(R.handClass('Td', '9d'), 'T9s');
  assert.equal(R.handClass('As', 'As'), null, 'identical cards');
  assert.equal(R.handClass('Ax', 'Ks'), null, 'invalid suit');
  assert.equal(R.handClass('AS', 'Ks'), null, 'uppercase suit is not a card');
  assert.equal(R.handClass('1s', 'Ks'), null, 'invalid rank');
  assert.equal(R.handClass('10s', 'Ks'), null, 'card strings use T');
  assert.equal(R.handClass('As', undefined), null);
  assert.equal(R.handClass('', ''), null);
  assert.equal(R.handClass('Ash', 'Ks'), null);
});

test('gridCell corners and orientation', () => {
  assert.equal(R.gridCell(0, 0), 'AA');
  assert.equal(R.gridCell(12, 12), '22');
  assert.equal(R.gridCell(0, 12), 'A2s');
  assert.equal(R.gridCell(12, 0), 'A2o');
  assert.equal(R.gridCell(0, 1), 'AKs');
  assert.equal(R.gridCell(1, 0), 'AKo');
  assert.equal(R.gridCell(4, 5), 'T9s');
  assert.equal(R.gridCell(5, 4), 'T9o');
  assert.equal(R.gridCell(13, 0), null);
  assert.equal(R.gridCell(-1, 0), null);
});

test('combos and percent', () => {
  assert.equal(R.combos('AA'), 6);
  assert.equal(R.combos('AKs'), 4);
  assert.equal(R.combos('AKo'), 12);
  assert.equal(R.combos('XX'), 0);
  assert.equal(R.percent([]), 0);
  assert.equal(R.percent(['AA']), (6 / 1326) * 100);
  assert.equal(R.percent(['AA', 'AKs', 'AKo']), (22 / 1326) * 100);
  assert.equal(R.percent(['AA', 'AA']), (6 / 1326) * 100, 'duplicates count once');
  assert.equal(R.percent(hands('22+')), (78 / 1326) * 100);
});

// ---- PNAF.defaults ----

const D = require('../src/defaults.js');

// Hands written out one by one from the playbook's cumulative add-lists (no range shorthand
// beyond plain pairs), so a parser bug cannot hide behind the same parser on both sides.
const PAIRS = ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22'];
const FIRST2 = [...PAIRS, 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s',
  'AKo', 'AQo', 'AJo', 'KQo'];
const MIDDLE = [...FIRST2, 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'Q9s', 'J9s', '98s', '87s',
  'ATo', 'KJo', 'QJo'];
const CUTOFF = [...MIDDLE, 'K8s', 'K7s', 'K6s', 'T8s', '97s', '76s', '65s', 'A9o', 'KTo', 'QTo', 'JTo'];
const BUTTON = [...CUTOFF, 'K5s', 'K4s', 'K3s', 'K2s', 'Q8s', 'J8s', '86s', '75s', '54s',
  'A8o', 'A7o', 'A6o', 'A5o', 'K9o', 'Q9o', 'J9o', 'T9o'];
const CONNECTORS = ['T9s', '98s', '87s', '76s', '65s', '54s'];
const VS_RAISE_SB = [...PAIRS, 'AKs', 'AQs', 'AJs', 'ATs', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs',
  'AKo', 'AQo', 'AJo', 'KQo'];
const VS_RAISE_IP = [...VS_RAISE_SB, ...CONNECTORS];
const BB_VS_OPEN = [...PAIRS, 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', ...CONNECTORS,
  'AKo', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo', 'QJo'];

const EXPECT = {
  first2: [FIRST2, 174, '13.1'],
  middle: [MIDDLE, 258, '19.5'],
  cutoff: [CUTOFF, 334, '25.2'],
  button: [BUTTON, 466, '35.1'],
  vsRaiseIP: [VS_RAISE_IP, 190, '14.3'],
  vsRaiseSB: [VS_RAISE_SB, 166, '12.5'],
  bbVsOpen: [BB_VS_OPEN, 270, '20.4'],
  limpersExtraLate: [['98s', '87s', '76s', '65s', '54s'], 20, null],
  neverFold: [['72s', '72o'], 16, null]
};

const comboCount = (list) => list.reduce((n, h) => n + R.combos(h), 0);

test('config shape', () => {
  const c = D.config();
  assert.equal(c.version, 1);
  assert.equal(c.bbOpenMaxBB, 6);
  assert.deepEqual(Object.keys(c.ranges).sort(), [...D.RANGE_KEYS].sort());
  for (const key of D.RANGE_KEYS) {
    assert.equal(typeof D.LABELS[key], 'string', 'label for ' + key);
    assert.equal(typeof D.HINTS[key], 'string', 'hint for ' + key);
  }
  assert.deepEqual(D.SEAT_NAMES, { first2: 'first 2', middle: 'middle', cutoff: 'cutoff', button: 'button',
    sb: 'small blind', bb: 'big blind', straddle: 'straddle' });
  assert.equal(globalThis.PNAF.defaults, D);
});

test('each default range expands to exactly the playbook set', () => {
  const c = D.config();
  for (const key of D.RANGE_KEYS) {
    const [list, count, pct] = EXPECT[key];
    assert.equal(new Set(list).size, list.length, key + ' playbook list has duplicates');
    assert.equal(comboCount(list), count, key + ' playbook combo count');
    const r = R.parseRange(c.ranges[key]);
    assert.deepEqual(r.errors, [], key + ' parses cleanly');
    assert.deepEqual(new Set(r.hands), new Set(list), key + ' hand set');
    assert.equal(comboCount(r.hands), count, key + ' combos');
    if (pct) assert.equal(R.percent(r.hands).toFixed(1), pct, key + ' percent');
  }
});

test('the playbook add-list shorthand gives the same sets', () => {
  const add = {
    first2: '22+, A9s+, KTs+, QTs+, JTs, T9s, AJo+, KQo',
    middle: 'A2s\u2013A8s, K9s, Q9s, J9s, 98s, 87s, ATo, KJo, QJo',
    cutoff: 'K6s\u2013K8s, T8s, 97s, 76s, 65s, A9o, KTo, QTo, JTo',
    button: 'K2s\u2013K5s, Q8s, J8s, 86s, 75s, 54s, A5o\u2013A8o, K9o, Q9o, J9o, T9o'
  };
  let text = '';
  for (const key of ['first2', 'middle', 'cutoff', 'button']) {
    text += (text ? ', ' : '') + add[key];
    const r = R.parseRange(text);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(new Set(r.hands), new Set(EXPECT[key][0]), key + ' cumulative');
  }
});

test('config() returns independent deep copies', () => {
  const a = D.config();
  a.ranges.first2 = 'AA';
  a.bbOpenMaxBB = 99;
  const b = D.config();
  assert.equal(b.ranges.first2, '22+, A9s+, KTs+, QTs+, JTs, T9s, AJo+, KQo');
  assert.equal(b.bbOpenMaxBB, 6);
  assert.notEqual(a.ranges, b.ranges);
});
