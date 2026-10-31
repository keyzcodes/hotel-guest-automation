const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const auth = require('../src/services/staffAuthService');
const actor = { id: 'a'.repeat(24), role: 'STAFF', name: 'Reception' };
const id = 'b'.repeat(24), requestId = '00000000-0000-4000-8000-000000000001';
const input = { type: 'SALE', businessDate: '2026-10-01', departmentId: 'kitchen', amount: '10000', requestId };

test('financial HTTP routes enforce feature/identity gates, validation, replay and report scoping', async t => {
  process.env.SALES_EXPENSES_ENABLED = 'true'; process.env.STAFF_ACCOUNTS_ENABLED = 'true';
  let row = null, writes = 0, aggregateCount = 0, pipeline, filter, selectedLimit;
  const fake = {
    findOne: () => ({ lean: async () => row }),
    findById: () => ({ lean: async () => row }),
    async create(data) { writes++; row = { ...data, _id: id }; return row; },
    aggregate(value) { aggregateCount++; pipeline = value; return { option: async () => [] }; },
    find(value) {
      filter = value;
      return { select() { return this; }, sort() { return this; }, limit(value) { selectedLimit = value; return this; }, maxTimeMS() { return this; }, lean: async () => row ? [row] : [] };
    },
  };
  const filename = require.resolve('../src/modules/sales-expenses/model'); require(filename); require.cache[filename].exports = fake;
  const app = express(); app.use(express.json()); app.use(auth.requireOrigin);
  // Authentication itself is exercised by staff-auth-flow tests; this supplies
  // the resulting trusted identity while isolating financial HTTP behaviour.
  app.use((req, res, next) => { req.staffSession = { staff: req.headers['x-test-shared'] ? { role: 'GM' } : actor }; next(); });
  app.use('/api/finance', require('../src/modules/sales-expenses/routes'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (path, method = 'GET', body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/finance${path}`, {
    method, headers: { Origin: 'http://localhost:3001', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  process.env.SALES_EXPENSES_ENABLED = 'false'; assert.equal((await call('/config')).status, 404);
  process.env.SALES_EXPENSES_ENABLED = 'true'; assert.equal((await call('/config', 'GET', undefined, { 'x-test-shared': 'true' })).status, 403);
  assert.equal((await call('/entries', 'POST', { ...input, amount: -1 })).status, 400);
  assert.equal((await call('/entries', 'POST', input, { Origin: 'https://foreign.invalid' })).status, 403);
  assert.equal(writes, 0);
  const created = await call('/entries', 'POST', input); assert.equal(created.status, 201);
  const reply = await created.json(); assert.equal(reply.data.createdBy, actor.id);
  assert.equal(reply.data.amountKobo, 1000000); assert.equal(reply.data.creationHash, undefined);
  assert.equal((await call('/entries', 'POST', input)).status, 200); assert.equal(writes, 1);
  assert.equal((await call('/entries', 'POST', { ...input, amount: '20' })).status, 409);
  assert.equal((await call('/entries/bad')).status, 400);
  const summary = await call('/summary?from=2026-10-01&to=2026-10-30&departmentId=kitchen');
  assert.equal(summary.status, 200); assert.equal(pipeline[0].$match.departmentId, 'kitchen');
  assert.equal(pipeline[0].$match.state, 'POSTED');
  assert.equal((await call('/summary?limit=1')).status, 400); assert.equal(aggregateCount, 1);
  assert.equal((await call('/entries?limit=2&includeVoided=true')).status, 200);
  assert.equal(filter.state, undefined); assert.equal(selectedLimit, 3);
  for (const query of ['limit=1.5', 'limit=101', 'includeVoided=maybe', 'after=bad', 'limit='])
    assert.equal((await call('/entries?' + query)).status, 400);
});
