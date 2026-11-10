"use client";
import { useEffect, useState } from "react";
import { apiFetch as fetch } from "./apiClient";
import styles from "./chat.module.css";

type Unlinked = {
  _id: string;
  chatId: string;
  text: string;
  bookingHandoff?: {
    state: string;
    guestName?: string;
    arrivalDate?: string;
    departureDate?: string;
    guests?: number;
    requestedNights?: number;
    category?: string;
    quote?: { category: string; totalMinor: number; currency: string };
  };
};
type Enquiry = {
  _id: string;
  chatId: string;
  messages: Pick<Unlinked, "_id" | "text">[];
  dates: { arrivalAt: string; departureAt: string } | null;
  awaitingReception: boolean;
};
type BookingRequest = {
  _id: string;
  chatId: string;
  version: number;
  state: "PENDING" | "NEEDS_DETAILS" | "CONFIRMED" | "DECLINED";
  details: { guestName: string; guests: number };
  quote: { category: string; arrivalAt: string; departureAt: string; currency: string; totalMinor: number; depositMinor: number };
  guestAnswer?: string;
  staffQuestion?: string;
  depositVerifiedAt?: string;
  reservationId?: string;
  deliveryState?: "PENDING" | "SENT" | "UNKNOWN";
};
const bookingState = { PENDING: "Awaiting reception", NEEDS_DETAILS: "Waiting for guest", CONFIRMED: "Confirmed", DECLINED: "Declined" };
const amount = (minor: number, currency: string) => new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(minor / 100);

function BookingRequestCard({ request, busy, decide }: {
  request: BookingRequest;
  busy: boolean;
  decide: (request: BookingRequest, action: "confirm" | "decline" | "ask", depositVerified: boolean, question?: string) => Promise<void>;
}) {
  const [depositVerified, setDepositVerified] = useState(false);
  const [question, setQuestion] = useState("");
  const { quote } = request;
  return <article className={styles.taskCard}>
    <strong>{request.details.guestName}</strong>
    <span>{senderLabel(request.chatId)} · {bookingState[request.state]}</span>
    <p>{quote.category} · {request.details.guests} guest(s) · {stayDay.format(new Date(quote.arrivalAt))} to {stayDay.format(new Date(quote.departureAt))}</p>
    <p>Accepted price {amount(quote.totalMinor, quote.currency)}. {quote.depositMinor
      ? `Deposit ${amount(quote.depositMinor, quote.currency)} · ${request.depositVerifiedAt ? "verified" : "verification pending"}`
      : "No deposit required."}</p>
    {request.staffQuestion && <p>Reception asked {request.staffQuestion}</p>}
    {request.guestAnswer && <p>Guest replied {request.guestAnswer}</p>}
    {request.reservationId && <p>Booking reference {request.reservationId}</p>}
    {request.deliveryState === "PENDING" && <p>WhatsApp update queued.</p>}
    {request.deliveryState === "SENT" && <p>WhatsApp update submitted.</p>}
    {request.deliveryState === "UNKNOWN" && <p>WhatsApp delivery unconfirmed. Check the guest chat.</p>}
    {request.state === "PENDING" && <>
      {!!quote.depositMinor && <label><input type="checkbox" checked={depositVerified} disabled={busy} onChange={event => setDepositVerified(event.target.checked)} /> I verified the deposit</label>}
      <div className={styles.bookingDecisionActions}>
        <button type="button" disabled={busy || (!!quote.depositMinor && !depositVerified)} onClick={() => void decide(request, "confirm", depositVerified)}>Confirm booking</button>
        <button type="button" disabled={busy} onClick={() => {
          if (window.confirm("Decline this request and notify the guest?")) void decide(request, "decline", false);
        }}>Decline</button>
      </div>
      <form onSubmit={event => {
        event.preventDefault();
        if (question.trim()) void decide(request, "ask", false, question.trim());
      }}>
        <label>Question for the guest<textarea className={styles.bookingDecisionQuestion} value={question} maxLength={1000} disabled={busy} onChange={event => setQuestion(event.target.value)} /></label>
        <button disabled={busy || !question.trim()}>Ask for details</button>
      </form>
    </>}
  </article>;
}

const stayDay = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const senderLabel = (chatId: string) => chatId.replace("@s.whatsapp.net", "").replace(/@lid$/, " (identity unresolved)");

function BookingHandoff({ details }: { details: NonNullable<Unlinked["bookingHandoff"]> }) {
  const { guestName, arrivalDate, departureDate, guests, requestedNights, category, quote } = details;
  const collected = [
    guestName,
    arrivalDate && `Check-in ${arrivalDate}`,
    departureDate && `Checkout ${departureDate}`,
    guests && `${guests} guest(s)`,
    requestedNights && `${requestedNights} requested night(s)`,
    category || quote?.category,
  ].filter(Boolean);
  return <>
    <strong>Booking enquiry needs reception</strong>
    {!!collected.length && <p>{collected.join(" · ")}</p>}
    {quote && <p>Last quote {amount(quote.totalMinor, quote.currency)}. Recheck before offering it.</p>}
    <p>Read the latest message above and follow up in the hotel WhatsApp.</p>
  </>;
}

type Stay = { _id: string; guestName: string; roomNumber: string; whatsappJid?: string };
export default function UnlinkedWhatsappMessages({ api, revision }: { api: string; revision: number }) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [bookingRequests, setBookingRequests] = useState<BookingRequest[]>([]);
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
      setEnquiries(data.enquiries || []);
      setBookingRequests(data.bookingRequests || []);
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
  async function decide(request: BookingRequest, action: "confirm" | "decline" | "ask", depositVerified: boolean, question?: string) {
    setBusy(true);
    try {
      const response = await fetch(`${api}/api/conversations/booking-enquiries/${request._id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: request.version, depositVerified, question }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.message || "Could not save the decision.");
      setRefresh(value => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refresh before retrying.");
    } finally {
      setBusy(false);
    }
  }
  return <>
    {notice && <p role="status">{notice} <button onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    {!!bookingRequests.length && <details className={styles.inboxSection} open>
      <summary>Booking requests ({bookingRequests.filter(request => request.state === "PENDING").length} awaiting reception)</summary>
      <div className={styles.inboxCards}>
        {bookingRequests.map(request => <BookingRequestCard key={`${request._id}:${request.version}`} request={request} busy={busy} decide={decide} />)}
      </div>
    </details>}
    {!!enquiries.length && <details className={styles.inboxSection}>
      <summary>Booking enquiries ({enquiries.length})</summary>
      <div className={styles.inboxCards}>
        {enquiries.map(enquiry => <article className={styles.taskCard} key={enquiry._id}>
          <strong>{senderLabel(enquiry.chatId)}</strong>
          <span>{enquiry.awaitingReception ? "Awaiting reception" : "Availability enquiry"}</span>
          <p>{enquiry.dates
            ? <>{stayDay.format(new Date(enquiry.dates.arrivalAt))} to {stayDay.format(new Date(enquiry.dates.departureAt))}</>
            : "Stay dates to confirm"}</p>
          {enquiry.messages.map(message => <p key={message._id}>{message.text}</p>)}
          {enquiry.awaitingReception && <p>Reply on the hotel WhatsApp. Use Rooms → Reservations to confirm the booking.</p>}
        </article>)}
      </div>
    </details>}
    {!!messages.length && <details className={styles.inboxSection}>
      <summary>Messages for staff review ({messages.length})</summary>
      <div className={styles.inboxCards}>
        {messages.map(message => {
          const matches = stays.filter(stay => stay.whatsappJid === message.chatId);
          return <article className={styles.taskCard} key={message._id}>
            <strong>{senderLabel(message.chatId)}</strong>
            <p>{message.text}</p>
            {message.bookingHandoff ? <BookingHandoff details={message.bookingHandoff} /> : matches.length === 1
              ? <button disabled={busy} onClick={() => void link(message, matches[0])}>Link to Room {matches[0].roomNumber}</button>
              : <p>Reception must verify this number and record one active stay before linking.</p>}
          </article>;
        })}
      </div>
    </details>}
  </>;
}
