(function (root) {
  'use strict';

  // Turns a table read into the pre-flop situation the decision rules need. Pure.

  const ranges = (typeof module === 'object' && module.exports) ? require('./ranges.js') : root.PNAF.ranges;

  function cents(x) {
    return Number.isFinite(x) ? Math.round(x * 100) : 0;
  }

  function amount(map, seat) {
    return map ? cents(map[seat]) : 0;
  }

  // Seat labels keyed by seat number, or null when positions cannot be trusted.
  function labelSeats(dealtSeats, dealerSeat, deadButton, posts, bbCents) {
    if (deadButton || dealerSeat == null) return null;
    const d = dealtSeats.indexOf(dealerSeat);
    if (d < 0) return null;
    const order = dealtSeats.slice(d + 1).concat(dealtSeats.slice(0, d + 1));
    const labels = {};
    let straddler = null;
    if (order.length === 2) {
      labels[order[1]] = 'sb'; // dealer
      labels[order[0]] = 'bb';
      return { labels, straddler };
    }
    labels[order[0]] = 'sb';
    labels[order[1]] = 'bb';
    const rest = order.slice(2);
    if (amount(posts, rest[0]) > bbCents) {
      straddler = rest[0];
      labels[straddler] = 'straddle';
    }
    if (dealerSeat !== straddler) labels[dealerSeat] = 'button';
    if (rest.length >= 2) {
      const co = rest[rest.length - 2];
      if (co !== straddler) labels[co] = 'cutoff';
    }
    let early = 0;
    for (const s of rest) {
      if (labels[s]) continue;
      labels[s] = early < 2 ? 'first2' : 'middle';
      early++;
    }
    return { labels, straddler };
  }

  function build(input) {
    const dealtSeats = Array.isArray(input.dealtSeats) ? input.dealtSeats : [];
    const heroCards = Array.isArray(input.heroCards) ? input.heroCards : [];
    const heroSeat = input.heroSeat;
    const out = {
      ok: false,
      reason: null,
      hand: null,
      heroCards,
      board: input.board,
      variant: input.variant,
      label: null,
      players: dealtSeats.length,
      headsUp: dealtSeats.length === 2,
      straddle: false,
      level: 0,
      limpers: 0,
      raises: 0,
      raiseToBB: null,
      heroActed: false,
      canFold: !!input.canFold,
      canCheck: !!input.canCheck
    };

    const sbCents = Number.isFinite(input.sb) && input.sb >= 0 ? cents(input.sb) : null;
    const bbCents = Number.isFinite(input.bb) && input.bb > 0 ? cents(input.bb) : null;
    const hand = heroCards.length === 2 ? ranges.handClass(heroCards[0], heroCards[1]) : null;

    if (input.posts == null) { out.reason = 'start of hand not seen'; return out; }
    if (heroSeat == null || !dealtSeats.includes(heroSeat)) { out.reason = 'hero not dealt in'; return out; }
    if (sbCents == null || bbCents == null) { out.reason = 'blinds unknown'; return out; }
    if (!hand) { out.reason = 'cards unreadable'; return out; }

    const posts = input.posts;
    const bets = input.bets || {};
    out.ok = true;
    out.hand = hand;

    const seating = labelSeats(dealtSeats, input.dealerSeat, !!input.deadButton, posts, bbCents);
    const straddler = seating ? seating.straddler : null;
    if (seating) out.label = seating.labels[heroSeat] || null;
    out.straddle = straddler != null;

    const levelCents = straddler != null ? amount(posts, straddler) : bbCents;
    out.level = levelCents / 100;

    const raiseAmounts = new Set();
    let limpers = 0;
    for (const s of dealtSeats) {
      if (s === heroSeat) continue;
      const v = amount(bets, s);
      const p = amount(posts, s);
      if (v <= p) continue;
      if (v === levelCents) limpers++;
      else if (v > levelCents) raiseAmounts.add(v);
    }
    out.limpers = limpers;
    out.raises = Math.min(2, raiseAmounts.size);
    out.raiseToBB = out.raises === 1 ? Math.max(...raiseAmounts) / bbCents : null;

    out.heroActed = input.heroTurnIndex > 1 || amount(bets, heroSeat) > amount(posts, heroSeat);
    return out;
  }

  const api = { build };

  root.PNAF = root.PNAF || {};
  root.PNAF.situation = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
