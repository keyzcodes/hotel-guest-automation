const TaskTicket = require('../models/TaskTicket');
const Message = require('../models/Message');
const openStatuses = ['Pending', 'In Progress', 'Escalated'];

// Reviews are decisions/questions, not physical services. Older unclassified
// General Inquiry tickets are treated conservatively as reception reviews.
function isReceptionCategory(ticket) {
  return Boolean(ticket.staffReviewKey) || ['Front Desk', 'General Inquiry'].includes(ticket.category);
}
function relatedMessages(ticket) {
  const ids = [ticket.sourceMessageId, ...(ticket.guestUpdates || []).map(update => update.messageId)].filter(Boolean);
  return {
    bookingId: ticket.bookingId,
    direction: 'INBOUND',
    $or: [{ ticketId: ticket._id }, { _id: { $in: ids } }],
  };
}
async function requiresReceptionReview(ticket, messages = Message) {
  if (isReceptionCategory(ticket)) return true;
  // A HANDOFF can belong to Maintenance or another department, too.
  return Boolean(await messages.exists({ ...relatedMessages(ticket), aiAction: 'HANDOFF' }));
}
async function annotateTickets(tickets, messages = Message) {
  if (!tickets.length) return [];
  const ids = tickets.map(ticket => ticket._id);
  const sourceIds = tickets.flatMap(ticket => [ticket.sourceMessageId, ...(ticket.guestUpdates || []).map(update => update.messageId)]).filter(Boolean);
  // One lookup for the list; avoid a separate database query for every row.
  const handoffs = await messages.find({ direction: 'INBOUND', aiAction: 'HANDOFF', $or: [{ ticketId: { $in: ids } }, { _id: { $in: sourceIds } }] }).select('_id ticketId bookingId').lean();
  return tickets.map(ticket => {
    const value = ticket.toObject ? ticket.toObject() : ticket;
    const relatedIds = new Set([ticket.sourceMessageId, ...(ticket.guestUpdates || []).map(update => update.messageId)].filter(Boolean).map(String));
    const hasHandoff = handoffs.some(message => String(message.bookingId) === String(ticket.bookingId) && (String(message.ticketId) === String(ticket._id) || relatedIds.has(String(message._id))));
    return { ...value, requiresReceptionReview: isReceptionCategory(ticket) || hasHandoff };
  });
}
async function closeReview(id, dependencies = {}) {
  const tickets = dependencies.TaskTicket || TaskTicket;
  const messages = dependencies.Message || Message;
  const ticket = await tickets.findById(id);
  if (!ticket) return { code: 404, success: false, message: 'Review not found.' };
  if (!await requiresReceptionReview(ticket, messages)) return { code: 409, success: false, message: 'This is a service request. Use Complete & notify.' };
  // A repeated closure is harmless and never sends another message.
  if (ticket.status === 'Resolved') return { code: 200, success: true, data: { ...(ticket.toObject ? ticket.toObject() : ticket), requiresReceptionReview: true }, message: 'Review closed.' };
  if (!ticket.bookingId) return { code: 409, success: false, message: 'Link this review to a stay before closing it.' };
  const related = relatedMessages(ticket);
  // Reading or a system acknowledgement is insufficient: staffAnsweredAt is
  // recorded only after a staff reply has been saved as SENT.
  if (!await messages.exists(related) || await messages.exists({ ...related, staffAnsweredAt: null })) {
    return { code: 409, success: false, message: 'Reply to the guest before closing this review.' };
  }
  // A guest update during review changes updatedAt. Refuse to hide that update.
  const saved = await tickets.findOneAndUpdate({ _id: id, status: { $in: openStatuses }, updatedAt: ticket.updatedAt, $expr: { $eq: [{ $size: { $ifNull: ['$guestUpdates', []] } }, (ticket.guestUpdates || []).length] } }, { $set: { status: 'Resolved' } }, { returnDocument: 'after', runValidators: true });
  if (!saved) return { code: 409, success: false, message: 'This review changed. Refresh and check the latest guest messages.' };
  return { code: 200, success: true, data: { ...(saved.toObject ? saved.toObject() : saved), requiresReceptionReview: true }, message: 'Review closed.' };
}
module.exports = { isReceptionCategory, relatedMessages, requiresReceptionReview, annotateTickets, closeReview };
