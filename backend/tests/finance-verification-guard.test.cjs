const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateConnection } = require('../scripts/verify-finance.cjs');
// Synthetic credentials only. No connections are made by these guard tests.
const uri = 'mongodb+srv://le_harve_dev_app:synthetic-password@cluster.example.test/le_harve_dev?retryWrites=true&w=majority';
test('verification permits only the dedicated development identity and database path', () => {
  assert.equal(validateConnection(uri), uri);
  assert.equal(validateConnection(uri.replace('/le_harve_dev?', '/?')), uri.replace('/le_harve_dev?', '/?'));
  for (const invalid of [uri.replace('le_harve_dev_app:', 'demo:'), uri.replace('/le_harve_dev?', '/hotel_production?'),
    uri.replace('synthetic-password', '<password>'), uri.replace('mongodb+srv:', 'https:'), 'not a connection']) {
    assert.throws(() => validateConnection(invalid));
  }
});
