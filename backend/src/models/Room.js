const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  number: { type: String, required: true, unique: true, immutable: true },
  category: { type: String, required: true, maxlength: 48 },
  housekeeping: { type: String, enum: ['DIRTY', 'READY'], default: 'DIRTY', required: true },
  outOfOrder: { type: Boolean, default: false, required: true },
  activeBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  version: { type: Number, default: 0, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Room', schema);
