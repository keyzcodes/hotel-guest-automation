import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/finance/offlineQueue.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: compiled.exports, structuredClone });
const { enqueue, syncQueue, entryProblem } = compiled.exports;
const body = { requestId: '00000000-0000-4000-8000-000000000001', type: 'EXPENSE', businessDate: '2026-10-31', departmentId: 'kitchen', categoryId: 'food', amount: '2500.00', note: 'Test' };
const config = { departments: [{ id: 'kitchen', sales: true, categories: ['food'] }, { id: 'general', sales: false, categories: ['fuel'] }] };
function memory() {
 const rows = new Map();
 return { rows, list: async owner => structuredClone([...rows.values()].filter(row => row.owner === owner)), put: async row => { rows.set(row.id, structuredClone(row)); }, remove: async id => { rows.delete(id); } };
}
test('queue persists exact payload and stable ID before acknowledging local save', async () => {
 const store = memory(); const input = { ...body };
 const item = await enqueue(store, 'midey', input); input.amount = '9000';
 assert.equal(item.status, 'waiting'); assert.equal(store.rows.get(body.requestId).body.amount, '2500.00');
 await enqueue(store, 'midey', body); assert.equal(store.rows.size, 1);
 await assert.rejects(enqueue(store, 'midey', { ...body, amount: '5000' }), /different values/);
});
test('storage failure cannot return a locally saved acknowledgement', async () => {
 const store = memory(); store.put = async () => { throw Error('quota'); };
 await assert.rejects(enqueue(store, 'midey', body), /quota/);
});
test('lost response retries identical ID and body and settles only on confirmed receipt', async () => {
 const store = memory(); await enqueue(store, 'midey', body);
 const sent = []; let writes = 0; const server = new Map();
 const send = async item => {
  sent.push(JSON.stringify(item.body));
  if (!server.has(item.id)) { server.set(item.id, item.body); writes++; }
  if (sent.length === 1) throw Error('response lost');
  return { status: 200, confirmed: true };
 };
 await syncQueue(store, 'midey', send);
 assert.equal(store.rows.get(body.requestId).status, 'waiting');
 await syncQueue(store, 'midey', send);
 await syncQueue(store, 'midey', send);
 assert.equal(writes, 1); assert.equal(sent.length, 2); assert.equal(sent[0], sent[1]);
 assert.equal(store.rows.get(body.requestId).status, 'saved');
});
test('daily sale conflicts stop automatic retries and retain payload for review', async () => {
 const store = memory(); await enqueue(store, 'midey', { ...body, type: 'SALE', categoryId: null });
 let calls = 0;
 const send = async () => { calls++; return { status: 409, message: 'Daily sale exists.' }; };
 await syncQueue(store, 'midey', send); await syncQueue(store, 'midey', send);
 assert.equal(calls, 1); assert.equal(store.rows.get(body.requestId).status, 'review');
 assert.equal(store.rows.get(body.requestId).body.amount, '2500.00');
});
test('duplicate local daily sales are blocked but separate expenses are allowed', async () => {
 const store = memory(); const sale = { ...body, type: 'SALE', categoryId: null };
 await enqueue(store, 'midey', sale);
 await assert.rejects(enqueue(store, 'midey', { ...sale, requestId: 'other' }), /already waiting/);
 await enqueue(store, 'midey', { ...body, requestId: 'expense1' });
 await enqueue(store, 'midey', { ...body, requestId: 'expense2' });
 assert.equal(store.rows.size, 3);
});
test('other staff cannot trigger queued sends; expired, disabled and switched sessions pause', async () => {
 for (const status of [401, 403, 409]) {
  const store = memory(); await enqueue(store, 'midey', body);
  let calls = 0;
  await syncQueue(store, 'gm', async () => { throw Error('must not send'); });
  await syncQueue(store, 'midey', async () => { calls++; return { status, message: status === 409 ? 'IDENTITY_CHANGED' : 'Sign in' }; });
  assert.equal(calls, 1); assert.equal(store.rows.get(body.requestId).status, 'waiting');
 }
 const store = memory(); await enqueue(store, 'midey', body);
 await syncQueue(store, 'midey', async () => { throw Error('must not send'); }, () => false);
});
test('server failures, rate limits and malformed success do not become saved', async () => {
 for (const status of [408, 429, 503, 200]) {
  const store = memory(); await enqueue(store, 'midey', body);
  await syncQueue(store, 'midey', async () => ({ status }));
  assert.equal(store.rows.get(body.requestId).status, 'waiting');
 }
});
test('acknowledgement storage failure retains retryable item after server success', async () => {
 const store = memory(); await enqueue(store, 'midey', body);
 store.put = async () => { throw Error('storage full'); };
 await assert.rejects(syncQueue(store, 'midey', async () => ({ status: 201, confirmed: true })), /storage full/);
 assert.equal(store.rows.get(body.requestId).status, 'waiting');
});
test('local validation rejects future dates, invalid categories and unsafe amounts', () => {
 assert.equal(entryProblem(body, config, '2026-10-31'), '');
 for (const change of [{ businessDate: '2026-11-01' }, { businessDate: '2026-02-30' }, { categoryId: 'fuel' }, { amount: '10000000001' }, { amount: '0' }, { amount: '1.234' }, { amount: '-1' }, { departmentId: 'general', type: 'SALE' }])
  assert.notEqual(entryProblem({ ...body, ...change }, config, '2026-10-31'), '');
 assert.equal(entryProblem({ ...body, type: 'SALE', categoryId: null, amount: '0' }, config, '2026-10-31'), '');
});
