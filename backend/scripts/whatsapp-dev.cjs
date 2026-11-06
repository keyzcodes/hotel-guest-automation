// Isolated WhatsApp integration launcher. Does not modify existing environment files.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const backend = path.join(__dirname, '..');
const normalPath = path.join(backend, '.env');
const normal = fs.existsSync(normalPath) ? dotenv.parse(fs.readFileSync(normalPath)) : {};
try {
  const local = dotenv.parse(fs.readFileSync(path.join(backend, '.env.whatsapp')));
  if (!/^mongodb(?:\+srv)?:\/\/[^/]+\/sesora_whatsapp_lab(?:\?|$)/.test(local.MONGO_URI || ''))
    throw Error('Set MONGO_URI to the sesora_whatsapp_lab database.');
  const env = { ...process.env, ...normal, ...local,
    NODE_ENV: 'development', PORT: '5001', SERVE_FRONTEND: 'false',
    GUEST_CHANNEL: 'WHATSAPP', GUEST_MESSAGING_ENABLED: 'true',
    STAFF_ACCOUNTS_ENABLED: 'false', SALES_EXPENSES_ENABLED: 'false',
    FRONTEND_ORIGINS: 'http://localhost:3002,http://127.0.0.1:3002', TRUST_PROXY: '0',
    WHATSAPP_SESSION_MONGO_URI: local.MONGO_URI };
  delete env.APP_PUBLIC_URL; delete env.RENDER_EXTERNAL_URL;
  const child = spawn(process.execPath, [path.join(backend, 'server.js')], { cwd: backend, env, stdio: 'inherit' });
  child.on('error', () => { console.error('Could not start WhatsApp integration.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch (error) { console.error(error.message); process.exitCode = 1; }
