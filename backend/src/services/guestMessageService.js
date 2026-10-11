const Message = require('../models/Message');
const Booking = require('../models/Booking');
const TaskTicket = require('../models/TaskTicket');
const hotel = require('../config/hotel');
const { interpretGuestMessage, validateDecision } = require('./guestAiService');
const { serviceFallback } = require('./guestFallbackService');
const openStatuses = ['Pending', 'In Progress', 'Escalated'];
async function recordAndReply(ctx, inbound, text) {
  // Save before sending; do not automatically retry uncertain external sends.
  const outgoing = await Message.create({ bookingId: inbound.bookingId || null, channel: 'TELEGRAM', chatId: inbound.chatId, direction: 'OUTBOUND', sender: 'SYSTEM', text, idempotencyKey: `AUTO:${inbound._id}`, processingStatus: 'NOT_APPLICABLE', deliveryState: 'PENDING' });
  try {
    const sent = await ctx.reply(text);
    outgoing.providerMessageId = String(sent.message_id);
    outgoing.deliveryState = 'SENT';
    await outgoing.save();
  } catch {
    await Message.updateOne({ _id: outgoing._id }, { $set: { deliveryState: 'UNKNOWN', lastError: 'Automatic send or reply recording could not be confirmed.' } }).catch(() => {});
  }
}
async function createTicket(inbound, booking, category) {
  await TaskTicket.init();
  return TaskTicket.findOneAndUpdate({ sourceMessageId: inbound._id }, { $setOnInsert: {
    sourceMessageId: inbound._id, bookingId: booking._id, guestName: booking.guestName,
    chatId: inbound.chatId, roomNumber: booking.roomNumber, category,
    requestText: inbound.text, status: 'Pending', priority: 'Medium',
  } }, { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true });
}
async function applyDecision(decision, inbound, booking, tickets) {
  const checked = validateDecision(decision, tickets);
  if (['ANSWER', 'CLARIFY'].includes(checked.action)) return { reply: checked.reply, needsStaff: false, ticketId: null };
  if (checked.action === 'FOLLOW_UP') {
    const updated = await TaskTicket.findOneAndUpdate({
      _id: checked.ticketId, bookingId: booking._id, status: { $in: openStatuses },
      'guestUpdates.messageId': { $ne: inbound._id },
    }, { $push: { guestUpdates: { messageId: inbound._id, text: inbound.text, createdAt: new Date() } } }, { returnDocument: 'after', runValidators: true });
    if (!updated) return { reply: 'That request may have changed. Please tell us which request you want to update.', needsStaff: false, ticketId: null };
    return { reply: 'Your update has been recorded on the existing request for staff review. Changes are not confirmed until staff accept them.', needsStaff: true, ticketId: updated._id };
  }
  const ticket = await createTicket(inbound, booking, checked.category);
  return { reply: `Your ${checked.category} request for Room ${booking.roomNumber} has been recorded. Staff confirmation is pending.`, needsStaff: true, ticketId: ticket._id };
}
async function processGuestMessage(ctx) {
  const chatId = String(ctx.chat.id), text = ctx.message.text;
  let inbound, booking;
  try {
    try {
      inbound = await Message.create({ channel: 'TELEGRAM', chatId, direction: 'INBOUND', text, providerMessageId: String(ctx.message.message_id), idempotencyKey: `TELEGRAM:${chatId}:${ctx.message.message_id}`, processingStatus: 'RECEIVED' });
    } catch (error) { if (error.code === 11000) return; throw error; }
    const linked = await Booking.find({ telegramChatId: chatId, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).limit(2);
    if (linked.length !== 1) {
      await Message.updateOne({ _id: inbound._id }, { $set: { processingStatus: 'NEEDS_STAFF' } });
      await recordAndReply(ctx, inbound, 'Your message has been recorded, but this chat is not linked to one confirmed active stay. Please contact reception to link your stay.');
      return;
    }
    booking = linked[0]; inbound.bookingId = booking._id; inbound.processingStatus = 'PROCESSING'; await inbound.save();
    const [history, tickets] = await Promise.all([
      Message.find({ bookingId: booking._id, _id: { $ne: inbound._id }, $or: [{ direction: 'INBOUND' }, { direction: 'OUTBOUND', providerMessageId: { $ne: null } }] }).select('direction text createdAt').sort({ createdAt: -1, _id: -1 }).limit(20).lean(),
      TaskTicket.find({ bookingId: booking._id, status: { $in: openStatuses } }).sort({ updatedAt: -1 }).limit(20).lean(),
    ]);
    if (text.length > 4000) throw new Error('Guest message exceeds AI processing limit.');
    let decision;
    try {
      decision = await interpretGuestMessage({ text, hotel, booking, history: history.reverse(), tickets });
    } catch (error) {
      decision = serviceFallback(text, tickets);
      if (!decision) throw error;
      console.warn('AI unavailable; local fallback used:', error.name);
    }
    const outcome = await applyDecision(decision, inbound, booking, tickets);
    inbound.processingStatus = outcome.needsStaff ? 'NEEDS_STAFF' : 'PROCESSED';
    inbound.aiAction = decision.action; inbound.ticketId = outcome.ticketId; await inbound.save();
    await recordAndReply(ctx, inbound, outcome.reply);
  } catch (error) {
    console.error('Guest message processing failed:', error.name, Number(error.status) || '');
    if (!inbound) { await ctx.reply('We could not record your message. Please contact reception directly.').catch(() => {}); return; }
    let handoffRecorded = Boolean(inbound.ticketId);
    if (booking && !inbound.ticketId) {
      try {
        const ticket = await createTicket(inbound, booking, 'General Inquiry');
        inbound.ticketId = ticket._id; handoffRecorded = true;
      } catch { /* Preserve the original message even if the task queue is unavailable. */ }
    }
    await Message.updateOne({ _id: inbound._id }, { $set: { processingStatus: 'NEEDS_STAFF', aiAction: 'HANDOFF', ticketId: inbound.ticketId || null, lastError: 'Automatic interpretation could not finish.' } }).catch(() => {});
    await recordAndReply(ctx, inbound, handoffRecorded
      ? 'Automatic assistance could not finish. Your message is recorded in the staff request queue. Please contact reception directly for immediate assistance.'
      : 'Your message was recorded, but automatic assistance could not finish. Please contact reception directly.').catch(() => {});
  }
}
module.exports = { processGuestMessage, applyDecision };
