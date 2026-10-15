const Booking = require('../models/Booking');
const Message = require('../models/Message');

async function saveGuestRating(ctx, dependencies = {}) {
  const bookings = dependencies.Booking || Booking;
  const messages = dependencies.Message || Message;
  const match = /^RATING_([a-f\d]{24})_([1-5])$/i.exec(ctx.callbackQuery.data);
  const unavailable = { reply: 'This feedback invitation is no longer available. Please contact reception if you need assistance.' };
  // Bind the button to its saved invitation, chat and exact stay, not the room.
  if (!match || !ctx.chat || ctx.chat.type !== 'private' || String(ctx.from?.id) !== String(ctx.chat.id)) return unavailable;
  const [, bookingId, rawRating] = match;
  const chatId = String(ctx.chat.id);
  const invitation = await messages.findOne({
    bookingId, chatId, direction: 'OUTBOUND', sender: 'SYSTEM',
    idempotencyKey: `JOB:${bookingId}:REVIEW_REQUEST`,
    providerMessageId: String(ctx.callbackQuery.message?.message_id),
    deliveryState: 'SENT',
  });
  if (!invitation) return unavailable;
  // First selection wins: repeated taps never multiply responses or reopen stays.
  const saved = await bookings.findOneAndUpdate({
    _id: bookingId, telegramChatId: chatId, stayStatus: 'COMPLETED',
    confirmedCheckoutAt: { $ne: null }, guestRating: null,
  }, { $set: { guestRating: Number(rawRating), guestRatedAt: new Date() } },
  { returnDocument: 'after', runValidators: true });
  if (saved) return { reply: 'Thank you. Your feedback helps us care for our guests better.' };
  const previous = await bookings.findOne({ _id: bookingId, telegramChatId: chatId, stayStatus: 'COMPLETED', guestRating: { $gte: 1, $lte: 5 } });
  // The callback spinner is already acknowledged by Telegram's handler.
  // Keep repeated taps silent in chat; the original saved rating is unchanged.
  return previous ? { reply: null } : unavailable;
}

async function getGuestFeedback(req, res) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Aggregate the full period; only the three recent rows are limited.
    const [result] = await Booking.aggregate([
      { $match: { stayStatus: 'COMPLETED', guestRating: { $gte: 1, $lte: 5 }, guestRatedAt: { $gte: since } } },
      { $facet: {
        summary: [{ $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$guestRating' } } }],
        recent: [{ $sort: { guestRatedAt: -1, _id: -1 } }, { $limit: 3 }, { $project: { roomNumber: 1, guestName: 1, guestRating: 1, guestRatedAt: 1 } }],
      } },
    ]);
    const summary = result?.summary?.[0];
    return res.json({ success: true, count: summary?.count || 0, average: summary?.average ?? null, recent: result?.recent || [] });
  } catch (error) {
    console.error('Feedback lookup failed:', error.name);
    return res.status(500).json({ success: false, message: 'Could not load guest feedback.' });
  }
}
module.exports = { saveGuestRating, getGuestFeedback };
