const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enquiryMatches, groupBookingEnquiries } = require('../src/services/bookingEnquiryInbox');

const sender = '2348000000000@s.whatsapp.net';
const secondSender = '2348000000001@s.whatsapp.net';
function inbound(_id, clock, text, processingStatus = 'PROCESSED', chatId = sender) {
  return { _id, createdAt: new Date(`2026-11-09T${clock}:00Z`), text, processingStatus, chatId };
}

test('enquiry inbox groups a date request and its reception handoff in one entry', () => {
  const initial = inbound('a', '01:08', 'Do you have any rooms available?');
  const dates = inbound('b', '01:09', '2026-11-10 to 2026-11-11');
  const handoff = inbound('c', '01:10', 'Please book it', 'NEEDS_STAFF');
  const [group, ...others] = groupBookingEnquiries([handoff, dates, initial]);
  assert.equal(others.length, 0);
  assert.equal(group.chatId, sender);
  assert.equal(group.awaitingReception, true);
  assert.deepEqual(group.messages.map(message => message._id), ['a', 'b', 'c']);
  assert.equal(group.dates.arrivalAt.toISOString(), '2026-11-10T13:00:00.000Z');
  assert.equal(group.dates.departureAt.toISOString(), '2026-11-11T11:00:00.000Z');
});

test('a later enquiry starts fresh and relative dates use the sender’s original message time', () => {
  const earlier = inbound('a', '01:00', 'Tomorrow to 2026-11-11');
  const other = inbound('b', '01:15', 'Any rooms available?', 'PROCESSED', secondSender);
  const later = inbound('c', '01:40', 'Please book it', 'NEEDS_STAFF');
  const groups = groupBookingEnquiries([later, other, earlier]);
  assert.deepEqual(groups.map(group => group._id), ['c', 'b', 'a']);
  assert.equal(groups[0].dates, null);
  assert.equal(groups[1].awaitingReception, false);
  assert.equal(groups[2].dates.arrivalAt.toISOString(), '2026-11-10T13:00:00.000Z');
});

test('legacy enquiry filters recognize an earlier booking handoff and exclude general guest messages', () => {
  const legacyHandoff = enquiryMatches.find(filter => filter.aiAction === 'HANDOFF');
  assert(legacyHandoff.text.$in.some(pattern => pattern.test('Please book it')));
  assert(legacyHandoff.text.$in.some(pattern => pattern.test('Any rooms available?')));
  assert(legacyHandoff.text.$in.every(pattern => !pattern.test('Please send towels')));
  assert(enquiryMatches.some(filter => filter.bookingEnquiry === true));
});
