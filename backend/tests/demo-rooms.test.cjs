const assert = require('node:assert/strict');
const test = require('node:test');
const { seedDemoRooms } = require('../src/services/demoRooms');

const env = { NODE_ENV: 'development', GUEST_CHANNEL: 'WHATSAPP', ROOM_BOARD_ENABLED: 'true' };
const lab = 'sesora_whatsapp_lab';

function fixture(stays = []) {
  const rooms = new Map();
  let writes = 0;
  return {
    rooms,
    writes: () => writes,
    options: {
      env,
      Booking: { exists: filter => ({ collation: async () => stays.includes(filter.roomNumber) }) },
      Room: { updateOne: async ({ number }, update, options) => {
        writes++;
        assert.deepEqual(Object.keys(update), ['$setOnInsert']);
        assert.equal(options.timestamps, false);
        assert.equal(options.upsert, true);
        if (!rooms.has(number)) rooms.set(number, update.$setOnInsert);
      } },
    },
  };
}

test('demo preload adds the agreed rooms and leaves existing room states alone on restart', async () => {
  const f = fixture();
  await seedDemoRooms(lab, f.options);
  const counts = {};
  for (const { category } of f.rooms.values()) counts[category] = (counts[category] || 0) + 1;
  assert.deepEqual(counts, { Standard: 5, Imperial: 3, Luxury: 2, 'Junior Suite': 2 });
  assert.equal(f.rooms.get('101').housekeeping, 'DIRTY');
  assert.equal(f.rooms.get('103').housekeeping, 'READY');
  const occupied = { ...f.rooms.get('101'), housekeeping: 'READY', activeBookingId: 'stay-1', version: 5 };
  f.rooms.set('101', occupied);
  await seedDemoRooms(lab, f.options);
  assert.equal(f.rooms.size, 12);
  assert.equal(f.rooms.get('101'), occupied);
});

test('demo preload cannot run outside the enabled WhatsApp development lab', async () => {
  const f = fixture();
  await seedDemoRooms('hotel-production', f.options);
  for (const change of [{ NODE_ENV: 'production' }, { GUEST_CHANNEL: '' }, { ROOM_BOARD_ENABLED: 'false' }]) {
    await seedDemoRooms(lab, { ...f.options, env: { ...env, ...change } });
  }
  assert.equal(f.writes(), 0);
});

test('demo preload skips an existing active stay without creating a conflicting room', async () => {
  const f = fixture(['101']);
  await seedDemoRooms(lab, f.options);
  assert.equal(f.rooms.size, 11);
  assert.equal(f.rooms.has('101'), false);
});
