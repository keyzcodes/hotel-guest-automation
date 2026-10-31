const { test } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/services/staffAuthService');
const service = require('../src/services/staffAccountService');

test('staff input normalises identity and rejects injected roles and empty names', () => {
  const valid = { name: ' Reception ', email: ' Staff@Example.test ', password: 'Test-password-123' };
  assert.deepEqual(service.validateNewStaff(valid), { ...valid, name: 'Reception', email: 'staff@example.test' });
  for (const input of [null, [], { ...valid, role: 'GM' }, { ...valid, active: false },
    { ...valid, name: ' ' }, { ...valid, email: 'bad' }, { ...valid, password: 'short' }]) {
    assert.throws(() => service.validateNewStaff(input));
  }
});

test('account sessions require an active matching identity version; legacy sessions are excluded', async () => {
  const previous = process.env.STAFF_ACCOUNTS_ENABLED;
  process.env.STAFF_ACCOUNTS_ENABLED = 'true';
  try {
    const row = { _id: 'session', staffId: 'staff', authVersion: 2 };
    let sessionFilter, staffFilter;
    const Sessions = { findOne(filter) { sessionFilter = filter; return { lean: async () => row }; } };
    let staff = { _id: 'staff', name: 'Reception', email: 'staff@example.test', role: 'STAFF', passwordHash: 'secret' };
    const Accounts = { findOne(filter) { staffFilter = filter; return { lean: async () => staff }; } };
    const result = await auth.authenticate({ cookie: `${auth.COOKIE}=${'c'.repeat(64)}` }, Sessions, Accounts);
    assert.deepEqual(sessionFilter.staffId, { $exists: true });
    assert.deepEqual(staffFilter, { _id: 'staff', active: true, authVersion: 2 });
    assert.equal(result.staff.role, 'STAFF');
    assert.equal(result.staff.passwordHash, undefined);
    staff = null;
    assert.equal(await auth.authenticate({ cookie: `${auth.COOKIE}=${'c'.repeat(64)}` }, Sessions, Accounts), null);
  } finally {
    if (previous === undefined) delete process.env.STAFF_ACCOUNTS_ENABLED;
    else process.env.STAFF_ACCOUNTS_ENABLED = previous;
  }
});

test('access changes revoke all devices and restrict mutation to staff, never the GM', async () => {
  let filter, update, deleted;
  const revoked = [];
  const Accounts = { async findOneAndUpdate(f, u) {
    filter = f; update = u; return { _id: 'staff', name: 'Reception', email: 's@example.test', role: 'STAFF' };
  } };
  const Sessions = {
    find(f) { assert.deepEqual(f, { staffId: 'staff' }); return { select: () => ({ lean: async () => [{ _id: 'one' }, { _id: 'two' }] }) }; },
    async deleteMany(f) { deleted = f; },
  };
  await service.setStaffActive('staff', false, { Accounts, Sessions, realtime: { revokeSession: id => revoked.push(id) } });
  assert.deepEqual(filter, { _id: 'staff', role: 'STAFF' });
  assert.deepEqual(update, { $set: { active: false }, $inc: { authVersion: 1 } });
  assert.deepEqual(deleted, { staffId: 'staff' });
  assert.deepEqual(revoked, ['one', 'two']);
});

test('staff management requires GM authority even when a staff member knows the endpoint', () => {
  let status, passed = false;
  const res = { status(code) { status = code; return this; }, json() {} };
  auth.requireGM({ staffSession: { staff: { role: 'STAFF' } } }, res, () => { passed = true; });
  assert.equal(status, 403); assert.equal(passed, false);
  auth.requireGM({ staffSession: { staff: { role: 'GM' } } }, res, () => { passed = true; });
  assert.equal(passed, true);
});
