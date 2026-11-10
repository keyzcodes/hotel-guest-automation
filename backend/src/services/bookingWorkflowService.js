const mongoose = require('mongoose');
const Enquiry = require('../models/BookingEnquiry');
const Message = require('../models/Message');
const Reservation = require('../models/Reservation');
const { availableRooms, reserve, RoomConflict } = require('./roomInventory');
const { advance, datesText, stayRange } = require('./bookingWorkflow');
const settings = require('./bookingWorkflowSettings');

const scope = { hotelId: settings.hotelId };
const jidPattern = /^[1-9]\d{7,14}@s\.whatsapp\.net$/;
const publish = kind => require('./realtimeService').publishChange(kind);

async function forGuest(chatId, text) {
  if (!settings.enabled() || !jidPattern.test(chatId)) return undefined;
  const [profile, latest] = await Promise.all([
    settings.load(),
    Enquiry.findOne({ ...scope, chatId }).sort({ open: -1, updatedAt: -1, _id: -1 }).lean(),
  ]);
  if (!profile) return undefined;
  return {
    settings: profile,
    staffContext: latest?.open ? {
      ...latest.details,
      state: latest.state,
      quote: latest.quote?.category ? latest.quote : undefined,
    } : { state: 'NO_ENQUIRY' },
    progress: latest ? {
      state: latest.state,
      details: latest.open ? latest.details : undefined,
      quotedCategory: latest.quote?.category,
      quotedNights: latest.quote?.nights,
      staffQuestion: latest.state === 'NEEDS_DETAILS' ? latest.staffQuestion : undefined,
    } : null,
    async handle(decision) {
      let current = latest;
      if (latest?.state === 'CONFIRMED' && ['STATUS', 'ACCEPT'].includes(decision.intent)) {
        const reservation = await Reservation.findById(latest.reservationId).select('cancelledAt').lean();
        if (!reservation || reservation.cancelledAt) current = { ...latest, state: 'CANCELLED' };
      }
      const outcome = await advance({ decision, current, settings: profile, availableRooms, now: new Date(), text });
      if (outcome.next) {
        if (latest?.open) {
          const changed = await Enquiry.updateOne({ ...scope, _id: latest._id, version: latest.version }, {
            $set: outcome.next, $inc: { version: 1 },
          }, { runValidators: true });
          if (!changed.modifiedCount) {
            return { action: 'CLARIFY', reply: 'Reception or another message updated this enquiry. Please send your last request again.', workflowHandled: true };
          }
        } else {
          try {
            await Enquiry.create({ ...scope, chatId, open: true, ...outcome.next });
          } catch (error) {
            if (error.code !== 11000) throw error;
            return { action: 'CLARIFY', reply: 'An enquiry is already open for this chat. Please send your last request again.', workflowHandled: true };
          }
        }
        await publish('Message');
      }
      return { action: 'ANSWER', reply: outcome.reply, workflowHandled: true,
        conversational: outcome.conversational, quoteTerms: outcome.quoteTerms };
    },
  };
}

async function inbox() {
  if (!settings.enabled()) return [];
  const enquiries = await Enquiry.find({ ...scope, state: { $in: ['PENDING', 'NEEDS_DETAILS', 'CONFIRMED', 'DECLINED'] } })
    .select('chatId state details quote staffQuestion guestAnswer depositVerifiedAt reservationId decisionMessageId version')
    .sort({ open: -1, updatedAt: -1 }).limit(50).lean();
  const ids = enquiries.flatMap(item => item.decisionMessageId ? [item.decisionMessageId] : []);
  const delivery = await Message.find({ _id: { $in: ids } }).select('deliveryState').lean();
  const states = new Map(delivery.map(item => [String(item._id), item.deliveryState]));
  return enquiries.map(item => ({ ...item, deliveryState: states.get(String(item.decisionMessageId)) }));
}

async function decide({ id, version, action, depositVerified, question, actor }) {
  if (!settings.enabled()) throw new RoomConflict('Booking decisions are unavailable.');
  if (!['confirm', 'decline', 'ask'].includes(action) || !actor ||
      (action === 'ask' && (typeof question !== 'string' || !question.trim() || question.length > 1000))) {
    throw new RoomConflict('Provide a valid reception decision.');
  }
  const current = await Enquiry.findOne({ ...scope, _id: id }).lean();
  if (!current || current.state !== 'PENDING' || current.version !== version) {
    throw new RoomConflict('This enquiry has changed. Refresh before deciding.');
  }
  const { quote, details, chatId } = current;
  if (!jidPattern.test(chatId) || !quote || !details.guestName) throw new RoomConflict('The enquiry is incomplete.');
  let rooms = [];
  let profile;
  if (action === 'confirm') {
    if (quote.depositMinor && depositVerified !== true) throw new RoomConflict('Verify the required deposit before confirming.');
    profile = await settings.load();
    const range = profile && stayRange(details, profile, new Date());
    if (!range || +range.arrivalAt !== +quote.arrivalAt || +range.departureAt !== +quote.departureAt) {
      throw new RoomConflict('The stay dates or hotel hours have changed. Ask the guest for new details.');
    }
    rooms = (await availableRooms(quote)).filter(room => room.category === quote.category);
    if (!rooms.length) throw new RoomConflict('This category is sold out. Ask the guest about different dates or a different room.');
  }
  const state = { confirm: 'CONFIRMED', decline: 'DECLINED', ask: 'NEEDS_DETAILS' }[action];
  await mongoose.connection.transaction(async session => {
    const candidate = await Enquiry.findOne({ ...scope, _id: id, state: 'PENDING', version }).session(session);
    if (!candidate) throw new RoomConflict('This enquiry has changed. Refresh before deciding.');
    let reservation;
    if (action === 'confirm') {
      for (const room of rooms) {
        try {
          reservation = await reserve({
            roomId: room._id, arrivalAt: quote.arrivalAt, departureAt: quote.departureAt,
            guestName: details.guestName, guestPhone: chatId.split('@')[0],
          }, { session, category: quote.category });
          break;
        } catch (error) {
          if (!(error instanceof RoomConflict)) throw error;
        }
      }
      if (!reservation) throw new RoomConflict('This category is sold out. Ask the guest about different dates or a different room.');
    }
    const text = reservation
      ? `Your ${quote.category} booking is confirmed for ${datesText(quote)}. Your reference is ${reservation._id}. Check-in starts at ${profile.checkInTime} (Lagos time).`
      : action === 'ask' ? question : 'Reception couldn’t confirm your booking request. Please let me know if you’d like me to check other options.';
    // Reservation, decision and outbound queue entry commit together.
    const [outbound] = await Message.create([{
      direction: 'OUTBOUND', channel: 'WHATSAPP', chatId, sender: 'SYSTEM', text,
      idempotencyKey: `BOOKING_DECISION:${id}:${version}`,
      deliveryState: 'PENDING', processingStatus: 'NOT_APPLICABLE',
    }], { session });
    candidate.state = state;
    candidate.open = state === 'NEEDS_DETAILS';
    candidate.staffQuestion = action === 'ask' ? question : undefined;
    candidate.guestAnswer = undefined;
    candidate.decidedBy = actor;
    candidate.decisionMessageId = outbound._id;
    candidate.version += 1;
    if (reservation) {
      candidate.reservationId = reservation._id;
      if (quote.depositMinor) candidate.depositVerifiedAt = new Date();
    }
    await candidate.save({ session });
  });
  await publish('Message');
  if (action === 'confirm') await publish('Reservation');
}

module.exports = { forGuest, inbox, decide };
