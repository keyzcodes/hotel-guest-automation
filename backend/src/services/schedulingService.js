const ScheduledJob = require('../models/ScheduledJob');

const MINUTE = 60 * 1000;

// Repeated scheduling calls preserve an existing job's state.
const saveJob = async (bookingId, type, scheduledFor, idempotencyKey) => {
  return ScheduledJob.updateOne(
    { idempotencyKey },
    {
      $setOnInsert: {
        bookingId,
        type,
        scheduledFor,
        idempotencyKey,
        status: 'PENDING',
      },
    },
    { upsert: true, runValidators: true }
  );
};

const scheduleCheckInJobs = async (
  booking,
  {
    pulseDelayMs = 15 * MINUTE,
    checkoutReminderLeadMs = 30 * MINUTE,
    reminderDelayMs, // Demo-only offset; normal reminders follow planned checkout.
  } = {}
) => {
  const checkIn = new Date(booking.checkInTime);
  const checkOut = new Date(booking.checkOutTime);

  if (
    !Number.isFinite(checkIn.getTime()) ||
    !Number.isFinite(checkOut.getTime()) ||
    checkOut <= checkIn
  ) {
    throw new Error('Cannot schedule jobs with invalid booking times.');
  }

  if (
    !Number.isFinite(pulseDelayMs) ||
    pulseDelayMs <= 0 ||
    !Number.isFinite(checkoutReminderLeadMs) ||
    checkoutReminderLeadMs <= 0
  ) {
    throw new Error('Message timing must use positive millisecond values.');
  }

  if (reminderDelayMs !== undefined && (!Number.isFinite(reminderDelayMs) || reminderDelayMs <= 0)) throw new Error('Invalid reminder offset.');
  const bookingId = booking._id.toString();

  await saveJob(
    booking._id,
    'WELCOME',
    checkIn,
    `${bookingId}:WELCOME`
  );

  const pulseAt = new Date(checkIn.getTime() + pulseDelayMs);

  // Skip a settling-in message if the stay ends before it is due.
  if (pulseAt < checkOut) {
    await saveJob(
      booking._id,
      'PULSE_CHECK',
      pulseAt,
      `${bookingId}:PULSE_CHECK`
    );
  }

  const reminderAt = new Date(
    Math.max(
      checkIn.getTime(),
      reminderDelayMs === undefined
        ? checkOut.getTime() - checkoutReminderLeadMs
        : checkIn.getTime() + reminderDelayMs
    )
  );

  if (reminderAt >= checkOut) return;
  await saveJob(
    booking._id,
    'PRE_CHECKOUT',
    reminderAt,
    `${bookingId}:PRE_CHECKOUT:${checkOut.toISOString()}`
  );
};

const scheduleReviewJob = async (booking, confirmedCheckoutAt) => {
  if (booking.stayStatus !== 'COMPLETED') {
    throw new Error('Review invitations require confirmed checkout.');
  }

  const checkoutAt = new Date(confirmedCheckoutAt);

  if (!Number.isFinite(checkoutAt.getTime())) {
    throw new Error('A valid confirmed checkout time is required.');
  }

  await saveJob(
    booking._id,
    'REVIEW_REQUEST',
    checkoutAt,
    `${booking._id.toString()}:REVIEW_REQUEST`
  );
};

module.exports = {
  scheduleCheckInJobs,
  scheduleReviewJob,
};