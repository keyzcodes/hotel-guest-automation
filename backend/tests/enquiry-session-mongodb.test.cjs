const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Session = require('../src/models/GuestEnquirySession');
const { openSession } = require('../src/services/enquirySessionStore');
const { initialState } = require('../src/services/enquiryState');
const uri = process.env.PMS_TEST_URI;
test('conversation session survives reconnect, CAS contention and reset without reimporting old categories', { skip: !uri, timeout: 60000 }, async () => {
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  const scope = { hotelId: 'synthetic-hotel', chatId: 'synthetic-chat', seed: { arrivalDate: '2026-11-21', departureDate: '2026-11-23', guests: 1, category: 'Standard' } };
  try {
    await mongoose.connect(uri, { dbName }); await Session.init();
    const opened = await Promise.all([openSession(scope), openSession(scope)]);
    assert.equal(opened[0].id, opened[1].id);
    const next = { ...opened[0].state, roomPreference: { scope: 'SELECTED', categories: ['Imperial'], strategy: 'COMPARE' } };
    const writes = await Promise.allSettled(opened.map(session => session.save(0, next)));
    assert.equal(writes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(writes.find(item => item.status === 'rejected').reason.code, 'STATE_CHANGED');
    await mongoose.disconnect(); await mongoose.connect(uri, { dbName });
    const resumed = await openSession(scope);
    assert.deepEqual(resumed.state.roomPreference.categories, ['Imperial']);
    assert.equal(resumed.version, 1);
    await resumed.save(resumed.version, initialState());
    const cleared = await openSession(scope);
    assert.deepEqual(cleared.state.stay, {});
    assert.deepEqual(cleared.state.roomPreference.categories, []);
    assert.equal(await Session.countDocuments(), 1);
  } finally {
    if (mongoose.connection.readyState) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test('WhatsApp routes to the saved agent session, rechecks live rooms and ignores replayed messages', { skip: !uri, timeout: 60000 }, async t => {
  const Room = require('../src/models/Room');
  const Reservation = require('../src/models/Reservation');
  const Message = require('../src/models/Message');
  const Enquiry = require('../src/models/BookingEnquiry');
  const profile = require('../src/services/bookingWorkflowSettings');
  const ai = require('../src/services/guestAiService');
  const flags = { WHATSAPP_ENQUIRY_AGENT_ENABLED: 'true', WHATSAPP_BOOKING_WORKFLOW_ENABLED: 'true',
    WHATSAPP_AVAILABILITY_ENABLED: 'true', ROOM_BOARD_ENABLED: 'true', USE_MOCK_AI: 'false' };
  const old = Object.fromEntries(Object.keys(flags).map(key => [key, process.env[key]]));
  Object.assign(process.env, flags);
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(profile, 'enabled', () => true);
  const settings = { name: 'Synthetic Hotel', checkInTime: '14:00', checkOutTime: '12:00', currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
    roomRates: [{ category: 'Imperial', capacity: 2, nightlyMinor: 8500000 }] };
  const arrivalDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const departureDate = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  let calls = 0;
  t.mock.method(ai, 'generateGuestModelResponse', async ({ contents }) => {
    calls++;
    const input = JSON.parse(contents[0].parts[0].text);
    if (contents.length === 1) return { functionCalls: [{ name: 'checkAvailability', args: {
      expectedVersion: input.enquiry.version, changes: { arrivalDate, departureDate, guests: 1 }, selection: { scope: 'SELECTED', categories: ['Imperial'] },
    } }] };
    return { functionCalls: [{ name: 'replyToGuest', args: { message: '', resultIds: ['result_1'] } }] };
  });
  // Load after installing the fake provider; all database and message routing are real.
  delete require.cache[require.resolve('../src/services/enquiryAgent')];
  const { processGuestMessage } = require('../src/services/guestMessageService');
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  const replies = [];
  const send = id => processGuestMessage({ channel: 'WHATSAPP', chat: { id: '2348000000090@s.whatsapp.net' },
    message: { message_id: id, text: 'Synthetic Imperial enquiry' }, reply: async text => { replies.push(text); return { message_id: 'reply-' + id }; } });
  try {
    await mongoose.connect(uri, { dbName });
    await Promise.all([Session.init(), Room.init(), Reservation.init(), Message.init(), Enquiry.init()]);
    await mongoose.connection.db.collection('hotelSettings').insertOne({ _id: profile.hotelId, ...settings });
    const room = await Room.create({ number: '201', category: 'Imperial', housekeeping: 'READY' });
    await send('first');
    assert.match(replies[0], /Imperial is available/);
    assert.equal(await Session.countDocuments(), 1);
    const before = await Session.findOne().lean();
    await send('first');
    assert.equal(replies.length, 1); assert.equal(calls, 2);
    assert.equal((await Session.findOne().lean()).version, before.version);
    await Room.updateOne({ _id: room._id }, { $set: { outOfOrder: true } });
    await send('second');
    assert.match(replies[1], /Imperial isn’t available/);
    assert.equal(await Reservation.countDocuments(), 0);
    assert.equal(await Enquiry.countDocuments(), 0);
  } finally {
    if (mongoose.connection.readyState) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
