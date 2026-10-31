// Alternative to hidden URI pasting. Read the development password from a
// git-ignored local file; reuse ONLY the cluster hostname from the normal .env.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { runVerification } = require('./verify-finance.cjs');

function connectionFromSettings(settings, appSettings = {}) {
  const password = settings.FINANCE_TEST_PASSWORD;
  if (typeof password !== 'string' || !password || password === 'PASTE_NEW_DEVELOPMENT_PASSWORD_HERE')
    throw Error('Save the new development user password in .env.finance-test first.');
  let hostname = settings.FINANCE_TEST_HOST;
  if (!hostname) {
    let source;
    try { source = new URL(appSettings.MONGO_URI); }
    catch { throw Error('Cannot find the cluster address. Add FINANCE_TEST_HOST to .env.finance-test.'); }
    hostname = source.hostname;
  }
  if (typeof hostname !== 'string' || !/^[a-z0-9.-]+\.mongodb\.net$/i.test(hostname))
    throw Error('FINANCE_TEST_HOST must be the Atlas hostname only, ending in .mongodb.net.');
  // No demo username, password, database name or URI options are copied.
  return `mongodb+srv://le_harve_dev_app:${encodeURIComponent(password)}@${hostname}/le_harve_dev?retryWrites=true&w=majority&authSource=admin`;
}

function failureCategory(error) {
  // Inspect provider text locally; return only fixed, credential-free labels.
  // Atlas code 8000 alone is deliberately NOT treated as authentication failure.
  const seen = new Set();
  for (let current = error, depth = 0; current && depth < 5 && !seen.has(current); depth++) {
    seen.add(current);
    const text = [current.message, current.errorResponse?.errmsg, current.errorResponse?.message]
      .filter(value => typeof value === 'string').join(' ');
    if (current.code === 18 || /bad auth|authentication failed|authentication failure|auth failed/i.test(text)) return 'AUTHENTICATION_FAILED';
    if (current.code === 13 || /not authorized|unauthorized|insufficient privilege|permission denied/i.test(text)) return 'PERMISSION_DENIED';
    if (/ENOTFOUND|EAI_AGAIN|querySrv|DNSHostNotFound/i.test(text)) return 'DNS_LOOKUP_FAILED';
    if (/certificate|TLS handshake|SSL handshake/i.test(text)) return 'TLS_CONNECTION_FAILED';
    if (/IP.*(?:access list|whitelist)|(?:access list|whitelist).*IP/i.test(text)) return 'NETWORK_ACCESS_REJECTED';
    current = current.cause;
  }
  return 'UNCLASSIFIED';
}

async function main() {
  const root = path.join(__dirname, '..');
  const settingsFile = path.join(root, '.env.finance-test');
  if (!fs.existsSync(settingsFile)) throw Error('Create backend/.env.finance-test first.');
  const settings = dotenv.parse(fs.readFileSync(settingsFile));
  const normalFile = path.join(root, '.env');
  const appSettings = fs.existsSync(normalFile) ? dotenv.parse(fs.readFileSync(normalFile)) : {};
  const uri = connectionFromSettings(settings, appSettings);
  console.log('Using le_harve_dev_app on le_harve_dev. Connection details will not be printed.');
  await runVerification(uri);
  console.log('DATABASE VERIFICATION PASSED. Temporary test data removed.');
}
if (require.main === module) main().catch(error => {
  const safe = error.name === 'Error' && /^(Save |Cannot find |FINANCE_TEST_HOST |Create )/.test(error.message);
  console.error('Verification stopped:', safe ? error.message : error.name);
  // Numeric server codes and fixed code names reveal the failure category,
  // without logging a provider message that might contain connection details.
  if (Number.isInteger(error.code)) console.error('MongoDB error code:', error.code);
  if (typeof error.codeName === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.codeName))
    console.error('MongoDB error name:', error.codeName);
  const category = failureCategory(error);
  console.error('Failure category:', category);
  const advice = {
    AUTHENTICATION_FAILED: 'Atlas rejected the credentials. Confirm le_harve_dev_app exists on Cluster0 and use that user\'s current database password in .env.finance-test. Do not use your Atlas website login password.',
    PERMISSION_DENIED: 'Atlas denied an operation. Confirm le_harve_dev_app has readWrite on le_harve_dev with the collection field blank.',
    DNS_LOOKUP_FAILED: 'The cluster hostname could not be resolved. Check the cluster address and local network connection.',
    TLS_CONNECTION_FAILED: 'The secure database connection failed. Check the computer clock and network; keep certificate verification enabled.',
    NETWORK_ACCESS_REJECTED: 'Check whether Atlas Network Access allows this computer\'s current IP.',
    UNCLASSIFIED: 'The available error does not identify one cause. Share only this diagnostic output; keep the settings file private.',
  };
  console.error(advice[category]);
  process.exitCode = 1;
});
module.exports = { connectionFromSettings, failureCategory };
