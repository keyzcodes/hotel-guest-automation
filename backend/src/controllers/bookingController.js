const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const ScheduledJob = require('../models/ScheduledJob');
const {
  scheduleCheckInJobs,
  scheduleReviewJob,
} = require('../services/schedulingService');

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
const confirmCheckout = async (req, res) => {
    console.info('Checkout endpoint called:', {
    bookingId: req.params.id,
    time: new Date().toISOString(),
    origin: req.get('origin') || 'not supplied',
  });
  const { id } = req.params;

  if (!mongoose.isObjectIdOrHexString(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid booking ID.',
    });
  }

  let booking;

  try {
    // Only the first successful confirmation sets the departure timestamp.
    booking = await Booking.findOneAndUpdate(
      {
        _id: id,
        stayStatus: { $in: ['ACTIVE', 'EXTENDED'] },
      },
      {
        $set: {
          stayStatus: 'COMPLETED',
          confirmedCheckoutAt: new Date(),
          extensionPromptMessageId: null,
        },
      },
      { returnDocument: 'after', runValidators: true }
    );

    if (!booking) {
      booking = await Booking.findById(id);

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found.',
        });
      }

      if (
        booking.stayStatus !== 'COMPLETED' ||
        !booking.confirmedCheckoutAt
      ) {
        return res.status(409).json({
          success: false,
          message: 'This stay cannot be checked out through this action.',
        });
      }
    }
  } catch (error) {
    console.error('Checkout save failed:', error.name);

    return res.status(500).json({
      success: false,
      message: 'Checkout could not be confirmed. Refresh the stay before retrying.',
    });
  }

  // Checkout remains saved even if scheduling needs another attempt.
  const warnings = [];
  let reviewScheduled = false;

  try {
    await ScheduledJob.updateMany(
      {
        bookingId: booking._id,
        type: { $in: ['WELCOME', 'PULSE_CHECK', 'PRE_CHECKOUT'] },
        status: 'PENDING',
      },
      {
        $set: {
          status: 'CANCELLED',
          lastError: 'Reception confirmed checkout.',
        },
      },
      { runValidators: true }
    );
  } catch (error) {
    console.error('Checkout job cleanup failed:', error.name);
    warnings.push('Reminder cleanup needs another attempt.');
  }

  if (booking.telegramChatId) {
    try {
      await ScheduledJob.init();
      await scheduleReviewJob(booking, booking.confirmedCheckoutAt);
      reviewScheduled = true;
    } catch (error) {
      console.error('Checkout review scheduling failed:', error.name);
      warnings.push('Review scheduling needs another attempt.');
    }
  }

  return res.status(200).json({
    success: true,
    message: warnings.length
      ? 'Checkout confirmed. Some follow-up actions need another attempt.'
      : 'Checkout confirmed.',
    booking,
    reviewScheduled,
    followUpComplete: warnings.length === 0,
    warnings,
  });
};

module.exports = {
  checkInGuest,
  getActiveBookings,
  confirmCheckout,
};