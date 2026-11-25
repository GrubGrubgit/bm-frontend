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

// Save slots are pack-scoped: key "slot-<n>::<packId>" so stock and custom
// packs never clobber each other's saves (PLAN-EDITOR 3.4). Pre-scope
// saves under the legacy key ("slot-<n>") still load as fallback.
export function slotKeyFor(n, packId) {
  const base = "slot-" + (n | 0);
  if (typeof packId !== "string" || !packId.length || packId === "unknown") return base;
  if (!/^[A-Za-z0-9-]+$/.test(packId)) return base;
  return base + "::" + packId;
}
export async function saveSlot(n, data) {
  const key = slotKeyFor(n, data && data.pack);
  const db = await openDb();
  await tx(db, STORES.saves, "readwrite", s => s.put(data, key));
  db.close();
}
export async function loadSlot(n, packId) {
  const key = slotKeyFor(n, packId);
  const legacy = "slot-" + (n | 0);
  const db = await openDb();
  let d = await tx(db, STORES.saves, "readonly", s => s.get(key));
  if ((d == null) && key !== legacy) d = await tx(db, STORES.saves, "readonly", s => s.get(legacy));
  db.close();
  return d || null;
}

// Custom packs (P0 editor): full JSON docs under keys "custom-<id>" in the
// same packs store. Stock pack stays untouched at key "v1".
import { CUSTOM_ID_RE } from "./overlay.js";
function customKey(id) {
  if (typeof id !== "string" || !CUSTOM_ID_RE.test(id)) throw new Error("pack-id:" + id);
  return "custom-" + id;
}
export async function saveCustomPack(pack) {
  const db = await openDb();
  await tx(db, STORES.packs, "readwrite", s => s.put(pack, customKey(pack.id)));
  db.close();
}
export async function loadCustomPack(id) {
  const db = await openDb();
  const p = await tx(db, STORES.packs, "readonly", s => s.get(customKey(id)));
  db.close();
  return p || null;
}
export async function deleteCustomPack(id) {
  const db = await openDb();
  await tx(db, STORES.packs, "readwrite", s => s.delete(customKey(id)));
  db.close();
}
export async function listCustomPackIds() {
  const db = await openDb();
  const keys = await tx(db, STORES.packs, "readonly", s => s.getAllKeys());
  db.close();
  return (keys || []).filter(k => typeof k === "string" && k.indexOf("custom-") === 0).map(k => k.slice(7));
}

// Entrance saves (P4): exact-state snapshots, keyed apart from replay
// slots so the two systems never clobber each other. No legacy fallback
// (new namespace). Shape: {v:3, kind:'entrance', engine:'wasm', pack,
// packCrc, frame, hash, area, x, y, savedAt, bytes:[...]}.
export function entranceKeyFor(n, packId) {
  const base = 'entrance-' + (n | 0);
  if (typeof packId !== 'string' || !packId.length || packId === 'unknown') return base;
  if (!/^[A-Za-z0-9-]+$/.test(packId)) return base;
  return base + '::' + packId;
}
export async function saveEntrance(n, data) {
  const key = entranceKeyFor(n, data && data.pack);
  const db = await openDb();
  await tx(db, STORES.saves, 'readwrite', s => s.put(data, key));
  db.close();
}
export async function loadEntrance(n, packId) {
  const key = entranceKeyFor(n, packId);
  const db = await openDb();
  const d = await tx(db, STORES.saves, 'readonly', s => s.get(key));
  db.close();
  return d || null;
}


// Exploration visits (E8-M2): per-pack 128B visited-screens record.
// Shape: {v:1, kind:'visits', pack, packCrc, savedAt, bytes:[128]}.
// The engine holds a live monotonic cache; this record is the truth the
// shell union-merges (bitwise OR, order-independent) on pack switches,
// pregame edges and every 240 dirty frames.
export function visitKeyFor(packId) {
  const base = 'visits';
  if (typeof packId !== 'string' || !packId.length || packId === 'unknown') return base;
  if (!/^[A-Za-z0-9-]+$/.test(packId)) return base;
  return base + '::' + packId;
}
export async function saveVisits(packId, data) {
  const key = visitKeyFor(packId);
  const db = await openDb();
  await tx(db, STORES.saves, 'readwrite', s => s.put(data, key));
  db.close();
}
export async function loadVisits(packId) {
  const key = visitKeyFor(packId);
  const db = await openDb();
  const d = await tx(db, STORES.saves, 'readonly', s => s.get(key));
  db.close();
  return d || null;
}
