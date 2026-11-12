const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');
const Reservation = require('../src/models/Reservation');
const TaskTicket = require('../src/models/TaskTicket');
const inventory = require('../src/services/roomInventory');
const summary = require('../src/services/demoGmSummary');
const delivery = require('../src/services/bookingDecisionDelivery');
const transport = require('../src/services/whatsappService');

function flags(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('demo summary configuration rejects a missing recipient or the wrong database', t => {
  flags(t, { WHATSAPP_DEMO_GM_SUMMARY_ENABLED: 'true', GUEST_CHANNEL: 'WHATSAPP',
    ROOM_BOARD_ENABLED: 'true', WHATSAPP_GM_SUMMARY_PHONE: '' });
  const previousName = mongoose.connection.name;
  t.after(() => { mongoose.connection.name = previousName; });
  mongoose.connection.name = 'sesora_whatsapp_lab';
  assert.throws(() => summary.initialize(), /WHATSAPP_GM_SUMMARY_PHONE/);
  process.env.WHATSAPP_GM_SUMMARY_PHONE = '2348000000099';
  mongoose.connection.name = 'another_property';
  assert.throws(() => summary.initialize(), /lab database/);
  process.env.WHATSAPP_DEMO_GM_SUMMARY_ENABLED = 'false';
  assert.doesNotThrow(() => summary.initialize());
});

const uri = process.env.PMS_TEST_URI;
test('checkout queues one factual GM summary and the delivery worker sends it to the configured test phone', {
  skip: !uri, timeout: 25000,
}, async t => {
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  flags(t, { WHATSAPP_DEMO_GM_SUMMARY_ENABLED: 'true', GUEST_CHANNEL: 'WHATSAPP',
    ROOM_BOARD_ENABLED: 'true', WHATSAPP_BOOKING_WORKFLOW_ENABLED: 'false',
    WHATSAPP_GM_SUMMARY_PHONE: '2348000000099' });
  let connected = false, failSend = false;
  const sent = [];
  t.mock.method(transport, 'isConnected', () => connected);
  t.mock.method(transport, 'sendStaffReply', async (jid, text) => {
    sent.push({ jid, text });
    if (failSend) throw Error('Synthetic uncertain send');
    return { message_id: 'summary-test-' + sent.length };
  });
  async function waitFor(filter) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if (await Message.exists(filter)) return;
      await delay(20);
    }
    assert.fail('Summary delivery state was not reached');
  }
  const stay = () => inventory.checkIn({
    roomNumber: '101', guestName: 'Demo Guest', guestPhone: '2348000000011',
    whatsappJid: '2348000000011@s.whatsapp.net', stayStatus: 'ACTIVE',
    checkInTime: new Date(Date.now() - 60000), checkOutTime: new Date(Date.now() + 86400000),
  });
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
    await Promise.all([Room.init(), Booking.init(), Reservation.init(), TaskTicket.init(), Message.init()]);
    await mongoose.connection.db.collection('hotelSettings').insertOne({ _id: 'kudu-demo', name: 'Kudu Demo' });
    await Room.create({ number: '101', category: 'Standard', housekeeping: 'READY' });
    const booking = await stay();
    await TaskTicket.create(['Resolved', 'Pending'].map(status => ({
      bookingId: booking._id, guestName: booking.guestName, roomNumber: '101',
      chatId: booking.whatsappJid, category: 'Housekeeping', requestText: 'Synthetic towel request', status,
    })));
    await TaskTicket.create({ guestName: 'Other guest', roomNumber: '102', chatId: 'other-chat',
      category: 'Housekeeping', requestText: 'Unrelated request', status: 'Resolved' });
    await Promise.all([inventory.checkOut(booking._id), inventory.checkOut(booking._id)]);
    await inventory.checkOut(booking._id);
    const filter = { idempotencyKey: 'DEMO_GM_SUMMARY:' + booking._id };
    assert.equal(await Message.countDocuments(filter), 1);
    const queued = await Message.findOne(filter).lean();
    assert.equal(queued.chatId, '2348000000099@s.whatsapp.net');
    assert.equal(queued.bookingId, null);
    assert.equal(queued.deliveryState, 'PENDING');
    assert.match(queued.text, /Guest — Demo Guest/);
    assert.match(queued.text, /2 service requests recorded/);
    assert.match(queued.text, /1 request marked completed by staff/);
    assert.match(queued.text, /1 request remains open for this stay/);
    assert.match(queued.text, /Awaiting cleaning — 1/);
    assert.match(queued.text, /Current room board · 1 rooms/);
    // Disabled booking workflows retain their own queued messages.
    await Message.create({ channel: 'WHATSAPP', direction: 'OUTBOUND', chatId: booking.whatsappJid,
      text: 'Disabled booking workflow', idempotencyKey: 'BOOKING_DECISION:disabled:1',
      deliveryState: 'PENDING', processingStatus: 'NOT_APPLICABLE' });
    delivery.start();
    await delay(30);
    await delivery.stop();
    assert.equal(sent.length, 0);
    connected = true;
    delivery.start();
    await waitFor({ ...filter, deliveryState: 'SENT' });
    await delivery.stop();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, '2348000000099@s.whatsapp.net');
    assert.equal((await Message.findOne({ idempotencyKey: 'BOOKING_DECISION:disabled:1' })).deliveryState, 'PENDING');

    await Room.updateOne({ number: '101' }, { $set: { housekeeping: 'READY' } });
    const second = await stay();
    // Failure to queue the summary rolls back checkout and room release together.
    process.env.WHATSAPP_GM_SUMMARY_PHONE = 'invalid';
    await assert.rejects(inventory.checkOut(second._id), /recipient is invalid/);
    assert.equal((await Booking.findById(second._id)).stayStatus, 'ACTIVE');
    assert.equal(String((await Room.findOne({ number: '101' })).activeBookingId), String(second._id));
    process.env.WHATSAPP_GM_SUMMARY_PHONE = '2348000000099';
    await inventory.checkOut(second._id);
    const secondFilter = { idempotencyKey: 'DEMO_GM_SUMMARY:' + second._id };
    failSend = true;
    delivery.start();
    await waitFor({ ...secondFilter, deliveryState: 'UNKNOWN' });
    await delivery.stop();
    delivery.start();
    await delay(30);
    await delivery.stop();
    assert.equal(sent.length, 2, 'Uncertain submissions must not be resent automatically');
    assert.equal(await Message.countDocuments(secondFilter), 1);
  } finally {
    await delivery.stop();
    if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});
