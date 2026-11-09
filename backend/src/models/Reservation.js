const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true, immutable: true },
  roomNumber: { type: String, required: true, immutable: true },
  guestName: { type: String, required: true, maxlength: 100, immutable: true },
  guestPhone: { type: String, required: true, immutable: true },
  arrivalAt: { type: Date, required: true, immutable: true },
  departureAt: { type: Date, required: true, immutable: true },
  stayId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  cancelledAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ roomId: 1, stayId: 1, arrivalAt: 1, departureAt: 1 });
schema.index({ stayId: 1, departureAt: 1, arrivalAt: 1 });

module.exports = mongoose.model('Reservation', schema);
