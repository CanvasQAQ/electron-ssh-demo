import { STAGES, STATUS, createRows, setStep, setRow, startRow, stopRow, tickRow, replayRows, reportAvailable } from './model.js';

const $ = selector => document.querySelector(selector);
const svg = content => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const icons = {
  warning: svg('<path d="M7.1 2.1a1 1 0 0 1 1.8 0l5.6 10.2a1 1 0 0 1-.9 1.5H2.4a1 1 0 0 1-.9-1.5Z" fill="#fff3cd"/><path d="M8 5.5v3.5" stroke-width="1.6"/><circle cx="8" cy="11.3" r=".8" fill="currentColor" stroke="none"/>'),
  play: svg('<path d="m6 3 7 5-7 5Z"/>'), pause: svg('<path d="M6 4v8M10 4v8"/>'), stop: svg('<rect x="4.5" y="4.5" width="7" height="7" rx=".5"/>'),
  next: svg('<path d="m3 4 6 4-6 4ZM12 4v8"/>'), replay: svg('<path d="M3 6a5 5 0 1 1 0 4M3 2v4h4"/>'), close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  report: svg('<path d="M9 2H4v12h8V5Zm0 0v3h3M6 8h4M6 10h4"/>'), corners: svg('<path d="M5 2H2v3m9-3h3v3M2 11v3h3m9-3v3h-3"/>'),
  pending: svg('<circle cx="8" cy="8" r="2.5"/>'), queued: svg('<rect x="2" y="2" width="12" height="12" rx="3" fill="#eef0f3" stroke="none"/><path d="M6 5v6M10 5v6"/>'),
  running: '<svg class="spin" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-opacity=".2" stroke-width="1.5"/><path d="M8 2.5A5.5 5.5 0 0 1 13.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  done: svg('<circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none"/><path d="m5 8 2 2 4-4" stroke="white"/>'),
  failed: svg('<path d="m8 .9 7.1 7.1L8 15.1.9 8Z" fill="#fff7f5"/><path d="m6 6 4 4m0-4-4 4"/>'),
  skipped: svg('<circle cx="8" cy="8" r="6"/><path d="m9 3-2 10"/>'),
  stale: svg('<circle cx="8" cy="8" r="6" fill="#fffcf4"/><path d="M8 4v4l3 1M11 3l2 1 .5-2"/>'),
  decision: svg('<path d="m8 1 7 7-7 7-7-7Z" fill="#faf7fd"/><path d="M6.3 5.7a1.8 1.8 0 0 1 3.4.7c0 1.1-1.7 1.4-1.7 2.7M8 11.5h0"/>')
};
const key = 'flow-monitor-demo-v1';
let rows = createRows(), playing = true, looping = true, speed = 1;
let pinnedEdit = false, heldEdit = false, blockedHold = false, dragging = null, gestureEdit = false;
let selection = { kind: 'log', r: 0, s: 2 }, ai = false;
const importBits = new URL(location.href).searchParams.get('steps');
try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (saved?.steps?.length === rows.length && saved.steps.every(list => list.length === STAGES.length && list.every(value => typeof value === 'boolean'))) {
    rows.forEach((row, r) => { row.steps.forEach((step, s) => { step.enabled = saved.steps[r][s]; }); row.enabled = saved.rows?.[r] !== false; });
  }
} catch { /* Storage is optional; the demo works without it. */ }
if (/^[01]{80}$/.test(importBits || '')) {
  rows.forEach((row, r) => row.steps.forEach((step, s) => { step.enabled = importBits[r * 10 + s] === '1'; }));
  const clean = new URL(location.href); clean.searchParams.delete('steps'); history.replaceState(null, '', clean);
}
function save() {
  try { localStorage.setItem(key, JSON.stringify({ steps: rows.map(row => row.steps.map(step => step.enabled)), rows: rows.map(row => row.enabled) })); } catch {}
}
save();
const editing = () => pinnedEdit || heldEdit;
const say = text => { $('#announcement').textContent = text; };
function node(status, extra = '') { return `<span class="node status-${status}">${icons[status]}${extra}</span>`; }
$('#playback').innerHTML = icons.pause; $('#advance').innerHTML = icons.next; $('#replay').innerHTML = icons.replay;
$('#close-detail').innerHTML = icons.close;
$('#stage-head').innerHTML = STAGES.map(stage => `<span>${stage}</span>`).join('');
$('#legend').innerHTML = [...Object.entries(STATUS).map(([state, label]) => `<span class="legend-item">${node(state)}${label}</span>`), `<span class="legend-item">${node('warning')}Missing input</span>`].join('');
$('#rows').innerHTML = rows.map((row, r) => `<div class="flow-row table-grid" data-row="${r}" role="row">
  <div class="en-cell left-sticky" role="cell"><input type="checkbox" class="row-en" data-en="${r}" aria-label="Enable ${row.name}"></div>
  <div class="name-cell left-sticky" role="cell"><span class="row-name">${row.name}</span></div>
  <div class="track" role="cell"><svg class="wire" aria-hidden="true"><defs><clipPath id="clip-${r}"><rect class="progress-clip" x="0" y="0" height="50"/></clipPath></defs><path class="wire-base"/><path class="wire-progress" clip-path="url(#clip-${r})"/></svg>
    ${row.steps.map((step, s) => `<div class="step" data-r="${r}" data-s="${s}"><button class="node-button" data-log="${r},${s}"></button><button class="step-toggle" role="checkbox" data-toggle="${r},${s}" aria-checked="true"><span class="toggle-mark"></span></button></div>`).join('')}
  </div>
  <div class="action-cell right-sticky" role="cell"><button class="row-icon" data-start="${r}">${icons.play}</button><button class="row-icon" data-stop="${r}">${icons.stop}</button></div>
  <div class="corners-cell right-sticky" role="cell"><button class="corner-button" data-corners="${r}" aria-label="View ${row.name} Corners">${icons.corners}<span>${row.corners}</span></button></div>
  <div class="report-cell right-sticky" role="cell"><button class="row-icon" data-report="${r}" aria-label="View ${row.name} Report">${icons.report}</button></div>
</div>`).join('');
const rowElements = [...document.querySelectorAll('.flow-row')];
function renderRow(r) {
  const row = rows[r], el = rowElements[r];
  el.classList.toggle('row-disabled', !row.enabled);
  el.classList.toggle('log-selected', selection?.kind === 'log' && selection.r === r);
  el.querySelector('.row-en').checked = row.enabled;
  el.querySelectorAll('.step').forEach((cell, s) => {
    const step = row.steps[s], log = cell.querySelector('.node-button'), toggle = cell.querySelector('.step-toggle');
    const extra = step.enabled !== step.defaultEnabled ? '<i class="override"></i>' : '';
    cell.classList.toggle('off', !step.enabled); cell.dataset.status = step.status;
    const markup = node(step.missing ? 'warning' : step.status, extra);
    if (log.innerHTML !== markup) log.innerHTML = markup;
    const label = `${row.name} · ${step.name} · ${STATUS[step.status]}${step.missing ? ' · Missing input' : ''} · ${step.enabled ? 'Run' : 'Excluded'}`;
    log.setAttribute('aria-label', `View logs ${label}`); log.title = label;
    const activeLog = selection?.kind === 'log' && selection.r === r && selection.s === s;
    log.classList.toggle('selected', activeLog);
    if (activeLog) log.setAttribute('aria-current', 'true');
    else log.removeAttribute('aria-current');
    log.tabIndex = editing() ? -1 : 0;
    toggle.setAttribute('aria-label', `${step.enabled ? 'Exclude' : 'Include'} ${row.name} ${step.name}`);
    toggle.setAttribute('aria-checked', String(step.enabled)); toggle.title = `${label} · Click to toggle`;
    toggle.disabled = !row.enabled; toggle.tabIndex = editing() ? 0 : -1;
    toggle.querySelector('.toggle-mark').textContent = step.enabled ? '✓' : '−';
  });
  const start = el.querySelector('[data-start]'), stop = el.querySelector('[data-stop]'), report = el.querySelector('[data-report]');
  start.disabled = !row.enabled || !!row.runner || !row.steps.some(step => step.enabled) || row.steps.find(step => step.enabled && step.status !== 'done')?.missing === true;
  start.title = start.disabled ? (row.runner ? 'Running' : !row.enabled ? 'Testbench disabled' : 'No runnable stages or required input is missing') : 'Run this Testbench';
  start.setAttribute('aria-label', `Run ${row.name}`);
  stop.disabled = !row.runner; stop.title = 'Stop this Testbench'; stop.setAttribute('aria-label', `Stop ${row.name}`);
  report.disabled = !reportAvailable(row); report.title = report.disabled ? 'Report available after Rpt completes' : 'View report';
  drawWire(r);
}
function drawWire(r) {
  const track = rowElements[r].querySelector('.track'), w = track.clientWidth, h = track.clientHeight, y = h / 2;
  let d = `M0 ${y}`;
  rows[r].steps.forEach((step, s) => {
    const c = (s + .5) * w / STAGES.length;
    if (!step.enabled) d += ` L${c - 14} ${y} C${c - 9} ${y},${c - 11} ${y + 8},${c - 4} ${y + 8} L${c + 4} ${y + 8} C${c + 11} ${y + 8},${c + 9} ${y},${c + 14} ${y}`;
    else d += ` L${c} ${y}`;
  });
  d += ` L${w} ${y}`;
  track.querySelectorAll('.wire path').forEach(path => path.setAttribute('d', d));
  updateProgress(r);
}
function updateProgress(r) { rowElements[r].querySelector('.progress-clip').setAttribute('width', Math.max(0, (rows[r].cursor + .5) / STAGES.length * rowElements[r].querySelector('.track').clientWidth)); }
function render() {
  $('#stage-head').querySelectorAll('span').forEach((label, s) => {
    label.classList.toggle('active-stage', selection?.kind === 'log' && selection.s === s);
  });
  rows.forEach((_, r) => renderRow(r));
  const enabled = rows.filter(row => row.enabled).length;
  $('#enable-all').checked = enabled === rows.length; $('#enable-all').indeterminate = enabled > 0 && enabled < rows.length;
  $('#start-all').disabled = enabled === 0;
}
function mode() {
  const on = editing(); document.body.classList.toggle('editing', on);
  $('#edit').textContent = on ? 'Done editing' : 'Edit steps'; $('#edit').setAttribute('aria-pressed', String(on));
  $('#mode-name').textContent = on ? (heldEdit && !pinnedEdit ? 'Quick edit' : 'Edit steps') : 'Pipelines';
  $('#mode-hint').textContent = on ? '✓ Include  − Bypass' : 'Click a node to view logs';
  render();
}
function openDetails(kind, r, s) { selection = { kind, r, s }; ai = false; $('#inspector').hidden = false; render(); details(); }
function details() {
  if (!selection) { $('#inspector').hidden = true; return; }
  const { kind, r, s } = selection, row = rows[r];
  $('#detail-kind').textContent = kind === 'log' ? 'Logs' : kind === 'corners' ? 'Corners' : 'Report';
  $('#detail-title').textContent = `${row.name}${kind === 'log' ? ` / ${STAGES[s]}` : ''}`;
  $('#retry').hidden = kind !== 'log' || !['failed', 'stale'].includes(row.steps[s]?.status);
  $('#diagnose').hidden = kind !== 'log' || row.steps[s]?.status !== 'failed';
  $('#retry').disabled = !row.enabled || !row.steps[s]?.enabled;
  $('#retry').title = $('#retry').disabled ? 'Enable this Testbench and stage first' : 'Rerun this stage and enabled downstream stages';
  if (kind === 'log') {
    const step = row.steps[s];
    const content = {
      pending: step.missing ? ['Waiting for input_01.cfg', 'Required input is missing.'] : ['Waiting for upstream stages.'],
      queued: ['Submitted to the demo scheduler.', 'Waiting for an available worker.'],
      running: [`Starting ${step.name}.`, 'Worker active · waiting for stage completion.'],
      done: [`${step.name} completed successfully.`, 'Exit code: 0'],
      failed: [`Reading input_01.dspf`, 'ERROR: unresolved reference at line 128.', 'Stage stopped. Downstream stages are waiting.'],
      skipped: ['Stage skipped by the execution plan.'],
      stale: ['Saved result no longer matches the current inputs.', 'Re-run this stage to refresh its result.'],
      decision: ['Output is ready for review.', 'Waiting for an operator decision.']
    }[step.status];
    $('#detail-content').innerHTML = `<div class="detail-status">${node(step.missing ? 'warning' : step.status)}${step.missing ? 'Missing input' : STATUS[step.status]}${!row.enabled ? ' · Testbench disabled' : ''}${!step.enabled ? ' · Stage excluded' : ''}</div><pre class="log-lines">${content.map((text, n) => `<span class="${text.startsWith('ERROR') ? 'log-error' : ''}"><span class="log-num">${String(n + 1).padStart(2, '0')}</span>${text}</span>`).join('\n')}</pre>${ai ? '<div class="ai-note">Demo analysis: verify the references in input_01.dspf against the input manifest. No AI service is connected and no files are modified.</div>' : ''}`;
  } else if (kind === 'corners') {
    const labels = ['TT', 'SS', 'FF'];
    $('#detail-content').innerHTML = `<table class="detail-table"><thead><tr><th>Corner</th><th>Voltage</th><th>Temperature</th></tr></thead><tbody>${Array.from({ length: row.corners }, (_, i) => `<tr><td>${labels[i % 3]}_${Math.floor(i / 3) + 1}</td><td>${['0.90', '0.81', '0.99'][i % 3]} V</td><td>${[25, -40, 125][i % 3]} °C</td></tr>`).join('')}</tbody></table>`;
  } else {
    $('#detail-content').innerHTML = `<table class="detail-table"><thead><tr><th>Metric</th><th>Result</th></tr></thead><tbody><tr><td>Testbench</td><td>${row.name}</td></tr><tr><td>Checks passed</td><td>24 / 24</td></tr><tr><td>Corners</td><td>${row.corners}</td></tr><tr><td>Warnings</td><td>0</td></tr></tbody></table><p class="detail-note">Demo report · Synthetic results</p>`;
  }
}
function toggleStep(r, s, value) { if (!rows[r].enabled) return; setStep(rows[r], s, value ?? !rows[r].steps[s].enabled); save(); renderRow(r); }
$('#edit').addEventListener('click', event => {
  if (editing()) { pinnedEdit = false; heldEdit = false; blockedHold = event.ctrlKey || event.altKey; } else { pinnedEdit = true; }
  mode(); say(editing() ? 'Editing steps: check to run, minus to bypass' : 'Editing finished');
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { pinnedEdit = false; heldEdit = false; blockedHold = event.ctrlKey || event.altKey; dragging = null; mode(); }
  if ((event.key === 'Control' || event.key === 'Alt') && !blockedHold && !event.repeat && !event.target.matches('input:not([type=checkbox]),select,textarea')) { heldEdit = true; mode(); }
});
window.addEventListener('keyup', event => {
  if (event.key === 'Control' || event.key === 'Alt') { heldEdit = event.ctrlKey || event.altKey; if (!heldEdit) blockedHold = false; mode(); }
});
function releaseHeld() { heldEdit = false; blockedHold = false; dragging = null; mode(); }
window.addEventListener('blur', releaseHeld);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHeld(); });
// macOS interprets Control-click as a secondary click; editing still owns it.
$('#rows').addEventListener('contextmenu', event => {
  if (editing() && event.ctrlKey && event.target.closest('.step')) event.preventDefault();
});
$('#rows').addEventListener('pointerdown', event => {
  const cell = event.target.closest('.step');
  if (!cell || (event.button !== 0 && !(event.button === 2 && event.ctrlKey))) return;
  // Some embedded browsers deliver mouse modifiers without separate key events.
  if (!editing() && (event.ctrlKey || event.altKey) && !blockedHold) {
    gestureEdit = true; heldEdit = true; mode();
  }
  const target = cell.querySelector('[data-toggle]');
  if (!editing() || target.disabled) return;
  event.preventDefault(); target.focus();
  const [r, s] = target.dataset.toggle.split(',').map(Number);
  dragging = { value: !rows[r].steps[s].enabled }; toggleStep(r, s, dragging.value);
});
$('#rows').addEventListener('pointerover', event => {
  const target = event.target.closest('[data-toggle]');
  if (!target || !dragging || !editing()) return;
  const [r, s] = target.dataset.toggle.split(',').map(Number); toggleStep(r, s, dragging.value);
});
function finishDrag() {
  dragging = null;
  if (gestureEdit) { gestureEdit = false; heldEdit = false; mode(); }
}
window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);
$('#rows').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.toggle && editing() && event.detail === 0) { const [r, s] = button.dataset.toggle.split(',').map(Number); toggleStep(r, s); return; }
  if (button.dataset.log && (event.ctrlKey || event.altKey)) return;
  if (button.dataset.log && !editing()) { const [r, s] = button.dataset.log.split(',').map(Number); openDetails('log', r, s); }
  if (button.dataset.start !== undefined) { const r = +button.dataset.start; startRow(rows[r]); render(); details(); }
  if (button.dataset.stop !== undefined) { stopRow(rows[+button.dataset.stop]); render(); details(); }
  if (button.dataset.corners !== undefined) openDetails('corners', +button.dataset.corners);
  if (button.dataset.report !== undefined) openDetails('report', +button.dataset.report);
});
$('#rows').addEventListener('change', event => {
  if (event.target.dataset.en === undefined) return;
  setRow(rows[+event.target.dataset.en], event.target.checked); save(); render(); details();
});
$('#enable-all').addEventListener('change', event => { rows.forEach(row => setRow(row, event.target.checked)); save(); render(); details(); });
$('#start-all').addEventListener('click', () => { rows.filter(row => row.enabled && !row.runner).forEach(row => startRow(row)); render(); details(); });
$('#close-detail').addEventListener('click', () => { selection = null; render(); details(); });
$('#retry').addEventListener('click', () => { startRow(rows[selection.r], selection.s); ai = false; render(); details(); });
$('#diagnose').addEventListener('click', () => { ai = true; details(); });
$('#playback').addEventListener('click', () => {
  playing = !playing; document.body.classList.toggle('paused', !playing);
  $('#playback').innerHTML = playing ? icons.pause : icons.play;
  $('#playback').setAttribute('aria-label', playing ? 'Pause demo' : 'Resume demo'); $('#playback').title = playing ? 'Pause demo' : 'Resume demo';
});
$('#advance').addEventListener('click', () => { rows.forEach(row => tickRow(row, 5000)); render(); details(); });
$('#replay').addEventListener('click', () => { rows = replayRows(rows); idleTime = 0; render(); details(); });
$('#speed').addEventListener('change', event => { speed = +event.target.value; });
$('#loop').addEventListener('change', event => { looping = event.target.checked; idleTime = 0; });
let previous = performance.now(), idleTime = 0;
function frame(now) {
  const dt = Math.min(100, now - previous) * speed; previous = now;
  if (playing && !document.hidden) {
    let changed = false;
    rows.forEach((row, r) => { if (tickRow(row, dt)) { changed = true; renderRow(r); } if (row.runner && row.enabled) updateProgress(r); });
    if (changed) details();
    const anyRunning = rows.some(row => row.runner);
    idleTime = anyRunning ? 0 : idleTime + dt;
    if (looping && idleTime > 3000) { rows = replayRows(rows); idleTime = 0; render(); details(); }
  }
  requestAnimationFrame(frame);
}
new ResizeObserver(() => rows.forEach((_, r) => drawWire(r))).observe($('.flow-table'));
render(); details(); requestAnimationFrame(frame);
