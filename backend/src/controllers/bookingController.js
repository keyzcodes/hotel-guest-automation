const Booking = require('../models/Booking');
const { scheduleCheckInJobs } = require('../services/schedulingService');

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
    const suppliedCheckout = req.body.checkOutTime;

    if (suppliedCheckout !== undefined &&
        (typeof suppliedCheckout !== 'string' ||
         !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(suppliedCheckout))) {
      return res.status(400).json({
        success: false,
        message: 'Provide checkOutTime as an ISO date with a timezone.'
      });
    }

    const checkOutTime = suppliedCheckout !== undefined
      ? new Date(suppliedCheckout)
      : calculateCheckOut(checkInTime, stayPolicy || 'TWENTY_FOUR_HOUR');

    if (!Number.isFinite(checkOutTime.getTime()) || checkOutTime <= checkInTime) {
      return res.status(400).json({
        success: false,
        message: 'Check-out must be a valid time after check-in.'
      });
    }

    const newBooking = await Booking.create({
      guestName,
      guestPhone,
      telegramChatId: telegramChatId || null,
      roomNumber,
      stayPolicy: stayPolicy || 'TWENTY_FOUR_HOUR',
      checkInTime,
      checkOutTime,
      stayStatus: 'ACTIVE',
    });

    let automationScheduled = true;
    try {
      const timings = process.env.JOB_DEMO_MODE === 'true'
        ? { pulseDelayMs: 15000, checkoutReminderLeadMs: 30000 }
        : {};
      await scheduleCheckInJobs(newBooking, timings);
    } catch (error) {
      automationScheduled = false;
      console.error('Booking saved but job scheduling failed:', error.name);
    }
    return res.status(201).json({
      success: true,
      message: `Guest ${guestName} checked into Room ${roomNumber}!`,
      booking: newBooking,
      automationScheduled,
    });
  } catch (error) {
    console.error('Check-In Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getActiveBookings = async (req, res) => {
  try {
    const activeBookings = await Booking.find({ stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: activeBookings.length, bookings: activeBookings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { checkInGuest, getActiveBookings };