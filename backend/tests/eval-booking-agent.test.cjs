const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, pacedGemini } = require('../scripts/eval-booking-agent.cjs');

const journey = { name: 'synthetic enquiry', turns: [['Can I ask something?', undefined, /what/i]] };
function capture() {
  const messages = [];
  const record = text => messages.push(text);
  return { messages, log: { log: record, warn: record, error: record } };
}

test('a 429 stops the run and reports remaining journeys as not run', async () => {
  const { messages, log } = capture();
  let calls = 0;
  const provider = pacedGemini(0, async () => {
    calls++;
    throw Object.assign(Error('rate limit'), { status: 429 });
  });
  const result = await evaluate({ repeats: 3, selected: [journey], provider, log });
  assert.deepEqual(result, { passed: 0, failed: 0, blocked: 1, skipped: 2 });
  assert.equal(calls, 1);
  assert.match(messages[0], /BLOCKED.*turn 1.*429/);
});

test('a conversation failure reports the turn and the actual synthetic reply', async () => {
  const { messages, log } = capture();
  const provider = pacedGemini(0, async () => ({
    action: 'ANSWER', bookingEnquiry: false, reply: 'Thanks.',
  }));
  const result = await evaluate({ repeats: 1, selected: [journey], provider, log });
  assert.deepEqual(result, { passed: 0, failed: 1, blocked: 0, skipped: 0 });
  assert.match(messages[0], /FAIL.*turn 1.*Can I ask something.*Reply: "Thanks\."/);
});
