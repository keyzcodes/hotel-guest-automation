// Immutable creation payloads only. Corrections and voids require a live connection.
export type QueuedBody = {
  requestId: string; type: 'SALE' | 'EXPENSE'; businessDate: string;
  departmentId: string; categoryId: string | null; amount: string; note: string;
};
export type QueueItem = {
  id: string; owner: string; body: QueuedBody; createdAt: string;
  status: 'waiting' | 'review' | 'saved'; message: string;
};
export type QueueStore = {
  list(owner: string): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  remove(id: string): Promise<void>;
};
export function entryProblem(body: QueuedBody, config: { departments: { id: string; sales: boolean; categories: string[] }[] }, today: string) {
  const date = new Date(body.businessDate + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.businessDate || body.businessDate < '2000-01-01' || body.businessDate > today)
    return 'Choose today or a valid past date.';
  if (!['SALE', 'EXPENSE'].includes(body.type)) return 'Choose Daily sales or Expense.';
  const dept = config.departments.find(row => row.id === body.departmentId);
  if (!dept || (body.type === 'SALE' && !dept.sales)) return 'Choose a valid department.';
  if (body.type === 'EXPENSE' && !dept.categories.includes(body.categoryId || '')) return 'Choose an expense category.';
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(body.amount)) return 'Enter a valid amount with up to two decimal places.';
  const [whole, part = ''] = body.amount.split('.');
  const kobo = BigInt(whole) * BigInt(100) + BigInt(part.padEnd(2, '0'));
  if (kobo > BigInt(1_000_000_000_000) || (body.type === 'EXPENSE' && kobo === BigInt(0))) return 'Enter an amount within the allowed range. Expenses must be greater than zero.';
  if (body.note.length > 500) return 'Keep the note within 500 characters.';
  return '';
}
export async function enqueue(store: QueueStore, owner: string, body: QueuedBody) {
  if (!owner) throw Error('Sign in before saving an entry.');
  const rows = await store.list(owner);
  const previous = rows.find(row => row.id === body.requestId);
  if (previous) {
    if (JSON.stringify(previous.body) !== JSON.stringify(body)) throw Error('This save is already queued with different values. Review the original entry.');
    return previous;
  }
  if (rows.filter(row => row.status !== 'saved').length >= 100) throw Error('Sync or review your pending entries before adding more.');
  if (body.type === 'SALE' && rows.some(row => row.status === 'waiting' && row.body.type === 'SALE' && row.body.businessDate === body.businessDate && row.body.departmentId === body.departmentId))
    throw Error('A daily sales total for this department and date is already waiting to sync.');
  const item: QueueItem = { id: body.requestId, owner, body: structuredClone(body), status: 'waiting', message: '', createdAt: new Date().toISOString() };
  await store.put(item); // Resolve only after the durable transaction commits.
  return item;
}
export async function syncQueue(
  store: QueueStore, owner: string,
  send: (item: QueueItem) => Promise<{ status: number; message?: string; confirmed?: boolean }>,
  active: () => boolean = () => true,
  changed: () => void = () => {},
) {
  for (const item of await store.list(owner)) {
    if (!active()) return;
    if (item.owner !== owner || item.status !== 'waiting') continue;
    let result;
    try { result = await send(item); } catch { return; } // Uncertain: keep identical ID and payload.
    if (result.status === 401 || result.status === 403 || (result.status === 409 && result.message === 'IDENTITY_CHANGED')) return;
    if (result.status >= 500 || result.status === 429 || result.status === 408) return;
    if (result.status >= 200 && result.status < 300 && result.confirmed) {
      await store.put({ ...item, status: 'saved', message: 'Saved' });
    } else if (result.status >= 400 && result.status < 500) {
      await store.put({ ...item, status: 'review', message: result.message || 'This entry was not accepted. Review it before continuing.' });
    } else return;
    changed();
  }
}
