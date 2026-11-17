const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, changeState } = require('../src/services/enquiryState');
const { search } = require('../src/services/enquiryPresentation');
const { runEnquiryAgent } = require('../src/services/enquiryAgent');
const settings = { name: 'Kudu Demo Hotel', checkInTime: '14:00', checkOutTime: '12:00', currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
  roomRates: [{ category: 'Luxury', capacity: 2, nightlyMinor: 11000000 }, { category: 'Junior Suite', capacity: 3, nightlyMinor: 14500000 }] };
const now = new Date('2026-11-17T08:00:00Z');
const seed = { arrivalDate: '2026-11-20', departureDate: '2026-11-22', category: 'Luxury', guests: 5 };
const rooms = count => Array.from({ length: count }, (_, index) => ({ _id: `room-${index}`, number: String(300 + index), category: 'Luxury' }));
function session(state) {
  let version = 0;
  return { id: 'synthetic', state, version, save: async (expected, next) => {
    assert.equal(expected, version); session.latest = next;
    return { version: ++version, state: next };
  } };
}
const call = (name, args) => ({ functionCalls: [{ name, args }] });

test('five rooms and five guests are distinct; partial changes retain quantity and preference', () => {
  const original = initialState(seed);
  const updated = changeState(original, { changes: { roomCount: 5 } }, settings, now);
  assert.equal(updated.status, 'UPDATED');
  assert.equal(updated.state.stay.guests, 5);
  assert.equal(updated.state.stay.roomCount, 5);
  const dates = changeState(updated.state, { changes: { departureDate: '2026-11-23' }, selection: { scope: 'KEEP_CURRENT' } }, settings, now);
  assert.equal(dates.state.stay.roomCount, 5);
  assert.deepEqual(dates.state.roomPreference.categories, ['Luxury']);
  assert.equal(changeState(original, { changes: { roomCount: 0 } }, settings, now).status, 'INVALID_DETAILS');
  assert.equal(changeState(original, { changes: { roomCount: 1.5 } }, settings, now).status, 'INVALID_DETAILS');
});

test('five-room request counts distinct inventory and does not misreport a capacity failure', async () => {
  const state = initialState({ ...seed, roomCount: 5 });
  let calls = 0;
  const result = await search(state, settings, now, async () => { calls++; return [...rooms(2), rooms(1)[0]]; });
  assert.equal(calls, 1);
  assert.equal(result.categories[0].availableCount, 2);
  assert.equal(result.categories[0].status, 'INSUFFICIENT_ROOMS');
  assert.match(result.text, /2 rooms available; you requested 5 rooms/);
  assert.doesNotMatch(result.text, /dates flexible|accommodates up to/);
  assert.ok(result.text.includes(result.nextQuestion));
});

test('multi-room pricing includes every room and night, with aggregate capacity qualified', async () => {
  const result = await search(initialState({ ...seed, roomCount: 5 }), settings, now, async () => rooms(5));
  assert.equal(result.categories[0].status, 'AVAILABLE');
  assert.equal(result.categories[0].totalMinor, 110000000);
  assert.equal(result.categories[0].depositMinor, 55000000);
  assert.match(result.text, /for 5 rooms/);
  assert.match(result.text, /Reception can confirm/);
});

test('explicit room inventory can be checked without inventing guests', async () => {
  const state = initialState({ ...seed, guests: undefined, roomCount: 5 });
  const result = await search(state, settings, now, async () => rooms(5));
  assert.equal(result.status, 'CHECKED');
  assert.equal(result.guests, undefined);
  assert.match(result.text, /occupancy still needs confirmation/);
});

test('capacity and no-inventory failures ask relevant questions and retain the displayed question', async () => {
  const capacity = await search(initialState(seed), settings, now, async () => rooms(5));
  assert.match(capacity.text, /larger number of rooms/);
  assert.doesNotMatch(capacity.text, /dates flexible/);
  const sold = await search(initialState({ ...seed, guests: 1 }), settings, now, async () => []);
  assert.equal(sold.nextQuestion, 'Are your dates flexible?');
  assert.ok(sold.text.includes(sold.nextQuestion));
});

test('verified formatter question is saved and returned with one model call', async () => {
  const store = session(initialState({ ...seed, guests: 1 }));
  let step = 0;
  const result = await runEnquiryAgent({ text: 'Check Luxury for those dates', workflow: { settings }, session: store, now }, {
    lookup: async () => [],
    generate: async () => ++step === 1
      ? call('checkAvailability', { expectedVersion: 0, selection: { scope: 'KEEP_CURRENT' } })
      : call('replyToGuest', { message: 'Invented question', resultIds: [], pendingQuestion: null }),
  });
  assert.equal(step, 1);
  assert.match(result.reply, /Are your dates flexible/);
  assert.equal(session.latest.pendingQuestion, 'Are your dates flexible?');
});

test('information rendering strips invented category ranking and unverified availability', async () => {
  let step = 0;
  const result = await runEnquiryAgent({ text: 'What is your highest room?', workflow: { settings }, session: session(initialState()), now }, {
    lookup: () => assert.fail('Information is not availability'),
    generate: async () => ++step === 1
      ? call('getHotelInformation', { topic: 'ROOM_COMPARISON' })
      : call('replyToGuest', { message: 'Imperial suite is the best and is available.', resultIds: ['result_1'] }),
  });
  assert.match(result.reply, /most expensive category is Junior Suite/);
  assert.match(result.reply, /room sizes and amenities/);
  assert.doesNotMatch(result.reply, /not been configured/);
  assert.doesNotMatch(result.reply, /Imperial suite|is available/);
});

test('single-room default still requires guests; room-only recap preserves quantity', async () => {
  const { recap } = require('../src/services/enquiryPresentation');
  const noPeople = initialState({ ...seed, guests: undefined });
  const missing = await search(noPeople, settings, now, async () => assert.fail('Missing occupancy must not query'));
  assert.equal(missing.status, 'INVALID_REQUEST');
  assert.ok(missing.missing.includes('guests'));
  const roomOnly = initialState({ ...seed, guests: undefined, roomCount: 5 });
  assert.match(recap(roomOnly).text, /5 rooms requested/);
  assert.doesNotMatch(recap(roomOnly).text, /5 guests/);
});

test('failed quantities omit a successful-offer occupancy disclaimer', async () => {
  const result = await search(initialState({ ...seed, roomCount: 5 }), settings, now, async () => rooms(2));
  assert.equal(result.hasOffer, false);
  assert.doesNotMatch(result.text, /Total capacity assumes|Reception can confirm/);
});

test('invalid selection returns actionable safe diagnostics and never changes the stay', () => {
  const state = initialState(seed), before = structuredClone(state);
  const result = changeState(state, { changes: { arrivalDate: '2026-11-21' }, selection: { scope: 'KEEP_CURRENT', categories: ['Luxury'] } }, settings, now);
  assert.equal(result.status, 'INVALID_SELECTION');
  assert.equal(result.reason, 'FIELDS_NOT_ALLOWED_FOR_SCOPE');
  assert.match(result.instruction, /omit categories and strategy/);
  assert.deepEqual(state, before);
  assert.equal(changeState(state, { selection: { scope: 'SELECTED' } }, settings, now).reason, 'CATEGORIES_REQUIRED');
});

test('yes to an open greeting never selects the previously discussed category or calls AI', async () => {
  const state = { ...initialState(seed), discussedCategories: ['Junior Suite'], pendingQuestion: 'How can I help you today?', pendingQuestionKind: 'OPEN' };
  const result = await runEnquiryAgent({ text: 'Yes', workflow: { settings }, session: session(state), now }, {
    generate: () => assert.fail('Open question cannot authorise a model-selected action'),
    lookup: () => assert.fail('No availability request was made'),
  });
  assert.equal(result.reply, 'What would you like help with?');
  assert.deepEqual(session.latest.stay, state.stay);
  assert.deepEqual(session.latest.roomPreference, state.roomPreference);
});

test('an explicit yes/no offer still reaches interpretation instead of the open-question guard', async () => {
  const state = { ...initialState(seed), pendingQuestion: 'Shall I check availability again?', pendingQuestionKind: 'YES_NO' };
  let calls = 0;
  const result = await runEnquiryAgent({ text: 'Yes', workflow: { settings }, session: session(state), now }, {
    generate: async () => { calls++; return call('checkAvailability', { expectedVersion: 0, selection: { scope: 'KEEP_CURRENT' } }); },
    lookup: async () => rooms(2),
  });
  assert.equal(calls, 1);
  assert.match(result.reply, /accommodates up to/);
});

test('a greeting question is stored even without model-supplied question metadata', async () => {
  const state = { ...initialState(seed), pendingQuestion: 'Old question', pendingQuestionKind: 'YES_NO' };
  await runEnquiryAgent({ text: 'hey', workflow: { settings }, session: session(state), now }, {
    generate: async () => call('replyToGuest', { message: 'Hello! How can I help you today?', resultIds: [] }),
  });
  assert.equal(session.latest.pendingQuestion, 'Hello! How can I help you today?');
  assert.equal(session.latest.pendingQuestionKind, 'OPEN');
});

test('resume uses singular room wording and does not imply an unperformed inventory check', () => {
  const { recap } = require('../src/services/enquiryPresentation');
  const result = recap(initialState({ ...seed, guests: 1, roomCount: 1 }));
  assert.match(result.text, /1 room requested/);
  assert.doesNotMatch(result.text, /1 rooms|needs a fresh check|last checked|is available/);
  assert.equal(result.questionKind, 'YES_NO');
  assert.ok(result.text.includes(result.question));
});
