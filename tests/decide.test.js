'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const decideModule = require('../src/decide.js');
const S = require('../src/situation.js');
const D = require('../src/defaults.js');

const decide = decideModule.decide;
const CONFIG = D.config();

function sit(over) {
  return Object.assign({
    ok: true, reason: null, hand: 'AKs', heroCards: ['As', 'Ks'], board: 0, variant: 'NLH',
    label: 'cutoff', players: 7, headsUp: false, straddle: false, level: 2,
    limpers: 0, raises: 0, raiseToBB: null, heroActed: false, canFold: true, canCheck: false
  }, over);
}

function check(over, action, spot, inRange, config) {
  const d = decide(sit(over), config || CONFIG);
  assert.equal(d.action, action, JSON.stringify(over) + ' action (' + d.reason + ')');
  assert.equal(d.spot, spot, JSON.stringify(over) + ' spot');
  if (inRange !== undefined) assert.equal(d.inRange, inRange, JSON.stringify(over) + ' inRange');
  assert.equal(typeof d.reason, 'string');
  return d;
}

// End to end through situation.build. 7-handed, dealer seat 7: 1 sb, 2 bb, 3-4 first 2, 5 middle, 6 cutoff, 7 button.
function table(over) {
  const s = S.build(Object.assign({
    dealtSeats: [1, 2, 3, 4, 5, 6, 7], dealerSeat: 7, deadButton: false, heroSeat: 6,
    posts: { 1: 1, 2: 2 }, bets: { 1: 1, 2: 2 }, sb: 1, bb: 2,
    heroCards: ['5s', '4s'], board: 0, variant: 'NLH',
    heroTurnIndex: 1, canFold: true, canCheck: false
  }, over));
  return decide(s, CONFIG);
}

test('exports and result shape', () => {
  assert.equal(globalThis.PNAF.decide, decideModule);
  assert.equal(typeof decideModule, 'function', 'PNAF.decide(s, c) is callable');
  const d = decideModule(sit({ hand: '32o' }), CONFIG);
  assert.deepEqual(Object.keys(d).sort(), ['action', 'hand', 'inRange', 'label', 'reason', 'spot']);
  assert.equal(d.hand, '32o');
  assert.equal(d.label, 'cutoff');
});

test('1. not ok → leave unknown', () => {
  check({ ok: false, reason: 'start of hand not seen', hand: null, label: null }, 'leave', 'unknown', null);
  check({ ok: false, hand: '32o' }, 'leave', 'unknown', null);
});

test('2. not Hold\'em → leave not_holdem', () => {
  check({ variant: 'PLO', hand: '32o' }, 'leave', 'not_holdem', null);
  check({ variant: null, hand: '32o' }, 'leave', 'not_holdem', null);
  check({ heroCards: ['3s', '2d', 'Kc', 'Kd'], hand: '32o' }, 'leave', 'not_holdem', null);
});

test('3. board → leave postflop', () => {
  check({ board: 3, hand: '32o' }, 'leave', 'postflop', null);
  check({ board: 3, hand: '32o', variant: 'PLO' }, 'leave', 'not_holdem');
});

test('4. no label → leave seat_unknown', () => {
  check({ label: null, hand: '32o' }, 'leave', 'seat_unknown', null);
});

test('5. neverFold beats everything after it, including a free check', () => {
  check({ hand: '72o' }, 'leave', 'never_fold', null);
  check({ hand: '72s', label: 'button', limpers: 2 }, 'leave', 'never_fold');
  check({ hand: '72o', label: 'bb', canCheck: true }, 'leave', 'never_fold');
  check({ hand: '72o', heroActed: true }, 'leave', 'never_fold');
  check({ hand: '72o', raises: 2 }, 'leave', 'never_fold');
  check({ hand: '73o' }, 'fold', 'unopened', false);
});

test('6. second decision → leave', () => {
  check({ hand: '32o', heroActed: true }, 'leave', 'second_decision', null);
  check({ hand: '32o', heroActed: true, label: 'bb', canCheck: true }, 'leave', 'second_decision');
});

test('7. 3-bet or more → leave', () => {
  check({ hand: '32o', raises: 2 }, 'leave', 'three_bet', null);
  check({ hand: '32o', raises: 2, label: 'sb' }, 'leave', 'three_bet');
  check({ hand: '32o', raises: 2, headsUp: true, label: 'bb', canCheck: false }, 'leave', 'three_bet');
});

test('8. heads-up: free check only, otherwise leave', () => {
  const hu = { headsUp: true, players: 2 };
  check({ ...hu, label: 'bb', canCheck: true, hand: '32o' }, 'check', 'free_check', false);
  check({ ...hu, label: 'bb', canCheck: true, hand: '54s' }, 'leave', 'free_check', true);
  check({ ...hu, label: 'bb', canCheck: true, hand: 'K8s' }, 'check', 'free_check', false, undefined);
  // small blind free check uses the cutoff set: K6s is in cutoff, not in bbVsOpen
  check({ ...hu, label: 'sb', canCheck: true, hand: 'K6s' }, 'leave', 'free_check', true);
  check({ ...hu, label: 'sb', canCheck: true, hand: '54s' }, 'check', 'free_check', false);
  check({ ...hu, label: 'bb', raises: 1, raiseToBB: 3, hand: '32o' }, 'leave', 'heads_up', null);
  check({ ...hu, label: 'sb', canCheck: false, hand: '32o' }, 'leave', 'heads_up', null);
  check({ ...hu, label: 'bb', canCheck: false, hand: '32o' }, 'leave', 'heads_up', null);
});

test('9. small blind', () => {
  check({ label: 'sb', canCheck: true, hand: '32o' }, 'check', 'free_check', false);
  check({ label: 'sb', canCheck: true, hand: 'K6s' }, 'leave', 'free_check', true);
  check({ label: 'sb', canCheck: false, hand: '32o' }, 'fold', 'sb_unequal', false);
  check({ label: 'sb', canCheck: false, hand: 'K6s' }, 'leave', 'sb_unequal', true);
  check({ label: 'sb', canCheck: false, hand: 'K6s', limpers: 2 }, 'leave', 'sb_unequal', true);
  check({ label: 'sb', raises: 1, raiseToBB: 3, hand: '54s' }, 'fold', 'vs_raise', false);
  check({ label: 'sb', raises: 1, raiseToBB: 3, hand: 'JTs' }, 'leave', 'vs_raise', true);
  check({ label: 'sb', raises: 1, raiseToBB: 20, hand: 'A9s' }, 'fold', 'vs_raise', false);
});

test('10. big blind', () => {
  check({ label: 'bb', canCheck: true, hand: '32o' }, 'check', 'free_check', false);
  check({ label: 'bb', canCheck: true, hand: '54s', limpers: 3 }, 'leave', 'free_check', true);
  check({ label: 'bb', canCheck: false, hand: '32o' }, 'leave', 'unknown', null);
  check({ label: 'bb', raises: 1, raiseToBB: 6, hand: 'K8s' }, 'fold', 'bb_vs_open', false);
  check({ label: 'bb', raises: 1, raiseToBB: 6, hand: 'K9s' }, 'leave', 'bb_vs_open', true);
  check({ label: 'bb', raises: 1, raiseToBB: 2.5, hand: '54s' }, 'leave', 'bb_vs_open', true);
  check({ label: 'bb', raises: 1, raiseToBB: 6.5, hand: '32o' }, 'leave', 'big_raise', null);
  check({ label: 'bb', raises: 1, raiseToBB: 3, straddle: true, level: 4, hand: '32o' }, 'leave', 'straddled_blind', null);
  check({ label: 'bb', raises: 1, raiseToBB: 8, hand: '32o' }, 'fold', 'bb_vs_open', false,
    { ...CONFIG, bbOpenMaxBB: 8 });
});

test('11. straddler', () => {
  const st = { label: 'straddle', straddle: true, level: 4 };
  check({ ...st, canCheck: true, hand: '32o' }, 'check', 'free_check', false);
  check({ ...st, canCheck: true, hand: '98s' }, 'leave', 'free_check', true);
  check({ ...st, canCheck: false, hand: '32o' }, 'leave', 'unknown', null);
  check({ ...st, raises: 1, raiseToBB: 3, hand: '32o' }, 'leave', 'straddled_blind', null);
});

test('12. seat ranges: unopened, limpers, facing one raise', () => {
  check({ label: 'first2', hand: 'A9s' }, 'leave', 'unopened', true);
  check({ label: 'first2', hand: 'A8s' }, 'fold', 'unopened', false);
  check({ label: 'middle', hand: 'A8s' }, 'leave', 'unopened', true);
  check({ label: 'middle', hand: 'K6s' }, 'fold', 'unopened', false);
  check({ label: 'cutoff', hand: 'K6s' }, 'leave', 'unopened', true);
  check({ label: 'cutoff', hand: '54s' }, 'fold', 'unopened', false);
  check({ label: 'button', hand: '54s' }, 'leave', 'unopened', true);
  check({ label: 'button', hand: 'T8o' }, 'fold', 'unopened', false);

  check({ label: 'cutoff', hand: '54s', limpers: 1 }, 'leave', 'limpers', true);
  check({ label: 'cutoff', hand: 'K5s', limpers: 1 }, 'fold', 'limpers', false);
  check({ label: 'middle', hand: '54s', limpers: 1 }, 'fold', 'limpers', false);
  check({ label: 'first2', hand: '98s', limpers: 2 }, 'fold', 'limpers', false);
  // button gets the extra set too (visible with a custom button range)
  const tight = { ...CONFIG, ranges: { ...CONFIG.ranges, button: 'AA' } };
  check({ label: 'button', hand: '76s', limpers: 1 }, 'leave', 'limpers', true, tight);
  check({ label: 'button', hand: '76s' }, 'fold', 'unopened', false, tight);

  check({ label: 'middle', hand: '54s', raises: 1, raiseToBB: 3 }, 'leave', 'vs_raise', true);
  check({ label: 'first2', hand: '32o', raises: 1, raiseToBB: 3 }, 'fold', 'vs_raise', false);
  check({ label: 'button', hand: 'A9s', raises: 1, raiseToBB: 3, limpers: 1 }, 'fold', 'vs_raise', false);
  check({ label: 'cutoff', hand: 'KQo', raises: 1, raiseToBB: 3 }, 'leave', 'vs_raise', true);
});

test('13. guards: fold while check is free becomes check; missing buttons leave', () => {
  check({ hand: '32o', canCheck: true }, 'check', 'unopened', false);
  check({ label: 'sb', hand: '32o', canCheck: true, canFold: false }, 'check', 'free_check', false);
  check({ hand: '32o', canFold: false }, 'leave', 'no_button', false);
  check({ label: 'sb', hand: '32o', canFold: false }, 'leave', 'no_button', false);
  check({ hand: 'AKs', canFold: false }, 'leave', 'unopened', true);
});

test('a range with unreadable tokens is never used to fold', () => {
  const broken = { ...CONFIG, ranges: { ...CONFIG.ranges, cutoff: '22+, XX' } };
  check({ hand: '32o' }, 'leave', 'unknown', null, broken);
  check({ label: 'middle', hand: '32o' }, 'fold', 'unopened', false, broken);
  const noNever = { ...CONFIG, ranges: { ...CONFIG.ranges, neverFold: '72z' } };
  check({ hand: '32o' }, 'leave', 'unknown', null, noNever);
});

test('different config objects are parsed separately', () => {
  check({ hand: 'K6s' }, 'leave', 'unopened', true);
  check({ hand: 'K6s' }, 'fold', 'unopened', false, { ...CONFIG, ranges: { ...CONFIG.ranges, cutoff: 'AA' } });
  check({ hand: 'K6s' }, 'leave', 'unopened', true);
});

test('end to end: situation.build feeding decide', () => {
  // 54s in the cutoff
  let d = table({});
  assert.deepEqual([d.action, d.spot, d.label], ['fold', 'unopened', 'cutoff']);
  d = table({ bets: { 1: 1, 2: 2, 4: 2 } });
  assert.deepEqual([d.action, d.spot], ['leave', 'limpers']);
  // 54s in a middle seat facing a raise
  d = table({ heroSeat: 5, bets: { 1: 1, 2: 2, 3: 6 } });
  assert.deepEqual([d.action, d.spot, d.label], ['leave', 'vs_raise', 'middle']);
  // small blind facing a raise folds 54s
  d = table({ heroSeat: 1, bets: { 1: 1, 2: 2, 3: 6 } });
  assert.deepEqual([d.action, d.spot, d.label], ['fold', 'vs_raise', 'sb']);
  // small blind owing chips in an unraised pot (unequal blinds)
  d = table({ heroSeat: 1, heroCards: ['Kh', '5h'], bets: { 1: 1, 2: 2, 4: 2 } });
  assert.deepEqual([d.action, d.spot], ['fold', 'sb_unequal']);
  d = table({ heroSeat: 1, heroCards: ['Kh', '6h'] });
  assert.deepEqual([d.action, d.spot], ['leave', 'sb_unequal']);
  // big blind facing 6bb vs 6.5bb
  d = table({ heroSeat: 2, heroCards: ['Kh', '8h'], bets: { 1: 1, 2: 2, 3: 12 } });
  assert.deepEqual([d.action, d.spot], ['fold', 'bb_vs_open']);
  d = table({ heroSeat: 2, heroCards: ['Kh', '8h'], bets: { 1: 1, 2: 2, 3: 13 } });
  assert.deepEqual([d.action, d.spot], ['leave', 'big_raise']);
  // big blind free check
  d = table({ heroSeat: 2, heroCards: ['3h', '2c'], bets: { 1: 2, 2: 2, 5: 2 }, canCheck: true });
  assert.deepEqual([d.action, d.spot], ['check', 'free_check']);
  // straddled pot, big blind facing a raise
  const posts = { 1: 1, 2: 2, 3: 4 };
  d = table({ heroSeat: 2, heroCards: ['3h', '2c'], posts, bets: { 1: 1, 2: 2, 3: 4, 4: 10 } });
  assert.deepEqual([d.action, d.spot], ['leave', 'straddled_blind']);
  // straddler checks its option with junk
  d = table({ heroSeat: 3, heroCards: ['3h', '2c'], posts, bets: { 1: 4, 2: 4, 3: 4, 5: 4 }, canCheck: true });
  assert.deepEqual([d.action, d.spot, d.label], ['check', 'free_check', 'straddle']);
  // heads-up: free check vs facing a raise
  const hu = { dealtSeats: [1, 2], dealerSeat: 1, heroSeat: 2, heroCards: ['3h', '2c'], posts: { 1: 1, 2: 2 } };
  d = table({ ...hu, bets: { 1: 2, 2: 2 }, canCheck: true });
  assert.deepEqual([d.action, d.spot, d.label], ['check', 'free_check', 'bb']);
  d = table({ ...hu, bets: { 1: 6, 2: 2 } });
  assert.deepEqual([d.action, d.spot], ['leave', 'heads_up']);
  // dead button
  d = table({ deadButton: true, heroCards: ['3h', '2c'] });
  assert.deepEqual([d.action, d.spot], ['leave', 'seat_unknown']);
  // start of hand not seen
  d = table({ posts: null, heroCards: ['3h', '2c'] });
  assert.deepEqual([d.action, d.spot], ['leave', 'unknown']);
});
