"use client";
import { useEffect, useState } from "react";
import { apiFetch as fetch } from "./apiClient";

type Unlinked = { _id: string; chatId: string; text: string };
type Stay = { _id: string; guestName: string; roomNumber: string; whatsappJid?: string };
export default function UnlinkedWhatsappMessages({ api, revision }: { api: string; revision: number }) {
  const [messages, setMessages] = useState<Unlinked[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`${api}/api/conversations/unlinked`, { signal: controller.signal }),
      fetch(`${api}/api/bookings/active`, { signal: controller.signal }),
    ]).then(async ([inbox, active]) => {
      if (!inbox.ok || !active.ok) throw Error("Could not load messages awaiting guest matching.");
      const [data, bookings] = await Promise.all([inbox.json(), active.json()]);
      if (controller.signal.aborted) return;
      setMessages(data.messages || []);
      setStays(bookings.bookings || []);
      setNotice("");
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [api, revision, refresh]);
  async function link(message: Unlinked, stay: Stay) {
    if (!window.confirm(`Link messages from this number to ${stay.guestName}, Room ${stay.roomNumber}, for staff review?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`${api}/api/conversations/unlinked/${message._id}/link`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: stay._id }), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.message || "Could not link messages.");
      setRefresh(value => value + 1);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Refresh before retrying."); }
    finally { setBusy(false); }
  }
  if (!messages.length && !notice) return null;
  return <details>
    <summary>Guest matching needed ({messages.length})</summary>
    {notice && <p role="status">{notice} <button onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {messages.map(message => {
      const matches = stays.filter(stay => stay.whatsappJid === message.chatId);
      return <article key={message._id}>
        <p><strong>{message.chatId.replace("@s.whatsapp.net", "").replace(/@lid$/, " (identity unresolved)")}</strong></p>
        <p>{message.text}</p>
        {matches.length === 1
          ? <button disabled={busy} onClick={() => void link(message, matches[0])}>Link to Room {matches[0].roomNumber}</button>
          : <p>Reception must verify this number and record one active stay before linking.</p>}
      </article>;
    })}
  </details>;
}
