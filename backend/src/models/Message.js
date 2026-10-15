const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    channel: {
      type: String,
      enum: ['TELEGRAM', 'WHATSAPP'],
      required: true,
    },
    chatId: {
      type: String,
      required: true,
    },
    direction: {
      type: String,
      enum: ['INBOUND', 'OUTBOUND'],
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    providerMessageId: {
      type: String,
      default: null,
    },
    idempotencyKey: {
      type: String,
      required: true,
    },
    processingStatus: {
      type: String,
      enum: [
        'RECEIVED',
        'PROCESSING',
        'PROCESSED',
        'NEEDS_STAFF',
        'NOT_APPLICABLE',
      ],
      default: 'RECEIVED',
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

messageSchema.index({ idempotencyKey: 1 }, { unique: true });
messageSchema.index({ bookingId: 1, createdAt: -1 });
messageSchema.index({ channel: 1, chatId: 1, createdAt: -1 });
messageSchema.index({ processingStatus: 1, createdAt: 1 });

// Notify only after MongoDB has acknowledged a successful write.
for (const operation of ['save', 'updateOne', 'findOneAndUpdate', 'updateMany']) {
  messageSchema.post(operation, function () {
    require('../services/realtimeService').publishChange('Message');
  });
}
messageSchema.add({
  sender: { type: String, enum: ['SYSTEM', 'STAFF'], default: 'SYSTEM' },
  deliveryState: { type: String, enum: ['NOT_TRACKED', 'PENDING', 'SENT', 'UNKNOWN'], default: 'NOT_TRACKED' },
});

messageSchema.add({
  aiAction: { type: String, enum: ['ANSWER', 'CLARIFY', 'CREATE_REQUEST', 'FOLLOW_UP', 'STATUS', 'HANDOFF'], default: null },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskTicket', default: null },
});

messageSchema.add({
  staffReadAt: { type: Date, default: null },
  staffAnsweredAt: { type: Date, default: null },
  staffReplyThrough: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    createdAt: { type: Date },
  },
});
messageSchema.index({ bookingId: 1, direction: 1, staffReadAt: 1 });

module.exports = mongoose.model('Message', messageSchema);