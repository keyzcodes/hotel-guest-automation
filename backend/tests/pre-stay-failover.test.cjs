const test = require('node:test');
const assert = require('node:assert/strict');
const { answerPreStay } = require('../src/services/preStayGuestService');
const { generateOpenAiReply, configuredBackup } = require('../src/services/openaiGuestAi');

const input = { text: 'Can I have a room for three nights?', history: [], hotel: {} };
const decision = { action: 'BOOKING_DETAILS', bookingEnquiry: true, guests: 1, nights: 3 };
const httpError = status => Object.assign(Error('Simulated provider error'), { status });

test('503, 429 and deadline use Terra for the same turn and run the booking workflow once', async () => {
  for (const failure of [httpError(503), httpError(429), Object.assign(Error('Timed out'), { name: 'AiDeadlineError' })]) {
    let primaryRequest;
    const backupRequests = [];
    const handled = [];
    const result = await answerPreStay({ ...input, workflow: {
      settings: { name: 'Hotel' },
      async handle(args) {
        handled.push(args);
        return { action: 'ANSWER', reply: 'Which date will you arrive?', conversational: true };
      },
    } }, async request => {
      primaryRequest = request;
      throw failure;
    }, { backup: async request => {
      backupRequests.push(request);
      return request.context.trustedResult ? { reply: 'When would you like to check in?' } : decision;
    } });
    assert.equal(result.reply, 'When would you like to check in?');
    assert.deepEqual(handled, [{ ...decision, intent: 'DETAILS' }]);
    assert.equal(backupRequests.length, 2);
    assert.deepEqual(backupRequests[0].context, primaryRequest.context);
    assert.deepEqual(backupRequests[0].schema, primaryRequest.schema);
    assert.ok(backupRequests[0].timeoutMs < 12000);
  }
});

test('successful Gemini responses and non-transient provider errors do not use the backup', async () => {
  let backupCalls = 0;
  const options = { backup: async () => { backupCalls++; } };
  const result = await answerPreStay(input, async () => ({ action: 'ANSWER', bookingEnquiry: false, reply: 'How can I help?' }), options);
  assert.equal(result.reply, 'How can I help?');
  const invalidKey = await answerPreStay(input, async () => { throw httpError(401); }, options);
  assert.equal(invalidKey.fallback, true);
  assert.equal(backupCalls, 0);
});

test('failure of both providers returns the staff-review action before any booking action runs', async () => {
  let actions = 0;
  const result = await answerPreStay({ ...input, workflow: { settings: {}, handle() { actions++; } } },
    async () => { throw httpError(503); }, { backup: async () => { throw httpError(503); } });
  assert.equal(result.action, 'HANDOFF');
  assert.equal(result.fallback, true);
  assert.equal(actions, 0);
});

test('Terra request uses strict structured output and normalizes omitted optional values', async () => {
  const schema = { type: 'object', required: ['action'], properties: {
    action: { type: 'string' }, guests: { type: 'integer' },
  } };
  const result = await generateOpenAiReply({ instruction: 'Choose an action', context: { text: 'hello' }, schema, timeoutMs: 1000 }, {
    apiKey: 'synthetic-key',
    async fetchImpl(url, { body, signal }) {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(signal.aborted, false);
      const request = JSON.parse(body);
      assert.equal(request.model, process.env.WHATSAPP_OPENAI_BACKUP_MODEL?.trim() || 'gpt-5.6-terra');
      assert.equal(request.store, false);
      assert.equal(request.text.format.strict, true);
      assert.deepEqual(request.text.format.schema.required, ['action', 'guests']);
      assert.deepEqual(request.text.format.schema.properties.guests.anyOf, [{ type: 'integer' }, { type: 'null' }]);
      return { ok: true, json: async () => ({ status: 'completed', output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"action":"ANSWER","guests":null}' }] },
      ] }) };
    },
  });
  assert.deepEqual(result, { action: 'ANSWER' });
});

test('guest failover requires an explicit opt-in and key', t => {
  const env = { ...process.env };
  t.after(() => {
    for (const key of ['OPENAI_API_KEY', 'WHATSAPP_OPENAI_FAILOVER_ENABLED']) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  });
  delete process.env.WHATSAPP_OPENAI_FAILOVER_ENABLED;
  process.env.OPENAI_API_KEY = 'synthetic-key';
  assert.equal(configuredBackup(), undefined);
  process.env.WHATSAPP_OPENAI_FAILOVER_ENABLED = 'true';
  assert.equal(configuredBackup(), generateOpenAiReply);
  delete process.env.OPENAI_API_KEY;
  assert.equal(configuredBackup(), undefined);
});
