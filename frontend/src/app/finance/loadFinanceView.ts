import type { Entry, FinanceConfig, Summary } from './client';
type Fetcher = <T>(path: string, options: { signal: AbortSignal }) => Promise<T>;
export async function loadFinanceView(fetcher: Fetcher, query: string, compact: boolean, mode: 'summary' | 'entries', signal: AbortSignal) {
  const [settings, summary, entries] = await Promise.all([
    compact ? Promise.resolve(null) : fetcher<FinanceConfig>('/api/finance/config', { signal }),
    fetcher<{ data: Summary }>(`/api/finance/summary?${query}`, { signal }),
    !compact && mode === 'entries'
      ? fetcher<{ data: Entry[]; nextCursor: string | null }>(`/api/finance/entries?${query}&includeVoided=true`, { signal })
      : Promise.resolve({ data: [] as Entry[], nextCursor: null }),
  ]);
  return { settings, summary: summary.data, entries: entries.data, cursor: entries.nextCursor };
}
