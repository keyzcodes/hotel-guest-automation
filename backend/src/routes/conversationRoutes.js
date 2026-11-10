const transport = require('../services/guestChannel');
const express = require('express');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Message = require('../models/Message');
const router = express.Router();
const { enquiryMatches, groupBookingEnquiries } = require('../services/bookingEnquiryInbox');
const unlinkedInbound = { channel: 'WHATSAPP', bookingId: null, direction: 'INBOUND', bookingWorkflowHandled: { $ne: true } };
const guestMatching = { $nor: enquiryMatches, processingStatus: { $ne: 'PROCESSED' } };
const { unreadFilter, acknowledgeReply, attentionLookup } = require('../services/conversationAttentionService');
const reconcileReply = reply => acknowledgeReply(Message, reply).catch(error => console.error('Reply attention update failed:', error.name));
const fields = '_id direction text channel sender deliveryState processingStatus createdAt staffReadAt';
const publicMessage = message => {
  const result = message.toObject ? message.toObject() : message;
  return Object.fromEntries(fields.split(' ').filter(key => result[key] !== undefined).map(key => [key, result[key]]));
};
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    if (!Number.isInteger(limit)) return res.status(400).json({ success: false, message: 'Invalid limit.' });
    const scope = req.query.scope;
    if (scope !== undefined && !['Current', 'History'].includes(scope)) return res.status(400).json({ success: false, message: 'Invalid conversation scope.' });
    const scoped = scope === 'Current'
      ? { stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }
      : scope === 'History' ? { stayStatus: { $in: ['COMPLETED'] } } : {};
    const conversations = await Booking.aggregate([
      { $match: scoped },
      attentionLookup(Message.collection.name),
      { $set: {
        unreadCount: { $ifNull: [{ $arrayElemAt: ['$attention.unreadCount', 0] }, 0] },
        needsReplyCount: { $ifNull: [{ $arrayElemAt: ['$attention.needsReplyCount', 0] }, 0] },
      } },
      { $lookup: { from: Message.collection.name, let: { booking: '$_id' }, pipeline: [
        { $match: { $expr: { $eq: ['$bookingId', '$$booking'] } } },
        { $sort: { createdAt: -1, _id: -1 } }, { $limit: 1 },
        { $project: { text: 1, direction: 1, createdAt: 1 } },
      ], as: 'latest' } },
      { $set: { latestMessage: { $arrayElemAt: ['$latest', 0] }, canReply: { $and: [
        { $in: ['$stayStatus', ['ACTIVE', 'EXTENDED']] },
        { $ne: [{ $ifNull: ['$' + transport.field(), null] }, null] },
        { $ne: ['$' + transport.field(), ''] },
      ] }, lastActivity: { $ifNull: [{ $arrayElemAt: ['$latest.createdAt', 0] }, '$createdAt'] } } },
      { $sort: scope === 'Current' ? { needsReplyCount: -1, unreadCount: -1, lastActivity: -1, _id: -1 } : { lastActivity: -1, _id: -1 } }, { $limit: limit + 1 },
      { $project: { guestRating: 1, guestRatedAt: 1, guestName: 1, roomNumber: 1, stayStatus: 1, checkInTime: 1, checkOutTime: 1, unreadCount: 1, needsReplyCount: 1, latestMessage: 1, canReply: 1, lastActivity: 1 } },
    ]);
    res.json({ success: true, conversations: conversations.slice(0, limit), hasMore: conversations.length > limit });
  } catch (error) {
    console.error('Conversation list failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load conversations.' });
  }
});
// Unlinked messages remain visible without assigning a room or creating work.
router.get('/unlinked', async (req, res) => {
  try {
    const recent = (filter, fields) => Message.find({ ...unlinkedInbound, ...filter })
      .select(fields).sort({ createdAt: -1, _id: -1 }).limit(50).lean();
    const [messages, enquiries] = await Promise.all([
      recent(guestMatching, '_id chatId text createdAt bookingHandoff'),
      recent({ $or: enquiryMatches }, '_id chatId text createdAt processingStatus bookingEnquiryDates'),
    ]);
    const bookingRequests = process.env.WHATSAPP_BOOKING_WORKFLOW_ENABLED === 'true'
      ? await require('../services/bookingWorkflowService').inbox() : [];
    res.json({ success: true, messages, enquiries: groupBookingEnquiries(enquiries), bookingRequests });
  } catch {
    res.status(500).json({ success: false, message: 'Could not load unlinked messages.' });
  }
});
router.post('/booking-enquiries/:id/decision', async (req, res) => {
  if (process.env.WHATSAPP_BOOKING_WORKFLOW_ENABLED !== 'true' || !require('../services/bookingWorkflowSettings').enabled()) {
    return res.status(404).json({ success: false, message: 'Booking decisions are unavailable.' });
  }
  const { id } = req.params;
  const { action, version, depositVerified } = req.body ?? {};
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!mongoose.isObjectIdOrHexString(id) || !Number.isSafeInteger(version) || version < 0 ||
      !['confirm', 'decline', 'ask'].includes(action) || (action === 'ask' && (!question || question.length > 1000))) {
    return res.status(400).json({ success: false, message: 'Provide a valid enquiry and decision.' });
  }
  const { RoomConflict } = require('../services/roomInventory');
  try {
    await require('../services/bookingWorkflowService').decide({
      id, action, version, depositVerified, question, actor: String(req.staffSession._id),
    });
    res.json({ success: true });
  } catch (error) {
    if (error instanceof RoomConflict) return res.status(409).json({ success: false, message: error.message });
    throw error;
  }
});
router.post('/unlinked/:messageId/link', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { bookingId } = req.body || {};
    if (!mongoose.isObjectIdOrHexString(messageId) || !mongoose.isObjectIdOrHexString(bookingId))
      return res.status(400).json({ success: false, message: 'Choose a valid message and stay.' });
    const inbound = await Message.findOne({ ...unlinkedInbound, ...guestMatching, _id: messageId });
    if (!inbound) return res.status(409).json({ success: false, message: 'Message is already linked or unavailable. Refresh.' });
    const booking = await Booking.findById(bookingId);
    if (!booking || !['ACTIVE', 'EXTENDED'].includes(booking.stayStatus) || !booking.whatsappJid || booking.whatsappJid !== inbound.chatId)
      return res.status(409).json({ success: false, message: 'The sender must match the WhatsApp number recorded on an active stay. Verify the guest at reception first.' });
    const owners = await Booking.find({ whatsappJid: inbound.chatId, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).select('_id').limit(2);
    if (owners.length !== 1) return res.status(409).json({ success: false, message: 'This number has multiple active stays. Resolve them first.' });
    await Message.updateMany({ ...unlinkedInbound, ...guestMatching, chatId: inbound.chatId },
      { $set: { bookingId: booking._id, processingStatus: 'NEEDS_STAFF', aiAction: 'HANDOFF' } });
    res.json({ success: true, message: 'Messages linked for staff review. No requests or automatic replies were created.' });
  } catch {
    res.status(500).json({ success: false, message: 'Link could not be confirmed. Refresh before retrying.' });
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
router.post('/:bookingId/read', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const ids = req.body?.messageIds;
    if (!mongoose.isObjectIdOrHexString(bookingId) || !Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !mongoose.isObjectIdOrHexString(id))) {
      return res.status(400).json({ success: false, message: 'Provide a valid booking and 1–500 message IDs.' });
    }
    if (!await Booking.exists({ _id: bookingId })) return res.status(404).json({ success: false, message: 'Booking not found.' });
    // Only messages returned to the browser are marked read. Later arrivals remain unread.
    const result = await Message.updateMany(unreadFilter(bookingId, ids), { $set: { staffReadAt: new Date() } });
    return res.json({ success: true, readCount: result.modifiedCount });
  } catch (error) {
    console.error('Conversation read acknowledgement failed:', error.name);
    return res.status(500).json({ success: false, message: 'Could not update read status.' });
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
      await reconcileReply(existing);
      return res.json({ success: true, message: publicMessage(existing) });
    }
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found.' });
    if (!['ACTIVE', 'EXTENDED'].includes(booking.stayStatus) || !transport.address(booking)) return res.status(409).json({ success: false, message: 'This stay is closed or has no linked guest chat chat.' });
    const linked = await Booking.find({ [transport.field()]: transport.address(booking), stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).select('_id').limit(2);
    if (linked.length !== 1 || String(linked[0]._id) !== bookingId) return res.status(409).json({ success: false, message: 'guest chat chat is linked ambiguously. Resolve the bookings before replying.' });
    const latestInbound = await Message.findOne({ bookingId, direction: 'INBOUND' }).sort({ createdAt: -1, _id: -1 }).select('_id createdAt').lean();
    const staffReplyThrough = latestInbound ? { messageId: latestInbound._id, createdAt: latestInbound.createdAt } : undefined;
    try {
      message = await Message.create({ bookingId, channel: transport.channel(), chatId: transport.address(booking), direction: 'OUTBOUND', sender: 'STAFF', staffReplyThrough, text: text.trim(), idempotencyKey: key, processingStatus: 'NOT_APPLICABLE', deliveryState: 'PENDING' });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const duplicate = await Message.findOne({ idempotencyKey: key });
      if (!duplicate || duplicate.text !== text.trim()) return res.status(409).json({ success: false, message: 'Reply request conflict.' });
      await reconcileReply(duplicate);
      return res.json({ success: true, message: publicMessage(duplicate) });
    }
    // Persist first. Repeated HTTP requests with this key NEVER send again.
    const sent = await transport.sendStaffReply(transport.address(booking), message.text);
    message.providerMessageId = String(sent.message_id);
    message.deliveryState = 'SENT';
    await message.save();
    await reconcileReply(message);
    return res.status(201).json({ success: true, message: publicMessage(message) });
  } catch (error) {
    console.error('Staff reply failed:', error.message);
    if (message) {
      await Message.updateOne({ _id: message._id }, { $set: { deliveryState: 'UNKNOWN', lastError: 'guest chat send or delivery-record update could not be confirmed.' } }).catch(() => {});
      return res.status(202).json({ success: true, message: { ...publicMessage(message), deliveryState: 'UNKNOWN' } });
    }
    return res.status(500).json({ success: false, message: 'Could not record the reply. Check the conversation before retrying.' });
  }
});
module.exports = router;
