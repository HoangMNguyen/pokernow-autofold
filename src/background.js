// Service worker: install defaults, alerts (notification + chime), log writes.
'use strict';
importScripts('ranges.js', 'defaults.js', 'storage.js');

const OFFSCREEN_URL = 'src/offscreen.html';
const NOTIFY_PREFIX = 'pnaf-';

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get(['mode', 'config']);
    const init = {};
    if (!PNAF.storage.MODES.includes(stored.mode)) init.mode = 'test';
    if (!stored.config || typeof stored.config !== 'object') init.config = PNAF.defaults.config();
    if (Object.keys(init).length) await chrome.storage.local.set(init);
  } catch (err) {
    console.error('PNAF: install defaults failed', err);
  }
});

// One offscreen document plays the chime; concurrent alerts share creation.
let creatingOffscreen = null;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url]
  });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play the PokerNow Auto-Fold alert chime.'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function playChime() {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play' });
}

async function handleAlert(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return { ok: false, error: 'no sender tab' };
  await chrome.notifications.create(NOTIFY_PREFIX + tabId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icon128.png'),
    title: String(msg.title || 'PokerNow Auto-Fold'),
    message: String(msg.body || ''),
    priority: 2,
    silent: true
  });
  try {
    await playChime();
  } catch (err) {
    console.warn('PNAF: chime failed', err);
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  let task;
  if (msg.type === 'alert') task = handleAlert(msg, sender);
  else if (msg.type === 'log') task = PNAF.storage.appendLog(msg.entry).then(() => ({ ok: true }));
  else return false;
  task.then(sendResponse, (err) => {
    console.error('PNAF: ' + msg.type + ' failed', err);
    sendResponse({ ok: false, error: String(err && err.message || err) });
  });
  return true;
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith(NOTIFY_PREFIX)) return;
  const tabId = Number(id.slice(NOTIFY_PREFIX.length));
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (err) {
    console.warn('PNAF: could not focus tab', tabId, err);
  }
  chrome.notifications.clear(id);
});
