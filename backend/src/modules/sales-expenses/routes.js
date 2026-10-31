const express = require('express');
const config = require('./config');
const auth = require('../../services/staffAuthService');
const validate = require('./validation');
const { createService, publicEntry, matchRange, summaryPipeline, buildSummary } = require('./service');
const Entries = require('./model');
const service = createService(Entries);
const router = express.Router();
const idPattern = /^[a-f\d]{24}$/i;

// The parent API requires authentication and Origin validation. Reporting cannot
// use a shared identity because financial history must identify an individual.
router.use((req, res, next) => {
  if (!config.enabled()) return res.status(404).json({ success: false, message: 'Reporting is not enabled.' });
  if (!auth.individualAccountsEnabled() || !idPattern.test(req.staffSession?.staff?.id || ''))
    return res.status(403).json({ success: false, message: 'Sign in with an individual staff account.' });
  const expectedActor = req.headers['x-finance-actor'];
  if (expectedActor !== undefined && expectedActor !== req.staffSession.staff.id)
    return res.status(409).json({ success: false, code: 'IDENTITY_CHANGED', message: 'Sign in with the account that saved this pending entry.' });
  next();
});
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    if (error instanceof validate.EntryError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    console.error('Financial operation failed:', error.name);
    res.status(503).json({ success: false, code: 'SAVE_UNCONFIRMED', message: 'The operation could not be confirmed. Refresh or retry using the same request ID.' });
  }
};
router.get('/config', (req, res) => res.json({ success: true, currency: 'NGN', timezone: 'Africa/Lagos',
  maxAmountKobo: validate.MAX_KOBO, departments: config.departments, categories: config.categories }));
router.get('/summary', handle(async (req, res) => {
  if (Object.keys(req.query).some(key => !['from', 'to', 'departmentId'].includes(key)))
    throw new validate.EntryError('INVALID_INPUT', 'Summary accepts only from, to and departmentId.');
  const range = validate.range(req.query);
  const grouped = await Entries.aggregate(summaryPipeline(range)).option({ maxTimeMS: 10000 });
  res.json({ success: true, data: buildSummary(range, grouped) });
}));
router.get('/entries', handle(async (req, res) => {
  const range = validate.range(req.query);
  const { after, includeVoided } = req.query;
  if (after !== undefined && (typeof after !== 'string' || !idPattern.test(after)))
    throw new validate.EntryError('INVALID_INPUT', 'Invalid pagination cursor.');
  if (includeVoided !== undefined && !['true', 'false'].includes(includeVoided))
    throw new validate.EntryError('INVALID_INPUT', 'includeVoided must be true or false.');
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if ((req.query.limit !== undefined && (typeof req.query.limit !== 'string' || !/^\d{1,3}$/.test(req.query.limit))) || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new validate.EntryError('INVALID_INPUT', 'Use a page size between 1 and 100.');
  const filter = matchRange(range);
  if (includeVoided === 'true') delete filter.state;
  if (after) filter._id = { $lt: after };
  // Summary uses ALL matching entries. Pagination affects details only.
  const rows = await Entries.find(filter).select('-history -creationHash').sort({ _id: -1 }).limit(limit + 1).maxTimeMS(10000).lean();
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  res.json({ success: true, data: page.map(row => publicEntry(row)), nextCursor: more ? String(page.at(-1)._id) : null });
}));
router.param('id', (req, res, next, id) => {
  if (!idPattern.test(id)) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'Invalid entry ID.' });
  next();
});
router.get('/entries/:id', handle(async (req, res) => {
  const row = await Entries.findById(req.params.id).lean();
  if (!row) throw new validate.EntryError('NOT_FOUND', 'Entry not found.', 404);
  res.json({ success: true, data: publicEntry(row, true) });
}));
router.post('/entries', handle(async (req, res) => {
  const result = await service.create(validate.createInput(req.body), req.staffSession.staff);
  if (!result.replayed) require('../../services/realtimeService').publishChange('FinancialEntry');
  res.status(result.replayed ? 200 : 201).json({ success: true, data: result.entry, replayed: result.replayed });
}));
router.patch('/entries/:id', handle(async (req, res) => {
  const result = await service.correct(req.params.id, validate.correctInput(req.body), req.staffSession.staff);
  if (!result.replayed) require('../../services/realtimeService').publishChange('FinancialEntry');
  res.json({ success: true, data: result.entry, replayed: result.replayed });
}));
router.post('/entries/:id/void', handle(async (req, res) => {
  const result = await service.void(req.params.id, validate.voidInput(req.body), req.staffSession.staff);
  if (!result.replayed) require('../../services/realtimeService').publishChange('FinancialEntry');
  res.json({ success: true, data: result.entry, replayed: result.replayed });
}));
module.exports = router;
