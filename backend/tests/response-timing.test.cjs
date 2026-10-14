const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createResponseTiming } = require('../src/services/responseTimingService');
test('timing preserves results, measures stages and reports only once', async () => {
  let now = 0; const rows = [];
  const timing = createResponseTiming({ clock: () => now, logger: row => rows.push(row) });
  const value = await timing.measure('database', async () => { now = 25; return 123; });
  assert.equal(value, 123); timing.setOutcome('local_fallback'); now = 40;
  timing.finish('saved-message'); timing.finish('saved-message');
  assert.deepEqual(rows, [{ messageId: 'saved-message', outcome: 'local_fallback', totalMs: 40, stages: [{ stage: 'database', elapsedMs: 25, result: 'ok' }] }]);
});
test('timing preserves the original rejection and records the failed stage', async () => {
  let now = 0; let row;
  const timing = createResponseTiming({ clock: () => now, logger: value => { row = value; } });
  const failure = new Error('private provider detail');
  await assert.rejects(timing.measure('ai', async () => { now = 10; throw failure; }), error => error === failure);
  timing.finish(); assert.equal(row.stages[0].result, 'error');
  assert.equal(JSON.stringify(row).includes('private provider detail'), false);
});
test('failed telemetry cannot change guest processing', () => {
  const timing = createResponseTiming({ logger: () => { throw Error('logger unavailable'); } });
  assert.doesNotThrow(() => timing.finish());
});
