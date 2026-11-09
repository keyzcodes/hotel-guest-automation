const { availableRooms } = require('./roomInventory');

const datePrompt = 'What dates would you like to check in and check out? Please send both dates in this format: YYYY-MM-DD to YYYY-MM-DD.';
const handoff = 'Reception will need to check this for you. I’ve left your message for the team.';
const bookingEnquiry = /\b(?:room availability|availability (?:for|of) (?:a |your )?rooms?|available rooms?|rooms?\s+(?:is\s+|are\s+)?available|(?:book|reserve)\s+(?:(?:a|an|the)\s+)?(?:room|stay|accommodation))\b/i;
const needsReview = /\b(?:cancel|change|extend|refund|payment|pay|early|late|rates?|prices?|cost|how much)\b/i;
const confirmationRequest = /\b(?:confirm (?:my|the|this) (?:reservation|booking)|(?:book|reserve) (?:it|that room|that one))\b/i;
const dateRange = /\b(\d{4}-\d{2}-\d{2}|today|tomorrow)\s+(?:to|until|through)\s+(\d{4}-\d{2}-\d{2}|today|tomorrow)\b/i;
const dateReply = /^(?:from\s+)?(?:\d{4}-\d{2}-\d{2}|today|tomorrow)\s+(?:to|until|through)\s+(?:\d{4}-\d{2}-\d{2}|today|tomorrow)[.!]?$/i;
const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });
const guestDate = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });

function stayDate(token, hour, now) {
  const word = token.toLowerCase();
  const day = word === 'today' ? lagosDay.format(now)
    : word === 'tomorrow' ? lagosDay.format(new Date(now.getTime() + 86400000))
    : word;
  const date = new Date(`${day}T${hour}:00:00+01:00`);
  return Number.isFinite(date.getTime()) && lagosDay.format(date) === day ? date : null;
}

async function answerAvailability({ text, awaitingDates, now = new Date() }) {
  const enquiry = bookingEnquiry.test(text);
  if (confirmationRequest.test(text)) return { reply: handoff, action: 'HANDOFF' };
  if (!enquiry && !awaitingDates) return null;
  if (needsReview.test(text)) return { reply: handoff, action: 'HANDOFF' };
  if (!enquiry && !dateReply.test(text.trim())) return null;

  const range = text.match(dateRange);
  if (!range) return { reply: datePrompt, action: 'CLARIFY' };
  const arrivalAt = stayDate(range[1], '14', now);
  const departureAt = stayDate(range[2], '12', now);
  if (!arrivalAt || !departureAt || lagosDay.format(arrivalAt) < lagosDay.format(now) || arrivalAt >= departureAt) {
    return { reply: `Please send a valid check-in date and a later checkout date. ${datePrompt}`, action: 'CLARIFY' };
  }
  if (arrivalAt <= now) return { reply: handoff, action: 'HANDOFF' };

  try {
    const rooms = await availableRooms({ arrivalAt, departureAt });
    const dates = `${guestDate.format(arrivalAt)} to ${guestDate.format(departureAt)}`;
    if (!rooms.length) {
      return { reply: `There are no rooms available for ${dates}. Would you like me to check different dates? ${datePrompt}`, action: 'CLARIFY' };
    }
    const categories = [...new Set(rooms.map(room => room.category))].sort();
    return {
      reply: `For ${dates}, we currently have availability in these room categories: ${categories.join(', ')}. Standard check-in is 2 p.m. and checkout is noon. Reception can confirm a reservation for you.`,
      action: 'ANSWER',
    };
  } catch (error) {
    console.warn('WhatsApp availability lookup failed:', error.name);
    return { reply: handoff, action: 'HANDOFF' };
  }
}

module.exports = { answerAvailability, datePrompt };
