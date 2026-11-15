const { performance } = require('node:perf_hooks');
const { generateGuestModelResponse } = require('./guestAiService');
const { aiTimeouts } = require('./workflowTimeouts');
const { explicitCategory } = require('./preStayAvailabilityTool');
const { changeState } = require('./enquiryState');
const { tools, instruction } = require('./enquiryAgentContract');
const { policyTime } = require('./bookingWorkflow');
const { lagosDay } = require('./whatsappAvailability');
const { recap, search } = require('./enquiryPresentation');
const failureReply = 'I’m having trouble replying right now. Please try again shortly, or contact reception if it’s urgent.';
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));

function hotelFacts(topic, settings) {
  if (topic === 'ROOM_TYPES') return { categories: (settings.roomRates ?? []).map(({ category, capacity }) => ({ category, capacity })),
    text: 'Room types: ' + (settings.roomRates ?? []).map(rate => rate.category).join(', ') + '.' };
  if (topic === 'POLICIES') return { text: `Standard check-in ${policyTime(settings.checkInTime)} · Checkout ${policyTime(settings.checkOutTime)} (WAT).` +
    (settings.policies?.cancellation ? '\n' + settings.policies.cancellation : '') };
  if (topic === 'AMENITIES') return { text: settings.amenities?.length ? settings.amenities.join(', ') + '.' : 'Amenities have not been configured.' };
  return { text: [settings.name, settings.city].filter(Boolean).join(' · ') || 'Hotel details have not been configured.' };
}

async function runEnquiryAgent({ text, history = [], workflow, session, timing, now = new Date() }, {
  generate = generateGuestModelResponse, lookup = require('./roomInventory').availableRooms,
  clock = () => performance.now(), budgetMs = aiTimeouts().preStay.timeoutMs,
} = {}) {
  const started = clock();
  let state = structuredClone(session.state), version = session.version, lastAvailabilityId, toolCount = 0;
  const results = new Map();
  const executed = new Set();
  const trace = [];
  const measure = (name, op) => timing ? timing.measure(name, op) : op();
  const model = process.env.WHATSAPP_PRE_STAY_MODEL?.trim() || 'gemini-3.1-flash-lite';
  const settings = workflow.settings;
  const view = () => ({ enquiryId: session.id, version, ...state });
  const outcome = (reply, extra = {}) => ({ action: 'ANSWER', bookingEnquiry: !!Object.keys(state.stay).length,
    workflowHandled: true, reply, ...extra });
  async function save(next) {
    const saved = await measure('enquiry_save', () => session.save(version, next));
    state = saved.state; version = saved.version;
  }
  function remember(result) {
    const resultId = `result_${results.size + 1}`;
    results.set(resultId, result);
    return { ...result, resultId, enquiry: view() };
  }
  const contents = [{ role: 'user', parts: [{ text: JSON.stringify({
    today: lagosDay.format(now), timeZone: 'Africa/Lagos', enquiry: view(),
    configuredCategories: settings.roomRates?.map(rate => rate.category),
    recentMessages: history, latestGuestMessage: text,
  }) }] }];
  async function execute(call) {
    const args = call.args ?? {};
    if (call.name === 'replyToGuest') {
      if (!keysOnly(args, ['message', 'resultIds', 'pendingQuestion', 'recapEnquiry']) || typeof args.message !== 'string' || args.message.length > 750 ||
          !Array.isArray(args.resultIds) || args.resultIds.length > 4 || args.resultIds.some(id => typeof id !== 'string' || !results.has(id)) ||
          (args.pendingQuestion !== undefined && args.pendingQuestion !== null && (typeof args.pendingQuestion !== 'string' || !args.pendingQuestion.trim() || args.pendingQuestion.length > 300))) {
        return { status: 'INVALID_REPLY', instruction: 'Use only result IDs returned this turn and a short message.' };
      }
      if (args.recapEnquiry !== undefined && typeof args.recapEnquiry !== 'boolean') return { status: 'INVALID_REPLY' };
      const progress = [...results.values()].some(item => item.status === 'PROGRESS');
      if (args.recapEnquiry || (progress && !lastAvailabilityId)) {
        const rendered = recap(state);
        if (state.pendingQuestion !== rendered.question) await save({ ...state, pendingQuestion: rendered.question });
        return { final: outcome(rendered.text, { enquiryProgressUsed: true }) };
      }
      // A recap containing concrete saved stay facts needs a backend result or the
      // inline recap flag. This is a grounding check, not phrase-based intent routing.
      const completeStay = state.stay.arrivalDate && state.stay.departureDate && state.stay.guests;
      const stayFact = completeStay && [state.stay.arrivalDate, state.stay.departureDate, ...state.roomPreference.categories]
        .some(value => args.message.toLowerCase().includes(value.toLowerCase()));
      if (stayFact && !args.resultIds.length && !lastAvailabilityId) return { status: 'UNGROUNDED_REPLY',
        instruction: 'Display facts through a tool result, or set recapEnquiry true to render the saved enquiry with one clear next question. Do not write stay facts directly in message.' };
      const ids = new Set(args.resultIds);
      // Always deliver the latest verified availability result even if the model omits it.
      if (lastAvailabilityId) ids.add(lastAvailabilityId);
      const reply = [lastAvailabilityId ? '' : args.message.trim(), ...[...ids].map(id => results.get(id).text)].filter(Boolean).join('\n\n');
      if (!reply) return { status: 'INVALID_REPLY' };
      if (args.pendingQuestion !== undefined && args.pendingQuestion !== state.pendingQuestion) {
        await save({ ...state, pendingQuestion: args.pendingQuestion });
      }
      return { final: outcome(reply) };
    }
    if (call.name === 'getHotelInformation') {
      if (!keysOnly(args, ['topic']) || !['ROOM_TYPES', 'POLICIES', 'AMENITIES', 'HOTEL'].includes(args.topic)) return { status: 'INVALID_ARGUMENTS' };
      return remember({ status: 'INFORMATION', ...hotelFacts(args.topic, settings) });
    }
    if (call.name === 'getEnquiryProgress') {
      if (!keysOnly(args, [])) return { status: 'INVALID_ARGUMENTS' };
      return remember({ status: 'PROGRESS', text: recap(state).text,
        pendingQuestion: state.pendingQuestion, quoteIsHistorical: true });
    }
    if (!['updateEnquiry', 'checkAvailability'].includes(call.name)) return { status: 'TOOL_NOT_ALLOWED' };
    if (!Number.isInteger(args.expectedVersion) || args.expectedVersion !== version) return { status: 'STATE_CHANGED', enquiry: view() };
    if (call.name === 'checkAvailability' && (!args.selection || args.reset !== undefined)) return { status: 'INVALID_SELECTION' };
    const namedCategory = explicitCategory(text, settings);
    if (namedCategory && ['SELECTED', 'KEEP_CURRENT'].includes(args.selection?.scope)) {
      const selected = args.selection.scope === 'SELECTED' ? args.selection.categories : state.roomPreference.categories;
      if (Array.isArray(selected) && !selected.some(value => typeof value === 'string' && value.toLowerCase() === namedCategory.toLowerCase())) {
        return { status: 'CATEGORY_MISMATCH', latestExplicitCategory: namedCategory,
          instruction: 'The latest explicit category differs from the proposed selection. Correct the tool arguments or clarify; do not reuse the old category.' };
      }
    }
    // SELECTED means a guest preference, not an option invented by the model.
    // Previously discussed categories may be referenced indirectly. A new option
    // must be grounded in the latest message or discovered through a broad search.
    if (args.selection?.scope === 'SELECTED' && Array.isArray(args.selection.categories)) {
      const catalog = new Map((settings.roomRates ?? []).map(rate => [rate.category.toLowerCase(), rate.category]));
      const discussed = new Set([...state.roomPreference.categories, ...state.discussedCategories].map(value => value.toLowerCase()));
      const unsupported = args.selection.categories.filter(value => {
        if (typeof value !== 'string') return false; // normal schema validation handles it
        const canonical = catalog.get(value.trim().toLowerCase());
        if (!canonical || discussed.has(canonical.toLowerCase())) return false;
        const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return !new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'iu').test(text);
      });
      if (unsupported.length) return { status: 'SELECTION_NOT_GROUNDED',
        instruction: 'Do not choose an unrequested new category. Use ALTERNATIVES to search all remaining options, ALL for a broad search, or ask for clarification. SELECTED is for a guest-selected category or a reference to an already discussed option.' };
    }
    const changed = changeState(state, args, settings, now);
    if (changed.status !== 'UPDATED') return changed;
    if (JSON.stringify(changed.state) !== JSON.stringify(state)) await save(changed.state);
    if (call.name === 'updateEnquiry') return { status: 'UPDATED', enquiry: view(), reservationChanged: false };
    const checked = await search(state, settings, now, range => measure('pms_lookup', () => lookup(range)));
    if (checked.status === 'CHECKED') {
      const discussed = [...new Set([...state.discussedCategories,
        ...checked.discussed])];
      await save({ ...state, stage: checked.hasOffer ? 'QUOTED' : 'EXPLORING',
        pendingQuestion: checked.nextQuestion, discussedCategories: discussed, policySignature: checked.policySignature,
        lastQuote: { checkedAt: now.toISOString(), expiresAt: new Date(+now + (settings.quoteMinutes || 30) * 60000).toISOString(), result: checked } });
    } else if (state.lastQuote) {
      await save({ ...state, stage: 'EXPLORING', lastQuote: null });
    }
    const result = remember({ ...checked, createsHold: false });
    lastAvailabilityId = result.resultId;
    return result;
  }
  try {
    if (process.env.USE_MOCK_AI === 'true' && generate === generateGuestModelResponse) throw Error('Live AI disabled');
    for (let round = 0; round < 6; round++) {
      const remaining = Math.floor(budgetMs - (clock() - started));
      if (remaining < 1000) throw Object.assign(Error('Agent budget exhausted'), { name: 'AiDeadlineError' });
      const response = await measure('pre_stay_ai', () => generate({ model, contents, timeoutMs: remaining, maxRetries: 2,
        config: { systemInstruction: instruction, tools: [{ functionDeclarations: tools }],
          toolConfig: { functionCallingConfig: { mode: 'ANY' } } } }));
      const calls = response.functionCalls ?? [];
      // Retain original parts, including thought signatures, across tool rounds.
      const content = response.candidates?.[0]?.content;
      if (!calls.length || calls.length > 1) throw Object.assign(Error('Expected one tool per step'), { code: 'INVALID_MODEL_OUTPUT' });
      const call = calls[0];
      if (++toolCount > 6) throw Object.assign(Error('Tool step limit'), { code: 'TOOL_LIMIT' });
      const signature = JSON.stringify({ name: call.name, args: call.args, version });
      let result;
      if (executed.has(signature)) result = { status: 'REPEATED_TOOL', instruction: 'Do not repeat this step. Reply or ask one focused clarification.' };
      else { executed.add(signature); result = await execute(call); }
      trace.push({ tool: tools.some(tool => tool.name === call.name) ? call.name : 'unknown', status: result.status ?? 'REPLIED', version,
        ...(['checkAvailability', 'updateEnquiry'].includes(call.name) ? {
          requestedScope: ['ALL', 'SELECTED', 'ALTERNATIVES', 'KEEP_CURRENT'].includes(call.args?.selection?.scope) ? call.args.selection.scope : null,
          resolvedScope: state.roomPreference.scope,
          preferencePreserved: call.args?.selection?.scope !== 'KEEP_CURRENT' && call.args?.selection?.scope !== state.roomPreference.scope,
          selectedCategories: state.roomPreference.categories,
          checkedCategories: result.checkedCategories ?? result.categories?.map(item => item.category),
        } : {}),
      });
      if (result.final?.enquiryProgressUsed) trace[trace.length - 1].recapFromState = true;
      if (result.final) return result.final;
      contents.push(content ?? { role: 'model', parts: [{ functionCall: call }] });
      contents.push({ role: 'user', parts: [{ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: result } }] });
    }
    throw Object.assign(Error('Agent step limit'), { code: 'TOOL_LIMIT' });
  } catch (error) {
    const failure = error.code === 'STATE_CHANGED' ? 'state_changed' : error.name === 'AiDeadlineError' ? 'deadline'
      : error.code === 'TOOL_LIMIT' || error.code === 'INVALID_MODEL_OUTPUT' ? 'contract' : 'provider_or_storage';
    console.warn('ENQUIRY_AGENT_FAILURE', JSON.stringify({ failure, providerStatus: Number(error.status) || null }));
    if (failure === 'state_changed') return outcome('Your enquiry changed while I was checking. Please send your latest request again.');
    if (lastAvailabilityId) return outcome(results.get(lastAvailabilityId).text);
    return outcome(failureReply, { fallback: true, failure: { kind: failure, providerStatus: Number(error.status) || null } });
  } finally {
    try { console.info('ENQUIRY_AGENT_TRACE', JSON.stringify({ version, elapsedMs: Math.round(clock() - started), steps: trace })); } catch {}
  }
}
module.exports = { runEnquiryAgent, hotelFacts };
