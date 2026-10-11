// Match the whole message only. A greeting followed by a request must still be processed.
function greetingFallback(text) {
  if (typeof text !== 'string') return null;
  const normal = text.trim().toLowerCase().replace(/[.!?,]+$/g, '').trim();
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|how far|how are you|how are you doing)$/.test(normal)) {
    return { action: 'ANSWER', category: 'General Inquiry', ticketId: '', reply: 'Hello! I’m your hotel’s digital assistant. How can I help you today?' };
  }
  if (/^(thanks|thank you|thank you very much)$/.test(normal)) {
    return { action: 'ANSWER', category: 'General Inquiry', ticketId: '', reply: 'You’re welcome! Let us know if you need anything else.' };
  }
  return null;
}
function serviceFallback(text, tickets = []) {
  const greeting = greetingFallback(text);
  if (greeting) return greeting;
  if (typeof text !== 'string') return null;
  const normal = text.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  // Whole-message patterns intentionally exclude negation, timing changes and mixed requests.
  const simpleItem = /^(?:please )?(?:i need|we need|bring|send|can you bring|could you bring) (?:me |us )?(?:(?:a|an|some|one|two|three|[1-9]) )?(?:fresh |clean |extra )?(?:towels?|bath mats?|bedsheets?|bed sheets?|pillows?|blankets?)(?: please)?$/;
  if (!simpleItem.test(normal)) return null;
  if (tickets.some(ticket => ticket.category === 'Housekeeping' && ['Pending', 'In Progress', 'Escalated'].includes(ticket.status))) {
    return { action: 'CLARIFY', category: 'Housekeeping', ticketId: '', reply: 'You already have an open Housekeeping request. Is this an update to that request, or a separate new request?' };
  }
  return { action: 'CREATE_REQUEST', category: 'Housekeeping', ticketId: '', reply: '' };
}
module.exports = { greetingFallback, serviceFallback };
