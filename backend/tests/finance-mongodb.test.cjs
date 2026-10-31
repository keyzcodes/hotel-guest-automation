const { test } = require('node:test');
const { runVerification } = require('../scripts/verify-finance.cjs');

// Explicit opt-in only. The runner fixes the database to le_harve_dev, uses the
// restricted development user, and removes only its own temporary collection.
// Never reads MONGO_URI or .env; never drops a database.
test('real MongoDB indexes, concurrent corrections, decimal totals and void exclusion', {
  skip: !process.env.FINANCE_TEST_URI,
}, async () => {
  await runVerification(process.env.FINANCE_TEST_URI);
});
