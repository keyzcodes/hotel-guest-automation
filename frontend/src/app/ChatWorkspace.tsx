"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import styles from "./chat.module.css";
import attentionStyles from "./attention.module.css";
type Message = {
  _id: string;
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  createdAt: string;
  sender?: string;
  deliveryState?: string;
  staffReadAt?: string | null;
};
type Conversation = {
  _id: string;
  guestName: string;
  roomNumber: string;
  stayStatus: string;
  canReply: boolean;
  unreadCount?: number;
  needsReplyCount?: number;
  checkInTime?: string;
  checkOutTime?: string;
  latestMessage?: Message;
  lastActivity: string;
};
type Ticket = {
  requiresReceptionReview?: boolean;
  _id: string;
  bookingId?: string | null;
  category: string;
  requestText: string;
  status: string;
  assignedStaff?: string | null;
  guestUpdates?: { text: string; messageId: string; createdAt: string }[];
};
const clock = (value: string) =>
  new Date(value).toLocaleTimeString("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((value) => value[0])
    .join("")
    .toUpperCase();
export default function ChatWorkspace({
  api,
  revision,
  tickets,
  initialBookingId = "",
  initialScope = "Current",
}: {
  api: string;
  revision: number;
  tickets: Ticket[];
  initialBookingId?: string;
  initialScope?: "Current" | "History";
}) {
  const [taskBusy, setTaskBusy] = useState("");
  const [taskNotice, setTaskNotice] = useState("");
  const [taskOverrides, setTaskOverrides] = useState<{
    source: Ticket[];
    values: Record<string, Ticket>;
  }>({ source: tickets, values: {} });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState(initialBookingId);
  const [scope, setScope] = useState<"Current" | "History">(initialScope);
  const [requestOpen, setRequestOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadedBooking, setLoadedBooking] = useState("");
  const [listLimit, setListLimit] = useState(100);
  const [messageLimit, setMessageLimit] = useState(100);
  const [moreConversations, setMoreConversations] = useState(false);
  const [moreMessages, setMoreMessages] = useState(false);
  const [listError, setListError] = useState("");
  const [chatError, setChatError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef<{
    bookingId: string;
    text: string;
    requestId: string;
  } | null>(null);
  const workspace = useRef<HTMLElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const readFlight = useRef(false);
  const lastScroll = useRef({ bookingId: "", messageId: "" });
  const current = conversations.find((item) => item._id === selected);
  useEffect(() => {
    // Dismiss only confirmed success; keep errors and uncertain delivery visible.
    const success = ["Request completed. Confirmation sent to Telegram.", "Review closed."];
    if (!success.includes(taskNotice)) return;

    const timer = window.setTimeout(() => {
      // Preserve any newer notice that replaced this confirmation.
      setTaskNotice((current) =>
        current === taskNotice
          ? ""
          : current,
      );
    }, 5000);

    // Cancel the timer when the notice changes or the component unmounts.
    return () => window.clearTimeout(timer);
  }, [taskNotice]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      workspace.current?.style.setProperty(
        "--chat-height",
        `${viewport?.height || window.innerHeight}px`,
      );
      workspace.current?.style.setProperty(
        "--chat-top",
        `${viewport?.offsetTop || 0}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${api}/api/conversations?scope=${scope}&limit=${listLimit}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.conversations))
          throw new Error(data.message || "Could not load conversations.");
        setConversations(data.conversations);
        if (
          initialBookingId &&
          data.conversations.some(
            (item: Conversation) =>
              item._id === initialBookingId &&
              !["ACTIVE", "EXTENDED"].includes(item.stayStatus),
          )
        )
          setScope("History");
        setMoreConversations(data.hasMore);
        setListError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(error.message);
      });
    return () => controller.abort();
  }, [api, revision, listLimit, reload, initialBookingId, scope]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetch(
      `${api}/api/conversations/${selected}/messages?limit=${messageLimit}`,
      {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(12000),
        ]),
        cache: "no-store",
      },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.messages))
          throw new Error(data.message || "Could not load messages.");
        setMessages(data.messages);
        setLoadedBooking(selected);
        setMoreMessages(data.hasMore);
        setChatError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setChatError(error.message);
      });
    return () => controller.abort();
  }, [api, selected, revision, messageLimit, reload]);
  useEffect(() => {
    const controller = new AbortController();
    const markRead = async () => {
      if (
        document.hidden ||
        loadedBooking !== selected ||
        !selected ||
        readFlight.current
      )
        return;
      const messageIds = messages
        .filter(
          (message) => message.direction === "INBOUND" && !message.staffReadAt,
        )
        .map((message) => message._id);
      if (!messageIds.length) return;
      readFlight.current = true;
      try {
        const response = await fetch(
          `${api}/api/conversations/${selected}/read`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageIds }),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(12000),
            ]),
          },
        );
        const data = await response.json();
        if (!response.ok || !data.success)
          throw new Error(data.message || "Read status could not be saved.");
        if (!controller.signal.aborted) {
          const readIds = new Set(messageIds);
          setMessages((previous) =>
            previous.map((message) =>
              readIds.has(message._id)
                ? { ...message, staffReadAt: new Date().toISOString() }
                : message,
            ),
          );
          setReload((value) => value + 1);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setChatError(
            error instanceof Error
              ? error.message
              : "Read status could not be saved.",
          );
      } finally {
        readFlight.current = false;
      }
    };
    void markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [api, selected, loadedBooking, messages]);
  useEffect(() => {
    if (loadedBooking !== selected || !thread.current) return;
    const element = thread.current;
    const last = messages[messages.length - 1]?._id || "";
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 180;
    if (
      lastScroll.current.bookingId !== selected ||
      (lastScroll.current.messageId !== last && atBottom)
    )
      element.scrollTop = element.scrollHeight;
    lastScroll.current = { bookingId: selected, messageId: last };
  }, [messages, loadedBooking, selected]);
  function choose(id: string) {
    if (sending || uncertain) {
      setNotice("Finish checking your pending reply before switching guests.");
      return;
    }
    setRequestOpen(true);
    setSelected(id);
    setMessageLimit(100);
    setDraft("");
    setNotice("");
    setChatError("");
    pending.current = null;
  }
  async function reply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || sending || !draft.trim()) return;
    const request = pending.current || {
      bookingId: current._id,
      text: draft.trim(),
      requestId: crypto.randomUUID(),
    };
    pending.current = request;
    setSending(true);
    setNotice("");
    try {
      const response = await fetch(
        `${api}/api/conversations/${request.bookingId}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: request.text,
            requestId: request.requestId,
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (response.status >= 400 && response.status < 500) {
          pending.current = null;
          setUncertain(false);
        } else setUncertain(true);
        throw new Error(data.message || "Reply could not be confirmed.");
      }
      if (data.message.deliveryState === "SENT") {
        setDraft("");
        pending.current = null;
        setUncertain(false);
        setNotice("Sent to Telegram. Guest read status is unavailable.");
      } else {
        setUncertain(true);
        setNotice(
          "Delivery is pending or unconfirmed. Check Telegram. Checking status will not send another copy.",
        );
      }
      setReload((value) => value + 1);
    } catch (error) {
      if (pending.current) setUncertain(true);
      setNotice(
        error instanceof Error
          ? error.message
          : "Connection interrupted. Check reply status before sending again.",
      );
    } finally {
      setSending(false);
    }
  }
  async function updateTicket(
    ticket: Ticket,
    change: { status?: string; assignedStaff?: string },
  ) {
    if (taskBusy) return;
    setTaskBusy(ticket._id);
    setTaskNotice("");
    try {
      // Closing a review is a separate action: it never sends service completion.
      const review = ticket.requiresReceptionReview || ['Front Desk', 'General Inquiry'].includes(ticket.category);
      const closeReview = review && change.status === 'Resolved';
      const response = await fetch(`${api}/api/tasks/${ticket._id}${closeReview ? '/close-review' : ''}`, {
        method: closeReview ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(closeReview ? {} : change),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(data.message || "Could not update request.");
      setTaskOverrides((previous) => ({
        source: tickets,
        values: {
          ...(previous.source === tickets ? previous.values : {}),
          [ticket._id]: data.data,
        },
      }));
      setTaskNotice(data.message || "Request completed.");
    } catch (error) {
      setTaskNotice(
        error instanceof Error
          ? `${error.message} Refresh to check the saved status before retrying.`
          : "Update unconfirmed. Refresh to check the saved status.",
      );
    } finally {
      setTaskBusy("");
    }
  }
  const visible = conversations.filter(
    (item) =>
      item.stayStatus !== "CANCELLED" &&
      (scope === "Current"
        ? ["ACTIVE", "EXTENDED"].includes(item.stayStatus)
        : !["ACTIVE", "EXTENDED"].includes(item.stayStatus)) &&
      `${item.guestName} ${item.roomNumber}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const activeTickets = tickets
    .map(
      (item) =>
        (taskOverrides.source === tickets
          ? taskOverrides.values[item._id]
          : null) || item,
    )
    .filter(
      (item) => item.bookingId === selected && item.status !== "Resolved",
    );
  return (
    <section
      ref={workspace}
      className={`${styles.workspace} ${selected ? styles.open : ""}`}
      aria-label="Guest conversations"
    >
      <div className={styles.list}>
        <div className={styles.listHead}>
          <h2>Chats</h2>
          <div className={styles.scopeTabs}>
            {(["Current", "History"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={scope === value}
                onClick={() => {
                  if (sending || uncertain) return;
                  setScope(value);
                  setListLimit(100);
                  choose("");
                }}
              >
                {value}
              </button>
            ))}
          </div>
          <input
            aria-label="Search conversations by guest or room"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search guest or room…"
          />
        </div>
        {listError && (
          <div role="alert" className={styles.notice}>
            {listError}{" "}
            <button onClick={() => setReload((value) => value + 1)}>
              Retry
            </button>
          </div>
        )}
        <div className={styles.rows}>
          {visible.map((item) => (
            <button
              className={`${styles.row} ${selected === item._id ? styles.selected : ""}`}
              key={item._id}
              onClick={() => choose(item._id)}
              aria-pressed={selected === item._id}
            >
              <span className={styles.avatar}>{initials(item.guestName)}</span>
              <span className={styles.rowText}>
                <strong>Room {item.roomNumber}</strong>
                <span>
                  {item.guestName} ·{" "}
                  {["ACTIVE", "EXTENDED"].includes(item.stayStatus)
                    ? "Active stay"
                    : item.stayStatus.toLowerCase()}
                </span>
                <small>
                  {item.latestMessage?.text || "No saved messages yet"}
                </small>
                {Boolean(item.needsReplyCount) && (
                  <small className={attentionStyles.needsReply}>
                    Needs reply
                  </small>
                )}
                {tickets.some(
                  (ticket) =>
                    ticket.bookingId === item._id &&
                    ticket.status !== "Resolved",
                ) && (
                  <small className={styles.attention}>
                    Open requests ·{" "}
                    {
                      tickets.filter(
                        (ticket) =>
                          ticket.bookingId === item._id &&
                          ticket.status !== "Resolved",
                      ).length
                    }
                  </small>
                )}
              </span>
              <span className={attentionStyles.rowMeta}>
                {Boolean(item.unreadCount) && (
                  <span
                    className={attentionStyles.unread}
                    aria-label={`${item.unreadCount} unread guest messages`}
                  >
                    {item.unreadCount}
                  </span>
                )}
                <time
                  dateTime={item.lastActivity}
                  title={day(item.lastActivity)}
                >
                  {day(item.lastActivity) === day(new Date().toISOString())
                    ? clock(item.lastActivity)
                    : day(item.lastActivity)}
                </time>
              </span>
            </button>
          ))}
          {!visible.length && (
            <p className={styles.empty}>No matching conversations.</p>
          )}
        </div>
        {moreConversations && (
          <button
            onClick={() => setListLimit((value) => Math.min(500, value + 100))}
            disabled={listLimit >= 500}
          >
            {listLimit >= 500 ? "Showing latest 500 stays" : "Load more stays"}
          </button>
        )}
      </div>
      <div className={styles.chat}>
        {current ? (
          <>
            <header className={styles.chatHead}>
              <button
                className={styles.back}
                onClick={() => choose("")}
                aria-label="Back to conversations"
              >
                ←
              </button>
              <span className={styles.avatar}>
                {initials(current.guestName)}
              </span>
              <div>
                <h2>
                  Room {current.roomNumber} · {current.guestName}
                </h2>
                <p>
                  {["ACTIVE", "EXTENDED"].includes(current.stayStatus)
                    ? "Active stay"
                    : "Historical stay"}
                  {Boolean(current.needsReplyCount) && (
                    <span className={attentionStyles.headerFlag}>
                      {" "}
                      · Needs reply
                    </span>
                  )}
                </p>
              </div>
              {activeTickets.length > 0 && (
                <button
                  onClick={() => setRequestOpen((value) => !value)}
                  aria-expanded={requestOpen}
                >
                  Requests · {activeTickets.length}
                </button>
              )}
            </header>
            <div
              className={styles.thread}
              ref={thread}
              role="log"
              aria-label={`Conversation with ${current.guestName}`}
            >
              {chatError && (
                <div role="alert" className={styles.notice}>
                  {chatError}{" "}
                  <button onClick={() => setReload((value) => value + 1)}>
                    Retry
                  </button>
                </div>
              )}
              {loadedBooking !== selected ? (
                <p className={styles.empty}>Loading conversation…</p>
              ) : (
                <>
                  {moreMessages && (
                    <button
                      className={styles.older}
                      onClick={() =>
                        setMessageLimit((value) => Math.min(500, value + 100))
                      }
                      disabled={messageLimit >= 500}
                    >
                      {messageLimit >= 500
                        ? "Showing latest 500 messages"
                        : "Load older messages"}
                    </button>
                  )}
                  {!messages.length && (
                    <p className={styles.empty}>
                      No saved messages for this stay yet.
                    </p>
                  )}
                  {messages.map((message, index) => (
                    <Fragment key={message._id}>
                      {(index === 0 ||
                        day(messages[index - 1].createdAt) !==
                          day(message.createdAt)) && (
                        <div className={styles.date}>
                          <span>
                            {day(message.createdAt) ===
                            day(new Date().toISOString())
                              ? "Today"
                              : day(message.createdAt)}
                          </span>
                        </div>
                      )}
                      <article
                        className={`${styles.bubble} ${message.direction === "OUTBOUND" ? styles.outbound : styles.inbound}`}
                      >
                        <p>{message.text}</p>
                        <div className={styles.messageMeta}>
                          <time
                            dateTime={message.createdAt}
                            title={`${day(message.createdAt)} · Lagos time`}
                          >
                            {clock(message.createdAt)}
                          </time>
                          {message.direction === "OUTBOUND" &&
                            message.sender === "STAFF" && (
                              <span>
                                {message.deliveryState === "SENT"
                                  ? "Sent to Telegram"
                                  : message.deliveryState === "PENDING"
                                    ? "Pending send confirmation"
                                    : "Delivery unconfirmed"}
                              </span>
                            )}
                        </div>
                      </article>
                    </Fragment>
                  ))}
                </>
              )}
            </div>
            {current.canReply && activeTickets.length > 0 && requestOpen && (
              <section className={styles.requests}>
                {taskNotice && (
                  <p role="status" className={styles.notice}>
                    {taskNotice}
                  </p>
                )}
                <div>
                  {activeTickets.map((ticket) => (
                    <article className={styles.taskCard} key={ticket._id}>
                      <strong>
                        {ticket.category} · {ticket.status}
                      </strong>
                      <p>{ticket.requestText}</p>
                      {ticket.guestUpdates?.map((update) => (
                        <p key={update.messageId}>
                          Guest update · {day(update.createdAt)}{" "}
                          {clock(update.createdAt)}: {update.text}
                        </p>
                      ))}
                      {/* One action per request; reply-needed tracking remains separate. */}
                      <div className={styles.taskActions}>
                        <button
                          disabled={Boolean(taskBusy)}
                          onClick={() => void updateTicket(ticket, { status: "Resolved" })}
                        >
                          {taskBusy === ticket._id ? "Saving…" :
                            ticket.requiresReceptionReview || ['Front Desk', 'General Inquiry'].includes(ticket.category)
                              ? "Close review" : "Complete & notify"}
                        </button>
                      </div>
                    </article>
                  ))}
                  {!activeTickets.length && (
                    <p>No open requests for this stay.</p>
                  )}
                </div>
              </section>
            )}
            <div className={styles.composeArea}>
              {notice && (
                <div className={styles.notice} role="status">
                  {notice}
                </div>
              )}
              {current.canReply || uncertain ? (
                <form className={styles.composer} onSubmit={reply}>
                  <textarea
                    aria-label={`Reply to ${current.guestName}`}
                    placeholder={`Reply to ${current.guestName.split(" ")[0]}…`}
                    value={draft}
                    maxLength={3000}
                    rows={1}
                    disabled={sending || uncertain || !current.canReply}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing &&
                        !sending &&
                        !uncertain
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={
                      sending ||
                      !draft.trim() ||
                      (!current.canReply && !uncertain)
                    }
                    aria-label={
                      uncertain ? "Check pending reply status" : "Send reply"
                    }
                  >
                    {sending ? "Sending…" : uncertain ? "Check status" : "Send"}
                  </button>
                </form>
              ) : null}
            </div>
          </>
        ) : (
          <div className={styles.welcome}>
            <span className={styles.welcomeIcon}>✉</span>
            <h2>Your guest conversations</h2>
            <p>Select a guest to read their messages and reply.</p>
            <small>
              Messages belong to a stay, even when a room is reused.
            </small>
          </div>
        )}
      </div>
    </section>
  );
}
