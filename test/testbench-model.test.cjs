const { test } = require('node:test');
const assert = require('node:assert/strict');

const model = import('../server/public/testbench/model.js');
const choices = row => row.steps.map(step => step.enabled);

function pendingRow(createRows) {
  const row = createRows()[0];
  row.steps.forEach(step => { step.status = 'pending'; step.missing = false; });
  row.runner = null;
  return row;
}

test('editing stage selection preserves failed execution history', async () => {
  const { createRows, setStep } = await model;
  const row = createRows()[0];
  const before = structuredClone(row);
  const index = row.steps.findIndex(step => step.status === 'failed');
  assert.ok(index >= 0);
  setStep(row, index, false);
  assert.equal(row.steps[index].enabled, false);
  assert.equal(row.steps[index].status, 'failed');
  assert.deepEqual(row.steps.map(step => step.status), before.steps.map(step => step.status));
  setStep(row, index, true);
  assert.deepEqual(row, before);
});

test('EN pauses the runner without losing selections, statuses, or elapsed time', async () => {
  const { createRows, setRow, tickRow } = await model;
  const row = createRows().find(item => item.runner);
  const at = row.runner.at;
  const selected = choices(row);
  tickRow(row, 1000);
  setRow(row, false);
  const paused = structuredClone(row);
  assert.equal(tickRow(row, 10000), false);
  assert.deepEqual(row, paused);
  setRow(row, true);
  assert.equal(tickRow(row, 4000), true);
  assert.equal(row.steps[at].status, 'done');
  assert.equal(row.runner.at, at + 1);
  assert.deepEqual(choices(row), selected);
});

test('start, stop, and explicit retry preserve stage choices', async () => {
  const { createRows, setStep, startRow, stopRow, tickRow } = await model;
  const row = pendingRow(createRows);
  setStep(row, 1, false);
  setStep(row, 4, false);
  const selected = choices(row);
  assert.equal(startRow(row), true);
  assert.deepEqual(choices(row), selected);
  tickRow(row, 1000);
  stopRow(row);
  assert.equal(row.runner, null);
  assert.deepEqual(choices(row), selected);
  row.steps[2].status = 'failed';
  assert.equal(startRow(row, 2), true);
  assert.equal(row.steps[2].status, 'running');
  assert.deepEqual(choices(row), selected);
});

test('disabled rows and rows with no selected stages cannot start', async () => {
  const { createRows, setRow, setStep, startRow } = await model;
  const row = pendingRow(createRows);
  setRow(row, false);
  const disabled = structuredClone(row);
  assert.equal(startRow(row), false);
  assert.deepEqual(row, disabled);
  setRow(row, true);
  row.steps.forEach((_, index) => setStep(row, index, false));
  const unselected = structuredClone(row);
  assert.equal(startRow(row), false);
  assert.deepEqual(row, unselected);
});

test('execution advances past unselected stages without running them', async () => {
  const { createRows, setStep, startRow, tickRow } = await model;
  const row = pendingRow(createRows);
  setStep(row, 1, false);
  setStep(row, 2, false);
  row.steps[1].missing = true;
  assert.equal(startRow(row), true);
  assert.equal(tickRow(row, 5000), true);
  assert.equal(row.steps[0].status, 'done');
  assert.equal(row.steps[1].status, 'skipped');
  assert.equal(row.steps[2].status, 'skipped');
  assert.equal(row.steps[3].status, 'running');
  assert.equal(row.runner.at, 3);
  for (let n = 0; n < row.steps.length && row.runner; n++) tickRow(row, 5000);
  assert.equal(row.runner, null);
  assert.equal(row.steps[9].status, 'skipped');
  assert.equal(row.steps[8].status, 'done');
});

test('a selected stage with missing input blocks automatic advancement and retry', async () => {
  const { createRows, startRow, tickRow } = await model;
  const row = pendingRow(createRows);
  row.steps[1].missing = true;
  assert.equal(startRow(row), true);
  tickRow(row, 5000);
  assert.equal(row.steps[0].status, 'done');
  assert.equal(row.steps[1].status, 'pending');
  assert.equal(row.steps[2].status, 'pending');
  assert.equal(row.runner, null);
  const blocked = structuredClone(row);
  assert.equal(tickRow(row, 5000), false);
  assert.equal(startRow(row, 1), false);
  assert.deepEqual(row, blocked);
  row.steps[1].missing = false;
  assert.equal(startRow(row, 1), true);
});

test('replay resets simulated execution but preserves every EN and stage choice', async () => {
  const { createRows, setRow, setStep, startRow, tickRow, replayRows } = await model;
  const rows = createRows();
  setRow(rows[0], false);
  setStep(rows[0], 2, false);
  setStep(rows[1], 9, true);
  startRow(rows[2]);
  tickRow(rows[2], 5000);
  const before = structuredClone(rows);
  const replayed = replayRows(rows);
  assert.notEqual(replayed, rows);
  assert.deepEqual(replayed.map(row => row.enabled), rows.map(row => row.enabled));
  assert.deepEqual(replayed.map(choices), rows.map(choices));
  assert.deepEqual(replayed.map(row => row.steps.map(step => step.status)), createRows().map(row => row.steps.map(step => step.status)));
  assert.deepEqual(rows, before);
});

test('reports are available exactly when the Rpt stage has completed', async () => {
  const { createRows, STATUS, reportAvailable, setRow, setStep } = await model;
  const row = pendingRow(createRows);
  const index = row.steps.findIndex(step => step.name === 'Rpt');
  for (const status of Object.keys(STATUS)) {
    row.steps[index].status = status;
    assert.equal(reportAvailable(row), status === 'done', status);
  }
  row.steps[index].status = 'done';
  setRow(row, false);
  setStep(row, index, false);
  assert.equal(reportAvailable(row), true);
});
