const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const Reservation = require('../src/models/Reservation');
const Enquiry = require('../src/models/BookingEnquiry');
const Message = require('../src/models/Message');
const settings = require('../src/services/bookingWorkflowSettings');
const workflow = require('../src/services/bookingWorkflowService');
const transport = require('../src/services/whatsappService');
const delivery = require('../src/services/bookingDecisionDelivery');

const uri = process.env.PMS_TEST_URI;
const now = Date.now();
const dates = {
  arrivalDate: new Date(now + 7 * 86400000).toISOString().slice(0, 10),
  departureDate: new Date(now + 9 * 86400000).toISOString().slice(0, 10),
};

test('MongoDB persists enquiries and atomically approves and queues one booking under contention', {
  skip: !uri, timeout: 60000,
}, async t => {
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  const profile = {
    checkInTime: '14:00', checkOutTime: '12:00', currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
    roomRates: [{ category: 'Standard', capacity: 2, nightlyMinor: 6500000 }],
  };
  t.mock.method(settings, 'enabled', () => true);
  t.mock.method(settings, 'load', async () => profile);
  t.mock.method(transport, 'isConnected', () => true);
  const sent = [];
  t.mock.method(transport, 'sendStaffReply', async (jid, text) => {
    sent.push({ jid, text });
    return { message_id: `test-${sent.length}` };
  });
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
    await Promise.all([Room.init(), Booking.init(), Reservation.init(), Enquiry.init(), Message.init()]);
    await mongoose.connection.db.collection('hotelSettings').insertOne({ _id: settings.hotelId, ...profile });
    await Room.create({ number: '101', category: 'Standard', housekeeping: 'READY' });
    const jid = '2348000000001@s.whatsapp.net';
    const guest = async (text, decision) => (await workflow.forGuest(jid, text)).handle(decision);
    await guest('Room next week', { intent: 'DETAILS', ...dates });
    await guest('Two', { intent: 'DETAILS', guests: 2 });
    const quoted = await Enquiry.findOne({ chatId: jid }).lean();
    assert.equal(quoted.state, 'QUOTED');
    assert.equal(quoted.quote.totalMinor, 13000000);
    await guest('Book it, Ada Okafor', { intent: 'ACCEPT', guestName: 'Ada Okafor' });
    await guest('Book it again', { intent: 'ACCEPT' });
    assert.equal(await Enquiry.countDocuments({ chatId: jid }), 1);
    assert.equal(await Reservation.countDocuments(), 0);
    const secondJid = '2348000000002@s.whatsapp.net';
    const second = async decision => (await workflow.forGuest(secondJid, 'Synthetic enquiry')).handle(decision);
    await second({ intent: 'DETAILS', ...dates, guests: 2 });
    await second({ intent: 'ACCEPT', guestName: 'Second Guest' });
    const other = await Enquiry.findOne({ chatId: secondJid }).lean();
    const pending = (await workflow.inbox()).find(item => item.chatId === jid);
    assert.equal(pending.state, 'PENDING');
    assert.equal(pending.details.guestName, 'Ada Okafor');
    assert.equal(pending.quote.depositMinor, 6500000);

    const decide = data => workflow.decide({ id: pending._id, version: pending.version, actor: 'staff-1', ...data });
    await assert.rejects(decide({ action: 'confirm' }), /Verify the required deposit/);
    assert.equal(await Message.countDocuments(), 0);
    await decide({ action: 'ask', question: 'Will you arrive after 8 p.m.?' });
    assert.equal((await workflow.inbox()).find(item => item.chatId === jid).state, 'NEEDS_DETAILS');
    await guest('Yes, about 9 p.m.', { intent: 'DETAILS' });
    const resumed = (await workflow.inbox()).find(item => item.chatId === jid);
    assert.equal(resumed.state, 'PENDING');
    assert.equal(resumed.guestAnswer, 'Yes, about 9 p.m.');

    const results = await Promise.allSettled(Array.from({ length: 4 }, () =>
      decide({ action: 'confirm', depositVerified: true, version: resumed.version })
    ));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.name, 'RoomConflict');
    const [reservation] = await Reservation.find().lean();
    assert.equal(await Reservation.countDocuments(), 1);
    const confirmed = (await workflow.inbox()).find(item => item.chatId === jid);
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.ok(confirmed.depositVerifiedAt);
    assert.equal(String(confirmed.reservationId), String(reservation._id));
    assert.equal(confirmed.deliveryState, 'PENDING');
    assert.match((await guest('Confirmed?', { intent: 'STATUS' })).reply, new RegExp(String(reservation._id)));
    // Spare inventory makes a duplicate reservation possible unless the enquiry guards prevent it.
    const spare = await Room.create({ number: '102', category: 'Standard' });
    const repeat = await Promise.all(Array.from({ length: 3 }, () => guest('Yes, confirm again', { intent: 'ACCEPT' })));
    for (const reply of repeat) assert.match(reply.reply, new RegExp(String(reservation._id)));
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const restarted = await promisify(execFile)(process.execPath, ['-e', `
      const mongoose = require('mongoose');
      require('./src/services/bookingWorkflowSettings').enabled = () => true;
      const workflow = require('./src/services/bookingWorkflowService');
      (async () => {
        await mongoose.connect(process.env.PMS_TEST_URI, { dbName: process.env.RESUME_TEST_DB });
        const saved = await workflow.forGuest(process.env.RESUME_TEST_JID, 'Confirm again');
        const outcome = await saved.handle({ intent: 'ACCEPT' });
        console.log(JSON.stringify({ reply: outcome.reply }));
        await mongoose.disconnect();
      })().catch(error => { console.error(error.message); process.exitCode = 1; });
    `], {
      cwd: require('node:path').join(__dirname, '..'), timeout: 15000,
      env: { ...process.env, PMS_TEST_URI: uri, RESUME_TEST_DB: dbName, RESUME_TEST_JID: jid },
    });
    assert.match(JSON.parse(restarted.stdout.trim()).reply, new RegExp(String(reservation._id)));
    assert.equal(await Reservation.countDocuments(), 1);
    assert.equal(await Enquiry.countDocuments({ chatId: jid }), 1);
    assert.equal(await Message.countDocuments({ idempotencyKey: { $regex: '^BOOKING_DECISION:' } }), 2);
    await Room.deleteOne({ _id: spare._id });

    delivery.start();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(poll); reject(Error('Decision was not submitted.')); }, 10000);
      const poll = setInterval(() => {
        if (sent.length === 2) { clearTimeout(timeout); clearInterval(poll); resolve(); }
      }, 25);
    });
    await delivery.stop();
    assert.equal(sent.filter(message => message.text.includes(String(reservation._id))).length, 1);
    assert.equal((await workflow.inbox()).find(item => item.chatId === jid).deliveryState, 'SENT');
    assert.equal(await Message.countDocuments({ deliveryState: 'SENT' }), 2);
    await assert.rejects(workflow.decide({
      id: other._id, version: other.version, actor: 'staff-1', action: 'confirm', depositVerified: true,
    }), /sold out/);
    assert.equal((await Enquiry.findById(other._id)).state, 'PENDING');
    assert.equal(await Reservation.countDocuments(), 1);

    await workflow.decide({ id: other._id, version: other.version, actor: 'staff-1', action: 'decline' });
    assert.equal((await Enquiry.findById(other._id)).state, 'DECLINED');
    assert.equal(await Message.countDocuments({ deliveryState: 'PENDING' }), 1);
  } finally {
    await delivery.stop();
    try {
      if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  }
});
