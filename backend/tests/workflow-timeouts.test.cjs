const test = require('node:test');
const assert = require('node:assert/strict');
const { aiTimeouts, startupDiagnostics } = require('../src/services/workflowTimeouts');
const { createResponseTiming } = require('../src/services/responseTimingService');
const { answerAvailabilityTurn } = require('../src/services/preStayAvailabilityTool');

test('startup reports defaults, configured budgets and rejected settings without secrets', () => {
  assert.equal(aiTimeouts({}).preStay.timeoutMs, 12000);
  assert.equal(aiTimeouts({}).inStay.timeoutMs, 8000);
  const row = startupDiagnostics({ WHATSAPP_PRE_STAY_TIMEOUT_MS: '20000', AI_RESPONSE_TIMEOUT_MS: '15000',
    GEMINI_API_KEY: 'PRIVATE', MONGO_URI: 'PRIVATE', WHATSAPP_BOOKING_WORKFLOW_ENABLED: 'true', WHATSAPP_AVAILABILITY_TOOL_DEMO: 'true' });
  assert.deepEqual(row.preStay, { timeoutMs: 20000, source: 'configured' });
  assert.deepEqual(row.inStay, { timeoutMs: 15000, source: 'configured' });
  assert.equal(row.endToEndDeadlineMs, null);
  assert.equal(JSON.stringify(row).includes('PRIVATE'), false);
  for (const setting of ['NaN', '999', '20001', '-1']) {
    assert.deepEqual(aiTimeouts({ WHATSAPP_PRE_STAY_TIMEOUT_MS: setting }).preStay,
      { timeoutMs: 12000, source: 'invalid_using_default' });
  }
  assert.equal(aiTimeouts({ WHATSAPP_PRE_STAY_TIMEOUT_MS: '1500.5' }).preStay.timeoutMs, 12000);
  assert.equal(aiTimeouts({ AI_RESPONSE_TIMEOUT_MS: '1500.5' }).inStay.timeoutMs, 1500);
});

const input = { text: 'Synthetic enquiry', history: [], now: new Date('2026-11-10T10:00:00Z'),
  workflow: { settings: { checkInTime: '14:00', checkOutTime: '12:00', currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
    roomRates: [{ category: 'Imperial', capacity: 2, nightlyMinor: 8500000 }] } } };
const response = { functionCalls: [{ name: 'checkRoomAvailability', args: {
  arrivalDate: '2026-11-21', departureDate: '2026-11-23', guests: 1, categories: ['Imperial'],
} }] };

test('AI and inventory timings share the message trace and retain distinct durations', async () => {
  let clock = 0, row;
  const timing = createResponseTiming({ clock: () => clock, logger: value => { row = value; } });
  const outcome = await timing.measure('pre_stay_conversation', () => answerAvailabilityTurn({ ...input, timing }, {
    generate: async () => { clock += 37; return response; },
    lookup: async () => { clock += 11; return [{ category: 'Imperial' }]; },
  }));
  assert.equal(outcome.fallback, undefined);
  timing.finish('synthetic-message');
  assert.deepEqual(row.stages, [
    { stage: 'pre_stay_ai', elapsedMs: 37, result: 'ok' },
    { stage: 'pms_lookup', elapsedMs: 11, result: 'ok' },
    { stage: 'pre_stay_conversation', elapsedMs: 48, result: 'ok' },
  ]);
});

test('provider failures record an AI error without pretending inventory was checked', async () => {
  let row;
  const timing = createResponseTiming({ logger: value => { row = value; } });
  const result = await answerAvailabilityTurn({ ...input, timing }, {
    generate: async () => { throw Object.assign(Error('Synthetic provider failure'), { status: 503 }); },
    lookup: async () => assert.fail('Inventory must not execute'),
  });
  timing.finish('synthetic-message');
  assert.equal(result.fallback, true);
  assert.equal(row.stages.length, 1);
  assert.equal(row.stages[0].stage, 'pre_stay_ai');
  assert.equal(row.stages[0].result, 'error');
});

test('inventory failure remains distinct from successful AI interpretation', async () => {
  let row;
  const timing = createResponseTiming({ logger: value => { row = value; } });
  const result = await answerAvailabilityTurn({ ...input, timing }, {
    generate: async () => response,
    lookup: async () => { throw Error('Synthetic database failure'); },
  });
  timing.finish('synthetic-message');
  assert.equal(result.fallback, undefined);
  assert.deepEqual(row.stages.map(({ stage, result }) => ({ stage, result })), [
    { stage: 'pre_stay_ai', result: 'ok' }, { stage: 'pms_lookup', result: 'error' },
  ]);
});
