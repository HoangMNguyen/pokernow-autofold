// Popup: mode switch and the active PokerNow tab's current decision.
(function () {
  'use strict';
  const storage = PNAF.storage;
  const SEAT_NAMES = (PNAF.defaults && PNAF.defaults.SEAT_NAMES) || {};
  const GAME_URL = /^https?:\/\/([^/]+\.)?pokernow\.(com|club)\/games\//i;
  const REFRESH_MS = 1000;

  const MODE_HINTS = {
    off: 'Does nothing.',
    test: 'Shows what it would click and alerts you, but never clicks.',
    live: 'Clicks Fold / Check for hands outside your ranges.'
  };
  const ACTION_TEXT = { fold: 'Fold', check: 'Check', leave: 'Your decision' };

  const $ = (id) => document.getElementById(id);
  const radios = Array.from(document.querySelectorAll('input[name="mode"]'));
  let currentMode = null;

  function showMode(mode) {
    currentMode = mode;
    for (const r of radios) r.checked = r.value === mode;
    $('mode-hint').textContent = MODE_HINTS[mode] || '';
  }

  for (const r of radios) {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      try {
        await storage.setMode(r.value);
        showMode(r.value);
      } catch (err) {
        showMode(currentMode);
      }
    });
  }

  storage.getMode().then(showMode);
  storage.onChange((c) => { if (c.mode) showMode(c.mode); });

  $('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  function showMessage(text) {
    $('status-msg').textContent = text;
    $('status-msg').hidden = false;
    $('status-list').hidden = true;
    $('status-errors').hidden = true;
  }

  function addRow(dl, label, value, cls) {
    if (value === null || value === undefined || value === '') return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  }

  function showStatus(s) {
    const dl = $('status-list');
    dl.replaceChildren();
    const seatName = s.seat ? (SEAT_NAMES[s.seat] || s.seat) : null;
    const seat = [seatName, s.heroSeat != null ? '#' + s.heroSeat : null].filter(Boolean).join(' ');
    const cards = Array.isArray(s.cards) ? s.cards.join(' ') : s.cards;
    const hand = [s.hand, cards ? '(' + cards + ')' : null].filter(Boolean).join(' ');
    let action = null;
    if (s.action) {
      action = ACTION_TEXT[s.action] || s.action;
      if (s.mode === 'test' && s.action !== 'leave') action = 'Would ' + action.toLowerCase();
      if (s.spot) action += ' · ' + s.spot.replace(/_/g, ' ');
    }

    addRow(dl, 'Game', s.gameId);
    addRow(dl, 'Seat', seat);
    addRow(dl, 'Players', s.players);
    addRow(dl, 'Hand', hand);
    addRow(dl, 'Decision', action, s.action ? 'action-' + s.action : null);
    addRow(dl, 'Reason', s.reason);
    addRow(dl, 'Your turn', s.heroTurn ? 'yes' : 'no');

    const errs = $('status-errors');
    errs.replaceChildren();
    for (const e of Array.isArray(s.errors) ? s.errors : []) {
      const li = document.createElement('li');
      li.textContent = String(e);
      errs.append(li);
    }
    errs.hidden = !errs.children.length;
    $('status-msg').hidden = dl.children.length > 0;
    if (!dl.children.length) $('status-msg').textContent = 'Waiting for a hand…';
    dl.hidden = !dl.children.length;
  }

  async function refresh() {
    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      tab = null;
    }
    if (!tab || !tab.url || !GAME_URL.test(tab.url)) {
      showMessage('Open a PokerNow game tab to see its status.');
      return;
    }
    try {
      const s = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
      if (s && typeof s === 'object') showStatus(s);
      else showMessage('No status from this tab yet.');
    } catch (err) {
      showMessage('Auto-Fold is not running in this tab. Reload the PokerNow page.');
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
