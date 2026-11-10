const { bookingEnquiry, confirmationRequest, enquiryWindowMs, parseStayRange } = require('./whatsappAvailability');

// Before the bookingEnquiry flag, availability replies used these actions on unlinked inbound records.
const enquiryMatches = [
  { bookingEnquiry: true },
  { bookingEnquiry: { $ne: false }, aiAction: { $in: ['ANSWER', 'CLARIFY'] } },
  { bookingEnquiry: { $ne: false }, aiAction: 'HANDOFF', text: { $in: [bookingEnquiry, confirmationRequest] } },
];

function groupBookingEnquiries(newestFirst) {
  const active = new Map();
  const enquiries = [];
  for (const message of [...newestFirst].reverse()) {
    const createdAt = new Date(message.createdAt);
    let enquiry = active.get(message.chatId);
    if (!enquiry || createdAt - new Date(enquiry.lastActivity) > enquiryWindowMs) {
      enquiry = { _id: message._id, chatId: message.chatId, messages: [], dates: null, awaitingReception: false };
      active.set(message.chatId, enquiry);
      enquiries.push(enquiry);
    }
    enquiry.lastActivity = message.createdAt;
    const dates = message.bookingEnquiryDates?.arrivalAt && message.bookingEnquiryDates?.departureAt
      ? message.bookingEnquiryDates : parseStayRange(message.text, createdAt);
    if (dates) enquiry.dates = dates;
    if (message.processingStatus === 'NEEDS_STAFF') enquiry.awaitingReception = true;
    enquiry.messages.push({ _id: message._id, text: message.text, createdAt: message.createdAt });
  }
  return enquiries.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}

module.exports = { enquiryMatches, groupBookingEnquiries };
