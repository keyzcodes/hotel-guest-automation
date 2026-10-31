const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Decimal128 } = require('mongoose').mongo;
const { buildSummary, summaryPipeline } = require('../src/modules/sales-expenses/service');
const { range } = require('../src/modules/sales-expenses/validation');
test('summary marks missing records separately from a confirmed zero sale', () => {
  const period = range({ from: '2026-10-29', to: '2026-10-30' }, '2026-10-30');
  const summary = buildSummary(period, [{ _id: 'kitchen', salesKobo: Decimal128.fromString('0'), expensesKobo: Decimal128.fromString('125005'), salesDays: ['2026-10-29'], expenseCount: 1 }]);
  const kitchen = summary.departments.find(row => row.departmentId === 'kitchen');
  assert.equal(kitchen.salesDaysEntered, 1); assert.equal(kitchen.salesStatus, 'INCOMPLETE');
  assert.deepEqual(kitchen.missingSalesDates, ['2026-10-30']);
  assert.equal(summary.departments.find(row => row.departmentId === 'bar').salesStatus, 'NOT_ENTERED');
  const general = summary.departments.find(row => row.departmentId === 'general');
  assert.equal(general.salesKobo, null); assert.equal(general.salesStatus, 'NOT_APPLICABLE');
  assert.equal(general.expenseStatus, 'NO_EXPENSES_RECORDED');
  assert.deepEqual(summary.totals, { salesKobo: 0, expensesKobo: 125005 });
  assert.equal(summary.incompleteSales, true);
});
test('report adds department totals exactly and future days do not count as missing', () => {
  const period = range({ from: '2026-10-30', to: '2026-10-31', departmentId: 'kitchen' }, '2026-10-30');
  const summary = buildSummary(period, [{ _id: 'kitchen', salesKobo: Decimal128.fromString('29'), expensesKobo: Decimal128.fromString('10'), salesDays: ['2026-10-30', null], expenseCount: 1 }]);
  assert.equal(summary.departments.length, 1); assert.equal(summary.departments[0].salesStatus, 'COMPLETE');
  assert.equal(summary.incompleteSales, false); assert.equal(summary.coverageThrough, '2026-10-30');
  assert.deepEqual(summary.totals, { salesKobo: 29, expensesKobo: 10 });
});
test('unsafe totals fail explicitly rather than silently rounding financial results', () => {
  assert.throws(() => buildSummary(range({}, '2026-10-30'), [{ _id: 'bar', salesKobo: Decimal128.fromString('9007199254740992') }]), { code: 'TOTAL_TOO_LARGE' });
});
test('summary pipeline excludes voids and scopes dates/department before grouping, without pagination', () => {
  const period = range({ from: '2026-10-01', to: '2026-10-30', departmentId: 'bar' }, '2026-10-30');
  const pipeline = summaryPipeline(period);
  assert.deepEqual(pipeline[0].$match, { state: 'POSTED', businessDate: { $gte: '2026-10-01', $lte: '2026-10-30' }, departmentId: 'bar' });
  assert.equal(pipeline.some(step => step.$limit || step.$skip), false);
  assert.equal(pipeline[1].$group.salesKobo.$sum.$cond[1].$toDecimal, '$amountKobo');
});
