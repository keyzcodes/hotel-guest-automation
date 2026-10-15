"use client";
import { apiFetch as fetch } from "./apiClient";
import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";
type Feedback = { count: number; average: number | null; recent: { _id: string; roomNumber: string; guestName: string; guestRating: number; guestRatedAt: string }[] };
export default function GuestFeedback({ api, revision }: { api: string; revision: number; onOpen: (id: string) => void }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    // Load independently: a feedback failure must not blank current stays.
    fetch(`${api}/api/bookings/feedback`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.recent)) throw Error("Guest feedback is temporarily unavailable.");
        if (!controller.signal.aborted) { setFeedback(data); setError(""); }
      }).catch(() => { if (!controller.signal.aborted) setError("Guest feedback is temporarily unavailable."); });
    return () => controller.abort();
  }, [api, revision]);
  return <section className={styles.panel} aria-label="Guest feedback" style={{ marginBottom: 20 }}>
    <div className={styles.panelHead}><div><h2>Guest feedback</h2><p>Last 30 days · Internal stay ratings</p></div></div>
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "12px 20px", padding: "0 20px 16px" }}>
      <strong style={{ fontSize: 26 }}>{feedback?.average != null ? feedback.average.toFixed(1) : "—"}<small> / 5</small></strong>
      <span style={{ color: "var(--blue)", letterSpacing: 2 }} aria-label="Rating out of five">{feedback?.average != null ? "★".repeat(Math.round(feedback.average)) + "☆".repeat(5 - Math.round(feedback.average)) : "☆☆☆☆☆"}</span>
      <span>{feedback ? `${feedback.count} guest ${feedback.count === 1 ? "response" : "responses"}` : error ? "Unavailable" : "Loading…"}</span>
    </div>
    {error && <p role="status" className={styles.panelNote}>{error}</p>}
    {feedback?.count === 0 && <p className={styles.panelNote}>Guest ratings will appear here after checkout.</p>}
  </section>;
}
