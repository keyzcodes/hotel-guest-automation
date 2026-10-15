const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ai = require('../src/services/guestAiService');
const target = { _id: '6ac8137871bc7659ff310cbe', category: 'F&B', status: 'Pending', requestText: 'Rice and fish', guestUpdates: [] };
const decision = { action: 'STATUS', category: 'F&B', ticketId: target._id, reply: '' };
function fixture(status = 'Pending', missing = false) {
  let filter, writes = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/guestMessageService.js'), 'utf8'), {
    module, console, Date,
    require(name) {
      if (name === './guestAiService') return ai;
      if (name === './guestFallbackService') return {};
      if (name.endsWith('/TaskTicket')) return {
        findOne(query) { filter = query; return { select() { return { lean: async () => missing ? null : { ...target, status } }; } }; },
        findOneAndUpdate() { writes++; throw Error('Unexpected write'); },
        updateOne() { writes++; throw Error('Unexpected write'); },
      };
      return {};
    },
  });
  return { run: (d = decision) => module.exports.applyDecision(d, { _id: 'inbound', text: 'When will it be ready?' }, { _id: 'current-stay' }, [target]), filter: () => filter, writes: () => writes };
}
test('status question reads the exact request in the current stay without any task write', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(f.filter().bookingId, 'current-stay'); assert.equal(f.filter()._id, target._id);
  assert.equal(result.needsStaff, false); assert.equal(result.ticketId, target._id);
  assert.match(result.reply, /awaiting staff confirmation/); assert.match(result.reply, /hasn't been confirmed/);
  assert.equal(f.writes(), 0);
});
test('status answers reflect a state changed after interpretation, without invented delivery times', async () => {
  for (const [status, text] of [['In Progress', /in progress/], ['Escalated', /further staff review/], ['Resolved', /marked as completed/]]) {
    const f = fixture(status); const result = await f.run(); assert.match(result.reply, text); assert.equal(f.writes(), 0); assert.equal(result.needsStaff, false);
  }
});
test('deleted request asks for clarification without a replacement task', async () => {
  const f = fixture('Pending', true); const result = await f.run(); assert.equal(result.ticketId, null); assert.match(result.reply, /Which request/); assert.equal(f.writes(), 0);
});
test('status cannot read a ticket absent from the supplied context', async () => {
  const f = fixture(); await assert.rejects(f.run({ ...decision, ticketId: 'foreign-ticket' }), /unavailable ticket/); assert.equal(f.filter(), undefined); assert.equal(f.writes(), 0);
});
test('status action requires a supplied ticket while new service action cannot carry one', () => {
  assert.throws(() => ai.validateDecision({ ...decision, ticketId: '' }, [target]));
  assert.throws(() => ai.validateDecision({ ...decision, action: 'CREATE_REQUEST' }, [target]));
});
test('provider receives dining clarification and status semantics with unchanged original guest wording', async () => {
  let request;
  const text = 'I am hungry';
  const result = await ai.interpretGuestMessage({ text, hotel: {}, booking: {}, history: [], tickets: [target] }, {
    models: { generateContent: async payload => {
      request = payload;
      return { text: JSON.stringify({ action: 'CLARIFY', category: 'F&B', ticketId: '', reply: 'Would you like to order something, or check your existing meal request?' }) };
    } },
  });
  assert.equal(result.action, 'CLARIFY');
  assert.equal(JSON.parse(request.contents).latestGuestMessage, text);
  assert.ok(request.config.responseJsonSchema.properties.action.enum.includes('STATUS'));
  assert.match(request.config.systemInstruction, /An appetite, preference or feeling is not enough/);
  assert.match(request.config.systemInstruction, /Do not use FOLLOW_UP for a status-only question/);
});

test('completed request is valid for STATUS but remains forbidden for FOLLOW_UP', () => {
  const completed = { ...target, status: 'Resolved' };
  assert.equal(ai.validateDecision(decision, [completed]).action, 'STATUS');
  assert.throws(() => ai.validateDecision({ ...decision, action: 'FOLLOW_UP' }, [completed]), /unavailable ticket/);
});
test('completed and open request context are separated for the provider', async () => {
  let payload;
  await ai.interpretGuestMessage({ text: 'Was my meal completed?', hotel: {}, booking: {}, history: [], tickets: [target, { ...target, _id: 'completed-id', status: 'Resolved' }] }, {
    models: { generateContent: async value => { payload = JSON.parse(value.contents); return { text: JSON.stringify(decision) }; } },
  });
  assert.equal(payload.openTickets.length, 1);
  assert.equal(payload.recentCompletedTickets.length, 1);
  assert.equal(payload.recentCompletedTickets[0].id, 'completed-id');
  assert.equal(payload.recentCompletedTickets[0].status, 'Resolved');
});
