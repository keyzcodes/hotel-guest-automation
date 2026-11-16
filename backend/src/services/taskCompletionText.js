const hotel = require('../config/hotel');

function completionText(ticket, booking) {
  const name = String(booking.guestName || ticket.guestName || '').trim().split(/\s+/)[0];
  const displayName = name ? name[0].toLocaleUpperCase() + name.slice(1) : '';
  const greeting = displayName ? `Hello ${displayName},` : 'Hello,';
  // Completing this physical-service ticket confirms fulfilment. Recognise only
  // a simple towel-delivery request; never infer a repair/delivery from keywords
  // embedded in a complaint, a question, or a multi-part request.
  const towelDelivery = ticket.category === 'Housekeeping' &&
    /^(?:please\s+)?(?:bring|send|deliver)(?:\s+me)?\s+(?:(?:a|some|extra|one|two|three|four|\d+)\s+)?(?:clean\s+)?towels?(?:\s+to\s+(?:my|the)\s+room)?[.!]?$/i.test(ticket.requestText.trim());
  const outcome = towelDelivery
    ? /\btowels\b/i.test(ticket.requestText) ? 'your towels have been delivered.' : 'your towel has been delivered.'
    : 'our team has completed your request.';
  return `${greeting} ${outcome} Please let us know if you need anything else.\n\n*${hotel.name} · Guest Services*\nPowered by Sesora`;
}

module.exports = { completionText };
