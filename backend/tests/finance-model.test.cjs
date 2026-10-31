const { test } = require('node:test');
const assert = require('node:assert/strict');
const Entries = require('../src/modules/sales-expenses/model');
const requestId = '00000000-0000-4000-8000-000000000001';
function record(changes = {}) {
  const values = { type: 'SALE', businessDate: '2026-10-01', departmentId: 'kitchen', categoryId: null,
    amountKobo: 1000000, state: 'POSTED', note: '', ...changes };
  return { ...values, requestId, creationHash: 'a'.repeat(64), createdBy: 'a'.repeat(24), version: 1,
    history: [{ mutationId: requestId, payloadHash: 'a'.repeat(64), action: 'CREATE', actorId: 'a'.repeat(24), actorName: 'Reception', at: new Date(), after: values }] };
}
test('financial model validates records without a database and declares persistent uniqueness indexes', async () => {
  await new Entries(record()).validate();
  const indexes = Entries.schema.indexes();
  const sales = indexes.find(([, options]) => options.name === 'one_posted_sale_per_day');
  assert.equal(sales[1].unique, true);
  assert.deepEqual(sales[1].partialFilterExpression, { type: 'SALE', state: 'POSTED' });
  assert.ok(indexes.some(([fields, options]) => fields.requestId === 1 && options.unique));
});
test('model rejects fractional kobo and invalid expense/category combinations', async () => {
  await assert.rejects(new Entries(record({ amountKobo: 10.1 })).validate());
  await assert.rejects(new Entries(record({ type: 'EXPENSE', categoryId: 'diesel' })).validate());
  await assert.rejects(new Entries(record({ businessDate: '2026-02-29' })).validate());
});
