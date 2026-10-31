import type { QueueItem, QueueStore } from './offlineQueue';
const DB = 'hotel-finance-pending-v1';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('entries', { keyPath: 'id' });
      store.createIndex('owner', 'owner');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error('Device storage is unavailable. Your entry has not been queued.'));
    request.onblocked = () => reject(Error('Close other hotel tabs and try saving again.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entries', mode);
    const request = run(tx.objectStore('entries'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(Error('Device storage failed. Keep the form open and try again.')); };
  });
}
export const queueStore: QueueStore = {
  async list(owner) {
    const rows = await transaction<QueueItem[]>('readonly', store => store.index('owner').getAll(owner));
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async put(item) { await transaction('readwrite', store => store.put(item)); },
  async remove(id) { await transaction('readwrite', store => store.delete(id)); },
};
