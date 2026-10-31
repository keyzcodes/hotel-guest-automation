const { test } = require('node:test');
const assert = require('node:assert/strict');
const { developmentEnvironment } = require('../scripts/le-harve-dev.cjs');
const policy = require('../src/services/guestMessagingPolicy');
test('development launch uses restricted credentials and disables messaging without mutating settings', () => {
  const normal = { MONGO_URI: 'mongodb+srv://demo:demo-secret@cluster0.example.mongodb.net/demo', APP_PUBLIC_URL: 'https://demo.example', STAFF_EMAIL: 'test@example.test' };
  const inherited = { NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://other.example', GUEST_MESSAGING_ENABLED: 'true' };
  const env = developmentEnvironment(normal, { FINANCE_TEST_PASSWORD: 'synthetic-development-only' }, inherited);
  const uri = new URL(env.MONGO_URI);
  assert.equal(uri.pathname, '/le_harve_dev'); assert.equal(uri.username, 'le_harve_dev_app');
  assert.equal(uri.password, 'synthetic-development-only');
  assert.equal(env.GUEST_MESSAGING_ENABLED, 'false'); assert.equal(env.STAFF_ACCOUNTS_ENABLED, 'true');
  assert.equal(env.SALES_EXPENSES_ENABLED, 'true'); assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.APP_PUBLIC_URL, undefined); assert.equal(env.RENDER_EXTERNAL_URL, undefined);
  assert.equal(normal.APP_PUBLIC_URL, 'https://demo.example'); assert.equal(inherited.GUEST_MESSAGING_ENABLED, 'true');
});
test('messaging-disabled API refuses sends but permits read acknowledgements and normal default operation', () => {
  const old = process.env.GUEST_MESSAGING_ENABLED;
  try {
    process.env.GUEST_MESSAGING_ENABLED = 'false';
    for (const req of [{ method: 'POST', path: '/conversations/stay/reply' }, { method: 'PATCH', path: '/tasks/task', body: { status: 'Resolved' } }]) {
      let status, passed = false;
      policy.rejectDisabledSends(req, { status(code) { status = code; return this; }, json() {} }, () => { passed = true; });
      assert.equal(status, 409); assert.equal(passed, false);
    }
    let passed = false;
    policy.rejectDisabledSends({ method: 'POST', path: '/conversations/stay/read' }, {}, () => { passed = true; });
    assert.equal(passed, true);
    delete process.env.GUEST_MESSAGING_ENABLED; passed = false;
    policy.rejectDisabledSends({ method: 'POST', path: '/conversations/stay/reply' }, {}, () => { passed = true; });
    assert.equal(passed, true);
  } finally { if (old === undefined) delete process.env.GUEST_MESSAGING_ENABLED; else process.env.GUEST_MESSAGING_ENABLED = old; }
});
