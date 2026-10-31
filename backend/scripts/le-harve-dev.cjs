// Explicit local setup/start. Never edits .env, Render, or the hosted bot.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const { connectionFromSettings } = require('./verify-finance-file.cjs');
function developmentEnvironment(normal, settings, inherited = process.env) {
  const uri = connectionFromSettings(settings, normal);
  const env = { ...inherited, ...normal, MONGO_URI: uri, NODE_ENV: 'development',
    STAFF_ACCOUNTS_ENABLED: 'true', SALES_EXPENSES_ENABLED: 'true',
    GUEST_MESSAGING_ENABLED: 'false', HOTEL_NAME: 'Le Harve Hotels', PORT: '5000',
    FRONTEND_ORIGINS: 'http://localhost:3001,http://127.0.0.1:3001',
    SERVE_FRONTEND: 'false', TRUST_PROXY: '0' };
  delete env.APP_PUBLIC_URL; delete env.RENDER_EXTERNAL_URL;
  return env;
}
async function main() {
  const root = path.join(__dirname, '..');
  const settings = dotenv.parse(fs.readFileSync(path.join(root, '.env.finance-test')));
  const normal = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  const mode = process.argv[2];
  if (!['setup', 'start'].includes(mode)) throw Error('Use node scripts/le-harve-dev.cjs setup or start.');
  const env = developmentEnvironment(normal, settings), uri = env.MONGO_URI;
  if (mode === 'setup') {
    const mongoose = require('mongoose');
    const auth = require('../src/services/staffAuthService');
    // Copy the configured hash, never the original password, into the dev DB.
    const oldEmail = process.env.STAFF_EMAIL, oldHash = process.env.STAFF_PASSWORD_HASH;
    process.env.STAFF_EMAIL = normal.STAFF_EMAIL; process.env.STAFF_PASSWORD_HASH = normal.STAFF_PASSWORD_HASH;
    const configured = auth.account();
    if (oldEmail === undefined) delete process.env.STAFF_EMAIL; else process.env.STAFF_EMAIL = oldEmail;
    if (oldHash === undefined) delete process.env.STAFF_PASSWORD_HASH; else process.env.STAFF_PASSWORD_HASH = oldHash;
    if (!configured) throw Error('Configure staff credentials in the existing local .env first.');
    require('node:dns').setServers(['8.8.8.8', '8.8.4.4']);
    try {
      await mongoose.connect(uri, { dbName: 'le_harve_dev', serverSelectionTimeoutMS: 15000 });
      const Accounts = require('../src/models/StaffAccount'); await Accounts.init();
      if (!await Accounts.exists({ role: 'GM' })) {
        await Accounts.create({ email: configured.email, name: 'Hotel GM', role: 'GM', active: true, passwordHash: configured.passwordHash });
        console.log('Development GM created. Sign in using your existing staff email and password.');
      } else console.log('Development GM already exists. No credentials changed.');
    } finally { await mongoose.disconnect(); }
  } else {
    console.log('Starting LOCAL Le Harve: le_harve_dev; guest messaging OFF.');
    const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env, stdio: 'inherit' });
    child.on('error', () => { console.error('Could not start the development backend.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
  }
}
if (require.main === module) main().catch(error => { console.error('Development setup stopped:', error.name); process.exitCode = 1; });
module.exports = { developmentEnvironment };
