import { entryProblem, type QueuedBody } from './offlineQueue';
import type { FinanceConfig } from './client';
export type CombinedDraft = {
  businessDate: string; departmentId: string; sales: string; expense: string;
  categoryId: string; note: string; salesId: string; expenseId: string;
};
export function combinedBodies(form: CombinedDraft, config: FinanceConfig, today: string): QueuedBody[] {
  const dept = config.departments.find(row => row.id === form.departmentId);
  if (!dept) throw Error('Choose a department.');
  const common = { businessDate: form.businessDate, departmentId: form.departmentId, note: form.note };
  const bodies: QueuedBody[] = [];
  if (dept.sales && form.sales.trim() !== '') bodies.push({ ...common, type: 'SALE', amount: form.sales.trim(), categoryId: null, requestId: form.salesId });
  if (form.expense.trim() !== '') bodies.push({ ...common, type: 'EXPENSE', amount: form.expense.trim(), categoryId: form.categoryId, requestId: form.expenseId });
  if (!bodies.length) throw Error('Enter sales, an expense, or both.');
  for (const body of bodies) { const problem = entryProblem(body, config, today); if (problem) throw Error(problem); }
  return bodies;
}
