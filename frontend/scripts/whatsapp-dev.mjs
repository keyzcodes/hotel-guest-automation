import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { spawn } from 'node:child_process';
const frontend = path.join(import.meta.dirname, '..');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3002'], {
  cwd: frontend, env: { ...process.env, BACKEND_URL: 'http://127.0.0.1:5001' }, stdio: 'inherit'
});
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
