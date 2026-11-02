'use client';
import { useEffect, useRef, useState } from 'react';
import { type DailyGroup, type Entry, type FinanceConfig, type Summary, request, money, message } from './client';
import WorkspaceDialog from '../WorkspaceDialog';
import styles from '../operations.module.css';
export default function DailyGroupDetails({ group, config, onClose, onEntry }: {
  group: DailyGroup; config: FinanceConfig; onClose: () => void; onEntry: (id: string) => void;
}) {
  const [data, setData] = useState<{ summary: Summary; entries: Entry[]; cursor: string | null } | null>(null);
  const [error, setError] = useState(''), [moreBusy, setMoreBusy] = useState(false);
  const alive = useRef(false);
  const query = new URLSearchParams({ from: group.businessDate, to: group.businessDate, departmentId: group.departmentId }).toString();
  const dept = config.departments.find(row => row.id === group.departmentId);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    Promise.all([
      request<{ data: Summary }>(`/api/finance/summary?${query}`, { signal: controller.signal }),
      request<{ data: Entry[]; nextCursor: string | null }>(`/api/finance/entries?${query}&includeVoided=true`, { signal: controller.signal }),
    ]).then(([summary, entries]) => { if (!controller.signal.aborted) setData({ summary: summary.data, entries: entries.data, cursor: entries.nextCursor }); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => { alive.current = false; controller.abort(); };
  }, [query]);
  async function more() {
    if (!data?.cursor || moreBusy) return;
    setMoreBusy(true);
    try {
      const next = await request<{ data: Entry[]; nextCursor: string | null }>(`/api/finance/entries?${query}&includeVoided=true&after=${data.cursor}`);
      if (alive.current) setData(current => current ? { ...current, entries: [...current.entries, ...next.data.filter(row => !current.entries.some(saved => saved.id === row.id))], cursor: next.nextCursor } : current);
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { if (alive.current) setMoreBusy(false); }
  }
  const row = data?.summary.departments[0];
  return <WorkspaceDialog label="Department daily entries" onClose={onClose}><section className={styles.drawer}>
    <div className={styles.heading}><h2>{dept?.name}</h2><button type="button" aria-label="Close daily entries" onClick={onClose}>✕</button></div>
    <p>{group.businessDate}</p>
    {error && <p role="alert">{error}</p>}
    {!data ? <p role="status">{error ? 'Records could not be loaded. Close and reopen to retry.' : 'Loading records…'}</p> : <>
      <div className={styles.dailyPair}><div><small>Sales</small><strong>{!dept?.sales ? '—' : row?.salesStatus === 'NOT_ENTERED' ? 'Not entered' : money(row?.salesKobo)}</strong></div><div><small>Expenses</small><strong>{money(row?.expensesKobo)}</strong></div></div>
      <h3>Saved entries</h3>
      <div className={styles.entries}>{data.entries.map(entry => <button type="button" key={entry.id} className={styles.entryRow} onClick={() => onEntry(entry.id)}><span>{entry.type === 'SALE' ? 'Daily sales' : config.categories[entry.categoryId || ''] || 'Expense'}{entry.state === 'VOID' && <small>Voided · not counted</small>}</span><strong>{money(entry.amountKobo)} ›</strong></button>)}</div>
      {!data.entries.length && <p>No entries recorded.</p>}
      {data.cursor && <button disabled={moreBusy} onClick={() => void more()}>{moreBusy ? 'Loading…' : 'Load more entries'}</button>}
    </>}
  </section></WorkspaceDialog>;
}
