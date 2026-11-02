const { departments } = require('./config');
const { date, range, EntryError } = require('./validation');
function cursorFor(row) {
  return Buffer.from(JSON.stringify([row.businessDate, row.departmentId])).toString('base64url');
}
function groupQuery(query) {
  if (Object.keys(query).some(key => !['from', 'to', 'departmentId', 'after', 'limit'].includes(key)))
    throw new EntryError('INVALID_INPUT', 'Invalid daily report filters.');
  const selected = range(query);
  const limit = query.limit === undefined ? 30 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^\d{1,3}$/.test(query.limit))))
    throw new EntryError('INVALID_INPUT', 'Use a page size between 1 and 100.');
  let after = null;
  if (query.after !== undefined) {
    try {
      if (typeof query.after !== 'string' || query.after.length > 200 || !/^[A-Za-z0-9_-]+$/.test(query.after)) throw Error();
      const value = JSON.parse(Buffer.from(query.after, 'base64url').toString());
      if (!Array.isArray(value) || value.length !== 2 || !departments.some(row => row.id === value[1])) throw Error();
      after = { businessDate: date(value[0]), departmentId: value[1] };
    } catch { throw new EntryError('INVALID_INPUT', 'Invalid daily report cursor.'); }
  }
  return { ...selected, limit, after };
}
function dailyPipeline(query) {
  const match = { businessDate: { $gte: query.from, $lte: query.to }, state: { $in: ['POSTED', 'VOID'] },
    ...(query.departmentId ? { departmentId: query.departmentId } : {}) };
  if (query.after) match.$or = [
    { businessDate: { $lt: query.after.businessDate } },
    { businessDate: query.after.businessDate, departmentId: { $gt: query.after.departmentId } },
  ];
  const posted = type => ({ $and: [{ $eq: ['$state', 'POSTED'] }, { $eq: ['$type', type] }] });
  return [
    { $match: match },
    { $group: {
      _id: { businessDate: '$businessDate', departmentId: '$departmentId' },
      salesKobo: { $sum: { $cond: [posted('SALE'), { $toDecimal: '$amountKobo' }, 0] } },
      expensesKobo: { $sum: { $cond: [posted('EXPENSE'), { $toDecimal: '$amountKobo' }, 0] } },
      salesCount: { $sum: { $cond: [posted('SALE'), 1, 0] } },
      expenseCount: { $sum: { $cond: [posted('EXPENSE'), 1, 0] } },
      voidCount: { $sum: { $cond: [{ $eq: ['$state', 'VOID'] }, 1, 0] } },
    } },
    { $sort: { '_id.businessDate': -1, '_id.departmentId': 1 } },
    { $limit: query.limit + 1 },
  ];
}
function exact(value) {
  const text = String(value ?? 0);
  if (!/^\d+$/.test(text) || BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new EntryError('TOTAL_TOO_LARGE', 'Choose a shorter reporting period.', 422);
  return Number(text);
}
function groupPage(rows, limit) {
  const data = rows.slice(0, limit).map(row => ({
    businessDate: row._id.businessDate, departmentId: row._id.departmentId,
    salesKobo: exact(row.salesKobo), expensesKobo: exact(row.expensesKobo),
    salesCount: row.salesCount, expenseCount: row.expenseCount, voidCount: row.voidCount,
  }));
  return { success: true, data, nextCursor: rows.length > limit ? cursorFor(data.at(-1)) : null };
}
module.exports = { groupQuery, dailyPipeline, groupPage, cursorFor };
