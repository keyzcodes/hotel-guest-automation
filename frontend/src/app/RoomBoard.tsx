'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { apiFetch } from './apiClient';
import WorkspaceDialog from './WorkspaceDialog';
import styles from './rooms.module.css';

export type RoomRecord = { _id: string; number: string; category: string; housekeeping: 'DIRTY' | 'READY'; activeBookingId: string | null; outOfOrder: boolean; version: number };
const labels = {
  ready: 'Ready',
  dirty: 'Vacant · Dirty',
  occupied: 'Occupied',
  blocked: 'Out of service',
} as const;
export function roomState(room: RoomRecord): keyof typeof labels {
  if (room.outOfOrder) return 'blocked';
  if (room.activeBookingId) return 'occupied';
  return room.housekeeping === 'READY' ? 'ready' : 'dirty';
}
type Stay = { _id: string; guestName: string; guestPhone?: string; checkInTime?: string; checkOutTime: string };
const stayTime = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });
function formatStayTime(value?: string) {
  const date = new Date(value ?? '');
  return Number.isFinite(date.getTime()) ? stayTime.format(date) : 'Unavailable';
}
export default function RoomBoard({ rooms, stays, canAdd, loading, onRefresh, checkingIn, onOpenRoom, renderCheckIn, onStays }: {
  rooms: RoomRecord[]; stays: Stay[]; canAdd: boolean; loading: boolean; onRefresh: () => Promise<void>; checkingIn: boolean; onOpenRoom: () => void; renderCheckIn: (number: string) => ReactNode; onStays: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const room = rooms.find(item => item._id === selected);
  const selectedState = room ? roomState(room) : null;
  const stay = stays.find(item => item._id === room?.activeBookingId);
  const counts = rooms.reduce((acc, item) => { acc[roomState(item)]++; return acc; }, { ready: 0, dirty: 0, occupied: 0, blocked: 0 });
  const canWrite = !loading && !saving && !checkingIn;
  const close = () => { setSelected(''); setAdding(false); setError(''); };
  async function save(path: string, body: object, message: string) {
    if (!canWrite) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/rooms${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'The room could not be saved.');
      await onRefresh();
      close();
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the update. Refresh before retrying.');
      await onRefresh();
    } finally { setSaving(false); }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void save('', { number: data.get('number'), category: data.get('category') }, 'Room added. Confirm readiness before check-in.');
  }
  return <section className={styles.board} aria-label="Room board">
    <div className={styles.heading}><div><h2>At a glance</h2><p>{rooms.length} rooms · {counts.ready + counts.dirty} vacant · {counts.occupied} occupied</p></div>{canAdd && <button onClick={() => { setError(''); setAdding(true); }}>Add room</button>}</div>
    {notice && <p role="status">{notice}</p>}
    <div className={styles.indicators}>
      <dl className={styles.counts} aria-label="Room counts by status">
        {(Object.keys(labels) as (keyof typeof labels)[]).map(key => (
          <div className={styles.count} key={key}>
            <dt>{labels[key]}</dt>
            <dd>{counts[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
    {!rooms.length && <p>No rooms added. A GM can set up the room list here.</p>}
    <div className={styles.grid}>{rooms.map(item => <button type="button" className={styles.tile} key={item._id} data-state={roomState(item)} aria-haspopup="dialog" onClick={() => { setError(''); onOpenRoom(); setSelected(item._id); }}><span className={styles.tileStatus}><strong>Room {item.number}</strong><span>{labels[roomState(item)]}</span></span><small>{item.category}</small></button>)}</div>
    {room && <WorkspaceDialog label={`Room ${room.number}`} onClose={close} busy={saving || checkingIn} className={styles.modal}><section className={styles.modalContent}>
      <div className={styles.heading}><div><h2>Room {room.number}</h2><p>{room.category} · {labels[roomState(room)]}</p></div><button onClick={close} disabled={saving || checkingIn}>Close</button></div>
      {selectedState === 'ready' ? <div className={styles.guestDetails}>
        <h3>Walk-in check-in</h3>
        {renderCheckIn(room.number)}
      </div> : stay ? <div className={styles.guestDetails}>
        <h3>Current guest</h3>
        <dl>
          <div><dt>Guest name</dt><dd>{stay.guestName}</dd></div>
          {stay.guestPhone && <div><dt>Phone / WhatsApp</dt><dd>{stay.guestPhone}</dd></div>}
          <div><dt>Checked in · Lagos time</dt><dd>{formatStayTime(stay.checkInTime)}</dd></div>
          <div><dt>Planned checkout · Lagos time</dt><dd>{formatStayTime(stay.checkOutTime)}</dd></div>
        </dl>
      </div> : <p>{room.activeBookingId ? 'Current guest details are unavailable. Open Stays to check the record.' : 'No guest currently checked in.'}</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        {roomState(room) === 'dirty' && <button className={styles.mainAction} disabled={!canWrite} onClick={() => void save(`/${room._id}/action`, { action: 'ready', version: room.version }, `Room ${room.number} is ready.`)}>Mark ready</button>}
        {room.activeBookingId && <button onClick={() => { close(); onStays(); }}>Open stays</button>}
        {!room.activeBookingId && !room.outOfOrder && <button disabled={!canWrite} onClick={() => void save(`/${room._id}/action`, { action: 'out-of-order', version: room.version }, `Room ${room.number} is out of order.`)}>Mark out of order</button>}
        {room.outOfOrder && <button disabled={!canWrite} onClick={() => void save(`/${room._id}/action`, { action: 'return-to-service', version: room.version }, `Room ${room.number} returned to service. Confirm readiness next.`)}>Return to service</button>}
      </div>
    </section></WorkspaceDialog>}
    {adding && <WorkspaceDialog label="Add room" onClose={close} busy={saving} className={styles.modal}><section className={styles.modalContent}>
      <div className={styles.heading}><h2>Add room</h2><button onClick={close} disabled={saving}>Close</button></div>
      <form className={styles.form} onSubmit={add}><label>Room number<input name="number" maxLength={12} required autoComplete="off" /></label><label>Category<input name="category" maxLength={48} required autoComplete="off" /></label>{error && <p role="alert">{error}</p>}<button className={styles.mainAction} disabled={!canWrite}>{saving ? 'Saving…' : 'Add room'}</button></form>
    </section></WorkspaceDialog>}
  </section>;
}
