// Generates src/handrank.js: the 169 Hold'em hand classes ranked by all-in pre-flop equity
// against two random hands (3-way), estimated by a seeded Monte Carlo.
// Run: node tools/rank-hands.mjs
// Importing this module (tests) only exposes the evaluator; generation runs when executed directly.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const R = require('../src/ranges.js');

export const SEED = 0x504e4146; // 'PNAF'
// Per class. Standard error <= 0.5 / sqrt(TRIALS) ~= 0.08 points, well under the 0.25 needed, so neighbouring
// classes (often ~0.1 points apart) rank reliably; the whole run still takes about 12 s.
export const TRIALS = 400000;

// Cards are 0..51: rank = c >> 2 (0 = deuce .. 12 = ace), suit = c & 3.
const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';

export function card(text) {
  const r = RANK_CHARS.indexOf(text[0]);
  const s = SUIT_CHARS.indexOf(text[1]);
  if (text.length !== 2 || r < 0 || s < 0) throw new Error('bad card ' + text);
  return (r << 2) | s;
}

// Category of a score (0 high card .. 8 straight flush).
export const CATEGORY = ['high card', 'pair', 'two pair', 'trips', 'straight', 'flush', 'full house', 'quads', 'straight flush'];

function highBit(mask) {
  return 31 - Math.clz32(mask);
}

function popcount(m) {
  m -= (m >>> 1) & 0x55555555;
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return (((m + (m >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// The n highest ranks of mask packed as 4-bit nibbles, highest first.
function topRanks(mask, n) {
  let out = 0;
  for (let i = 0; i < n; i++) {
    const h = highBit(mask);
    out = (out << 4) | h;
    mask &= ~(1 << h);
  }
  return out;
}

// Highest straight top rank in a 13-bit rank mask, or -1. The ace also plays low (wheel tops at the five, rank 3).
function straightTop(mask) {
  const m = (mask << 1) | ((mask >> 12) & 1); // bit 0 = low ace, bit i = rank i - 1
  const s = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
  return s ? highBit(s) + 3 : -1;
}

const suitMask = new Int32Array(4);
let s1 = 0, s2 = 0, s3 = 0, s4 = 0; // ranks seen at least 1, 2, 3, 4 times in the current eval7

function addCard(x) {
  const bit = 1 << (x >> 2);
  suitMask[x & 3] |= bit;
  if (s3 & bit) s4 |= bit;
  else if (s2 & bit) s3 |= bit;
  else if (s1 & bit) s2 |= bit;
  else s1 |= bit;
}

// Score of the best 5-card hand among seven cards: (category << 20) | kickers. Higher is better; equal ties.
export function eval7(a, b, c, d, e, f, g) {
  suitMask[0] = 0; suitMask[1] = 0; suitMask[2] = 0; suitMask[3] = 0;
  s1 = 0; s2 = 0; s3 = 0; s4 = 0;
  addCard(a); addCard(b); addCard(c); addCard(d); addCard(e); addCard(f); addCard(g);

  let flush = 0;
  for (let s = 0; s < 4; s++) if (popcount(suitMask[s]) >= 5) flush = suitMask[s];
  if (flush) {
    const top = straightTop(flush);
    if (top >= 0) return (8 << 20) | top;
  }
  if (s4) {
    const q = highBit(s4);
    return (7 << 20) | (q << 4) | highBit(s1 & ~(1 << q));
  }
  if (s3) {
    const t = highBit(s3);
    const rest = s2 & ~(1 << t);
    if (rest) return (6 << 20) | (t << 4) | highBit(rest);
  }
  if (flush) return (5 << 20) | topRanks(flush, 5);
  const top = straightTop(s1);
  if (top >= 0) return (4 << 20) | top;
  if (s3) {
    const t = highBit(s3);
    return (3 << 20) | (t << 8) | topRanks(s1 & ~(1 << t), 2);
  }
  if (s2) {
    const p1 = highBit(s2);
    const rest = s2 & ~(1 << p1);
    if (rest) {
      const p2 = highBit(rest);
      return (2 << 20) | (p1 << 8) | (p2 << 4) | highBit(s1 & ~(1 << p1) & ~(1 << p2));
    }
    return (1 << 20) | (p1 << 12) | topRanks(s1 & ~(1 << p1), 3);
  }
  return topRanks(s1, 5);
}

export function evalCards(list) {
  if (list.length !== 7) throw new Error('need 7 cards');
  const c = list.map((x) => (typeof x === 'string' ? card(x) : x));
  return eval7(c[0], c[1], c[2], c[3], c[4], c[5], c[6]);
}

export function category(score) {
  return score >> 20;
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// All two-card combos of a class like 'AA', 'AKs', 'AKo' as [cardA, cardB].
export function classCombos(hand) {
  const hi = 12 - R.RANKS.indexOf(hand[0]);
  const lo = 12 - R.RANKS.indexOf(hand[1]);
  const out = [];
  for (let s = 0; s < 4; s++) {
    for (let t = 0; t < 4; t++) {
      if (hand.length === 2 ? t <= s : (hand[2] === 's') !== (s === t)) continue;
      out.push([(hi << 2) | s, (lo << 2) | t]);
    }
  }
  return out;
}

// Monte Carlo equity of a class against two random hands.
export function equity3way(hand, trials, rng) {
  const decks = classCombos(hand).map(([x, y]) => {
    const deck = [];
    for (let c = 0; c < 52; c++) if (c !== x && c !== y) deck.push(c);
    return { x, y, deck };
  });
  let won = 0;
  for (let n = 0; n < trials; n++) {
    const { x, y, deck } = decks[Math.floor(rng() * decks.length)];
    // Partial Fisher-Yates: deck[0..8] become a uniform random ordered draw of 9 of the 50 cards.
    for (let i = 0; i < 9; i++) {
      const j = i + Math.floor(rng() * (50 - i));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    const b0 = deck[4], b1 = deck[5], b2 = deck[6], b3 = deck[7], b4 = deck[8];
    const h = eval7(x, y, b0, b1, b2, b3, b4);
    const o1 = eval7(deck[0], deck[1], b0, b1, b2, b3, b4);
    const o2 = eval7(deck[2], deck[3], b0, b1, b2, b3, b4);
    const best = Math.max(o1, o2);
    if (h > best) won += 1;
    else if (h === best) won += 1 / (1 + (o1 === h) + (o2 === h));
  }
  return won / trials;
}

function gridClasses() {
  const out = [];
  for (let row = 0; row < 13; row++) for (let col = 0; col < 13; col++) out.push(R.gridCell(row, col));
  return out;
}

export function generate(seed = SEED, trials = TRIALS) {
  const rng = mulberry32(seed);
  const rows = gridClasses().map((hand, index) => ({ hand, index, eq: Math.round(equity3way(hand, trials, rng) * 10000) / 10000 }));
  rows.sort((p, q) => q.eq - p.eq || p.index - q.index);
  return rows;
}

function render(rows, seed, trials) {
  const q = (h) => "'" + h + "'";
  const order = [];
  const equity = [];
  for (let i = 0; i < rows.length; i += 13) {
    const chunk = rows.slice(i, i + 13);
    order.push('    ' + chunk.map((r) => q(r.hand)).join(', '));
    equity.push('    ' + chunk.map((r) => q(r.hand) + ': ' + r.eq.toFixed(4)).join(', '));
  }
  return [
    '// Generated by tools/rank-hands.mjs. Do not edit by hand; rerun: node tools/rank-hands.mjs',
    "// Method: all-in pre-flop equity of each of the 169 Hold'em hand classes against two random hands (3-way).",
    '// Seeded Monte Carlo (mulberry32, seed 0x' + seed.toString(16) + ', ' + trials + ' trials per class): each trial deals a',
    '// uniformly random combo of the class, two random opponent hands and a 5-card board; an outright win scores 1,',
    '// a k-way tie at the top 1/k. ORDER is strongest first; equal 4-decimal estimates keep 13x13 grid order.',
    '(function (root) {',
    "  'use strict';",
    '',
    '  const ORDER = [',
    order.join(',\n'),
    '  ];',
    '',
    '  const EQUITY = {',
    equity.join(',\n'),
    '  };',
    '',
    '  const api = { ORDER, EQUITY };',
    '',
    '  root.PNAF = root.PNAF || {};',
    '  root.PNAF.handrank = api;',
    "  if (typeof module === 'object' && module.exports) module.exports = api;",
    '})(globalThis);',
    ''
  ].join('\n');
}

if (import.meta.main) {
  const started = performance.now();
  const rows = generate();
  const out = join(import.meta.dirname, '..', 'src', 'handrank.js');
  writeFileSync(out, render(rows, SEED, TRIALS));
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log('wrote ' + out + ' (' + rows.length + ' classes, ' + TRIALS + ' trials each, ' + secs + ' s)');
}
