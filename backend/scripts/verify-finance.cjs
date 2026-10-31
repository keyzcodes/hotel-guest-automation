// Real database verification, independent of the running app and Telegram.
// Connection details are prompted privately, never read from .env or printed.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const mongoose = require('mongoose');
const dns = require('node:dns');
const { createService, summaryPipeline, buildSummary } = require('../src/modules/sales-expenses/service');
const validate = require('../src/modules/sales-expenses/validation');
const DATABASE = 'le_harve_dev';

function validateConnection(value) {
  if (typeof value !== 'string') throw Error('Paste a connection string.');
  const uri = value.trim();
  let parsed;
  try { parsed = new URL(uri); } catch { throw Error('Invalid connection string.'); }
  if (parsed.protocol !== 'mongodb+srv:' || !parsed.hostname || parsed.hash)
    throw Error('Use the Atlas mongodb+srv connection string.');
  let username, password;
  try { username = decodeURIComponent(parsed.username); password = decodeURIComponent(parsed.password); }
  catch { throw Error('The connection credentials are not correctly URL-encoded.'); }
  if (username !== 'le_harve_dev_app') throw Error('Use the separate le_harve_dev_app database user, not your demo account.');
  if (!password || /[<>]/.test(password) || /[<>]/.test(uri)) throw Error('Replace the password placeholder with the development user password.');
  if (!['', '/', `/${DATABASE}`].includes(parsed.pathname))
    throw Error('Use /le_harve_dev or an empty database path, not another database.');
  return uri;
}

async function runVerification(value, log = console.log) {
  const uri = validateConnection(value);
  const collectionName = `verification_finance_${randomBytes(12).toString('hex')}`;
  let connection, Entries, ownsCollection = false;
  try {
    log('Connecting with the development account. Database: le_harve_dev.');
    // Match the existing local server's workaround for ISP SRV lookup failures.
    // This affects only this Node process, not the computer's DNS settings.
    dns.setServers(['8.8.8.8', '8.8.4.4']);
    connection = await mongoose.createConnection(uri, {
      dbName: DATABASE, autoCreate: false, autoIndex: false,
      maxPoolSize: 3, serverSelectionTimeoutMS: 15000, socketTimeoutMS: 15000,
    }).asPromise();
    assert.equal(connection.name, DATABASE);
    const schema = require('../src/modules/sales-expenses/model').schema.clone();
    Entries = connection.model('FinancialVerification', schema, collectionName);
    // Automatic model creation is off. We own only the collection explicitly
    // created here, and cleanup never drops a database or normal app collection.
    await Entries.createCollection(); ownsCollection = true;
    await Entries.createIndexes();
    log('PASS: connected and created financial uniqueness indexes.');
    const service = createService(Entries);
    const actor = { id: new mongoose.Types.ObjectId().toString(), name: 'Verification staff', role: 'STAFF' };
    const day = validate.lagosDate();
    const input = changes => validate.createInput({ requestId: randomUUID(), type: 'SALE',
      departmentId: 'kitchen', businessDate: day, amount: '10000.29', ...changes }, day);
    const first = input();
    const saved = await service.create(first, actor);
    const readBack = await Entries.findById(saved.entry.id).lean();
    assert.equal(readBack.amountKobo, 1000029);
    assert.equal(String(readBack.createdBy), actor.id);
    log('PASS: saved and read back the exact amount and staff identity.');
    assert.equal((await service.create(first, actor)).replayed, true);
    assert.equal(await Entries.countDocuments(), 1);
    await assert.rejects(service.create(input(), actor), { code: 'DAILY_SALE_EXISTS' });
    log('PASS: repeated submissions and duplicate daily sales do not create extra records.');
    const correct = amount => validate.correctInput({ mutationId: randomUUID(), expectedVersion: 1,
      type: 'SALE', departmentId: 'kitchen', businessDate: day, amount }, day);
    const race = await Promise.allSettled([
      service.correct(saved.entry.id, correct('12000.29'), actor),
      service.correct(saved.entry.id, correct('15000.29'), actor),
    ]);
    assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(race.find(item => item.status === 'rejected')?.reason.code, 'VERSION_CONFLICT');
    const winner = await Entries.findById(saved.entry.id).lean();
    assert.equal(winner.version, 2); assert.equal(winner.history.length, 2);
    assert.equal(winner.history[1].before.amountKobo, 1000029);
    assert.equal(winner.history[1].after.amountKobo, winner.amountKobo);
    log('PASS: concurrent corrections preserve one winner and a complete audit event.');
    await service.create(input({ type: 'EXPENSE', categoryId: 'ingredients', amount: '2000.10' }), actor);
    await service.create(input({ type: 'EXPENSE', categoryId: 'ingredients', amount: '500.20' }), actor);
    const period = validate.range({ from: day, to: day, departmentId: 'kitchen' }, day);
    const summary = async () => buildSummary(period, await Entries.aggregate(summaryPipeline(period)).option({ maxTimeMS: 10000 }));
    const report = await summary();
    assert.deepEqual(report.totals, { salesKobo: winner.amountKobo, expensesKobo: 250030 });
    assert.equal(report.departments[0].salesStatus, 'COMPLETE');
    log('PASS: MongoDB calculated exact sales and expense totals across multiple entries.');
    await service.void(saved.entry.id, validate.voidInput({ mutationId: randomUUID(), expectedVersion: 2, reason: 'Verification cleanup scenario' }), actor);
    const voided = await summary();
    assert.equal(voided.totals.salesKobo, 0);
    assert.equal(voided.departments[0].salesStatus, 'NOT_ENTERED');
    await service.create(input({ amount: '0' }), actor);
    const zero = await summary();
    assert.equal(zero.totals.salesKobo, 0);
    assert.equal(zero.departments[0].salesStatus, 'COMPLETE');
    log('PASS: voids are excluded; missing sales differ from a confirmed zero total.');
  } finally {
    try {
      if (ownsCollection && connection?.name === DATABASE) {
        await Entries.collection.drop();
        log('Cleanup complete: temporary verification collection removed.');
      }
    } catch {
      // This name is safe to disclose and identifies ONLY this script's data.
      log(`Cleanup could not be confirmed. Remove only ${collectionName} from ${DATABASE}.`);
      throw Error('Temporary verification cleanup failed.');
    } finally { if (connection) await connection.close(); }
  }
}

async function promptConnection() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Run this script directly in an interactive terminal.');
  const output = new Writable({ write(chunk, encoding, done) { done(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write('Paste development Atlas connection string (hidden), then press Enter: ');
  try { return await new Promise(resolve => rl.question('', resolve)); }
  finally { rl.close(); process.stdout.write('\n'); }
}
if (require.main === module) {
  promptConnection().then(uri => runVerification(uri)).then(() => {
    console.log('DATABASE VERIFICATION PASSED. Demo records and app settings were not changed.');
  }).catch(error => {
    // Provider errors can contain connection details. Print only a safe category.
    const local = error.name === 'Error' && /^(Use |Replace |Invalid |Paste |The connection|Run this|Temporary verification)/.test(error.message);
    console.error('Verification stopped:', local ? error.message : error.name);
    console.error('Check the development username/password, readWrite privilege on le_harve_dev, network access, and connectivity.');
    process.exitCode = 1;
  });
}
module.exports = { validateConnection, runVerification };
