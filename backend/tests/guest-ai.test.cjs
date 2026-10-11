const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const aiService = require('../src/services/guestAiService');
const ticket = { _id: '6ac8137871bc7659ff310cbe', status: 'Pending', category: 'Housekeeping', requestText: 'Bring two towels' };
const base = { action: 'ANSWER', category: 'General Inquiry', ticketId: '', reply: 'Hello! How can we help?' };
const context = { text: 'Hi', hotel: { name: 'Demo Hotel' }, booking: { _id: 'stay1', roomNumber: '101' }, history: [{ direction: 'INBOUND', text: 'Bring two towels', createdAt: '2026-10-10T12:00:00Z' }], tickets: [ticket] };
function executor({ closed = false } = {}) {
  let writes = 0, filter, update;
  const TaskTicket = { init: async () => {}, findOneAndUpdate: async (f,u) => { writes++; filter=f; update=u; return closed ? null : { _id: ticket._id }; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/guestMessageService.js'), 'utf8'), { module, console, Date, require(name) {
    if (name === './guestAiService') return aiService;
    if (name === './guestFallbackService') return require('../src/services/guestFallbackService');
    if (name.endsWith('/TaskTicket')) return TaskTicket;
    if (name.endsWith('/Message') || name.endsWith('/Booking') || name.endsWith('/hotel')) return {};
    throw new Error(name);
  } });
  return { apply: decision => module.exports.applyDecision(decision, { _id: 'source1', text: 'Please bring them at 8 PM', chatId: 'verified-chat' }, { _id: 'stay1', guestName: 'Guest', roomNumber: '101' }, [ticket]), get writes() { return writes; }, get filter() { return filter; }, get update() { return update; } };
}
test('greeting answer validates', () => assert.equal(aiService.validateDecision(base, [ticket]).action, 'ANSWER'));
test('invalid actions and unknown extra privileges are rejected', () => {
  assert.throws(() => aiService.validateDecision({ ...base, action: 'APPROVE_EXTENSION' }, [ticket]));
  assert.throws(() => aiService.validateDecision({ ...base, roomNumber: '999' }, [ticket]));
});
test('unknown department, empty reply, oversized reply rejected', () => {
  assert.throws(() => aiService.validateDecision({ ...base, category: 'Security' }, [ticket]));
  assert.throws(() => aiService.validateDecision({ ...base, reply: ' ' }, [ticket]));
  assert.throws(() => aiService.validateDecision({ ...base, reply: 'x'.repeat(3001) }, [ticket]));
});
test('foreign or resolved ticket targets rejected', () => {
  assert.throws(() => aiService.validateDecision({ ...base, action: 'FOLLOW_UP', ticketId: 'other', reply: '' }, [ticket]));
  assert.throws(() => aiService.validateDecision({ ...base, action: 'FOLLOW_UP', ticketId: ticket._id, reply: '' }, [{ ...ticket, status: 'Resolved' }]));
});
test('non-follow-up action cannot carry a target ID', () => assert.throws(() => aiService.validateDecision({ ...base, ticketId: ticket._id }, [ticket])));
test('ANSWER and CLARIFY create no staff tickets', async () => {
  const s = executor(); assert.equal((await s.apply(base)).needsStaff, false);
  await s.apply({ ...base, action: 'CLARIFY', reply: 'Which request do you mean?' }); assert.equal(s.writes, 0);
});
test('new request uses trusted booking identity and raw guest text', async () => {
  const s = executor(); await s.apply({ action: 'CREATE_REQUEST', category: 'Housekeeping', ticketId: '', reply: '' });
  assert.equal(s.writes, 1); assert.equal(s.update.$setOnInsert.roomNumber, '101'); assert.equal(s.update.$setOnInsert.bookingId, 'stay1'); assert.equal(s.update.$setOnInsert.requestText, 'Please bring them at 8 PM'); assert.equal(s.update.$setOnInsert.status, 'Pending');
});
test('FOLLOW_UP scopes update to current stay, retains pending review, no new ticket', async () => {
  const s = executor(); const outcome = await s.apply({ action: 'FOLLOW_UP', category: 'Housekeeping', ticketId: ticket._id, reply: '' });
  assert.equal(s.writes, 1); assert.equal(s.filter.bookingId, 'stay1'); assert.equal(s.filter._id, ticket._id);
  assert.equal(s.update.$push.guestUpdates.messageId, 'source1'); assert.equal(s.update.$set, undefined); assert.equal(s.update.$setOnInsert, undefined); assert.match(outcome.reply, /not confirmed/);
});
test('request closed during interpretation asks for clarification', async () => {
  const s = executor({ closed: true }); const outcome = await s.apply({ action: 'FOLLOW_UP', category: 'Housekeeping', ticketId: ticket._id, reply: '' }); assert.equal(outcome.needsStaff, false); assert.match(outcome.reply, /which request/);
});
test('HANDOFF makes a pending request, never changes the stay', async () => {
  const s = executor(); await s.apply({ action: 'HANDOFF', category: 'Front Desk', ticketId: '', reply: '' }); assert.equal(s.update.$setOnInsert.status, 'Pending'); assert.equal(s.update.$setOnInsert.stayStatus, undefined);
});
test('Gemini call receives history and structured schema, then validates', async () => {
  let payload;
  const result = await aiService.interpretGuestMessage(context, { models: { generateContent: async p => { payload = p; return { text: JSON.stringify(base) }; } } });
  assert.equal(result.action, 'ANSWER'); assert.match(payload.config.systemInstruction, /untrusted data/); assert.equal(payload.config.responseMimeType, 'application/json');
  const sent = JSON.parse(payload.contents); assert.equal(sent.history[0].text, 'Bring two towels'); assert.equal(sent.openTickets[0].id, ticket._id); assert.equal(sent.booking.guestPhone, undefined);
});
test('malformed model output is rejected rather than executed', async () => assert.rejects(aiService.interpretGuestMessage(context, { models: { generateContent: async () => ({ text: 'not JSON' }) } })));
test('mock greeting creates no request; mock does not impersonate live AI', () => {
  assert.equal(aiService.mockDecision('Hi!').action, 'ANSWER'); assert.equal(aiService.mockDecision('Please bring towels').action, 'CLARIFY');
});
