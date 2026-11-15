const test = require('node:test');
const assert = require('node:assert/strict');
const { search, recap } = require('../src/services/enquiryPresentation');
const { initialState, changeState } = require('../src/services/enquiryState');
const { runEnquiryAgent } = require('../src/services/enquiryAgent');
const now = new Date('2026-11-13T10:00:00Z');
const settings = { checkInTime: '14:00', checkOutTime: '12:00', currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
  roomRates: ['Standard', 'Imperial', 'Luxury', 'Junior Suite'].map((category, i) => ({ category, capacity: i === 3 ? 3 : 2, nightlyMinor: (i + 1) * 1000000 })) };
const seed = { arrivalDate: '2026-11-21', departureDate: '2026-11-23', guests: 1, category: 'Imperial' };
const state = () => initialState(seed);
const rooms = names => names.map(category => ({ category }));

test('unavailable requested category automatically offers suitable options using one inventory read', async () => {
  let calls = 0;
  const original = state();
  const result = await search(original, settings, now, async () => { calls++; return rooms(['Standard', 'Luxury', 'Junior Suite']); });
  assert.equal(calls, 1);
  assert.equal(result.categories[0].status, 'UNAVAILABLE');
  assert.deepEqual(result.alternatives.map(item => item.category), ['Standard', 'Luxury']);
  assert.match(result.text, /same dates and guest count/);
  assert.match(result.text, /Which of these would you prefer/);
  assert.deepEqual(original.roomPreference.categories, ['Imperial']);
  assert.equal(original.stay.arrivalDate, seed.arrivalDate);
});

test('available preferred category is offered alone and capacity-inappropriate alternatives are excluded', async () => {
  const result = await search(state(), settings, now, async () => rooms(['Imperial', 'Luxury']));
  assert.equal(result.alternatives.length, 0); assert.doesNotMatch(result.text, /Luxury is available|Other options/);
  const larger = { ...state(), stay: { ...state().stay, guests: 3 } };
  const fallback = await search(larger, settings, now, async () => rooms(['Standard', 'Luxury', 'Junior Suite']));
  assert.deepEqual(fallback.alternatives.map(item => item.category), ['Junior Suite']);
});

test('strict category and budget restrictions are respected without changing the dates', async () => {
  const strict = { ...state(), roomPreference: { ...state().roomPreference, allowAlternatives: false } };
  const declined = await search(strict, settings, now, async () => rooms(['Standard', 'Luxury']));
  assert.equal(declined.alternatives.length, 0); assert.doesNotMatch(declined.text, /Other options/);
  const capped = { ...state(), roomPreference: { ...state().roomPreference, maxTotalMinor: 2500000 } };
  const offered = await search(capped, settings, now, async () => rooms(['Standard', 'Luxury', 'Junior Suite']));
  assert.deepEqual(offered.alternatives.map(item => item.category), ['Standard']);
  const nightly = await search({ ...capped, roomPreference: { ...capped.roomPreference, maxTotalMinor: null, maxNightlyMinor: 900000 } }, settings, now, async () => rooms(['Standard', 'Luxury']));
  assert.equal(nightly.alternatives.length, 0);
  assert.equal(nightly.arrivalDate, seed.arrivalDate);
});

test('a PMS failure is never presented as sold out, and no suitable rooms prompts date flexibility', async () => {
  const failure = await search(state(), settings, now, async () => { throw Error('Synthetic database failure'); });
  assert.equal(failure.status, 'PMS_UNAVAILABLE'); assert.doesNotMatch(failure.text, /isn’t available|dates flexible/);
  const none = await search(state(), settings, now, async () => []);
  assert.equal(none.alternatives.length, 0); assert.match(none.text, /Are your dates flexible/);
});

test('budget constraints are validated, persist across preference changes and invalidate old quotes', () => {
  const withQuote = { ...state(), lastQuote: { old: true }, stage: 'QUOTED' };
  const revised = changeState(withQuote, { selection: { scope: 'KEEP_CURRENT', maxTotalMinor: 2500000, allowAlternatives: false } }, settings, now);
  assert.equal(revised.state.lastQuote, null);
  const switchRoom = changeState(revised.state, { selection: { scope: 'SELECTED', categories: ['Luxury'] } }, settings, now);
  assert.equal(switchRoom.state.roomPreference.maxTotalMinor, 2500000);
  assert.equal(switchRoom.state.roomPreference.allowAlternatives, false);
  assert.equal(changeState(state(), { selection: { scope: 'ALL', maxTotalMinor: -1 } }, settings, now).status, 'INVALID_SELECTION');
});

test('inline resume is grounded, uses one model request and asks one unambiguous question', async () => {
  let saved = state(), version = 0, calls = 0;
  const session = { id: 'synthetic', state: saved, version, save: async (expected, next) => { assert.equal(expected, version); saved = next; return { state: saved, version: ++version }; } };
  const outcome = await runEnquiryAgent({ text: 'I’m back, where were we?', workflow: { settings }, session, now }, {
    generate: async () => { calls++; return { functionCalls: [{ name: 'replyToGuest', args: { message: '', resultIds: [], recapEnquiry: true } }] }; },
    lookup: () => assert.fail('A recap does not recheck availability'),
  });
  assert.equal(calls, 1); assert.equal(outcome.enquiryProgressUsed, true);
  assert.match(outcome.reply, /Imperial/); assert.match(outcome.reply, /fresh check/);
  assert.equal((outcome.reply.match(/\?/g) ?? []).length, 1);
  assert.equal(saved.pendingQuestion, 'Shall I check availability again?');
});

test('free-text recap must be grounded and the progress tool also yields one clear question', async () => {
  let saved = state(), version = 0, calls = 0;
  const session = { id: 'synthetic', state: saved, version, save: async (expected, next) => ({ state: saved = next, version: ++version }) };
  const result = await runEnquiryAgent({ text: 'Where were we?', workflow: { settings }, session, now }, {
    generate: async request => {
      if (++calls === 1) return { functionCalls: [{ name: 'replyToGuest', args: { message: 'We discussed Imperial for 21 to 23 November. Continue or change?', resultIds: [] } }] };
      if (calls === 2) { assert.equal(request.contents.at(-1).parts[0].functionResponse.response.status, 'UNGROUNDED_REPLY'); return { functionCalls: [{ name: 'getEnquiryProgress', args: {} }] }; }
      return { functionCalls: [{ name: 'replyToGuest', args: { message: 'Check again or choose another room?', resultIds: ['result_1'] } }] };
    }, lookup: () => assert.fail('No inventory on a recap'),
  });
  assert.equal(result.enquiryProgressUsed, true); assert.doesNotMatch(result.reply, /or choose/);
  assert.equal((result.reply.match(/\?/g) ?? []).length, 1);
});

test('date and party-size changes preserve the selection despite an unintended broader scope', () => {
  const luxury = initialState({ ...seed, category: 'Luxury' });
  const revised = changeState(luxury, { changes: { arrivalDate: '2026-11-22' }, selection: { scope: 'ALL' } }, settings, now);
  assert.equal(revised.state.stay.arrivalDate, '2026-11-22');
  assert.deepEqual(revised.state.roomPreference.categories, ['Luxury']);
  const party = changeState(luxury, { changes: { guests: 2 }, selection: { scope: 'ALTERNATIVES' } }, settings, now);
  assert.deepEqual(party.state.roomPreference.categories, ['Luxury']);
  const explicit = changeState(luxury, { changes: { arrivalDate: '2026-11-22' }, selection: { scope: 'ALL', replacePreference: true } }, settings, now);
  assert.equal(explicit.state.roomPreference.scope, 'ALL');
  assert.equal(changeState(luxury, { selection: { scope: 'ALL', replacePreference: 'true' } }, settings, now).status, 'INVALID_SELECTION');
});

test('follow-up quotes omit repeated policy/reception text while changed policy is shown', async () => {
  const first = await search(state(), settings, now, async () => rooms(['Imperial']));
  assert.match(first.text, /Check-in/);
  assert.doesNotMatch(first.text, /Reception can help/);
  const existing = { ...state(), policySignature: first.policySignature };
  const followUp = await search(existing, settings, now, async () => rooms(['Imperial']));
  assert.doesNotMatch(followUp.text, /Check-in|Checkout|Reception can help/);
  assert.match(followUp.text, /Imperial is available for/);
  const changedPolicy = await search(existing, { ...settings, checkInTime: '15:00' }, now, async () => rooms(['Imperial']));
  assert.match(changedPolicy.text, /Check-in 3:00 PM/);
});

test('reported date-only ALL failure retains Luxury and returns a short verified follow-up', async () => {
  let saved = initialState({ ...seed, category: 'Luxury' }), version = 0;
  const open = () => ({ id: 'synthetic', state: saved, version, save: async (expected, next) => {
    assert.equal(expected, version); saved = next; return { state: saved, version: ++version };
  } });
  const turn = async (text, selection, changes) => {
    let step = 0;
    return runEnquiryAgent({ text, workflow: { settings }, session: open(), now }, {
      generate: async () => ++step === 1
        ? { functionCalls: [{ name: 'checkAvailability', args: { expectedVersion: version, selection, ...(changes ? { changes } : {}) } }] }
        : { functionCalls: [{ name: 'replyToGuest', args: { message: 'The room is available. Here are the details:', resultIds: ['result_1'] } }] },
      lookup: async () => rooms(['Standard', 'Luxury']),
    });
  };
  const first = await turn('Is Luxury available?', { scope: 'SELECTED', categories: ['Luxury'] });
  assert.match(first.reply, /Check-in/); assert.doesNotMatch(first.reply, /Here are the details/);
  const followUp = await turn('How about 22 to 23 November?', { scope: 'ALL' }, { arrivalDate: '2026-11-22' });
  assert.deepEqual(saved.roomPreference.categories, ['Luxury']);
  assert.match(followUp.reply, /Luxury is available for 22 Nov 2026 to 23 Nov 2026/);
  assert.match(followUp.reply, /1 night/);
  assert.doesNotMatch(followUp.reply, /Standard is available|Check-in|Checkout|Here are the details|Reception can help/);
});
