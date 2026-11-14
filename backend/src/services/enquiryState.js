const { stayRange } = require('./bookingWorkflow');
const fields = ['arrivalDate', 'departureDate', 'guests'];
const scopes = ['ALL', 'SELECTED', 'ALTERNATIVES', 'KEEP_CURRENT'];
const strategies = ['COMPARE', 'FIRST_AVAILABLE'];
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
function initialState(seed) {
  const stay = {};
  for (const field of fields) if (seed?.[field] !== undefined) stay[field] = seed[field];
  const categories = seed?.requestedCategories ?? (seed?.category ? [seed.category] : []);
  return { stage: 'EXPLORING', stay,
    roomPreference: { scope: categories.length ? 'SELECTED' : 'ALL', categories, strategy: seed?.mode === 'FIRST_AVAILABLE' ? 'FIRST_AVAILABLE' : 'COMPARE' },
    discussedCategories: [], lastQuote: null, pendingQuestion: null };
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function changeState(current, args, settings, now = new Date()) {
  if (!plain(args) || Object.keys(args).some(key => !['expectedVersion', 'changes', 'selection', 'reset'].includes(key)) ||
      (args.reset !== undefined && typeof args.reset !== 'boolean')) return { status: 'INVALID_ARGUMENTS' };
  if (args.reset && (args.changes || args.selection)) return { status: 'INVALID_ARGUMENTS' };
  const next = structuredClone(args.reset ? initialState() : current);
  const changes = args.changes ?? {};
  if (!plain(changes) || Object.keys(changes).some(key => !fields.includes(key))) return { status: 'INVALID_ARGUMENTS' };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete next.stay[key];
    else if (key === 'guests' ? Number.isInteger(value) && value >= 1 && value <= 99 : validDate(value)) next.stay[key] = value;
    else return { status: 'INVALID_DETAILS', field: key };
  }
  if (next.stay.arrivalDate && next.stay.departureDate && !stayRange(next.stay, settings, now)) return { status: 'INVALID_DATES' };
  if (args.selection) {
    const selection = args.selection;
    if (!plain(selection) || Object.keys(selection).some(key => !['scope', 'categories', 'strategy', 'allowAlternatives', 'maxTotalMinor', 'maxNightlyMinor', 'replacePreference'].includes(key)) ||
        !scopes.includes(selection.scope) || (selection.strategy !== undefined && !strategies.includes(selection.strategy))) return { status: 'INVALID_SELECTION' };
    if (selection.replacePreference !== undefined && typeof selection.replacePreference !== 'boolean') return { status: 'INVALID_SELECTION' };
    const stayChanged = JSON.stringify(current.stay) !== JSON.stringify(next.stay);
    const preservePreference = stayChanged && ['ALL', 'ALTERNATIVES'].includes(selection.scope) &&
      current.roomPreference.scope !== selection.scope && selection.replacePreference !== true;
    const constraints = {};
    if (selection.allowAlternatives !== undefined && typeof selection.allowAlternatives !== 'boolean') return { status: 'INVALID_SELECTION' };
    for (const key of ['allowAlternatives', 'maxTotalMinor', 'maxNightlyMinor']) {
      if (key !== 'allowAlternatives' && selection[key] !== undefined && selection[key] !== null && (!Number.isSafeInteger(selection[key]) || selection[key] < 0)) return { status: 'INVALID_SELECTION' };
      if (current.roomPreference[key] !== undefined) constraints[key] = current.roomPreference[key];
      if (selection[key] !== undefined) constraints[key] = selection[key];
    }
    if (selection.scope === 'SELECTED') {
      if (!Array.isArray(selection.categories) || !selection.categories.length || selection.categories.length > 8) return { status: 'INVALID_SELECTION' };
      const catalog = new Map((settings.roomRates ?? []).map(rate => [rate.category.toLowerCase(), rate.category]));
      const categories = selection.categories.map(value => typeof value === 'string' ? catalog.get(value.trim().toLowerCase()) : undefined);
      if (categories.some(value => !value)) return { status: 'UNKNOWN_CATEGORY' };
      next.roomPreference = { ...constraints, scope: 'SELECTED', categories: [...new Set(categories)], strategy: selection.strategy ?? 'COMPARE' };
    } else {
      if (selection.categories !== undefined || selection.strategy !== undefined) return { status: 'INVALID_SELECTION' };
      if (selection.scope !== 'KEEP_CURRENT' && !preservePreference) next.roomPreference = { ...constraints, scope: selection.scope, categories: [], strategy: 'COMPARE' };
      else next.roomPreference = { ...next.roomPreference, ...constraints };
    }
  }
  if (JSON.stringify(current.stay) !== JSON.stringify(next.stay)) next.discussedCategories = [];
  if (args.reset || JSON.stringify(current.stay) !== JSON.stringify(next.stay) || JSON.stringify(current.roomPreference) !== JSON.stringify(next.roomPreference)) {
    next.lastQuote = null; next.stage = 'EXPLORING'; next.pendingQuestion = null;
  }
  return { status: 'UPDATED', state: next };
}
module.exports = { initialState, changeState, fields, scopes };
