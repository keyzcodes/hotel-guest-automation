"use client";

import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import ChatWorkspace from "./ChatWorkspace";
import styles from "./dashboard.module.css";

type Ticket = {
  _id: string;
  bookingId?: string | null;
  guestName: string;
  roomNumber: string;
  requestText: string;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
  guestUpdates?: { messageId: string; text: string; createdAt: string }[];
};
type Booking = {
  _id: string;
  guestName: string;
  roomNumber: string;
  checkOutTime: string;
  pulseCheckStatus: string;
  stayStatus: string;
  telegramChatId?: string | null;
};
type View = "Overview" | "Conversations" | "Requests" | "Guest journey";
const API = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"
).replace(/\/$/, "");
const departments = [
  "Housekeeping",
  "Maintenance",
  "F&B",
  "Front Desk",
  "General Inquiry",
];
const date = (value: string) =>
  new Date(value).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Conversations: "M3 4h18v14H8l-5 3z M7 8h10 M7 12h7",
    Overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    Requests: "M3 4h18v14H8l-5 3z M7 8h10 M7 12h7",
    "Guest journey": "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1",
    moon: "M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11",
    arrow: "M5 12h14 M14 7l5 5-5 5",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.arrow} />
    </svg>
  );
}
export default function Dashboard() {
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<View>("Overview");
  const [dark, setDark] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updated, setUpdated] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState("");
  const [checkoutRetry, setCheckoutRetry] = useState<Booking | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [live, setLive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [form, setForm] = useState({
    guestName: "",
    guestPhone: "",
    roomNumber: "",
    checkOutTime: "",
    telegramChatId: "",
  });
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    try {
      const responses = await Promise.all([
        fetch(`${API}/api/tasks`, { signal, cache: "no-store" }),
        fetch(`${API}/api/bookings/active`, { signal, cache: "no-store" }),
      ]);
      if (responses.some((r) => !r.ok))
        throw new Error("The backend could not load the dashboard.");
      const [tasks, stays] = await Promise.all(responses.map((r) => r.json()));
      if (
        !tasks.success ||
        !stays.success ||
        !Array.isArray(tasks.data) ||
        !Array.isArray(stays.bookings)
      )
        throw new Error("Unexpected response from the backend.");
      setTickets(tasks.data);
      setBookings(stays.bookings);
      setRevision((value) => value + 1);
      setConnected(true);
      setError("");
      setUpdated(
        new Date().toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (e) {
      if (signal?.aborted) return;
      setConnected(false);
      setError(
        e instanceof Error
          ? e.message
          : "Connection failed. Check that the backend is running on port 5000.",
      );
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const socket = io(API, { autoConnect: false });
    let timer: number | undefined;
    let running = false;
    let requested = false;
    let disposed = false;
    const load = async () => {
      if (disposed) return;
      if (running) {
        requested = true;
        return;
      }
      running = true;
      await refresh(controller.signal);
      running = false;
      if (requested && !disposed) {
        requested = false;
        void load();
      }
    };
    const changed = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        void load();
      }, 150);
    };
    socket.on("connect", () => {
      setLive(true);
      void load();
    });
    socket.on("disconnect", () => setLive(false));
    socket.on("connect_error", () => setLive(false));
    socket.on("records:changed", changed);
    const visible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visible);
    const initial = window.setTimeout(() => {
      void load();
      socket.connect();
    }, 0);
    const safety = window.setInterval(visible, 60000);
    return () => {
      disposed = true;
      controller.abort();
      socket.removeAllListeners();
      socket.disconnect();
      window.clearTimeout(initial);
      window.clearInterval(safety);
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  useEffect(() => {
    const stored = localStorage.getItem("hotel-theme");
    const initial = stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const timer = window.setTimeout(() => setDark(initial), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
  if (notice !== 'Checkout confirmed.') return;

  const timer = window.setTimeout(() => {
    setNotice(current =>
      current === 'Checkout confirmed.' ? '' : current
    );
  }, 5000);

  return () => window.clearTimeout(timer);
}, [notice]);
  const toggleTheme = () => {
    setDark(!dark);
    localStorage.setItem("hotel-theme", !dark ? "dark" : "light");
  };
  const open = tickets.filter((t) => t.status !== "Resolved");
  const current = tickets.find((t) => t._id === selected);
  const filtered = tickets.filter(
    (t) =>
      (filter === "All" || t.status === filter) &&
      `${t.guestName} ${t.roomNumber} ${t.requestText} ${t.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const choose = (id: string) => {
    setSelected(id);
    setView("Requests");
  };
  async function changeStatus(status: string) {
    if (!current || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(`${API}/api/tasks/${current._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(data.message || "Could not save the status.");
      setTickets((old) =>
        old.map((t) => (t._id === current._id ? data.data : t)),
      );
      setNotice(
        "Request status saved. Guest notification is not connected yet.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }
  async function confirmCheckout(booking: Booking, retry = false) {
    if (checkoutBusy) return;

    if (
      !retry &&
      !window.confirm(
        `Confirm ${booking.guestName} has departed Room ${booking.roomNumber}?`,
      )
    )
      return;

    setCheckoutBusy(booking._id);
    setNotice("");

    try {
      const response = await fetch(
        `${API}/api/bookings/${booking._id}/checkout`,
        {
          method: "POST",
          signal: AbortSignal.timeout(30000),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Checkout could not be confirmed.");
      }

      if (!data.followUpComplete) {
        setCheckoutRetry(booking);
        setNotice(
          "Checkout saved. Follow-up scheduling needs another attempt.",
        );
      } else {
        setCheckoutRetry(null);
        setNotice("Checkout confirmed.");
      }

      await refresh();
    } catch {
      setCheckoutRetry(booking);
      setNotice(
        "Checkout result could not be confirmed. Check or retry the same stay below; this will not create another review job.",
      );
      await refresh();
    } finally {
      setCheckoutBusy("");
    }
  }
  async function checkIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    if (
      form.telegramChatId.trim() &&
      bookings.some((b) => b.telegramChatId === form.telegramChatId.trim())
    ) {
      setNotice(
        "This Telegram chat already has an active stay. Use the existing booking; another would make room matching ambiguous.",
      );
      return;
    }
    const checkout = new Date(form.checkOutTime);
    if (!Number.isFinite(checkout.getTime()) || checkout <= new Date()) {
      setNotice("Choose a checkout time in the future.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API}/api/bookings/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          telegramChatId: form.telegramChatId.trim() || null,
          checkOutTime: checkout.toISOString(),
          stayPolicy: "TWENTY_FOUR_HOUR",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(
          "Check-in could not finish. Refresh active stays before retrying: a booking may already have been saved.",
        );
      setShowForm(false);
      setNotice(
        "Booking created. Check Telegram for the welcome; delivery history is not connected yet.",
      );
      setForm({
        guestName: "",
        guestPhone: "",
        roomNumber: "",
        checkOutTime: "",
        telegramChatId: "",
      });
      void refresh();
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Check-in failed. Refresh before retrying.",
      );
    } finally {
      setSaving(false);
    }
  }
  const nav = (
    ["Overview", "Conversations", "Requests", "Guest journey"] as View[]
  ).map((item) => (
    <button
      key={item}
      className={view === item ? styles.active : ""}
      onClick={() => {
        setView(item);
        setSelected("");
      }}
      aria-current={view === item ? "page" : undefined}
    >
      <Icon name={item} />
      <span>{item}</span>
    </button>
  ));
  return (
    <div className={styles.app} data-theme={dark ? "dark" : "light"}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logo}>W</div>
          <div>
            <strong>Willows Nest</strong>
            <small>GUEST OPERATIONS</small>
          </div>
        </div>
        <nav aria-label="Main navigation">{nav}</nav>
        <div className={styles.sideFoot}>
          <span className={styles.badge}>Demo workspace</span>
          <p>One place for every guest request.</p>
          <small>Standalone · Telegram testing</small>
        </div>
      </aside>
      <div className={styles.body}>
        <header className={styles.header}>
          <div className={styles.mobileBrand}>Willows Nest</div>
          <div className={styles.breadcrumb}>
            Workspace <span>/</span> {view}
          </div>
          <div className={styles.headerActions}>
            <span className={styles.connection}>
              {!connected
                ? "Backend disconnected"
                : live
                  ? "Live connected"
                  : "Live reconnecting"}
            </span>
            <button
              className={styles.iconButton}
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            <div className={styles.avatar} aria-label="Demo staff">
              WN
            </div>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.titleRow}>
            <div>
              <span className={styles.eyebrow}>
                THE WILLOWS NEST HOTEL · DEMO
              </span>
              <h1>
                {view === "Conversations"
                  ? "Every guest. One conversation."
                  : view === "Overview"
                    ? "Your service, at a glance."
                    : view === "Requests"
                      ? "Every request. One workspace."
                      : "A clear view of every stay."}
              </h1>
              <p>
                {view === "Conversations"
                  ? "Read and reply to each stay’s saved messages. Times shown in Lagos."
                  : view === "Overview"
                    ? "Know what needs attention, and what your team has handled."
                    : view === "Requests"
                      ? "Requests recorded from guest messages, ready for your team."
                      : "Active guest stays and their recorded check-in progress."}
              </p>
            </div>
            <button
              className={styles.primary}
              onClick={() => {
                setNotice("");
                setShowForm(true);
              }}
            >
              + Check in guest
            </button>
          </div>
          <div className={styles.syncRow}>
            <span>
              {updated
                ? `Updated ${updated} · ${live ? "live updates" : "live reconnecting; periodic refresh active"}`
                : "Connecting to your saved records…"}
            </span>
            <button onClick={() => void refresh()} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
          {error && (
            <div className={styles.alert} role="alert">
              {error} Start the backend at {API}. Last loaded data may be out of
              date.
            </div>
          )}
          {notice && (
            <div className={styles.alert} role="status">
              {notice}
            </div>
          )}
          {view === "Overview" && (
            <>
              <section className={styles.metrics} aria-label="Service metrics">
                {[
                  {
                    label: "Active stays",
                    value: bookings.length,
                    note: "Recorded in this system",
                  },
                  {
                    label: "Needs attention",
                    value: open.length,
                    note: "All unresolved requests",
                  },
                  {
                    label: "In progress",
                    value: tickets.filter((t) => t.status === "In Progress")
                      .length,
                    note: "Being handled by staff",
                  },
                  {
                    label: "Resolved",
                    value: tickets.filter((t) => t.status === "Resolved")
                      .length,
                    note: "All recorded requests",
                  },
                ].map((m, i) => (
                  <article className={styles.metric} key={m.label}>
                    <div>
                      <span>{m.label}</span>
                      <span className={styles.metricIcon}>
                        <Icon name={i === 0 ? "Guest journey" : "Requests"} />
                      </span>
                    </div>
                    <strong>{updated ? m.value : "—"}</strong>
                    <small>{m.note}</small>
                  </article>
                ))}
              </section>
              <div className={styles.grid}>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>Department workload</h2>
                      <p>Open requests across your service teams</p>
                    </div>
                    <span className={styles.badge}>All open</span>
                  </div>
                  <div className={styles.bars}>
                    {departments.map((d) => {
                      const count = open.filter((t) => t.category === d).length;
                      const max = Math.max(
                        1,
                        ...departments.map(
                          (x) => open.filter((t) => t.category === x).length,
                        ),
                      );
                      return (
                        <button
                          className={styles.barRow}
                          key={d}
                          onClick={() => {
                            setSearch(d);
                            setView("Requests");
                          }}
                          aria-label={`${d}: ${count} open requests`}
                        >
                          <span>{d}</span>
                          <span className={styles.track}>
                            <span
                              style={{ width: `${(count / max) * 100}%` }}
                            />
                          </span>
                          <strong>{count}</strong>
                        </button>
                      );
                    })}
                  </div>
                  <p className={styles.panelNote}>
                    Select a department to explore its requests.
                  </p>
                </section>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>Needs attention</h2>
                      <p>Unresolved guest requests</p>
                    </div>
                    <button
                      onClick={() => {
                        setFilter("All");
                        setSearch("");
                        setView("Requests");
                      }}
                    >
                      View all <Icon name="arrow" />
                    </button>
                  </div>
                  {open.length ? (
                    open.slice(0, 4).map((t) => (
                      <button
                        className={styles.requestRow}
                        key={t._id}
                        onClick={() => choose(t._id)}
                      >
                        <span className={styles.room}>{t.roomNumber}</span>
                        <span>
                          <strong>Room {t.roomNumber}</strong>
                          <small>{t.requestText}</small>
                        </span>
                        <span className={styles.tag}>{t.status}</span>
                      </button>
                    ))
                  ) : (
                    <div className={styles.empty}>
                      <Icon name="Service inbox" />
                      <h3>No open requests</h3>
                      <p>New service tickets will appear here.</p>
                    </div>
                  )}
                </section>
              </div>
              <div className={styles.grid}>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>Request status</h2>
                      <p>Distribution of recorded tickets</p>
                    </div>
                  </div>
                  <div className={styles.statusChart}>
                    {["Pending", "In Progress", "Resolved", "Escalated"].map(
                      (s) => {
                        const n = tickets.filter((t) => t.status === s).length;
                        return (
                          <div key={s}>
                            <span>{s}</span>
                            <div className={styles.track}>
                              <span
                                style={{
                                  width: `${tickets.length ? (n / tickets.length) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <strong>{n}</strong>
                          </div>
                        );
                      },
                    )}
                  </div>
                </section>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>Automation & insights</h2>
                      <p>Built around your guest journey</p>
                    </div>
                    <span className={styles.badge}>Next phase</span>
                  </div>
                  <div className={styles.insight}>
                    <Icon name="Guest journey" />
                    <div>
                      <h3>Welcome → pulse → checkout → review</h3>
                      <p>
                        Job execution and delivery history are being connected.
                        No scheduled-message counts are shown yet.
                      </p>
                    </div>
                  </div>
                  <div className={styles.insight}>
                    <Icon name="Overview" />
                    <div>
                      <h3>Response times and GM summaries</h3>
                      <p>
                        Available after staff action timestamps and measured
                        activity are recorded.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "Conversations" && (
            <ChatWorkspace
              api={API}
              revision={revision}
              tickets={tickets}
              onTicket={choose}
            />
          )}
          {view === "Requests" && (
            <section className={`${styles.panel} ${styles.inbox}`}>
              <div className={styles.list}>
                <div className={styles.inboxTools}>
                  <label className={styles.searchLabel}>
                    Search requests
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Room, guest, or request…"
                    />
                  </label>
                  <select
                    aria-label="Filter requests by status"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      "All",
                      "Pending",
                      "In Progress",
                      "Resolved",
                      "Escalated",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                {filtered.map((t) => (
                  <button
                    className={`${styles.requestRow} ${selected === t._id ? styles.selectedRow : ""}`}
                    key={t._id}
                    onClick={() => setSelected(t._id)}
                  >
                    <span className={styles.room}>{t.roomNumber}</span>
                    <span>
                      <strong>{t.guestName}</strong>
                      <small>{t.requestText}</small>
                      <small>
                        {t.category} · {t.status}
                      </small>
                    </span>
                  </button>
                ))}
                {!filtered.length && (
                  <div className={styles.empty}>
                    <p>No matching requests.</p>
                  </div>
                )}
              </div>
              <div
                className={`${styles.detail} ${current ? styles.detailOpen : ""}`}
              >
                {current ? (
                  <>
                    <button
                      className={styles.back}
                      onClick={() => setSelected("")}
                    >
                      ← Back to requests
                    </button>
                    <div className={styles.detailHead}>
                      <div>
                        <span className={styles.eyebrow}>
                          {current.category}
                        </span>
                        <h2>Room {current.roomNumber}</h2>
                        <p>{current.guestName}</p>
                      </div>
                      <span className={styles.tag}>{current.status}</span>
                    </div>
                    <div className={styles.messageBubble}>
                      <small>Guest request · {date(current.createdAt)}</small>
                      <p>{current.requestText}</p>
                    </div>
                    <div>
                      {current.guestUpdates?.map((update) => (
                        <div
                          className={styles.messageBubble}
                          key={update.messageId}
                        >
                          <small>
                            Guest follow-up · {date(update.createdAt)} · pending
                            staff review
                          </small>
                          <p>{update.text}</p>
                        </div>
                      ))}
                    </div>
                    <p className={styles.panelNote}>
                      This is the saved ticket text. Full conversation history
                      and staff replies are available in Conversations.
                    </p>
                    <div className={styles.statusActions}>
                      <button
                        disabled={saving || current.status === "In Progress"}
                        className={styles.primary}
                        onClick={() => void changeStatus("In Progress")}
                      >
                        Start handling
                      </button>
                      <button
                        disabled={saving || current.status === "Resolved"}
                        onClick={() => void changeStatus("Resolved")}
                      >
                        Mark resolved
                      </button>
                      <button
                        disabled={saving || current.status === "Escalated"}
                        onClick={() => void changeStatus("Escalated")}
                      >
                        Escalate
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.empty}>
                    <Icon name="Service inbox" />
                    <h3>Select a request</h3>
                    <p>Review the guest’s message and update its status.</p>
                  </div>
                )}
              </div>
            </section>
          )}
          {view === "Guest journey" && (
            <div className={styles.stays}>
              {checkoutRetry && (
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>Check checkout result</h2>
                      <p>
                        {checkoutRetry.guestName} · Room{" "}
                        {checkoutRetry.roomNumber}
                      </p>
                    </div>
                    <button
                      disabled={Boolean(checkoutBusy)}
                      onClick={() => void confirmCheckout(checkoutRetry, true)}
                    >
                      Check / retry
                    </button>
                  </div>
                </section>
              )}

              {bookings.map((booking) => (
                <section className={styles.panel} key={booking._id}>
                  <div className={styles.panelHead}>
                    <div>
                      <span className={styles.eyebrow}>
                        ROOM {booking.roomNumber}
                      </span>
                      <h2>{booking.guestName}</h2>
                      <p>Checkout {date(booking.checkOutTime)} · Lagos time</p>
                      <span className={styles.tag}>
                        {new Date(booking.checkOutTime) <= new Date()
                          ? "Checkout due"
                          : "In house"}
                      </span>
                    </div>
                    <button
                      className={styles.primary}
                      disabled={Boolean(checkoutBusy)}
                      onClick={() => void confirmCheckout(booking)}
                    >
                      {checkoutBusy === booking._id
                        ? "Confirming…"
                        : "Confirm checkout"}
                    </button>
                  </div>
                  <p className={styles.panelNote}>
                    Confirm after departure. Conversation history is retained.
                  </p>
                </section>
              ))}

              {!bookings.length && (
                <section className={styles.panel}>
                  <div className={styles.empty}>
                    <h3>No current stays</h3>
                    <p>Checked-out stays remain in conversation history.</p>
                  </div>
                </section>
              )}
            </div>
          )}
          <footer className={styles.footer}>
            Standalone guest service · Demo hotel details · Counts from saved
            records
          </footer>
        </main>
      </div>
      <nav className={styles.mobileNav} aria-label="Mobile navigation">
        {nav}
      </nav>
      {showForm && (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setShowForm(false);
          }}
        >
          <section
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkin-title"
          >
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>NEW STAY</span>
                <h2 id="checkin-title">Check in a guest</h2>
              </div>
              <button
                disabled={saving}
                onClick={() => setShowForm(false)}
                aria-label="Close check-in"
              >
                ✕
              </button>
            </div>
            <p>
              Record the stay once. The current backend sends the welcome and a
              demo pulse check.
            </p>
            <form onSubmit={checkIn}>
              {[
                { key: "guestName", label: "Guest name", type: "text" },
                { key: "guestPhone", label: "Phone number", type: "tel" },
                { key: "roomNumber", label: "Room number", type: "text" },
                {
                  key: "checkOutTime",
                  label: "Checkout time (your device timezone)",
                  type: "datetime-local",
                },
                {
                  key: "telegramChatId",
                  label: "Linked Telegram chat ID (demo only)",
                  type: "text",
                },
              ].map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input
                    type={f.type}
                    required={f.key !== "telegramChatId"}
                    value={form[f.key as keyof typeof form]}
                    onChange={(e) =>
                      setForm({ ...form, [f.key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <p className={styles.panelNote}>
                Telegram requires the guest to start the bot first. Use only one
                active stay per chat. Leaving the chat ID empty records a stay
                without Telegram messages.
              </p>
              {notice && (
                <div role="status" className={styles.alert}>
                  {notice}
                </div>
              )}
              <button className={styles.primary} disabled={saving}>
                {saving ? "Saving…" : "Check in guest"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
