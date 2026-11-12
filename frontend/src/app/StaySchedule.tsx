'use client';

import styles from './stay-schedule.module.css';

export const watToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());

export const watTomorrow = () => new Date(Date.parse(watToday()) + 86400000).toISOString().slice(0, 10);

export default function StaySchedule({ departure, onChange, policy, arrival = watToday(), onArrivalChange, disabled = false }: {
  departure: string; onChange: (value: string) => void;
  arrival?: string; onArrivalChange?: (value: string) => void; disabled?: boolean;
  policy?: { checkInLabel: string; checkOutLabel: string };
}) {
  const nights = (Date.parse(departure) - Date.parse(arrival)) / 86400000;
  const start = Date.parse(arrival);
  const minimum = Number.isFinite(start) ? new Date(start + 86400000).toISOString().slice(0, 10) : watTomorrow();
  return <fieldset className={styles.schedule} disabled={disabled}>
    <legend>Stay schedule · nights</legend>
    <div className={styles.dates}>
      <label>Check-in date<input type="date" value={arrival} required min={watToday()} readOnly={!onArrivalChange} onChange={event => onArrivalChange?.(event.target.value)} aria-describedby={onArrivalChange ? undefined : "actual-arrival-note"} /></label>
      <label>Check-out date<input type="date" required value={departure} min={minimum} onChange={event => onChange(event.target.value)} /></label>
    </div>
    <div className={styles.policy} aria-live="polite">
      <span>{Number.isInteger(nights) && nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'} stay` : 'Choose a checkout date'}</span>
      <span>Standard check-in {policy?.checkInLabel ?? '2:00 PM'} · Checkout {policy?.checkOutLabel ?? '12 noon'} · WAT</span>
    </div>
    {!onArrivalChange && <p id="actual-arrival-note" className={styles.note}>Check-in is recorded when you confirm the guest’s arrival.</p>}
  </fieldset>;
}
