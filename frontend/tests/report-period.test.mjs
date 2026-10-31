import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/app/finance/reportPeriod.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: compiled.exports });
const { periodDates, matchingPeriod } = compiled.exports;
const range = (period, date) => JSON.parse(JSON.stringify(periodDates(period, date)));
test('last month covers complete month including year rollover and leap February', () => {
 assert.deepEqual(range('last-month', '2026-10-31'), { from: '2026-09-01', to: '2026-09-30' });
 assert.deepEqual(range('last-month', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
 assert.deepEqual(range('last-month', '2024-03-01'), { from: '2024-02-01', to: '2024-02-29' });
 assert.deepEqual(range('last-month', '2026-03-01'), { from: '2026-02-01', to: '2026-02-28' });
});
test('current periods stop at supplied Lagos date and weeks start Monday', () => {
 assert.deepEqual(range('today', '2026-10-31'), { from: '2026-10-31', to: '2026-10-31' });
 assert.deepEqual(range('this-week', '2026-11-01'), { from: '2026-10-26', to: '2026-11-01' });
 assert.deepEqual(range('this-week', '2026-11-02'), { from: '2026-11-02', to: '2026-11-02' });
 assert.deepEqual(range('this-month', '2026-10-31'), { from: '2026-10-01', to: '2026-10-31' });
 assert.deepEqual(range('this-year', '2024-12-31'), { from: '2024-01-01', to: '2024-12-31' });
});
test('custom retains dates and saved ranges restore matching label without moving dates', () => {
 assert.equal(periodDates('custom', '2026-10-31'), null);
 assert.equal(matchingPeriod('2026-09-01', '2026-09-30', '2026-10-31'), 'last-month');
 assert.equal(matchingPeriod('2026-10-03', '2026-10-20', '2026-10-31'), 'custom');
 assert.equal(matchingPeriod('2026-10-01', '2026-10-31', '2026-11-01'), 'last-month');
});
