const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/container.yml'), 'utf8');
const selection = workflow.slice(workflow.indexOf('          repository='), workflow.indexOf("          printf 'image="))
  .split('\n').map(line => line.replace(/^          /, '')).join('\n');

function resolve(t, digests) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesora-publish-'));
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  fs.writeFileSync(path.join(dir, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_DIGESTS"\n', {mode:0o755});
  return spawnSync('bash', ['-c', 'set -euo pipefail\nref="ghcr.io/keyzcodes/hotel-guest-automation:commit"\n' + selection + '\nprintf "%s" "$digest"'], {
    encoding:'utf8', env:{...process.env, PATH:dir+path.delimiter+process.env.PATH, FIXTURE_DIGESTS:digests.join('\n')},
  });
}
const options = {skip:process.platform !== 'linux'};
test('published digest selection ignores the local digest even when it is first', options, t => {
  const expected='ghcr.io/keyzcodes/hotel-guest-automation@sha256:'+'2'.repeat(64);
  const r=resolve(t,['sesora-ci@sha256:'+'1'.repeat(64),expected]);
  assert.equal(r.status,0,r.stderr); assert.equal(r.stdout,expected);
});
test('a different GHCR repository cannot be mistaken for the published image', options, t => {
  const r=resolve(t,['ghcr.io/other/image@sha256:'+'1'.repeat(64),'sesora-ci@sha256:'+'2'.repeat(64)]);
  assert.notEqual(r.status,0); assert.match(r.stderr,/No published GHCR digest/);
});
test('missing or malformed published digest fails before deployment output is emitted', options, t => {
  for(const values of [[],['ghcr.io/keyzcodes/hotel-guest-automation@sha256:invalid']]) {
    const r=resolve(t,values); assert.notEqual(r.status,0); assert.equal(r.stdout,'');
  }
});
