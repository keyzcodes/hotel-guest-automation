const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(service, dependencies) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services', service + '.js'), 'utf8'), {
    module,
    process: { env: {} },
    console: { info() {}, warn() {} },
    require: name => name === './workflowTimeouts' ? { aiTimeouts: () => require('../src/services/workflowTimeouts').aiTimeouts({}) } : dependencies[name],
  });
  return module.exports;
}

const hotel = { name: 'Demo Hotel', wifi: { password: 'test-secret' }, services: { breakfast: { hours: '7–10 AM' } } };
const now = new Date('2026-11-09T14:00:00Z');
function fixture() {
  let rooms = [{ category: 'Standard' }, { category: 'Deluxe' }];
  const reads = [];
  let elapsed = 0;
  const availability = load('whatsappAvailability', {
    './roomInventory': { availableRooms: async dates => { reads.push(dates); return rooms; } },
  });
  const service = load('preStayGuestService', {
    './whatsappAvailability': availability,
    './guestAiService': {},
    './openaiGuestAi': { configuredBackup: () => undefined },
    'node:perf_hooks': { performance: { now: () => elapsed } },
  });
  return {
    reads,
    advanceClock: ms => { elapsed += ms; },
    updateInventory: value => { rooms = value; },
    ask: (text, decision, history = []) => service.answerPreStay({ text, history, hotel, now }, typeof decision === 'function' ? decision : async () => decision),
  };
}

test('pre-stay chat uses the model for normal phrasing and supplies context to follow-ups', async () => {
  const f = fixture();
  const text = 'Hi, do you have a room for two this Friday?';
  const first = await f.ask(text, async ({ context, model, timeoutMs }) => {
    assert.equal(model, 'gemini-3.1-flash-lite');
    assert.equal(timeoutMs, 7200);
    assert.equal(context.latestGuestMessage, text);
    assert.equal(context.today, '2026-11-09');
    assert(!JSON.stringify(context).includes('test-secret'));
    return { action: 'CLARIFY', bookingEnquiry: true, reply: 'How many nights are you staying?' };
  });
  assert.equal(first.reply, 'How many nights are you staying?');
  const result = await f.ask('Two nights', async ({ context }) => {
    assert.equal(context.history[0].text, text);
    return { action: 'CHECK_AVAILABILITY', bookingEnquiry: true, arrivalDate: '2026-11-13', departureDate: '2026-11-15' };
  }, [{ direction: 'INBOUND', text }, { direction: 'OUTBOUND', text: first.reply }]);
  assert.match(result.reply, /Deluxe, Standard/);
  assert.equal(f.reads[0].arrivalAt.toISOString(), '2026-11-13T13:00:00.000Z');
  assert.equal(result.dates.departureAt.toISOString(), '2026-11-15T11:00:00.000Z');
  assert.equal(f.reads.length, 1);
});

test('a follow-up check reads changed inventory and renders availability from the database result', async () => {
  const f = fixture();
  const decision = { action: 'CHECK_AVAILABILITY', bookingEnquiry: true, arrivalDate: '2026-11-13', departureDate: '2026-11-15', category: 'Standard', reply: 'Made up price and confirmed room' };
  assert.match((await f.ask('Any Standard?', decision)).reply, /Standard/);
  f.updateInventory([{ category: 'Deluxe' }]);
  const reply = (await f.ask('Is that one still free?', decision)).reply;
  assert.match(reply, /Deluxe/);
  assert.doesNotMatch(reply, /Made up|Standard/);
  assert.equal(f.reads.length, 2);
});

test('hotel facts come from approved fields, and bad dates and provider failures produce a reply', async () => {
  const f = fixture();
  const fact = await f.ask('What time is breakfast?', { action: 'HOTEL_INFO', bookingEnquiry: false, factKeys: ['breakfast', 'unknown', 'wifi'] });
  assert.equal(fact.reply, 'Breakfast is served 7–10 AM.');
  const invalid = await f.ask('Do you have a room then?', { action: 'CHECK_AVAILABILITY', bookingEnquiry: true, arrivalDate: '2026-11-31', departureDate: '2026-12-01' });
  assert.equal(invalid.action, 'CLARIFY');
  assert.equal(f.reads.length, 0);
  const failure = await f.ask('Can I get a room?', async () => { throw new Error('Provider unavailable'); });
  assert.equal(failure.action, 'HANDOFF');
  assert.equal(failure.fallback, true);
  assert.match(failure.reply, /try again shortly/);
});

test('a Gemini 504 gets one retry with the remaining budget and the guest’s booking context', async () => {
  const f = fixture();
  const attempts = [];
  const history = [
    { direction: 'INBOUND', text: 'I want to stay Friday to Sunday' },
    { direction: 'OUTBOUND', text: 'I’m having trouble replying right now. Please try again shortly, or contact reception if it’s urgent.' },
  ];
  const result = await f.ask('What rooms do you have?', async request => {
    attempts.push(request);
    if (attempts.length === 1) {
      f.advanceClock(7000);
      throw Object.assign(new Error('Provider timeout'), { status: 504 });
    }
    return { action: 'CHECK_AVAILABILITY', bookingEnquiry: true, arrivalDate: '2026-11-13', departureDate: '2026-11-15' };
  }, history);

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].timeoutMs, 7200);
  assert.equal(attempts[1].timeoutMs, 5000);
  assert.equal(attempts[1].context.history.length, 1);
  assert.equal(attempts[1].context.history[0].text, history[0].text);
  assert.equal(f.reads.length, 1);
  assert.match(result.reply, /Deluxe, Standard/);
});

test('provider timeouts stop after two attempts and quota errors are not retried', async () => {
  for (const [status, expected] of [[504, 2], [429, 1]]) {
    const f = fixture();
    let attempts = 0;
    const result = await f.ask('Any rooms?', async () => {
      attempts++;
      throw Object.assign(new Error('Provider failure'), { status });
    });
    assert.equal(attempts, expected);
    assert.equal(result.fallback, true);
    assert.equal(f.reads.length, 0);
  }
});

test('an unlinked WhatsApp message receives the pre-stay answer and saves it once', async () => {
  const saved = [];
  const replies = [];
  const existingHistory = [{ direction: 'INBOUND', text: 'I want to visit soon' }];
  const Message = {
    async create(record) {
      if (saved.some(message => message.idempotencyKey === record.idempotencyKey)) {
        throw Object.assign(new Error('Duplicate message'), { code: 11000 });
      }
      const message = { ...record, _id: String(saved.length), createdAt: new Date(), async save() {} };
      saved.push(message);
      return message;
    },
    find(filter) {
      assert.equal(filter.chatId, 'test-sender');
      assert.equal(filter.bookingId, null);
      return { sort: () => ({ limit: () => ({ select: () => ({ lean: async () => existingHistory }) }) }) };
    },
  };
  const module = { exports: {} };
  const dependencies = {
    '../models/Message': Message,
    '../models/Booking': { find: () => ({ limit: async () => [] }) },
    '../config/hotel': hotel,
    './guestAiService': {},
    './guestFallbackService': {},
    './whatsappAvailability': { enquiryWindowMs: 1800000 },
    './preStayGuestService': {
      async answerPreStay({ text, history }) {
        assert.equal(text, 'What time do you serve breakfast?');
        assert.equal(history[0].text, existingHistory[0].text);
        return { action: 'ANSWER', bookingEnquiry: false, reply: 'Breakfast is served 7–10 AM.' };
      },
    },
    './responseTimingService': require('../src/services/responseTimingService'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/guestMessageService.js'), 'utf8'), {
    module,
    console: { error() {} },
    process: { env: { WHATSAPP_AVAILABILITY_ENABLED: 'true', ROOM_BOARD_ENABLED: 'true' } },
    require: name => name === './workflowTimeouts' ? { aiTimeouts: () => require('../src/services/workflowTimeouts').aiTimeouts({}) } : dependencies[name],
  });
  const context = {
    channel: 'WHATSAPP',
    chat: { id: 'test-sender' },
    message: { text: 'What time do you serve breakfast?', message_id: 'test-message' },
    async reply(text) { replies.push(text); return { message_id: 'test-reply' }; },
  };
  await module.exports.processGuestMessage(context);
  await module.exports.processGuestMessage(context);
  assert.deepEqual(replies, ['Breakfast is served 7–10 AM.']);
  assert.equal(saved[0].processingStatus, 'PROCESSED');
  assert.equal(saved[0].bookingEnquiry, false);
  assert.equal(saved[1].deliveryState, 'SENT');
});
