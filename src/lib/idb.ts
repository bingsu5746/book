// 기기 저장소 (IndexedDB): 책 내용 사본 · 아직 서버에 못 보낸 원고
const DB = 'book-library';
const STORES = ['kv', 'books', 'drafts'] as const;
type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return dbp;
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const idb = {
  async get<T>(store: Store, key: string): Promise<T | undefined> {
    try {
      return await tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
    } catch {
      return undefined;
    }
  },
  async set(store: Store, key: string, value: unknown) {
    try {
      await tx(store, 'readwrite', (s) => s.put(value, key));
    } catch {
      /* 저장 공간 없음 · 비공개 창 */
    }
  },
  async del(store: Store, key: string) {
    try {
      await tx(store, 'readwrite', (s) => s.delete(key));
    } catch {
      /* 무시 */
    }
  },
  async keys(store: Store): Promise<string[]> {
    try {
      return (await tx(store, 'readonly', (s) => s.getAllKeys())).map(String);
    } catch {
      return [];
    }
  },
  async clear() {
    for (const s of STORES)
      try {
        await tx(s, 'readwrite', (x) => x.clear());
      } catch {
        /* 무시 */
      }
  },
};

/** 기기마다 따로 기억하는 작은 설정 (localStorage) */
export const local = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* 무시 */
    }
  },
};
