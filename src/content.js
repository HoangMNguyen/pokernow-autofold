// Watches the PokerNow table, decides with PNAF.decide, and clicks Fold/Check in live mode.
(function () {
  'use strict';

  const P = globalThis.PNAF || {};
  if (!P.dom || !P.tracker || !P.situation || !P.decide || !P.storage || !P.defaults || P.contentStarted) return;
  P.contentStarted = true;

  const ACK_MS = 3000; // a click PokerNow hasn't taken after this long is reported, never repeated
  const SUITS = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' };

  let ready = false;
  let alive = true;
  let mode = 'test';
  let config = P.defaults.config();
  const table = P.tracker.create();
  let exec = freshExec(null); // what this script did in the current hand
  let status = { mode, errors: [] };
  let badge = null;
  let scanQueued = false;
  let ackTimer = null;

  // A decision is acted on only after a re-read in a fresh task shows the same state, so a half-applied page
  // update can't trigger a click. MessageChannel tasks are not throttled in hidden tabs; timers are (to once
  // a minute after 5 minutes hidden), so no decision ever waits on a timer.
  const settle = new MessageChannel();
  let settleTick = 0;
  settle.port1.onmessage = () => {
    settleTick += 1;
    scan();
  };

  function freshExec(hand) {
    return { hand, pending: null, done: new Set(), last: null, click: null, freeChecked: false, flopAlerted: false };
  }

  const cents = (x) => Math.round((Number(x) || 0) * 100);
  const pretty = (cards) => cards.map((c) => c[0] + (SUITS[c[1]] || c[1])).join('');
  const seatName = (label) => (label && P.defaults.SEAT_NAMES[label]) || '?';

  function betsSignature(bets) {
    return Object.keys(bets).map((s) => `${s}:${cents(bets[s])}`).sort().join(',');
  }

  function send(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch (err) {
      shutdown(); // the extension was reloaded or removed; this copy of the script is orphaned
    }
  }

  function alertUser(kind, title, body) {
    send({ type: 'alert', kind, title, body });
  }

  function logDecision(snap, situation, decision, executed, spot) {
    send({
      type: 'log',
      entry: {
        t: new Date().toISOString(),
        game: snap.gameId,
        hand: exec.hand.key,
        players: situation.players || null,
        seat: situation.label,
        cards: snap.heroCards.join(''),
        handClass: situation.hand || '',
        spot: spot || decision.spot,
        action: decision.action,
        mode,
        executed,
        reason: decision.reason,
      },
    });
  }

  function checkAckLater() {
    clearTimeout(ackTimer);
    ackTimer = setTimeout(scan, ACK_MS + 50);
  }

  function handleTurn(snap, situation, decision, now) {
    const b = snap.buttons;
    const key = [exec.hand.heroTurnIndex, betsSignature(P.tracker.betMap(snap)), decision.action, decision.spot, !!b.fold, !!b.check, !!b.call].join('|');
    if (exec.done.has(key)) return;
    if (!exec.pending || exec.pending.key !== key) {
      exec.pending = { key, tick: settleTick };
      settle.port2.postMessage(0);
      return;
    }
    if (settleTick === exec.pending.tick) return; // same task as the first read; the settle re-read follows
    exec.pending = null;
    exec.done.add(key);

    let executed = false;
    if (decision.action !== 'leave' && mode === 'live') {
      const button = decision.action === 'fold' ? b.fold : b.check;
      if (button) {
        P.dom.click(button);
        executed = true;
        exec.click = { at: now, reported: false };
        checkAckLater();
      }
    }
    exec.last = { decision, executed };
    if (decision.action === 'check' && decision.spot === 'free_check') exec.freeChecked = true;
    if (decision.action === 'leave') {
      alertUser('decision', `Your turn: ${pretty(snap.heroCards)}`, `${seatName(situation.label)} \u00b7 ${decision.reason}`);
    }
    logDecision(snap, situation, decision, executed);
  }

  function checkClickTaken(snap, situation, decision, now) {
    const click = exec.click;
    if (!click || click.reported) return;
    if (!snap.heroTurn) {
      exec.click = null;
      return;
    }
    if (now - click.at >= ACK_MS) {
      click.reported = true;
      exec.last = { decision: { ...decision, action: 'leave', reason: 'PokerNow did not take the click' }, executed: false };
      alertUser('decision', `Your turn: ${pretty(snap.heroCards)}`, 'PokerNow did not take the auto-click; decide yourself.');
      logDecision(snap, situation, exec.last.decision, false, 'click_ignored');
    }
  }

  function checkFlop(snap) {
    if (!exec.freeChecked || exec.flopAlerted || snap.board < 3) return;
    const me = snap.seats.find((s) => s.isHero);
    if (!me || me.folded || snap.heroCards.length !== 2) return;
    exec.flopAlerted = true;
    alertUser('flop', `Flop: you're in with ${pretty(snap.heroCards)}`, 'After a free check before the flop.');
  }

  function outcome(last) {
    const { decision, executed } = last;
    if (decision.action === 'leave') return `yours (${decision.reason})`;
    const verb = decision.action === 'fold' ? 'fold' : 'check';
    if (executed) return verb === 'fold' ? 'folded' : 'checked';
    return mode === 'live' ? `${verb} (no button)` : `would ${verb}`;
  }

  function renderBadge(text, tone) {
    if (!badge) {
      const host = document.createElement('div');
      host.id = 'pnaf-badge';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        .b { position: fixed; top: 6px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
             pointer-events: none; padding: 3px 10px; border-radius: 6px; font: 600 12px/1.4 system-ui, sans-serif;
             color: #fff; background: rgba(60, 60, 60, .85); white-space: nowrap; }
        .b[data-tone="test"] { background: rgba(176, 112, 0, .92); }
        .b[data-tone="live"] { background: rgba(178, 34, 34, .92); }
        .b[data-tone="error"] { background: rgba(90, 0, 130, .92); }
      </style><div class="b"></div>`;
      document.documentElement.appendChild(host);
      badge = { host, el: root.querySelector('.b') };
    }
    if (badge.el.textContent !== text) badge.el.textContent = text;
    if (badge.el.dataset.tone !== tone) badge.el.dataset.tone = tone;
  }

  function removeBadge() {
    if (badge) badge.host.remove();
    badge = null;
  }

  function scan() {
    if (!ready || !alive) return;
    if (!/^\/games\//.test(location.pathname)) {
      removeBadge();
      return;
    }
    const now = Date.now();
    let snap;
    try {
      snap = P.dom.read(document);
    } catch (err) {
      status = { mode, errors: [`page unreadable: ${err && err.message}`] };
      if (mode !== 'off') renderBadge(`${mode.toUpperCase()} \u00b7 page unreadable`, 'error');
      return;
    }
    const hand = P.tracker.observe(table, snap, now, config);
    if (exec.hand !== hand) exec = freshExec(hand);

    const tag = mode.toUpperCase();
    status = {
      mode, gameId: snap.gameId, heroSeat: snap.heroSeat, seat: null, players: null, hand: null,
      cards: snap.heroCards.join(''), spot: null, action: null, reason: null, heroTurn: snap.heroTurn, errors: snap.errors,
    };
    if (mode === 'off') {
      renderBadge('Auto-fold off', 'off');
      return;
    }
    if (snap.heroSeat == null) {
      renderBadge(`${tag} \u00b7 not seated`, mode);
      return;
    }
    if (!hand.key) {
      renderBadge(`${tag} \u00b7 waiting for cards`, mode);
      return;
    }

    const { situation, decision } = P.tracker.evaluate(table, snap, hand.config || config);
    Object.assign(status, {
      seat: situation.label, players: situation.players || null, hand: situation.hand,
      spot: decision.spot, action: decision.action, reason: decision.reason,
    });

    if (snap.heroTurn && snap.board === 0) handleTurn(snap, situation, decision, now);
    checkClickTaken(snap, situation, decision, now);
    checkFlop(snap);

    const parts = [tag, seatName(situation.label), situation.hand || pretty(snap.heroCards)];
    let tail = '';
    if (exec.last) tail = outcome(exec.last);
    else if (snap.board > 0) tail = 'after the flop: yours';
    else if (snap.heroTurn) tail = 'deciding\u2026';
    renderBadge(parts.join(' \u00b7 ') + (tail ? ` \u2192 ${tail}` : ''), mode);
  }

  function schedule() {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  }

  const observer = new MutationObserver(schedule);
  const interval = setInterval(scan, 1000);

  function shutdown() {
    alive = false;
    observer.disconnect();
    clearInterval(interval);
    settle.port1.close();
    clearTimeout(ackTimer);
    removeBadge();
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message && message.type === 'status') reply(status);
  });

  P.storage.onChange((change) => {
    if (change.mode) mode = change.mode;
    if (change.config) config = change.config; // used from the next hand on
    schedule();
  });

  Promise.all([P.storage.getMode(), P.storage.getConfig()]).then(([m, c]) => {
    mode = m;
    config = c;
    ready = true;
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    scan();
  });
})();
