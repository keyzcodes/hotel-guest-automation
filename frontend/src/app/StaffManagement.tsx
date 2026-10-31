'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { message, request } from './finance/client';
import styles from './operations.module.css';
import { useStaffAccess } from './StaffAccess';
import { staffDraft } from './staffDraft';
type Account = { _id: string; name: string; email: string; role: 'GM' | 'STAFF'; active: boolean };
export default function StaffManagement() {
  const [accounts, setAccounts] = useState<Account[] | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const { identity } = useStaffAccess();
  const draftKey = `hotel-staff-draft:${identity?.id || identity?.email}`;
  const [showPassword, setShowPassword] = useState(false), [refreshing, setRefreshing] = useState(false), [draftSaved, setDraftSaved] = useState(false);
  const flight = useRef(false), refreshFlight = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { const saved = staffDraft(sessionStorage.getItem(draftKey)); if (saved) { setForm({ ...saved, password: '' }); setDraftSaved(true); } } catch { /* Draft storage is optional. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [draftKey]);
  function change(field: 'name' | 'email' | 'password', value: string) {
    const next = { ...form, [field]: value }; setForm(next);
    try {
      if (next.name || next.email) { sessionStorage.setItem(draftKey, JSON.stringify({ name: next.name, email: next.email })); setDraftSaved(true); }
      else { sessionStorage.removeItem(draftKey); setDraftSaved(false); }
    } catch { setDraftSaved(false); }
  }
  function clearDraft() { try { sessionStorage.removeItem(draftKey); } catch { /* Optional. */ } setDraftSaved(false); }
  function leave() { setShowPassword(false); window.location.hash = 'overview'; }

  const load = useCallback(async () => {
    try { const data = await request<{ data: Account[] }>('/api/staff'); setAccounts(data.data); setError(''); return true; }
    catch (e) { setError(message(e)); return false; }
  }, []);
  async function refreshAccounts() {
    if (refreshFlight.current || flight.current) return;
    refreshFlight.current = true; setRefreshing(true); setNotice('');
    try { if (await load()) setNotice('Updated just now.'); }
    finally { refreshFlight.current = false; setRefreshing(false); }
  }
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (flight.current || refreshFlight.current) return;
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try { await request('/api/staff', { method: 'POST', body: JSON.stringify(form) }); setForm({ name: '', email: '', password: '' }); clearDraft(); setShowPassword(false); setNotice('Staff account created.'); await load(); }
    catch (e) { setError(message(e) + ' Refresh the account list before retrying.'); }
    finally { flight.current = false; setBusy(false); }
  }
  async function toggle(account: Account) {
    if (flight.current || refreshFlight.current || !window.confirm(`${account.active ? 'Disable' : 'Enable'} access for ${account.name}?${account.active ? ' They will lose access on all devices. Their saved records will remain.' : ' They can sign in again. Previous sessions stay revoked.'}`)) return;
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try { await request(`/api/staff/${account._id}`, { method: 'PATCH', body: JSON.stringify({ active: !account.active }) }); setAccounts(current => current?.map(row => row._id === account._id ? { ...row, active: !account.active } : row) || null); setNotice(account.active ? 'Account disabled.' : 'Account enabled.'); await load(); }
    catch (e) { setError(message(e)); }
    finally { flight.current = false; setBusy(false); }
  }
  return <section><button className={styles.link} type="button" disabled={busy} onClick={leave}>← Back</button><div className={styles.heading}><h1>Staff accounts</h1><button disabled={busy || refreshing} onClick={() => void refreshAccounts()}>{refreshing ? 'Refreshing…' : 'Refresh'}</button></div><p>Staff can work across departments. Only the GM manages accounts.</p>{error && <p className={styles.alert} role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<div className={styles.twoColumns}><form className={`${styles.form} ${styles.panel}`} onSubmit={create}><div className={styles.staffFormTitle}><h2>Add staff member</h2>{draftSaved && <small>Draft saved</small>}</div><label>Name<input required maxLength={100} autoComplete="name" value={form.name} disabled={busy} onChange={e => change('name', e.target.value)} /></label><label>Email<input type="email" required maxLength={254} autoComplete="off" value={form.email} disabled={busy} onChange={e => change('email', e.target.value)} /></label><label>Initial password<span className={styles.passwordControl}><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={form.password} disabled={busy} onChange={e => change('password', e.target.value)} /><button type="button" disabled={busy} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="m3 3 18 18" />}</svg></button></span></label><small>12–128 characters. Passwords are never saved in browser draft storage.</small><button className={styles.primary} disabled={busy}>{busy ? 'Working…' : 'Create staff account'}</button><button type="button" disabled={busy} onClick={() => { if ((!form.name && !form.email && !form.password) || confirm('Discard this unfinished staff account?')) { clearDraft(); setForm({ name: '', email: '', password: '' }); leave(); } }}>Cancel</button></form><div className={styles.panel}><h2>Hotel team</h2>{accounts === null ? <p>Accounts have not loaded yet.</p> : accounts.map(account => <article className={styles.entryRow} key={account._id}><span><strong>{account.name}</strong><small>{account.email}</small><small>{account.role === 'STAFF' ? 'Staff' : 'GM'} · {account.active ? 'Active' : 'Disabled'}</small></span>{account.role === 'STAFF' && <button disabled={busy} onClick={() => void toggle(account)}>{account.active ? 'Disable' : 'Enable'}</button>}</article>)}</div></div></section>;
}
