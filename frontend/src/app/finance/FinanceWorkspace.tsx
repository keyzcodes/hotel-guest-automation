'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStaffAccess } from '../StaffAccess';
import { ApiError, Entry, FinanceConfig, Summary, message, money, request, today } from './client';
import EntryForm from './EntryForm';
import WorkspaceDialog from '../WorkspaceDialog';
import styles from '../operations.module.css';
import { parseReportPosition } from '../workspacePosition';
import { loadFinanceView } from './loadFinanceView';

function remaining(row: Summary['departments'][number]) {
  return row.supportsSales && row.salesStatus === 'NOT_ENTERED' ? '—' : money((row.salesKobo ?? 0) - row.expensesKobo);
}

export default function FinanceWorkspace({ compact = false, onReports }: { compact?: boolean; onReports?: () => void }) {
  const { identity } = useStaffAccess();
  const [amountsHidden, setAmountsHidden] = useState(false);
  const positionKey = `hotel-report-position:${identity?.id || identity?.email}`;
  const [positionReady, setPositionReady] = useState(compact);
  const [detailTarget, setDetailTarget] = useState('');
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`), [to, setTo] = useState(today()), [department, setDepartment] = useState('');
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; summary: Summary; entries: Entry[]; cursor: string | null } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [mode, setMode] = useState<'summary' | 'entries'>('summary');
  const [editor, setEditor] = useState<Entry | 'new' | null>(null), [detail, setDetail] = useState<Entry | null>(null), [voidReason, setVoidReason] = useState(''), [voiding, setVoiding] = useState(false), [printing, setPrinting] = useState(false), [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [voidAttempt, setVoidAttempt] = useState<{ id: string; mutationId: string; expectedVersion: number; reason: string } | null>(null);
  const voidFlight = useRef(false);
  const query = new URLSearchParams({ from, to, ...(department ? { departmentId: department } : {}) }).toString();
  const activeQuery = useRef(query);
  const detailFlight = useRef(0);
  useEffect(() => { activeQuery.current = query; }, [query]);
  const openDetail = useCallback(async (id: string) => {
    const revision = ++detailFlight.current;
    setDetailTarget(id); setError('');
    try { const response = await request<{ data: Entry }>(`/api/finance/entries/${id}`); if (revision === detailFlight.current) { setDetail(response.data); setVoidReason(''); setVoidAttempt(null); } }
    catch (e) { if (revision === detailFlight.current) setError(message(e)); }
  }, []);
  useEffect(() => {
    if (compact) return;
    const timer = window.setTimeout(() => {
      let saved = {} as ReturnType<typeof parseReportPosition>;
      try { saved = parseReportPosition(sessionStorage.getItem(positionKey)); } catch { /* Storage may be unavailable. */ }
      if (saved.from) setFrom(saved.from);
      if (saved.to) setTo(saved.to);
      if (saved.department !== undefined) setDepartment(saved.department);
      if (saved.mode) setMode(saved.mode);
      if (saved.detailId) void openDetail(saved.detailId);
      setPositionReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [compact, positionKey, openDetail]);
  useEffect(() => {
    if (compact || !positionReady) return;
    try { sessionStorage.setItem(positionKey, JSON.stringify({ from, to, department, mode, detailId: detailTarget })); }
    catch { /* Optional preferences must not block saved-record access. */ }
  }, [compact, positionReady, positionKey, from, to, department, mode, detailTarget]);
  const refresh = useCallback(async (signal: AbortSignal) => {
    setBusy(true);
    try {
      const result = await loadFinanceView(request, query, compact, mode, signal);
      if (!signal.aborted) { if (result.settings) setConfig(result.settings); setLoaded({ key: query, summary: result.summary, entries: result.entries, cursor: result.cursor }); setError(''); }
    } catch (e) { if (!signal.aborted) setError(message(e)); }
    finally { if (!signal.aborted) setBusy(false); }
  }, [query, compact, mode]);
  useEffect(() => {
    if (!positionReady) return;
    const controller = new AbortController();
    const load = () => void refresh(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
    const timer = window.setTimeout(load, 0);
    // Explicit refresh and returning to a visible tab update saved records.
    const visible = () => { if (!document.hidden) setReload(value => value + 1); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh, reload, positionReady]);
  useEffect(() => {
    if (compact) return;
    const timer = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(`hotel-finance-open:${identity?.id}`);
        if (saved === 'new') setEditor('new');
        else if (saved && /^[a-f\d]{24}$/i.test(saved)) {
          void request<{ data: Entry }>(`/api/finance/entries/${saved}`)
            .then(response => setEditor(response.data)).catch(() => setError('The draft entry could not be reopened. Your local draft is retained.'));
        }
      } catch { /* Optional browser storage. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [compact, identity?.id]);
  const data = loaded?.key === query ? loaded : null;
  const name = (id: string) => config?.departments.find(row => row.id === id)?.name || id;
  function openEditor(entry: Entry | 'new') {
    setEditor(entry); closeDetail();
    try { sessionStorage.setItem(`hotel-finance-open:${identity?.id}`, entry === 'new' ? 'new' : entry.id); } catch { /* Optional storage. */ }
  }
  function closeEditor() {
    setEditor(null);
    try { sessionStorage.removeItem(`hotel-finance-open:${identity?.id}`); } catch { /* Optional storage. */ }
  }
  function closeDetail() { detailFlight.current++; setDetail(null); setDetailTarget(''); }
  async function voidEntry() {
    if (!detail || voidFlight.current) return;
    if (!voidAttempt && !voidReason.trim()) return;
    if (!voidAttempt && !window.confirm('Void this entry? It will remain in history and be excluded from totals.')) return;
    const attempt = voidAttempt || { id: detail.id, mutationId: crypto.randomUUID(), expectedVersion: detail.version, reason: voidReason.trim() };
    setVoidAttempt(attempt); voidFlight.current = true; setVoiding(true); setError('');
    try {
      await request(`/api/finance/entries/${attempt.id}/void`, { method: 'POST', body: JSON.stringify({ mutationId: attempt.mutationId, expectedVersion: attempt.expectedVersion, reason: attempt.reason }) });
      setVoidAttempt(null); closeDetail(); setNotice('Entry voided. History retained.'); setReload(value => value + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) setVoidAttempt(null);
      setError(message(e));
    } finally { voidFlight.current = false; setVoiding(false); }
  }
  async function more() {
    if (!data?.cursor || loadingMore) return;
    const key = query; setLoadingMore(true);
    try {
      const next = await request<{ data: Entry[]; nextCursor: string | null }>(`/api/finance/entries?${key}&includeVoided=true&after=${data.cursor}`);
      setLoaded(current => current?.key === key ? { ...current, entries: [...current.entries, ...next.data.filter(row => !current.entries.some(saved => saved.id === row.id))], cursor: next.nextCursor } : current);
    } catch (e) { if (activeQuery.current === key) setError(message(e)); }
    finally { setLoadingMore(false); }
  }
  async function print() {
    if (!data || printing || error || busy) return;
    const reportWindow = window.open('', '_blank');
    if (!reportWindow) { setError('Allow the report window to open, then try again.'); return; }
    reportWindow.opener = null; reportWindow.document.body.textContent = 'Preparing the complete selected report…'; setPrinting(true);
    const esc = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    try {
      // Fetch a fresh full summary, or ALL detail pages; never print a partial UI page.
      const summary = (await request<{ data: Summary }>(`/api/finance/summary?${query}`)).data;
      let rows = '';
      let heading = '';
      if (mode === 'summary') {
        heading = '<th>Department</th><th>Sales</th><th>Expenses</th><th>Money left</th>';
        rows = summary.departments.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.salesStatus === 'NOT_ENTERED' ? 'Not entered' : money(row.salesKobo))}</td><td>${esc(money(row.expensesKobo))}</td><td>${esc(remaining(row))}</td></tr>`).join('');
      } else {
        const entries: Entry[] = []; let cursor: string | null = null;
        const deadline = Date.now() + 60000;
        do {
          if (Date.now() > deadline || entries.length >= 10000) throw Error('This detailed report is too large to prepare now. Choose a smaller date range. Nothing has been printed.');
          const page: { data: Entry[]; nextCursor: string | null } = await request(`/api/finance/entries?${query}&includeVoided=true&limit=100${cursor ? `&after=${cursor}` : ''}`);
          entries.push(...page.data); cursor = page.nextCursor;
        } while (cursor);
        heading = '<th>Date</th><th>Department</th><th>Type</th><th>Amount</th><th>State / note</th>';
        rows = entries.map(row => `<tr><td>${esc(row.businessDate)}</td><td>${esc(name(row.departmentId))}</td><td>${row.type === 'SALE' ? 'Sales' : 'Expense'}</td><td>${esc(money(row.amountKobo))}</td><td>${row.state === 'VOID' ? 'Cancelled — not counted' : 'Saved'} ${esc(row.note)}</td></tr>`).join('');
      }
      reportWindow.document.write(`<!doctype html><html><head><title>Hotel report</title><style>body{font:12px Arial;color:#111;margin:30px}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:9px;border:1px solid #bbb;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid #bbb;padding:18px 0;break-inside:avoid}.totals>div{padding:0 18px}.totals>div+div{border-left:1px solid #ddd}.totals span{display:block;color:#555}.totals strong{display:block;font-size:18px;margin-top:8px;white-space:nowrap}.muted{color:#555;font-size:11px}.sign{margin-top:48px;display:flex;gap:28px;justify-content:space-between;break-inside:avoid}@media print{button{display:none}@page{margin:15mm}}</style></head><body><h1>${esc(identity?.hotelName || 'Hotel')}</h1><h2>${mode === 'summary' ? 'Department summary' : 'Daily entries'}</h2><p>${esc(from)} to ${esc(to)} · Lagos time · ${esc(department ? name(department) : 'All departments')}</p><p>Generated ${esc(new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }))} · Prepared by ${esc(identity?.name || identity?.email)}</p>${summary.incompleteSales ? '<p class=muted>Some sales not entered</p>' : ''}<table><thead><tr>${heading}</tr></thead><tbody>${rows || '<tr><td>No entries recorded.</td></tr>'}</tbody></table><div class="totals"><div><span>Sales</span><strong>${esc(money(summary.totals.salesKobo))}</strong></div><div><span>Expenses</span><strong>${esc(money(summary.totals.expensesKobo))}</strong></div><div><span>Money left</span><strong>${esc(money(summary.totals.salesKobo - summary.totals.expensesKobo))}</strong></div></div><div class="sign"><span>Prepared / signed: __________________</span><span>Checked / date: __________________</span></div><p><button onclick="window.print()">Print / Save PDF</button></p></body></html>`);
      reportWindow.document.close(); reportWindow.focus(); reportWindow.print();
    } catch (e) { reportWindow.close(); setError(message(e)); }
    finally { setPrinting(false); }
  }
  const eye = <button type="button" className={styles.amountEye} aria-label={amountsHidden ? 'Show totals' : 'Hide totals'} aria-pressed={amountsHidden} onClick={() => setAmountsHidden(value => !value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{amountsHidden && <path d="m3 3 18 18" />}</svg></button>;
  const totals = <div className={`${styles.totals} ${compact ? styles.overviewTotals : ''}`}>{[
    ['Sales', data?.summary.totals.salesKobo],
    ['Expenses', data?.summary.totals.expensesKobo],
    ['Money left', data ? data.summary.totals.salesKobo - data.summary.totals.expensesKobo : undefined],
  ].map(([label, value]) => <div key={String(label)}><small>{label}</small><strong>{amountsHidden ? <span aria-label="Amount hidden">••••••</span> : money(value as number | undefined)}</strong></div>)}</div>;
  if (compact) return <section className={styles.panel}><div className={styles.heading}><div className={styles.panelTitle}><h2>This month</h2>{eye}</div><button onClick={onReports}>View reports →</button></div>{totals}{error && <p role="status">Financial data unavailable. Last loaded figures may be out of date.</p>}</section>;
  return <section className={styles.reportPage}>
    <div className={styles.heading}><div><h1>Reports</h1></div><button className={styles.primary} onClick={() => openEditor('new')} disabled={!config}>+ Add entry</button></div>
    <div className={styles.filters}><label><span>From</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label><span>To</span><input type="date" value={to} onChange={e => setTo(e.target.value)} /></label><label><span className={styles.srOnly}>Department</span><select value={department} onChange={e => setDepartment(e.target.value)}><option value="">All departments</option>{config?.departments.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
    {error && <p role="alert" className={styles.alert}>{error}{data ? ' Last loaded records remain visible.' : ''}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data ? <p role="status">{error ? 'Records could not be loaded.' : 'Loading records…'}</p> : <>
      <section className={styles.panel}><div className={styles.panelTitle}><h2>Totals</h2>{eye}</div>{totals}{data.summary.incompleteSales && <small>Some sales not entered</small>}</section>
      <div className={`${styles.heading} ${styles.reportToolbar}`}><div className={styles.segment}><button aria-pressed={mode === 'summary'} onClick={() => setMode('summary')}>Summary</button><button aria-pressed={mode === 'entries'} onClick={() => setMode('entries')}>Daily entries</button></div><div className={styles.reportActions}><button aria-label="Refresh report" title="Refresh report" onClick={() => setReload(value => value + 1)} disabled={busy}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></svg>{busy ? 'Refreshing…' : 'Refresh'}</button><button onClick={() => void print()} disabled={printing || busy || !!error}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM16 11h1" /></svg>{printing ? 'Preparing…' : 'Print / PDF'}</button></div></div>
      {mode === 'summary' ? <div className={styles.tableWrap} role="region" aria-label="Department totals" tabIndex={0}><table><thead><tr><th>Department</th><th>Sales</th><th>Expenses</th><th>Money left</th></tr></thead><tbody>{data.summary.departments.map(row => <tr key={row.departmentId}><td><button className={styles.link} onClick={() => { setDepartment(row.departmentId); setMode('entries'); }}>{row.name}</button>{row.supportsSales && row.salesStatus !== 'COMPLETE' && row.salesStatus !== 'NOT_ENTERED' && <small>{row.missingSalesDates.length} days missing</small>}</td><td>{row.salesStatus === 'NOT_ENTERED' ? 'Not entered' : money(row.salesKobo)}</td><td>{money(row.expensesKobo)}</td><td>{remaining(row)}</td></tr>)}</tbody></table></div> : <><div className={styles.entries}>{data.entries.map(row => <button className={styles.entryRow} key={row.id} onClick={() => void openDetail(row.id)}><span><strong>{name(row.departmentId)}</strong><small>{row.businessDate} · {row.type === 'SALE' ? 'Daily sales' : 'Expense'}{row.state === 'VOID' ? ' · Voided' : ''}</small></span><strong>{money(row.amountKobo)}</strong></button>)}</div>{!data.entries.length && <p>No entries recorded for this period.</p>}{data.cursor && <button disabled={loadingMore} onClick={() => void more()}>{loadingMore ? 'Loading…' : 'Load more entries'}</button>}</>}
    </>}
    {editor && config && <EntryForm key={editor === 'new' ? 'new' : editor.id} config={config} entry={editor === 'new' ? undefined : editor} onClose={closeEditor} onSaved={() => { closeEditor(); setNotice('Entry saved.'); setReload(value => value + 1); }} />}
    {detail && <WorkspaceDialog label="Entry details" busy={voiding} onClose={closeDetail}><section className={styles.drawer}><div className={styles.heading}><h2>{name(detail.departmentId)}</h2><button onClick={() => { if (!voiding) closeDetail(); }} disabled={voiding} aria-label="Close entry details">✕</button></div><p>{detail.businessDate} · {detail.type} · {detail.state}</p><strong className={styles.amount}>{money(detail.amountKobo)}</strong><p>{detail.note}</p>{detail.state === 'POSTED' && <><button className={styles.primary} disabled={voiding || !!voidAttempt} onClick={() => openEditor(detail)}>Correct entry</button><label className={styles.voidLabel}>Reason to void<input value={voidReason} maxLength={200} disabled={voiding || !!voidAttempt} onChange={e => setVoidReason(e.target.value)} /></label><button disabled={voiding || (!voidAttempt && !voidReason.trim())} onClick={() => void voidEntry()}>{voiding ? 'Voiding…' : voidAttempt ? 'Retry same void' : 'Void entry'}</button></>}{error && <><p role="alert" className={styles.alert}>{error}</p><button disabled={voiding} onClick={() => void openDetail(detail.id)}>Reload saved entry</button></>}<h3>Correction history</h3>{detail.history?.map((event, i) => <article className={styles.audit} key={i}><strong>{event.action} · {event.actorName}</strong><small>{new Date(event.at).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}</small><p>{event.before ? `${money(event.before.amountKobo)} → ` : ''}{money(event.after.amountKobo)}</p>{event.reason && <p>{event.reason}</p>}</article>)}</section></WorkspaceDialog>}
  </section>;
}
