'use client';
import { useEffect, useRef, useState } from 'react';
import { useStaffAccess } from '../StaffAccess';
import { ApiError, Entry, FinanceConfig, message, request, today } from './client';
import styles from '../operations.module.css';
import WorkspaceDialog from '../WorkspaceDialog';

type Draft = { requestId: string; type: 'SALE' | 'EXPENSE'; businessDate: string; departmentId: string; categoryId: string; amount: string; note: string; uncertain: boolean; expectedVersion?: number };
export default function EntryForm({ config, entry, onClose, onSaved }: { config: FinanceConfig; entry?: Entry; onClose: () => void; onSaved: () => void }) {
  const { identity } = useStaffAccess();
  const key = `hotel-finance-draft:${identity?.id}:${entry?.id || 'new'}`;
  const [form, setForm] = useState<Draft>({ requestId: '', type: entry?.type || 'SALE', businessDate: entry?.businessDate || today(), departmentId: entry?.departmentId || config.departments[0].id, categoryId: entry?.categoryId || '', amount: entry ? (entry.amountKobo / 100).toFixed(2) : '', note: entry?.note || '', uncertain: false, expectedVersion: entry?.version });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const flight = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      let draft: Partial<Draft> = {};
      {
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
          if (saved && typeof saved === 'object' && typeof saved.requestId === 'string') {
            draft = Object.fromEntries(['requestId', 'businessDate', 'departmentId', 'categoryId', 'amount', 'note'].filter(field => typeof saved[field] === 'string').map(field => [field, saved[field]]));
            draft.type = saved.type === 'EXPENSE' ? 'EXPENSE' : 'SALE'; draft.uncertain = saved.uncertain === true;
            if (entry && Number.isSafeInteger(saved.expectedVersion)) draft.expectedVersion = saved.expectedVersion;
          }
        } catch { setStorageError(true); }
      }
      setForm(current => ({ ...current, requestId: crypto.randomUUID(), ...draft })); setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [entry, key]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(key, JSON.stringify(form)); } catch { /* Visible warning is set during save too. */ }
  }, [form, ready, entry, key]);
  const dept = config.departments.find(item => item.id === form.departmentId);
  const locked = busy || form.uncertain;
  function change(patch: Partial<Draft>) { if (!locked) setForm(current => ({ ...current, ...patch })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!ready || flight.current) return;
    flight.current = true; setBusy(true); setError(''); setConflict(false);
    // Persist the exact retry ID and freeze the payload BEFORE making the request.
    // A lost response may follow a successful database write.
    const pending = { ...form, uncertain: true }; setForm(pending);
    try { sessionStorage.setItem(key, JSON.stringify(pending)); } catch { setStorageError(true); }
    const body = { type: form.type, businessDate: form.businessDate, departmentId: form.departmentId, categoryId: form.type === 'EXPENSE' ? form.categoryId : null, amount: form.amount, note: form.note,
      ...(entry ? { expectedVersion: form.expectedVersion, mutationId: form.requestId } : { requestId: form.requestId }) };
    try {
      await request(`/api/finance/entries${entry ? `/${entry.id}` : ''}`, { method: entry ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      try { sessionStorage.removeItem(key); } catch { /* The next draft receives a new ID. */ }
      onSaved();
    } catch (e) {
      const uncertain = !(e instanceof ApiError) || e.status >= 500;
      setConflict(e instanceof ApiError && e.code === 'VERSION_CONFLICT');
      setForm(current => ({ ...current, uncertain }));
      setError(message(e) + (uncertain ? ' Keep this form open and retry the same save; do not enter it again.' : ''));
    } finally { flight.current = false; setBusy(false); }
  }
  async function loadSaved() {
    if (!entry || flight.current || !window.confirm('Replace this local draft with the latest saved entry? Review it before making a new correction.')) return;
    flight.current = true; setBusy(true);
    try {
      const { data } = await request<{ data: Entry }>(`/api/finance/entries/${entry.id}`);
      if (data.state !== 'POSTED') throw Error('The saved entry has been voided. Close this form to review its history.');
      setForm({ requestId: crypto.randomUUID(), type: data.type, businessDate: data.businessDate,
        departmentId: data.departmentId, categoryId: data.categoryId || '', amount: (data.amountKobo / 100).toFixed(2),
        note: data.note, expectedVersion: data.version, uncertain: false });
      setConflict(false); setError('');
    } catch (e) { setError(message(e)); }
    finally { flight.current = false; setBusy(false); }
  }
  return <WorkspaceDialog label={entry ? 'Correct entry' : 'Add entry'} busy={busy} onClose={onClose}><section className={styles.drawer}>
    <div className={styles.heading}><h2 id="entry-title">{entry ? 'Correct entry' : 'Add entry'}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Close entry">✕</button></div>
    <p className={styles.muted}>{entry ? `Draft based on version ${form.expectedVersion}. Changes retain the previous values.` : 'Draft autosave uses this browser tab. Save entry adds the record to reports.'}</p>
    {storageError && <p role="status">Browser draft storage is unavailable. Keep this form open until saving is confirmed.</p>}
    <form onSubmit={submit} className={styles.form}>
      <div className={styles.segment} aria-label="Entry type">{(['SALE', 'EXPENSE'] as const).map(type => <button key={type} type="button" aria-pressed={form.type === type} disabled={locked || !!entry} onClick={() => change({ type, categoryId: '', departmentId: type === 'SALE' && !dept?.sales ? config.departments.find(item => item.sales)!.id : form.departmentId })}>{type === 'SALE' ? 'Daily sales' : 'Expense'}</button>)}</div>
      <label>Date<input type="date" required min="2000-01-01" max={today()} value={form.businessDate} disabled={locked} onChange={e => change({ businessDate: e.target.value })} /></label>
      <label>Department<select required value={form.departmentId} disabled={locked} onChange={e => change({ departmentId: e.target.value, categoryId: '' })}>{config.departments.filter(item => form.type === 'EXPENSE' || item.sales).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {form.type === 'EXPENSE' && <label>Expense category<select required value={form.categoryId} disabled={locked} onChange={e => change({ categoryId: e.target.value })}><option value="">Choose category</option>{dept?.categories.map(id => <option key={id} value={id}>{config.categories[id]}</option>)}</select></label>}
      <label>Amount (₦)<input inputMode="decimal" autoFocus required pattern="(0|[1-9][0-9]*)(\.[0-9]{1,2})?" placeholder="0.00" value={form.amount} disabled={locked} onChange={e => change({ amount: e.target.value })} /></label>
      <label>Note <span className={styles.muted}>(optional)</span><textarea maxLength={500} value={form.note} disabled={locked} onChange={e => change({ note: e.target.value })} /></label>
      {error && <p role="alert" className={styles.alert}>{error}</p>}
      {conflict && <button type="button" disabled={busy} onClick={() => void loadSaved()}>Load latest saved version</button>}
      <button type="submit" className={styles.primary} disabled={!ready || busy}>{busy ? 'Saving…' : form.uncertain ? 'Retry same save' : entry ? 'Save correction' : 'Save entry'}</button>
      {form.uncertain && <p role="status">Save not confirmed. Fields are locked to prevent a changed retry from creating conflicting records.</p>}
    </form>
  </section></WorkspaceDialog>;
}
