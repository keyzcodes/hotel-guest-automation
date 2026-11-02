'use client';
import { useEffect, useRef, useState } from 'react';
import { useStaffAccess } from '../StaffAccess';
import WorkspaceDialog from '../WorkspaceDialog';
import styles from '../operations.module.css';
import { type FinanceConfig, message, today } from './client';
import { combinedBodies, type CombinedDraft } from './combinedEntry';
import type { QueuedBody } from './offlineQueue';
import { useOfflineEntries } from './OfflineEntries';

export default function CombinedEntryForm({ config, onClose, onQueued }: {
  config: FinanceConfig; onClose: () => void; onQueued: () => void;
}) {
  const { identity } = useStaffAccess();
  const queue = useOfflineEntries();
  const key = `hotel-finance-combined:${identity?.id}`;
  const legacyKey = `hotel-finance-draft:${identity?.id}:new`;
  const [form, setForm] = useState<CombinedDraft>({ businessDate: today(), departmentId: config.departments[0].id,
    sales: '', expense: '', categoryId: '', note: '', salesId: '', expenseId: '' });
  const [plan, setPlan] = useState<QueuedBody[] | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const flight = useRef(false);
  const initialConfig = useRef(config);
  useEffect(() => {
    const timer = setTimeout(() => {
      const config = initialConfig.current;
      const initial = { businessDate: today(), departmentId: config.departments[0].id,
        sales: '', expense: '', categoryId: '', note: '', salesId: crypto.randomUUID(), expenseId: crypto.randomUUID() };
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (saved?.form && Object.keys(initial).every(field => typeof saved.form[field] === 'string')) {
          setForm(saved.form);
          // Reconstruct the immutable plan from persisted fields; never trust extra browser payload fields.
          if (saved.prepared === true) setPlan(combinedBodies(saved.form, config, today()));
        } else {
          // Preserve pre-update single-entry drafts and their idempotency IDs.
          const old = JSON.parse(sessionStorage.getItem(legacyKey) || 'null');
          if (old && typeof old.requestId === 'string' && ['SALE', 'EXPENSE'].includes(old.type)) {
            for (const field of ['businessDate', 'departmentId', 'categoryId', 'note'] as const)
              if (typeof old[field] === 'string') initial[field] = old[field];
            if (typeof old.amount === 'string') {
              if (old.type === 'SALE') { initial.sales = old.amount; initial.salesId = old.requestId; }
              else { initial.expense = old.amount; initial.expenseId = old.requestId; }
            }
            if (old.uncertain) setPlan(combinedBodies(initial, config, today()));
          }
          setForm(initial);
        }
      } catch { setForm(initial); setError('The saved draft could not be restored. Check pending entries before submitting again.'); return; }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [key, legacyKey]);
  const results = plan?.map(body => queue.items.find(item => item.id === body.requestId));
  const allQueued = !!results?.length && results.every(Boolean);
  useEffect(() => {
    if (!ready) return;
    if (allQueued) {
      try { sessionStorage.removeItem(key); sessionStorage.removeItem(legacyKey); } catch { /* Durable queue already owns these entries. */ }
      return;
    }
    try { sessionStorage.setItem(key, JSON.stringify({ form, prepared: !!plan })); }
    catch { /* The submit path checks draft storage before preparing a batch. */ }
  }, [key, legacyKey, ready, form, plan, allQueued]);
  const dept = config.departments.find(row => row.id === form.departmentId);
  const locked = busy || !!plan;
  function change(patch: Partial<CombinedDraft>) { if (!locked) setForm(current => ({ ...current, ...patch })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || flight.current || allQueued) return;
    flight.current = true; setBusy(true); setError('');
    try {
      const bodies = plan || combinedBodies(form, config, today());
      // Stable IDs are persisted BEFORE the queue can receive either record.
      sessionStorage.setItem(key, JSON.stringify({ form, prepared: true }));
      setPlan(bodies);
      await queue.saveBatch(bodies);
      sessionStorage.removeItem(legacyKey);
      sessionStorage.removeItem(key);
      onQueued();
    } catch (e) { setError(message(e)); }
    finally { flight.current = false; setBusy(false); }
  }
  return <WorkspaceDialog label="Add entry" busy={busy} onClose={onClose}><section className={`${styles.drawer} ${styles.combinedDrawer}`}>
    <div className={styles.heading}><h2>Add entry</h2><button type="button" aria-label="Close entry" disabled={busy} onClick={onClose}>✕</button></div>
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.combinedGrid}>
        <label>Date<input type="date" min="2000-01-01" max={today()} required value={form.businessDate} disabled={locked} onChange={e => change({ businessDate: e.target.value })} /></label>
        <label>Department<select required value={form.departmentId} disabled={locked} onChange={e => change({ departmentId: e.target.value, categoryId: '' })}>{config.departments.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {dept?.sales && <label>Daily sales (₦)<input inputMode="decimal" placeholder="Optional" pattern="(0|[1-9][0-9]*)(\.[0-9]{1,2})?" value={form.sales} disabled={locked} onChange={e => change({ sales: e.target.value })} /><small>Leave blank to skip · Enter 0 for no sales.</small></label>}
        <div className={styles.form}><label>Expense (₦)<input inputMode="decimal" placeholder="Optional" pattern="(0|[1-9][0-9]*)(\.[0-9]{1,2})?" value={form.expense} disabled={locked} onChange={e => change({ expense: e.target.value })} /></label>
          {form.expense.trim() !== '' && <label>Expense category<select required disabled={locked} value={form.categoryId} onChange={e => change({ categoryId: e.target.value })}><option value="">Choose category</option>{dept?.categories.map(id => <option key={id} value={id}>{config.categories[id]}</option>)}</select></label>}
        </div>
      </div>
      <label>Note (optional)<textarea value={form.note} maxLength={500} disabled={locked} onChange={e => change({ note: e.target.value })} /></label>
      {error && <p role="alert" className={styles.alert}>{error}</p>}
      {plan && <div role="status">{plan.map((body, index) => {
        const result = results?.[index];
        return <p key={body.requestId}>{body.type === 'SALE' ? 'Sales' : 'Expense'} · {result?.status === 'saved' ? 'Saved' : result?.status === 'review' ? `Needs review. ${result.message}` : result ? 'Saved on this device · Waiting to sync' : 'Not queued yet · Retry save'}</p>;
      })}</div>}
      <button type="submit" className={styles.primary} disabled={!ready || busy || allQueued}>{busy ? 'Saving…' : allQueued ? results?.every(item => item?.status === 'saved') ? 'Saved' : 'Submitted' : plan ? 'Retry save' : 'Save entries'}</button>
    </form>
  </section></WorkspaceDialog>;
}
