const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { generateGuestModelResponse } = require('../src/services/guestAiService');
const { answerAvailabilityTurn } = require('../src/services/preStayAvailabilityTool');

const request = { model: 'test-model', contents: 'Synthetic guest request', config: {}, timeoutMs: 20000, maxRetries: 2 };
const response = { functionCalls: [{ name: 'checkRoomAvailability', args: {
  arrivalDate: '2026-11-21', departureDate: '2026-11-23', guests: 1, mode: 'COMPARE',
  reuseLastStay: false, categories: ['Junior Suite'],
} }] };
const client = generateContent => ({ models: { generateContent } });

test('transient provider failures retry with the remaining budget and SDK retries disabled', async () => {
  for (const status of [503, 504, 429]) {
    const attempts = [];
    const result = await generateGuestModelResponse(request, client(async payload => {
      attempts.push(payload);
      if (attempts.length === 1) throw Object.assign(Error('Synthetic transient error'), { status });
      return response;
    }));
    assert.equal(result, response);
    assert.equal(attempts.length, 2);
    assert.ok(attempts[1].config.httpOptions.timeout < attempts[0].config.httpOptions.timeout);
    assert.equal(attempts[0].config.httpOptions.retryOptions.attempts, 1);
    assert.equal(attempts[1].config.httpOptions.retryOptions.attempts, 1);
  }
});

test('continuous overload stops after two retries', async () => {
  let calls = 0;
  const failure = Object.assign(Error('Synthetic overload'), { status: 503 });
  await assert.rejects(generateGuestModelResponse(request, client(async () => {
    calls++;
    throw failure;
  })), error => error === failure);
  assert.equal(calls, 3);
});

test('permanent errors and provider delays beyond the remaining budget fail without extra calls', async () => {
  const failures = [
    Object.assign(Error('Synthetic invalid schema'), { status: 400 }),
    Object.assign(Error('Synthetic invalid key'), { statusCode: 403 }),
    Object.assign(Error('Synthetic rate limit'), {
      response: { status: 429, headers: new Headers({ 'retry-after': '60' }) },
    }),
    Object.assign(Error(JSON.stringify({ error: { details: [{
      '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '60s',
    }] } })), { status: 429 }),
  ];
  for (const failure of failures) {
    let calls = 0;
    await assert.rejects(generateGuestModelResponse(request, client(async () => {
      calls++;
      throw failure;
    })), error => error === failure);
    assert.equal(calls, 1);
  }
});

test('one shared deadline aborts a hanging retry and late output cannot escape', async () => {
  let calls = 0, lastSignal, complete;
  const started = performance.now();
  await assert.rejects(generateGuestModelResponse({ ...request, timeoutMs: 1500 }, client(async payload => {
    calls++;
    if (calls === 1) throw Object.assign(Error('Synthetic overload'), { status: 503 });
    lastSignal = payload.config.abortSignal;
    return new Promise(resolve => { complete = resolve; });
  })), error => error.name === 'AiDeadlineError');
  assert.equal(calls, 2);
  assert.equal(lastSignal.aborted, true);
  assert.ok(performance.now() - started < 2400, 'Retry must not reset the 1.5-second test budget');
  complete(response);
  await Promise.resolve();
  assert.equal(calls, 2);
});

test('a recovered model request runs the PMS tool once and returns its verified facts', async () => {
  let providerCalls = 0, lookups = 0;
  const fake = client(async () => {
    providerCalls++;
    if (providerCalls === 1) throw Object.assign(Error('Synthetic overload'), { status: 503 });
    return response;
  });
  const result = await answerAvailabilityTurn({
    text: 'Junior Suite for one guest from 21 to 23 November', history: [], now: new Date('2026-11-10T10:00:00Z'),
    workflow: { settings: {
      checkInTime: '14:00', checkOutTime: '12:00', currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
      roomRates: [{ category: 'Junior Suite', capacity: 2, nightlyMinor: 14500000 }],
    } },
  }, {
    generate: params => generateGuestModelResponse(params, fake),
    lookup: async () => { lookups++; return [{ category: 'Junior Suite' }]; },
  });
  assert.equal(providerCalls, 2);
  assert.equal(lookups, 1);
  assert.match(result.reply, /Junior Suite is available at ₦290,000 total for 2 nights/);
  assert.equal(result.fallback, undefined);
});

test('a transient failure can recover into the saved-enquiry reminder', async () => {
  let calls = 0;
  const fake = client(async () => {
    calls++;
    if (calls === 1) throw Object.assign(Error('Synthetic overload'), { status: 503 });
    return { functionCalls: [{ name: 'getEnquiryProgress', args: {} }] };
  });
  const result = await answerAvailabilityTurn({
    text: 'I am back, where were we?', history: [], workflow: { settings: {} },
    availabilityContext: {
      arrivalDate: '2026-11-23', departureDate: '2026-11-24', guests: 1,
      requestedCategories: ['Junior Suite'], checkedCategories: ['Junior Suite'],
    },
  }, {
    generate: params => generateGuestModelResponse(params, fake),
    lookup: () => assert.fail('A reminder must not claim to recheck inventory'),
  });
  assert.equal(calls, 2);
  assert.match(result.reply, /We last checked Junior Suite, 23 Nov 2026 to 24 Nov 2026, 1 guest/);
  assert.equal(result.fallback, undefined);
});
