const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createResponseTiming } = require('../src/services/responseTimingService');
function fixture({ duplicate = false, linked = true, fallback = false, sendFails = false } = {}) {
  const rows = [], records = [], saves = []; let sends = 0;
  const booking = { _id: 'stay', roomNumber: '101' };
  const Message = {
    create: async data => { if (duplicate && data.direction === 'INBOUND') throw Object.assign(Error('duplicate'), { code: 11000 }); const record = { ...data, _id: `record-${records.length}`, save: async () => saves.push(record.deliveryState || record.processingStatus) }; records.push(record); return record; },
    updateOne: async (...args) => saves.push(args),
    find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) }),
  };
  const Booking = { find: () => ({ limit: async () => linked ? [booking] : [] }) };
  const TaskTicket = { find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) };
  const ai = { interpretGuestMessage: async () => { if (fallback) throw Error('provider'); return { action: 'ANSWER', reply: 'Hotel answer' }; }, validateDecision: value => value };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/guestMessageService.js'), 'utf8'), {
    module, console: { warn() {}, error() {} }, require: name => ({ '../models/Message': Message, '../models/Booking': Booking, '../models/TaskTicket': TaskTicket, '../config/hotel': {}, './guestAiService': ai, './guestFallbackService': { serviceFallback: () => ({ action: 'ANSWER', reply: 'Fallback answer' }) }, './responseTimingService': { createResponseTiming: () => createResponseTiming({ logger: row => rows.push(row) }) } }[name]),
  });
  const ctx = { chat: { id: 'private-chat' }, message: { text: 'private guest text', message_id: 1 }, reply: async () => { sends++; if (sendFails) throw Error('telegram'); return { message_id: 2 }; } };
  return { run: () => module.exports.processGuestMessage(ctx), rows, records, saves, sends: () => sends };
}
test('normal guest reply remains saved and sent with separate backend stage timings', async () => {
  const f = fixture(); await f.run(); assert.equal(f.sends(), 1); assert.equal(f.records[1].deliveryState, 'SENT');
  assert.deepEqual(f.rows[0].stages.map(s => s.stage), ['inbound_save', 'booking_lookup', 'booking_link_save', 'context_load', 'ai_interpretation', 'decision_apply', 'processing_result_save', 'reply_record_create', 'telegram_send', 'reply_record_confirm']);
  assert.equal(JSON.stringify(f.rows).includes('private'), false);
});
test('AI failure still uses existing fallback and retains failed AI timing', async () => {
  const f = fixture({ fallback: true }); await f.run(); assert.equal(f.records[1].text, 'Fallback answer');
  assert.equal(f.rows[0].outcome, 'local_fallback'); assert.equal(f.rows[0].stages.find(s => s.stage === 'ai_interpretation').result, 'error');
});
test('duplicate and unlinked exits are reported without introducing AI calls', async () => {
  for (const options of [{ duplicate: true }, { linked: false }]) { const f = fixture(options); await f.run(); assert.equal(f.rows.length, 1); assert.equal(f.rows[0].stages.some(s => s.stage === 'ai_interpretation'), false); assert.equal(f.sends(), 0); }
});
test('uncertain Telegram send is still not retried by instrumentation', async () => {
  const f = fixture({ sendFails: true }); await f.run(); assert.equal(f.sends(), 1); assert.equal(f.rows[0].stages.find(s => s.stage === 'telegram_send').result, 'error');
  assert.equal(f.saves.some(args => Array.isArray(args) && args[1].$set.deliveryState === 'UNKNOWN'), true);
});
