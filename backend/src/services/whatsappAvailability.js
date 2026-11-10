const { availableRooms } = require('./roomInventory');

const handoff = 'Reception will need to check this for you. I’ve left your message for the team.';
const bookingEnquiry = /\b(?:room availability|availability (?:for|of) (?:a |your )?rooms?|available rooms?|rooms?\s+(?:is\s+|are\s+)?available|(?:book|reserve)\s+(?:(?:a|an|the)\s+)?(?:room|stay|accommodation))\b/i;
const confirmationRequest = /\b(?:confirm (?:my|the|this) (?:reservation|booking)|(?:book|reserve) (?:it|that room|that one))\b/i;
const dateRange = /\b(\d{4}-\d{2}-\d{2}|today|tomorrow)\s+(?:to|until|through)\s+(\d{4}-\d{2}-\d{2}|today|tomorrow)\b/i;
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

const enquiryWindowMs = 30 * 60000;

function parseStayRange(text, now) {
  const range = text.match(dateRange);
  if (!range) return null;
  return validateStayRange(range[1], range[2], now);
}

function validateStayRange(arrival, departure, now) {
  const arrivalAt = stayDate(arrival, '14', now);
  const departureAt = stayDate(departure, '12', now);
  if (!arrivalAt || !departureAt || lagosDay.format(arrivalAt) < lagosDay.format(now) || arrivalAt >= departureAt) return null;
  return { arrivalAt, departureAt };
}

async function answerAvailability({ arrivalDate, departureDate, now, category }) {
  const range = validateStayRange(arrivalDate, departureDate, now);
  if (!range) return { reply: 'Could you confirm your check-in and checkout dates?', action: 'CLARIFY' };
  const { arrivalAt, departureAt } = range;
  if (arrivalAt <= now) return { reply: handoff, action: 'HANDOFF', dates: range };

  try {
    const rooms = await availableRooms({ arrivalAt, departureAt });
    const dates = `${guestDate.format(arrivalAt)} to ${guestDate.format(departureAt)}`;
    if (!rooms.length) {
      return { reply: `There are no rooms available for ${dates}. Would you like me to check different dates?`, action: 'CLARIFY', dates: range };
    }
    const categories = [...new Set(rooms.map(room => room.category))].sort();
    if (category && !categories.some(name => name.toLowerCase() === category.toLowerCase())) {
      return {
        reply: `I can’t offer that room category for ${dates}. These categories are available: ${categories.join(', ')}. Would any of those work for you?`,
        action: 'ANSWER',
        dates: range,
      };
    }
    return {
      reply: `For ${dates}, we currently have availability in these room categories: ${categories.join(', ')}. Standard check-in is 2 p.m. and checkout is noon. Reception can confirm a reservation for you.`,
      action: 'ANSWER',
      dates: range,
    };
  } catch (error) {
    console.warn('WhatsApp availability lookup failed:', error.name);
    return { reply: handoff, action: 'HANDOFF', dates: range };
  }
}

module.exports = { answerAvailability, handoff, lagosDay, enquiryWindowMs, parseStayRange, bookingEnquiry, confirmationRequest };
