"use client";
import { apiFetch as fetch } from "./apiClient";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import ChatWorkspace from "./ChatWorkspace";
import GuestFeedback from "./GuestFeedback";
import { useStaffAccess } from "./StaffAccess";
import styles from "./dashboard.module.css";

type Ticket = {
  requiresReceptionReview?: boolean;
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
type View = "Overview" | "Conversations" | "Requests" | "Stays";
const API = "";
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
    Stays: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1",
    logout: "M9 5H4v14h5 M10 12h11 M17 8l4 4-4 4",
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
export default function GuestWorkspace({ embedded = false }: { embedded?: boolean }) {
  const { logout, signingOut, identity } = useStaffAccess();
  const hotelName = identity?.hotelName || 'Kudu Demo';
  const refreshFlight = useRef<Promise<void> | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [requestScope, setRequestScope] = useState("Current");
  const [staySearch, setStaySearch] = useState("");
  const [conversationTarget, setConversationTarget] = useState("");
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<View>("Overview");
  const [dark, setDark] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [filter, setFilter] = useState("Open");
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
    if (refreshFlight.current) return refreshFlight.current;
    const task = (async () => {
      setBusy(true);
      const timeout = AbortSignal.timeout(12000);
      const requestSignal = signal
        ? AbortSignal.any([signal, timeout])
        : timeout;
      try {
        const responses = await Promise.all([
          fetch(`${API}/api/tasks`, {
            signal: requestSignal,
            cache: "no-store",
          }),
          fetch(`${API}/api/bookings/active`, {
            signal: requestSignal,
            cache: "no-store",
          }),
        ]);
        if (responses.some((r) => !r.ok))
          throw new Error("The backend could not load the dashboard.");
        const [tasks, stays] = await Promise.all(
          responses.map((r) => r.json()),
        );
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
        setBusy(false);
      }
    })();
    refreshFlight.current = task;
    try {
      await task;
    } finally {
      if (refreshFlight.current === task) refreshFlight.current = null;
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const socket = io({
      autoConnect: false,
      transports: ["polling"],
      upgrade: false,
      withCredentials: true,
    });
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
    // The head script has already applied the theme before the first paint.
    const timer = window.setTimeout(() => {
      setDark(document.documentElement.dataset.theme === "dark");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (notice !== "Checkout confirmed.") return;

    const timer = window.setTimeout(() => {
      setNotice((current) =>
        current === "Checkout confirmed." ? "" : current,
      );
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem("hotel-checkin-draft");

        if (saved) {
          const value = JSON.parse(saved);

          if (value && typeof value === "object") {
            setForm(
              (current) =>
                Object.fromEntries(
                  Object.keys(current).map((key) => [
                    key,
                    typeof value[key] === "string" ? value[key] : "",
                  ]),
                ) as typeof current,
            );
          }
        }
      } catch {
        // An unavailable or invalid draft must not block check-in.
      }
      try {
        setShowForm(sessionStorage.getItem("hotel-checkin-open") === "true");
        const savedView = sessionStorage.getItem("hotel-workspace-view");
        if (
          ["Overview", "Conversations", "Requests", "Stays"].includes(
            savedView || "",
          )
        ) {
          setView(savedView as View);
        }
      } catch {
        // Storage may be unavailable.
      }
      setDraftReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!draftReady) return;

    try {
      if (showForm) {
        sessionStorage.setItem("hotel-checkin-open", "true");
      } else {
        sessionStorage.removeItem("hotel-checkin-open");
      }
    } catch {
      // Storage may be unavailable.
    }
  }, [showForm, draftReady]);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (Object.values(form).some(Boolean))
        sessionStorage.setItem("hotel-checkin-draft", JSON.stringify(form));
      else sessionStorage.removeItem("hotel-checkin-draft");
    } catch {
      /* Storage can be unavailable on shared browsers. */
    }
  }, [form, draftReady]);
  useEffect(() => {
    if (!draftReady) return;
    // Restore first, then persist: never overwrite the saved tab during hydration.
    try {
      sessionStorage.setItem("hotel-workspace-view", view);
    } catch {
      /* Optional storage. */
    }
  }, [view, draftReady]);
  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    setDark(next);
    try {
      localStorage.setItem("hotel-theme", next ? "dark" : "light");
    } catch {
      /* Theme still works without storage. */
    }
  };
  const currentStayIds = new Set(bookings.map((booking) => booking._id));
  const currentTickets = tickets.filter(
    (ticket) => ticket.bookingId && currentStayIds.has(ticket.bookingId),
  );
  const open = currentTickets.filter((t) => t.status !== "Resolved");
  const scopedTickets =
    requestScope === "Current"
      ? currentTickets
      : tickets.filter(
          (ticket) =>
            !ticket.bookingId || !currentStayIds.has(ticket.bookingId),
        );
  const current = tickets.find((t) => t._id === selected);
  const filtered = scopedTickets.filter(
    (t) =>
      (filter === "All" ||
        (filter === "Open" ? t.status !== "Resolved" : t.status === filter)) &&
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
      // Department work can still use In Progress; review closure has no guest send.
      const review =
        current.requiresReceptionReview ||
        ["Front Desk", "General Inquiry"].includes(current.category);
      const closeReview = review && status === "Resolved";
      const response = await fetch(
        `${API}/api/tasks/${current._id}${closeReview ? "/close-review" : ""}`,
        {
          method: closeReview ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(closeReview ? {} : { status }),
          signal: AbortSignal.timeout(30000),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(data.message || "Could not save the status.");
      setTickets((old) =>
        old.map((t) => (t._id === current._id ? data.data : t)),
      );
      setNotice(data.message || "Request status saved.");
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
        signal: AbortSignal.timeout(30000),
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
      // Stay on a navigable screen while the new booking and chat records refresh.
      setConversationTarget("");
      setView("Stays");
      setShowForm(false);
      setNotice(
        data.automationScheduled
          ? "Guest checked in. Welcome scheduled."
          : "Guest checked in. Messaging needs attention.",
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
    ["Overview", "Conversations", "Requests", "Stays"] as View[]
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
    <div className={`${styles.app} ${embedded ? styles.embedded : ''}`}>
      {embedded && <nav className={styles.sectionNav} aria-label="Guest service sections">{nav}</nav>}
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logo}>K</div>
          <div>
            <strong>{hotelName}</strong>
            <small>GUEST OPERATIONS</small>
          </div>
        </div>
        <nav aria-label="Main navigation">{nav}</nav>
        <div className={styles.sideFoot}>
          <span className={styles.badge}>Guest operations</span>
          <p>One place for every guest request.</p>
          <small>Reception · Guest services</small>
        </div>
      </aside>
      <div className={styles.body}>
        <header className={styles.header}>
          <div className={styles.mobileBrand}>{hotelName}</div>
          <div className={styles.breadcrumb}>
            Workspace <span>/</span> {view}
          </div>
          <div className={styles.headerActions}>
            <span className={styles.connection}>
              {!connected
                ? busy && !updated
                  ? "Connecting"
                  : "Reconnecting"
                : live
                  ? "Connected"
                  : "Live reconnecting"}
            </span>
            <button
              className={styles.iconButton}
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            <button
              className={styles.iconButton}
              disabled={signingOut}
              onClick={() => {
                // Prevent accidental sign-out, especially on mobile.
                if (window.confirm("Sign out of the hotel workspace?")) {
                  void logout();
                }
              }}
              aria-label="Sign out"
            >
              <Icon name="logout" />
              <span className={styles.signOutLabel}>
                {signingOut ? "Signing out…" : "Sign out"}
              </span>
            </button>
            <div className={styles.avatar} aria-label="Hotel workspace">
              {hotelName.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}
            </div>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.titleRow}>
            <div>
              <span className={styles.eyebrow}>{hotelName}</span>
              <h1>
                {view === "Conversations"
                  ? "Conversations"
                  : view === "Overview"
                    ? "Overview"
                    : view === "Requests"
                      ? "Requests"
                      : "Stays"}
              </h1>
              <p>
                {view === "Conversations"
                  ? "Read and reply to each stay’s saved messages. Times shown in Lagos."
                  : view === "Overview"
                    ? "Know what needs attention, and what your team has handled."
                    : view === "Requests"
                      ? "Requests recorded from guest messages, ready for your team."
                      : "Current guests, rooms and checkout times."}
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
                : "Connecting to hotel records…"}
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
                    note: "Current guest requests",
                  },
                  {
                    label: "In progress",
                    value: currentTickets.filter(
                      (t) => t.status === "In Progress",
                    ).length,
                    note: "Being handled by staff",
                  },
                  {
                    label: "Checkout due",
                    value: bookings.filter(
                      (booking) => new Date(booking.checkOutTime) <= new Date(),
                    ).length,
                    note: "Departure needs confirmation",
                  },
                ].map((m, i) => (
                  <article className={styles.metric} key={m.label}>
                    <div>
                      <span>{m.label}</span>
                      <span className={styles.metricIcon}>
                        <Icon name={i === 0 ? "Stays" : "Requests"} />
                      </span>
                    </div>
                    <strong>{updated ? m.value : "—"}</strong>
                    <small>{m.note}</small>
                  </article>
                ))}
              </section>
              <GuestFeedback
                api={API}
                revision={revision}
                onOpen={(id) => {
                  setConversationTarget(id);
                  setView("Conversations");
                }}
              />
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
                        setFilter("Open");
                        setRequestScope("Current");
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
            </>
          )}
          {view === "Conversations" && (
            <ChatWorkspace
              embedded={embedded}
              api={API}
              revision={revision}
              tickets={tickets}
              initialBookingId={conversationTarget}
              initialScope={
                conversationTarget &&
                !bookings.some((booking) => booking._id === conversationTarget)
                  ? "History"
                  : "Current"
              }
            />
          )}
          {view === "Requests" && (
            <section className={`${styles.panel} ${styles.inbox}`}>
              <div className={styles.list}>
                <div className={styles.inboxTools}>
                  <div className={styles.scopeTabs}>
                    {["Current", "History"].map((scope) => (
                      <button
                        key={scope}
                        aria-pressed={requestScope === scope}
                        onClick={() => {
                          setRequestScope(scope);
                          setSelected("");
                        }}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
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
                      "Open",
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
                    <button
                      onClick={() => {
                        if (current.bookingId) {
                          setConversationTarget(current.bookingId);
                          setView("Conversations");
                        }
                      }}
                      disabled={!current.bookingId}
                    >
                      Open conversation
                    </button>
                    <p className={styles.panelNote}>
                      This is the saved ticket text. Full conversation history
                      and staff replies are available in Conversations.
                    </p>
                    <div className={styles.statusActions}>
                      <button
                        disabled={
                          saving ||
                          requestScope === "History" ||
                          current.status === "In Progress"
                        }
                        className={styles.primary}
                        onClick={() => void changeStatus("In Progress")}
                      >
                        Start handling
                      </button>
                      <button
                        disabled={
                          saving ||
                          (requestScope === "History" &&
                            !current.requiresReceptionReview) ||
                          current.status === "Resolved"
                        }
                        onClick={() => void changeStatus("Resolved")}
                      >
                        {current.requiresReceptionReview ||
                        ["Front Desk", "General Inquiry"].includes(
                          current.category,
                        )
                          ? "Close review"
                          : "Complete & notify"}
                      </button>
                      <button
                        disabled={
                          saving ||
                          requestScope === "History" ||
                          current.status === "Escalated"
                        }
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
          {view === "Stays" && (
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
                      onClick={() => void confirmCheckout(checkoutRetry)}
                    >
                      Retry checkout confirmation
                    </button>
                  </div>
                </section>
              )}

              <label className={styles.staySearch}>
                Search room or guest
                <input
                  value={staySearch}
                  onChange={(event) => setStaySearch(event.target.value)}
                  placeholder="Room number or guest name"
                />
              </label>
              {bookings
                .filter((booking) =>
                  `${booking.roomNumber} ${booking.guestName}`
                    .toLowerCase()
                    .includes(staySearch.toLowerCase()),
                )
                .map((booking) => (
                  <section className={styles.panel} key={booking._id}>
                    <div className={styles.panelHead}>
                      <div>
                        <h2>Room {booking.roomNumber}</h2>
                        <p className={styles.guestName}>{booking.guestName}</p>
                        <p>
                          Checkout {date(booking.checkOutTime)} · Lagos time
                        </p>
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
            Guest services · {hotelName}
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
            <p>Record the guest’s room and checkout time.</p>
            <form onSubmit={checkIn}>
              {[
                { key: "roomNumber", label: "Room number", type: "text" },
                { key: "guestName", label: "Guest name", type: "text" },
                { key: "guestPhone", label: "Phone number", type: "tel" },
                {
                  key: "checkOutTime",
                  label: "Checkout time (your device timezone)",
                  type: "datetime-local",
                },
                {
                  key: "telegramChatId",
                  label: "Telegram chat ID (optional)",
                  type: "text",
                },
              ].map((f) => {
                const field = (
                  <label key={f.key}>
                    {f.label}
                    <input
                      type={f.type}
                      required={f.key !== "telegramChatId"}
                      value={form[f.key as keyof typeof form]}
                      onChange={(e) => {
                        const value = e.target.value;
                        setForm((current) => ({ ...current, [f.key]: value }));

                        if (f.key === "checkOutTime") {
                          const checkout = new Date(value);

                          if (
                            Number.isFinite(checkout.getTime()) &&
                            checkout > new Date()
                          ) {
                            setNotice((current) =>
                              current ===
                              "Choose a checkout time in the future."
                                ? ""
                                : current,
                            );
                          }
                        }
                      }}
                    />
                  </label>
                );
                return f.key === "telegramChatId" ? (
                  <details key={f.key} className={styles.demoConnection}>
                    <summary>Guest messaging</summary>
                    {field}
                  </details>
                ) : (
                  field
                );
              })}
              <p className={styles.panelNote}>
                Telegram requires the guest to start the bot first. Use only one
                active stay per chat. Leaving the chat ID empty records a stay
                without Telegram messages.
              </p>
              {notice && (
                <div
                  role="status"
                  className={styles.alert}
                  style={
                    notice === "Choose a checkout time in the future."
                      ? {
                          color: "#991b1b",
                          backgroundColor: "#fef2f2",
                          border: "1px solid #f87171",
                          padding: "12px",
                          borderRadius: "8px",
                        }
                      : undefined
                  }
                >
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
