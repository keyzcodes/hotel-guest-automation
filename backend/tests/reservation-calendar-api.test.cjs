const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const Reservation = require('../src/models/Reservation');
const { router } = require('../src/routes/reservationRoutes');

test('reservation calendar endpoints apply policy hours, reject overlaps and preserve timestamp clients', {
  skip: !process.env.PMS_TEST_URI, timeout: 20000,
}, async t => {
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  const previous = process.env.ROOM_BOARD_ENABLED;
  process.env.ROOM_BOARD_ENABLED = 'true';
  t.after(() => { if (previous === undefined) delete process.env.ROOM_BOARD_ENABLED; else process.env.ROOM_BOARD_ENABLED = previous; });
  let server;
  try {
    await mongoose.connect(process.env.PMS_TEST_URI, { dbName, serverSelectionTimeoutMS: 8000 });
    await Promise.all([Room.init(), Booking.init(), Reservation.init()]);
    await mongoose.connection.db.collection('hotelSettings').insertOne({ _id: 'kudu-demo', checkInTime: '15:00', checkOutTime: '11:30' });
    const room = await Room.create({ number: '101', category: 'Standard', housekeeping: 'READY' });
    const app = express();
    app.use(express.json());
    app.use('/reservations', router);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port + '/reservations';
    const dates = { arrivalDate: '2099-11-21', departureDate: '2099-11-23' };
    let response = await fetch(url + '/availability?' + new URLSearchParams(dates));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rooms.length, 1);
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...dates, roomId: String(room._id), guestName: 'Reservation Demo', guestPhone: '2348000000001' }) });
    assert.equal(response.status, 201);
    const saved = await Reservation.findOne().lean();
    assert.equal(saved.arrivalAt.toISOString(), '2099-11-21T14:00:00.000Z');
    assert.equal(saved.departureAt.toISOString(), '2099-11-23T10:30:00.000Z');
    assert.equal((await Room.findById(room._id)).activeBookingId, null);
    assert.equal(await Booking.countDocuments(), 0);
    response = await fetch(url + '/availability?' + new URLSearchParams({ arrivalDate: '2099-11-22', departureDate: '2099-11-24' }));
    assert.deepEqual((await response.json()).rooms, []);
    const timestampRange = { arrivalAt: saved.departureAt.toISOString(), departureAt: '2099-11-24T10:30:00.000Z' };
    response = await fetch(url + '/availability?' + new URLSearchParams(timestampRange));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rooms.length, 1);
    response = await fetch(url + '/availability?' + new URLSearchParams({ arrivalDate: '2099-11-31', departureDate: '2099-12-02' }));
    assert.equal(response.status, 400);
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...dates, ...timestampRange, roomId: String(room._id), guestName: 'Conflict', guestPhone: '2348000000001' }) });
    assert.equal(response.status, 400);
    assert.equal(await Reservation.countDocuments(), 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});
