const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, scenarios } = require('../scripts/eval-enquiry-agent.cjs');
const { reviewBehaviour, validateReview } = require('../scripts/enquiry-behaviour-review.cjs');
const journey = { id: 'synthetic', turns: [{ text: 'Thanks', check: c => assert.equal(c.lookups, 0) }] };
const quiet = { log() {} };
const base = { mechanicsPassed: 0, behaviouralPassed: 0, behaviouralFailed: 0, reviewRequired: 0, failed: 0, blocked: 0, notRun: 0 };
const reply = message => ({ functionCalls: [{ name: 'replyToGuest', args: { message, resultIds: [] } }] });
const positive = async transcript => ({ turns: transcript.map(row => ({ turn: row.turn, verdict: 'PASS', reason: 'Acknowledges the guest without starting another task.', evidence: '' })) });

test('provider blocking remains separate and quota exhaustion stops remaining journeys', async () => {
  let calls = 0;
  const result = await evaluate({ selected: [journey], repeats: 3, gapMs: 0, log: quiet,
    provider: async () => { calls++; throw Object.assign(Error('Synthetic quota'), { status: 429 }); } });
  assert.deepEqual(result, { ...base, blocked: 1, notRun: 2 });
  assert.equal(calls, 1);
});

test('successful mechanics without a reviewer are explicitly unreviewed, not a conversation pass', async () => {
  const messages = [];
  const result = await evaluate({ selected: [journey], gapMs: 0, log: { log: text => messages.push(text) },
    provider: async () => reply('Always happy to help.') });
  assert.deepEqual(result, { ...base, mechanicsPassed: 1, reviewRequired: 1 });
  assert.ok(messages.some(row => row.includes('REVIEW_REQUIRED')));
  assert.equal(messages.some(row => /^PASS |PROVISIONAL_BEHAVIOUR_PASS/.test(row)), false);
  assert.ok(messages.some(row => row.includes('p95Ms')));
});

const observedReplies = [
  "Hello! I'd be happy to help you with your enquiry. To get started, could you let me know your preferred dates of stay and how many guests will be joining us?",
  'We offer a variety of rooms including Standard, Imperial, Luxury, and Junior Suite options. Could you please share your preferred dates and the number of guests so I can help you with availability and pricing?',
  "You're very welcome! Whenever you are ready, please let me know your preferred dates of stay and the number of guests, and I'll be happy to check availability and pricing for you.",
];
function observedProvider(request) {
  const guest = JSON.parse(request.contents[0].parts[0].text).latestGuestMessage;
  const index = guest.startsWith('Hi,') ? 0 : guest.startsWith('What room') ? 1 : 2;
  if (index === 1 && request.contents.length === 1) return { functionCalls: [{ name: 'getHotelInformation', args: { topic: 'ROOM_TYPES' } }] };
  const response = reply(observedReplies[index]);
  if (index === 1) response.functionCalls[0].args.resultIds = ['result_1'];
  return response;
}

test('the exact misleading-pass transcript cannot get a conversation pass without review', async () => {
  const result = await evaluate({ selected: [scenarios(new Date())[0]], gapMs: 0, log: quiet, provider: observedProvider });
  assert.deepEqual(result, { ...base, mechanicsPassed: 1, reviewRequired: 1 });
});

test('semantic failures can reject fluent paraphrases even when every mechanical check passes', async () => {
  const result = await evaluate({ selected: [scenarios(new Date())[0]], gapMs: 0, log: quiet, provider: observedProvider,
    reviewer: async transcript => {
      assert.equal(transcript.length, 3);
      assert.match(transcript[0].expectation, /Do not collect/);
      return { turns: transcript.map((row, index) => ({ turn: row.turn, verdict: 'FAIL',
        reason: 'Introduces unnecessary booking-detail collection instead of satisfying the current request.', evidence: observedReplies[index] })) };
    } });
  assert.deepEqual(result, { ...base, mechanicsPassed: 1, behaviouralFailed: 1, failed: 1 });
});

test('positive semantic judgement is explicitly provisional', async () => {
  const messages = [];
  const result = await evaluate({ selected: [journey], gapMs: 0, log: { log: text => messages.push(text) }, provider: async () => reply('You’re welcome.'), reviewer: positive });
  assert.deepEqual(result, { ...base, mechanicsPassed: 1, behaviouralPassed: 1 });
  assert.ok(messages.some(row => row.startsWith('PROVISIONAL_BEHAVIOUR_PASS')));
});

test('a judge timeout or malformed judgement cannot become a passing conversation', async () => {
  for (const reviewer of [async () => { throw Error('Judge timeout'); }, async () => ({ turns: [] }), async () => ({ turns: [{ turn: 1, verdict: 'PASS', reason: 'Fine', evidence: 'Invented text' }] })]) {
    const result = await evaluate({ selected: [journey], gapMs: 0, log: quiet, provider: async () => reply('You’re welcome.'), reviewer });
    assert.deepEqual(result, { ...base, mechanicsPassed: 1, reviewRequired: 1 });
  }
});

test('uncertain review remains pending and critic quota failure stops the remaining batch', async () => {
  const uncertain = await evaluate({ selected: [journey], gapMs: 0, log: quiet, provider: async () => reply('You’re welcome.'),
    reviewer: async () => ({ turns: [{ turn: 1, verdict: 'UNCERTAIN', reason: 'Insufficient context', evidence: '' }] }) });
  assert.equal(uncertain.reviewRequired, 1);
  const quota = await evaluate({ selected: [journey], repeats: 2, gapMs: 0, log: quiet, provider: async () => reply('You’re welcome.'),
    reviewer: async () => { throw Object.assign(Error('Synthetic quota'), { status: 429 }); } });
  assert.deepEqual(quota, { ...base, mechanicsPassed: 1, reviewRequired: 1, notRun: 1 });
});

test('critic reviews the full transcript in one bounded request without acting on hotel tools', async () => {
  const transcript = observedReplies.map((reply, index) => ({ turn: index + 1, guest: ['General enquiry', 'Room types', 'Thanks'][index], reply, expectation: 'Do not collect booking details.' }));
  const result = await reviewBehaviour(transcript, { model: 'synthetic-review-model', generate: async request => {
    assert.equal(request.model, 'synthetic-review-model'); assert.equal(request.timeoutMs, 20000); assert.equal(request.maxRetries, 0);
    assert.equal(request.config.tools, undefined);
    assert.equal(request.config.responseMimeType, 'application/json');
    assert.deepEqual(JSON.parse(request.contents[0].parts[0].text).transcript, transcript);
    return { text: JSON.stringify({ turns: transcript.map(row => ({ turn: row.turn, verdict: 'FAIL', reason: 'Premature booking questions', evidence: row.reply })) }) };
  } });
  assert.equal(result.verdict, 'FAIL'); assert.equal(result.turns.length, 3);
});

test('critic evidence must cover each turn once and quote genuine text for failures', () => {
  const transcript = [{ turn: 1, reply: 'Welcome.' }, { turn: 2, reply: 'Thanks.' }];
  const row = { turn: 1, verdict: 'FAIL', reason: 'Issue', evidence: 'Welcome.' };
  assert.throws(() => validateReview({ turns: [row, row] }, transcript));
  assert.throws(() => validateReview({ turns: [{ ...row, evidence: '' }, { ...row, turn: 2, evidence: 'Thanks.' }] }, transcript));
});
