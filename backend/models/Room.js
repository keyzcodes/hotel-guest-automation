const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomNumber: {
    type: String,
    required: true,
    unique: true
  },
  guestName: {
    type: String,
    default: ''
  },
  guestPhone: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['VACANT', 'ARRIVED', 'QC_PASSED', 'PRE_CHECKOUT_NOTICE', 'CHECKED_OUT', 'MAINTENANCE'],
    default: 'VACANT'
  },
  checkoutNoticeSent: {
    type: Boolean,
    default: false
  },
  checkoutTime: {
    type: Date
  }
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);