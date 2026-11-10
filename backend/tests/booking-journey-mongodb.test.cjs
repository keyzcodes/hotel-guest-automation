const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const express = require('express');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const Reservation = require('../src/models/Reservation');
const Enquiry = require('../src/models/BookingEnquiry');
const Message = require('../src/models/Message');
const settings = require('../src/services/bookingWorkflowSettings');
const ai = require('../src/services/guestAiService');
const transport = require('../src/services/whatsappService');
const delivery = require('../src/services/bookingDecisionDelivery');

const uri = process.env.PMS_TEST_URI;
const ahead = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const jid = '2348000000010@s.whatsapp.net';

test('WhatsApp booking reaches a PMS reservation and queues its confirmation after staff approval', {
  skip: !uri, timeout: 25000,
}, async t => {
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  const checkIn = ahead(7);
  const sent = [];
  const decisions = new Map([
    ['I need a room for myself for one night.', { action: 'BOOKING_DETAILS', guests: 1, nights: 1 }],
    ['I arrive next week.', { action: 'BOOKING_DETAILS', arrivalDate: checkIn }],
    ['Can I stay two more nights?', { action: 'BOOKING_DETAILS', extraNights: 2 }],
    ['Hey', null],
    ['Hey, I might arrive after dinner.', null],
    ['I accept. Put it under Ada Demo.', { action: 'BOOKING_ACCEPT', guestName: 'Ada Demo' }],
  ]);
  t.mock.method(ai, 'generateStructuredReply', async ({ context }) => {
    if (context.trustedResult) return { reply: context.trustedResult };
    const choice = decisions.get(context.latestGuestMessage);
    assert.notEqual(choice, undefined);
    if (!choice) throw Object.assign(Error('Synthetic Gemini overload'), { status: 503 });
    return { bookingEnquiry: true, ...choice };
  });
  t.mock.method(settings, 'enabled', () => true);
  t.mock.method(transport, 'isConnected', () => true);
  t.mock.method(transport, 'sendStaffReply', async (chat, text) => {
    sent.push({ chat, text });
    return { message_id: 'test-confirmation' };
  });
  const flags = {
    WHATSAPP_AVAILABILITY_ENABLED: 'true', ROOM_BOARD_ENABLED: 'true',
    WHATSAPP_BOOKING_WORKFLOW_ENABLED: 'true', WHATSAPP_OPENAI_FAILOVER_ENABLED: 'false',
    USE_MOCK_AI: 'false',
  };
  const old = Object.fromEntries(Object.keys(flags).map(key => [key, process.env[key]]));
  Object.assign(process.env, flags);
  const { processGuestMessage } = require('../src/services/guestMessageService');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.staffSession = { _id: 'test-staff' }; next(); });
  app.use('/conversations', require('../src/routes/conversationRoutes'));
  let server;
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
    await Promise.all([Room.init(), Booking.init(), Reservation.init(), Enquiry.init(), Message.init()]);
    const hotelSettings = mongoose.connection.db.collection('hotelSettings');
    await hotelSettings.insertOne({
      _id: settings.hotelId, checkInTime: '14:00', checkOutTime: '12:00',
      currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
      roomRates: [{ category: 'Standard', nightlyMinor: 6500000, capacity: 2 }],
    });
    const [reserved] = await Room.create([
      { number: '101', category: 'Standard' }, { number: '102', category: 'Standard' },
      { number: '103', category: 'Standard', outOfOrder: true }, { number: '104', category: 'Standard' },
    ]);
    await Reservation.create({
      roomId: reserved._id, roomNumber: '101', guestName: 'Earlier reservation', guestPhone: '2348000000011',
      arrivalAt: new Date(checkIn), departureAt: new Date(ahead(12)),
    });
    await Booking.create({
      roomNumber: '102', guestName: 'Current guest', guestPhone: '2348000000012', checkOutTime: new Date(ahead(9)),
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/conversations`;
    const inbox = async () => {
      const response = await fetch(`${url}/unlinked`);
      assert.equal(response.status, 200);
      return response.json();
    };
    const replies = [];
    const guest = async (text, id) => processGuestMessage({
      channel: 'WHATSAPP', chat: { id: jid }, message: { text, message_id: id },
      async reply(reply) { replies.push(reply); return { message_id: 'test-' + id }; },
    });
    await guest('I need a room for myself for one night.', '1');
    assert.match(replies.at(-1), /date.*check in/i);
    assert.equal((await Enquiry.findOne({ chatId: jid })).details.requestedNights, 1);

    await guest('I arrive next week.', '2');
    assert.match(replies.at(-1), /₦65,000/);
    const first = await Enquiry.findOne({ chatId: jid }).lean();
    assert.equal(first.details.departureDate, ahead(8));
    await hotelSettings.updateOne({ _id: settings.hotelId }, { $set: { 'roomRates.0.nightlyMinor': 7000000 } });
    await guest('Can I stay two more nights?', '3');
    assert.match(replies.at(-1), /₦210,000/);
    const revised = await Enquiry.findOne({ chatId: jid }).lean();
    assert.equal(revised.details.arrivalDate, checkIn);
    assert.equal(revised.details.departureDate, ahead(10));
    assert.equal(revised.quote.depositMinor, 10500000);

    await guest('Hey', 'greeting');
    const savedGreeting = await Message.findOne({ chatId: jid, providerMessageId: 'greeting', direction: 'INBOUND' });
    assert.equal(savedGreeting.processingStatus, 'PROCESSED');
    assert.equal(savedGreeting.bookingHandoff, undefined);
    assert.equal((await inbox()).messages.some(message => message.chatId === jid), false);
    assert.equal((await Enquiry.findById(revised._id)).quote.totalMinor, 21000000);

    await guest('Hey, I might arrive after dinner.', '4');
    const handoff = (await inbox()).messages.find(message => message.chatId === jid);
    assert.equal(handoff.text, 'Hey, I might arrive after dinner.');
    assert.equal(handoff.bookingHandoff.quote.totalMinor, 21000000);
    assert.equal(handoff.bookingHandoff.arrivalDate, checkIn);
    assert.equal(handoff.bookingHandoff.guests, 1);
    assert.equal((await Enquiry.findById(revised._id)).state, 'QUOTED');

    await guest('I accept. Put it under Ada Demo.', '5');
    await guest('I accept. Put it under Ada Demo.', '5');
    const request = (await inbox()).bookingRequests.find(item => item.chatId === jid);
    assert.equal(request.state, 'PENDING');
    assert.equal(request.quote.totalMinor, 21000000);
    assert.equal(await Reservation.countDocuments({ guestName: 'Ada Demo' }), 0);
    const decision = await fetch(`${url}/booking-enquiries/${request._id}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', version: request.version, depositVerified: true }),
    });
    assert.equal(decision.status, 200);
    const reservation = await Reservation.findOne({ guestName: 'Ada Demo' }).lean();
    assert.equal(reservation.roomNumber, '104');
    assert.equal(await Reservation.countDocuments({ guestName: 'Ada Demo' }), 1);

    delivery.start();
    const end = Date.now() + 4500;
    while (!(await Message.exists({ providerMessageId: 'test-confirmation', deliveryState: 'SENT' })) && Date.now() < end) {
      await delay(25);
    }
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chat, jid);
    assert.match(sent[0].text, new RegExp(String(reservation._id)));
    assert.equal((await inbox()).bookingRequests.find(item => item.chatId === jid).deliveryState, 'SENT');
  } finally {
    await delivery.stop();
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
