const mongoose = require('mongoose');

const taskTicketSchema = new mongoose.Schema(
  {
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

module.exports = mongoose.model('TaskTicket', taskTicketSchema);
