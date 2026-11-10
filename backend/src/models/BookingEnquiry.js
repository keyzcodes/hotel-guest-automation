const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  hotelId: { type: String, required: true },
  chatId: { type: String, required: true },
  open: { type: Boolean, required: true },
  state: { type: String, required: true, enum: ['COLLECTING', 'QUOTED', 'PENDING', 'NEEDS_DETAILS', 'CONFIRMED', 'DECLINED'] },
  version: { type: Number, required: true, default: 0 },
  details: {
    arrivalDate: String,
    departureDate: String,
    guests: Number,
    category: String,
    guestName: String,
    awaitingName: Boolean,
    requestedNights: Number,
  },
  quote: {
    category: String,
    arrivalAt: Date,
    departureAt: Date,
    nights: Number,
    currency: String,
    totalMinor: Number,
    depositMinor: Number,
    expiresAt: Date,
  },
  staffQuestion: String,
  guestAnswer: String,
  depositVerifiedAt: Date,
  reservationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' },
  decisionMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  decidedBy: String,
}, { timestamps: true });

schema.index({ hotelId: 1, chatId: 1, open: 1 }, { unique: true, partialFilterExpression: { open: true } });
schema.index({ hotelId: 1, chatId: 1, updatedAt: -1 });
schema.index({ hotelId: 1, state: 1, updatedAt: -1 });
module.exports = mongoose.model('BookingEnquiry', schema);
