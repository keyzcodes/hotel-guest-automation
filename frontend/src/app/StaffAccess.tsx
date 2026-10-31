"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import styles from "./staff-access.module.css";
export type StaffIdentity = { id?: string; email: string; name?: string; role?: 'GM' | 'STAFF'; hotelName?: string; modules?: { salesExpenses?: boolean }; guestMessagingEnabled?: boolean };
const AccessContext = createContext<{ logout: () => Promise<void>; signingOut: boolean; identity: StaffIdentity | null }>({ logout: async () => {}, signingOut: false, identity: null });
export const useStaffAccess = () => useContext(AccessContext);
function clearStaffDrafts() {
  try {
    // A shared workstation must not expose the previous session's guest drafts.
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("hotel-")) sessionStorage.removeItem(key);
  } catch { /* Browser storage can be disabled. */ }
}
export default function StaffAccess({ children }: { children: React.ReactNode }) {
  const checking = useRef(false);
  const authRevision = useRef(0);
  const [state, setState] = useState<"checking" | "signedOut" | "signedIn" | "unavailable">("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [identity, setIdentity] = useState<StaffIdentity | null>(null);
  const [hotelName, setHotelName] = useState('Hotel');
  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    const revision = authRevision.current;
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(12000) });
      if (revision !== authRevision.current) return;
      if (response.ok) {
        const data = await response.json();
        if (revision !== authRevision.current) return;
        setIdentity(data); setState("signedIn"); setError("");
      }
      else if (response.status === 401) { clearStaffDrafts(); setState("signedOut"); }
      else setState(current => current === "signedIn" ? current : "unavailable");
    } catch { if (revision === authRevision.current) setState(current => current === "signedIn" ? current : "unavailable"); }
    finally { checking.current = false; }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/branding', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      .then(async response => { if (response.ok) { const data = await response.json(); if (!controller.signal.aborted && typeof data.hotelName === 'string') { setHotelName(data.hotelName); document.title = `${data.hotelName} | Hotel operations`; } } })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const expired = () => { authRevision.current++; clearStaffDrafts(); setIdentity(null); setState("signedOut"); setPassword(""); setError("Your session has ended. Please sign in again."); };
    const focus = () => { void check(); };
    window.addEventListener("hotel-session-expired", expired);
    window.addEventListener("focus", focus);
    const initial = window.setTimeout(() => { void check(); }, 0);
    const timer = window.setInterval(() => { void check(); }, 60000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("hotel-session-expired", expired); window.removeEventListener("focus", focus); };
  }, [check]);
  const logout = async () => {
    authRevision.current++;
    setSigningOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Error("Sign-out could not be confirmed. Please try again.");
      clearStaffDrafts(); setIdentity(null); setState("signedOut"); setPassword(""); setError("");
    } catch (e) { window.alert(e instanceof Error ? e.message : "Sign-out failed. Please try again."); }
    finally { setSigningOut(false); }
  };
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    authRevision.current++;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.success) throw Error(data.message || "Sign-in could not finish.");
      setIdentity(data); setPassword(""); setVisible(false); setState("signedIn");
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in is temporarily unavailable."); }
    finally { setBusy(false); }
  }
  if (state === "signedIn") return <AccessContext.Provider value={{ logout, signingOut, identity }}>{children}</AccessContext.Provider>;
  return <main className={styles.screen}>
    <header className={styles.header}><div className={styles.brand}><span className={styles.logo}>{hotelName[0]}</span><span>{hotelName}<small>STAFF ACCESS</small></span></div></header>
    <div className={styles.content}>
      <div className={styles.identity}><h1>{hotelName}</h1></div>
      <section className={styles.card} aria-label="Hotel staff sign-in">
        {state === "checking" ? <p role="status">Checking your session…</p> : state === "unavailable" ? <><h2>Unable to connect</h2><p>Staff access is temporarily unavailable.</p><button className={styles.primary} onClick={() => { setState("checking"); void check(); }}>Try again</button></> : <>
          <h2>Welcome back</h2><p>Sign in to continue.</p>
          <form onSubmit={login}>
            <label>Email address<input type="email" autoComplete="username" value={email} maxLength={254} required onChange={e => { setEmail(e.target.value); setError(""); }} /></label>
            <label>Password<span className={styles.password}><input type={visible ? "text" : "password"} autoComplete="current-password" value={password} maxLength={128} required onChange={e => { setPassword(e.target.value); setError(""); }} /><button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</button></span></label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button className={styles.primary} disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
          </form><p className={styles.help}>Need access? Contact your hotel administrator.</p>
        </>}
      </section>
    </div>
    <footer className={styles.footer}>{hotelName}</footer>
  </main>;
}
