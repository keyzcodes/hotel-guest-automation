const mongoose = require('mongoose');
const Message = require('../models/Message');
const Room = require('../models/Room');
const TaskTicket = require('../models/TaskTicket');
const { phoneJid } = require('./whatsappIdentity');
const settings = require('./bookingWorkflowSettings');
const hotel = require('../config/hotel');

function enabled() {
  return process.env.WHATSAPP_DEMO_GM_SUMMARY_ENABLED === 'true' &&
    process.env.GUEST_CHANNEL === 'WHATSAPP' && process.env.ROOM_BOARD_ENABLED === 'true';
}

function initialize() {
  if (process.env.WHATSAPP_DEMO_GM_SUMMARY_ENABLED !== 'true') return;
  if (!enabled() || mongoose.connection.name !== 'sesora_whatsapp_lab') {
    throw Error('GM demo summaries require the WhatsApp lab database and room board.');
  }
  if (!phoneJid(process.env.WHATSAPP_GM_SUMMARY_PHONE)) {
    throw Error('Set WHATSAPP_GM_SUMMARY_PHONE to the WhatsApp number receiving the demo summary.');
  }
  console.info('GM demo summary enabled for confirmed checkout.');
}

async function queue(booking, session) {
  if (!enabled() || !booking.whatsappJid) return;
  const recipient = phoneJid(process.env.WHATSAPP_GM_SUMMARY_PHONE);
  if (!recipient) throw Error('GM demo summary recipient is invalid.');
  const profile = await settings.load({ session });
  const tickets = await TaskTicket.find({ bookingId: booking._id }).select('status').session(session).lean();
  const rooms = await Room.find().select('number housekeeping outOfOrder activeBookingId').sort({ number: 1 }).session(session).lean();
  const groups = { Ready: [], Occupied: [], 'Awaiting cleaning': [], 'Out of service': [] };
  for (const room of rooms) {
    const state = room.outOfOrder ? 'Out of service' : room.activeBookingId ? 'Occupied'
      : room.housekeeping === 'READY' ? 'Ready' : 'Awaiting cleaning';
    groups[state].push(room.number);
  }
  const completed = tickets.filter(ticket => ticket.status === 'Resolved').length;
  const board = Object.entries(groups).flatMap(([state, numbers]) => [
    `*${state} — ${numbers.length}*`, numbers.join(' · ') || 'None', '',
  ]);
  const text = [
    `*${profile?.name || hotel.name}*`,
    '*Demo Operations Report*', '',
    `Guest — ${booking.guestName}`,
    `Room — ${booking.roomNumber}`, '',
    '*Activity for this demo stay*',
    '• 1 guest checked in',
    `• ${tickets.length} service ${tickets.length === 1 ? 'request' : 'requests'} recorded`,
    `• ${completed} ${completed === 1 ? 'request' : 'requests'} marked completed by staff`,
    '• 1 checkout confirmed',
    `• ${tickets.length - completed} ${tickets.length - completed === 1 ? 'request remains' : 'requests remain'} open for this stay`,
    '', `*Current room board · ${rooms.length} rooms*`, '',
    ...board,
    '_Generated automatically from recorded hotel activity._', '',
    '*Powered by Sesora*',
  ].join('\n');
  // Queue in the checkout transaction. One stay creates one summary even on retry.
  await Message.create([{
    channel: 'WHATSAPP', direction: 'OUTBOUND', sender: 'SYSTEM', chatId: recipient,
    text, idempotencyKey: `DEMO_GM_SUMMARY:${booking._id}`,
    processingStatus: 'NOT_APPLICABLE', deliveryState: 'PENDING',
  }], { session });
}

module.exports = { enabled, initialize, queue };
