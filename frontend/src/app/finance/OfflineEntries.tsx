'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useStaffAccess } from '../StaffAccess';
import { enqueue, syncQueue, type QueueItem, type QueuedBody } from './offlineQueue';
import { queueStore } from './queueStore';

type QueueContext = {
  items: QueueItem[]; error: string; save: (body: QueuedBody) => Promise<QueueItem>;
  dismiss: (item: QueueItem) => Promise<void>;
};
const Context = createContext<QueueContext | null>(null);
export function useOfflineEntries() {
  const value = useContext(Context);
  if (!value) throw Error('Offline entry provider is missing.');
  return value;
}
export default function OfflineEntries({ children }: { children: React.ReactNode }) {
  const { identity } = useStaffAccess();
  const owner = identity?.id || '';
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState('');
  const running = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const token = revision.current;
    try {
      const rows = owner ? await queueStore.list(owner) : [];
      if (token === revision.current) { setItems(rows); setError(''); }
    } catch (e) {
      if (token === revision.current) setError(e instanceof Error ? e.message : 'Pending entries could not be loaded.');
    }
  }, [owner]);
  const sync = useCallback(async () => {
    if (!owner || running.current || !navigator.onLine) return;
    running.current = true;
    const token = revision.current;
    const active = () => token === revision.current;
    let updated = false;
    try {
      await syncQueue(queueStore, owner, async item => {
        if (!active()) throw Error('Session changed.');
        // Read the live cookie session; never send a queued record under another actor.
        const response = await fetch('/api/finance/entries', { method: 'POST', credentials: 'same-origin',
          cache: 'no-store', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', 'X-Finance-Actor': owner }, body: JSON.stringify(item.body) });
        const data = await response.json();
        if (response.status === 401) window.dispatchEvent(new Event('hotel-session-expired'));
        return { status: response.status, message: data.code === 'IDENTITY_CHANGED' ? 'IDENTITY_CHANGED' : data.message,
          confirmed: data.success === true && typeof data.data?.id === 'string' && data.data.createdBy === owner };
      }, active, () => { updated = true; });
      if (active()) await refresh();
    } catch (e) {
      if (active()) setError(e instanceof Error ? e.message : 'Pending entries could not be updated.');
    } finally {
      running.current = false;
      if (active() && updated) window.dispatchEvent(new Event('hotel-finance-synced'));
    }
  }, [owner, refresh]);
  useEffect(() => {
    revision.current++;
    const token = revision.current;
    const timer = window.setTimeout(() => { void refresh(); void sync(); }, 0);
    const wake = () => { if (token === revision.current) { void refresh(); void sync(); } };
    const tick = window.setInterval(wake, 30000);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('hotel-finance-queue', wake);
    return () => {
      revision.current = token + 1; clearTimeout(timer); clearInterval(tick);
      window.removeEventListener('online', wake); window.removeEventListener('focus', wake);
      window.removeEventListener('hotel-finance-queue', wake);
    };
  }, [refresh, sync]);
  async function save(body: QueuedBody) {
    const item = await enqueue(queueStore, owner, body);
    await refresh();
    window.dispatchEvent(new Event('hotel-finance-queue'));
    return item;
  }
  async function dismiss(item: QueueItem) {
    if (item.owner !== owner || item.status === 'waiting') return;
    await queueStore.remove(item.id);
    await refresh();
  }
  return <Context.Provider value={{ items, error, save, dismiss }}>{children}</Context.Provider>;
}
