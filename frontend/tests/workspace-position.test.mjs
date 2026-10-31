import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(path.join(import.meta.dirname, '../src/app/workspacePosition.ts'), 'utf8');
const moduleCopy = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleCopy.exports, module: moduleCopy });
const { workspaceSection, parseReportPosition } = moduleCopy.exports;
test('explicit URL wins; missing URL resumes the saved workspace', () => {
  assert.equal(workspaceSection('#reports', 'overview', false), 'reports');
  assert.equal(workspaceSection('', 'reports', false), 'reports');
  assert.equal(workspaceSection('#guests', 'reports', true), 'guests');
  assert.equal(workspaceSection('', null, false), 'overview');
});
test('stored staff-management position does not grant staff access', () => {
  assert.equal(workspaceSection('', 'staff', false), 'overview');
  assert.equal(workspaceSection('#staff', null, true), 'staff');
  assert.equal(workspaceSection('#unknown', 'reports', true), 'overview');
});
test('report position restores subview, dates, department and open entry without financial data', () => {
  const saved = { from: '2026-10-01', to: '2026-10-30', department: 'kitchen', mode: 'entries', detailId: 'a'.repeat(24), amountKobo: 1000000, password: 'not-to-store' };
  const restored = parseReportPosition(JSON.stringify(saved));
  assert.equal(restored.mode, 'entries'); assert.equal(restored.department, 'kitchen');
  assert.equal(restored.from, saved.from); assert.equal(restored.to, saved.to);
  assert.equal(restored.detailId, saved.detailId);
  assert.equal(restored.amountKobo, undefined); assert.equal(restored.password, undefined);
});
test('corrupt browser storage and invalid dates cannot become a saved report position', () => {
  for (const value of [null, '', '{bad', '[]', 'true']) assert.equal(Object.keys(parseReportPosition(value)).length, 0);
  const value = parseReportPosition(JSON.stringify({ from: '2026-02-30', to: {}, mode: 'anything', detailId: 'bad', department: '$where' }));
  assert.equal(Object.keys(value).length, 0);
});
