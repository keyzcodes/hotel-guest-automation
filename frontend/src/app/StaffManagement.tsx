'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { message, request } from './finance/client';
import styles from './operations.module.css';
type Account = { _id: string; name: string; email: string; role: 'GM' | 'STAFF'; active: boolean };
export default function StaffManagement() {
  const [accounts, setAccounts] = useState<Account[] | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const flight = useRef(false);
  const load = useCallback(async () => {
    try { const data = await request<{ data: Account[] }>('/api/staff'); setAccounts(data.data); setError(''); }
    catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (flight.current) return;
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try { await request('/api/staff', { method: 'POST', body: JSON.stringify(form) }); setForm({ name: '', email: '', password: '' }); setNotice('Staff account created. Share credentials privately.'); await load(); }
    catch (e) { setError(message(e) + ' Refresh the account list before retrying.'); }
    finally { flight.current = false; setBusy(false); }
  }
  async function toggle(account: Account) {
    if (flight.current || !window.confirm(`${account.active ? 'Disable' : 'Enable'} access for ${account.name}?${account.active ? ' They will be signed out on all devices.' : ''}`)) return;
    flight.current = true; setBusy(true); setError('');
    try { await request(`/api/staff/${account._id}`, { method: 'PATCH', body: JSON.stringify({ active: !account.active }) }); await load(); }
    catch (e) { setError(message(e)); }
    finally { flight.current = false; setBusy(false); }
  }
  return <section><div className={styles.heading}><h1>Staff accounts</h1><button disabled={busy} onClick={() => void load()}>Refresh</button></div><p>Staff can work across departments. Only the GM manages accounts.</p>{error && <p className={styles.alert} role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<div className={styles.twoColumns}><form className={`${styles.form} ${styles.panel}`} onSubmit={create}><h2>Add staff member</h2><label>Name<input required maxLength={100} autoComplete="name" value={form.name} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Email<input type="email" required maxLength={254} autoComplete="off" value={form.email} disabled={busy} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>Initial password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={form.password} disabled={busy} onChange={e => setForm({ ...form, password: e.target.value })} /></label><small>12–128 characters. Passwords are never saved in browser draft storage.</small><button className={styles.primary} disabled={busy}>{busy ? 'Working…' : 'Create staff account'}</button></form><div className={styles.panel}><h2>Hotel team</h2>{accounts === null ? <p>Accounts have not loaded yet.</p> : accounts.map(account => <article className={styles.entryRow} key={account._id}><span><strong>{account.name}</strong><small>{account.email}</small><small>{account.role} · {account.active ? 'Active' : 'Disabled'}</small></span>{account.role === 'STAFF' && <button disabled={busy} onClick={() => void toggle(account)}>{account.active ? 'Disable' : 'Enable'}</button>}</article>)}</div></div></section>;
}
