const mongoose = require('mongoose');

const scheduledJobSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'WELCOME',
        'PULSE_CHECK',
        'PRE_CHECKOUT',
        'REVIEW_REQUEST',
      ],
      required: true,
    },
    scheduledFor: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [
        'PENDING',
        'PROCESSING',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
      ],
      default: 'PENDING',
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    lockToken: {
      type: String,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    idempotencyKey: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

scheduledJobSchema.index({ idempotencyKey: 1 }, { unique: true });
scheduledJobSchema.index({ status: 1, scheduledFor: 1 });
scheduledJobSchema.index({ status: 1, lockedUntil: 1 });
scheduledJobSchema.index({ bookingId: 1, status: 1 });

module.exports = mongoose.model('ScheduledJob', scheduledJobSchema);