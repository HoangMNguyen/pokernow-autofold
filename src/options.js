// Options page: range editor (text, clickable 13x13 chart, "% of hands" sliders) with live validation,
// BB raise limit, decision log export / clear.
(function () {
  'use strict';
  const { ranges, defaults, storage, slider } = PNAF;
  const KEYS = defaults.RANGE_KEYS;
  // Ranges with a "% of hands" slider; the behind-limper extras and the never-fold list are click-only.
  const SLIDER_KEYS = new Set(['first2', 'middle', 'cutoff', 'button', 'vsRaiseIP', 'vsRaiseSB', 'bbVsOpen']);

  const $ = (id) => document.getElementById(id);
  const boxes = {};          // key -> { wrap, textarea, status, errors, range, output }
  const parsed = {};         // key -> parseRange result
  const cells = [];          // row-major grid cells
  let savedConfig = null;    // last loaded/saved config (merged)
  let focusedKey = KEYS[0];
  let dirty = false;
  let paint = null;          // 'add' | 'remove' while dragging across the chart

  function combosOf(hands) {
    return hands.reduce((n, h) => n + ranges.combos(h), 0);
  }

  function summary(hands) {
    const n = combosOf(hands);
    return ranges.percent(hands).toFixed(1) + '% · ' + n + ' combos · ' + hands.length + ' hands';
  }

  // ---- range boxes -------------------------------------------------------

  function buildBoxes() {
    const root = $('ranges');
    for (const key of KEYS) {
      const id = 'range-' + key;
      const wrap = document.createElement('div');
      wrap.className = 'range';
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = defaults.LABELS[key] || key;
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = defaults.HINTS[key] || '';
      const textarea = document.createElement('textarea');
      textarea.id = id;
      textarea.spellcheck = false;
      textarea.rows = 2;
      const status = document.createElement('p');
      status.className = 'range-status';
      const errors = document.createElement('ul');
      errors.className = 'errors';
      errors.hidden = true;
      wrap.append(label, hint);
      let range = null;
      let output = null;
      if (SLIDER_KEYS.has(key)) {
        const row = document.createElement('div');
        row.className = 'slider-row';
        range = document.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = String(slider.ORDER.length);
        range.step = '1';
        range.setAttribute('list', 'slider-marks');
        range.setAttribute('aria-label', (defaults.LABELS[key] || key) + ': % of hands');
        output = document.createElement('output');
        row.append(range, output);
        wrap.append(row);
        range.addEventListener('input', () => {
          setFocus(key);
          setHands(key, slider.top(Number(range.value)), true);
        });
      }
      wrap.append(textarea, status, errors);
      root.append(wrap);
      boxes[key] = { wrap, textarea, status, errors, range, output };

      textarea.addEventListener('input', () => {
        markDirty();
        validateKey(key);
        updateSaveState();
        if (key === focusedKey) renderGrid();
      });
      textarea.addEventListener('focus', () => setFocus(key));
    }
  }

  // Replace a range's hands (from the chart or a slider); the text box is rewritten in compact notation.
  function setHands(key, hands, fromSlider) {
    boxes[key].textarea.value = ranges.toText(hands);
    markDirty();
    validateKey(key, fromSlider);
    updateSaveState();
    if (key === focusedKey) renderGrid();
  }

  function validateKey(key, fromSlider) {
    const box = boxes[key];
    const res = ranges.parseRange(box.textarea.value);
    parsed[key] = res;
    const bad = res.errors.length > 0;
    box.textarea.setAttribute('aria-invalid', bad ? 'true' : 'false');
    box.wrap.classList.toggle('invalid', bad);
    box.status.textContent = summary(res.hands);
    box.errors.replaceChildren();
    for (const e of res.errors) {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = e.token;
      li.append(code, ' — ' + e.message);
      box.errors.append(li);
    }
    box.errors.hidden = !bad;
    if (box.range) {
      // A slider being dragged keeps its own position; any other edit moves it to the nearest matching size.
      if (!fromSlider) box.range.value = String(slider.closest(res.hands));
      box.output.textContent = ranges.percent(res.hands).toFixed(1) + '%';
    }
  }

  function setFocus(key) {
    focusedKey = key;
    for (const k of KEYS) boxes[k].wrap.classList.toggle('focused', k === key);
    renderGrid();
  }

  // ---- grid --------------------------------------------------------------

  function buildGrid() {
    const grid = $('grid');
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell' + (r === c ? ' pair' : '');
        cell.setAttribute('role', 'gridcell');
        cell.dataset.hand = ranges.gridCell(r, c);
        cell.textContent = cell.dataset.hand;
        grid.append(cell);
        cells.push(cell);
      }
    }

    // Click a cell to add or remove that hand; drag to paint the same change across cells.
    grid.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || e.button !== 0 || !editable()) return;
      e.preventDefault();
      // Touch input captures the pointer to the first cell; release it so the drag reaches the other cells.
      if (cell.hasPointerCapture(e.pointerId)) cell.releasePointerCapture(e.pointerId);
      paint = parsed[focusedKey].hands.includes(cell.dataset.hand) ? 'remove' : 'add';
      paintCell(cell);
    });
    grid.addEventListener('pointerover', (e) => {
      const cell = paint && e.target.closest('.cell');
      if (cell) paintCell(cell);
    });
    window.addEventListener('pointerup', () => { paint = null; });
    window.addEventListener('pointercancel', () => { paint = null; });

    const marks = $('slider-marks');
    for (const [key, k] of Object.entries(slider.MARKS)) {
      const option = document.createElement('option');
      option.value = String(k);
      option.label = defaults.LABELS[key] || key;
      marks.append(option);
    }
  }

  // The chart edits the selected range only while its text has no errors, so no typed token is ever dropped.
  function editable() {
    const res = parsed[focusedKey];
    return !!res && res.errors.length === 0;
  }

  function paintCell(cell) {
    const hands = new Set(parsed[focusedKey].hands);
    const hand = cell.dataset.hand;
    if (paint === 'add' ? hands.has(hand) : !hands.has(hand)) return;
    if (paint === 'add') hands.add(hand);
    else hands.delete(hand);
    setHands(focusedKey, [...hands], false);
  }

  function renderGrid() {
    const res = parsed[focusedKey] || { hands: [], errors: [] };
    const set = new Set(res.hands);
    for (const cell of cells) cell.classList.toggle('in', set.has(cell.dataset.hand));
    $('grid').classList.toggle('locked', !editable());
    $('grid-key').textContent = defaults.LABELS[focusedKey] || focusedKey;
    $('grid-summary').textContent = summary(res.hands) +
      (res.errors.length ? ' · fix the ' + res.errors.length + ' error(s) in the box to edit on the chart' : '');
  }

  // ---- bb limit ----------------------------------------------------------

  const bbInput = $('bbOpenMaxBB');

  function bbValue() {
    const raw = bbInput.value.trim();
    const n = Number(raw);
    return raw !== '' && Number.isFinite(n) && n >= 1 ? n : null;
  }

  function validateBB() {
    const ok = bbValue() !== null;
    bbInput.setAttribute('aria-invalid', ok ? 'false' : 'true');
    const err = $('bbOpenMaxBB-error');
    err.textContent = ok ? '' : 'Enter a number of big blinds (1 or more).';
    err.hidden = ok;
    return ok;
  }

  bbInput.addEventListener('input', () => {
    markDirty();
    validateBB();
    updateSaveState();
  });

  // ---- save / reset ------------------------------------------------------

  function errorCount() {
    let n = 0;
    for (const k of KEYS) n += parsed[k] ? parsed[k].errors.length : 0;
    if (bbValue() === null) n += 1;
    return n;
  }

  function setStatus(text, bad) {
    const el = $('save-status');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  function updateSaveState() {
    const n = errorCount();
    $('save').disabled = n > 0;
    if (n > 0) setStatus('Fix ' + n + ' error' + (n === 1 ? '' : 's') + ' before saving.', true);
    else if (dirty) setStatus('Unsaved changes.');
    else setStatus('All changes saved.');
  }

  function markDirty() {
    dirty = true;
  }

  function fillForm(config) {
    for (const k of KEYS) {
      boxes[k].textarea.value = config.ranges[k] || '';
      validateKey(k);
    }
    bbInput.value = String(config.bbOpenMaxBB);
    validateBB();
    renderGrid();
  }

  $('save').addEventListener('click', async () => {
    if (errorCount() > 0) return;
    const config = Object.assign({}, savedConfig, {
      bbOpenMaxBB: bbValue(),
      ranges: Object.assign({}, savedConfig.ranges)
    });
    for (const k of KEYS) config.ranges[k] = boxes[k].textarea.value.trim();
    try {
      await storage.setConfig(config);
      savedConfig = config;
      dirty = false;
      updateSaveState();
      setStatus('Saved. Applies from the next hand.');
    } catch (err) {
      setStatus('Save failed: ' + (err && err.message || err), true);
    }
  });

  $('reset').addEventListener('click', () => {
    fillForm(defaults.config());
    dirty = true;
    updateSaveState();
    if (errorCount() === 0) setStatus('Playbook defaults restored. Click Save to apply.');
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  storage.onChange((c) => {
    if (c.config && !dirty) {
      savedConfig = c.config;
      fillForm(c.config);
      updateSaveState();
    }
  });

  // ---- decision log ------------------------------------------------------

  function showLogCount(n) {
    $('log-count').textContent = n.toLocaleString() + (n === 1 ? ' entry' : ' entries');
    $('export').disabled = n === 0;
    $('clear').disabled = n === 0;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.log) {
      const v = changes.log.newValue;
      showLogCount(Array.isArray(v) ? v.length : 0);
    }
  });

  function stamp(d) {
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  $('export').addEventListener('click', async () => {
    const log = await storage.getLog();
    const blob = new Blob([storage.toCSV(log)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pokernow-autofold-log-' + stamp(new Date()) + '.csv';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  $('clear').addEventListener('click', async () => {
    const n = (await storage.getLog()).length;
    if (!confirm('Delete all ' + n + ' decision log entries? This cannot be undone.')) return;
    await storage.clearLog();
    showLogCount(0);
  });

  // ---- init --------------------------------------------------------------

  buildBoxes();
  buildGrid();
  setFocus(KEYS[0]);

  storage.getConfig().then((config) => {
    savedConfig = config;
    fillForm(config);
    updateSaveState();
  });
  storage.getLog().then((log) => showLogCount(log.length));
})();
