const inventory = [
  ['Standard', ['101', '102', '103', '104', '105']],
  ['Imperial', ['201', '202', '203']],
  ['Luxury', ['301', '302']],
  ['Junior Suite', ['401', '402']],
];
const dirty = new Set(['101', '102', '203', '402']);

async function seedDemoRooms(database, { env = process.env, Room, Booking } = {}) {
  if (database !== 'sesora_whatsapp_lab' || env.NODE_ENV !== 'development' ||
      env.GUEST_CHANNEL !== 'WHATSAPP' || env.ROOM_BOARD_ENABLED !== 'true') return;

  Room ??= require('../models/Room');
  Booking ??= require('../models/Booking');
  for (const [category, numbers] of inventory) {
    for (const number of numbers) {
      // Leave rooms with an existing stay alone; never invent a room assignment.
      if (await Booking.exists({ roomNumber: number, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } })
        .collation({ locale: 'en', strength: 2 })) continue;

      const now = new Date();
      await Room.updateOne({ number }, {
        $setOnInsert: {
          number, category, housekeeping: dirty.has(number) ? 'DIRTY' : 'READY',
          outOfOrder: false, activeBookingId: null, version: 0, createdAt: now, updatedAt: now,
        },
      }, { upsert: true, runValidators: true, timestamps: false });
    }
  }
}

module.exports = { seedDemoRooms };
