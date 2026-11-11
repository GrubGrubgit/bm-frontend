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

// ---- L2: wasm core + C/JS contract (SPEC section 5). ----
import { GameHost } from "./core/host.js";
const l2host = new GameHost();
let l2pack = null;
async function l2ensurePack() {
  if (l2pack) return l2pack;
  const cached = await loadPack();
  if (cached && validatePack(cached).ok) { l2pack = cached; return l2pack; }
  const resp = await fetch("testrom.nes");
  if (!resp.ok) throw new Error("testrom-fetch:" + resp.status);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const r = buildPack(bytes, "testrom");
  if (!r.ok) throw new Error("pack:" + r.errors.join(" "));
  if (!validatePack(r.pack).ok) throw new Error("pack-invalid");
  l2pack = r.pack;
  return l2pack;
}
window.BM.bootL2 = async function () {
  const pack = await l2ensurePack();
  return l2host.spawn(pack, "build/game.wasm");
};
window.BM.runL2 = function (n, pad) { return l2host.go(n, pad || 0); };
window.BM.stepL2 = function (pad) { return l2host.step(pad || 0); };
window.BM.resetL2 = function () { return l2host.reset(); };
window.BM.saveL2 = function (slot) { return l2host.save(slot); };
window.BM.loadL2 = function (slot) { return l2host.load(slot); };
window.BM.l2info = function () {
  const v = l2host.videoBytes ? l2host.videoBytes() : new Uint8Array(0);
  let nz = 0;
  for (let i = 0; i < v.length; i += 997) if (v[i] !== 0) nz++;
  return { frame: l2host.frame(), audioTotal: l2host.audioTotal, padLogLen: l2host.padLog.length, videoSampleNz: nz };
};
const fail2 = s => { document.title = "BM-L2-FAIL:" + s; };
const eqH = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
async function selfTestL2() {
  document.title = "BM-L2-RUNNING";
  try {
    statusEl.textContent = "L2: loading pack";
    const pack = await l2ensurePack();
    statusEl.textContent = "L2: booting engine";
    await l2host.spawn(pack, "build/game.wasm");
    const A = await l2host.go(40, 0);
    await l2host.reset();
    const B = await l2host.go(40, 0);
    if (!eqH(A, B)) return fail2("reset-determinism");
    await l2host.reset();
    const P1 = await l2host.go(20, 0);
    if (!eqH(P1, A.slice(0, 20))) return fail2("reset3-determinism");
    await l2host.save(1);
    const P2 = await l2host.go(20, 0);
    if (!eqH(P2, A.slice(20, 40))) return fail2("cont-determinism");
    for (let i = 0; i < 10; i++) await l2host.step(0x80);
    if (l2host.frame() !== 50) return fail2("diverge-frame");
    const lf = await l2host.load(1);
    if (lf !== 20) return fail2("load-frame:" + lf);
    const C = await l2host.go(20, 0);
    if (!eqH(C, P2)) return fail2("replay-continue");
    if (!(l2host.audioTotal > 0)) return fail2("audio-zero");
    const v = l2host.videoBytes();
    let nz = 0;
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) nz++;
    if (nz < 1000) return fail2("video-blank");
    statusEl.textContent = "L2 self-test PASS frames=" + l2host.frame();
    document.title = "BM-L2-PASS";
  } catch (e) { fail2("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const t2 = qs.get("test");
  if (t2 === "l2") selfTestL2();
}
