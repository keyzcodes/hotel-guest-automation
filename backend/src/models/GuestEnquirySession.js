const mongoose = require('mongoose');
// Conversation workspace only. Reservation/approval records remain authoritative.
const schema = new mongoose.Schema({
  hotelId: { type: String, required: true },
  chatId: { type: String, required: true },
  version: { type: Number, default: 0, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true, minimize: false });
schema.index({ hotelId: 1, chatId: 1 }, { unique: true });
module.exports = mongoose.model('GuestEnquirySession', schema);
