const { createHash } = require('node:crypto');
const { departments } = require('./config');
const { EntryError } = require('./validation');
const snapshotFields = ['type', 'businessDate', 'departmentId', 'categoryId', 'amountKobo', 'note', 'state'];
const snapshot = row => Object.fromEntries(snapshotFields.map(key => [key, row[key]]));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function publicEntry(row, audit = false) {
  const plain = row.toObject ? row.toObject() : row;
  const result = { id: String(plain._id), ...snapshot(plain), version: plain.version,
    createdBy: String(plain.createdBy), createdAt: plain.createdAt, updatedAt: plain.updatedAt };
  if (audit) result.history = plain.history;
  return result;
}
function requireActor(actor) {
  if (!actor || !/^[a-f\d]{24}$/i.test(actor.id) || !['GM', 'STAFF'].includes(actor.role) || !actor.name)
    throw new EntryError('IDENTITY_REQUIRED', 'Sign in with an individual staff account.', 403);
}
function conflict(code, message) { return new EntryError(code, message, 409); }

function createService(Entries) {
  async function replay(requestId, hash, actor) {
    const saved = await Entries.findOne({ requestId }).lean();
    if (!saved) return null;
    if (saved.creationHash !== hash || String(saved.createdBy) !== actor.id)
      throw conflict('REQUEST_ID_REUSED', 'This request ID was used for different data. Refresh before retrying.');
    return { entry: publicEntry(saved, true), replayed: true };
  }
  async function create(input, actor) {
    requireActor(actor);
    const { requestId, ...values } = input;
    const hash = digest(values);
    const previous = await replay(requestId, hash, actor);
    if (previous) return previous;
    const after = { ...values, state: 'POSTED' }, at = new Date();
    try {
      const row = await Entries.create({ ...after, requestId, creationHash: hash,
        createdBy: actor.id, version: 1,
        history: [{ mutationId: requestId, payloadHash: hash, action: 'CREATE',
          actorId: actor.id, actorName: actor.name, at, reason: '', before: null, after }],
      });
      return { entry: publicEntry(row, true), replayed: false };
    } catch (error) {
      if (error.code !== 11000) throw error;
      // An identical submission may win a race; return it without saving twice.
      const winner = await replay(requestId, hash, actor);
      if (winner) return winner;
      throw conflict('DAILY_SALE_EXISTS', 'A sales total already exists for this department and day. Open it to make a correction.');
    }
  }
  function replayMutation(row, input, actor, hash) {
    const event = row.history.find(item => item.mutationId === input.mutationId);
    if (!event) return null;
    if (event.payloadHash !== hash || String(event.actorId) !== actor.id)
      throw conflict('REQUEST_ID_REUSED', 'This correction ID was used for different data.');
    return { entry: publicEntry(row, true), replayed: true };
  }
  async function mutate(id, input, actor, action) {
    requireActor(actor);
    const row = await Entries.findById(id).lean();
    if (!row) throw new EntryError('NOT_FOUND', 'Entry not found.', 404);
    const hash = digest({ action, ...input });
    const previous = replayMutation(row, input, actor, hash);
    if (previous) return previous;
    if (row.state !== 'POSTED') throw conflict('ENTRY_VOIDED', 'This entry has been voided and cannot be edited.');
    if (row.version !== input.expectedVersion) throw conflict('VERSION_CONFLICT', 'Someone changed this entry. Refresh and review the saved version.');
    if (row.history.length >= 200) throw conflict('HISTORY_LIMIT', 'This entry has reached its correction limit. Contact the administrator.');
    const before = snapshot(row);
    const { expectedVersion, mutationId, reason, ...values } = input;
    if (action === 'CORRECT' && values.type !== row.type)
      throw new EntryError('INVALID_INPUT', 'Void an incorrectly classified entry and create the correct type.');
    const after = action === 'VOID' ? { ...before, state: 'VOID' } : { ...values, state: 'POSTED' };
    try {
      // Data and its audit event change in one atomic document write. No second
      // history write or multi-document transaction can be lost independently.
      const updated = await Entries.findOneAndUpdate({ _id: id, version: expectedVersion,
        state: 'POSTED', 'history.199': { $exists: false } }, {
        $set: after, $inc: { version: 1 }, $push: { history: {
          mutationId, payloadHash: hash, action, actorId: actor.id, actorName: actor.name,
          at: new Date(), reason, before, after,
        } },
      }, { returnDocument: 'after', runValidators: true }).lean();
      if (updated) return { entry: publicEntry(updated, true), replayed: false };
      const latest = await Entries.findById(id).lean();
      if (latest) {
        const retry = replayMutation(latest, input, actor, hash);
        if (retry) return retry;
      }
      throw conflict('VERSION_CONFLICT', 'Someone changed this entry. Refresh before correcting it.');
    } catch (error) {
      if (error.code === 11000) throw conflict('DAILY_SALE_EXISTS', 'The corrected department and date already have a sales total.');
      throw error;
    }
  }
  return { create, correct: (id, input, actor) => mutate(id, input, actor, 'CORRECT'),
    void: (id, input, actor) => mutate(id, input, actor, 'VOID') };
}

function matchRange(range) {
  return { state: 'POSTED', businessDate: { $gte: range.from, $lte: range.to },
    ...(range.departmentId ? { departmentId: range.departmentId } : {}) };
}
function summaryPipeline(range) {
  return [
    { $match: matchRange(range) },
    { $group: {
      _id: '$departmentId',
      // Decimal aggregation keeps integer-kobo addition exact, even before we
      // check that the response fits JSON's safe integer range.
      salesKobo: { $sum: { $cond: [{ $eq: ['$type', 'SALE'] }, { $toDecimal: '$amountKobo' }, 0] } },
      expensesKobo: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, { $toDecimal: '$amountKobo' }, 0] } },
      salesDays: { $addToSet: { $cond: [{ $eq: ['$type', 'SALE'] }, '$businessDate', null] } },
      expenseCount: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, 1, 0] } },
    } },
  ];
}
function safeTotal(value) {
  const text = String(value ?? 0);
  if (!/^\d+$/.test(text) || BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new EntryError('TOTAL_TOO_LARGE', 'The report total exceeds the supported exact range. Choose a shorter period.', 422);
  return Number(text);
}
function buildSummary(range, grouped) {
  const expectedDates = [];
  const last = range.to < range.today ? range.to : range.today;
  for (let day = range.from; day <= last;) {
    expectedDates.push(day);
    day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
  }
  const rows = departments.filter(item => !range.departmentId || range.departmentId === item.id).map(dept => {
    const saved = grouped.find(item => item._id === dept.id);
    const dates = new Set(saved?.salesDays?.filter(Boolean) || []);
    const missingDates = dept.sales ? expectedDates.filter(day => !dates.has(day)) : [];
    return { departmentId: dept.id, name: dept.name, supportsSales: dept.sales,
      salesKobo: dept.sales ? safeTotal(saved?.salesKobo) : null,
      expensesKobo: safeTotal(saved?.expensesKobo), expenseCount: saved?.expenseCount || 0,
      salesDaysEntered: dept.sales ? dates.size : null,
      salesStatus: !dept.sales ? 'NOT_APPLICABLE' : dates.size === 0 ? 'NOT_ENTERED' : missingDates.length ? 'INCOMPLETE' : 'COMPLETE',
      missingSalesDates: missingDates,
      expenseStatus: saved?.expenseCount ? 'RECORDED' : 'NO_EXPENSES_RECORDED',
    };
  });
  return { period: { from: range.from, to: range.to }, timezone: 'Africa/Lagos', currency: 'NGN',
    generatedAt: new Date(), coverageThrough: expectedDates.at(-1) || null,
    totals: {
      salesKobo: safeTotal(rows.reduce((sum, row) => sum + BigInt(row.salesKobo || 0), 0n)),
      expensesKobo: safeTotal(rows.reduce((sum, row) => sum + BigInt(row.expensesKobo), 0n)),
    },
    incompleteSales: rows.some(row => row.missingSalesDates.length > 0), departments: rows,
  };
}
module.exports = { createService, publicEntry, matchRange, summaryPipeline, buildSummary };
