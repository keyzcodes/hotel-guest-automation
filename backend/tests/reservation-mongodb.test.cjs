const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Room = require('../src/models/Room');
const Booking = require('../src/models/Booking');
const Reservation = require('../src/models/Reservation');
const inventory = require('../src/services/roomInventory');

const uri = process.env.PMS_TEST_URI;

test('replica set prevents concurrent overlapping reservations and retains the room across check-in', {
  skip: !uri,
  timeout: 60000,
}, async () => {
  // Require an explicit test connection. Generate an isolated database name
  // rather than opening the database named in the supplied URI or app env.
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName, 'PMS_TEST_URI must point to a MongoDB replica set.');
    await Promise.all([Room.init(), Booking.init(), Reservation.init()]);

    const now = Date.now();
    const dates = { arrivalAt: new Date(now - 60000), departureAt: new Date(now + 86400000) };
    const room = await Room.create({ number: '101', category: 'Standard', housekeeping: 'READY' });
    assert.deepEqual((await inventory.availableRooms(dates)).map(item => item.number), ['101']);

    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) =>
      inventory.reserve({ ...dates, roomId: room._id, guestName: 'Test Guest ' + index, guestPhone: '234800000000' + index })
    ));
    const accepted = results.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 1);
    for (const result of results.filter(result => result.status === 'rejected')) {
      assert.ok(result.reason instanceof inventory.RoomConflict, String(result.reason));
    }
    assert.equal(await Reservation.countDocuments({ roomId: room._id }), 1);
    assert.deepEqual(await inventory.availableRooms(dates), []);

    const reservation = accepted[0].value;
    const stay = await inventory.checkIn({
      roomNumber: room.number,
      guestName: reservation.guestName,
      guestPhone: reservation.guestPhone,
      checkInTime: new Date(now),
      checkOutTime: dates.departureAt,
    }, reservation._id);
    assert.equal(String((await Reservation.findById(reservation._id)).stayId), String(stay._id));
    assert.deepEqual(await inventory.availableRooms(dates), []);
    assert.equal((await Room.findById(room._id)).activeBookingId.toString(), stay._id.toString());
  } finally {
    try {
      if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  }
});
