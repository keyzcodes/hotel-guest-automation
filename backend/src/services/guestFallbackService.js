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
module.exports = { greetingFallback };
