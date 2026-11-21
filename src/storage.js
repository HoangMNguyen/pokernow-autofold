// PNAF.storage — chrome.storage.local wrapper shared by the content script,
// popup, options page and service worker. toCSV is pure and works in Node.
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const defaults = isNode ? require('./defaults.js') : root.PNAF.defaults;

  const MODES = Object.freeze(['off', 'test', 'live']);
  const DEFAULT_MODE = 'test';
  const LOG_CAP = 5000;
  const LOG_COLUMNS = Object.freeze([
    't', 'game', 'hand', 'players', 'seat', 'cards', 'handClass',
    'spot', 'action', 'mode', 'executed', 'reason'
  ]);

  function area() {
    return chrome.storage.local;
  }

  function validMode(m) {
    return MODES.includes(m) ? m : DEFAULT_MODE;
  }

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // Stored config merged over a fresh copy of the defaults. Unknown or
  // malformed fields fall back to the default value for that field.
  function mergeConfig(stored) {
    const base = defaults.config();
    if (!isObject(stored)) return base;
    const out = Object.assign({}, base, stored);
    const n = Number(stored.bbOpenMaxBB);
    out.bbOpenMaxBB = Number.isFinite(n) && n > 0 ? n : base.bbOpenMaxBB;
    out.ranges = Object.assign({}, base.ranges);
    if (isObject(stored.ranges)) {
      for (const key of Object.keys(stored.ranges)) {
        if (typeof stored.ranges[key] === 'string') out.ranges[key] = stored.ranges[key];
      }
    }
    return out;
  }

  async function getMode() {
    const { mode } = await area().get('mode');
    return validMode(mode);
  }

  async function setMode(m) {
    if (!MODES.includes(m)) throw new Error('Unknown mode: ' + m);
    await area().set({ mode: m });
  }

  async function getConfig() {
    const { config } = await area().get('config');
    return mergeConfig(config);
  }

  async function setConfig(c) {
    if (!isObject(c)) throw new Error('Config must be an object');
    await area().set({ config: JSON.parse(JSON.stringify(c)) });
  }

  // cb({mode?, config?}) on changes made from any context. Returns an
  // unsubscribe function.
  function onChange(cb) {
    const listener = (changes, areaName) => {
      if (areaName !== 'local') return;
      const out = {};
      if (changes.mode) out.mode = validMode(changes.mode.newValue);
      if (changes.config) out.config = mergeConfig(changes.config.newValue);
      if (Object.keys(out).length) cb(out);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // Log writes are serialised within this context so read-modify-write
  // cycles never interleave.
  let logChain = Promise.resolve();
  function queueLog(task) {
    const p = logChain.then(task);
    logChain = p.catch(() => {});
    return p;
  }

  function appendLog(entry) {
    return queueLog(async () => {
      const { log } = await area().get('log');
      const arr = Array.isArray(log) ? log : [];
      arr.push(entry);
      if (arr.length > LOG_CAP) arr.splice(0, arr.length - LOG_CAP);
      await area().set({ log: arr });
    });
  }

  async function getLog() {
    const { log } = await area().get('log');
    return Array.isArray(log) ? log : [];
  }

  function clearLog() {
    return queueLog(() => area().set({ log: [] }));
  }

  function csvField(v) {
    let s;
    if (v === null || v === undefined) s = '';
    else if (Array.isArray(v)) s = v.join(' ');
    else s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // RFC 4180: header row, CRLF line breaks, fields containing quotes, commas
  // or line breaks are quoted with inner quotes doubled.
  function toCSV(entries) {
    const lines = [LOG_COLUMNS.join(',')];
    for (const e of entries || []) {
      lines.push(LOG_COLUMNS.map((k) => csvField(e ? e[k] : '')).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }

  const api = {
    MODES, LOG_CAP, LOG_COLUMNS,
    getMode, setMode, getConfig, setConfig, onChange,
    appendLog, getLog, clearLog, toCSV
  };
  root.PNAF = root.PNAF || {};
  root.PNAF.storage = api;
  if (isNode) module.exports = api;
})(globalThis);
