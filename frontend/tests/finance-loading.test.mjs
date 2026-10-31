import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/app/finance/loadFinanceView.ts', import.meta.url), 'utf8');
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: compiled.exports });
const { loadFinanceView } = compiled.exports;
for (const [name, compact, mode, expected] of [['overview', true, 'summary', ['summary']], ['summary', false, 'summary', ['config', 'summary']], ['entries', false, 'entries', ['config', 'summary', 'entries']]]) {
 test(`${name} fetches only required finance data`, async () => {
  const calls = []; const signal = new AbortController().signal;
  const result = await loadFinanceView(async (path, options) => {
   assert.equal(options.signal, signal);
   const kind = path.split('/')[3].split('?')[0]; calls.push(kind);
   return kind === 'config' ? { departments: [] } : kind === 'summary' ? { data: { totals: { salesKobo: 1200000, expensesKobo: 300000 } } } : { data: [{ id: 'saved' }], nextCursor: 'next' };
  }, 'from=2026-10-01', compact, mode, signal);
  assert.deepEqual(calls, expected);
  assert.equal(result.summary.totals.salesKobo, 1200000);
  assert.equal(result.entries.length, mode === 'entries' ? 1 : 0);
 });
}
test('failed summary propagates rather than returning zero totals', async () => {
 const failure = new Error('offline');
 await assert.rejects(loadFinanceView(async () => { throw failure; }, '', true, 'summary', new AbortController().signal), error => error === failure);
});
