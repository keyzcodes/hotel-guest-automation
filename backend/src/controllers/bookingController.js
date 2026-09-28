const Booking = require('../models/Booking');
const { sendWelcomeMessage, sendSatisfactionCheck } = require('../services/telegramService');

const calculateCheckOut = (checkInDate, policy) => {
  const checkIn = new Date(checkInDate);
  if (policy === 'TWELVE_HOUR') return new Date(checkIn.getTime() + 12 * 3600 * 1000);
  if (policy === 'TWENTY_FOUR_HOUR') return new Date(checkIn.getTime() + 24 * 3600 * 1000);
  
  if (policy === 'FIXED_NOON') {
    const checkOut = new Date(checkIn);
    if (checkIn.getHours() >= 12) checkOut.setDate(checkOut.getDate() + 1);
    checkOut.setHours(12, 0, 0, 0);
    return checkOut;
  }
  return new Date(checkIn.getTime() + 24 * 3600 * 1000);
};

const checkInGuest = async (req, res) => {
  try {
    const { guestName, guestPhone, telegramChatId, roomNumber, stayPolicy } = req.body;

    if (!guestName || !guestPhone || !roomNumber) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const checkInTime = new Date();
    const checkOutTime = calculateCheckOut(checkInTime, stayPolicy || 'TWENTY_FOUR_HOUR');

    const newBooking = await Booking.create({
      guestName,
      guestPhone,
      telegramChatId: telegramChatId || '7089436555',
      roomNumber,
      stayPolicy: stayPolicy || 'TWENTY_FOUR_HOUR',
      checkInTime,
      checkOutTime,
      stayStatus: 'ACTIVE',
    });

    if (newBooking.telegramChatId) {
      await sendWelcomeMessage(newBooking.telegramChatId, guestName, roomNumber);

      // Trigger satisfaction check in 15 seconds (for demo testing)
      setTimeout(async () => {
        try {
          await sendSatisfactionCheck(newBooking.telegramChatId, guestName, roomNumber);
          newBooking.pulseCheckStatus = 'SENT';
          await newBooking.save();
          console.log(`[Pulse Check] Sent to Room ${roomNumber}`);
        } catch (err) {
          console.error(`[Pulse Check Error]:`, err.message);
        }
      }, 15000);
    }

    return res.status(201).json({
      success: true,
      message: `Guest ${guestName} checked into Room ${roomNumber}!`,
      booking: newBooking,
    });
  } catch (error) {
    console.error('Check-In Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getActiveBookings = async (req, res) => {
  try {
    const activeBookings = await Booking.find({ stayStatus: 'ACTIVE' }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: activeBookings.length, bookings: activeBookings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { checkInGuest, getActiveBookings };