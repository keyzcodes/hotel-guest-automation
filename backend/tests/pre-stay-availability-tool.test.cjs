const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { checkRoomAvailability, answerAvailabilityTurn } = require('../src/services/preStayAvailabilityTool');

const settings = {
  checkInTime: '14:00', checkOutTime: '12:00', currency: 'NGN', depositPercent: 50, quoteMinutes: 30,
  roomRates: [
    { category: 'Imperial', capacity: 2, nightlyMinor: 8500000 },
    { category: 'Luxury', capacity: 2, nightlyMinor: 11000000 },
    { category: 'Standard', capacity: 2, nightlyMinor: 6500000 },
    { category: 'Junior Suite', capacity: 2, nightlyMinor: 9500000 },
  ],
};
const now = new Date('2026-11-10T10:00:00Z');
const args = { arrivalDate: '2026-11-21', departureDate: '2026-11-23', guests: 1, categories: ['Imperial', 'Luxury'] };
const guestText = 'Imperial for two nights if available, otherwise Luxury';
function toolResponse(requestArgs) {
  return { functionCalls: [{ name: 'checkRoomAvailability', args: requestArgs }] };
}

test('one inventory lookup prices available categories and distinguishes capacity and unknown category', async () => {
  let calls = 0;
  const result = await checkRoomAvailability({ ...args, categories: ['imperial', 'Luxury', 'Deluxe'] }, settings, now, async () => {
    calls++;
    return [{ category: 'Luxury' }];
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.categories, [
    { category: 'Imperial', status: 'UNAVAILABLE' },
    { category: 'Luxury', status: 'AVAILABLE', currency: 'NGN', totalMinor: 22000000, depositMinor: 11000000 },
    { category: 'Deluxe', status: 'UNKNOWN_CATEGORY' },
  ]);
  const tooManyGuests = await checkRoomAvailability({ ...args, guests: 3 }, settings, now, async () => []);
  assert.equal(tooManyGuests.categories[0].status, 'CAPACITY_EXCEEDED');
});

test('invalid input skips the PMS and database failure returns a distinct outcome', async () => {
  const invalid = await checkRoomAvailability({ ...args, arrivalDate: '2026-11-31' }, settings, now, async () => {
    assert.fail('Invalid dates must not reach inventory');
  });
  assert.deepEqual(invalid, { status: 'INVALID_REQUEST', reason: 'INVALID_DATES' });
  const down = await checkRoomAvailability(args, settings, now, async () => { throw Error('Synthetic failure'); });
  assert.deepEqual(down, { status: 'PMS_UNAVAILABLE' });
});

test('a conditional request uses one model call and offers only the available preference', async () => {
  let calls = 0;
  const reply = await answerAvailabilityTurn({ text: guestText, history: [], workflow: { settings }, now }, {
    async generate(request) {
      calls++;
      assert.equal(request.config.tools[0].functionDeclarations[0].name, 'checkRoomAvailability');
      return toolResponse({ ...args, mode: 'FIRST_AVAILABLE' });
    },
    lookup: async () => [{ category: 'Imperial' }, { category: 'Luxury' }],
  });
  assert.equal(calls, 1);
  assert.match(reply.reply, /Imperial is available at ₦170,000/);
  assert.doesNotMatch(reply.reply, /Luxury/);
  assert.deepEqual(reply.availabilityContext.checkedCategories, ['Imperial']);
});

test('alternatives reuse the checked stay and start fresh when its details change', async () => {
  const previous = { arrivalDate: args.arrivalDate, departureDate: args.departureDate,
    guests: args.guests, checkedCategories: ['Imperial', 'Luxury'] };
  const lookup = async () => [{ category: 'Luxury' }, { category: 'Standard' }];
  const unchanged = await checkRoomAvailability({ mode: 'ALTERNATIVES' }, settings, now, lookup, previous);
  assert.deepEqual(unchanged.categories.map(item => item.category), ['Standard', 'Junior Suite']);
  const changed = await checkRoomAvailability({ mode: 'ALTERNATIVES', guests: 2 }, settings, now, lookup, previous);
  assert.deepEqual(changed.categories.map(item => item.category), ['Imperial', 'Luxury', 'Standard', 'Junior Suite']);
  const noContext = await checkRoomAvailability({ mode: 'ALTERNATIVES' }, settings, now, () => assert.fail('Missing context'), undefined);
  assert.equal(noContext.status, 'INVALID_REQUEST');
});

test('date-only follow-ups preserve the saved party and category but recheck the new dates', async () => {
  let lookups = 0;
  const previous = {
    arrivalDate: '2026-11-22', departureDate: '2026-11-24', guests: 1,
    requestedCategories: ['Junior Suite'], checkedCategories: ['Junior Suite'], mode: 'COMPARE',
  };
  const outcome = await answerAvailabilityTurn({
    text: 'How about 23 to 24 November?', history: [], workflow: { settings }, availabilityContext: previous, now,
  }, {
    generate: async () => toolResponse({
      mode: 'COMPARE', reuseLastStay: true, arrivalDate: '2026-11-23', departureDate: '2026-11-24',
    }),
    lookup: async range => {
      lookups++;
      assert.equal(range.arrivalAt.toISOString(), '2026-11-23T13:00:00.000Z');
      assert.equal(range.departureAt.toISOString(), '2026-11-24T11:00:00.000Z');
      return [{ category: 'Junior Suite' }, { category: 'Standard' }];
    },
  });
  assert.equal(lookups, 1);
  assert.match(outcome.reply, /Junior Suite is available at ₦95,000 total/);
  assert.doesNotMatch(outcome.reply, /Standard is available|Standard isn’t available/);
  assert.equal(outcome.availabilityContext.guests, 1);
  assert.deepEqual(outcome.availabilityContext.requestedCategories, ['Junior Suite']);
});

test('continuations retain conditional fallback order and support context saved by the previous patch', async () => {
  const previous = {
    ...args, mode: 'FIRST_AVAILABLE', requestedCategories: ['Imperial', 'Luxury'], checkedCategories: ['Imperial'],
  };
  const result = await checkRoomAvailability({
    mode: 'FIRST_AVAILABLE', reuseLastStay: true, arrivalDate: '2026-11-23', departureDate: '2026-11-24',
  }, settings, now, async () => [{ category: 'Luxury' }], previous);
  assert.deepEqual(result.categories.map(item => item.category), ['Imperial', 'Luxury']);
  assert.equal(result.guests, 1);
  const legacy = await checkRoomAvailability({
    mode: 'COMPARE', reuseLastStay: true, arrivalDate: '2026-11-23', departureDate: '2026-11-24',
  }, settings, now, async () => [{ category: 'Junior Suite' }], {
    arrivalDate: args.arrivalDate, departureDate: args.departureDate, guests: 1, checkedCategories: ['Junior Suite'],
  });
  assert.deepEqual(legacy.categories.map(item => item.category), ['Junior Suite']);
});

test('new enquiries do not inherit a previous party and invalid continuations do not reach the PMS', async () => {
  const previous = { ...args, checkedCategories: ['Junior Suite'] };
  const missing = await checkRoomAvailability({
    mode: 'COMPARE', arrivalDate: args.arrivalDate, departureDate: args.departureDate,
  }, settings, now, () => assert.fail('Incomplete new enquiry'), previous);
  assert.deepEqual(missing, { status: 'INVALID_REQUEST', reason: 'MISSING_DETAILS', missing: ['guests'] });
  const invalid = await checkRoomAvailability({
    mode: 'COMPARE', reuseLastStay: true, departureDate: '2026-11-20',
  }, settings, now, () => assert.fail('Reversed dates'), previous);
  assert.equal(invalid.reason, 'INVALID_DATES');
  const noContext = await checkRoomAvailability({
    mode: 'COMPARE', reuseLastStay: true, arrivalDate: args.arrivalDate, departureDate: args.departureDate,
  }, settings, now, () => assert.fail('Missing party'), undefined);
  assert.deepEqual(noContext.missing, ['guests']);
});

test('explicit latest dates override stale model dates and saved dates for both turns', async () => {
  let previous = {
    arrivalDate: '2026-11-23', departureDate: '2026-11-24', guests: 1,
    requestedCategories: ['Junior Suite'], checkedCategories: ['Junior Suite'], mode: 'COMPARE',
  };
  let calls = 0;
  const requests = [];
  const dependencies = {
    generate: async () => {
      calls++;
      // Deliberately return the stale arrival date for every request.
      return toolResponse({ mode: 'COMPARE', reuseLastStay: true,
        arrivalDate: '2026-11-23', departureDate: '2026-11-24' });
    },
    lookup: async range => {
      requests.push(range);
      return range.arrivalAt < new Date('2026-11-23T11:00:00Z') ? [] : [{ category: 'Junior Suite' }];
    },
  };
  const first = await answerAvailabilityTurn({
    text: 'Is Junior Suite available for one guest from 22 to 24 November?',
    history: [], workflow: { settings }, availabilityContext: previous, now,
  }, dependencies);
  assert.match(first.reply, /22 Nov 2026 to 24 Nov 2026/);
  assert.match(first.reply, /Junior Suite isn’t available/);
  previous = first.availabilityContext;
  assert.equal(previous.arrivalDate, '2026-11-22');
  const second = await answerAvailabilityTurn({
    text: 'How about 23 to 24 November?',
    history: [], workflow: { settings }, availabilityContext: previous, now,
  }, dependencies);
  assert.match(second.reply, /23 Nov 2026 to 24 Nov 2026/);
  assert.match(second.reply, /Junior Suite is available/);
  assert.equal(calls, 2);
  assert.equal(requests.length, 2);
  assert.equal(second.availabilityContext.guests, 1);
});

test('explicit calendar ranges validate impossible dates and leave ambiguous expressions to the model', async () => {
  const previous = { arrivalDate: args.arrivalDate, departureDate: args.departureDate,
    guests: 1, requestedCategories: ['Junior Suite'], checkedCategories: ['Junior Suite'] };
  const run = (text, lookup = async () => [{ category: 'Junior Suite' }]) => answerAvailabilityTurn({
    text, history: [], workflow: { settings }, availabilityContext: previous, now,
  }, {
    generate: async () => toolResponse({ mode: 'COMPARE', reuseLastStay: true, ...args, categories: ['Junior Suite'] }),
    lookup,
  });
  const iso = await run('One guest, 2026-11-22 to 2026-11-24');
  assert.equal(iso.availabilityContext.arrivalDate, '2026-11-22');
  const crossYear = await run('31 December to 2 January 2027');
  assert.equal(crossYear.availabilityContext.arrivalDate, '2026-12-31');
  assert.equal(crossYear.availabilityContext.departureDate, '2027-01-02');
  const invalid = await run('31 November to 2 December 2026', () => assert.fail('Invalid latest dates must not reach inventory'));
  assert.equal(invalid.action, 'CLARIFY');
  const negated = await run('Not 22 to 24 November, use the dates we discussed');
  assert.equal(negated.availabilityContext.arrivalDate, args.arrivalDate);
  const several = await run('22 to 24 November or 23 to 25 November');
  assert.equal(several.availabilityContext.arrivalDate, args.arrivalDate);
});

test('resuming an availability enquiry recalls saved details before asking the next question', async () => {
  let calls = 0;
  const result = await answerAvailabilityTurn({
    text: 'I am back, where were we?', history: [], workflow: { settings }, now,
    availabilityContext: {
      arrivalDate: args.arrivalDate, departureDate: args.departureDate, guests: 1,
      requestedCategories: ['Junior Suite'], checkedCategories: ['Junior Suite'],
    },
  }, {
    generate: async request => {
      calls++;
      assert.ok(request.config.tools[0].functionDeclarations.some(item => item.name === 'getEnquiryProgress'));
      return { functionCalls: [{ name: 'getEnquiryProgress', args: {} }] };
    },
    lookup: () => assert.fail('A recap must not pretend to be a fresh inventory check'),
  });
  assert.equal(calls, 1);
  assert.match(result.reply, /We last checked Junior Suite, 21 Nov 2026 to 23 Nov 2026, 1 guest/);
  assert.match(result.reply, /Would you like me to check availability again/);
  assert.doesNotMatch(result.reply, /is available|booking is confirmed|₦/);
});

const uri = process.env.PMS_TEST_URI;
test('WhatsApp handler switches rooms after PMS changes and remembers the stay for alternatives', {
  skip: !uri, timeout: 35000,
}, async t => {
  const mongoose = require('mongoose');
  const Room = require('../src/models/Room');
  const Reservation = require('../src/models/Reservation');
  const Enquiry = require('../src/models/BookingEnquiry');
  const Message = require('../src/models/Message');
  const profile = require('../src/services/bookingWorkflowSettings');
  const dbName = 'sesora_pms_test_' + randomUUID().replace(/-/g, '');
  const arrivalDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const departureDate = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const overlapArrival = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
  const laterDeparture = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const flags = {
    WHATSAPP_AVAILABILITY_TOOL_DEMO: 'true', WHATSAPP_BOOKING_WORKFLOW_ENABLED: 'true',
    WHATSAPP_AVAILABILITY_ENABLED: 'true', ROOM_BOARD_ENABLED: 'true', USE_MOCK_AI: 'false',
  };
  const old = Object.fromEntries(Object.keys(flags).map(key => [key, process.env[key]]));
  Object.assign(process.env, flags);
  t.after(() => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(profile, 'enabled', () => true);
  let modelCalls = 0;
  const ai = require('../src/services/guestAiService');
  t.mock.method(ai, 'generateGuestModelResponse', async ({ contents }) => {
    modelCalls++;
    const input = JSON.parse(contents[0].parts[0].text);
    if (input.latestGuestMessage.startsWith('Check Junior Suite from ') || input.latestGuestMessage.startsWith('How about ' + departureDate)) {
      // The model incorrectly returns the previous one-night stay for both messages.
      return toolResponse({ mode: 'COMPARE', reuseLastStay: true,
        arrivalDate: departureDate, departureDate: laterDeparture });
    }
    if (input.latestGuestMessage === 'Junior Suite for one guest, overlapping dates') {
      return toolResponse({ mode: 'COMPARE', arrivalDate: overlapArrival, departureDate: laterDeparture,
        guests: 1, categories: ['Junior Suite'] });
    }
    if (input.latestGuestMessage === 'How about the checkout day to the following day?') {
      assert.equal(input.lastCheckedStay.guests, 1);
      assert.deepEqual(input.lastCheckedStay.requestedCategories, ['Junior Suite']);
      return toolResponse({ mode: 'COMPARE', reuseLastStay: true,
        arrivalDate: departureDate, departureDate: laterDeparture });
    }
    if (input.latestGuestMessage === 'check again') {
      throw Object.assign(Error('Synthetic provider failure'), { status: 503 });
    }
    if (input.latestGuestMessage === 'no alternatives?') {
      assert.deepEqual(input.lastCheckedStay, {
        arrivalDate, departureDate, guests: 1, checkedCategories: ['Imperial', 'Luxury'],
        mode: 'FIRST_AVAILABLE', requestedCategories: ['Imperial', 'Luxury'],
      });
      return toolResponse({ mode: 'ALTERNATIVES' });
    }
    return toolResponse({ ...args, arrivalDate, departureDate, mode: 'FIRST_AVAILABLE' });
  });
  // Reload the tool module so the real WhatsApp handler sees the stubbed provider.
  delete require.cache[require.resolve('../src/services/preStayAvailabilityTool')];
  const { processGuestMessage } = require('../src/services/guestMessageService');
  const replies = [];
  const jid = '2348000000010@s.whatsapp.net';
  const send = (id, text = guestText) => processGuestMessage({
    channel: 'WHATSAPP', chat: { id: jid }, message: { text, message_id: id },
    async reply(text) { replies.push(text); return { message_id: 'test-' + id }; },
  });
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 8000 });
    await Promise.all([Room.init(), Reservation.init(), Enquiry.init(), Message.init()]);
    await mongoose.connection.db.collection('hotelSettings').insertOne({ _id: profile.hotelId, ...settings });
    const [imperial, luxury] = await Room.create([
      { number: '201', category: 'Imperial' }, { number: '301', category: 'Luxury' },
      { number: '101', category: 'Standard' }, { number: '401', category: 'Junior Suite', outOfOrder: true },
    ]);
    await send('before');
    assert.match(replies[0], /Imperial is available at ₦170,000/);
    assert.doesNotMatch(replies[0], /Luxury/);
    await Room.updateOne({ _id: imperial._id }, { $set: { outOfOrder: true } });
    await send('after');
    assert.match(replies[1], /Imperial isn’t available/);
    assert.match(replies[1], /Luxury is available at ₦220,000/);
    await Room.updateOne({ _id: luxury._id }, { $set: { outOfOrder: true } });
    await send('both-unavailable');
    assert.match(replies[2], /Luxury isn’t available/);
    await send('provider-failure', 'check again');
    assert.match(replies[3], /having trouble replying/);
    await send('alternatives', 'no alternatives?');
    assert.match(replies[4], /Standard is available at ₦130,000/);
    assert.doesNotMatch(replies[4], /Imperial|Luxury|Junior Suite/);
    assert.equal(modelCalls, 5);
    assert.equal(await Reservation.countDocuments(), 0);
    assert.equal(await Enquiry.countDocuments(), 0);
    const suite = await Room.findOne({ number: '401' });
    await Room.updateOne({ _id: suite._id }, { $set: { outOfOrder: false } });
    await Reservation.create({
      roomId: suite._id, roomNumber: suite.number, guestName: 'Reservation test guest', guestPhone: '2348000000011',
      arrivalAt: new Date(arrivalDate + 'T14:00:00+01:00'),
      departureAt: new Date(departureDate + 'T12:00:00+01:00'),
    });
    await send('overlap', 'Junior Suite for one guest, overlapping dates');
    assert.match(replies[5], /Junior Suite isn’t available/);
    await send('date-change', 'How about the checkout day to the following day?');
    assert.match(replies[6], /Junior Suite is available at ₦95,000 total/);
    assert.doesNotMatch(replies[6], /Standard is available|guest count/);
    assert.equal(modelCalls, 7);
    await send('explicit-overlap', 'Check Junior Suite from ' + overlapArrival + ' to ' + laterDeparture);
    assert.match(replies[7], /Junior Suite isn’t available/);
    const stored = await Message.findOne({ providerMessageId: 'explicit-overlap' }).select('+availabilityContext').lean();
    assert.equal(stored.availabilityContext.arrivalDate, overlapArrival);
    await send('explicit-date-change', 'How about ' + departureDate + ' to ' + laterDeparture + '?');
    assert.match(replies[8], /Junior Suite is available at ₦95,000 total/);
    assert.equal(modelCalls, 9);
    // Move every saved snapshot beyond the history window and add enough chatter
    // to push it out of the twelve-message context before starting a fresh process.
    await Message.collection.updateMany({ chatId: jid, availabilityContext: { $exists: true } },
      { $set: { createdAt: new Date(Date.now() - 2 * 86400000) } });
    await Message.create(Array.from({ length: 14 }, (_, index) => ({
      channel: 'WHATSAPP', chatId: jid, direction: 'INBOUND', text: 'Unrelated test chatter',
      idempotencyKey: 'resume-chatter-' + index, processingStatus: 'PROCESSED',
    })));
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const child = await promisify(execFile)(process.execPath, ['-e', `
      const mongoose = require('mongoose');
      require('./src/services/bookingWorkflowSettings').enabled = () => true;
      require('./src/services/guestAiService').generateGuestModelResponse = async () => ({
        functionCalls: [{ name: 'getEnquiryProgress', args: {} }]
      });
      const { processGuestMessage } = require('./src/services/guestMessageService');
      (async () => {
        await mongoose.connect(process.env.PMS_TEST_URI, { dbName: process.env.RESUME_TEST_DB });
        await processGuestMessage({
          channel: 'WHATSAPP', chat: { id: process.env.RESUME_TEST_JID },
          message: { text: 'I am back, can we continue?', message_id: 'resume-new-process' },
          reply: async text => {
            console.log(JSON.stringify({ resumeReply: text }));
            return { message_id: 'resume-new-process-outbound' };
          },
        });
        await mongoose.disconnect();
      })().catch(error => { console.error(error.message); process.exitCode = 1; });
    `], {
      cwd: require('node:path').join(__dirname, '..'), timeout: 15000,
      env: { ...process.env, PMS_TEST_URI: uri, RESUME_TEST_DB: dbName, RESUME_TEST_JID: jid },
    });
    const recap = JSON.parse(child.stdout.split('\n').find(line => line.startsWith('{"resumeReply":'))).resumeReply;
    assert.match(recap, /We last checked Junior Suite/);
    assert.match(recap, /1 guest/);
    assert.doesNotMatch(recap, /is available|₦/);
    assert.equal(await Reservation.countDocuments(), 1);
    assert.equal(await Enquiry.countDocuments(), 0);
  } finally {
    if (mongoose.connection.db?.databaseName === dbName) await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});

test('availability presents calendar nights and the property policy hours', async () => {
  const result = await answerAvailabilityTurn({text: guestText, history: [], workflow: {settings: {...settings, checkOutTime: '11:30'}}, now}, {
    generate: async () => toolResponse({...args, mode: 'COMPARE'}),
    lookup: async () => [{category: 'Imperial'}],
  });
  assert.match(result.reply, /21 Nov 2026 to 23 Nov 2026 \(2 nights\)/);
  assert.match(result.reply, /Standard check-in 2:00 PM · Checkout 11:30 AM \(WAT\)/);
});

test('latest configured category overrides stale model selection and survives date changes and alternatives', async () => {
  let previous = { arrivalDate: args.arrivalDate, departureDate: args.departureDate, guests: 1,
    requestedCategories: ['Standard'], checkedCategories: ['Standard'], mode: 'COMPARE' };
  const workflow = { settings, progress: { details: { ...args, category: 'Standard' } } };
  let lookupCount = 0;
  async function turn(text, modelArgs) {
    const result = await answerAvailabilityTurn({ text, history: [], workflow, availabilityContext: previous, now }, {
      generate: async request => {
        const context = JSON.parse(request.contents[0].parts[0].text);
        assert.equal(context.savedStay, undefined, 'No competing old workflow category');
        assert.deepEqual(context.lastCheckedStay, previous);
        return toolResponse(modelArgs);
      },
      lookup: async () => { lookupCount++; return settings.roomRates.map(rate => ({ category: rate.category })); },
    });
    if (result.availabilityContext) previous = result.availabilityContext;
    return result;
  }
  const changed = await turn('Is imperial available', { mode: 'COMPARE', reuseLastStay: true, categories: ['Standard'] });
  assert.match(changed.reply, /Imperial is available/);
  assert.doesNotMatch(changed.reply, /Standard is available/);
  assert.deepEqual(previous.requestedCategories, ['Imperial']);
  assert.deepEqual(previous.checkedCategories, ['Standard', 'Imperial']);
  assert.equal(previous.guests, 1);
  assert.equal(previous.arrivalDate, args.arrivalDate);
  const alternatives = await turn('What else can you offer?', { mode: 'ALTERNATIVES', reuseLastStay: true, categories: ['Imperial'] });
  assert.match(alternatives.reply, /Luxury is available/);
  assert.match(alternatives.reply, /Junior Suite is available/);
  assert.doesNotMatch(alternatives.reply, /Imperial is available|Standard is available/);
  const choose = await turn('Is Luxury available?', { mode: 'COMPARE', reuseLastStay: true, categories: ['Standard'] });
  assert.deepEqual(choose.availabilityContext.requestedCategories, ['Luxury']);
  const dates = await turn('How about 23 to 24 November?', { mode: 'COMPARE', reuseLastStay: true });
  assert.deepEqual(dates.availabilityContext.requestedCategories, ['Luxury']);
  assert.equal(dates.availabilityContext.arrivalDate, '2026-11-23');
  assert.deepEqual(dates.availabilityContext.checkedCategories, ['Luxury'], 'New dates reset discussed inventory');
  assert.equal(lookupCount, 4);
});

test('category grounding uses each property catalog, not fixed names or partial matches', async () => {
  const custom = { ...settings, roomRates: [{ category: 'Garden (Plus)', capacity: 2, nightlyMinor: 100000 }] };
  const result = await answerAvailabilityTurn({ text: 'Is Garden (Plus) available?', history: [], workflow: { settings: custom }, now }, {
    generate: async () => toolResponse({ ...args, categories: ['Standard'] }),
    lookup: async () => [{ category: 'Garden (Plus)' }],
  });
  assert.deepEqual(result.availabilityContext.requestedCategories, ['Garden (Plus)']);
  for (const text of ['Not Imperial, please', 'Anything other than Imperial', 'Is Imperialism a room name?', 'If Imperial is full, Luxury please']) {
    const outcome = await answerAvailabilityTurn({ text, history: [], workflow: { settings }, now }, {
      generate: async () => toolResponse({ ...args, categories: ['Luxury'] }),
      lookup: async () => [{ category: 'Luxury' }],
    });
    assert.deepEqual(outcome.availabilityContext.requestedCategories, ['Luxury'], 'Do not overwrite interpreted exclusions or complex preferences');
  }
});

test('alternatives remember unavailable options without repeating them, but explicit requests can recheck', async () => {
  const previous = { ...args, requestedCategories: ['Imperial'], checkedCategories: ['Imperial'] };
  const first = await answerAvailabilityTurn({ text: 'Any other options?', history: [], workflow: { settings }, availabilityContext: previous, now }, {
    generate: async () => toolResponse({ mode: 'ALTERNATIVES', reuseLastStay: true }), lookup: async () => [],
  });
  assert.equal(first.availabilityContext.checkedCategories.length, 4);
  const exhausted = await answerAvailabilityTurn({ text: 'Anything else?', history: [], workflow: { settings }, availabilityContext: first.availabilityContext, now }, {
    generate: async () => toolResponse({ mode: 'ALTERNATIVES', reuseLastStay: true }), lookup: async () => assert.fail('No unmentioned categories remain'),
  });
  assert.match(exhausted.reply, /couldn’t find any other room options/);
  const explicit = await answerAvailabilityTurn({ text: 'Check Imperial again', history: [], workflow: { settings }, availabilityContext: first.availabilityContext, now }, {
    generate: async () => toolResponse({ mode: 'COMPARE', reuseLastStay: true, categories: ['Imperial'] }), lookup: async () => [{ category: 'Imperial' }],
  });
  assert.match(explicit.reply, /Imperial is available/);
});
