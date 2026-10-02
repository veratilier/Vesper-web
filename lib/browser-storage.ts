/** Keep existing localStorage intact; spill only failed writes into IndexedDB. */
export interface OverflowStore {
  load(): Promise<[string, string | null][]>;
  put(key: string, value: string | null): Promise<void>;
}

type LocalStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export function createBrowserStorage(local: () => LocalStore, overflow: OverflowStore) {
  // null is a durable tombstone: an older localStorage value must not reappear.
  const shadow = new Map<string, string | null>();
  const dirty = new Set<string>();
  const listeners = new Set<() => void>();
  let initialization: Promise<void> | undefined;
  let queue = Promise.resolve();
  let pending = 0;
  let loadFailed = false;
  const notify = () => listeners.forEach(listener => listener());
  const status = () => loadFailed || dirty.size ? "unavailable" : pending ? "saving" : "ready";
  const persist = (key: string, value: string | null) => {
    shadow.set(key, value);
    pending++;
    notify();
    queue = queue.then(async () => {
      try {
        await overflow.put(key, value);
        dirty.delete(key);
      } catch {
        // Keep the value in memory and show a warning; never clear other keys.
        dirty.add(key);
      } finally {
        pending--;
        notify();
      }
    });
  };
  return {
    initialize() {
      return initialization ??= overflow.load().then(entries => {
        for (const [key, value] of entries) if (!shadow.has(key)) shadow.set(key, value);
      }).catch(() => { loadFailed = true; }).finally(notify);
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    status,
    flush: () => queue,
    getItem(key: string): string | null {
      if (shadow.has(key)) return shadow.get(key) ?? null;
      try { return local().getItem(key); } catch { return null; }
    },
    setItem(key: string, value: string) {
      if (!shadow.has(key) && !loadFailed) {
        try {
          // Avoid needless rewrites, especially large avatar/history payloads.
          if (local().getItem(key) !== value) local().setItem(key, value);
          return;
        } catch { /* Quota or browser privacy restriction: use durable overflow. */ }
      } else if (shadow.get(key) === value && !dirty.has(key)) return;
      persist(key, value);
    },
    removeItem(key: string) {
      if (!shadow.has(key) && !loadFailed) {
        try { local().removeItem(key); return; } catch { /* Preserve deletion in overflow. */ }
      }
      persist(key, null);
    },
    keys(): string[] {
      const keys = new Set<string>();
      try {
        const storage = local();
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (key !== null) keys.add(key);
        }
      } catch { /* Overflow can remain available even when localStorage is blocked. */ }
      for (const [key, value] of shadow) {
        if (value === null) keys.delete(key); else keys.add(key);
      }
      return [...keys];
    },
  };
}

function indexedDBOverflow(): OverflowStore {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open("vesper-local-overflow-v1", 1);
    let failed = false;
    const fail = () => { failed = true; clearTimeout(timer); reject(new Error("Local overflow storage unavailable")); };
    const timer = setTimeout(fail, 5000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("values")) request.result.createObjectStore("values");
    };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      clearTimeout(timer);
      if (failed) { request.result.close(); return; }
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  }).catch(error => { opening = undefined; throw error; });
  return {
    async load() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const entries: [string, string | null][] = [];
        const tx = db.transaction("values", "readonly");
        const cursor = tx.objectStore("values").openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          if (typeof row.key === "string" && (typeof row.value === "string" || row.value === null)) entries.push([row.key, row.value]);
          row.continue();
        };
        tx.oncomplete = () => resolve(entries);
        tx.onabort = tx.onerror = () => reject(new Error("Local overflow read failed"));
      });
    },
    async put(key, value) {
      const db = await open();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("values", "readwrite");
        tx.objectStore("values").put(value, key);
        // Request success is not enough: wait until the transaction commits.
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error("Local overflow write failed"));
      });
    },
  };
}

export const browserStorage = createBrowserStorage(() => window.localStorage, indexedDBOverflow());
