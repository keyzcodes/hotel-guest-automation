import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = { exports: {} };
const source = fs.readFileSync(new URL('../src/app/staffDraft.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: compiled.exports });
const { staffDraft } = compiled.exports;
test('staff draft restores identity fields and excludes passwords and extra privileges', () => {
 const draft = staffDraft(JSON.stringify({ name: 'Reception', email: 'staff@example.com', password: 'never-restore', role: 'GM' }));
 assert.equal(JSON.stringify(draft), JSON.stringify({ name: 'Reception', email: 'staff@example.com' }));
});
test('invalid draft is ignored safely', () => {
 for (const raw of [null, '{', '[]', '{"name":7,"email":"x"}']) assert.equal(staffDraft(raw), null);
});
test('draft lengths are bounded', () => {
 const draft = staffDraft(JSON.stringify({ name: 'a'.repeat(500), email: 'b'.repeat(500) }));
 assert.equal(draft.name.length, 100); assert.equal(draft.email.length, 254);
});
