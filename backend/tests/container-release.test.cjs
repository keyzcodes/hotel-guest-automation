const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const releaseTest = (name, run) => test(name, { skip: process.platform !== 'linux' }, run);
function fixture(t, current = 'example.test/sesora:old') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sesora-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['deploy', '.release', 'bin']) fs.mkdirSync(path.join(root, dir));
  fs.copyFileSync(path.join(__dirname, '../../deploy/release.sh'), path.join(root, 'deploy/release.sh'));
  fs.writeFileSync(path.join(root, 'deploy/container.env'), 'SYNTHETIC=true\n');
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ running: current, trace: [] }));
  if (current) fs.writeFileSync(path.join(root, '.release/current'), current + '\n');
  fs.writeFileSync(path.join(root, 'bin/docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.FAKE_STATE;
const state = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2), image = process.env.SESORA_IMAGE;
state.trace.push({ args, image, runningBefore: state.running });
function finish(code = 0, text = '') { fs.writeFileSync(file, JSON.stringify(state)); process.stdout.write(text); process.exit(code); }
if (args[0] === 'pull') finish(args[1].includes('pull-fails') ? 1 : 0);
if (args[0] === 'image') finish();
if (args[0] === 'inspect') finish(0, state.running?.includes('bad') ? 'unhealthy\\n' : 'healthy\\n');
if (args[0] === 'compose') {
 if (args[1] === 'config') finish(process.env.FAKE_INVALID_CONFIG ? 1 : 0);
 if (args[1] === 'stop') { state.running = null; finish(); }
 if (args[1] === 'up') { if (image.includes('start-fails')) finish(1); state.running = image; finish(); }
 if (args[1] === 'ps') finish(0, state.running ? 'synthetic-container\\n' : '');
 finish();
}
finish(1);
`, { mode: 0o755 });
  return { root, state: () => JSON.parse(fs.readFileSync(path.join(root, 'state.json'))),
    run: (image, extra = {}) => spawnSync('bash', ['deploy/release.sh', image], { cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
        FAKE_STATE: path.join(root, 'state.json'), HEALTH_ATTEMPTS: '1', HEALTH_INTERVAL_SECONDS: '0', ...extra } }),
    current: () => fs.existsSync(path.join(root, '.release/current')) ? fs.readFileSync(path.join(root, '.release/current'), 'utf8').trim() : null };
}
releaseTest('healthy release pulls before stopping and retains the previous known-good version', t => {
  const f = fixture(t), result = f.run('example.test/sesora:new');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.current(), 'example.test/sesora:new');
  assert.equal(fs.readFileSync(path.join(f.root, '.release/previous'), 'utf8').trim(), 'example.test/sesora:old');
  const trace = f.state().trace;
  const pull = trace.findIndex(row => row.args[0] === 'pull');
  const stop = trace.findIndex(row => row.args[1] === 'stop');
  assert.ok(pull < stop); assert.equal(trace[pull].runningBefore, 'example.test/sesora:old');
  assert.deepEqual(trace[stop].args, ['compose', 'stop', '--timeout', '35', 'app']);
  assert.equal(trace.find(row => row.args[1] === 'up').runningBefore, null);
});
for (const image of ['example.test/sesora:bad', 'example.test/sesora:start-fails']) {
  releaseTest('failed release restores and verifies the old image: ' + image, t => {
    const f = fixture(t), result = f.run(image);
    assert.equal(result.status, 1); assert.match(result.stderr, /Previous release restored/);
    assert.equal(f.current(), 'example.test/sesora:old');
    assert.equal(f.state().running, 'example.test/sesora:old');
  });
}
releaseTest('pull/configuration failures leave the running release untouched', t => {
  for (const [image, env] of [['example.test/sesora:pull-fails', {}], ['example.test/sesora:new', { FAKE_INVALID_CONFIG: 'true' }]]) {
    const f = fixture(t), result = f.run(image, env);
    assert.notEqual(result.status, 0);
    assert.equal(f.state().running, 'example.test/sesora:old');
    assert.equal(f.state().trace.some(row => row.args[1] === 'stop'), false);
  }
});
releaseTest('first failed deployment stops the candidate without claiming a rollback exists', t => {
  const f = fixture(t, null), result = f.run('example.test/sesora:bad');
  assert.equal(result.status, 1); assert.match(result.stderr, /no previous managed release/);
  assert.equal(f.current(), null); assert.equal(f.state().running, null);
});
releaseTest('rollback failure is reported distinctly', t => {
  const f = fixture(t, 'example.test/sesora:bad-old'), result = f.run('example.test/sesora:bad-new');
  assert.equal(result.status, 2); assert.match(result.stderr, /Rollback health check failed/);
  assert.equal(f.current(), 'example.test/sesora:bad-old');
});
releaseTest('release lock prevents overlapping application replacements', async t => {
  const f = fixture(t);
  const holder = spawn('flock', [path.join(f.root, '.release/lock'), 'node', '-e', 'process.stdout.write("locked");process.stdin.resume()'], { stdio: ['pipe', 'pipe', 'pipe'] });
  await once(holder.stdout, 'data');
  try {
    const result = f.run('example.test/sesora:new');
    assert.equal(result.status, 1); assert.match(result.stderr, /Another release is running/);
    assert.equal(f.state().trace.length, 0);
  } finally { holder.stdin.end(); await once(holder, 'exit'); }
});
releaseTest('invalid image reference is rejected before Docker commands run', t => {
  const f = fixture(t), result = f.run('image; touch injected');
  assert.equal(result.status, 1); assert.equal(f.state().trace.length, 0);
});
