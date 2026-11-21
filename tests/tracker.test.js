'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tracker = require('../src/tracker.js');
const defaults = require('../src/defaults.js');

// Eight seats, clockwise 1..8. Dealer 1: SB 2, BB 3, UTG 4, UTG+1 5, middle 6 and 7, cutoff 8, button 1.
const SEATS = [1, 2, 3, 4, 5, 6, 7, 8];
const BLINDS = { 2: 0.5, 3: 0.5 };

function blank() {
  return {
    gameId: 'g', heroSeat: null, heroCards: [], cardsError: null, board: 0, seats: [], clockwise: [],
    dealerSeat: null, deadButton: false, blinds: { sb: null, bb: null }, variant: null, heroTurn: false,
    buttons: { fold: null, check: null, call: null, callAmount: null }, straddleSeat: null, errors: [],
  };
}

function table({ hero = 6, cards = ['5s', '4s'], bets = BLINDS, current = null, heroTurn = false, straddleSeat = null, buttons = {}, dealt = SEATS, unreadable = [] } = {}) {
  return {
    gameId: 'g', heroSeat: hero, heroCards: cards, cardsError: null, board: 0,
    seats: dealt.map((seat) => ({
      seat, name: `p${seat}`, dealtIn: true, folded: false, bet: unreadable.includes(seat) ? null : bets[seat] || 0,
      isHero: seat === hero, isCurrent: seat === current,
    })),
    clockwise: SEATS, dealerSeat: 1, deadButton: false, blinds: { sb: 0.5, bb: 0.5 }, variant: 'NLH', heroTurn,
    buttons: { fold: buttons.fold ? {} : null, check: buttons.check ? {} : null, call: buttons.call ? {} : null, callAmount: null },
    straddleSeat, errors: unreadable.map((s) => `seat ${s}: unreadable bet "?"`),
  };
}

function play(reads) {
  const t = tracker.create();
  let now = 1000;
  for (const read of reads) {
    now += read.after || 100;
    tracker.observe(t, read.snap, now, defaults.config());
  }
  return t;
}

function decisionFor(t, snap) {
  return tracker.evaluate(t, snap, defaults.config()).decision;
}

const heroTurn = (bets, extra = {}) => table({ bets, current: 6, heroTurn: true, buttons: { fold: true, call: true }, ...extra });

test('page that loads mid-hand: UTG at 2 BB with UTG+1 on the clock is not taken as a straddle', () => {
  const raised = { ...BLINDS, 4: 1 };
  const t = play([{ snap: blank() }, { snap: table({ bets: raised, current: 5 }) }]);
  assert.equal(t.hand.startSeen, false);
  assert.equal(t.hand.posts, null);
  const d = decisionFor(t, heroTurn(raised));
  assert.equal(d.action, 'leave'); // 54s in a middle seat would be folded if this were read as unopened
});

test('hidden tab catching up after a watched hand: the same picture is still rejected', () => {
  const raised = { ...BLINDS, 4: 1 };
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'] }) },
    { snap: table({ bets: raised, current: 5 }) },
  ]);
  assert.equal(t.hand.startSeen, true);
  assert.equal(t.hand.posts, null);
  assert.match(t.hand.postsNote, /above the big blind/);
  assert.equal(decisionFor(t, heroTurn(raised)).action, 'leave');
});

test('explicit straddle marker: straddle accepted, first 2 shift past it, 54s folds unopened', () => {
  const straddled = { ...BLINDS, 4: 1 };
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'] }) },
    { snap: table({ bets: straddled, straddleSeat: 4 }) },
    { snap: table({ bets: straddled, straddleSeat: 4, current: 5 }) },
  ]);
  assert.deepEqual(t.hand.posts, straddled);
  const d = decisionFor(t, heroTurn(straddled, { straddleSeat: 4 }));
  assert.equal(d.label, 'first2');
  assert.equal(d.spot, 'unopened');
  assert.equal(d.action, 'fold');
});

test('watched deal then a UTG raise: 54s in a middle seat is kept facing the raise', () => {
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'] }) },
    { snap: table({ current: 4 }) },
    { snap: table({ bets: { ...BLINDS, 4: 1.5 }, current: 5 }) },
  ]);
  assert.deepEqual(t.hand.posts, BLINDS);
  const d = decisionFor(t, heroTurn({ ...BLINDS, 4: 1.5 }));
  assert.equal(d.label, 'middle');
  assert.equal(d.spot, 'vs_raise');
  assert.equal(d.action, 'leave');
});

test('action back on UTG with a raise in front is not a hand start', () => {
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'] }) },
    { snap: table({ bets: { ...BLINDS, 4: 0.5, 7: 2 }, current: 4 }) },
  ]);
  assert.equal(t.hand.posts, null);
});

test('a loading screen before the first read does not count as watching the deal', () => {
  const t = play([{ snap: blank() }, { snap: table({ current: 4 }) }]);
  assert.equal(t.hand.startSeen, false);
  assert.equal(t.hand.posts, null);
});

test('small blind: a short blink is one turn; after the big blind acts, the next turn is a second decision', () => {
  const sb = (extra) => table({ hero: 2, ...extra });
  const free = { current: 2, heroTurn: true, buttons: { fold: true, check: true } };
  const t = play([
    { snap: sb({ cards: ['Kd', 'Qc'] }) },
    { snap: sb({ current: 4 }) },
    { snap: sb(free), after: 500 },
    { snap: sb({}), after: 200 },
    { snap: sb(free), after: 100 },
  ]);
  assert.equal(t.hand.heroTurnIndex, 1);
  assert.equal(decisionFor(t, sb(free)).action, 'check');

  tracker.observe(t, sb({ current: 3 }), 5000, defaults.config());
  const facing = sb({ bets: { 2: 0.5, 3: 1.5 }, current: 2, heroTurn: true, buttons: { fold: true, call: true } });
  tracker.observe(t, facing, 5500, defaults.config());
  assert.equal(t.hand.heroTurnIndex, 2);
  const d = decisionFor(t, facing);
  assert.equal(d.spot, 'second_decision');
  assert.equal(d.action, 'leave');
});

test('firstToAct: heads-up dealer, 3-handed button, straddle only after the big blind', () => {
  assert.equal(tracker.firstToAct([1, 2], 1, null), 1);
  assert.equal(tracker.firstToAct([1, 2, 3], 1, null), 1);
  assert.equal(tracker.firstToAct(SEATS, 1, null), 4);
  assert.equal(tracker.firstToAct(SEATS, 1, 4), 5);
  assert.equal(tracker.firstToAct(SEATS, 1, 6), null);
  assert.equal(tracker.firstToAct(SEATS, 9, null), null);
});

test('dead small blind (one blind posted, no table marker) is left to the user', () => {
  // The small-blind player left: seat 2 is empty, the first seat after the button posts only the big blind.
  const dealt = [1, 3, 4, 5, 6, 7, 8];
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'], dealt }) },
    { snap: table({ bets: { 3: 0.5 }, current: 4, dealt }) },
  ]);
  assert.equal(t.hand.posts, null);
  assert.match(t.hand.postsNote, /blind was not posted/);
  const d = decisionFor(t, table({ bets: { 3: 0.5 }, current: 6, heroTurn: true, buttons: { fold: true, call: true }, dealt }));
  assert.equal(d.action, 'leave');
});

test('unreadable raiser chips with a live Call button: left to the user, never folded as unopened', () => {
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'] }) },
    { snap: table({ current: 4 }) },
    { snap: table({ bets: { ...BLINDS, 4: 1.5 }, unreadable: [4], current: 5 }) },
  ]);
  assert.deepEqual(t.hand.posts, BLINDS); // the deal itself was read cleanly
  const turn = heroTurn({ ...BLINDS, 4: 1.5 }, { unreadable: [4] });
  tracker.observe(t, turn, 5000, defaults.config());
  const d = decisionFor(t, turn);
  assert.equal(d.action, 'leave');
  assert.equal(d.spot, 'unknown');
  assert.match(d.reason, /not readable/);
});

test('a bet that is not a number blocks the decision even without a reader error', () => {
  const snap = heroTurn(BLINDS);
  snap.seats.find((s) => s.seat === 4).bet = null;
  assert.equal(snap.errors.length, 0);
  assert.match(tracker.uncertainty(snap), /seat 4: unreadable chips/);
});

test('a reader error at the first action means the hand start is not trusted', () => {
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'] }) },
    { snap: table({ current: 4, unreadable: [7] }) },
  ]);
  assert.equal(t.hand.posts, null);
  assert.match(t.hand.postsNote, /not readable at the first action/);
});

test('a limp drawn while the first actor is still on the clock is not taken as a post', () => {
  const t = play([
    { snap: table({ cards: ['Kd', 'Qc'] }) },
    { snap: table({ bets: { ...BLINDS, 4: 0.5 }, current: 4 }) },
  ]);
  assert.equal(t.hand.posts, null);
  assert.match(t.hand.postsNote, /already has chips in front/);
});

test('heads-up: the small blind acts first with its blind in front, and that is a valid start', () => {
  const hu = (extra) => table({ hero: 1, dealt: [1, 5], ...extra });
  const t = play([
    { snap: hu({ cards: ['Kd', 'Qc'] }) },
    { snap: hu({ bets: { 1: 0.5, 5: 0.5 }, current: 1 }) },
  ]);
  assert.deepEqual(t.hand.posts, { 1: 0.5, 5: 0.5 });
});
