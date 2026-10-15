const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const answer = JSON.stringify({ action: 'ANSWER', category: 'General Inquiry', ticketId: '', reply: 'Welcome' });
const input = { text: 'How far bro', hotel: {}, booking: {}, history: [], tickets: [] };
function fixture(generate) {
  const env = { GEMINI_API_KEY: 'test-only', GEMINI_MODEL: 'test-model', USE_MOCK_AI: 'false' };
  const instances = []; let timerCount = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/guestAiService.js'), 'utf8'), {
    module, process: { env }, AbortController,
    setTimeout: (callback, ms) => { timerCount++; return setTimeout(callback, Math.min(ms, 25)); }, clearTimeout,
    require: name => { assert.equal(name, '@google/genai'); return { GoogleGenAI: class { constructor(options) { instances.push(options); this.models = { generateContent: generate }; } } }; },
  });
  return { run: client => module.exports.interpretGuestMessage(input, client), env, instances, timers: () => timerCount };
}
test('validated decisions and schema remain intact; SDK retries are disabled', async () => {
  let received; const f = fixture(async config => { received = config; return { text: answer }; });
  assert.equal((await f.run()).action, 'ANSWER'); assert.equal(received.model, 'test-model');
  // Gemini's provider deadline must be at least 10 seconds.
assert.equal(received.config.httpOptions.timeout, 10000); assert.equal(received.config.httpOptions.retryOptions.attempts, 1);
  assert.ok(received.config.responseJsonSchema); assert.equal(received.config.abortSignal.aborted, false);
});
test('client is reused and rebuilt when the configured key changes', async () => {
  const f = fixture(async () => ({ text: answer })); await f.run(); await f.run(); assert.equal(f.instances.length, 1);
  f.env.GEMINI_API_KEY = 'replacement-test-only'; await f.run(); assert.equal(f.instances.length, 2);
});
test('quota and overload errors propagate once without application retries', async () => {
  for (const status of [429, 503]) { let calls = 0; const failure = Object.assign(Error('provider'), { status });
    const f = fixture(async () => { calls++; throw failure; }); await assert.rejects(f.run(), error => error === failure); assert.equal(calls, 1);
  }
});
test('deadline aborts provider request and late output is ignored', async () => {
  let config, resolve; const f = fixture(request => { config = request; return new Promise(done => { resolve = done; }); });
  await assert.rejects(f.run(), error => error.name === 'AiDeadlineError'); assert.equal(config.config.abortSignal.aborted, true);
  resolve({ text: answer });
});
test('invalid model output is still rejected', async () => {
  const f = fixture(async () => ({ text: JSON.stringify({ action: 'DELETE_BOOKING' }) })); await assert.rejects(f.run(), /Invalid AI decision/);
});
test('mock mode bypasses provider and deadline entirely', async () => {
  const f = fixture(async () => { throw Error('must not call'); }); f.env.USE_MOCK_AI = 'true';
  assert.equal((await f.run()).action, 'CLARIFY'); assert.equal(f.instances.length, 0); assert.equal(f.timers(), 0);
});
test('timeout configuration is bounded with a safe default', async () => {
  for (const [value, expected] of [['5000', 10000], ['0', 10000], ['invalid', 10000], ['90000', 10000]]) {
    let timeout; const f = fixture(async config => { timeout = config.config.httpOptions.timeout; return { text: answer }; }); f.env.AI_RESPONSE_TIMEOUT_MS = value; await f.run(); assert.equal(timeout, expected);
  }
});
