// Explicit one-time migration into the selected hotel database. No password is
// printed and existing bookings, messages, sessions and financial data are untouched.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const auth = require('../src/services/staffAuthService');
const Accounts = require('../src/models/StaffAccount');

async function main() {
  if (!process.argv.includes('--confirm-development-database'))
    throw new Error('Select the separate development database in MONGO_URI, then pass --confirm-development-database. Do not use the demo database.');
  const configured = auth.account();
  if (!configured || !process.env.MONGO_URI) throw new Error('Configure MONGO_URI, STAFF_EMAIL and STAFF_PASSWORD_HASH first.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured.email)) throw new Error('Configure a valid GM email.');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  await Accounts.init();
  if (await Accounts.exists({ role: 'GM' })) {
    console.log('A GM account already exists. Nothing changed.');
    return;
  }
  await Accounts.create({ email: configured.email, name: 'Hotel GM', role: 'GM',
    active: true, passwordHash: configured.passwordHash });
  console.log('GM account created from the configured credentials. Existing records were not changed.');
}
main().catch(error => { console.error('GM setup failed:', error.name, error.code === 11000 ? 'Account already exists.' : error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
