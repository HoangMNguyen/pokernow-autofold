(function (root) {
  'use strict';

  // Playbook defaults. config() always returns a fresh copy so callers may mutate it.

  const RANGE_KEYS = ['first2', 'middle', 'cutoff', 'button', 'limpersExtraLate', 'vsRaiseIP', 'vsRaiseSB', 'bbVsOpen', 'neverFold'];

  const LABELS = {
    first2: 'First 2',
    middle: 'Middle',
    cutoff: 'Cutoff',
    button: 'Button',
    limpersExtraLate: 'Extra behind limpers (cutoff, button)',
    vsRaiseIP: 'Facing a raise',
    vsRaiseSB: 'Small blind facing a raise',
    bbVsOpen: 'Big blind facing a raise',
    neverFold: 'Never fold'
  };

  const HINTS = {
    first2: 'Raise-first-in range for the first two seats to act after the blinds (or the straddler).',
    middle: 'Raise-first-in range for the seats between the first 2 and the cutoff.',
    cutoff: 'Cutoff raise-first-in range; also the small blind\'s range when it owes chips or can check.',
    button: 'Button raise-first-in range.',
    limpersExtraLate: 'Extra hands kept in the cutoff and on the button when someone has limped.',
    vsRaiseIP: 'Hands kept by a non-blind seat facing exactly one raise.',
    vsRaiseSB: 'Hands kept by the small blind facing exactly one raise.',
    bbVsOpen: 'Hands kept by the big blind facing one raise up to the size limit; also its free-check set.',
    neverFold: 'Hands the tool never folds or checks; always left to you.'
  };

  const SEAT_NAMES = {
    first2: 'first 2',
    middle: 'middle',
    cutoff: 'cutoff',
    button: 'button',
    sb: 'small blind',
    bb: 'big blind',
    straddle: 'straddle'
  };

  function config() {
    return {
      version: 1,
      bbOpenMaxBB: 6,
      ranges: {
        first2: '22+, A9s+, KTs+, QTs+, JTs, T9s, AJo+, KQo',
        middle: '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+, QJo',
        cutoff: '22+, A2s+, K6s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, A9o+, KTo+, QTo+, JTo',
        button: '22+, A2s+, K2s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A5o+, K9o+, Q9o+, J9o+, T9o',
        limpersExtraLate: '54s-98s',
        vsRaiseIP: '22+, ATs+, KTs+, QTs+, JTs, 54s-T9s, AKo, AQo, AJo, KQo',
        vsRaiseSB: '22+, ATs+, KTs+, QTs+, JTs, AKo, AQo, AJo, KQo',
        bbVsOpen: '22+, A2s+, K9s+, Q9s+, J9s+, 54s-T9s, ATo+, KJo+, QJo',
        neverFold: '72o, 72s'
      }
    };
  }

  const api = { RANGE_KEYS, LABELS, HINTS, SEAT_NAMES, config };

  root.PNAF = root.PNAF || {};
  root.PNAF.defaults = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
