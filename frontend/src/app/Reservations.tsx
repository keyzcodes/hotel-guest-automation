"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "./apiClient";
import { roomState, type RoomRecord } from "./RoomBoard";
import styles from "./reservations.module.css";

type AvailableRoom = Pick<RoomRecord, "_id" | "number" | "category">;
type Reservation = {
  _id: string;
  roomId: string;
  roomNumber: string;
  guestName: string;
  arrivalAt: string;
  departureAt: string;
  canArrive: boolean;
};

const formatTime = new Intl.DateTimeFormat("en-NG", {
  timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short",
});
const toISO = (value: string) => new Date(value + "+01:00").toISOString();

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit) {
  const response = await apiFetch(path, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.message || "Could not load reservation records.", response.status);
  return data;
}

export default function Reservations({ active, rooms, inventoryError, revision, onCheckIn }: {
  active: boolean;
  rooms: RoomRecord[];
  inventoryError: boolean;
  revision: number;
  onCheckIn: () => void;
}) {
  const [arrivals, setArrivals] = useState<Reservation[] | null>(null);
  const [listError, setListError] = useState("");
  const [reload, setReload] = useState(0);
  const [arrival, setArrival] = useState("");
  const [departure, setDeparture] = useState("");
  const [options, setOptions] = useState<AvailableRoom[] | null>(null);
  const [roomId, setRoomId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [busy, setBusy] = useState("");
  const [formError, setFormError] = useState("");
  const [arrivalError, setArrivalError] = useState("");
  const [notice, setNotice] = useState("");
  const [arrivalNotice, setArrivalNotice] = useState("");

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    request("/api/reservations", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(data => {
        if (controller.signal.aborted) return;
        setArrivals(data.reservations);
        setListError("");
      })
      .catch(() => { if (!controller.signal.aborted) setListError("Could not refresh arrivals. Use Refresh arrivals to try again."); });
    return () => controller.abort();
  }, [active, revision, reload]);

  function changeDate(update: (value: string) => void, value: string) {
    update(value);
    setOptions(null);
    setRoomId("");
    setFormError("");
    setNotice("");
  }

  async function checkAvailability() {
    setFormError("");
    setNotice("");
    setRoomId("");
    setOptions(null);
    if (!arrival || !departure || departure <= arrival) {
      setFormError("Departure must be after arrival.");
      return;
    }
    setBusy("availability");
    try {
      const query = new URLSearchParams({ arrivalAt: toISO(arrival), departureAt: toISO(departure) });
      const data = await request("/api/reservations/availability?" + query);
      setOptions(data.rooms);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not check availability.");
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!options?.length) {
      await checkAvailability();
      return;
    }
    if (!roomId) return;
    setBusy("save");
    setFormError("");
    setNotice("");
    try {
      const data = await request("/api/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, guestName, guestPhone, arrivalAt: toISO(arrival), departureAt: toISO(departure) }),
      });
      setNotice("Reservation confirmed for Room " + data.reservation.roomNumber + ".");
      setGuestName("");
      setGuestPhone("");
      setOptions(null);
      setRoomId("");
      setReload(value => value + 1);
    } catch (error) {
      if (error instanceof RequestError && error.status < 500) {
        setFormError(error.message);
        if (error.status === 409) {
          setOptions(null);
          setRoomId("");
        }
      } else {
        setOptions(null);
        setRoomId("");
        setFormError("Could not confirm whether the reservation was saved. Check Arrivals before trying again.");
        setReload(value => value + 1);
      }
    } finally {
      setBusy("");
    }
  }

  async function checkIn(reservationId: string) {
    if (busy) return;
    setBusy(reservationId);
    setArrivalError("");
    setArrivalNotice("");
    try {
      await request("/api/bookings/check-in", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId }), signal: AbortSignal.timeout(30000),
      });
      onCheckIn();
    } catch (error) {
      setArrivalError(error instanceof Error ? error.message : "Could not confirm check-in. Refresh arrivals before retrying.");
      setReload(value => value + 1);
    } finally {
      setBusy("");
    }
  }

  async function cancel(reservation: Reservation) {
    if (busy || !window.confirm(`Cancel the reservation for ${reservation.guestName} in Room ${reservation.roomNumber}?`)) return;
    setBusy("cancel:" + reservation._id);
    setArrivalError("");
    setArrivalNotice("");
    try {
      await request(`/api/reservations/${reservation._id}/cancel`, { method: "POST" });
      setArrivals(current => current?.filter(item => item._id !== reservation._id) ?? null);
      setArrivalNotice("Reservation cancelled for Room " + reservation.roomNumber + ".");
    } catch (error) {
      setArrivalError(error instanceof RequestError && error.status < 500
        ? error.message
        : "Could not confirm cancellation. Check Arrivals before trying again.");
    } finally {
      setReload(value => value + 1);
      setBusy("");
    }
  }

  return <div className={styles.layout}>
    <form className={styles.panel} onSubmit={save}>
      <h2>New reservation</h2>
      <p>Enter the planned arrival and departure in Lagos time.</p>
      <div className={styles.dates}>
        <label>Arrival<input type="datetime-local" required value={arrival} disabled={!!busy} onChange={event => changeDate(setArrival, event.target.value)} /></label>
        <label>Departure<input type="datetime-local" required value={departure} disabled={!!busy} onChange={event => changeDate(setDeparture, event.target.value)} /></label>
      </div>
      {options && options.length > 0 && <>
        <label>Available room<select required value={roomId} disabled={!!busy} onChange={event => setRoomId(event.target.value)}>
          <option value="">Choose a room</option>
          {options.map(room => <option key={room._id} value={room._id}>{room.number} · {room.category}</option>)}
        </select></label>
        <label>Guest name<input required value={guestName} maxLength={100} autoComplete="name" disabled={!!busy} onChange={event => setGuestName(event.target.value)} /></label>
        <label>Guest phone<input required value={guestPhone} type="tel" maxLength={30} autoComplete="tel" disabled={!!busy} onChange={event => setGuestPhone(event.target.value)} /></label>
      </>}
      {options?.length === 0 && <p role="status">No rooms are available for these times. Try different dates.</p>}
      {formError && <p role="alert">{formError}</p>}
      {notice && <p role="status">{notice}</p>}
      <button className={styles.primary} disabled={!!busy}>
        {busy === "availability" ? "Checking…" : busy === "save" ? "Saving…" : options?.length ? "Confirm reservation" : "Check availability"}
      </button>
    </form>

    <section className={styles.panel} aria-label="Arrivals">
      <div className={styles.heading}>
        <h2>Arrivals</h2>
        <button onClick={() => setReload(value => value + 1)} disabled={!!busy}>Refresh arrivals</button>
      </div>
      {listError && <p role="alert">{listError}</p>}
      {arrivalError && <p role="alert">{arrivalError}</p>}
      {arrivalNotice && <p role="status">{arrivalNotice}</p>}
      {!arrivals && !listError && <p role="status">Loading arrivals…</p>}
      {arrivals?.length === 0 && <p>No upcoming reservations.</p>}
      {arrivals?.map(reservation => {
        const room = rooms.find(item => item._id === reservation.roomId);
        const state = room && !inventoryError ? roomState(room) : null;
        const ready = state === "ready";
        const status = !reservation.canArrive ? "Check-in opens at the scheduled arrival time."
          : state === "ready" ? "Ready for check-in"
          : state === "dirty" ? "Waiting for housekeeping to mark the room ready."
          : state === "occupied" ? "Room is still occupied."
          : state === "blocked" ? "Room is out of service."
          : "Room status unavailable. Refresh the room board.";
        return <article className={styles.arrival} key={reservation._id}>
          <div className={styles.heading}><h3>{reservation.guestName}</h3><span className={styles.status}>Confirmed</span></div>
          <strong>Room {reservation.roomNumber}</strong>
          <p>Arrival {formatTime.format(new Date(reservation.arrivalAt))}<br />Departure {formatTime.format(new Date(reservation.departureAt))}</p>
          <p>{status}</p>
          <div className={styles.actions}>
            <button aria-busy={busy === reservation._id} disabled={!!busy || !!listError || !ready || !reservation.canArrive} onClick={() => void checkIn(reservation._id)}>
              {busy === reservation._id ? "Checking in…" : "Confirm check-in"}
            </button>
            <button aria-busy={busy === "cancel:" + reservation._id} disabled={!!busy || !!listError} onClick={() => void cancel(reservation)}>
              {busy === "cancel:" + reservation._id ? "Cancelling…" : "Cancel reservation"}
            </button>
          </div>
        </article>;
      })}
    </section>
  </div>;
}
