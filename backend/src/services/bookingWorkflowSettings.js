const { connection } = require('mongoose');

const hotelId = 'kudu-demo';
const enabled = () => process.env.WHATSAPP_BOOKING_WORKFLOW_ENABLED === 'true' &&
  process.env.GUEST_CHANNEL === 'WHATSAPP' &&
  process.env.WHATSAPP_AVAILABILITY_ENABLED === 'true' &&
  process.env.ROOM_BOARD_ENABLED === 'true' &&
  process.env.GUEST_MESSAGING_ENABLED !== 'false' &&
  connection.name === 'sesora_whatsapp_lab';

const settings = () => connection.db.collection('hotelSettings');
const load = async (options = {}) => {
  const profile = await settings().findOne({ _id: hotelId }, options);
  const guestName = process.env.HOTEL_GUEST_NAME?.trim();
  return profile && guestName ? { ...profile, name: guestName } : profile;
};

async function stayPolicy() {
  const profile = await load();
  const hotel = require('../config/hotel');
  const { policyTime } = require('./bookingWorkflow');
  const checkInTime = profile?.checkInTime ?? hotel.checkInTime;
  const checkOutTime = profile?.checkOutTime ?? hotel.checkOutTime;
  return { checkInTime, checkOutTime, checkInLabel: policyTime(checkInTime), checkOutLabel: policyTime(checkOutTime) };
}

async function initialize() {
  if (!enabled()) return;
  await require('../models/BookingEnquiry').init();
  await settings().updateOne({ _id: hotelId }, {
    $setOnInsert: {
      name: 'Kudu Demo Hotel',
      city: 'Victoria Island, Lagos',
      timezone: 'Africa/Lagos',
      amenities: ['Wi-Fi', 'restaurant', 'gym', 'on-site parking'],
      services: {
        breakfast: { hours: '07:00–10:30' },
        restaurant: { hours: '12:00–22:00' },
        reception: { hours: '24 hours' },
      },
      policies: {
        cancellation: 'For the demo flexible rate, contact reception at least 24 hours before arrival to request a deposit refund. Reception confirms changes and refunds.',
      },
      checkInTime: '14:00',
      checkOutTime: '12:00',
      currency: 'NGN',
      depositPercent: 50,
      quoteMinutes: 30,
      roomRates: [
        { category: 'Standard', capacity: 2, nightlyMinor: 6500000 },
        { category: 'Imperial', capacity: 2, nightlyMinor: 8500000 },
        { category: 'Luxury', capacity: 2, nightlyMinor: 11000000 },
        { category: 'Junior Suite', capacity: 3, nightlyMinor: 14500000 },
      ],
    },
  }, { upsert: true });
}

module.exports = { hotelId, enabled, initialize, load, stayPolicy };
