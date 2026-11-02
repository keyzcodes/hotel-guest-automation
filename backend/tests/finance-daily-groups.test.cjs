const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupQuery, dailyPipeline, groupPage, cursorFor } = require('../src/modules/sales-expenses/dailyGroups');
test('daily groups apply complete date and department scope before aggregating and paginating groups', () => {
  const q = groupQuery({ from: '2026-10-01', to: '2026-10-31', departmentId: 'laundry', limit: '1' });
  const pipeline = dailyPipeline(q);
  assert.deepEqual(pipeline[0].$match, { businessDate: { $gte: q.from, $lte: q.to }, state: { $in: ['POSTED', 'VOID'] }, departmentId: 'laundry' });
  assert.deepEqual(pipeline[1].$group._id, { businessDate: '$businessDate', departmentId: '$departmentId' });
  assert.equal(pipeline.at(-1).$limit, 2);
  assert.deepEqual(pipeline[1].$group.expensesKobo.$sum.$cond[0], { $and: [{ $eq: ['$state', 'POSTED'] }, { $eq: ['$type', 'EXPENSE'] }] });
  assert.deepEqual(pipeline[1].$group.expensesKobo.$sum.$cond[1], { $toDecimal: '$amountKobo' });
});
test('keyset continuation includes whole groups with same-day department ordering and older dates', () => {
  const marker = { businessDate: '2026-10-31', departmentId: 'laundry' };
  const q = groupQuery({ from: '2026-10-01', to: '2026-10-31', after: cursorFor(marker) });
  assert.deepEqual(q.after, marker);
  assert.deepEqual(dailyPipeline(q)[0].$match.$or, [{ businessDate: { $lt: marker.businessDate } }, { businessDate: marker.businessDate, departmentId: { $gt: 'laundry' } }]);
});
test('zero sales submission stays distinct from void-only and missing sales; totals are exact', () => {
  const rows = [
    { _id: { businessDate: '2026-10-31', departmentId: 'gym' }, salesKobo: '0', expensesKobo: '0', salesCount: 1, expenseCount: 0, voidCount: 0 },
    { _id: { businessDate: '2026-10-31', departmentId: 'laundry' }, salesKobo: '0', expensesKobo: '400000', salesCount: 0, expenseCount: 2, voidCount: 1 },
  ];
  const page = groupPage(rows, 1);
  assert.equal(page.data[0].salesCount, 1);
  assert.equal(page.data[0].salesKobo, 0);
  assert.equal(groupQuery({ after: page.nextCursor }).after.departmentId, 'gym');
  assert.equal(groupPage(rows, 2).data[1].expensesKobo, 400000);
  assert.equal(groupPage(rows, 2).data[1].salesCount, 0);
  assert.equal(groupPage(rows, 2).nextCursor, null);
  assert.equal(groupPage([], 30).nextCursor, null);
  assert.throws(() => groupPage([{ ...rows[0], salesKobo: '9007199254740992' }], 1), /shorter/);
});
test('invalid cursors, unsupported filters and unbounded pagination fail closed', () => {
  for (const query of [{ after: 'bad' }, { limit: '101' }, { limit: '1.5' }, { limit: '' }, { includeVoided: 'true' }, { from: '2026-02-30' }, { after: Buffer.from('["2026-10-31","unknown"]').toString('base64url') }])
    assert.throws(() => groupQuery(query));
});

test('grouped HTTP endpoint retains authentication, validates filters and returns bounded groups without histories', async t => {
  const express = require('express'), http = require('node:http');
  process.env.SALES_EXPENSES_ENABLED = 'true'; process.env.STAFF_ACCOUNTS_ENABLED = 'true';
  const modelFile = require.resolve('../src/modules/sales-expenses/model'); require(modelFile);
  let seen, calls = 0;
  const fixture = { _id: { businessDate: '2026-10-31', departmentId: 'laundry' }, salesKobo: '1800000', expensesKobo: '400000', salesCount: 1, expenseCount: 2, voidCount: 1 };
  require.cache[modelFile].exports = {
    aggregate(pipeline) { calls++; seen = pipeline; return { option: async () => [fixture] }; },
  };
  const app = express(); app.use((req, res, next) => { req.staffSession = { staff: { id: 'a'.repeat(24), name: 'GM', role: 'GM' } }; next(); });
  app.use('/api/finance', require('../src/modules/sales-expenses/routes'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = query => fetch('http://127.0.0.1:' + server.address().port + '/api/finance/daily-groups?' + query);
  let response = await call('from=2026-10-31&to=2026-10-31&departmentId=laundry');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data[0].expensesKobo, 400000);
  assert.equal(result.data[0].salesKobo, 1800000);
  assert.equal(result.data[0].expenseCount, 2);
  assert.equal(result.data[0].history, undefined);
  assert.equal(seen.at(-1).$limit, 31);
  assert.equal(seen[0].$match.departmentId, 'laundry');
  response = await call('limit=1000'); assert.equal(response.status, 400); assert.equal(calls, 1);
  process.env.SALES_EXPENSES_ENABLED = 'false';
  assert.equal((await call('')).status, 404);
});
