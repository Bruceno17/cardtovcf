/* CardToVCF Web — 本機紀錄（IndexedDB，無法使用時退回 localStorage） */
(function (root) {
  'use strict';
  const DB = 'cardtovcf', STORE = 'cards', LS_KEY = 'cardtovcf.cards';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!('indexedDB' in root)) return resolve(null);
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }
  const lsAll = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } };
  const lsSave = (list) => { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { /* 空間不足 */ } };

  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const r = fn(s);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  const Store = {
    async all() {
      const db = await openDB();
      const list = db ? await tx(db, 'readonly', (s) => s.getAll()) : lsAll();
      return (list || []).sort((a, b) => b.createdAt - a.createdAt);
    },
    async get(id) {
      const db = await openDB();
      return db ? tx(db, 'readonly', (s) => s.get(id)) : lsAll().find((x) => x.id === id);
    },
    async put(rec) {
      rec.updatedAt = Date.now();
      const db = await openDB();
      if (db) return tx(db, 'readwrite', (s) => s.put(rec));
      const list = lsAll().filter((x) => x.id !== rec.id);
      list.push(Object.assign({}, rec, { image: undefined })); // localStorage 空間小，不存大圖
      lsSave(list);
    },
    async remove(id) {
      const db = await openDB();
      if (db) return tx(db, 'readwrite', (s) => s.delete(id));
      lsSave(lsAll().filter((x) => x.id !== id));
    },
    async clear() {
      const db = await openDB();
      if (db) return tx(db, 'readwrite', (s) => s.clear());
      lsSave([]);
    },
    newId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
  };
  root.Store = Store;
})(self);
