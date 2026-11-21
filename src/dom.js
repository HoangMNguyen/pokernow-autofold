// PNAF.dom — reads the PokerNow game page into a plain snapshot. Never guesses:
// anything uncertain becomes null/false plus an `errors` entry.
//
// Selectors verified live on www.pokernow.com (Chromium 155, 2026-11-19); see the
// recon report. Seat numbers are PokerNow's `table-player-N` position classes, which
// are relative to the viewer (the seated hero is drawn at the bottom); they ascend
// clockwise, which is also the action order, and `dealer-position-N` uses the same
// numbering.
(function (root) {
  'use strict';

  const RANK_CLASS = /^card-s-(10|[2-9TJQKA])$/;
  const SUIT_CLASSES = ['card-s', 'card-h', 'card-d', 'card-c'];
  const MONEY = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

  function text(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // Table money from a `.chips-value` (or an element containing one). `.normal-value`
  // holds the money amount in every "Values Display Style" (None, Formatted, Big Blinds).
  function money(el) {
    if (!el) return null;
    const chips = el.matches('.chips-value') ? el : el.querySelector('.chips-value');
    const normal = chips && chips.querySelector('.normal-value');
    if (!normal) return null;
    const t = text(normal);
    return MONEY.test(t) ? Number(t.replace(/,/g, '')) : null;
  }

  function positionClass(el, prefix) {
    const re = new RegExp('^' + prefix + '(\\d+)$');
    for (const c of el.classList) {
      const m = c.match(re);
      if (m) return Number(m[1]);
    }
    return null;
  }

  // One face-up card: identity classes (`card-{suit}` + `card-s-{rank}`) must agree
  // with the rendered `.value`/`.suit` text. Returns { card } or { error } or { back: true }.
  function readCard(container) {
    const classes = [...container.classList];
    const suits = classes.filter((c) => SUIT_CLASSES.includes(c));
    const ranks = classes.map((c) => c.match(RANK_CLASS)).filter(Boolean);
    if (suits.length === 0 && ranks.length === 0) return { back: true };
    if (suits.length !== 1 || ranks.length !== 1) return { error: 'ambiguous card classes "' + classes.join(' ') + '"' };
    const rank = ranks[0][1] === '10' ? 'T' : ranks[0][1];
    const suit = suits[0].slice(5);
    const face = container.querySelector('.card');
    const valueText = text(face && face.querySelector('.value'));
    const suitText = text(face && face.querySelector('.suit:not(.sub-suit)'));
    if (!valueText || !suitText) return { error: 'card text not rendered yet' };
    const textRank = valueText === '10' ? 'T' : valueText.toUpperCase();
    if (textRank !== rank || suitText.toLowerCase() !== suit) {
      return { error: 'card classes ' + rank + suit + ' disagree with text ' + valueText + suitText };
    }
    return { card: rank + suit };
  }

  function readSeat(el, errors) {
    const seat = positionClass(el, 'table-player-');
    const isHero = el.classList.contains('you-player');
    const nameEl = el.querySelector('.table-player-name-text');
    const name = nameEl ? text(nameEl) || null : null;
    const cards = el.querySelectorAll('.table-player-cards .card-container');
    const status = el.querySelector('.table-player-status-icon');
    const statusFold = !!(status && status.classList.contains('fold'));
    const hasFoldClass = el.classList.contains('fold');
    let dealtIn = false;
    let folded = false;
    if (cards.length === 2) {
      // Live player (backs or faces), or the hero's own folded hand (cards stay drawn).
      dealtIn = true;
      folded = hasFoldClass;
    } else if (cards.length === 0) {
      if (statusFold) {
        dealtIn = true;
        folded = true;
      } else if (hasFoldClass && !status) {
        errors.push('seat ' + seat + ': fold marker without cards or status');
      }
      // Otherwise not dealt in: between hands, "Away" (standing-up) or waiting players.
    } else {
      errors.push('seat ' + seat + ': ' + cards.length + ' card elements');
    }
    const betEl = el.querySelector('.table-player-bet-value');
    let bet = 0;
    if (betEl && betEl.querySelector('.chips-value')) {
      bet = money(betEl);
      if (bet === null) errors.push('seat ' + seat + ': unreadable bet "' + text(betEl) + '"');
    } else if (betEl && !(betEl.classList.contains('check') && /^check$/i.test(text(betEl)))) {
      // An empty slot reads "check" after a chip-less check; anything else is unknown.
      bet = null;
      errors.push('seat ' + seat + ': unreadable bet "' + text(betEl) + '"');
    }
    return { seat, name, dealtIn, folded, bet, isHero, isCurrent: el.classList.contains('decision-current') };
  }

  function readBlinds(scope, errors) {
    const blinds = { sb: null, bb: null };
    const box = scope.querySelector('.game-infos .blind-value');
    if (!box) { errors.push('blinds header not found'); return blinds; }
    const values = box.querySelectorAll('.chips-value');
    if (values.length !== 2) { errors.push('blinds header has ' + values.length + ' values'); return blinds; }
    const sb = money(values[0]);
    const bb = money(values[1]);
    if (sb === null || bb === null) { errors.push('blinds unreadable "' + text(box) + '"'); return blinds; }
    blinds.sb = sb;
    blinds.bb = bb;
    return blinds;
  }

  function readGameId(doc) {
    const path = doc.location && doc.location.pathname;
    const m = path && path.match(/^\/games\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function read(doc = document) {
    const errors = [];
    const snap = {
      gameId: readGameId(doc),
      heroSeat: null,
      heroCards: [],
      cardsError: null,
      board: 0,
      seats: [],
      clockwise: [],
      dealerSeat: null,
      deadButton: false,
      straddleSeat: null,
      blinds: { sb: null, bb: null },
      variant: null,
      heroTurn: false,
      buttons: { fold: null, check: null, call: null, callAmount: null },
      errors,
    };
    const scope = doc.querySelector('.game-main-container') || doc;
    const table = scope.querySelector('.table');
    if (!table) { errors.push('table not found'); return snap; }

    snap.variant = text(scope.querySelector('.game-infos .game-type-ctn .current-type')) || null;
    if (!snap.variant) errors.push('game type not found');
    snap.blinds = readBlinds(scope, errors);

    // Board: every community card element (all run-it-twice rows), face-up or animating.
    snap.board = table.querySelectorAll('.table-cards .card-container').length;

    // Seats. Empty seats (`table-player-seat`) only count towards `clockwise`.
    const all = [...table.querySelectorAll('.seats .table-player')];
    const positions = [];
    let heroEl = null;
    for (const el of all) {
      const pos = positionClass(el, 'table-player-');
      if (pos === null) { errors.push('seat element without position'); continue; }
      positions.push(pos);
      if (el.classList.contains('table-player-seat')) continue;
      const s = readSeat(el, errors);
      snap.seats.push(s);
      if (s.isHero) {
        if (heroEl) errors.push('more than one hero seat');
        heroEl = el;
      }
    }
    snap.clockwise = [...new Set(positions)].sort((a, b) => a - b);
    if (positions.length !== snap.clockwise.length) errors.push('duplicate seat positions');
    snap.seats.sort((a, b) => a.seat - b.seat);

    if (heroEl && snap.seats.filter((s) => s.isHero).length === 1) {
      snap.heroSeat = positionClass(heroEl, 'table-player-');
      const cards = [...heroEl.querySelectorAll('.table-player-cards .card-container')];
      if (cards.length) {
        const read2 = cards.map(readCard);
        const bad = read2.find((r) => r.error || r.back);
        if (cards.length !== 2) snap.cardsError = cards.length + ' hero card elements';
        else if (bad) snap.cardsError = bad.error || 'hero card face down';
        else if (read2[0].card === read2[1].card) snap.cardsError = 'duplicate hero cards';
        else snap.heroCards = read2.map((r) => r.card);
        if (snap.cardsError) errors.push('hero cards: ' + snap.cardsError);
      }
    }

    // Dealer button and the explicit straddle marker share `.dealer-button-ctn`.
    const dealers = [...table.querySelectorAll('.dealer-button-ctn:not(.live-straddle)')];
    if (dealers.length === 1) {
      snap.dealerSeat = positionClass(dealers[0], 'dealer-position-');
      if (snap.dealerSeat === null) errors.push('dealer button without position');
    } else if (dealers.length > 1) {
      errors.push(dealers.length + ' dealer buttons');
    }
    const straddles = [...table.querySelectorAll('.dealer-button-ctn.live-straddle')];
    if (straddles.length === 1) {
      snap.straddleSeat = positionClass(straddles[0], 'dealer-position-');
      if (snap.straddleSeat === null) errors.push('straddle marker without position');
    } else if (straddles.length > 1) {
      errors.push(straddles.length + ' straddle markers');
    }
    // Dead button: the button sits on a position with no occupied seat drawn.
    if (snap.dealerSeat !== null && snap.seats.some((s) => s.dealtIn)) {
      const onSeat = snap.seats.find((s) => s.seat === snap.dealerSeat);
      if (!onSeat) snap.deadButton = true;
    }

    // Hero turn: PokerNow marks it twice — `decision-current` on the hero seat and the
    // "Your Turn" `.action-signal` in the live (non-`low`) decision panel.
    const panel = scope.querySelector('.game-decisions-ctn');
    const signal = panel && panel.querySelector('.action-buttons .action-signal');
    const signalOn = !!(signal && /^your turn$/i.test(text(signal)));
    const seatOn = !!(heroEl && heroEl.classList.contains('decision-current'));
    if (signalOn && seatOn) {
      // The moment any action button is clicked PokerNow disables all of them, about 30 ms before the signal
      // goes (observed live): the action is being sent, so the turn is over. Not an error.
      const submitting = ![...signal.closest('.action-buttons').querySelectorAll('button.action-button')].some((b) => !b.disabled);
      if (panel.classList.contains('low')) errors.push('turn signal inside out-of-turn panel');
      else if (!submitting) snap.heroTurn = true;
    } else if (signalOn) {
      errors.push('turn signals disagree (seat false, panel true)');
    } else if (seatOn && panel && panel.querySelector('.action-buttons button') && !panel.querySelector('.raise-controller-form')) {
      // decision-current lingers ~0.8 s on the hero after acting, with an empty panel: not an error.
      // The raise slider (no signal) is the user deciding by hand: not an error either.
      errors.push('turn signals disagree (seat true, panel false)');
    }

    if (snap.heroTurn) {
      const box = signal.closest('.action-buttons');
      const pick = (cls, re) => {
        const found = [...box.querySelectorAll('button.action-button.' + cls)];
        if (found.length !== 1) return null;
        const b = found[0];
        if (b.disabled) return null;
        if (!re.test(text(b))) { errors.push(cls + ' button label "' + text(b) + '"'); return null; }
        return b;
      };
      snap.buttons.fold = pick('fold', /^fold$/i);
      snap.buttons.check = pick('check', /^check$/i);
      // The same `call` slot reads "Bet x" after the flop; only "Call x" is a call.
      const callEl = [...box.querySelectorAll('button.action-button.call')];
      if (callEl.length === 1 && !callEl[0].disabled && /^call\b/i.test(text(callEl[0]))) {
        const m = text(callEl[0]).match(/^call\s+(\S+)$/i);
        const amount = m && MONEY.test(m[1]) ? Number(m[1].replace(/,/g, '')) : null;
        if (amount === null) errors.push('call amount unreadable "' + text(callEl[0]) + '"');
        else { snap.buttons.call = callEl[0]; snap.buttons.callAmount = amount; }
      }
    }
    return snap;
  }

  // React-compatible click: PokerNow's buttons respond to a plain element click()
  // (verified live, also in a hidden tab).
  function click(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    el.click();
    return true;
  }

  const api = { read, click };
  root.PNAF = root.PNAF || {};
  root.PNAF.dom = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
