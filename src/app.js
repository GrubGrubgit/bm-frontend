// L1 shell: loader UI + pack cache wiring + window.BM. No game code runs.
import { wireLoader } from "./rom/loader.js";
import { buildPack } from "./pack/builder.js";
import { validatePack } from "./pack/reader.js";
import { savePack, loadPack, wipeAll, loadRomId } from "./pack/store.js";
const bootMs = Date.now();
let frames = 0;
const errors = [];
addEventListener("error", e => errors.push(String(e.message || e.error)));
addEventListener("unhandled" + "rejection", e => errors.push(String(e.reason)));
const statusEl = document.getElementById("statusEl");
const metaEl = document.getElementById("metaEl");
function tick() { frames++; if (statusEl && frames % 30 === 0) statusEl.textContent = "ok f=" + frames; requestAnimationFrame(tick); }
requestAnimationFrame(tick);
window.BM = {
  stats() { return { ok: errors.length === 0, frames, errors: errors.slice(), upMs: Date.now() - bootMs }; }
};
async function handleFile(buf, name) {
  const bytes = new Uint8Array(buf);
  const r = buildPack(bytes, name);
  if (!r.ok) {
    statusEl.textContent = "ROM rejected: " + r.errors.join(" ");
    metaEl.textContent = "errors: " + r.errors.join("\n");
    return;
  }
  await savePack(r.pack);
  statusEl.textContent = "pack v1 cached: " + name;
  metaEl.textContent = JSON.stringify(r.pack.meta, null, 1);
}
wireLoader({
  inputEl: document.getElementById("romInput"),
  dropEl: document.getElementById("dropEl"),
  onFile: (buf, name) => handleFile(buf, name).catch(e => { statusEl.textContent = "error: " + e; }),
  onError: m => { statusEl.textContent = m; }
});
document.getElementById("wipeBtn").addEventListener("click", async () => {
  await wipeAll();
  statusEl.textContent = "cache wiped";
  metaEl.textContent = "no ROM yet";
});
loadPack().then(p => {
  if (p && validatePack(p).ok) {
    statusEl.textContent = "pack v1 restored (no ROM needed)";
    metaEl.textContent = JSON.stringify(p.meta, null, 1);
  }
});
function synthRom() {
  const b = new Uint8Array(16 + 8 * 16384 + 16 * 8192);
  b.set([0x4E, 0x45, 0x53, 0x1A, 8, 16, 0x10, 0x08, 0, 0, 0, 7, 0, 0, 0, 0], 0);
  for (let i = 16; i < b.length; i++) b[i] = i & 0xFF;
  return b;
}
const fail = s => { document.title = "BM-L1-FAIL:" + s; };
async function selfTestL1() {
  document.title = "BM-L1-RUNNING";
  const r = buildPack(synthRom(), "synthetic");
  if (!r.ok || r.gaps.length !== 0) return fail("build");
  if (!validatePack(r.pack).ok) return fail("validate");
  await savePack(r.pack);
  const back = await loadPack();
  if (!back || back.meta.crc32 !== r.pack.meta.crc32) return fail("roundtrip");
  if (!validatePack(back).ok) return fail("revalidate");
  const id = await loadRomId();
  if (!id || id.crc32 !== r.pack.meta.crc32) return fail("romid");
  if (buildPack(new Uint8Array(8), "x").ok) return fail("short-accepted");
  await wipeAll();
  if (await loadPack() !== null) return fail("wipe-packs");
  if (await loadRomId() !== null) return fail("wipe-rom");
  document.title = "BM-L1-PASS";
  statusEl.textContent = "L1 self-test PASS";
}
async function selfTestSave() {
  document.title = "BM-L1-RUNNING";
  const r = buildPack(synthRom(), "synthetic-persist");
  if (!r.ok) return fail("build");
  await savePack(r.pack);
  document.title = "BM-L1-SAVED:" + r.pack.meta.crc32;
}
async function selfTestReload() {
  document.title = "BM-L1-RUNNING";
  const back = await loadPack();
  if (!back || !validatePack(back).ok) return fail("norestore"); const want = qs.get("want"); if (want && back.meta.crc32 !== want) return fail("crc-mismatch");
  document.title = "BM-L1-RESTORED:" + back.meta.crc32;
  statusEl.textContent = "pack v1 restored (no ROM needed)";
  metaEl.textContent = JSON.stringify(back.meta, null, 1);
}
const qs = new URLSearchParams(location.search);
if (qs.has("headless")) {
  const t = qs.get("test");
  if (t === "l1") selfTestL1().catch(e => fail(e));
  else if (t === "l1save") selfTestSave().catch(e => fail(e));
  else if (t === "l1reload") selfTestReload().catch(e => fail(e));
  else document.title = "BM-HEADLESS-READY";
}
