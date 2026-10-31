const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const auth = require('../src/services/staffAuthService');

// Real HTTP and Socket.IO; isolated fake persistence, no hotel database or bot.
test('individual login, GM management, staff denial and access revocation over HTTP and realtime', async t => {
  process.env.STAFF_ACCOUNTS_ENABLED = 'true';
  process.env.SALES_EXPENSES_ENABLED = 'true';
  process.env.HOTEL_NAME = 'Verification Hotel';
  process.env.GUEST_MESSAGING_ENABLED = 'false';
  const password = 'Only-test-password-123';
  const passwordHash = await auth.hashPassword(password);
  const gm = { _id: 'a'.repeat(24), email: 'gm@example.test', name: 'GM', role: 'GM', active: true, authVersion: 1, passwordHash };
  const staff = { ...gm, _id: 'b'.repeat(24), email: 'staff@example.test', name: 'Reception', role: 'STAFF' };
  const accounts = [gm, staff], sessions = [];
  const query = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
    if (value?.$exists !== undefined) return (row[key] !== undefined) === value.$exists;
    if (value?.$gt) return row[key] > value.$gt;
    return String(row[key]) === String(value);
  });
  const Accounts = {
    findOne: filter => query(accounts.find(row => matches(row, filter)) || null),
    find: () => query(accounts.map(({ passwordHash, ...row }) => row)),
    async create(data) {
      if (accounts.some(row => row.email === data.email)) throw Object.assign(Error('duplicate'), { code: 11000 });
      const row = { ...data, _id: 'c'.repeat(24), authVersion: 1 }; accounts.push(row); return row;
    },
    async findOneAndUpdate(filter, update) {
      const row = accounts.find(row => matches(row, filter));
      if (!row) return null;
      Object.assign(row, update.$set); row.authVersion += update.$inc.authVersion; return row;
    },
  };
  const Sessions = {
    async create(data) { const row = { ...data, _id: String(sessions.length + 1) }; sessions.push(row); return row; },
    findOne: filter => query(sessions.find(row => matches(row, filter)) || null),
    find: filter => query(sessions.filter(row => matches(row, filter))),
    async deleteMany(filter) { for (let i = sessions.length - 1; i >= 0; i--) if (matches(sessions[i], filter)) sessions.splice(i, 1); },
    async findOneAndDelete(filter) { const at = sessions.findIndex(row => matches(row, filter)); return at < 0 ? null : sessions.splice(at, 1)[0]; },
  };
  for (const [name, replacement] of [
    ['StaffAccount', Accounts], ['StaffSession', Sessions],
    ['StaffLoginAttempt', { findOneAndUpdate: async () => ({ count: 1 }) }],
  ]) {
    const filename = require.resolve(`../src/models/${name}`); require(filename); require.cache[filename].exports = replacement;
  }
  const app = express(); app.use(express.json()); app.use('/api', auth.requireOrigin);
  app.use('/api/auth', require('../src/routes/staffAuthRoutes')); app.use('/api', auth.requireStaff);
  app.use('/api/staff', require('../src/routes/staffAccountRoutes'));
  const server = http.createServer(app), realtime = require('../src/services/realtimeService');
  const io = realtime.startRealtime(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => realtime.closeRealtime());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (url, cookie, method = 'GET', body) => fetch(base + url, {
    method, headers: { Origin: 'http://localhost:3001', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  async function login(email) {
    const response = await call('/api/auth/login', null, 'POST', { email, password });
    assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
  }
  const staffCookie = await login(staff.email), gmCookie = await login(gm.email);
  const session = await (await call('/api/auth/session', staffCookie)).json();
  assert.equal(session.role, 'STAFF'); assert.equal(session.id, staff._id);
  assert.equal(session.passwordHash, undefined);
  assert.equal(session.hotelName, 'Verification Hotel');
  assert.equal(session.modules.salesExpenses, true);
  assert.equal(session.guestMessagingEnabled, false);
  const branding = await (await call('/api/auth/branding')).json();
  assert.deepEqual(branding, { hotelName: 'Verification Hotel' });
  assert.equal((await call('/api/staff', staffCookie)).status, 403);
  const list = await (await call('/api/staff', gmCookie)).json();
  assert.equal(list.data.length, 2); assert.equal(list.data[0].passwordHash, undefined);
  assert.equal((await call('/api/staff', gmCookie, 'POST', { email: 'new@example.test', name: 'New', password, role: 'GM' })).status, 400);
  assert.equal((await call('/api/staff', gmCookie, 'POST', { email: 'new@example.test', name: 'New', password })).status, 201);
  assert.equal((await call('/api/staff', gmCookie, 'POST', { email: 'new@example.test', name: 'New', password })).status, 409);
  // Open an authenticated socket and verify disabling staff disconnects it.
  const opened = await call('/socket.io/?EIO=4&transport=polling', staffCookie);
  const sid = JSON.parse((await opened.text()).slice(1)).sid;
  await fetch(`${base}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    method: 'POST', headers: { Origin: 'http://localhost:3001', Cookie: staffCookie, 'Content-Type': 'text/plain' }, body: '40',
  });
  await call(`/socket.io/?EIO=4&transport=polling&sid=${sid}`, staffCookie);
  assert.equal(io.sockets.sockets.size, 1);
  assert.equal((await call(`/api/staff/${gm._id}`, gmCookie, 'PATCH', { active: false })).status, 404);
  assert.equal((await call(`/api/staff/${staff._id}`, gmCookie, 'PATCH', { active: false })).status, 200);
  assert.equal(io.sockets.sockets.size, 0);
  assert.equal((await call('/api/auth/session', staffCookie)).status, 401);
  assert.equal((await call('/api/auth/login', null, 'POST', { email: staff.email, password })).status, 401);
  assert.equal((await call(`/api/staff/${staff._id}`, gmCookie, 'PATCH', { active: true })).status, 200);
  assert.equal((await call('/api/auth/session', staffCookie)).status, 401);
  await login(staff.email);
});
