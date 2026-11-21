'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/situation.js');

const seats = (n) => Array.from({ length: n }, (_, i) => i + 1);

// 7-handed, dealer seat 7: 1 sb, 2 bb, 3-4 first 2, 5 middle, 6 cutoff, 7 button.
function input(over) {
  return Object.assign({
    dealtSeats: seats(7), dealerSeat: 7, deadButton: false, heroSeat: 6,
    posts: { 1: 1, 2: 2 }, bets: { 1: 1, 2: 2 }, sb: 1, bb: 2,
    heroCards: ['As', 'Ks'], board: 0, variant: 'NLH',
    heroTurnIndex: 1, canFold: true, canCheck: false
  }, over);
}

// Label of every dealt seat, in dealtSeats order.
function labels(dealtSeats, dealerSeat, extra) {
  return dealtSeats.map((heroSeat) => {
    const s = S.build(input(Object.assign({ dealtSeats, dealerSeat, heroSeat, posts: {}, bets: {} }, extra)));
    assert.equal(s.ok, true, s.reason);
    return s.label;
  });
}

test('attaches to globalThis.PNAF', () => {
  assert.equal(globalThis.PNAF.situation, S);
});

test('labels for 2..10 players (dealer last)', () => {
  const expect = {
    2: ['bb', 'sb'],
    3: ['sb', 'bb', 'button'],
    4: ['sb', 'bb', 'cutoff', 'button'],
    5: ['sb', 'bb', 'first2', 'cutoff', 'button'],
    6: ['sb', 'bb', 'first2', 'first2', 'cutoff', 'button'],
    7: ['sb', 'bb', 'first2', 'first2', 'middle', 'cutoff', 'button'],
    8: ['sb', 'bb', 'first2', 'first2', 'middle', 'middle', 'cutoff', 'button'],
    9: ['sb', 'bb', 'first2', 'first2', 'middle', 'middle', 'middle', 'cutoff', 'button'],
    10: ['sb', 'bb', 'first2', 'first2', 'middle', 'middle', 'middle', 'middle', 'cutoff', 'button']
  };
  for (let n = 2; n <= 10; n++) {
    assert.deepEqual(labels(seats(n), n), expect[n], n + ' players');
    const s = S.build(input({ dealtSeats: seats(n), dealerSeat: n, heroSeat: 1 }));
    assert.equal(s.players, n);
    assert.equal(s.headsUp, n === 2);
  }
});

test('rotation: action order starts after the dealer, any rotation and seat gaps', () => {
  assert.deepEqual(labels([3, 5, 8, 9, 1], 9), ['bb', 'first2', 'cutoff', 'button', 'sb']);
  assert.deepEqual(labels([3, 5, 8, 9, 1], 3), ['button', 'sb', 'bb', 'first2', 'cutoff']);
  assert.deepEqual(labels([4, 7], 4), ['sb', 'bb']);
  assert.deepEqual(labels([4, 7], 7), ['bb', 'sb']);
});

test('straddle moves first 2 and labels the straddler', () => {
  const posts = { 1: 1, 2: 2, 3: 4 };
  assert.deepEqual(labels(seats(8), 8, { posts }),
    ['sb', 'bb', 'straddle', 'first2', 'first2', 'middle', 'cutoff', 'button']);
  assert.deepEqual(labels(seats(8), 8, { posts: { 1: 1, 2: 2 } }),
    ['sb', 'bb', 'first2', 'first2', 'middle', 'middle', 'cutoff', 'button']);
  // 4-handed: the straddler is also the seat before the dealer; straddle wins over cutoff.
  assert.deepEqual(labels(seats(4), 4, { posts }), ['sb', 'bb', 'straddle', 'button']);
  // 3-handed: the dealer straddles; straddle wins over button.
  assert.deepEqual(labels(seats(3), 3, { posts }), ['sb', 'bb', 'straddle']);
  const s = S.build(input({ dealtSeats: seats(8), dealerSeat: 8, heroSeat: 6, posts, bets: posts }));
  assert.equal(s.straddle, true);
  assert.equal(s.level, 4);
});

test('a post equal to the big blind after the blinds is not a straddle', () => {
  const posts = { 1: 1, 2: 2, 3: 2 };
  assert.deepEqual(labels(seats(6), 6, { posts }), ['sb', 'bb', 'first2', 'first2', 'cutoff', 'button']);
  const s = S.build(input({ posts, bets: posts }));
  assert.equal(s.straddle, false);
  assert.equal(s.level, 2);
});

test('heads-up has no straddle detection', () => {
  const s = S.build(input({ dealtSeats: [1, 2], dealerSeat: 1, heroSeat: 1, posts: { 1: 1, 2: 4 }, bets: { 1: 1, 2: 4 } }));
  assert.equal(s.label, 'sb');
  assert.equal(s.headsUp, true);
  assert.equal(s.straddle, false);
  assert.equal(s.level, 2, 'level stays the big blind');
});

test('dead button, missing dealer and dealer not dealt in give label null', () => {
  for (const over of [{ deadButton: true }, { dealerSeat: null }, { dealerSeat: 9 }]) {
    const s = S.build(input(over));
    assert.equal(s.ok, true);
    assert.equal(s.label, null, JSON.stringify(over));
  }
});

test('limpers vs raisers', () => {
  let s = S.build(input({ bets: { 1: 1, 2: 2, 3: 2, 4: 2 } }));
  assert.equal(s.limpers, 2);
  assert.equal(s.raises, 0);
  assert.equal(s.raiseToBB, null);

  s = S.build(input({ bets: { 1: 1, 2: 2, 3: 6 } }));
  assert.equal(s.limpers, 0);
  assert.equal(s.raises, 1);
  assert.equal(s.raiseToBB, 3);

  s = S.build(input({ bets: { 1: 1, 2: 2, 3: 2, 4: 7, 5: 7 } }));
  assert.equal(s.limpers, 1, 'the limper is still counted');
  assert.equal(s.raises, 1, 'raise plus a call of it is one raise');
  assert.equal(s.raiseToBB, 3.5);

  s = S.build(input({ bets: { 1: 1, 2: 2, 3: 6, 4: 18 } }));
  assert.equal(s.raises, 2, '3-bet');
  assert.equal(s.raiseToBB, null);

  s = S.build(input({ bets: { 1: 1, 2: 2, 3: 6, 4: 18, 5: 50 } }));
  assert.equal(s.raises, 2, '4-bet is capped at 2');
});

test('small blind completing with unequal blinds is a limper', () => {
  const s = S.build(input({ heroSeat: 7, bets: { 1: 2, 2: 2 } }));
  assert.equal(s.limpers, 1);
  assert.equal(s.raises, 0);
});

test('small blind post with equal blinds is not a limper', () => {
  const s = S.build(input({ heroSeat: 7, sb: 2, bb: 2, posts: { 1: 2, 2: 2 }, bets: { 1: 2, 2: 2 } }));
  assert.equal(s.limpers, 0);
  assert.equal(s.raises, 0);
});

test('missed-blind post equal to the big blind is not a limper', () => {
  let s = S.build(input({ posts: { 1: 1, 2: 2, 5: 2 }, bets: { 1: 1, 2: 2, 5: 2 } }));
  assert.equal(s.limpers, 0);
  s = S.build(input({ posts: { 1: 1, 2: 2, 5: 2 }, bets: { 1: 1, 2: 2, 4: 2, 5: 2 } }));
  assert.equal(s.limpers, 1);
  // dead small blind plus big blind (3) is above the level but was posted, not raised
  s = S.build(input({ posts: { 1: 1, 2: 2, 5: 3 }, bets: { 1: 1, 2: 2, 5: 3 } }));
  assert.equal(s.raises, 0);
  assert.equal(s.limpers, 0);
});

test('straddle sets the limp level', () => {
  const posts = { 1: 1, 2: 2, 3: 4 };
  let s = S.build(input({ dealtSeats: seats(8), dealerSeat: 8, heroSeat: 7, posts, bets: { 1: 1, 2: 2, 3: 4, 4: 4 } }));
  assert.equal(s.label, 'cutoff');
  assert.equal(s.level, 4);
  assert.equal(s.limpers, 1, 'calling the straddle is a limp');
  assert.equal(s.raises, 0, 'the straddle itself is not a raise');

  s = S.build(input({ dealtSeats: seats(8), dealerSeat: 8, heroSeat: 7, posts, bets: { 1: 1, 2: 2, 3: 4, 4: 12 } }));
  assert.equal(s.raises, 1);
  assert.equal(s.raiseToBB, 6, 'raiseToBB is in big blinds, not straddles');
});

test('the hero is not counted as a limper or raiser', () => {
  const s = S.build(input({ heroSeat: 3, bets: { 1: 1, 2: 2, 3: 6 } }));
  assert.equal(s.raises, 0);
  assert.equal(s.limpers, 0);
  assert.equal(s.heroActed, true);
});

test('heroActed via turn index and via bet above post', () => {
  assert.equal(S.build(input()).heroActed, false);
  assert.equal(S.build(input({ heroTurnIndex: 2 })).heroActed, true);
  assert.equal(S.build(input({ heroSeat: 2 })).heroActed, false, 'big blind with only its post');
  assert.equal(S.build(input({ heroSeat: 2, bets: { 1: 1, 2: 6, 3: 18 } })).heroActed, true);
  assert.equal(S.build(input({ heroSeat: 1, bets: { 1: 2, 2: 2 } })).heroActed, true, 'small blind that completed');
});

test('money is compared in cents', () => {
  // 0.1 + 0.2 !== 0.3 in floating point
  const sb = 0.15;
  const bb = 0.3;
  let s = S.build(input({ sb, bb, posts: { 1: sb, 2: bb }, bets: { 1: sb, 2: bb, 3: 0.1 + 0.2 } }));
  assert.equal(s.limpers, 1);
  assert.equal(s.raises, 0);
  s = S.build(input({ sb, bb, posts: { 1: sb, 2: 0.1 + 0.2 }, bets: { 1: sb, 2: bb } }));
  assert.equal(s.limpers, 0);
  s = S.build(input({ heroSeat: 2, sb, bb, posts: { 1: sb, 2: 0.1 + 0.2 }, bets: { 1: sb, 2: bb } }));
  assert.equal(s.heroActed, false);
  s = S.build(input({ sb, bb, posts: { 1: sb, 2: bb }, bets: { 1: sb, 2: bb, 3: 0.9 } }));
  assert.equal(s.raiseToBB, 3, '0.9 / 0.3 is exactly 3');
  assert.equal(s.level, 0.3);
});

test('string seat keys in posts and bets work', () => {
  const s = S.build(input({ posts: { '1': 1, '2': 2 }, bets: { '1': 1, '2': 2, '3': 2 } }));
  assert.equal(s.limpers, 1);
});

test('ok:false reasons', () => {
  const cases = [
    [{ posts: null }, 'start of hand not seen'],
    [{ posts: null, heroSeat: null }, 'start of hand not seen'],
    [{ heroSeat: null }, 'hero not dealt in'],
    [{ heroSeat: 9 }, 'hero not dealt in'],
    [{ sb: null }, 'blinds unknown'],
    [{ bb: null }, 'blinds unknown'],
    [{ bb: 0 }, 'blinds unknown'],
    [{ heroCards: [] }, 'cards unreadable'],
    [{ heroCards: ['As'] }, 'cards unreadable'],
    [{ heroCards: ['As', 'As'] }, 'cards unreadable'],
    [{ heroCards: ['As', 'Kx'] }, 'cards unreadable'],
    [{ heroCards: ['As', 'Ks', 'Qs', 'Js'] }, 'cards unreadable']
  ];
  for (const [over, reason] of cases) {
    const s = S.build(input(over));
    assert.equal(s.ok, false, JSON.stringify(over));
    assert.equal(s.reason, reason, JSON.stringify(over));
    assert.equal(s.hand, null);
    assert.equal(s.label, null);
  }
});

test('ok situation carries the passthrough fields', () => {
  const s = S.build(input({ heroCards: ['Kd', 'Ah'], board: 0, canCheck: true }));
  assert.equal(s.ok, true);
  assert.equal(s.reason, null);
  assert.equal(s.hand, 'AKo');
  assert.deepEqual(s.heroCards, ['Kd', 'Ah']);
  assert.equal(s.variant, 'NLH');
  assert.equal(s.board, 0);
  assert.equal(s.canFold, true);
  assert.equal(s.canCheck, true);
  assert.equal(s.label, 'cutoff');
});
