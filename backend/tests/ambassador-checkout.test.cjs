const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const Reservation = require('../src/models/Reservation');
const Message = require('../src/models/Message');
const Ticket = require('../src/models/TaskTicket');
const inventory = require('../src/services/roomInventory');
const settings = require('../src/services/bookingWorkflowSettings');
const delivery = require('../src/services/bookingDecisionDelivery');
const transport = require('../src/services/whatsappService');

test('Ambassador demo checkout sends a guest farewell and a separate accurate twelve-room GM report', {
  skip: !process.env.PMS_TEST_URI, timeout: 20000,
}, async t => {
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  const flags = { GUEST_CHANNEL: 'WHATSAPP', GUEST_MESSAGING_ENABLED: 'true', ROOM_BOARD_ENABLED: 'true',
    WHATSAPP_STAY_MESSAGES_ENABLED: 'true', WHATSAPP_DEMO_GM_SUMMARY_ENABLED: 'true',
    WHATSAPP_GM_SUMMARY_PHONE: '2348000000099', HOTEL_GUEST_NAME: 'Ambassador Hotel' };
  const old = Object.fromEntries(Object.keys(flags).map(key => [key, process.env[key]]));
  Object.assign(process.env, flags);
  t.after(() => { for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const sent = [];
  t.mock.method(transport, 'isConnected', () => true);
  t.mock.method(transport, 'sendStaffReply', async (jid, text) => {
    sent.push({ jid, text }); return { message_id: 'ambassador-demo-' + sent.length };
  });
  const checkIn = (roomNumber, phone, guestName) => inventory.checkIn({
    roomNumber, guestName, guestPhone: phone, whatsappJid: phone + '@s.whatsapp.net', stayStatus: 'ACTIVE',
    checkInTime: new Date(Date.now() - 60000), checkOutTime: new Date(Date.now() + 86400000),
  });
  try {
    await mongoose.connect(process.env.PMS_TEST_URI, { dbName, serverSelectionTimeoutMS: 8000 });
    await Promise.all([Room.init(), Booking.init(), Reservation.init(), Message.init(), Ticket.init()]);
    await mongoose.connection.db.collection('hotelSettings').insertOne({ _id: settings.hotelId, name: 'Kudu Demo Hotel' });
    assert.equal((await settings.load()).name, 'Ambassador Hotel');
    const numbers = ['101', '102', '103', '104', '105', '201', '202', '203', '301', '302', '401', '402'];
    await Room.create(numbers.map(number => ({ number, category: 'Demo category',
      housekeeping: ['102', '203'].includes(number) ? 'DIRTY' : 'READY', outOfOrder: number === '302' })));
    await checkIn('103', '2348000000103', 'Background guest A');
    await checkIn('402', '2348000000402', 'Background guest B');
    const stay = await checkIn('101', '2348000000101', 'Sunday Demo');
    await Ticket.create({ bookingId: stay._id, guestName: stay.guestName, chatId: stay.whatsappJid,
      roomNumber: '101', category: 'Housekeeping', requestText: 'Two towels', status: 'Resolved' });
    await Promise.all([inventory.checkOut(stay._id), inventory.checkOut(stay._id)]);
    await inventory.checkOut(stay._id);
    const keys = ['WHATSAPP_FAREWELL:' + stay._id, 'DEMO_GM_SUMMARY:' + stay._id];
    const messages = await Message.find({ idempotencyKey: { $in: keys } }).lean();
    assert.equal(messages.length, 2);
    const farewell = messages.find(item => item.idempotencyKey.startsWith('WHATSAPP_FAREWELL:'));
    const report = messages.find(item => item.idempotencyKey.startsWith('DEMO_GM_SUMMARY:'));
    assert.equal(farewell.chatId, stay.whatsappJid);
    assert.equal(String(farewell.bookingId), String(stay._id));
    assert.match(farewell.text, /Thank you for staying with Ambassador Hotel/);
    assert.match(farewell.text, /Sunday Demo/);
    assert.match(farewell.text, /Room 101/);
    assert.equal(report.chatId, '2348000000099@s.whatsapp.net');
    assert.equal(report.bookingId, null);
    assert.match(report.text, /Ambassador Hotel/);
    assert.match(report.text, /1 service request recorded/);
    assert.match(report.text, /0 requests remain open for this stay/);
    assert.match(report.text, /Current room board · 12 rooms/);
    assert.match(report.text, /Ready — 6\*\n104 · 105 · 201 · 202 · 301 · 401/);
    assert.match(report.text, /Occupied — 2\*\n103 · 402/);
    assert.match(report.text, /Awaiting cleaning — 3\*\n101 · 102 · 203/);
    assert.match(report.text, /Out of service — 1\*\n302/);
    assert.doesNotMatch(farewell.text + report.text, /Kudu/);
    delivery.start();
    const until = Date.now() + 7000;
    while (Date.now() < until && await Message.countDocuments({ idempotencyKey: { $in: keys }, deliveryState: 'SENT' }) < 2) {
      await delay(20);
    }
    await delivery.stop();
    assert.equal(sent.length, 2);
    assert.equal(sent[0].jid, stay.whatsappJid);
    assert.equal(sent[1].jid, report.chatId);
    assert.equal(await Message.countDocuments({ idempotencyKey: { $in: keys }, deliveryState: 'SENT' }), 2);
  } finally {
    await delivery.stop();
    if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});
