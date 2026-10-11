const TaskTicket = require('../models/TaskTicket');
const Booking = require('../models/Booking');
const Message = require('../models/Message');
async function completeTask(id) {
  const ticket = await TaskTicket.findById(id);
  if (!ticket) return { code: 404, success: false, message: 'Request not found.' };
  if (ticket.category === 'Front Desk') return { code: 409, success: false, message: 'This request needs a reception decision. Completing a task cannot approve extensions, payments or checkout.' };
  const booking = ticket.bookingId && await Booking.findById(ticket.bookingId);
  if (!booking || !booking.telegramChatId || !['ACTIVE', 'EXTENDED'].includes(booking.stayStatus)) return { code: 409, success: false, message: 'An active stay linked to Telegram is required to complete and notify.' };
  const owners = await Booking.find({ telegramChatId: booking.telegramChatId, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).select('_id').limit(2);
  if (owners.length !== 1 || String(owners[0]._id) !== String(booking._id)) return { code: 409, success: false, message: 'Resolve the ambiguous guest chat link first.' };
  // The unique message key claims the notification before any external send.
  const key = `TASK_DONE:${ticket._id}`;
  let outgoing = await Message.findOne({ idempotencyKey: key });
  let ownsSend = false;
  if (!outgoing) {
    try {
      outgoing = await Message.create({ bookingId: booking._id, channel: 'TELEGRAM', chatId: booking.telegramChatId, direction: 'OUTBOUND', sender: 'SYSTEM', text: `Our ${ticket.category} team has marked your request as completed:\n\n${ticket.requestText.slice(0, 1200)}\n\nIf you still need help, please reply here.`, idempotencyKey: key, processingStatus: 'NOT_APPLICABLE', deliveryState: 'PENDING' });
      ownsSend = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      outgoing = await Message.findOne({ idempotencyKey: key });
      if (!outgoing) throw error;
    }
  }
  const saved = await TaskTicket.findByIdAndUpdate(id, { $set: { status: 'Resolved' } }, { new: true, runValidators: true });
  if (ownsSend) {
    try {
      const sent = await require('./telegramService').sendStaffReply(booking.telegramChatId, outgoing.text);
      outgoing.providerMessageId = String(sent.message_id);
      outgoing.deliveryState = 'SENT';
      await outgoing.save();
    } catch {
      outgoing.deliveryState = 'UNKNOWN';
      await Message.updateOne({ _id: outgoing._id }, { $set: { deliveryState: 'UNKNOWN', lastError: 'Completion message delivery could not be confirmed.' } }).catch(() => {});
    }
  }
  return { code: 200, success: true, data: saved, notificationState: outgoing.deliveryState, message: outgoing.deliveryState === 'SENT' ? 'Request completed. Confirmation sent to Telegram.' : 'Request completed. Guest notification is pending or unconfirmed; check Telegram before sending another message.' };
}
module.exports = { completeTask };
