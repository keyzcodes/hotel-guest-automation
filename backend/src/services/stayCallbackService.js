const Booking = require('../models/Booking');
const Message = require('../models/Message');
const actions = {
  PULSE_GOOD: { type: 'PULSE_CHECK', text: 'Everything’s good', pulse: 'ALL_GOOD' },
  PULSE_ISSUE: { type: 'PULSE_CHECK', text: 'I need help', pulse: 'ISSUE_REPORTED' },
  CHECKOUT_NOW: { type: 'PRE_CHECKOUT', text: 'Ready to leave' },
  EXTEND_STAY: { type: 'PRE_CHECKOUT', text: 'Request extension' },
};
async function runStayCallback(ctx, handler, dependencies = {}) {
  const bookings = dependencies.Booking || Booking;
  const messages = dependencies.Message || Message;
  const match = /^(PULSE_GOOD|PULSE_ISSUE|CHECKOUT_NOW|EXTEND_STAY)_(.+)$/.exec(ctx.callbackQuery.data);
  if (!match || ctx.chat?.type !== 'private' || String(ctx.from?.id) !== String(ctx.chat.id)) return;
  const action = actions[match[1]], chatId = String(ctx.chat.id);
  // Resolve the exact stay from the saved prompt, including legacy room buttons.
  // A new occupant in the same room never inherits an older stay's buttons.
  const prompt = await messages.findOne({ chatId, direction: 'OUTBOUND', sender: 'SYSTEM', deliveryState: 'SENT', providerMessageId: String(ctx.callbackQuery.message?.message_id) });
  if (!prompt?.bookingId) return;
  const expectedKey = `JOB:${prompt.bookingId}:${action.type}`;
  if (action.type === 'PULSE_CHECK' ? prompt.idempotencyKey !== expectedKey : !prompt.idempotencyKey?.startsWith(expectedKey + ':')) return;
  const booking = await bookings.findOne({ _id: prompt.bookingId, telegramChatId: chatId, roomNumber: match[2], stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } });
  if (!booking) return;
  if (action.type === 'PRE_CHECKOUT' && prompt.idempotencyKey !== `JOB:${booking._id}:PRE_CHECKOUT:${new Date(booking.checkOutTime).toISOString()}`) return;
  const owners = await bookings.find({ telegramChatId: chatId, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).select('_id').limit(2);
  if (owners.length !== 1 || String(owners[0]._id) !== String(booking._id)) return;
  const key = `CALLBACK:${ctx.callbackQuery.id}`;
  let inbound;
  try {
    inbound = await messages.create({ bookingId: booking._id, channel: 'TELEGRAM', chatId, direction: 'INBOUND', text: action.text, idempotencyKey: key, processingStatus: 'PROCESSING' });
  } catch (error) { if (error.code === 11000) return; throw error; }
  try {
    if (action.pulse) await bookings.updateOne({ _id: booking._id, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }, { $set: { pulseCheckStatus: action.pulse } });
    // Persist each acknowledgement before sending. Never retry uncertain sends.
    let replyIndex = 0;
    const wrapped = Object.create(ctx, { reply: { value: async (text, options) => {
      const outgoing = await messages.create({ bookingId: booking._id, channel: 'TELEGRAM', chatId, direction: 'OUTBOUND', sender: 'SYSTEM', text, idempotencyKey: `${key}:REPLY:${replyIndex++}`, processingStatus: 'NOT_APPLICABLE', deliveryState: 'PENDING' });
      try { const sent = await ctx.reply(text, options); outgoing.providerMessageId = String(sent.message_id); outgoing.deliveryState = 'SENT'; await outgoing.save(); return sent; }
      catch (error) { await messages.updateOne({ _id: outgoing._id }, { $set: { deliveryState: 'UNKNOWN', lastError: 'Button reply delivery could not be confirmed.' } }).catch(() => {}); throw error; }
    } } });
    await handler(wrapped);
    await messages.updateOne({ _id: inbound._id }, { $set: { processingStatus: 'PROCESSED' } });
  } catch (error) {
    await messages.updateOne({ _id: inbound._id }, { $set: { processingStatus: 'NEEDS_STAFF', aiAction: 'HANDOFF', lastError: 'Button action could not finish.' } }).catch(() => {});
    throw error;
  }
}
module.exports = { runStayCallback };
