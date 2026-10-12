const mongoose = require('mongoose');

const taskTicketSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    guestName: {
      type: String,
      required: true,
      trim: true
    },
    chatId: {
      type: String,
      required: true,
      index: true
    },
    roomNumber: {
      type: String,
      default: 'Unassigned',
      trim: true
    },
    category: {
      type: String,
      required: true,
      enum: ['Housekeeping', 'Maintenance', 'F&B', 'Front Desk', 'General Inquiry'],
      default: 'General Inquiry'
    },
    requestText: {
      type: String,
      required: true
    },
    status: {
      type: String,
      required: true,
      enum: ['Pending', 'In Progress', 'Resolved', 'Escalated'],
      default: 'Pending'
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'Urgent'],
      default: 'Medium'
    },
    assignedStaff: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

taskTicketSchema.index({ status: 1, createdAt: -1 });

// Notify only after MongoDB has acknowledged a successful write.
for (const operation of ['save', 'updateOne', 'findOneAndUpdate', 'updateMany']) {
  taskTicketSchema.post(operation, function () {
    require('../services/realtimeService').publishChange('TaskTicket');
  });
}
taskTicketSchema.add({
  staffReviewKey: { type: String },
  sourceMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null,
  },
  guestUpdates: [{
    _id: false,
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
    },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  }],
});

taskTicketSchema.index({ sourceMessageId: 1 }, {
  unique: true,
  partialFilterExpression: {
    sourceMessageId: { $type: 'objectId' },
  },
});

taskTicketSchema.index(
  { staffReviewKey: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('TaskTicket', taskTicketSchema);
