const { test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/modules/sales-expenses/validation');
const requestId = '00000000-0000-4000-8000-000000000001';
const input = { requestId, type: 'SALE', departmentId: 'kitchen', businessDate: '2026-10-30', amount: '10000.01' };
test('money parses exact kobo and permits explicitly confirmed zero sales', () => {
  assert.equal(v.money('10000.01', 'SALE'), 1000001);
  assert.equal(v.money('0.29', 'EXPENSE'), 29);
  assert.equal(v.money('0', 'SALE'), 0);
  assert.equal(v.money('10000000000.00', 'SALE'), v.MAX_KOBO);
  for (const value of [0.29, -1, '1e3', 'NaN', '', '01', '1,000', '0.001', '-2', '10000000000.01']) {
    assert.throws(() => v.money(value, 'SALE'));
  }
  assert.throws(() => v.money('0', 'EXPENSE'));
});
test('server validates department/category mapping and refuses injected audit identity', () => {
  assert.equal(v.createInput(input, '2026-10-30').amountKobo, 1000001);
  for (const data of [
    { ...input, createdBy: 'attacker' }, { ...input, state: 'VOID' },
    { ...input, departmentId: 'general' }, { ...input, categoryId: 'ingredients' },
    { ...input, type: 'EXPENSE', categoryId: 'drinks' },
    { ...input, type: 'EXPENSE', categoryId: 'diesel' },
    { ...input, requestId: 'not-a-uuid' }, { ...input, amount: 100 },
  ]) assert.throws(() => v.createInput(data, '2026-10-30'));
  assert.equal(v.createInput({ ...input, type: 'EXPENSE', departmentId: 'general', categoryId: 'diesel' }, '2026-10-30').categoryId, 'diesel');
});
test('business dates validate calendar days, reject future entries and use Lagos midnight', () => {
  assert.equal(v.lagosDate(new Date('2026-10-29T23:30:00Z')), '2026-10-30');
  assert.equal(v.date('2024-02-29'), '2024-02-29');
  for (const date of ['2026-02-29', '2026-13-01', '2026-04-31', '1999-12-31', '30/10/2026', '2026-10-30T00:00:00Z']) assert.throws(() => v.date(date));
  assert.throws(() => v.createInput({ ...input, businessDate: '2026-10-31' }, '2026-10-30'));
});
test('report ranges include leap years but bound expensive or malformed queries', () => {
  assert.deepEqual(v.range({}, '2026-10-30'), { from: '2026-10-01', to: '2026-10-30', departmentId: undefined, today: '2026-10-30' });
  assert.equal(v.range({ from: '2024-01-01', to: '2024-12-31' }, '2026-10-30').to, '2024-12-31');
  for (const query of [{ from: '' }, { from: '2025-01-01', to: '2026-12-31' }, { from: '2026-10-31', to: '2026-10-01' }, { departmentId: 'unknown' }, { from: { $gt: '' } }, { surprise: true }]) assert.throws(() => v.range(query, '2026-10-30'));
});
test('corrections require versions and stable IDs; voids require an explanatory reason', () => {
  const { requestId: mutationId, ...data } = input;
  assert.equal(v.correctInput({ ...data, mutationId, expectedVersion: 1 }, '2026-10-30').reason, '');
  for (const expectedVersion of [0, '1', -1, 1.1]) assert.throws(() => v.correctInput({ ...data, mutationId, expectedVersion }, '2026-10-30'));
  assert.throws(() => v.voidInput({ mutationId, expectedVersion: 1, reason: ' ' }));
  assert.equal(v.voidInput({ mutationId, expectedVersion: 1, reason: ' Duplicate ' }).reason, 'Duplicate');
});
