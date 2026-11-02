import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function read(name, requires = {}) {
 const compiled = { exports: {} };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/finance/' + name + '.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: compiled.exports, structuredClone, require: key => requires[key] });
 return compiled.exports;
}
const offline = read('offlineQueue');
const { combinedBodies } = read('combinedEntry', { './offlineQueue': offline });
const config = { departments: [{ id: 'kitchen', sales: true, categories: ['food'] }, { id: 'general', sales: false, categories: ['fuel'] }] };
const draft = { businessDate: '2026-10-31', departmentId: 'kitchen', sales: '85000', expense: '35000', categoryId: 'food', note: 'Demo', salesId: 'sale-id', expenseId: 'expense-id' };
const bodies = form => JSON.parse(JSON.stringify(combinedBodies(form, config, '2026-11-02')));
function store() {
 const rows = new Map(); let commits = 0;
 return { rows, get commits() { return commits; }, list: async owner => [...rows.values()].filter(row => row.owner === owner),
  put: async item => { rows.set(item.id, structuredClone(item)); }, remove: async id => rows.delete(id),
  putMany: async items => { commits++; for (const item of items) rows.set(item.id, structuredClone(item)); } };
}
test('both amounts produce independently identified records with exact input amounts', () => {
 const result = bodies(draft);
 assert.equal(result.length, 2);
 assert.deepEqual(result.map(row => [row.type, row.amount, row.requestId, row.categoryId]), [['SALE', '85000', 'sale-id', null], ['EXPENSE', '35000', 'expense-id', 'food']]);
});
test('sales only, expense only and explicit zero never manufacture a second record', () => {
 assert.deepEqual(bodies({ ...draft, expense: '', categoryId: '' }).map(row => row.type), ['SALE']);
 assert.deepEqual(bodies({ ...draft, sales: '' }).map(row => row.type), ['EXPENSE']);
 assert.equal(bodies({ ...draft, sales: '0', expense: '' })[0].amount, '0');
 assert.deepEqual(bodies({ ...draft, departmentId: 'general', categoryId: 'fuel' }).map(row => row.type), ['EXPENSE']);
});
test('whole form validation runs before any save', () => {
 for (const patch of [{ sales: '', expense: '' }, { expense: '0' }, { categoryId: '' }, { businessDate: '2026-11-03' }, { sales: '1.234' }])
  assert.throws(() => bodies({ ...draft, ...patch }));
});
test('combined local submission commits once; retry with same IDs never duplicates', async () => {
 const s = store();
 await offline.enqueueBatch(s, 'midey', bodies(draft));
 assert.equal(s.commits, 1); assert.equal(s.rows.size, 2);
 await offline.enqueueBatch(s, 'midey', bodies(draft));
 assert.equal(s.commits, 1); assert.equal(s.rows.size, 2);
});
test('local conflicts and transaction failures do not stage half a form', async () => {
 const s = store();
 await offline.enqueue(s, 'midey', bodies(draft)[0]);
 await assert.rejects(offline.enqueueBatch(s, 'midey', bodies({ ...draft, salesId: 'other-sale' })), /already waiting/);
 assert.equal(s.rows.size, 1); assert.equal(s.commits, 0);
 const failed = store(); failed.putMany = async () => { throw Error('disk full'); };
 await assert.rejects(offline.enqueueBatch(failed, 'midey', bodies(draft)), /disk full/);
 assert.equal(failed.rows.size, 0);
});
test('a rejected sale does not discard the expense and later retries skip settled records', async () => {
 const s = store(); await offline.enqueueBatch(s, 'midey', bodies(draft));
 let calls = 0;
 await offline.syncQueue(s, 'midey', async item => { calls++; return item.body.type === 'SALE' ? { status: 409, message: 'Daily sale exists' } : { status: 201, confirmed: true }; });
 assert.equal(s.rows.get('sale-id').status, 'review'); assert.equal(s.rows.get('expense-id').status, 'saved');
 await offline.syncQueue(s, 'midey', async () => { throw Error('Settled entries must not retry'); });
 assert.equal(calls, 2);
});
test('lost expense response retries its original ID without reposting saved sale', async () => {
 const s = store(); await offline.enqueueBatch(s, 'midey', bodies(draft));
 const calls = [];
 await offline.syncQueue(s, 'midey', async item => {
  calls.push(item.id); if (item.id === 'expense-id') throw Error('Lost reply');
  return { status: 201, confirmed: true };
 });
 await offline.syncQueue(s, 'midey', async item => { calls.push(item.id); return { status: 200, confirmed: true }; });
 assert.deepEqual(calls, ['sale-id', 'expense-id', 'expense-id']);
});

test('legacy queued bodies are matched by fields rather than property order', async () => {
 const s = store(); const sale = bodies(draft)[0];
 await offline.enqueue(s, 'midey', { requestId: sale.requestId, type: sale.type, amount: sale.amount, note: sale.note, businessDate: sale.businessDate, departmentId: sale.departmentId, categoryId: null });
 await offline.enqueueBatch(s, 'midey', bodies(draft));
 assert.equal(s.rows.size, 2);
 assert.equal(s.rows.get('sale-id').body.requestId, 'sale-id');
});
