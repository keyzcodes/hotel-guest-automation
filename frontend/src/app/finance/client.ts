import { apiFetch } from '../apiClient';
export type Department = { id: string; name: string; sales: boolean; categories: string[] };
export type FinanceConfig = { departments: Department[]; categories: Record<string, string>; currency: string; timezone: string };
export type Entry = { id: string; type: 'SALE' | 'EXPENSE'; businessDate: string; departmentId: string; categoryId: string | null; amountKobo: number; note: string; state: 'POSTED' | 'VOID'; version: number; createdBy: string; history?: { action: string; actorName: string; at: string; reason: string; before: { amountKobo: number } | null; after: { amountKobo: number } }[] };
export type Summary = { period: { from: string; to: string }; generatedAt: string; coverageThrough: string | null; incompleteSales: boolean; totals: { salesKobo: number; expensesKobo: number }; departments: { departmentId: string; name: string; supportsSales: boolean; salesKobo: number | null; expensesKobo: number; expenseCount: number; salesDaysEntered: number | null; salesStatus: string; missingSalesDates: string[]; expenseStatus: string }[] };
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, { ...init, cache: 'no-store', signal: init.signal || AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', ...init.headers } });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new ApiError(data.message || 'The operation could not be completed.', response.status, data.code);
  return data as T;
}
export function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const money = (kobo: number | null | undefined) => kobo == null ? '—' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kobo / 100);
export const message = (error: unknown) => error instanceof Error ? error.message : 'Connection unavailable. Please retry.';
