const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizePhone, senderJid } = require('../src/services/whatsappIdentity');
test('phone normalization rejects fake identities and group senders', () => {
  assert.equal(normalizePhone('0801 234 5678'), '2348012345678');
  assert.equal(normalizePhone('+234 801 234 5678'), '2348012345678');
  assert.equal(normalizePhone('+44 7700 900123'), '447700900123');
  for (const input of ['abc2348012345678', '', '+0', null]) assert.equal(normalizePhone(input), null);
  assert.equal(senderJid({ remoteJid: '12345@lid' }), null);
  assert.equal(senderJid({ remoteJid: '2348012345678@g.us' }), null);
  assert.equal(senderJid({ remoteJid: '12345@lid', remoteJidAlt: '2348012345678@s.whatsapp.net' }), '2348012345678@s.whatsapp.net');
  assert.equal(senderJid({ remoteJid: '2348012345678@s.whatsapp.net', fromMe: true }), null);
});
function fixture(ownerCount = 1) {
  const records = [], tickets = [], replies = [], lookups = [], updates = [];
  const booking = { _id: 'stay-1', roomNumber: '203', guestName: 'Test Guest' };
  const messageIds = new Set();
  const Message = {
    async create(data) {
      if (messageIds.has(data.idempotencyKey)) throw Object.assign(Error(), { code: 11000 });
      messageIds.add(data.idempotencyKey);
      const result = { ...data, _id: 'msg-' + records.length, async save() {} };
      records.push(result); return result;
    },
    async updateOne(filter, update) { updates.push(update); },
    find() { return { select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) }; }
  };
  const TaskTicket = {
    async init() {},
    async findOneAndUpdate(filter, update) {
      let ticket = tickets.find(item => item.sourceMessageId === filter.sourceMessageId);
      if (!ticket) { ticket = { ...update.$setOnInsert, _id: 'task-1' }; tickets.push(ticket); }
      return ticket;
    },
    find() { return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) }; }
  };
  const Booking = { find(filter) { lookups.push(filter); return { limit: async () => Array.from({ length: ownerCount }, (_, i) => ({ ...booking, _id: 'stay-' + (i+1) })) }; } };
  const module = { exports: {} };
  const deps = {
    '../models/Message': Message, '../models/Booking': Booking, '../models/TaskTicket': TaskTicket, '../config/hotel': {},
    './guestAiService': { interpretGuestMessage: async () => ({ action: 'CREATE_REQUEST', category: 'Housekeeping', reply: '' }), validateDecision: value => value },
    './guestFallbackService': { serviceFallback: () => null },
    './responseTimingService': { createResponseTiming: () => ({ measure: (_stage, fn) => fn(), setOutcome() {}, finish() {} }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/guestMessageService.js'), 'utf8'), { module, require: name => deps[name], console });
  return { records, tickets, replies, lookups, updates, run: (reviewOnly = false) => module.exports.processGuestMessage({
    channel: 'WHATSAPP', chat: { id: '2348012345678@s.whatsapp.net' },
    message: { text: 'Please send towels', message_id: 'provider-1' }, reviewOnly,
    reply: async text => { replies.push(text); return { message_id: 'sent-1' }; }
  }) };
}
test('WhatsApp request matches the stay and deduplicates replayed messages', async () => {
  const f = fixture(); await f.run(); await f.run();
  assert.equal(f.lookups[0].whatsappJid, '2348012345678@s.whatsapp.net');
  assert.equal(f.tickets.length, 1);
  assert.equal(f.tickets[0].bookingId, 'stay-1');
  assert.equal(f.tickets[0].roomNumber, '203');
  assert.equal(f.replies.length, 1);
  assert.equal(f.records[0].channel, 'WHATSAPP');
  assert.equal(f.records[1].deliveryState, 'SENT');
});
test('unknown, ambiguous and review-only messages cannot create room requests', async () => {
  for (const [owners, review] of [[0,false], [2,false], [1,true]]) {
    const f = fixture(owners); await f.run(review);
    assert.equal(f.tickets.length, 0); assert.equal(f.replies.length, 0);
    assert.equal(f.records[0].bookingId, undefined);
    assert.equal(f.updates[0].$set.processingStatus, 'NEEDS_STAFF');
  }
});
test('encrypted session survives roundtrip and rejects wrong keys and modified ciphertext', async () => {
  const { sessionCodec } = await import('../src/services/whatsappSessionCodec.mjs');
  const { BufferJSON } = await import('@whiskeysockets/baileys');
  const codec = sessionCodec('a'.repeat(64), BufferJSON);
  const data = { creds: { key: Buffer.from([1,2,3]) }, keys: {} };
  const encrypted = codec.seal(data);
  assert.deepEqual(codec.open(encrypted), data);
  assert.throws(() => sessionCodec('b'.repeat(64), BufferJSON).open(encrypted));
  const tampered = Buffer.from(encrypted, 'base64'); tampered[30] ^= 1;
  assert.throws(() => codec.open(tampered.toString('base64')));
});
function checkinFixture(duplicate = false) {
  const created = [], scheduled = [];
  const dependencies = {
    mongoose: {},
    '../models/Booking': { exists: async () => duplicate, create: async data => { created.push(data); return { ...data, _id: 'new-stay' }; } },
    '../models/ScheduledJob': {},
    '../services/schedulingService': { scheduleCheckInJobs: async () => scheduled.push(true) },
    '../services/guestChannel': { whatsapp: () => true },
    '../services/whatsappIdentity': require('../src/services/whatsappIdentity')
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/bookingController.js'), 'utf8'), {
    module, require: name => dependencies[name], console, process: { env: {} }
  });
  return { created, scheduled, async run(phone) {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await module.exports.checkInGuest({ body: { guestName: 'Test Guest', guestPhone: phone, roomNumber: '203', telegramChatId: 'old-chat', checkOutTime: new Date(Date.now()+86400000).toISOString() } }, response);
    return response;
  }};
}
test('WhatsApp check-in saves normalized identity and schedules no unsupported reminders', async () => {
  const f = checkinFixture();
  const response = await f.run('0801 234 5678');
  assert.equal(response.code, 201);
  assert.equal(f.created[0].guestPhone, '2348012345678');
  assert.equal(f.created[0].whatsappJid, '2348012345678@s.whatsapp.net');
  assert.equal(f.created[0].telegramChatId, null);
  assert.equal(response.data.requestMessagingReady, true);
  assert.equal(response.data.automationScheduled, false);
  assert.equal(f.scheduled.length, 0);
});
test('invalid number and existing active WhatsApp stay cannot create a new check-in', async () => {
  const invalid = checkinFixture();
  assert.equal((await invalid.run('not a number')).code, 400);
  assert.equal(invalid.created.length, 0);
  const duplicate = checkinFixture(true);
  assert.equal((await duplicate.run('08012345678')).code, 409);
  assert.equal(duplicate.created.length, 0);
});
