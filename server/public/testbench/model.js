// All fixtures are synthetic. Configuration and execution history are independent.
export const STAGES = ['Parse', 'Netl', 'DSPF', 'Check', 'Make', 'Run', 'Rpt', 'ChkXML', 'Promote', 'FDR'];
export const STATUS = { pending: 'Pending', queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed', skipped: 'Skipped', stale: 'Stale', decision: 'Needs decision' };
const ids = ['1042', '2087', '3164', '4093', '5271', '6382', '7406', '8519'];
const initial = [[2, 'failed'], [1, 'running'], [4, 'queued'], [8, 'decision'], [10, 'done'], [2, 'stale'], [5, 'running'], [0, 'pending']];
export function createRows() {
  return ids.map((id, r) => {
    const [at, state] = initial[r];
    const steps = STAGES.map((name, s) => ({ name, enabled: s !== 9, defaultEnabled: s !== 9, status: s < at ? 'done' : s === at ? state : 'pending', missing: r === 7 && s === 0 }));
    steps[9].status = 'skipped';
    if (r === 4) { steps[2].enabled = false; steps[2].defaultEnabled = false; steps[2].status = 'skipped'; }
    if (r === 3) steps[5].enabled = false;
    if (r === 5) steps[2].defaultEnabled = false;
    return { id, name: `tb_case_${id}`, enabled: true, steps, cursor: Math.min(at, 8), runner: state === 'running' ? { at, elapsed: 0, from: at } : null, stopped: false, corners: [3, 6, 3, 9, 6, 3, 6, 3][r] };
  });
}
export function setStep(row, index, enabled) { row.steps[index].enabled = enabled; }
export function setRow(row, enabled) { row.enabled = enabled; }
export function reportAvailable(row) { return row.steps[6].status === 'done'; }
export function startRow(row, from) {
  if (!row.enabled) return false;
  let at = from ?? row.steps.findIndex(step => step.enabled && step.status !== 'done');
  if (at < 0) at = row.steps.findIndex(step => step.enabled);
  if (at < 0 || !row.steps[at].enabled || row.steps[at].missing) return false;
  // A retry invalidates downstream execution results, but leaves selection intact.
  row.steps.forEach((step, s) => {
    if (s >= at) step.status = step.enabled ? 'pending' : 'skipped';
    else if (step.status === 'running') step.status = 'pending';
  });
  row.steps[at].status = 'running';
  row.runner = { at, elapsed: 0, from: at };
  row.cursor = at; row.stopped = false;
  return true;
}
export function stopRow(row) {
  if (!row.runner) return;
  row.steps[row.runner.at].status = 'pending';
  row.runner = null; row.stopped = true;
}
export function tickRow(row, dt) {
  if (!row.enabled || !row.runner) return false;
  const runner = row.runner;
  runner.elapsed += dt;
  // Only the connecting line moves; no invented per-stage percentage.
  row.cursor = runner.from + (runner.at - runner.from) * Math.min(1, runner.elapsed / 750);
  if (runner.elapsed < 5000) return false;
  row.steps[runner.at].status = 'done';
  let next = runner.at + 1;
  while (next < STAGES.length && !row.steps[next].enabled) {
    if (row.steps[next].status === 'pending') row.steps[next].status = 'skipped';
    next++;
  }
  if (next === STAGES.length) { row.cursor = 9.5; row.runner = null; return true; }
  if (row.steps[next].missing) { row.runner = null; row.cursor = next; return true; }
  row.steps[next].status = 'running';
  row.runner = { at: next, elapsed: 0, from: runner.at };
  return true;
}
export function replayRows(rows) {
  const fresh = createRows();
  rows.forEach((row, r) => {
    fresh[r].enabled = row.enabled;
    row.steps.forEach((step, s) => { fresh[r].steps[s].enabled = step.enabled; });
  });
  return fresh;
}
