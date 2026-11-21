(function (root) {
  'use strict';

  // Follows one table across page reads: which hand is running, whether its deal was watched,
  // the chips posted before anyone acted (blinds, straddle, missed-blind posts) and the hero's turn count,
  // and turns a page read into a decision. Pure: works on PNAF.dom snapshots (or plain objects shaped like them).

  const isNode = typeof module === 'object' && module.exports;
  const situationApi = isNode ? require('./situation.js') : root.PNAF.situation;
  const decide = isNode ? require('./decide.js') : root.PNAF.decide;

  const NEW_TURN_GAP_MS = 1500; // a hero-turn signal that blinks off for less than this is the same turn

  const cents = (x) => (Number.isFinite(x) ? Math.round(x * 100) : 0);

  // Why a page read can't be trusted, or null. Any reader error or unreadable chip amount counts: an unreadable
  // raiser's chips must never pass as an empty seat and make a raised pot look unopened.
  function uncertainty(snap) {
    if (snap.errors && snap.errors.length) return snap.errors[0];
    const bad = snap.seats.find((s) => !Number.isFinite(s.bet));
    return bad ? `seat ${bad.seat}: unreadable chips` : null;
  }

  function freshHand(key) {
    return {
      key,
      dealerAtStart: null,
      startSeen: false,
      config: null,
      postsChecked: false,
      posts: null,
      postsNote: null,
      dealtSeats: null,
      dealerSeat: null,
      deadButton: false,
      heroTurn: false,
      heroTurnIndex: 0,
      otherActed: false,
      turnEndedAt: 0,
    };
  }

  function create() {
    return { lastRenderedCards: null, hand: freshHand('') };
  }

  function dealtOrder(snap) {
    const dealt = new Set(snap.seats.filter((s) => s.dealtIn).map((s) => s.seat));
    return snap.clockwise.filter((n) => dealt.has(n));
  }

  function betMap(snap) {
    const bets = {};
    for (const s of snap.seats) if (s.bet) bets[s.seat] = s.bet;
    return bets;
  }

  // Seats in pre-flop posting order: starts after the dealer, ends with the dealer. Null if the dealer wasn't dealt in.
  function postingOrder(dealt, dealer) {
    const i = dealt.indexOf(dealer);
    return i < 0 ? null : dealt.slice(i + 1).concat(dealt.slice(0, i + 1));
  }

  // Seat that must act first before the flop. A straddle counts only when PokerNow marks it explicitly
  // (snap.straddleSeat) and it is the seat after the big blind; any other straddle seat is unexpected (null).
  function firstToAct(dealt, dealer, straddleSeat) {
    const order = postingOrder(dealt, dealer);
    if (!order) return null;
    if (order.length === 2) return straddleSeat == null ? order[1] : null;
    const utg = order[2 % order.length];
    if (straddleSeat == null) return utg;
    return straddleSeat === utg ? order[3 % order.length] : null;
  }

  // Posts are trusted only when both blind seats posted, the first player put on the clock is the one who must
  // act first, and no seat has more than the big blind in front apart from an explicitly marked straddle.
  // So a UTG raise to 2 BB seen after a mid-hand page load (or a hidden tab catching up) never passes as a
  // straddle, and PokerNow's dead-small-blind hands (one blind, no table marker) are left to the user.
  function capturePosts(hand, snap, current) {
    hand.postsChecked = true;
    const doubt = uncertainty(snap);
    if (doubt) {
      hand.postsNote = `table not readable at the first action: ${doubt}`;
      return;
    }
    const dealt = dealtOrder(snap);
    const bets = betMap(snap);
    const bb = cents(snap.blinds.bb);
    const straddle = snap.straddleSeat == null ? null : snap.straddleSeat;
    hand.dealtSeats = dealt;
    hand.dealerSeat = snap.dealerSeat;
    hand.deadButton = snap.deadButton;
    const order = postingOrder(dealt, snap.dealerSeat);
    const first = bb > 0 ? firstToAct(dealt, snap.dealerSeat, straddle) : null;
    const aboveBB = Object.keys(bets).map(Number).filter((s) => cents(bets[s]) > bb);
    if (first === null) hand.postsNote = 'dealer, blinds or straddle seat unclear';
    else if (!(cents(bets[order[0]]) > 0 && cents(bets[order[1]]) > 0)) hand.postsNote = 'a blind was not posted (dead small blind?)';
    else if (aboveBB.some((s) => s !== straddle)) hand.postsNote = 'chips above the big blind before the first action';
    else if (current.seat !== first) hand.postsNote = `seat ${current.seat} was first on the clock, expected ${first}`;
    else if (cents(bets[first]) > 0 && first !== order[0] && first !== order[1] && first !== straddle) {
      // The first actor hasn't acted yet, so chips in front of them mean a limp drawn before the clock moved
      // (or a returning player's post, which can't be told apart): don't trust this read.
      hand.postsNote = `seat ${first} already has chips in front before acting`;
    } else hand.posts = bets;
  }

  function observe(t, snap, now, config) {
    const rendered = snap.heroSeat != null && snap.seats.length > 0;
    const cards = snap.heroCards.length === 2 ? snap.heroCards.join('') : '';
    let hand = t.hand;
    if (cards) {
      const dealerMoved = hand.dealerAtStart != null && snap.dealerSeat != null && snap.dealerSeat !== hand.dealerAtStart;
      if (cards !== hand.key || dealerMoved) {
        hand = t.hand = freshHand(cards);
        // Watched only if an earlier read showed the hero seated without these cards; loading screens don't count.
        hand.startSeen = rendered && t.lastRenderedCards !== null && t.lastRenderedCards !== cards && snap.board === 0;
        hand.config = config;
        hand.dealerAtStart = snap.dealerSeat;
      } else if (hand.dealerAtStart == null) {
        hand.dealerAtStart = snap.dealerSeat;
      }
    }
    if (rendered) t.lastRenderedCards = cards;
    if (!hand.key) return hand;

    if (hand.startSeen && !hand.postsChecked && snap.board === 0) {
      const current = snap.seats.find((s) => s.isCurrent);
      if (current) capturePosts(hand, snap, current);
    }

    if (snap.seats.some((s) => s.isCurrent && !s.isHero)) hand.otherActed = true;
    if (snap.heroTurn && !hand.heroTurn && snap.board === 0) {
      if (hand.heroTurnIndex === 0 || hand.otherActed || now - hand.turnEndedAt > NEW_TURN_GAP_MS) {
        hand.heroTurnIndex += 1;
        hand.otherActed = false;
      }
    }
    if (!snap.heroTurn && hand.heroTurn) hand.turnEndedAt = now;
    hand.heroTurn = snap.heroTurn;
    return hand;
  }

  function situationInput(t, snap) {
    const hand = t.hand;
    const frozen = hand.dealtSeats !== null;
    return {
      dealtSeats: frozen ? hand.dealtSeats : dealtOrder(snap),
      dealerSeat: frozen ? hand.dealerSeat : snap.dealerSeat,
      deadButton: frozen ? hand.deadButton || snap.deadButton : snap.deadButton,
      heroSeat: snap.heroSeat,
      posts: hand.posts,
      bets: betMap(snap),
      sb: snap.blinds.sb,
      bb: snap.blinds.bb,
      heroCards: snap.heroCards,
      board: snap.board,
      variant: snap.variant,
      heroTurnIndex: Math.max(1, hand.heroTurnIndex),
      canFold: !!snap.buttons.fold,
      canCheck: !!snap.buttons.check && !snap.buttons.call,
    };
  }

  // The decision for this read. Any doubt about the read leaves the decision to the user.
  function evaluate(t, snap, config) {
    const situation = situationApi.build(situationInput(t, snap));
    const doubt = uncertainty(snap);
    const decision = doubt
      ? { action: 'leave', spot: 'unknown', inRange: null, hand: situation.hand, label: situation.label, reason: `page not readable: ${doubt}` }
      : decide(situation, config);
    return { situation, decision };
  }

  const api = { create, observe, situationInput, evaluate, uncertainty, firstToAct, betMap, NEW_TURN_GAP_MS };

  root.PNAF = root.PNAF || {};
  root.PNAF.tracker = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
