// Offscreen document: plays the bundled alert chime for the service worker.
'use strict';

const chime = new Audio(chrome.runtime.getURL('assets/alert.wav'));
chime.preload = 'auto';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'play') return false;
  chime.currentTime = 0;
  chime.play().then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
  );
  return true;
});
