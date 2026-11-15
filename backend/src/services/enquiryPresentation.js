const { checkRoomAvailability, renderResult } = require('./preStayAvailabilityTool');
const { describeStay, policyTime } = require('./bookingWorkflow');
const money = (minor, currency) => new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
function recap(state) {
  const summary = describeStay({ ...state.stay, category: state.roomPreference.categories.join(' or ') });
  const complete = !!(state.stay.arrivalDate && state.stay.departureDate && state.stay.guests && summary);
  return {
    text: complete ? `Your current enquiry: ${summary}. Availability needs a fresh check.\nShall I check availability again?`
      : 'Your enquiry is saved, but the stay details are incomplete. What would you like to continue with?',
    question: complete ? 'Shall I check availability again?' : 'What would you like to continue with?',
  };
}
function fitsBudget(item, preference, nights) {
  return item.status !== 'AVAILABLE' ||
    ((preference.maxTotalMinor == null || item.totalMinor <= preference.maxTotalMinor) &&
     (preference.maxNightlyMinor == null || item.totalMinor / nights <= preference.maxNightlyMinor));
}
async function search(state, settings, now, lookup) {
  const preference = state.roomPreference;
  const automatic = preference.scope === 'SELECTED' && preference.allowAlternatives !== false;
  const mode = preference.scope === 'ALTERNATIVES' ? 'ALTERNATIVES' : preference.strategy;
  const request = { ...state.stay, mode: automatic ? 'COMPARE' : mode, reuseLastStay: false,
    ...(preference.scope === 'SELECTED' && !automatic ? { categories: preference.categories } : {}) };
  const result = await checkRoomAvailability(request, settings, now, lookup, { ...state.stay, checkedCategories: state.discussedCategories });
  if (result.status !== 'CHECKED') return { ...result, text: renderResult(result, undefined, mode), discussed: [] };
  const checkedCategories = result.categories.map(item => item.category);
  const requested = preference.scope === 'SELECTED'
    ? preference.categories.map(name => result.categories.find(item => item.category === name)).filter(Boolean) : result.categories;
  const within = item => fitsBudget(item, preference, result.nights);
  const availablePrimary = requested.filter(item => item.status === 'AVAILABLE' && within(item));
  // Preserve explicit conditional preference order, applying budget before selection.
  const display = mode === 'FIRST_AVAILABLE' && availablePrimary.length
    ? requested.slice(0, requested.indexOf(availablePrimary[0]) + 1) : requested;
  const priced = display.filter(item => item.status === 'AVAILABLE');
  const visible = display.filter(item => item.status !== 'AVAILABLE' || within(item));
  const lines = visible.map(item => {
    if (item.status === 'UNAVAILABLE') return `${item.category} isn’t available for those dates.`;
    if (item.status === 'CAPACITY_EXCEEDED') return `${item.category} accommodates up to ${item.capacity} guests.`;
    if (item.status === 'UNKNOWN_CATEGORY') return `${item.category} isn’t a configured room type.`;
    return `${item.category} is available at ${money(item.totalMinor, item.currency)} total.`;
  });
  let text;
  if (visible.length === 1 && visible[0].status === 'AVAILABLE') {
    text = `${visible[0].category} is available for ${result.dates} at ${money(visible[0].totalMinor, visible[0].currency)} total (${result.nights} ${result.nights === 1 ? 'night' : 'nights'}).`;
  } else text = `For ${result.dates} (${result.nights} ${result.nights === 1 ? 'night' : 'nights'}):\n${lines.join('\n')}`;
  const policySignature = `${settings.checkInTime}|${settings.checkOutTime}`;
  if (state.policySignature !== policySignature) text += `\nCheck-in ${policyTime(settings.checkInTime)} · Checkout ${policyTime(settings.checkOutTime)} (WAT).`;
  const overBudget = priced.filter(item => !within(item));
  if (overBudget.length) text += '\n' + overBudget.map(item => `${item.category} exceeds your stated budget (${money(item.totalMinor, item.currency)} total).`).join('\n');
  const alternatives = automatic && !availablePrimary.length
    ? result.categories.filter(item => !preference.categories.includes(item.category) && item.status === 'AVAILABLE' && within(item))
      .sort((a, b) => a.totalMinor - b.totalMinor || a.category.localeCompare(b.category)).slice(0, 2) : [];
  if (alternatives.length) {
    text += '\nOther options for the same dates and guest count:\n' + alternatives.map(item => `${item.category}: ${money(item.totalMinor, item.currency)} total.`).join('\n');
    text += alternatives.length === 1 ? '\nWould this option suit you?' : '\nWhich of these would you prefer?';
  } else if (!availablePrimary.length && preference.allowAlternatives !== false) {
    text += '\nI couldn’t find a suitable option in this search. Are your dates flexible?';
  }
  return { ...result, categories: display, alternatives, checkedCategories, text, policySignature,
    discussed: [...display, ...alternatives].map(item => item.category),
    hasOffer: availablePrimary.length > 0 || alternatives.length > 0,
    nextQuestion: alternatives.length === 1 ? 'Would this option suit you?' : alternatives.length > 1 ? 'Which of these would you prefer?' : null };
}
module.exports = { recap, search };
