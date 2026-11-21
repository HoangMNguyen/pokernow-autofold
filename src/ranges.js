(function (root) {
  'use strict';

  // Hold'em hand classes and the playbook range syntax.
  // Grid: 13x13, row/col index into RANKS; diagonal pairs, upper-right suited, lower-left offsuit.

  const RANKS = 'AKQJT98765432';
  const SUITS = 'shdc';
  const TOTAL_COMBOS = 1326;

  // One hand inside a token after normalisation: two ranks, optional S/O suffix.
  const HAND_RE = /^([AKQJT98765432])([AKQJT98765432])([SO]?)$/;
  const PLUS_RE = /^([AKQJT98765432])([AKQJT98765432])([SO]?)\+$/;

  function gridCell(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 12 || col < 0 || col > 12) return null;
    if (row === col) return RANKS[row] + RANKS[row];
    if (row < col) return RANKS[row] + RANKS[col] + 's';
    return RANKS[col] + RANKS[row] + 'o';
  }

  // Grid position (row-major index) of a canonical hand class, or -1.
  function gridIndex(hand) {
    if (typeof hand !== 'string') return -1;
    const hi = RANKS.indexOf(hand[0]);
    const lo = RANKS.indexOf(hand[1]);
    if (hi < 0 || lo < 0) return -1;
    if (hand.length === 2) return hi === lo ? hi * 13 + hi : -1;
    if (hand.length !== 3 || hi >= lo) return -1;
    if (hand[2] === 's') return hi * 13 + lo;
    if (hand[2] === 'o') return lo * 13 + hi;
    return -1;
  }

  function combos(hand) {
    const i = gridIndex(hand);
    if (i < 0) return 0;
    if (hand.length === 2) return 6;
    return hand[2] === 's' ? 4 : 12;
  }

  function percent(hands) {
    let total = 0;
    for (const h of new Set(hands || [])) total += combos(h);
    return (total / TOTAL_COMBOS) * 100;
  }

  function validCard(c) {
    return typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);
  }

  function handClass(cardA, cardB) {
    if (!validCard(cardA) || !validCard(cardB) || cardA === cardB) return null;
    let a = RANKS.indexOf(cardA[0]);
    let b = RANKS.indexOf(cardB[0]);
    if (a === b) return RANKS[a] + RANKS[a];
    const suited = cardA[1] === cardB[1];
    if (a > b) { const t = a; a = b; b = t; }
    return RANKS[a] + RANKS[b] + (suited ? 's' : 'o');
  }

  // Hand classes for high rank index hi, low rank index lo (hi < lo), suffix 'S'|'O'|''.
  function nonPair(hi, lo, suffix) {
    const base = RANKS[hi] + RANKS[lo];
    if (suffix === 'S') return [base + 's'];
    if (suffix === 'O') return [base + 'o'];
    return [base + 's', base + 'o'];
  }

  function pair(i) {
    return RANKS[i] + RANKS[i];
  }

  // Parse one hand (no plus, no dash). Returns {hi, lo, suffix} or an error string.
  function parseHand(t) {
    const m = HAND_RE.exec(t);
    if (!m) return 'not a hand';
    const hi = RANKS.indexOf(m[1]);
    const lo = RANKS.indexOf(m[2]);
    if (hi === lo && m[3]) return 'a pair cannot be suited or offsuit';
    if (hi > lo) return 'write the higher rank first';
    return { hi, lo, suffix: m[3] };
  }

  function range(a, b) {
    const out = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    return out;
  }

  // Expand one normalised token into hand classes, or return an error message string.
  function expandToken(t) {
    if (/\s/.test(t)) return 'unexpected space';

    const dashes = t.split('-');
    if (dashes.length > 2) return 'too many dashes';

    if (dashes.length === 2) {
      const a = parseHand(dashes[0]);
      const b = parseHand(dashes[1]);
      if (typeof a === 'string') return 'run start: ' + a;
      if (typeof b === 'string') return 'run end: ' + b;
      const aPair = a.hi === a.lo;
      const bPair = b.hi === b.lo;
      if (aPair && bPair) return range(a.hi, b.hi).map(pair);
      if (aPair || bPair) return 'a run cannot mix pairs and non-pairs';
      if (a.suffix !== b.suffix) return 'both ends of a run need the same suffix';
      if (a.hi === b.hi) {
        // kicker run: same high card
        const out = [];
        for (const lo of range(a.lo, b.lo)) out.push(...nonPair(a.hi, lo, a.suffix));
        return out;
      }
      if (a.lo - a.hi === b.lo - b.hi) {
        // connector run: same gap along the diagonal
        const gap = a.lo - a.hi;
        const out = [];
        for (const hi of range(a.hi, b.hi)) out.push(...nonPair(hi, hi + gap, a.suffix));
        return out;
      }
      return 'run ends need the same high card or the same gap';
    }

    const plus = PLUS_RE.exec(t);
    if (plus) {
      const h = parseHand(plus[1] + plus[2] + plus[3]);
      if (typeof h === 'string') return h;
      if (h.hi === h.lo) return range(0, h.hi).map(pair);
      const out = [];
      for (const lo of range(h.hi + 1, h.lo)) out.push(...nonPair(h.hi, lo, h.suffix));
      return out;
    }

    const h = parseHand(t);
    if (typeof h === 'string') return h;
    if (h.hi === h.lo) return [pair(h.hi)];
    return nonPair(h.hi, h.lo, h.suffix);
  }

  function normalise(token) {
    return token.replace(/[\u2013\u2014]/g, '-').replace(/10/g, 'T').toUpperCase();
  }

  function parseRange(text) {
    const found = new Set();
    const errors = [];
    const src = typeof text === 'string' ? text : '';
    for (const raw of src.split(/[,;\r\n]/)) {
      const token = raw.trim();
      if (!token) continue;
      const result = expandToken(normalise(token));
      if (typeof result === 'string') errors.push({ token, message: result });
      else for (const h of result) found.add(h);
    }
    const hands = Array.from(found).sort((x, y) => gridIndex(x) - gridIndex(y));
    return { hands, errors };
  }

  // Calls emit(first, last) for each run of consecutive true flags.
  function runs(flags, emit) {
    let start = -1;
    for (let i = 0; i <= flags.length; i++) {
      if (i < flags.length && flags[i]) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        emit(start, i - 1);
        start = -1;
      }
    }
  }

  // Compact notation for a set of hand classes: pairs, then suited, then offsuit, each by high card,
  // e.g. "22+, A9s+, KTs+, K8s-K6s, AJo+". parseRange(toText(h)).hands is exactly the same set.
  function toText(hands) {
    const have = new Set(hands);
    const tokens = [];
    const pairFlags = Array.from(RANKS, (_, i) => have.has(pair(i)));
    runs(pairFlags, (a, b) => {
      if (a === b) tokens.push(pair(a));
      else if (a === 0) tokens.push(pair(b) + '+');
      else tokens.push(pair(a) + '-' + pair(b));
    });
    for (const suffix of ['s', 'o']) {
      for (let hi = 0; hi < RANKS.length - 1; hi++) {
        const name = (lo) => RANKS[hi] + RANKS[lo] + suffix;
        const flags = Array.from(RANKS, (_, lo) => lo > hi && have.has(name(lo)));
        runs(flags, (a, b) => {
          if (a === b) tokens.push(name(a));
          else if (a === hi + 1) tokens.push(name(b) + '+');
          else tokens.push(name(a) + '-' + name(b));
        });
      }
    }
    return tokens.join(', ');
  }

  const api = { RANKS, SUITS, parseRange, toText, handClass, combos, percent, gridCell, gridIndex };

  root.PNAF = root.PNAF || {};
  root.PNAF.ranges = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
