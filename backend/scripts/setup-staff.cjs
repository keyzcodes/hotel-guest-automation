// Interactive, local account setup. Never pass passwords as command-line arguments.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { hashPassword } = require('../src/services/staffAuthService');
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Run this script directly in an interactive terminal.');
  let hidden = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stdout.write(chunk, encoding); done(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const ask = (prompt, secret = false) => new Promise(resolve => {
    hidden = secret;
    if (secret) process.stdout.write(prompt);
    rl.question(secret ? '' : prompt, value => { hidden = false; if (secret) process.stdout.write('\n'); resolve(value); });
  });
  try {
    const email = (await ask('Hotel staff email: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Error('Enter a valid email address.');
    const password = await ask('Password (12–128 characters; hidden): ', true);
    const confirm = await ask('Confirm password (hidden): ', true);
    if (password !== confirm) throw Error('Passwords did not match. Nothing was saved.');
    const encoded = await hashPassword(password);
    const envPath = path.join(__dirname, '..', '.env');
    let contents = fs.readFileSync(envPath, 'utf8');
    for (const [key,value] of [['STAFF_EMAIL',email],['STAFF_PASSWORD_HASH',encoded]]) {
      const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'gm');
      const line = `${key}="${value}"`;
      contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.replace(/\s*$/, '')}\n${line}\n`;
    }
    const temporary = `${envPath}.staff-setup.tmp`;
    fs.writeFileSync(temporary, contents, { mode: 0o600 });
    fs.renameSync(temporary, envPath);
    console.log('Staff account configured. Only a password hash was saved. Restart the backend.');
  } finally { rl.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
