const { departments } = require('./config');
const MAX_KOBO = 1_000_000_000_000;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
class EntryError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function fail(message) { throw new EntryError('INVALID_INPUT', message); }
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('Unexpected or invalid fields.');
}
function lagosDate(now = new Date()) {
  // The hotel's business date is Lagos time, independent of server/browser zones.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Use a date in YYYY-MM-DD format.');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '2000-01-01') fail('Enter a valid business date from 2000 onward.');
  return value;
}
function money(value, type) {
  // Parse decimal naira text exactly. Never multiply a floating-point input.
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value)) fail('Enter an amount as digits with at most two decimal places.');
  const [whole, fractional = ''] = value.split('.');
  const kobo = BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
  if (kobo > BigInt(MAX_KOBO) || (type === 'EXPENSE' && kobo === 0n)) fail('Amount is outside the allowed range. Expenses must be greater than zero.');
  return Number(kobo);
}
function department(id) {
  const result = departments.find(item => item.id === id);
  if (!result) fail('Choose a valid department.');
  return result;
}
function values(body, today = lagosDate()) {
  if (!['SALE', 'EXPENSE'].includes(body.type)) fail('Choose SALE or EXPENSE.');
  const dept = department(body.departmentId);
  if (body.type === 'SALE' && !dept.sales) fail('General Operations is for shared expenses only.');
  const businessDate = date(body.businessDate);
  if (businessDate > today) fail('Future sales and expenses cannot be recorded.');
  const categoryId = body.categoryId === undefined || body.categoryId === '' ? null : body.categoryId;
  if (body.type === 'SALE' && categoryId !== null) fail('Sales do not have expense categories.');
  if (body.type === 'EXPENSE' && !dept.categories.includes(categoryId)) fail('Choose an expense category available for this department.');
  const note = body.note === undefined ? '' : body.note;
  if (typeof note !== 'string' || note.trim().length > 500) fail('Notes must be at most 500 characters.');
  return { type: body.type, businessDate, departmentId: dept.id, categoryId, amountKobo: money(body.amount, body.type), note: note.trim() };
}
function requestId(value) { if (typeof value !== 'string' || !uuid.test(value)) fail('Provide a UUID v4 request ID.'); return value.toLowerCase(); }
function version(value) { if (!Number.isSafeInteger(value) || value < 1) fail('Provide the saved entry version.'); return value; }
const fields = ['type', 'businessDate', 'departmentId', 'categoryId', 'amount', 'note'];
function createInput(body, today) {
  object(body, [...fields, 'requestId']);
  return { ...values(body, today), requestId: requestId(body.requestId) };
}
function correctInput(body, today) {
  object(body, [...fields, 'expectedVersion', 'mutationId', 'reason']);
  const reason = body.reason === undefined ? '' : body.reason;
  if (typeof reason !== 'string' || reason.trim().length > 200) fail('Correction notes must be at most 200 characters.');
  return { ...values(body, today), expectedVersion: version(body.expectedVersion), mutationId: requestId(body.mutationId), reason: reason.trim() };
}
function voidInput(body) {
  object(body, ['expectedVersion', 'mutationId', 'reason']);
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 200) fail('Give a short void reason (at most 200 characters).');
  return { expectedVersion: version(body.expectedVersion), mutationId: requestId(body.mutationId), reason: body.reason.trim() };
}
function range(query, today = lagosDate()) {
  object(query, ['from', 'to', 'departmentId', 'after', 'limit', 'includeVoided']);
  const from = date(query.from ?? `${today.slice(0, 7)}-01`), to = date(query.to ?? today);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days < 1 || days > 366) fail('Choose a reporting period of at most 366 days.');
  if (query.departmentId !== undefined) department(query.departmentId);
  return { from, to, departmentId: query.departmentId, today };
}
module.exports = { MAX_KOBO, EntryError, lagosDate, date, money, createInput, correctInput, voidInput, range };
