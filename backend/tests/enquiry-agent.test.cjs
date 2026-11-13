const test = require('node:test');
const assert = require('node:assert/strict');
const { runEnquiryAgent } = require('../src/services/enquiryAgent');
const { initialState, changeState } = require('../src/services/enquiryState');
const now = new Date('2026-11-13T10:00:00Z');
const settings = { name: 'Kudu Demo Hotel', city: 'Demo city', checkInTime: '14:00', checkOutTime: '12:00',
  currency: 'NGN', depositPercent: 50, quoteMinutes: 30, amenities: ['Wi-Fi'],
  roomRates: ['Standard', 'Imperial', 'Luxury'].map((category, i) => ({ category, capacity: 2, nightlyMinor: (i + 1) * 1000000 })) };
function memory(seed) {
  let state = initialState(seed), version = 0;
  return { open: () => ({ id: 'synthetic', version, state: structuredClone(state),
    save: async (expected, next) => {
      if (expected !== version) throw Object.assign(Error('Conflict'), { code: 'STATE_CHANGED' });
      state = structuredClone(next); return { version: ++version, state: structuredClone(state) };
    } }), snapshot: () => ({ version, state: structuredClone(state) }) };
}
const call = (name, args, signature) => ({ functionCalls: [{ name, args, id: 'call-1' }],
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id: 'call-1' }, ...(signature ? { thoughtSignature: signature } : {}) }] } }] });
const reply = (message = '', resultIds = []) => call('replyToGuest', { message, resultIds });
const seed = { arrivalDate: '2026-11-21', departureDate: '2026-11-23', guests: 1, requestedCategories: ['Standard'] };
async function run(store, responses, overrides = {}, text = 'Synthetic guest turn') {
  const requests = [];
  let index = 0;
  const result = await runEnquiryAgent({ text, history: [], workflow: { settings }, session: store.open(), now }, {
    generate: async request => { requests.push(structuredClone(request)); return typeof responses[index] === 'function' ? responses[index++](request) : responses[index++]; },
    lookup: async () => settings.roomRates.map(({ category }) => ({ category })), ...overrides,
  });
  return { result, requests };
}

test('social replies accept natural wording without triggering inventory or changing stay', async () => {
  const store = memory(seed), before = store.snapshot();
  const { result } = await run(store, [reply('You’re welcome! I’m available if you need anything else.')], {
    lookup: () => assert.fail('Social turn must not query inventory'),
  });
  assert.match(result.reply, /You’re welcome/);
  assert.deepEqual(store.snapshot(), before);
});

test('room types need no dates and facts are rendered from configured tool output', async () => {
  const store = memory();
  const { result } = await run(store, [call('getHotelInformation', { topic: 'ROOM_TYPES' }, 'opaque-signature'), request => {
    assert.equal(request.contents[1].parts[0].thoughtSignature, 'opaque-signature');
    assert.equal(request.contents[2].parts[0].functionResponse.id, 'call-1');
    return reply('Here are our room types.', ['result_1']);
  }], { lookup: () => assert.fail('Descriptions are not availability') });
  assert.match(result.reply, /Standard, Imperial, Luxury/);
  assert.deepEqual(store.snapshot().state.stay, {});
});

test('selected, all, alternatives and date-only changes survive session reloads', async () => {
  const store = memory(seed);
  const check = async selection => {
    const version = store.snapshot().version;
    return (await run(store, [call('checkAvailability', { expectedVersion: version, selection }), reply()], {}, selection.scope === 'SELECTED' ? 'Check ' + selection.categories.join(' and ') : 'Check other room options')).result;
  };
  assert.match((await check({ scope: 'SELECTED', categories: ['Imperial'] })).reply, /Imperial is available/);
  assert.deepEqual(store.snapshot().state.roomPreference.categories, ['Imperial']);
  const all = await check({ scope: 'ALL' });
  assert.match(all.reply, /Standard is available/); assert.match(all.reply, /Luxury is available/);
  await check({ scope: 'SELECTED', categories: ['Luxury'] });
  const { result } = await run(store, [call('checkAvailability', {
    expectedVersion: store.snapshot().version, changes: { arrivalDate: '2026-11-23', departureDate: '2026-11-24' }, selection: { scope: 'KEEP_CURRENT' },
  }), reply()]);
  assert.match(result.reply, /Luxury is available/);
  assert.match(result.reply, /1 night/);
  assert.equal(store.snapshot().state.stay.guests, 1);
  const alternatives = await check({ scope: 'ALTERNATIVES' });
  assert.match(alternatives.reply, /Standard is available/);
  assert.doesNotMatch(alternatives.reply, /Luxury is available/);
});

test('explicit reset clears the quote and preferences; this phase has no booking tools', async () => {
  const store = memory(seed);
  const { result } = await run(store, [call('updateEnquiry', { expectedVersion: 0, reset: true }), reply('Let’s start again. What would you like to know?')]);
  assert.deepEqual(store.snapshot().state, initialState());
  assert.match(result.reply, /start again/);
  const { tools } = require('../src/services/enquiryAgentContract');
  assert.equal(tools.some(tool => /reserv|payment|checkout/i.test(tool.name)), false);
});

test('state validation rejects unknown categories and impossible dates; changes invalidate quotes', () => {
  const state = { ...initialState(seed), stage: 'QUOTED', lastQuote: { total: 123 } };
  assert.equal(changeState(state, { changes: { arrivalDate: '2026-02-30' } }, settings, now).status, 'INVALID_DETAILS');
  assert.equal(changeState(state, { selection: { scope: 'SELECTED', categories: ['Unknown'] } }, settings, now).status, 'UNKNOWN_CATEGORY');
  assert.equal(changeState(state, { selection: { scope: 'ALL', categories: ['Standard'] } }, settings, now).status, 'INVALID_SELECTION');
  const changed = changeState(state, { changes: { guests: 2 } }, settings, now);
  assert.equal(changed.state.lastQuote, null);
  assert.equal(changed.state.stage, 'EXPLORING');
  assert.equal(state.lastQuote.total, 123);
});

test('missing dates do not query inventory or invent a stay', async () => {
  const store = memory();
  const { result } = await run(store, [call('checkAvailability', { expectedVersion: 0, selection: { scope: 'ALL' } }), reply()], {
    lookup: () => assert.fail('Missing dates must not query inventory'),
  });
  assert.match(result.reply, /check-in date/);
  assert.deepEqual(store.snapshot().state.stay, {});
});

test('all model rounds share the original budget, and verified results survive wording failure', async () => {
  const store = memory(seed); let clock = 0, calls = 0;
  const { result, requests } = await run(store, [], {
    clock: () => clock,
    generate: async request => {
      if (++calls === 1) { assert.equal(request.timeoutMs, 20000); clock += 6000; return call('checkAvailability', { expectedVersion: 0, selection: { scope: 'ALL' } }); }
      assert.equal(request.timeoutMs, 14000); throw Object.assign(Error('Provider down'), { status: 503 });
    }, budgetMs: 20000,
  });
  assert.equal(calls, 2); assert.match(result.reply, /Standard is available/); assert.equal(result.fallback, undefined);
});

test('provider failure before any tool preserves the enquiry', async () => {
  const store = memory(seed), before = store.snapshot();
  const { result } = await run(store, [], { generate: async () => { throw Object.assign(Error('Provider down'), { status: 503 }); } });
  assert.equal(result.fallback, true); assert.deepEqual(store.snapshot(), before);
});

test('PMS outage is not sold out, and stale quotes are cleared', async () => {
  const store = memory(seed);
  await run(store, [call('checkAvailability', { expectedVersion: 0, selection: { scope: 'ALL' } }), reply()]);
  const { result } = await run(store, [call('checkAvailability', { expectedVersion: store.snapshot().version, selection: { scope: 'KEEP_CURRENT' } }), reply()], {
    lookup: async () => { throw Error('PMS down'); },
  });
  assert.match(result.reply, /couldn’t check room availability/);
  assert.equal(store.snapshot().state.lastQuote, null);
});

test('a concurrent update cannot be overwritten by an older inventory result', async () => {
  const store = memory(seed);
  const { result } = await run(store, [call('checkAvailability', { expectedVersion: 0, selection: { scope: 'KEEP_CURRENT' } })], {
    lookup: async () => { const newer = store.open(); await newer.save(newer.version, { ...newer.state, stay: { ...seed, guests: 2 } }); return [{ category: 'Standard' }]; },
  });
  assert.match(result.reply, /enquiry changed/);
  assert.equal(store.snapshot().state.stay.guests, 2);
  assert.equal(store.snapshot().state.lastQuote, null);
});

test('pending question persists for a later yes without overwriting unrelated details', async () => {
  const store = memory(seed);
  await run(store, [call('replyToGuest', { message: 'Shall I check those dates again?', resultIds: [], pendingQuestion: 'Shall I check those dates again?' })]);
  const resumed = store.open();
  assert.equal(resumed.state.pendingQuestion, 'Shall I check those dates again?');
  await run(store, [reply('You’re welcome.')]);
  assert.equal(store.open().state.pendingQuestion, resumed.state.pendingQuestion);
});

test('unknown tool requests, invented result IDs and repeated calls are bounded', async () => {
  const store = memory(seed);
  const { result } = await run(store, [call('createReservation', {}), reply('Please contact reception to confirm a booking.')]);
  assert.match(result.reply, /reception/);
  assert.equal(store.snapshot().version, 0);
  const invalid = await run(store, [reply('Done', ['made-up']), reply('How can I help?')]);
  assert.equal(invalid.result.reply, 'How can I help?');
  let calls = 0;
  const repeated = await run(store, [], { generate: async () => { calls++; return call('getEnquiryProgress', {}); } });
  assert.equal(calls, 6); assert.equal(repeated.result.fallback, true);
});

test('catalog-grounded category mismatch is repaired before inventory or state changes', async () => {
  const store = memory(seed); let calls = 0, lookups = 0;
  const result = await runEnquiryAgent({ text: 'Is Imperial available?', workflow: { settings }, session: store.open(), now }, {
    generate: async request => {
      if (++calls === 1) return call('checkAvailability', { expectedVersion: 0, selection: { scope: 'KEEP_CURRENT' } });
      if (calls === 2) {
        assert.equal(request.contents.at(-1).parts[0].functionResponse.response.status, 'CATEGORY_MISMATCH');
        assert.equal(store.snapshot().version, 0);
        return call('checkAvailability', { expectedVersion: 0, selection: { scope: 'SELECTED', categories: ['Imperial'] } });
      }
      return reply();
    }, lookup: async () => { lookups++; return [{ category: 'Imperial' }]; },
  });
  assert.equal(lookups, 1); assert.match(result.reply, /Imperial is available/);
  assert.deepEqual(store.snapshot().state.roomPreference.categories, ['Imperial']);
});

test('unrequested new category is rejected, then alternatives check every remaining option', async () => {
  const store = memory(seed);
  const setup = store.open();
  await setup.save(0, { ...setup.state, roomPreference: { scope: 'SELECTED', categories: ['Imperial'], strategy: 'COMPARE' }, discussedCategories: ['Standard', 'Imperial'] });
  const expanded = { ...settings, roomRates: [...settings.roomRates, { category: 'Junior Suite', capacity: 2, nightlyMinor: 4000000 }] };
  let calls = 0, lookups = 0;
  const result = await runEnquiryAgent({ text: 'Any alternatives?', session: store.open(), workflow: { settings: expanded }, now }, {
    generate: async request => {
      if (++calls === 1) return call('checkAvailability', { expectedVersion: 1, selection: { scope: 'SELECTED', categories: ['Luxury'] } });
      if (calls === 2) {
        assert.equal(request.contents.at(-1).parts[0].functionResponse.response.status, 'SELECTION_NOT_GROUNDED');
        assert.equal(store.snapshot().version, 1); assert.equal(lookups, 0);
        return call('checkAvailability', { expectedVersion: 1, selection: { scope: 'ALTERNATIVES' } });
      }
      return reply();
    }, lookup: async () => { lookups++; return expanded.roomRates.map(({ category }) => ({ category })); },
  });
  assert.equal(lookups, 1);
  assert.match(result.reply, /Luxury is available/); assert.match(result.reply, /Junior Suite is available/);
  assert.doesNotMatch(result.reply, /Imperial is available|Standard is available/);
  assert.equal(store.snapshot().state.roomPreference.scope, 'ALTERNATIVES');
});

test('a guest can explicitly select new categories, including multiple names', async () => {
  const store = memory(seed);
  const { result } = await run(store, [call('checkAvailability', { expectedVersion: 0, selection: { scope: 'SELECTED', categories: ['Imperial', 'Luxury'] } }), reply()], {}, 'Compare Imperial and Luxury');
  assert.match(result.reply, /Imperial is available/); assert.match(result.reply, /Luxury is available/);
});

test('an indirect reference to an already discussed option remains selectable', async () => {
  const store = memory(seed), setup = store.open();
  await setup.save(0, { ...setup.state, discussedCategories: ['Imperial'] });
  const { result } = await run(store, [call('checkAvailability', { expectedVersion: 1, selection: { scope: 'SELECTED', categories: ['Imperial'] } }), reply()], {}, 'The option we discussed earlier please');
  assert.match(result.reply, /Imperial is available/);
});
