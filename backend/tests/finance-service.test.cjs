const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../src/modules/sales-expenses/service');
const v = require('../src/modules/sales-expenses/validation');
const actor = { id: 'a'.repeat(24), name: 'Reception', role: 'STAFF' };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const data = (n = 1, changes = {}) => v.createInput({ type: 'SALE', departmentId: 'kitchen', businessDate: '2026-10-30', amount: '10000', requestId: uuid(n), ...changes }, '2026-10-30');
// These stores exercise service behaviour, not MongoDB's own index engine.
function fixture() {
  const rows = []; let writes = 0;
  const clone = value => value ? structuredClone(value) : null;
  function unique(row, exclude) {
    if (rows.some(saved => saved._id !== exclude &&
      (saved.requestId === row.requestId || (row.type === 'SALE' && row.state === 'POSTED' && saved.type === 'SALE' && saved.state === 'POSTED' && saved.departmentId === row.departmentId && saved.businessDate === row.businessDate))))
      throw Object.assign(Error('duplicate'), { code: 11000 });
  }
  const store = {
    findOne: filter => ({ lean: async () => clone(rows.find(row => row.requestId === filter.requestId)) }),
    findById: id => ({ lean: async () => clone(rows.find(row => row._id === id)) }),
    async create(row) {
      unique(row); const saved = { ...clone(row), _id: String(rows.length + 1).padStart(24, '0'), createdAt: new Date(), updatedAt: new Date() };
      rows.push(saved); writes++; return clone(saved);
    },
    findOneAndUpdate(filter, update) { return { lean: async () => {
      const at = rows.findIndex(row => row._id === filter._id && row.version === filter.version && row.state === 'POSTED' && row.history.length < 200);
      if (at < 0) return null;
      const result = { ...clone(rows[at]), ...clone(update.$set), version: rows[at].version + 1 };
      unique(result, result._id); result.history.push(clone(update.$push.history));
      rows[at] = result; writes++; return clone(result);
    } }; },
  };
  return { service: createService(store), rows, writes: () => writes };
}
const correction = (mutation, amount, expectedVersion = 1, changes = {}) => v.correctInput({ mutationId: uuid(mutation), expectedVersion, type: 'SALE', departmentId: 'kitchen', businessDate: '2026-10-30', amount, ...changes }, '2026-10-30');

test('create records trusted actor and exact amount; replay never creates a second record', async () => {
  const f = fixture();
  const result = await f.service.create(data(), actor);
  assert.equal(result.entry.amountKobo, 1000000); assert.equal(result.entry.history[0].actorId, actor.id);
  assert.equal(result.entry.creationHash, undefined);
  assert.equal((await f.service.create(data(), actor)).replayed, true);
  assert.equal(f.writes(), 1);
  await assert.rejects(f.service.create(data(1, { amount: '9000' }), actor), { code: 'REQUEST_ID_REUSED' });
  await assert.rejects(f.service.create(data(), { ...actor, id: 'b'.repeat(24) }), { code: 'REQUEST_ID_REUSED' });
});
test('concurrent same-ID submissions create once; distinct daily sales IDs conflict', async () => {
  const f = fixture();
  const result = await Promise.all([f.service.create(data(), actor), f.service.create(data(), actor)]);
  assert.equal(f.rows.length, 1); assert.equal(result.filter(row => row.replayed).length, 1);
  await assert.rejects(f.service.create(data(2), actor), { code: 'DAILY_SALE_EXISTS' });
});
test('separate expenses can coexist on the same date and department', async () => {
  const f = fixture();
  await f.service.create(data(1, { type: 'EXPENSE', categoryId: 'ingredients' }), actor);
  await f.service.create(data(2, { type: 'EXPENSE', categoryId: 'ingredients' }), actor);
  assert.equal(f.rows.length, 2);
});
test('correction is atomic with audit history and stale editors cannot overwrite', async () => {
  const f = fixture(), first = await f.service.create(data(), actor), id = first.entry.id;
  const settled = await Promise.allSettled([
    f.service.correct(id, correction(2, '12000'), actor),
    f.service.correct(id, correction(3, '15000'), actor),
  ]);
  assert.equal(settled.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(settled.find(row => row.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  assert.equal(f.rows[0].version, 2); assert.equal(f.rows[0].history.length, 2);
  assert.equal(f.rows[0].history[1].before.amountKobo, 1000000);
  assert.equal(f.rows[0].history[1].after.amountKobo, f.rows[0].amountKobo);
});
test('correction retries preserve later changes and reuse of IDs for changed data fails', async () => {
  const f = fixture(), id = (await f.service.create(data(), actor)).entry.id;
  await f.service.correct(id, correction(2, '12000'), actor);
  await f.service.correct(id, correction(3, '13000', 2), actor);
  const replay = await f.service.correct(id, correction(2, '12000'), actor);
  assert.equal(replay.replayed, true); assert.equal(replay.entry.amountKobo, 1300000);
  assert.equal(f.writes(), 3);
  await assert.rejects(f.service.correct(id, correction(2, '14000'), actor), { code: 'REQUEST_ID_REUSED' });
});
test('void is idempotent, releases the daily slot and never deletes history', async () => {
  const f = fixture(), id = (await f.service.create(data(), actor)).entry.id;
  const input = v.voidInput({ mutationId: uuid(2), expectedVersion: 1, reason: 'Duplicate daily total' });
  await f.service.void(id, input, actor);
  assert.equal((await f.service.void(id, input, actor)).replayed, true);
  await assert.rejects(f.service.correct(id, correction(3, '12000', 2), actor), { code: 'ENTRY_VOIDED' });
  await f.service.create(data(4), actor);
  assert.equal(f.rows.length, 2); assert.equal(f.rows[0].history[1].after.state, 'VOID');
});
test('moving a corrected sale into an occupied date fails without changing either row', async () => {
  const f = fixture(), id = (await f.service.create(data(), actor)).entry.id;
  await f.service.create(data(2, { businessDate: '2026-10-29' }), actor);
  await assert.rejects(f.service.correct(id, correction(3, '12000', 1, { businessDate: '2026-10-29' }), actor), { code: 'DAILY_SALE_EXISTS' });
  assert.equal(f.rows[0].version, 1); assert.equal(f.rows[0].history.length, 1);
});
test('financial writes refuse a shared account or missing record and preserve database failures', async () => {
  const f = fixture();
  await assert.rejects(f.service.create(data(), { name: 'Shared staff', role: 'GM' }), { code: 'IDENTITY_REQUIRED' });
  await assert.rejects(f.service.correct('f'.repeat(24), correction(2, '12000'), actor), { code: 'NOT_FOUND' });
  const service = createService({ findOne: () => ({ lean: async () => { throw Error('database unavailable'); } }) });
  await assert.rejects(service.create(data(), actor), /database unavailable/);
  assert.equal(f.writes(), 0);
});
