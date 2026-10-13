// Reading and responding are independent. All writes are scoped to one stay.
function unreadFilter(bookingId, messageIds) {
  return { bookingId, direction: 'INBOUND', staffReadAt: null, _id: { $in: messageIds } };
}
function answeredFilter(bookingId, through) {
  return {
    bookingId, direction: 'INBOUND', staffAnsweredAt: null,
    $or: [
      { createdAt: { $lt: new Date(through.createdAt) } },
      { createdAt: new Date(through.createdAt), _id: { $lte: through.messageId } },
    ],
  };
}
async function acknowledgeReply(messages, reply) {
  const through = reply.staffReplyThrough;
  if (reply.deliveryState !== 'SENT' || !through?.messageId || !through.createdAt) return;
  await messages.updateMany(answeredFilter(reply.bookingId, through), {
    $set: { staffAnsweredAt: reply.createdAt },
  });
}
function attentionLookup(collectionName) {
  return { $lookup: {
    from: collectionName, let: { booking: '$_id' },
    pipeline: [
      { $match: { direction: 'INBOUND', $expr: { $eq: ['$bookingId', '$$booking'] } } },
      { $group: {
        _id: null,
        unreadCount: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$staffReadAt', null] }, null] }, 1, 0] } },
        needsReplyCount: { $sum: { $cond: [{ $and: [
          { $eq: ['$processingStatus', 'NEEDS_STAFF'] },
          { $eq: ['$aiAction', 'HANDOFF'] },
          { $eq: [{ $ifNull: ['$staffAnsweredAt', null] }, null] },
        ] }, 1, 0] } },
      } },
    ], as: 'attention',
  } };
}
module.exports = { unreadFilter, answeredFilter, acknowledgeReply, attentionLookup };
