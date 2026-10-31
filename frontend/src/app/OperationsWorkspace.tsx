'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useStaffAccess } from './StaffAccess';
import GuestWorkspace from './GuestWorkspace';
import GuestFeedback from './GuestFeedback';
import FinanceWorkspace from './finance/FinanceWorkspace';
import StaffManagement from './StaffManagement';
import { request, message, today } from './finance/client';
import styles from './operations.module.css';
import { workspaceSection } from './workspacePosition';
const subscribe = (change: () => void) => { window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); };
function Symbol({ name }: { name: string }) {
  const paths: Record<string, string> = { overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', guests: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M16 4a4 4 0 0 1 0 8 M17 15a5 5 0 0 1 5 5', reports: 'M4 21V11h4v10 M10 21V3h4v18 M16 21V7h4v14' };
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={paths[name] || paths.overview} /></svg>;
}
function ActivityIcon({ index }: { index: number }) {
  const paths = [
    'M3 18v-9m0 6h18v3M3 11h18v4M6 11V7h5v4m2 0V7h5v4',
    'M13 20H4V4h9m2 4 4 4-4 4m-5-4h12',
    'M8 5H5v16h14V5h-3M8 3h8v4H8zM8 11h8m-8 4h8',
    'M20 11V4H3v12h4v4l5-4h2m2-5-4 4 4 4m-4-4h9',
  ];
  return <svg className={styles.activityIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[index]} /></svg>;
}
type Stay = { _id: string; checkOutTime: string };
type Task = { bookingId: string; status: string; roomNumber: string; category: string };
function Overview({ openGuests }: { openGuests: () => void }) {
  const [staysLoaded, setStaysLoaded] = useState<Stay[] | null>(null);
  const [chatsLoaded, setChatsLoaded] = useState<{ count: number; partial: boolean } | null>(null);
  const [loaded, setLoaded] = useState<{ stays: Stay[]; open: Task[] } | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const options = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) };
        const staysPromise = request<{ bookings: Stay[] }>('/api/bookings/active', options).then(result => {
          if (!controller.signal.aborted) setStaysLoaded(result.bookings);
          return result;
        });
        const work = Promise.all([staysPromise, request<{ data: Task[] }>('/api/tasks', options)]).then(([stays, tasks]) => {
          if (!controller.signal.aborted) {
            const ids = new Set(stays.bookings.map(row => row._id));
            setLoaded({ stays: stays.bookings, open: tasks.data.filter(row => row.status !== 'Resolved' && ids.has(row.bookingId)) });
          }
        });
        const chats = request<{ conversations: { needsReplyCount: number }[]; hasMore: boolean }>('/api/conversations?scope=Current&limit=500', options).then(result => {
          if (!controller.signal.aborted) setChatsLoaded({ count: result.conversations.filter(row => row.needsReplyCount > 0).length, partial: result.hasMore });
        });
        const results = await Promise.allSettled([work, chats]);
        if (!controller.signal.aborted) {
          const failure = results.find(result => result.status === 'rejected');
          setError(failure?.status === 'rejected' ? message(failure.reason) : '');
        }
      } catch (e) { if (!controller.signal.aborted) setError(message(e)); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 0);
    const visible = () => { if (!document.hidden) setReload(value => value + 1); };
    document.addEventListener('visibilitychange', visible);
    const refresh = setInterval(visible, 60000);
    return () => { controller.abort(); clearTimeout(timer); clearInterval(refresh); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  const metrics = [ ['Current stays', staysLoaded?.length], ['Due out / overdue', staysLoaded?.filter(row => new Date(row.checkOutTime).getTime() < Date.parse(today() + 'T23:00:00.000Z')).length], ['Open requests', loaded?.open.length], ['Chats need reply', chatsLoaded ? `${chatsLoaded.count}${chatsLoaded.partial ? '+' : ''}` : undefined] ];
  return <><div className={styles.heading}><div><h1>Overview</h1><p className={styles.muted}>Current guest activity and recorded finances</p></div><button onClick={() => setReload(value => value + 1)} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button></div>{error && <p className={styles.alert} role="alert">{error} {loaded ? 'Last loaded guest records remain visible.' : 'Guest activity is unavailable.'}</p>}<div className={styles.metrics}>{metrics.map(([label, value], index) => <button className={styles.metric} key={String(label)} onClick={openGuests}><ActivityIcon index={index} /><span><small>{label}</small><strong>{value ?? '—'}</strong></span></button>)}</div><div className={styles.overviewPanels}><FinanceWorkspace compact onReports={() => { window.location.hash = 'reports'; }} /><section className={styles.panel}><div className={styles.heading}><h2>Needs attention</h2><button onClick={openGuests}>Open Guests →</button></div>{loaded ? loaded.open.length ? loaded.open.slice(0, 3).map((row, i) => <button className={styles.entryRow} key={i} onClick={openGuests}><strong>Room {row.roomNumber}</strong><span>{row.category} · {row.status}</span></button>) : <p>No open requests for current stays.</p> : <p>{error ? 'Unavailable' : 'Loading guest activity…'}</p>}</section></div><GuestFeedback api="" revision={reload} onOpen={openGuests} /></>;
}
export default function OperationsWorkspace() {
  const { identity, logout, signingOut } = useStaffAccess();
  const positionKey = `hotel-workspace-section:${identity?.id || identity?.email}`;
  const snapshot = useCallback(() => {
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(positionKey); } catch { /* URL navigation remains available. */ }
    return workspaceSection(window.location.hash, saved, identity?.role === 'GM');
  }, [positionKey, identity?.role]);
  const section = useSyncExternalStore(subscribe, snapshot, () => 'overview');
  useEffect(() => {
    try { sessionStorage.setItem(positionKey, section); } catch { /* Optional storage. */ }
    // Keep an explicit URL after restoring a tab whose original hash was absent.
    if (!window.location.hash) window.history.replaceState(window.history.state, '', `#${section}`);
  }, [section, positionKey]);
  const [dark, setDark] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDark(document.documentElement.dataset.theme === 'dark'), 0); return () => clearTimeout(timer); }, []);
  const hotelName = identity?.hotelName || 'Hotel';
  function theme() { const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light'; document.documentElement.style.colorScheme = next ? 'dark' : 'light'; try { localStorage.setItem('hotel-theme', next ? 'dark' : 'light'); } catch { /* Theme still works. */ } }
  const nav = ['overview', 'guests', 'reports'].map(item => <a key={item} href={`#${item}`} aria-current={section === item ? 'page' : undefined}><Symbol name={item} /><span>{item[0].toUpperCase() + item.slice(1)}</span></a>);
  return <div className={styles.shell}><aside className={styles.sidebar}><strong className={styles.brand}>{hotelName}</strong><nav aria-label="Hotel workspaces">{nav}</nav></aside><div className={styles.body}><header className={styles.header}><strong>{hotelName}</strong><details className={styles.profile}><summary aria-label="Account menu">{identity?.name?.[0] || '●'}</summary><div><strong>{identity?.name || identity?.email}</strong><small>{identity?.role}</small>{identity?.role === 'GM' && <a href="#staff" onClick={e => e.currentTarget.closest('details')?.removeAttribute('open')}>Staff accounts</a>}<button onClick={theme}>{dark ? 'Light theme' : 'Dark theme'}</button><button disabled={signingOut} onClick={() => { if (confirm('Sign out of the hotel workspace?')) void logout(); }}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div></details></header><div className={styles.content}>{section === 'overview' && <Overview openGuests={() => { window.location.hash = 'guests'; }} />}{section === 'guests' && <>{identity?.guestMessagingEnabled === false && <p className={styles.warning}>Guest messaging is off in this development session.</p>}<GuestWorkspace embedded /></>}{section === 'reports' && <FinanceWorkspace />}{section === 'staff' && <StaffManagement />}</div></div><nav className={styles.bottomNav} aria-label="Mobile hotel workspaces">{nav}</nav></div>;
}
