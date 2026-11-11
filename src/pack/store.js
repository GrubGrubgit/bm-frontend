// IndexedDB cache: rom identity, versioned packs, save slots. Browser only.
import { DB_NAME, STORES } from "./schema.js";
function openDb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB_NAME, 1);
    q.onupgradeneeded = () => {
      for (const k of Object.keys(STORES)) {
        if (!q.result.objectStoreNames.contains(STORES[k])) q.result.createObjectStore(STORES[k]);
      }
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
function tx(db, store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const q = fn(t.objectStore(store));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
export async function savePack(pack) {
  const db = await openDb();
  await tx(db, STORES.packs, "readwrite", s => s.put(pack, "v1"));
  await tx(db, STORES.rom, "readwrite", s => s.put({ key: "id", sourceName: pack.meta.sourceName, crc32: pack.meta.crc32, md5: pack.meta.md5, savedAt: new Date().toISOString() }, "id"));
  db.close();
}
export async function loadPack() {
  const db = await openDb();
  const pack = await tx(db, STORES.packs, "readonly", s => s.get("v1"));
  db.close();
  return pack || null;
}
export async function wipeAll() {
  const db = await openDb();
  for (const k of Object.keys(STORES)) await tx(db, STORES[k], "readwrite", s => s.clear());
  db.close();
}
export async function loadRomId() {
  const db = await openDb();
  const id = await tx(db, STORES.rom, "readonly", s => s.get("id"));
  db.close();
  return id || null;
}
