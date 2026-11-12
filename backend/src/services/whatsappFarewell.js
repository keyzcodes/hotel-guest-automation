const Message = require('../models/Message');
const settings = require('./bookingWorkflowSettings');
const hotel = require('../config/hotel');

function enabled() {
  return process.env.GUEST_CHANNEL === 'WHATSAPP' &&
    process.env.WHATSAPP_STAY_MESSAGES_ENABLED === 'true' &&
    process.env.GUEST_MESSAGING_ENABLED !== 'false';
}

async function queue(booking, session) {
  if (!enabled() || !/^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(booking.whatsappJid || '')) return;
  const profile = await settings.load({ session });
  const name = profile?.name || hotel.name;
  await Message.create([{
    bookingId: booking._id, channel: 'WHATSAPP', direction: 'OUTBOUND', sender: 'SYSTEM',
    chatId: booking.whatsappJid,
    text: `*Thank you for staying with ${name}*\n\nHello ${booking.guestName}, your checkout from *Room ${booking.roomNumber}* is complete.\n\nIt was a pleasure having you with us. We wish you a safe onward journey and look forward to welcoming you again.\n\n*${name} · Guest Services*\nPowered by Sesora`,
    idempotencyKey: `WHATSAPP_FAREWELL:${booking._id}`,
    processingStatus: 'NOT_APPLICABLE', deliveryState: 'PENDING',
  }], { session });
}

module.exports = { enabled, queue };
