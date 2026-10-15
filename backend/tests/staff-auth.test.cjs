const { test } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/services/staffAuthService');
test('salted password hashes verify without storing the original password', async () => {
  const password = 'Only-for-this-test-123';
  const hash = await auth.hashPassword(password);
  assert.equal(hash.includes(password), false);
  assert.equal(await auth.verifyPassword(password, hash), true);
  assert.equal(await auth.verifyPassword('incorrect', hash), false);
  assert.notEqual(hash, await auth.hashPassword(password));
});
test('setup rejects short passwords and malformed hashes fail closed', async () => {
  await assert.rejects(auth.hashPassword('short'));
  assert.equal(await auth.verifyPassword('anything', 'malformed'), false);
});
test('session cookie tokens reject duplicates and malformed values', () => {
  const token = 'a'.repeat(64);
  assert.equal(auth.tokenFrom({ cookie: `${auth.COOKIE}=${token}` }), token);
  assert.equal(auth.tokenFrom({ cookie: `${auth.COOKIE}=${token}; ${auth.COOKIE}=${token}` }), null);
  assert.equal(auth.tokenFrom({ cookie: `${auth.COOKIE}=bad` }), null);
});
test('authentication scopes lookup to token digest, configured account and unexpired session', async () => {
  const old = { email: process.env.STAFF_EMAIL, hash: process.env.STAFF_PASSWORD_HASH };
  try {
    process.env.STAFF_EMAIL = 'staff@example.test';
    process.env.STAFF_PASSWORD_HASH = `scrypt$32768$${'a'.repeat(32)}$${'b'.repeat(128)}`;
    let query;
    const store = { findOne(value) { query = value; return { lean: async () => ({ _id: 'saved' }) }; } };
    const token = 'c'.repeat(64);
    await auth.authenticate({ cookie: `${auth.COOKIE}=${token}` }, store);
    assert.equal(query.tokenHash, auth.sha(token)); assert.notEqual(query.tokenHash, token);
    assert.equal(query.accountFingerprint, auth.account().fingerprint);
    assert.ok(query.expiresAt.$gt instanceof Date);
    assert.equal(await auth.authenticate({}, store), null);
    delete process.env.STAFF_PASSWORD_HASH;
    assert.equal(await auth.authenticate({ cookie: `${auth.COOKIE}=${token}` }, store), null);
  } finally {
    if (old.email === undefined) delete process.env.STAFF_EMAIL; else process.env.STAFF_EMAIL=old.email;
    if (old.hash === undefined) delete process.env.STAFF_PASSWORD_HASH; else process.env.STAFF_PASSWORD_HASH=old.hash;
  }
});
test('state-changing requests require an approved origin', () => {
  let passed = false, status;
  const res={ status(code) { status=code;return this; }, json() {} };
  auth.requireOrigin({ method: 'POST', headers: { origin: 'https://untrusted.invalid' } }, res, () => { passed=true; });
  assert.equal(status,403);assert.equal(passed,false);
  auth.requireOrigin({ method: 'POST', headers: { origin: 'http://localhost:3001' } }, res, () => { passed=true; });
  assert.equal(passed,true);
});
test('cookie settings prevent script access and require secure transport in production', () => {
  const old=process.env.NODE_ENV;
  try { process.env.NODE_ENV='production';assert.equal(auth.cookieOptions().httpOnly,true);assert.equal(auth.cookieOptions().secure,true);assert.equal(auth.cookieOptions().sameSite,'lax'); }
  finally { if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old; }
});
