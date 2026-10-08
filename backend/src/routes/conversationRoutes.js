const express = require('express');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Message = require('../models/Message');
const router = express.Router();
const fields = '_id direction text channel sender deliveryState processingStatus createdAt';
const publicMessage = message => {
  const result = message.toObject ? message.toObject() : message;
  return Object.fromEntries(fields.split(' ').filter(key => result[key] !== undefined).map(key => [key, result[key]]));
};
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    if (!Number.isInteger(limit)) return res.status(400).json({ success: false, message: 'Invalid limit.' });
    const conversations = await Booking.aggregate([
      { $lookup: { from: Message.collection.name, let: { booking: '$_id' }, pipeline: [
        { $match: { $expr: { $eq: ['$bookingId', '$$booking'] } } },
        { $sort: { createdAt: -1, _id: -1 } }, { $limit: 1 },
        { $project: { text: 1, direction: 1, createdAt: 1 } },
      ], as: 'latest' } },
      { $set: { latestMessage: { $arrayElemAt: ['$latest', 0] }, canReply: { $and: [
        { $in: ['$stayStatus', ['ACTIVE', 'EXTENDED']] },
        { $ne: [{ $ifNull: ['$telegramChatId', null] }, null] },
        { $ne: ['$telegramChatId', ''] },
      ] }, lastActivity: { $ifNull: [{ $arrayElemAt: ['$latest.createdAt', 0] }, '$createdAt'] } } },
      { $sort: { lastActivity: -1, _id: -1 } }, { $limit: limit + 1 },
      { $project: { guestName: 1, roomNumber: 1, stayStatus: 1, latestMessage: 1, canReply: 1, lastActivity: 1 } },
    ]);
    res.json({ success: true, conversations: conversations.slice(0, limit), hasMore: conversations.length > limit });
  } catch (error) {
    console.error('Conversation list failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load conversations.' });
  }
});
router.get('/:bookingId/messages', async (req, res) => {
  try {
    const { bookingId } = req.params;
    if (!mongoose.isObjectIdOrHexString(bookingId)) return res.status(400).json({ success: false, message: 'Invalid booking ID.' });
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    if (!Number.isInteger(limit)) return res.status(400).json({ success: false, message: 'Invalid limit.' });
    const booking = await Booking.findById(bookingId).select('guestName roomNumber stayStatus').lean();
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    const messages = await Message.find({ bookingId }).select(fields).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    res.json({ success: true, booking, messages: messages.slice(0, limit).reverse(), hasMore: messages.length > limit });
  } catch (error) {
    console.error('Conversation lookup failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load the conversation.' });
  }
});
router.post('/:bookingId/reply', async (req, res) => {
  let message;
  try {
    const { bookingId } = req.params;
    const { text, requestId } = req.body || {};
    if (!mongoose.isObjectIdOrHexString(bookingId) || typeof text !== 'string' || !text.trim() || text.trim().length > 3000 || typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) {
      return res.status(400).json({ success: false, message: 'Provide a valid booking, reply (1–3000 characters), and request ID.' });
    }
    const key = `STAFF:${bookingId}:${requestId}`;
    const existing = await Message.findOne({ idempotencyKey: key });
    if (existing) {
      if (existing.text !== text.trim()) return res.status(409).json({ success: false, message: 'This request ID belongs to a different reply.' });
      return res.json({ success: true, message: publicMessage(existing) });
    }
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (!['ACTIVE', 'EXTENDED'].includes(booking.stayStatus) || !booking.telegramChatId) return res.status(409).json({ success: false, message: 'This stay is closed or has no linked Telegram chat.' });
    const linked = await Booking.find({ telegramChatId: booking.telegramChatId, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).select('_id').limit(2);
    if (linked.length !== 1 || String(linked[0]._id) !== bookingId) return res.status(409).json({ success: false, message: 'Telegram chat is linked ambiguously. Resolve the bookings before replying.' });
    try {
      message = await Message.create({ bookingId, channel: 'TELEGRAM', chatId: booking.telegramChatId, direction: 'OUTBOUND', sender: 'STAFF', text: text.trim(), idempotencyKey: key, processingStatus: 'NOT_APPLICABLE', deliveryState: 'PENDING' });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const duplicate = await Message.findOne({ idempotencyKey: key });
      if (!duplicate || duplicate.text !== text.trim()) return res.status(409).json({ success: false, message: 'Reply request conflict.' });
      return res.json({ success: true, message: publicMessage(duplicate) });
    }
    // Persist first. Repeated HTTP requests with this key NEVER send again.
    const sent = await require('../services/telegramService').sendStaffReply(booking.telegramChatId, message.text);
    message.providerMessageId = String(sent.message_id);
    message.deliveryState = 'SENT';
    await message.save();
    return res.status(201).json({ success: true, message: publicMessage(message) });
  } catch (error) {
    console.error('Staff reply failed:', error.message);
    if (message) {
      await Message.updateOne({ _id: message._id }, { $set: { deliveryState: 'UNKNOWN', lastError: 'Telegram send or delivery-record update could not be confirmed.' } }).catch(() => {});
      return res.status(202).json({ success: true, message: { ...publicMessage(message), deliveryState: 'UNKNOWN' } });
    }
    return res.status(500).json({ success: false, message: 'Could not record the reply. Check the conversation before retrying.' });
  }
});
module.exports = router;
