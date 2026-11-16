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
  pickEl: document.getElementById("pickBtn"),
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
const wasmHost = new GameHost();
const mesenHost = new MesenHost();
let l2host = wasmHost;
let l2pack = null;
async function l2ensurePack() {
  // Picker-only: the app NEVER ships a ROM. The user supplies their own
  // ROM file via the file picker; the validated pack is cached in IDB.
  if (l2pack) return l2pack;
  const cached = await loadPack();
  if (cached && validatePack(cached).ok) { l2pack = cached; return l2pack; }
  throw new Error("no-rom: use the picker to supply your own ROM file");
}
// Headless/dev-test helper ONLY (localhost serve.js): boots the device-local
// reference ROM via the /testrom.nes alias so ?headless&test=l* can run with
// no picker. Never used by the shipped UI paths (shellStart/shellReset stay
// picker-only); the alias exists only on the dev server, never in www/APK.
async function l2ensurePackForTest() {
  if (l2pack) return l2pack;
  const cached = await loadPack();
  if (cached && validatePack(cached).ok) { l2pack = cached; return l2pack; }
  const host = location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("no-rom: use the picker to supply your own ROM file");
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
    const pack = await l2ensurePackForTest();
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

// ---- L3: WebGL video (SPEC section 6 src/video). ----
// Displays the SPEC section 5 bm_video_ptr bytes through the VideoRenderer
// present path (CHR/palette/scroll/OAM compositing already happened in the
// C adapter, oracle-verified). No game code here.
// Display-proof note: engine bytes are proven EXACT vs work/oracle.png
// (eqB - the same bytes the node harness cmp-verified against the tracer
// oracle). In-page GL pixel readback (readPixels/drawImage/compositor
// capture of the canvas layer) is NOT possible in this device headless
// Chromium (SwiftShader stack: any drawArrays call loses the context ~1s
// later, getError 37442/CONTEXT_LOST; clear-only survives), so the in-page
// display proof is: (a) upload-digest == oracle FNV (the exact title bytes
// reached GL), (b) the toDataURL bitmap changes blank -> drawn across
// present() (present() executed the draw path and mutated the bitmap),
// (c) per-step GL errors all 0. Renderer byte-exactness (exact corners,
// uniform 2x2 blocks, context stays alive) was additionally proven on
// conformant real GL.
import { VideoRenderer } from "./video/renderer.js";
let video = null;
function ensureVideo() {
  if (!video) {
    video = new VideoRenderer(document.getElementById("gameCanvas"));
    video.onEvent = function (what) {
      if (what === "lost") shellLog("GL context lost (app backgrounded?) - video frozen, engine+audio run on");
      else shellLog("GL context restored - video live again");
    };
  }
  return video;
}
function fnv(b) {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
function strFnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) & 255; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
function eqB(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function loadOraclePixels(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height);
        res({ w: c.width, h: c.height, px: d.data });
      } catch (e) { rej(e); }
    };
    img.onerror = () => rej(new Error("img-load"));
    img.src = url;
  });
}
window.BM.videoPresent = function () {
  ensureVideo();
  video.upload(l2host.videoBytes());
  return video.present();
};
window.BM.videoMode = function (s, f) { ensureVideo(); video.setMode(s, f); return video.scale + "/" + video.filter; };
window.BM.videoResize = function (w, h, d) {
  ensureVideo();
  video.resize(w, h, d || 1);
  return { w: video.cv.width, h: video.cv.height, rect: video.rect() };
};
window.BM.videoFps = function () { return video ? video.fps : -1; };
window.BM.videoDigest = function () { return video ? video.lastDigest : "none"; };
window.BM.videoFullscreen = async function (on) {
  ensureVideo();
  const ctn = document.getElementById("playCtn");
  if (on === false) { await video.exitFullscreen(); return !!document.fullscreenElement; }
  await video.enterFullscreen(ctn);
  return !!document.fullscreenElement;
};
const fail3 = s => { document.title = "BM-L3-FAIL:" + s; };
function stepsMsg() { return video && video.lastSteps ? video.lastSteps.join(",") : "-"; }
async function selfTestL3() {
  document.title = "BM-L3-RUNNING";
  try {
    statusEl.textContent = "L3: boot engine";
    const pack = await l2ensurePackForTest();
    await l2host.spawn(pack, "build/game.wasm");
    await l2host.go(39, 0);
    if (l2host.frame() !== 39) return fail3("frame:" + l2host.frame());
    const v0 = l2host.videoBytes().slice();
    const D1 = fnv(v0);
    statusEl.textContent = "L3: oracle compare";
    const O = await loadOraclePixels("work/oracle.png");
    if (O.w !== 256 || O.h !== 240) return fail3("oracle-size:" + O.w + "x" + O.h);
    if (!eqB(v0, O.px)) return fail3("oracle-bytes");
    ensureVideo();
    statusEl.textContent = "L3: display-path proof";
    video.resize(256, 240, 1);
    video.setMode("integer", "nearest");
    video.gl.viewport(0, 0, video.cv.width, video.cv.height);
    video.gl.clearColor(0, 0, 0, 1);
    video.gl.clear(video.gl.COLOR_BUFFER_BIT);
    const blankD = strFnv(video.cv.toDataURL());
    video.upload(v0);
    const dpe = video.present();
    const shownD = strFnv(video.cv.toDataURL());
    if (dpe !== 0) return fail3("dp-present:" + dpe + " steps=" + stepsMsg());
    if (video.lastDigest !== D1) return fail3("dp-upload-digest");
    if (blankD === shownD) return fail3("display-nochange");
    statusEl.textContent = "L3: integer 2x + scaling matrix";
    video.resize(480, 448, 1);
    video.setMode("integer", "nearest");
    const r0 = video.rect();
    if (r0.x !== 0 || r0.y !== 0 || r0.w !== 480 || r0.h !== 448) return fail3("integer-rect");
    video.upload(v0);
    if (video.present() !== 0) return fail3("gl-err steps=" + stepsMsg());
    if (video.lastDigest !== D1) return fail3("upload-digest");
    const vps = [[512, 480], [800, 600], [390, 844]];
    const modes = ["integer", "fit", "fill", "stretch"];
    const fils = ["nearest", "bilinear"];
    for (const vp of vps) {
      video.resize(vp[0], vp[1], 1);
      for (const m of modes) for (const f of fils) {
        video.setMode(m, f);
        const rc = video.rect();
        if (m === "integer") {
          if (rc.w % 240 !== 0 || rc.h % 224 !== 0 || rc.w / 240 !== rc.h / 224) return fail3("matrix-int-math");
          if (rc.w > vp[0] || rc.h > vp[1]) return fail3("matrix-int-overflow");
        } else if (m === "fit") {
          if (rc.w > vp[0] || rc.h > vp[1]) return fail3("matrix-fit-overflow");
          if (rc.w !== vp[0] && rc.h !== vp[1]) return fail3("matrix-fit-edge");
        } else if (m === "fill") {
          if (rc.w < vp[0] || rc.h < vp[1]) return fail3("matrix-fill-cover");
        } else {
          if (rc.x !== 0 || rc.y !== 0 || rc.w !== vp[0] || rc.h !== vp[1]) return fail3("matrix-stretch");
        }
        video.upload(v0);
        if (video.present() !== 0) return fail3("matrix-gl:" + vp[0] + "x" + vp[1] + m + f + " steps=" + stepsMsg());
      }
    }
    const ctn = document.getElementById("playCtn");
    statusEl.textContent = "L3: tap for fullscreen";
    document.title = "BM-L3-NEEDS-TAP";
    await new Promise(res => window.addEventListener("pointerdown", res, { once: true }));
    document.title = "BM-L3-RUNNING";
    statusEl.textContent = "L3: fullscreen";
    try {
      await video.enterFullscreen(ctn);
      await new Promise(r => setTimeout(r, 800));
      if (!document.fullscreenElement) return fail3("fullscreen-state");
      video.resize(window.innerWidth, window.innerHeight, 1);
      video.setMode("integer", "nearest");
      const fr0 = video.rect();
      if (fr0.w !== video.cv.width || fr0.h !== video.cv.height) video.setMode("fit", "nearest");
      video.upload(v0);
      const fpe = video.present();
      if (fpe !== 0) return fail3("fullscreen-present:" + fpe + " steps=" + stepsMsg() + " wh=" + video.cv.width + "x" + video.cv.height);
    } catch (err) { return fail3("fullscreen-exc:" + String((err && err.message) || err).slice(0, 40)); }
    statusEl.textContent = "L3: perf";
    video.resize(512, 480, 1);
    video.setMode("integer", "nearest");
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) { video.upload(v0); video.present(); }
    const avgMs = (performance.now() - t0) / 120;
    const e0 = performance.now();
    await l2host.go(600, 0);
    const engFps = Math.round(600 * 1000 / (performance.now() - e0));
    statusEl.textContent = "L3 perf present=" + avgMs.toFixed(2) + "ms engine=" + engFps + "fps";
    if (!(avgMs < 8)) return fail3("present-slow:" + avgMs.toFixed(2));
    await l2host.reset();
    await l2host.go(39, 0);
    if (fnv(l2host.videoBytes()) !== D1) return fail3("reset-pixels");
    statusEl.textContent += " reset-ok";
    await video.exitFullscreen();
    await new Promise(r => setTimeout(r, 500));
    if (document.fullscreenElement) return fail3("fullscreen-exit");
    document.title = "BM-L3-PASS";
  } catch (e) { fail3("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const t3 = qs.get("test");
  if (t3 === "l3") selfTestL3();
}

// ---- L4: live APU (SPEC section 6 src/audio). ----
// Native voice synthesis from the SPEC section 5 bm_audio_read register
// stream (src/audio/apu.js DSP: pulse1/pulse2/triangle/noise/DMC + frame
// sequencer, cycle-exact timing, nonlinear NES mixer, DC blocker). No PCM,
// no samples, no invented tunes: the game driver (bank5 TU) writes real
// APU registers through the adapter ring and the DSP voices them.
// Two paths share the identical ApuStream framing + NesApu DSP:
// - offline: renderOffline() on the calling thread (L4 headless proof);
// - realtime: AudioWorkletNode (worklet.js) fed pushed engine frames,
//   volume/mute via GainNode (L6 wires the 60Hz engine tick to pushFrame).
import { ApuPlayer, renderOffline } from "./audio/player.js";
let audioPlayer = null;
function ensureAudio() {
  if (!audioPlayer) audioPlayer = new ApuPlayer();
  return audioPlayer;
}
let pcmPlayer = null;
function ensurePcm() {
  if (!pcmPlayer) pcmPlayer = new PcmPlayer();
  return pcmPlayer;
}
window.BM.audioUnlock = function () { return ensureAudio().unlock(); };
window.BM.pcmUnlock = function () { return ensurePcm().unlock(); };
window.BM.audioVolume = function (v) { return ensureAudio().setVolume(v); };
window.BM.audioMute = function (m) { return ensureAudio().setMuted(m); };
window.BM.audioStats = function () { return ensureAudio().stats(); };
window.BM.audioPush = function (f, ev) { ensureAudio().pushFrame(f, ev); };
window.BM.stats = ((prev) => () => Object.assign(prev(), { audio: audioPlayer ? audioPlayer.stats() : null }))(window.BM.stats);
function parseAudioBytes(ab) {
  const ev = [], b = ab.bytes;
  for (let i = 0; i < ab.n; i++) {
    const o = i * 8;
    ev.push([b[o] | (b[o + 1] << 8), b[o + 2], (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0]);
  }
  return ev;
}
function pcmDigest(pcm) {
  let h = 2166136261;
  const b = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  for (let i = 0; i < b.length; i += 7) { h ^= b[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
const fail4 = s => { document.title = "BM-L4-FAIL:" + s; };
async function selfTestL4() {
  document.title = "BM-L4-RUNNING";
  try {
    statusEl.textContent = "L4: boot engine";
    const pack = await l2ensurePackForTest();
    await l2host.spawn(pack, "build/game.wasm");
    statusEl.textContent = "L4: 60s capture (start@2700)";
    const byf = new Map();
    let evTotal = 0;
    const put = (f) => { const ev = parseAudioBytes(l2host.audioFrame()); if (ev.length > 0) { byf.set(f, ev); evTotal += ev.length; } };
    put(0);
    for (let f = 1; f < 3600; f++) {
      const pad = (f >= 2700 && f < 2705) ? 8 : 0;
      await l2host.go(1, pad);
      put(f);
      if ((f & 511) === 511) statusEl.textContent = "L4: capture " + (f + 1) + "/3600";
    }
    if (l2host.frame() !== 3599) return fail4("survive:" + l2host.frame());
    if (evTotal < 5000) return fail4("event-count:" + evTotal);
    statusEl.textContent = "L4: offline render x2";
    const r1 = renderOffline(byf, 3600, 48000);
    const r2 = renderOffline(byf, 3600, 48000);
    const d1 = pcmDigest(r1.pcm), d2 = pcmDigest(r2.pcm);
    if (d1 !== d2) return fail4("render-nondeterminism");
    let peak = 0, bad = 0;
    for (let i = 0; i < r1.pcm.length; i++) {
      const x = r1.pcm[i];
      if (!isFinite(x)) bad++;
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
    }
    if (bad > 0) return fail4("nonfinite:" + bad);
    if (!(peak > 0.05)) return fail4("silent:" + peak.toFixed(4));
    if (peak > 0.99) return fail4("clip:" + peak.toFixed(4));
    if (r1.pcm.length < 3600 * 795 || r1.pcm.length > 3600 * 810) return fail4("len:" + r1.pcm.length);
    const perSec = [];
    const SPSEC = 48000;
    const nSec = Math.floor(r1.pcm.length / SPSEC);
    for (let s = 0; s < nSec; s++) {
      let ss = 0;
      for (let i = s * SPSEC; i < (s + 1) * SPSEC; i++) ss += r1.pcm[i] * r1.pcm[i];
      perSec.push(Math.sqrt(ss / SPSEC));
    }
    for (let s = 6; s <= 40; s++) if (!(perSec[s] > 0.02)) return fail4("quiet-sec" + s + ":" + perSec[s].toFixed(4));
    for (let s = 45; s <= 59; s++) if (!(perSec[s] > 0.02)) return fail4("quiet-sec" + s + ":" + perSec[s].toFixed(4));
    const A = r1.audit;
    if (A.unhandled.length > 0) return fail4("unhandled:" + A.unhandled.map(a => a.toString(16)).join(","));
    if (A.dmcEnabled) return fail4("dmc-enabled");
    if (A.wrote4017) return fail4("wrote-4017");
    if (A.wroteDmcSample) return fail4("dmc-sample-reg");
    if (A.wrote4016 > 0) return fail4("wrote-4016:" + A.wrote4016);
    const P = (n) => A.byAddr[n] || 0;
    const need = ["4000", "4001", "4002", "4003", "4004", "4005", "4006", "4007", "4008", "400a", "400b", "400c", "400d", "400e", "400f", "4010", "4015"];
    for (const k of need) if (!(P(k) > 0)) return fail4("addr-missing:" + k);
    statusEl.textContent = "L4: realtime smoke";
    const sr = await ensureAudio().unlock();
    if (!(sr >= 22050)) return fail4("sample-rate:" + sr);
    for (let f = 0; f < 5; f++) ensureAudio().pushFrame(f, byf.get(f) || []);
    const t0 = performance.now();
    for (;;) {
      const st0 = await ensureAudio().workletStats();
      if (st0.fed >= 4) break;
      if (performance.now() - t0 > 15000) return fail4("prime-stall");
      await new Promise(r => setTimeout(r, 100));
    }
    const gaps0 = (await ensureAudio().workletStats()).gaps;
    for (let f = 5; f < 150; f++) ensureAudio().pushFrame(f, byf.get(f) || []);
    const t1 = performance.now();
    for (;;) {
      if (ensureAudio().stats().time >= 2.0) break;
      if (performance.now() - t1 > 15000) return fail4("clock-stall");
      await new Promise(r => setTimeout(r, 200));
    }
    const ws = await ensureAudio().workletStats();
    if (ws.fed !== 149) return fail4("fed:" + ws.fed);
    if (ws.gaps - gaps0 !== 0) return fail4("gaps:" + (ws.gaps - gaps0));
    ensureAudio().setVolume(0.5);
    if (ensureAudio().gain.gain.value !== 0.5) return fail4("volume:" + ensureAudio().gain.gain.value);
    ensureAudio().setMuted(true);
    if (ensureAudio().gain.gain.value !== 0) return fail4("mute:" + ensureAudio().gain.gain.value);
    ensureAudio().setMuted(false);
    if (Math.abs(ensureAudio().gain.gain.value - 0.5) > 1e-6) return fail4("unmute:" + ensureAudio().gain.gain.value);
    statusEl.textContent = "L4 audio 60s clean, gaps 0, voices audited";
    document.title = "BM-L4-PASS";
  } catch (e) { fail4("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const t4 = qs.get("test");
  if (t4 === "l4") selfTestL4();
}

// ---- L5: one virtual-pad bus (SPEC section 6 src/input, section 7). ----
// Four named sources (keyboard/touch/gamepad/agent) OR into a single NES
// mask ($01=A $02=B $04=Select $08=Start $10=Up $20=Down $40=Left $80=Right)
// Touch pad lives in-flow in #touchCtn below the video (toggle via Touch pad checkbox).
// that every engine step reads. Thumb controls are a fixed bottom overlay
// (L6 skins it); keyboard is dev convenience; gamepad uses the standard
// mapping with stick deadzone; agent drives the same bus headless.
import { PadBus } from "./input/bus.js";
import { attachKeyboard } from "./input/keyboard.js";
import { mountTouch } from "./input/touch.js";
import { pollGamepad, attachGamepad } from "./input/gamepad.js";
import { AgentPad } from "./input/agent.js";
import { MesenHost } from "./core/mesen_host.js";
import { PcmPlayer } from "./audio/pcm.js";
const padBus = new PadBus();
const agentPad = new AgentPad(padBus, l2host);
attachKeyboard(padBus);
let touchUI = mountTouch(padBus, document.getElementById("touchCtn") || undefined);
const padFlags = { nav: navigator, swapAB: false, swapXY: false };
attachGamepad(padBus, padFlags);
window.BM.setPad = function (m) { return agentPad.setPad(m); };
window.BM.press = function (frames, mask) { return agentPad.press(frames, mask); };
window.BM.frame = function () { return l2host.frame(); };
window.BM.busMask = function () { return padBus.getMask(); };
const fail5 = s => { document.title = "BM-L5-FAIL:" + s; };
function kd(code) { window.dispatchEvent(new KeyboardEvent("keydown", { code: code })); }
function ku(code) { window.dispatchEvent(new KeyboardEvent("keyup", { code: code })); }
function pdown(el, id) { el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: id, bubbles: true, cancelable: true })); }
function pup(el, id) { el.dispatchEvent(new PointerEvent("pointerup", { pointerId: id, bubbles: true, cancelable: true })); }
function pdownAt(el, id, x, y) { el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true })); }
function pmoveAt(el, id, x, y) { el.dispatchEvent(new PointerEvent("pointermove", { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true })); }
function fakeNav(btns, axes) {
  const b = [];
  for (let i = 0; i < 16; i++) b.push({ pressed: !!btns[i] });
  return { getGamepads: () => [{ connected: true, buttons: b, axes: axes || [0, 0] }] };
}
async function selfTestL5() {
    if (!touchUI) { try { touchUI = mountTouch(padBus, document.getElementById("touchCtn") || undefined); } catch (e) {} }
  document.title = "BM-L5-RUNNING";
  try {
    statusEl.textContent = "L5: source mapping proofs";
    kd("ArrowRight"); kd("KeyX");
    if (padBus.getMask() !== 0x81) return fail5("kbd:" + padBus.getMask().toString(16));
    ku("ArrowRight"); ku("KeyX");
    if (padBus.getMask() !== 0) return fail5("kbd-clear:" + padBus.getMask().toString(16));
    try { touchUI.root.scrollIntoView({ block: "end" }); } catch (e) {}
    await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
    const lr = touchUI.dirs.left.getBoundingClientRect();
    pdownAt(touchUI.dirs.left, 11, (lr.left + lr.right) / 2, (lr.top + lr.bottom) / 2);
    if (padBus.getMask() !== 0x40) return fail5("dpad-left:" + padBus.getMask().toString(16));
    const ur = touchUI.dirs.up.getBoundingClientRect();
    pmoveAt(touchUI.dirs.left, 11, (ur.left + ur.right) / 2, (ur.top + ur.bottom) / 2);
    if (padBus.getMask() !== 0x10) return fail5("dpad-roll-up:" + padBus.getMask().toString(16));
    pdown(touchUI.buttons.a, 12);
    if (padBus.getMask() !== 0x11) return fail5("dpad-multitouch:" + padBus.getMask().toString(16));
    pup(touchUI.dirs.up, 11); pup(touchUI.buttons.a, 12);
    if (padBus.getMask() !== 0) return fail5("touch-clear:" + padBus.getMask().toString(16));
    if (pollGamepad(fakeNav({ 0: true, 14: true })) !== 0x41) return fail5("pad-map");
    if (pollGamepad(fakeNav({}, [0.9, -0.9])) !== 0x90) return fail5("pad-stick");
    if (pollGamepad(fakeNav({ 0: true })) !== 0x01) return fail5("pad-a");
    if (pollGamepad(fakeNav({ 0: true }), { swapAB: true }) !== 0x02) return fail5("pad-swapAB");
    if (pollGamepad(fakeNav({ 2: true })) !== 0x01) return fail5("pad-x");
    if (pollGamepad(fakeNav({ 2: true }), { swapXY: true }) !== 0x02) return fail5("pad-swapXY");
    if (pollGamepad({ getGamepads: () => [null] }) !== 0) return fail5("pad-null");
    if (pollGamepad(null) !== 0) return fail5("pad-nonull");
    kd("ArrowRight");
    agentPad.setPad(0x01);
    if (padBus.getMask() !== 0x81) return fail5("combine:" + padBus.getMask().toString(16));
    ku("ArrowRight");
    agentPad.setPad(0);
    if (padBus.getMask() !== 0) return fail5("combine-clear:" + padBus.getMask().toString(16));
    statusEl.textContent = "L5: agent 60s run (start@2700, hold L+A)";
    const pack = await l2ensurePackForTest();
    await l2host.spawn(pack, "build/game.wasm");
    for (let f = 1; f < 2700; f++) {
      agentPad.setPad(0);
      await l2host.go(1, padBus.getMask());
      if ((f & 1023) === 0) statusEl.textContent = "L5: capture " + f + "/3600";
    }
    await agentPad.press(5, 8);
    if (l2host.frame() !== 2704) return fail5("press-frame:" + l2host.frame());
    for (let f = 2705; f < 3600; f++) {
      agentPad.setPad(f >= 2800 ? 0x41 : 0);
      await l2host.go(1, padBus.getMask());
      if ((f & 1023) === 0) statusEl.textContent = "L5: capture " + f + "/3600";
    }
    if (l2host.frame() !== 3599) return fail5("survive:" + l2host.frame());
    if (l2host.hash() !== 0xe46b2b8f) return fail5("hash:" + l2host.hash().toString(16));
    const v = l2host.videoBytes();
    let nz = 0;
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) nz++;
    if (nz < 1000) return fail5("video-blank");
    const O = await loadOraclePixels("work/oracle.png");
    if (eqB(v, O.px)) return fail5("still-on-title");
    statusEl.textContent = "L5 bus proven: mappings + 60s agent run exact";
    document.title = "BM-L5-PASS";
  } catch (e) { fail5("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const t5 = qs.get("test");
  if (t5 === "l5") selfTestL5();
}

// ---- L6: shell (SPEC section 6 src/ui + section 7). Thin composition only:
// loader/pack/start/stop/reset/pause, IDB state slots, volume, scale +
// filter + fullscreen (persisted, touch-accessible), status line, log view.
// 60fps pacing lives here (rAF loop stepping the L2 host with the live bus
// mask, video present + audio push per frame). Determinism + replay save/
// load are L2 properties this layer reuses, never reimplements.
import { autoTrapReport, autoFaultReport, manualBugReport, buildBugReport, formatTrapBanner } from "./ui/report.js";
import { makeMovie, makeMovieV2, parseMovie, downloadMovie, downloadPng, replayMovie, downloadJson } from "./input/movie.js";
import { loadPrefs, savePrefs } from "./ui/prefs.js";
import { wireInstall } from "./ui/pwa.js";
import { makeLog, fmtStatus, toast, wirePadToasts } from "./ui/shell.js";
const prefs = loadPrefs();
const shellStatusEl = document.getElementById("shellStatus");
const logEl = document.getElementById("logEl");
const padToastEl = document.getElementById("padToast");
const shellLogBase = makeLog(logEl);
const logTail = [];
function shellLog(m) { logTail.push(m); if (logTail.length > 200) logTail.shift(); return shellLogBase(m); }
wirePadToasts(padToastEl, shellLog);
wireInstall(document.getElementById("installBtn"), shellLog);
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const pauseBtn = document.getElementById("pauseBtn");
const slotSel = document.getElementById("slotSel");
const saveBtn = document.getElementById("saveBtn");
const loadBtn = document.getElementById("loadBtn");
const shotBtn = document.getElementById("shotBtn");
const scaleSel = document.getElementById("scaleSel");
const filterSel = document.getElementById("filterSel");
const fsBtn = document.getElementById("fsBtn");
const volumeInput = document.getElementById("volumeInput");
const muteBtn = document.getElementById("muteBtn");
const playCtn = document.getElementById("playCtn");
slotSel.value = String(prefs.slot);
scaleSel.value = prefs.scale;
filterSel.value = prefs.filter;
volumeInput.value = String(Math.round(prefs.volume * 100));
muteBtn.textContent = prefs.muted ? "Unmute" : "Mute";
pauseBtn.textContent = "Pause";
function fitCanvas() {
  const w = (playCtn && playCtn.clientWidth) || 512;
  const h = Math.round(w * 224 / 240);
  ensureVideo();
  video.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
}
function applyVideoPrefs() {
  ensureVideo();
  video.setMode(prefs.scale, prefs.filter);
  fitCanvas();
}
function syncAudioToPrefs() {
  try { if (pcmPlayer) { pcmPlayer.setVolume(prefs.volume); pcmPlayer.setMuted(prefs.muted); } } catch (e) {}
  if (!audioPlayer) return;
  try {
    audioPlayer.setVolume(prefs.volume);
    audioPlayer.setMuted(prefs.muted);
  } catch (e) {}
  muteBtn.textContent = prefs.muted ? "Unmute" : "Mute";
}
applyVideoPrefs();
window.addEventListener("resize", () => { try { fitCanvas(); } catch (e) {} });
document.addEventListener("fullscreenchange", () => {
  try {
    if (document.fullscreenElement) {
      ensureVideo();
      video.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1));
    } else fitCanvas();
  } catch (e) {}
});
let shellRunning = false, shellPaused = false, shellStepping = false, shellRaf = 0;
let shellFpsCount = 0, shellFpsT0 = 0, shellFps = 0;
let shellLastT = 0;
async function shellStepOnce() {
  if (typeof replay !== "undefined" && replay.mode === "playing") return replayStepOnce();
  const mask = padBus.getMask();
  let h;
  try {
    h = await Promise.race([l2host.go(1, mask), new Promise((rr, jj) => setTimeout(() => jj(new Error('go-stall')), 2500))]);
  } catch (e) {
    if (String((e && e.message) || e).indexOf('go-stall') >= 0) shellLog('STALL go>2500ms f=' + l2host.frame());
    throw e;
  }
  await presentFrame();
  return h;
}
async function presentFrame() {
  try {
    if (l2host === mesenHost) {
      if (pcmPlayer && pcmPlayer.node) pcmPlayer.pushSamples(l2host.frame(), l2host.pcmDrain());
    } else if (audioPlayer && audioPlayer.node) {
      const ab = l2host.audioFrame();
      // Push EVERY consumed edge, including empty ones: the worklet clock is
      // frame-indexed (target = c0+(f+1)*FC), so skipping n=0 edges renders
      // ~9% fewer samples than real time (measured 560/6000 empty) and trips
      // the overrun rebase on every quiet stretch -> FIFO starvation crackle.
      audioPlayer.pushFrame(l2host.frame(), parseAudioBytes(ab));
    }
  } catch (e) {}
  try {
    ensureVideo();
    video.upload(l2host.videoBytes());
    const pe = video.present();
    if (pe !== 0) shellLog("video present err " + pe);
  } catch (e) {
    window.__bmVidErr = (window.__bmVidErr || 0) + 1;
    shellLog("video err n=" + window.__bmVidErr + " " + String((e && e.message) || e).slice(0, 90));
  }
  if ((l2host.frame() & 31) === 0) {
    try {
      var wd = fnv(l2host.videoBytes());
      if (wd === window.__bmLastD) window.__bmStaticN = (window.__bmStaticN || 0) + 32;
      else { window.__bmLastD = wd; window.__bmStaticN = 0; }
      if (window.__bmStaticN >= 320 && !window.__bmStaticHint) {
        window.__bmStaticHint = true;
        shellLog("picture static 320f while running - if the game waits, press STA/START; Reset restarts");
        toast(padToastEl, "no picture change - try STA/START, or Reset", 8000);
      }
    } catch (e2) {}
  }
  shellFpsCount++;
  const now = performance.now();
  if (!shellFpsT0) shellFpsT0 = now;
  else if (now - shellFpsT0 >= 1000) {
    shellFps = shellFpsCount * 1000 / (now - shellFpsT0);
    shellFpsCount = 0; shellFpsT0 = now;
  }
  return;
}
function shellLoop() {
  if (!shellRunning) { shellRaf = 0; return; }
  shellRaf = requestAnimationFrame(() => {
    (async () => {
      var nowT = 0;
      try { nowT = performance.now(); } catch (e) { nowT = 0; }
      // Wall-clock pacing with catch-up: one emulation step per 1/60s of
      // wall time, so a slow rAF (throttled WebView, heavy frame) no longer
      // slows the GAME and starves Mesen audio into slow-motion. Capped at
      // 4 steps: under heavy load the game degrades to graceful slow-mo
      // instead of spiralling. Pause/resume carries no debt.
      if (shellPaused || shellStepping || replay.busy) { if (shellPaused && nowT !== 0) shellLastT = nowT; return; }
      var steps = 1;
      if (shellLastT === 0 || nowT === 0) { shellLastT = nowT; }
      else {
        var elapsed = nowT - shellLastT;
        steps = Math.floor(elapsed / 16.667);
        if (steps < 1) return;
        if (steps > 4) steps = 4;
        shellLastT += steps * 16.667;
        if (shellLastT < nowT - 100) shellLastT = nowT;
      }
      shellStepping = true;
      try { for (var i = 0; i < steps; i++) await shellStepOnce(); }
      catch (e) { shellOnStepErr(e); try { shellAutoTrapReport(); } catch (e3) {} }
      finally { shellStepping = false; }
    })().then(() => shellLoop(), () => shellLoop());
  });
}
// Every engine fault surfaces HERE with its identity: wasm traps carry
// {name, val} (named stub, or vec007A-unmapped + faulting vector address),
// replay guards throw loud anchor/load mismatches. A trap auto-pauses the
// shell so the state freezes for inspection instead of ticking into the
// fault every frame; Report still auto-saves the bmbug with movie+snap.
// The banner is sticky (status ticker preserves it) + a long toast popup so
// phone users see it. Non-trap faults (go-stall, wasm RuntimeError without
// trap_flag) now pause + save a fault bmbug too - previously they froze
// with only "step err ..." and no popup (the H-drop symptom).
function clearTrapBanner() {
  window.__bmTrapBanner = "";
  window.__bmTrapBannerKey = "";
}
function showTrapBanner(b) {
  window.__bmTrapBanner = b;
  try { shellStatusEl.textContent = b + " - paused; Report saves bmbug, Reset restarts"; } catch (e2) {}
  try { document.title = "BM-" + b.slice(0, 60); } catch (e3) {}
  try { toast(padToastEl, b + " - paused", 8000); } catch (e4) {}
}
function shellOnStepErr(e) {
  var ti = null;
  try { ti = (l2host.trapInfo && l2host.trapInfo()) || null; } catch (e4) {}
  var errMsg = String((e && e.message) || e);
  if (ti) {
    var key = l2host.frame() + ":" + (ti.name || "-") + ":" + ti.val;
    if (window.__bmTrapBannerKey !== key) {
      window.__bmTrapBannerKey = key;
      var b = formatTrapBanner(ti, l2host.frame(), prefs.engine);
      shellLog(b);
      showTrapBanner(b);
      shellLog("auto-paused on trap - state frozen for inspection");
    }
    if (replay.movie) replay.trapped = true;
    if (replay.movie && replay.mode === "playing") replay.mode = "paused";
    try { shellPause(true); } catch (e5) {}
  } else {
    shellLog("step err " + errMsg);
    var fb = "FAULT f=" + l2host.frame() + " err=" + errMsg.slice(0, 60);
    if (window.__bmTrapBanner !== fb) showTrapBanner(fb);
    try { shellAutoFaultReport(errMsg); } catch (e7) {}
    if (replay.movie) replay.trapped = true;
    if (replay.movie && replay.mode === "playing") replay.mode = "paused";
    try { shellPause(true); } catch (e6) {}
  }
}
async function shellStart() {
  if (shellRunning && !shellPaused) return l2host.frame();
  const pack = await l2ensurePack();
  if (!l2host.inst || l2host.frame() < 0) await l2host.spawn(pack, "build/game.wasm");
  try { clearTrapBanner(); } catch (e) {}
  window.__bmStaticHint = false; window.__bmStaticN = 0;
  try { if (audioPlayer) audioPlayer.reset(); } catch (e) {}
  try { if (pcmPlayer) pcmPlayer.reset(); } catch (e2) {}
  try { await ((l2host === mesenHost) ? ensurePcm().unlock() : ensureAudio().unlock()); syncAudioToPrefs(); }
  catch (e) { shellLog("audio locked: " + String((e && e.message) || e).slice(0, 60)); }
  shellRunning = true; shellPaused = false;
  shellLastT = 0;
  pauseBtn.textContent = "Pause";
  if (!shellRaf) shellLoop();
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  shellLog("start f=" + l2host.frame());
  return l2host.frame();
}
async function shellStop() {
  if (replay.recording) {
    try { toast(padToastEl, "finalizing take - opening save dialog...", 2500); } catch (e7) {}
    shellLog("stop: finalizing active take first - save dialog opening...");
    try { await replayToggleRecord(); } catch (e8) { shellLog("stop save err " + String((e8 && e8.message) || e8).slice(0, 80)); }
    try { recBtn.textContent = "Record"; } catch (e8e) {}
  }
  if (replay.movie) shellLog("replay cleared by stop");
  replay.movie = null; replay.mode = "idle"; replay.recording = null; replay.pauseSave = null; replay.trapped = false;
  anchorSave = null;
  shellRunning = false; shellPaused = false;
  if (shellRaf) { cancelAnimationFrame(shellRaf); shellRaf = 0; }
  try { l2host.terminate(); } catch (e) {}
  try { if (audioPlayer) audioPlayer.reset(); } catch (e) {}
  try { if (pcmPlayer) pcmPlayer.reset(); } catch (e2) {}
  pauseBtn.textContent = "Pause";
  shellLog("stop");
  return -1;
}
async function shellReset() {
  if (replay.recording) {
    try { toast(padToastEl, "finalizing take - opening save dialog...", 2500); } catch (e7b) {}
    shellLog("reset: finalizing active take first - save dialog opening...");
    try { await replayToggleRecord(); } catch (e8b) { shellLog("reset save err " + String((e8b && e8b.message) || e8b).slice(0, 80)); }
    try { recBtn.textContent = "Record"; } catch (e8f) {}
  }
  if (replay.movie) shellLog("replay cleared by reset (Movie up-arrow to reload)");
  replay.movie = null; replay.mode = "idle"; replay.recording = null; replay.pauseSave = null; replay.trapped = false;
  anchorSave = null;
  const pack = await l2ensurePack();
  await l2host.spawn(pack, "build/game.wasm");
  try { clearTrapBanner(); } catch (e) {}
  window.__bmStaticHint = false; window.__bmStaticN = 0;
  try { if (audioPlayer) audioPlayer.reset(); } catch (e) {}
  try { if (pcmPlayer) pcmPlayer.reset(); } catch (e2) {}
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  shellLog("reset f=" + l2host.frame());
  return l2host.frame();
}
function shellPause(on) {
  if (on === undefined) on = !shellPaused;
  shellPaused = !!on;
  pauseBtn.textContent = shellPaused ? "Resume" : "Pause";
  shellLog(shellPaused ? "paused" : "resumed");
  return shellPaused;
}
async function shellSave(slot) {
  const s = slot || prefs.slot;
  const d = await l2host.save(s);
  anchorSave = { slot: s, frame: d.frame, hash: d.hash || null };
  shellLog("saved slot " + s + " f=" + d.frame + (d.hash ? " hash=" + d.hash : ""));
  return d;
}
async function shellLoad(slot) {
  replay.busy = true;
  try {
  const s = slot || prefs.slot;
  await replayEnsureSpawned();
  replayProgress.last = -1;
  const f = await l2host.load(s, replayProgress);
  try { if (audioPlayer) audioPlayer.reset(); } catch (e) {}
  try { if (pcmPlayer) pcmPlayer.reset(); } catch (e2) {}
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  anchorSave = { slot: s, frame: f, hash: hash16() };
  if (replay.movie) { replay.mode = "idle"; shellLog("replay unloaded by manual load (anchor now save " + s + " f=" + f + ")"); }
  shellLog("loaded slot " + s + " f=" + f + " hash=" + anchorSave.hash);
  updateReplayStatus();
  return f;
  } finally { replay.busy = false; }
}
function dlFailed(via) { return /^(apk:FAILED|FAILED|apk-error|apk:timeout|timeout|apk:bad|bad-data|no-picker|apk:anchor-in-app)/.test(String(via || "")); }
function dlOkLine(what, via, where) {
  if (dlFailed(via)) return what + " NOT SAVED (" + via + ") - file did not reach Downloads";
  return what + " via " + via + " -> Downloads/" + where;
}
// On Android the WebView file download is silently dropped, so saves MUST go
// through the BMApk bridge. Old builds only exposed saveMovie and never asked
// for storage permission, so every save failed with no system popup. Ask for
// it when the bridge offers it; when a save still fails in-app, tell the user
// exactly where to grant it.
async function ensureApkStoragePermission() {
  try {
    if (window.BMApk && typeof window.BMApk.requestPermission === "function") {
      var r = window.BMApk.requestPermission("storage");
      if (r && r.then) r = await r;
      shellLog("storage permission: " + String(r).slice(0, 80));
      return String(r);
    }
  } catch (e) { shellLog("permission request err " + String((e && e.message) || e).slice(0, 60)); }
  return "";
}
function dlFailedToast(what, via) {
  if (!dlFailed(via)) return;
  var inApp = (typeof window.cordova !== "undefined") || location.protocol === "file:";
  if (inApp) toast(padToastEl, what + " NOT SAVED (" + via + ") - install the latest APK from Downloads, then tap again", 8000);
  else toast(padToastEl, what + " NOT SAVED (" + via + ")", 5000);
  shellLog("hint: name the file in the save dialog (system picker) - nothing is lost, tap again to retry");
  try { ensureApkStoragePermission(); } catch (e) {}
}
// Save-dialog plumbing: every MANUAL save (Record-stop, Movie export,
// Shot, Report tap) offers a real system save dialog when one exists, so
// the user names the file and picks where it goes. No storage permission
// is needed on any path: the system picker grant IS the permission (SAF
// picker in the APK, File System Access picker in desktop browsers,
// plain download otherwise). Auto-reports (trap/fault) stay silent and
// use the no-dialog path - a popup opening mid-crash would be hostile.
window.__bmSavePending = null;
window.__bmSaveResult = function (msg) {
  var cb = window.__bmSavePending; window.__bmSavePending = null;
  if (cb) { try { cb(String(msg)); } catch (e) {} }
}
function promptForName(defaultName) {
  return new Promise(function (res) {
    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;";
    var box = document.createElement("div");
    box.style.cssText = "background:#111;color:#eee;border:2px solid #6c6;padding:16px;max-width:92vw;";
    var lab = document.createElement("div");
    lab.textContent = "Save file as:";
    lab.style.cssText = "margin-bottom:8px;font-size:16px;";
    var inp = document.createElement("input");
    inp.value = defaultName;
    inp.style.cssText = "width:min(70vw,320px);font-size:16px;padding:10px;background:#222;color:#eee;border:1px solid #666;";
    var row = document.createElement("div");
    row.style.cssText = "margin-top:12px;display:flex;gap:8px;justify-content:flex-end;";
    var ok = document.createElement("button");
    ok.textContent = "Save";
    ok.style.cssText = "padding:12px;font-size:16px;";
    var no = document.createElement("button");
    no.textContent = "Cancel";
    no.style.cssText = "padding:12px;font-size:16px;";
    ok.addEventListener("click", function () { var v = inp.value || defaultName; try { ov.remove(); } catch (e) {} res(v); });
    no.addEventListener("click", function () { try { ov.remove(); } catch (e) {} res(null); });
    row.appendChild(no); row.appendChild(ok);
    box.appendChild(lab); box.appendChild(inp); box.appendChild(row);
    ov.appendChild(box);
    document.body.appendChild(ov);
    try { inp.focus(); inp.select(); } catch (e) {}
  });
}
function anchorSaveUrl(dataUrl, name) {
  var a = document.createElement("a");
  a.href = dataUrl; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { try { a.remove(); } catch (e) {} }, 2000);
}
async function saveBlobWithDialog(blob, dataUrlOrNull, defaultName, mime) {
  if (typeof window.showSaveFilePicker === "function") {
    try {
      var acc = {}; acc[mime] = [defaultName.slice(defaultName.lastIndexOf(".")) || ".bin"];
      var h = await window.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: "BM file", accept: acc }] });
      var w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return { via: "picker" };
    } catch (e) {
      if (e && e.name === "AbortError") return { via: "cancelled" };
      shellLog("save dialog failed, trying app save");
    }
  }
  if (dataUrlOrNull && window.BMApk && typeof window.BMApk.saveFileWithDialog === "function") {
    var verdict = await new Promise(function (res) {
      window.__bmSavePending = res;
      var r;
      try { r = window.BMApk.saveFileWithDialog(defaultName, mime, dataUrlOrNull); }
      catch (e) { window.__bmSavePending = null; res("apk-error:" + String((e && e.message) || e).slice(0, 60)); return; }
      if (String(r) !== "dialog:opened") { window.__bmSavePending = null; res(String(r)); return; }
      setTimeout(function () { if (window.__bmSavePending) { window.__bmSavePending = null; res("timeout-no-result"); } }, 180000);
    });
    if (verdict === "cancelled") return { via: "cancelled" };
    if (verdict === "timeout-no-result" || String(verdict).indexOf("FAILED") === 0 || String(verdict).indexOf("no-picker") === 0 || String(verdict).indexOf("bad-data") === 0 || String(verdict).indexOf("apk-error") === 0) {
      shellLog("system picker failed (" + String(verdict).slice(0, 60) + ") - trying named Downloads save instead");
      if (window.BMApk && typeof window.BMApk.saveFile === "function") {
        var fb;
        try { fb = window.BMApk.saveFile(defaultName, mime, dataUrlOrNull); }
        catch (e9) { fb = "apk-error:" + String((e9 && e9.message) || e9).slice(0, 60); }
        return { via: String(fb) };
      }
      var nmf = await promptForName(defaultName);
      if (nmf == null) return { via: "cancelled" };
      return { via: "anchor:" + nmf };
    }
    return { via: "apk:" + verdict };
  }
  if (dataUrlOrNull && window.BMApk && typeof window.BMApk.saveFile === "function") {
    var r2;
    try { r2 = window.BMApk.saveFile(defaultName, mime, dataUrlOrNull); }
    catch (e2) { r2 = "apk-error:" + String((e2 && e2.message) || e2).slice(0, 60); }
    return { via: String(r2) };
  }
  if (dataUrlOrNull && window.BMApk && typeof window.BMApk.saveMovie === "function") {
    var r3;
    try { r3 = window.BMApk.saveMovie(defaultName, dataUrlOrNull); }
    catch (e3) { r3 = "apk-error:" + String((e3 && e3.message) || e3).slice(0, 60); }
    return { via: "apk:" + String(r3) };
  }
  var nm = await promptForName(defaultName);
  if (nm == null) return { via: "cancelled" };
  return { via: "anchor:" + nm };
}
async function saveJsonWithDialog(obj, defaultName) {
  var text = JSON.stringify(obj);
  var blob = new Blob([text], { type: "application/json" });
  var durl = null;
  try { durl = await new Promise(function(res2) { var fr = new FileReader(); fr.onload = function() { var v = null; try { v = String(fr.result || ""); } catch (ee) {} res2(v); }; fr.onerror = function() { res2(null); }; try { fr.readAsDataURL(blob); } catch (ee2) { res2(null); } }); } catch (e) { durl = null; }
  var dl = await saveBlobWithDialog(blob, durl, defaultName, "application/json");
  if (dl.via === "cancelled") return dl;
  if (dl.via.indexOf("anchor:") === 0) {
    var nm = dl.via.slice(7);
    var inAppJ = (typeof window.cordova !== "undefined") || location.protocol === "file:";
    if (inAppJ && durl && window.BMApk && typeof window.BMApk.saveFile === "function") {
      var sfj;
      try { sfj = window.BMApk.saveFile(nm, "application/json", durl); }
      catch (e8j) { sfj = "apk-error:" + String((e8j && e8j.message) || e8j).slice(0, 60); }
      return { via: String(sfj), name: nm };
    }
    anchorSaveUrl(durl || ("data:application/json," + encodeURIComponent(text)), nm);
    return { via: "browser", name: nm };
  }
  return dl;
}
async function savePngWithDialog(dataUrl, defaultName) {
  var blob = null;
  try { blob = await (await fetch(dataUrl)).blob(); } catch (e) {}
  if (!blob) {
    var nm0 = await promptForName(defaultName);
    if (nm0 == null) return { via: "cancelled" };
    anchorSaveUrl(dataUrl, nm0);
    return { via: "browser", name: nm0 };
  }
  var dl = await saveBlobWithDialog(blob, dataUrl, defaultName, "image/png");
  if (dl.via === "cancelled") return dl;
  if (dl.via.indexOf("anchor:") === 0) {
    var nm = dl.via.slice(7);
    var inAppP = (typeof window.cordova !== "undefined") || location.protocol === "file:";
    if (inAppP && window.BMApk && typeof window.BMApk.saveFile === "function") {
      var sfp;
      try { sfp = window.BMApk.saveFile(nm, "image/png", dataUrl); }
      catch (e8p) { sfp = "apk-error:" + String((e8p && e8p.message) || e8p).slice(0, 60); }
      return { via: String(sfp), name: nm };
    }
    anchorSaveUrl(dataUrl, nm);
    return { via: "browser", name: nm };
  }
  return dl;
}
async function shellExportMovie() {
  if (!l2host.inst) throw new Error("not-started");
  if (replay.recording) {
    shellLog("finalizing active take, then exporting...");
    await replayToggleRecord();
  }
  const pads = l2host.padLog.slice(0, l2host.frame());
  const crc = await currentRomCrc();
  const m = makeMovieV2(pads, crc, { start: 0, anchorHash: null, engine: prefs.engine });
  var mdl = await saveJsonWithDialog(m, "bmmovie-f" + m.frame + ".json");
  var shown = mdl.name || ("bmmovie-f" + m.frame + ".json");
  if (mdl.via === "cancelled") shellLog("movie export cancelled");
  else shellLog(dlOkLine("movie exported f=" + m.frame + " rom=" + crc, mdl.via, shown));
  if (dlFailed(mdl.via)) { window.__bmLastTake = null; dlFailedToast("movie", mdl.via); }
  else if (mdl.via !== "cancelled") toast(padToastEl, "movie saved f=" + m.frame, 2500);
  return m;
}
async function shellImportMovie(file) {
  return replayLoadFile(file);
}
function shellScreenshot() {
  if (!l2host.inst) throw new Error("not-started");
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  return document.getElementById("gameCanvas").toDataURL("image/png");
}
async function shellFrame() {
  if (!l2host.inst) throw new Error("not-started");
  if (shellRunning && !shellPaused) throw new Error("pause-first");
  const r = await l2host.step(padBus.getMask());
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  return { frame: r.frame, hash: (r.hash >>> 0) };
}
// ---- Replay controller + take recorder (L6 movie UX) ----
// A replay = parsed movie + anchor + mode. Anchor = where pads[0] executes:
// boot (fresh spawn, frame 0) or a loaded savestate slot (frame M).
// v2 movies are self-contained: pads = FULL history boot->end, start = take
// offset, anchorHash = engine hash at take start. Replay always runs from
// boot through all pads; reaching start with a different hash throws
// anchor-mismatch instead of silently desyncing. v1 movies (old shares,
// retroarch imports) have no prefix: with a save anchor their pads apply
// FROM that save (unverifiable, logged as such), else from boot.
// Pause (R Pause) auto-saves the exact paused state and hands control to the
// live pad: manual play continues from there, optionally under Record (new
// take anchored at the pause point). Play resumes instantly when the state
// still matches the pause save, else restores it first. Stop halts
// advancement and keeps a safety savestate; Play after stop/initial load
// resets to the anchor and replays from the top.
const REPLAY_PAUSE_SLOT = "replay-pause";
let replay = { movie: null, anchor: { kind: "boot" }, mode: "idle", trapped: false, recording: null, pauseSave: null, busy: false };
let anchorSave = null;
function hash16() { return (l2host.hash() >>> 0).toString(16); }
async function currentRomCrc() {
  try { const id = await loadRomId(); if (id && id.crc32) return String(id.crc32); } catch (e) {}
  return "unknown";
}
function replayProgress(i, n) {
  const pc = Math.floor(i * 100 / n);
  if (pc !== replayProgress.last) { replayProgress.last = pc; shellLog("replay " + pc + "%"); }
}
replayProgress.last = -1;
function replayAnchorText() {
  if (replay.anchor.kind === "save") return "save " + replay.anchor.slot + " f=" + replay.anchor.frame;
  return "boot";
}
function updateReplayStatus() {
  try {
    if (!replay.movie) return;
    const total = replay.movie.pads.length;
    const idx = replayIndex();
    const rec = replay.recording ? (" rec take@" + replay.recording.start) : "";
    shellStatusEl.textContent = "replay " + replay.mode + " " + idx + "/" + total + " anchor:" + replayAnchorText() + rec;
  } catch (e) {}
}
function replayIndex() {
  if (!replay.movie) return 0;
  const base = replay.movie.version === 2 ? 0 : (replay.anchor.kind === "save" ? replay.anchor.frame : 0);
  return Math.max(0, l2host.frame() - base);
}
async function replayEnsureSpawned() {
  const pack = await l2ensurePack();
  if (!l2host.inst) await l2host.spawn(pack, "build/game.wasm");
  return pack;
}
// Advance the live engine from its current frame to targetFrame (pads from
// the movie), with progress + optional anchor-hash verification at arrival.
async function replayAdvanceTo(targetFrame, anchorHash) {
  const m = replay.movie;
  const base = m.version === 2 ? 0 : (replay.anchor.kind === "save" ? replay.anchor.frame : 0);
  replayProgress.last = -1;
  while (l2host.frame() < targetFrame) {
    const idx = l2host.frame() - base;
    if (idx < 0 || idx >= m.pads.length) throw new Error("replay-range idx=" + idx + " f=" + l2host.frame());
    const q = m.pads[idx];
    let j = idx + 1;
    const want = targetFrame - l2host.frame();
    while (j < m.pads.length && m.pads[j] === q && (j - idx) < want && (j - idx) < 600) j++;
    await l2host.go(j - idx, q);
    replayProgress(l2host.frame() - base, m.pads.length);
  }
  if (anchorHash != null) {
    const got = hash16();
    if (got !== String(anchorHash)) throw new Error("anchor-mismatch expect=" + anchorHash + " got=" + got + " (wrong ROM/save?)");
    shellLog("replay anchor ok f=" + l2host.frame() + " hash=" + got);
  }
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
}
// Position engine + index for PLAY-from-top (anchor start, pads from 0).
async function replayPositionForPlay() {
  const m = replay.movie;
  if (m.version === 1 && replay.anchor.kind === "save") {
    replayProgress.last = -1;
    await l2host.load(replay.anchor.slot, replayProgress);
    return;
  }
  const pack = await l2ensurePack();
  await l2host.spawn(pack, "build/game.wasm");
}
async function replayLoadParsed(m) {
  replay.busy = true;
  try {
  await replayEnsureSpawned();
  if (anchorSave && anchorSave.slot != null) replay.anchor = { kind: "save", slot: anchorSave.slot, frame: anchorSave.frame, hash: anchorSave.hash };
  else replay.anchor = { kind: "boot" };
  replay.movie = m;
  replay.trapped = false;
  replay.pauseSave = null;
  try { clearTrapBanner(); } catch (e) {}
  shellLog("replay loaded " + m.pads.length + "f v" + m.version + " anchor:" + replayAnchorText());
  if (m.version === 2 && replay.anchor.kind === "save" && replay.anchor.frame === m.start && replay.anchor.hash && m.anchorHash && replay.anchor.hash === m.anchorHash) {
    shellLog("replay anchor = loaded save (verified), fast restore");
    replayProgress.last = -1;
    await l2host.load(replay.anchor.slot, replayProgress);
  } else if (m.version === 2 && m.start > 0) {
    shellLog("replay self-contained prefix, advancing to take@" + m.start);
    const pack = await l2ensurePack();
    await l2host.spawn(pack, "build/game.wasm");
    await replayAdvanceTo(m.start, m.anchorHash);
  } else if (m.version === 2) {
    if (replay.anchor.kind === "save") shellLog("replay save anchor is not the take anchor - using self-contained prefix instead");
    const pack = await l2ensurePack();
    await l2host.spawn(pack, "build/game.wasm");
    await replayAdvanceTo(m.start, m.anchorHash);
  } else {
    if (replay.anchor.kind === "save") {
      shellLog("v1 replay: no anchor hash, starting from save (unverifiable)");
      replayProgress.last = -1; await l2host.load(replay.anchor.slot, replayProgress);
    } else { const pack = await l2ensurePack(); await l2host.spawn(pack, "build/game.wasm"); }
  }
  replay.mode = "loaded";
  if (!shellRunning) { shellRunning = true; if (!shellRaf) shellLoop(); }
  shellPause(true);
  updateReplayStatus();
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  return l2host.frame();
  } finally { replay.busy = false; }
}
async function replayLoadFile(file) {
  replay.busy = true;
  try {
  const text = await file.text();
  const m = parseMovie(JSON.parse(text));
  const crc = await currentRomCrc();
  if (String(m.rom) !== String(crc)) shellLog("movie rom " + m.rom + " vs current " + crc + " (replaying anyway)");
  try {
    return await replayLoadParsed(m);
  } catch (e) {
    replay.movie = null; replay.mode = "idle";
    shellLog("replay load err " + String((e && e.message) || e).slice(0, 80));
    updateReplayStatus();
    throw e;
  }
  } finally { replay.busy = false; }
}
async function replayPlay() {
  replay.busy = true;
  try {
  if (!replay.movie) { shellLog("replay: no movie loaded (Movie up-arrow first)"); return l2host.frame(); }
  if (replay.mode === "playing") return l2host.frame();
  if (replay.recording) { shellLog("replay: stop recording first (Record off)"); return l2host.frame(); }
  if (replay.mode === "paused" && !replay.trapped && replay.pauseSave) {
    const ps = replay.pauseSave;
    if (l2host.frame() === ps.frame && hash16() === ps.hash) {
      replay.mode = "playing";
      try { shellPaused = false; pauseBtn.textContent = "Pause"; } catch (e) {}
      if (!shellRunning) shellRunning = true;
      if (!shellRaf) shellLoop();
      shellLog("replay resume f=" + ps.frame);
      updateReplayStatus();
      return l2host.frame();
    }
    shellLog("replay diverged since pause - restoring pause state f=" + ps.frame);
    replayProgress.last = -1;
    await l2host.load(REPLAY_PAUSE_SLOT, replayProgress);
    replay.mode = "playing";
    try { shellPaused = false; pauseBtn.textContent = "Pause"; } catch (e) {}
    if (!shellRunning) shellRunning = true;
    if (!shellRaf) shellLoop();
    updateReplayStatus();
    return l2host.frame();
  }
  replayProgress.last = -1;
  await replayPositionForPlay();
  replay.trapped = false;
  try { clearTrapBanner(); } catch (e) {}
  replay.mode = "playing";
  try { shellPaused = false; pauseBtn.textContent = "Pause"; } catch (e) {}
  if (!shellRunning) shellRunning = true;
  if (!shellRaf) shellLoop();
  shellLog("replay play from " + replayAnchorText());
  updateReplayStatus();
  return l2host.frame();
  } finally { replay.busy = false; }
}
async function replayPause() {
  replay.busy = true;
  try {
  if (!replay.movie || replay.mode !== "playing") { shellLog("replay: nothing playing to pause"); return l2host.frame(); }
  const data = await l2host.save(REPLAY_PAUSE_SLOT);
  replay.pauseSave = { frame: data.frame, hash: data.hash, idx: replayIndex() };
  replay.mode = "paused";
  shellLog("replay paused f=" + data.frame + " hash=" + data.hash + " (savestate kept) - drive manually or Record, R Play resumes");
  updateReplayStatus();
  return data.frame;
  } finally { replay.busy = false; }
}
async function replayRestart() {
  replay.busy = true;
  try {
  if (!replay.movie) { shellLog("replay: no movie loaded"); return l2host.frame(); }
  replayProgress.last = -1;
  await replayPositionForPlay();
  replay.trapped = false;
  try { clearTrapBanner(); } catch (e) {}
  replay.mode = "playing";
  try { shellPaused = false; pauseBtn.textContent = "Pause"; } catch (e) {}
  if (!shellRunning) shellRunning = true;
  if (!shellRaf) shellLoop();
  shellLog("replay restart from " + replayAnchorText());
  updateReplayStatus();
  return l2host.frame();
  } finally { replay.busy = false; }
}
async function replayStop() {
  if (replay.recording) {
    try { toast(padToastEl, "finalizing take - opening save dialog...", 2500); } catch (e7c) {}
    shellLog("r-stop: finalizing active take first - save dialog opening...");
    try { await replayToggleRecord(); } catch (e8c) { shellLog("r-stop save err " + String((e8c && e8c.message) || e8c).slice(0, 80)); }
    try { recBtn.textContent = "Record"; } catch (e8d) {}
  }
  replay.busy = true;
  try {
  if (!replay.movie || replay.mode === "idle") { shellLog("replay: nothing to stop"); return l2host.frame(); }
  const data = await l2host.save(REPLAY_PAUSE_SLOT);
  replay.pauseSave = { frame: data.frame, hash: data.hash, idx: replayIndex() };
  replay.mode = "stopped";
  shellLog("replay stopped f=" + data.frame + " (savestate kept) - R Play restarts from " + replayAnchorText());
  updateReplayStatus();
  return data.frame;
  } finally { replay.busy = false; }
}
async function replayToggleRecord() {
  if (replay.recording) {
    try { toast(padToastEl, "finalizing take - opening save dialog...", 2500); } catch (e4) {}
    shellLog("finalizing take - opening save dialog...");
    const pads = l2host.padLog.slice(0, l2host.frame());
    const m = makeMovieV2(pads, await currentRomCrc(), { start: replay.recording.start, anchorHash: replay.recording.hash, engine: prefs.engine });
    var tdl = await saveJsonWithDialog(m, "bmmovie-f" + m.frame + "-take" + m.start + ".json");
    var tshown = tdl.name || ("bmmovie-f" + m.frame + "-take" + m.start + ".json");
    window.__bmLastTake = m;
    if (tdl.via === "cancelled") shellLog("take save cancelled - take kept, Record again to save");
    else shellLog(dlOkLine("take saved f=" + m.frame + " take@" + m.start + " anchor=" + m.anchorHash, tdl.via, tshown));
    if (dlFailed(tdl.via)) dlFailedToast("take", tdl.via);
    else if (tdl.via !== "cancelled") toast(padToastEl, "take saved f=" + m.frame, 2500);
    replay.recording = null;
    updateReplayStatus();
    return m.frame;
  }
  if (!l2host.inst) { shellLog("record: Start first"); return -1; }
  if (replay.mode === "playing") { shellLog("record: pause the replay first (R Pause)"); return -1; }
  replay.busy = true;
  try {
    if (anchorSave && anchorSave.slot != null) {
      shellLog("record: rewinding to save " + anchorSave.slot + " f=" + anchorSave.frame + " so the take stays synced");
      replayProgress.last = -1;
      var rlf = await l2host.load(anchorSave.slot, replayProgress);
      anchorSave = { slot: anchorSave.slot, frame: rlf, hash: hash16() };
    } else {
      shellLog("record: rebooting to boot so the take stays synced");
      var rpack = await l2ensurePack();
      await l2host.spawn(rpack, "build/game.wasm");
    }
    try { clearTrapBanner(); } catch (e) {}
    window.__bmStaticHint = false; window.__bmStaticN = 0;
    try { if (audioPlayer) audioPlayer.reset(); } catch (e2) {}
    try { if (pcmPlayer) pcmPlayer.reset(); } catch (e3) {}
    ensureVideo();
    video.upload(l2host.videoBytes());
    video.present();
    replay.recording = { start: l2host.frame(), hash: hash16() };
    shellLog("recording take@" + replay.recording.start + " anchor=" + replay.recording.hash + " - drive, Record again to save");
    updateReplayStatus();
    return replay.recording.start;
  } catch (e) { shellLog("record reset err " + String((e && e.message) || e).slice(0, 80)); return -1; }
  finally { replay.busy = false; }
}
// One paced replay frame: movie pad for the current engine frame, anchor
// verification at the take start, clean end-of-movie stop.
async function replayStepOnce() {
  const m = replay.movie;
  const base = m.version === 2 ? 0 : (replay.anchor.kind === "save" ? replay.anchor.frame : 0);
  const idx = l2host.frame() - base;
  if (idx < 0) throw new Error("replay-behind-anchor f=" + l2host.frame());
  if (idx >= m.pads.length) {
    replay.mode = "ended";
    try { shellPause(true); } catch (e) {}
    shellLog("replay ended f=" + l2host.frame() + " hash=" + hash16());
    updateReplayStatus();
    await presentFrame();
    return 0;
  }
  if (m.version === 2 && m.anchorHash != null && idx === m.start && l2host.frame() !== 0) {
    const got = hash16();
    if (got !== String(m.anchorHash)) throw new Error("anchor-mismatch expect=" + m.anchorHash + " got=" + got + " (wrong ROM/save?)");
  }
  const h = await Promise.race([l2host.go(1, m.pads[idx]), new Promise((rr, jj) => setTimeout(() => jj(new Error("go-stall")), 2500))]);
  await presentFrame();
  if ((l2host.frame() & 31) === 0) updateReplayStatus();
  return h;
}
window.BM.start = shellStart;
window.BM.stop = shellStop;
window.BM.reset = shellReset;
window.BM.pause = shellPause;
window.BM.save = shellSave;
window.BM.load = shellLoad;
window.BM.exportMovie = shellExportMovie;
window.BM.importMovieFile = shellImportMovie;
window.BM.replayPlay = replayPlay;
window.BM.replayPause = replayPause;
window.BM.replayRestart = replayRestart;
window.BM.replayStop = replayStop;
window.BM.toggleRecord = replayToggleRecord;
window.BM.replayStatus = function () { return { mode: replay.mode, idx: replayIndex(), total: replay.movie ? replay.movie.pads.length : 0, anchor: replayAnchorText(), recording: !!replay.recording, trapped: replay.trapped }; };
window.BM.replayMovieData = async function (m) {
  const parsed = parseMovie(m);
  shellPause(true);
  const f = await replayMovie(l2host, parsed.pads, null);
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  return { frame: f, hash: l2host.hash() >>> 0 };
};
window.BM.screenshot = shellScreenshot;
window.BM.frame = shellFrame;
window.BM.log = shellLog;
window.BM.stats = ((prev) => () => Object.assign(prev(), {
  running: shellRunning, paused: shellPaused, engineFrame: l2host.frame(),
  fps: video ? video.fps : shellFps,
  pcm: (typeof pcmPlayer !== "undefined" && pcmPlayer) ? pcmPlayer.stats() : null,
  scale: prefs.scale, filter: prefs.filter,
  volume: prefs.volume, muted: prefs.muted, slot: prefs.slot,
  engine: prefs.engine
}))(window.BM.stats);
startBtn.addEventListener("click", () => {
  if (replay.movie && replay.mode !== "idle") { shellLog("replay loaded - R Play / R Stop control playback (manual Start paused)"); return; }
  shellStart().catch((e) => { shellLog("start err " + e.message); statusEl.textContent = "start err " + e.message; });
});
stopBtn.addEventListener("click", () => { try { toast(padToastEl, "stopping...", 1200); } catch (e6) {} shellStop().catch(replayErr("stop err")); });
resetBtn.addEventListener("click", () => {
  shellReset().catch((e) => { shellLog("reset err " + e.message); statusEl.textContent = "reset err " + e.message; });
});
pauseBtn.addEventListener("click", () => {
  if (replay.movie && replay.mode === "playing") { replayPause().catch((e) => { shellLog("replay pause err " + e.message); }); return; }
  if (replay.movie && replay.mode === "paused") { replayPlay().catch((e) => { shellLog("replay play err " + e.message); }); return; }
  shellPause();
});
saveBtn.addEventListener("click", () => {
  shellSave().catch((e) => { shellLog("save err " + e.message); });
});
loadBtn.addEventListener("click", () => {
  shellLoad().catch((e) => { shellLog("load err " + e.message); });
});
movieBtn.addEventListener("click", () => {
  shellExportMovie().catch((e) => { shellLog("movie export err " + e.message); });
});
movieLoadBtn.addEventListener("click", () => { movieInput.click(); });
movieInput.addEventListener("change", () => {
  const f = movieInput.files && movieInput.files[0];
  movieInput.value = "";
  if (f) shellImportMovie(f).catch(() => {});
});
const rPlayBtn = document.getElementById("rPlayBtn");
const rPauseBtn = document.getElementById("rPauseBtn");
const rRestartBtn = document.getElementById("rRestartBtn");
const rStopBtn = document.getElementById("rStopBtn");
const recBtn = document.getElementById("recBtn");
function replayErr(tag) {
  return (e) => { var em = String((e && e.message) || e).slice(0, 80); shellLog(tag + " " + em); try { shellStatusEl.textContent = tag + " " + em.slice(0, 60); } catch (e2) {} try { toast(padToastEl, tag + " " + em.slice(0, 60), 4000); } catch (e3) {} };
}
if (rPlayBtn) rPlayBtn.addEventListener("click", () => { replayPlay().catch(replayErr("replay play err")); });
if (rPauseBtn) rPauseBtn.addEventListener("click", () => { replayPause().catch(replayErr("replay pause err")); });
if (rRestartBtn) rRestartBtn.addEventListener("click", () => { replayRestart().catch(replayErr("replay restart err")); });
if (rStopBtn) rStopBtn.addEventListener("click", () => { try { toast(padToastEl, replay.recording ? "finalizing take - opening save dialog..." : "stopping replay...", 2000); } catch (e5b) {} replayStop().catch(replayErr("replay stop err")); });
if (recBtn) recBtn.addEventListener("click", () => {
  try { toast(padToastEl, replay.recording ? "finalizing take - opening save dialog..." : "starting synced take...", 2000); } catch (e5) {}
  replayToggleRecord().then(() => {
    try { recBtn.textContent = replay.recording ? "Stop+Save" : "Record"; } catch (e) {}
  }).catch(replayErr("record err"));
});
shotBtn.addEventListener("click", async () => {
  try {
    const u = shellScreenshot();
    const f = l2host.inst ? l2host.frame() : 0;
    var sdl = await savePngWithDialog(u, "bmshot-f" + f + ".png");
    var sShown = sdl.name || ("bmshot-f" + f + ".png");
    if (sdl.via === "cancelled") shellLog("shot cancelled");
    else shellLog(dlOkLine("shot f=" + f + " " + u.length + "B", sdl.via, sShown));
    if (dlFailed(sdl.via)) dlFailedToast("shot", sdl.via);
    else if (sdl.via !== "cancelled") toast(padToastEl, "shot saved " + sShown, 1500);
  }
  catch (e) { shellLog("shot err " + e.message); }
});
slotSel.addEventListener("change", () => {
  prefs.slot = parseInt(slotSel.value, 10) || 1;
  savePrefs(prefs);
  shellLog("slot " + prefs.slot);
});
scaleSel.addEventListener("change", () => {
  prefs.scale = scaleSel.value; savePrefs(prefs); applyVideoPrefs();
  shellLog("scale " + prefs.scale);
});
filterSel.addEventListener("change", () => {
  prefs.filter = filterSel.value; savePrefs(prefs); applyVideoPrefs();
  shellLog("filter " + prefs.filter);
});
fsBtn.addEventListener("click", async () => {
  try {
    ensureVideo();
    if (document.fullscreenElement) await video.exitFullscreen();
    else await video.enterFullscreen(playCtn);
    shellLog("fullscreen " + (!!document.fullscreenElement));
  } catch (e) { shellLog("fullscreen err " + String((e && e.message) || e).slice(0, 60)); }
});
volumeInput.addEventListener("input", () => {
  prefs.volume = Math.max(0, Math.min(1, Number(volumeInput.value) / 100));
  savePrefs(prefs);
  try { ensureAudio().setVolume(prefs.volume); } catch (e) {}
});
muteBtn.addEventListener("click", () => {
  prefs.muted = !prefs.muted; savePrefs(prefs); syncAudioToPrefs();
  shellLog(prefs.muted ? "muted" : "unmuted");
});
const engineSel = document.getElementById("engineSel");
const swapABInput = document.getElementById("swapABInput");
const swapXYInput = document.getElementById("swapXYInput");
engineSel.value = prefs.engine;
swapABInput.checked = !!prefs.swapAB;
swapXYInput.checked = !!prefs.swapXY;
padFlags.swapAB = !!prefs.swapAB;
padFlags.swapXY = !!prefs.swapXY;
if (!qs.has("headless") && prefs.engine === "mesen") { l2host = mesenHost; agentPad.host = l2host; }
engineSel.addEventListener("change", () => {
  const want = engineSel.value === "mesen" ? "mesen" : "wasm";
  if (want === prefs.engine) return;
  try { shellStop(); } catch (e) {}
  prefs.engine = want; savePrefs(prefs);
  l2host = (want === "mesen") ? mesenHost : wasmHost;
  agentPad.host = l2host;
  try { ensureVideo(); video.upload(l2host.videoBytes()); video.present(); } catch (e2) {}
  shellLog("engine " + want + " (takes effect on Start)");
});
swapABInput.addEventListener("change", () => {
  prefs.swapAB = !!swapABInput.checked; padFlags.swapAB = prefs.swapAB; savePrefs(prefs);
  shellLog("swap A/B " + (prefs.swapAB ? "on" : "off"));
});
const touchInput = document.getElementById("touchInput");
if (touchInput) {
  touchInput.checked = prefs.touch !== false;
  if (prefs.touch === false && touchUI) { try { touchUI.unmount(); } catch (e) {} touchUI = null; }
  touchInput.addEventListener("change", () => {
    prefs.touch = !!touchInput.checked;
    savePrefs(prefs);
    if (prefs.touch === false) {
      try { if (touchUI) touchUI.unmount(); } catch (e) {}
      touchUI = null;
      shellLog("touch pad off");
    } else {
      if (!touchUI) { try { touchUI = mountTouch(padBus, document.getElementById("touchCtn") || undefined); } catch (e) { shellLog("touch err " + String((e && e.message) || e).slice(0, 60)); } }
      shellLog("touch pad on");
    }
  });
}
swapXYInput.addEventListener("change", () => {
  prefs.swapXY = !!swapXYInput.checked; padFlags.swapXY = prefs.swapXY; savePrefs(prefs);
  shellLog("swap X/Y " + (prefs.swapXY ? "on" : "off"));
});
setInterval(() => {
  try {
    if (!shellStatusEl) return;
    if (window.__bmTrapBanner) shellStatusEl.textContent = window.__bmTrapBanner + " - paused; Report saves bmbug, Reset restarts | " + fmtStatus(window.BM.stats());
    else shellStatusEl.textContent = fmtStatus(window.BM.stats());
  } catch (e) {}
}, 500);
shellLog("shell ready: start/reset/pause + slots + volume + scale/filter/fullscreen");
try {
  const hasBridge = !!(window.BMApk && typeof window.BMApk.saveMovie === "function");
  const inApp = (typeof window.cordova !== "undefined") || location.protocol === "file:";
  fetch("PACKAGING.json").then(r => r.ok ? r.json() : null).then(q => {
    if (q) { window.__bmWww = "www v" + q.version; shellLog("www v" + q.version + " git " + (q.git || "?") + " built " + (q.built || "?")); }
  }).catch(() => {});
  var hasFile = !!(window.BMApk && typeof window.BMApk.saveFile === "function");
  var hasMovie = !!(window.BMApk && typeof window.BMApk.saveMovie === "function");
  var canPerm = !!(window.BMApk && typeof window.BMApk.requestPermission === "function");
  var hasDlg = !!(window.BMApk && typeof window.BMApk.saveFileWithDialog === "function");
  var inApp2 = (typeof window.cordova !== "undefined") || location.protocol === "file:";
  window.__bmBridge = "apk" + (inApp2 ? "+" : "-") + " saveFile=" + (hasFile ? "yes" : "no") + " saveMovie=" + (hasMovie ? "yes" : "no") + " saveDlg=" + (hasDlg ? "yes" : "no");
  shellLog("BMApk bridge: saveFile=" + (hasFile ? "yes" : "no") + " saveMovie=" + (hasMovie ? "yes" : "no") + " saveDlg=" + (hasDlg ? "yes" : "no") + " requestPermission=" + (canPerm ? "yes" : "no") + (inApp2 ? " (APK/file)" : " (browser: anchor downloads used)"));
  if (inApp2 && !hasFile && !hasMovie) shellLog("saves will NOT reach Downloads in this build - no bridge; update the APK");
} catch (e) {}

const fail6 = (s) => { document.title = "BM-L6-FAIL:" + s; };

async function selfTestL6() {
  document.title = "BM-L6-RUNNING";
  try {
    const need = ["startBtn", "stopBtn", "resetBtn", "pauseBtn", "slotSel", "saveBtn", "loadBtn", "shotBtn", "scaleSel", "filterSel", "fsBtn", "volumeInput", "muteBtn", "shellStatus", "logEl", "playCtn", "gameCanvas"];
    for (const id of need) {
      const el = document.getElementById(id);
      if (!el) return fail6("missing:" + id);
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return fail6("invisible:" + id);
    }
    for (const id of ["startBtn", "stopBtn", "resetBtn", "pauseBtn", "saveBtn", "loadBtn", "shotBtn", "fsBtn", "muteBtn"]) {
      const r = document.getElementById(id).getBoundingClientRect();
      if (!(r.height >= 40 && r.width >= 40)) return fail6("small:" + id);
    }
    for (const id of ["slotSel", "scaleSel", "filterSel"]) {
      const r = document.getElementById(id).getBoundingClientRect();
      if (!(r.height >= 40)) return fail6("small-sel:" + id);
    }
    const rb = document.getElementById("resetBtn");
    if (rb.textContent.toLowerCase().indexOf("reset") < 0) return fail6("reset-label");
    const keepScale = prefs.scale, keepFilter = prefs.filter;
    const keepVol = prefs.volume, keepMuted = prefs.muted, keepSlot = prefs.slot;
    prefs.scale = "fit"; prefs.filter = "bilinear"; prefs.volume = 0.5; prefs.muted = true; prefs.slot = 3;
    savePrefs(prefs);
    const back = loadPrefs();
    if (back.scale !== "fit" || back.filter !== "bilinear" || back.volume !== 0.5 || back.muted !== true || back.slot !== 3) return fail6("prefs-roundtrip");
    prefs.scale = keepScale; prefs.filter = keepFilter; prefs.volume = keepVol; prefs.muted = keepMuted; prefs.slot = keepSlot;
    savePrefs(prefs);
    slotSel.value = String(prefs.slot); scaleSel.value = prefs.scale; filterSel.value = prefs.filter;
    volumeInput.value = String(Math.round(prefs.volume * 100));
    syncAudioToPrefs(); applyVideoPrefs();
    statusEl.textContent = "L6: shell session via BM.start";
    const seedPack = await l2ensurePackForTest();
    await savePack(seedPack);
    await window.BM.start();
    await window.BM.pause(true);
    if (l2host.frame() !== 0) return fail6("start-frame:" + l2host.frame());
    await l2host.go(2700, 0);
    await window.BM.press(5, 8);
    if (l2host.frame() !== 2705) return fail6("press-frame:" + l2host.frame());
    agentPad.setPad(65);
    await l2host.go(295, padBus.getMask());
    agentPad.setPad(0);
    if (l2host.frame() !== 3000) return fail6("room-frame:" + l2host.frame());
    const v = l2host.videoBytes();
    let nz = 0;
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) nz++;
    if (nz < 1000) return fail6("video-blank");
    const O = await loadOraclePixels("work/oracle.png");
    if (eqB(v, O.px)) return fail6("still-on-title");
    const shot = window.BM.screenshot();
    if (shot.indexOf("data:image/png") !== 0) return fail6("shot-type");
    if (shot.length < 4000) return fail6("shot-tiny:" + shot.length);
    const pc = document.createElement("canvas");
    const vr2 = new VideoRenderer(pc);
    vr2.resize(256, 240, 1);
    vr2.setMode("integer", "nearest");
    vr2.gl.viewport(0, 0, 256, 240);
    vr2.gl.clearColor(0, 0, 0, 1);
    vr2.gl.clear(vr2.gl.COLOR_BUFFER_BIT);
    const blankH = strFnv(pc.toDataURL());
    vr2.upload(l2host.videoBytes());
    if (vr2.present() !== 0) return fail6("shot-present");
    const shownH = strFnv(pc.toDataURL());
    if (blankH === shownH) return fail6("shot-nodraw");
    const f0 = l2host.frame(), h0 = l2host.hash();
    await window.BM.save(3);
    await window.BM.reset();
    if (l2host.frame() !== 0) return fail6("reset2-frame");
    if (l2host.hash() === h0) return fail6("reset2-hash-same");
    const lf = await window.BM.load(3);
    if (lf !== f0) return fail6("load-frame:" + lf);
    if (l2host.hash() !== h0) return fail6("load-hash");
    const st = window.BM.stats();
    if (!st.ok || st.errors.length !== 0) return fail6("stats-errors");
    if (st.engineFrame !== f0 || st.slot !== prefs.slot) return fail6("stats-fields");
    if (st.scale !== prefs.scale || st.volume !== prefs.volume) return fail6("stats-prefs");
    await window.BM.pause(false);
    await window.BM.stop();
    if (window.BM.stats().running) return fail6("stop-running");
    statusEl.textContent = "L6 shell PASS f=" + f0;
    shellLog("L6 self-test PASS f=" + f0 + " hash=" + h0.toString(16));
    document.title = "BM-L6-PASS";
  } catch (e) { fail6("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
async function selfTestL6Save() {
  document.title = "BM-L6-RUNNING";
  try {
    const pack = await l2ensurePackForTest();
    await savePack(pack);
    await window.BM.start();
    await window.BM.pause(true);
    await window.BM.reset();
    await l2host.go(2700, 0);
    await window.BM.press(5, 8);
    agentPad.setPad(65);
    await l2host.go(295, padBus.getMask());
    agentPad.setPad(0);
    if (l2host.frame() !== 3000) return fail6("save-frame:" + l2host.frame());
    await window.BM.save(7);
    const h = l2host.hash().toString(16);
    document.title = "BM-L6-SAVED:" + l2host.frame() + ":" + h;
  } catch (e) { fail6("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
async function selfTestL6Reload() {
  document.title = "BM-L6-RUNNING";
  try {
    const want = qs.get("want") || "";
    const parts = want.split(":");
    if (parts.length !== 2) return fail6("no-want");
    const pack = await loadPack();
    if (!pack || !validatePack(pack).ok) return fail6("pack-norestore");
    await window.BM.start();
    await window.BM.pause(true);
    const f = await window.BM.load(7);
    const h = l2host.hash().toString(16);
    if (String(f) !== parts[0] || h !== parts[1]) return fail6("slot-mismatch:" + f + ":" + h);
    const v = l2host.videoBytes();
    let nz = 0;
    for (let i = 0; i < v.length; i++) if (v[i] !== 0) nz++;
    if (nz < 1000) return fail6("video-blank");
    document.title = "BM-L6-RESTORED:" + f + ":" + h;
    statusEl.textContent = "pack + slot 7 restored, f=" + f;
  } catch (e) { fail6("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const t6 = qs.get("test");
  if (t6 === "l6") selfTestL6();
  else if (t6 === "l6save") selfTestL6Save();
  else if (t6 === "l6reload") selfTestL6Reload();
}
const failM = (s) => { document.title = "BM-MOVIE-FAIL:" + s; };
const failR = (s) => { document.title = "BM-REPLAY-FAIL:" + s; };
async function playToEnd(cap) {
  let n = 0;
  while (replay.mode === "playing") {
    if (++n > cap) return failR("cap");
    await replayStepOnce();
  }
  return null;
}
async function selfTestReplay() {
  document.title = "BM-REPLAY-RUNNING";
  try {
    statusEl.textContent = "replay: scripted 300f run";
    anchorSave = null;
    replay.movie = null; replay.mode = "idle";
    const pack = await l2ensurePackForTest();
    await l2host.spawn(pack, "build/game.wasm");
    const script = (f) => (f >= 40 && f < 45) ? 8 : ((f % 120 < 5) ? 65 : 0);
    let f = 0;
    while (f < 300) { const q = script(f); let j = f + 1; while (j < 300 && script(j) === q) j++; await l2host.go(j - f, q); f = j; }
    if (l2host.frame() !== 300) return failR("run-frame:" + l2host.frame());
    const endHash = hash16();
    const hash150 = (l2host.hashLog[149] >>> 0).toString(16);
    const pads = l2host.padLog.slice(0, 300);
    const m = makeMovieV2(pads, "testcrc", { start: 150, anchorHash: hash150, engine: "wasm" });
    const parsed = parseMovie(JSON.parse(JSON.stringify(m)));
    if (parsed.version !== 2 || parsed.start !== 150 || parsed.anchorHash !== hash150) return failR("v2-rt");
    statusEl.textContent = "replay: load (advance to take@150)";
    await replayLoadParsed(parsed);
    shellPause(true);
    if (l2host.frame() !== 150) return failR("load-frame:" + l2host.frame());
    if (hash16() !== hash150) return failR("load-hash");
    if (replay.mode !== "loaded") return failR("load-mode:" + replay.mode);
    statusEl.textContent = "replay: full play from anchor";
    await replayPlay();
    shellPause(true);
    await playToEnd(2000);
    if (replay.mode !== "ended") return failR("end-mode:" + replay.mode);
    if (hash16() !== endHash) return failR("end-hash");
    statusEl.textContent = "replay: pause at 50, diverge, resume";
    await replayRestart();
    shellPause(true);
    while (l2host.frame() < 50) await replayStepOnce();
    await replayPause();
    shellPause(true);
    if (!replay.pauseSave || replay.pauseSave.frame !== 50) return failR("pause-frame");
    if (replay.pauseSave.hash !== hash16()) return failR("pause-hash");
    await l2host.go(10, 65);
    if (l2host.frame() !== 60) return failR("diverge-frame");
    await replayPlay();
    shellPause(true);
    if (l2host.frame() !== 50) return failR("resume-frame:" + l2host.frame());
    if (hash16() !== replay.pauseSave.hash) return failR("resume-hash");
    await playToEnd(2000);
    if (hash16() !== endHash) return failR("resume-end-hash");
    statusEl.textContent = "replay: stop then play from top";
    await replayRestart();
    shellPause(true);
    while (l2host.frame() < 30) await replayStepOnce();
    await replayStop();
    shellPause(true);
    if (replay.mode !== "stopped") return failR("stop-mode");
    await replayPlay();
    shellPause(true);
    await playToEnd(2000);
    if (hash16() !== endHash) return failR("stopplay-hash");
    statusEl.textContent = "replay: slot save/load verify";
    await shellSave(8);
    await shellLoad(8);
    if (l2host.frame() !== 300) return failR("slot-frame:" + l2host.frame());
    if (hash16() !== endHash) return failR("slot-hash");
    statusEl.textContent = "replay self-test PASS";
    document.title = "BM-REPLAY-PASS";
  } catch (e) { failR("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
async function selfTestMovie() {
  document.title = "BM-MOVIE-RUNNING";
  try {
    const pack = await l2ensurePackForTest();
    await l2host.spawn(pack, "build/game.wasm");
    for (let f = 1; f < 2700; f++) await l2host.go(1, 0);
    await l2host.go(5, 8);
    for (let f = 2705; f < 3000; f++) await l2host.go(1, 129);
    const pads = l2host.padLog.slice(0, l2host.frame());
    if (pads.length !== 2999) return failM("padlog:" + pads.length);
    const m = makeMovie(pads, "testcrc");
    const parsed = parseMovie(JSON.parse(JSON.stringify(m)));
    if (parsed.frame !== 2999 || parsed.pads[2702] !== 8 || parsed.pads[2998] !== 129) return failM("rt");
    const h0 = l2host.hash();
    const st = await replayMovie(l2host, parsed.pads, null);
    if (st !== 2999) return failM("frame:" + st);
    if (l2host.hash() !== h0) return failM("hash");
    statusEl.textContent = "movie self-test PASS f=2999";
    document.title = "BM-MOVIE-PASS";
  } catch (e) { failM("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const tm = qs.get("test");
  if (tm === "movie") selfTestMovie(); else if (tm === "replay") selfTestReplay();
}
const failMesen = (s) => { document.title = "BM-MESEN-FAIL:" + s; };
async function selfTestMesen() {
  document.title = "BM-MESEN-RUNNING";
  try {
    const pack = await l2ensurePackForTest();
    const h = new MesenHost();
    await h.spawn(pack);
    const A = await h.go(40, 0);
    await h.reset();
    const B = await h.go(40, 0);
    if (!eqH(A, B)) return failMesen("reset-determinism");
    if (h.frame() !== 40) return failMesen("frame:" + h.frame());
    if (h.padLog.length !== 40 || h.padLog[0] !== 0) return failMesen("padlog");
    const v = h.videoBytes();
    let nz = 0;
    for (let i = 0; i < v.length; i += 997) if (v[i] !== 0) nz++;
    if (nz < 10) return failMesen("video-blank");
    const pcm = h.pcmDrain();
    if (!(pcm.length > 0)) return failMesen("pcm-zero");
    if (!(h.audioTotal > 0)) return failMesen("audio-zero");
    const h0 = h.hash();
    const m = makeMovie(h.padLog.slice(0, h.frame()), "mesencrc");
    const parsed = parseMovie(JSON.parse(JSON.stringify(m)));
    const st = await replayMovie(h, parsed.pads, null);
    if (st !== 40) return failMesen("replay-frame:" + st);
    if (h.hash() !== h0) return failMesen("replay-hash");
    // true-snapshot savestate roundtrip (v2): save at 40, run on, restore
    await h.reset();
    await h.go(40, 0);
    const sh0 = (h.hash() >>> 0).toString(16);
    const sd = await h.save(9);
    if (sd.frame !== 40 || sd.hash !== sh0) return failMesen("snap-save");
    if (!sd.snap || sd.snap.length < 1000) return failMesen("snap-blob");
    await h.go(40, 0);
    if (h.frame() !== 80) return failMesen("snap-frame:" + h.frame());
    const lf = await h.load(9);
    if (lf !== 40) return failMesen("snap-load-frame:" + lf);
    if ((h.hash() >>> 0).toString(16) !== sh0) return failMesen("snap-load-hash");
    const cf = await h.go(5, 0);
    await h.reset();
    await h.go(40, 0);
    const df = await h.go(5, 0);
    for (let i = 0; i < 5; i++) if (cf[i] !== df[i]) return failMesen("snap-continue");
    // input-responsiveness probe: park on the title, tap START, video must move
    await h.reset();
    for (let f = 0; f < 600; f++) await h.go(1, 0);
    const preStart = h.hash();
    await h.go(12, 8);
    if (h.hash() === preStart) return failMesen("start-static");
    h.terminate();
    statusEl.textContent = "mesen self-test PASS f=40 hash=" + h0.toString(16);
    document.title = "BM-MESEN-PASS";
  } catch (e) { failMesen("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const tm2 = qs.get("test");
  if (tm2 === "mesen") selfTestMesen();
}
// ---- PWA packaging (manifest + SW + install UI). ----
const failPwa = (s) => { document.title = "BM-PWA-FAIL:" + s; };
async function selfTestPwa() {
  document.title = "BM-PWA-RUNNING";
  try {
    const link = document.querySelector("link[rel=manifest]");
    if (!link) return failPwa("no-manifest-link");
    const mr = await fetch(link.getAttribute("href"));
    if (!mr.ok) return failPwa("manifest-fetch:" + mr.status);
    const ct = (mr.headers.get("content-type") || "");
    if (ct.indexOf("manifest+json") < 0 && ct.indexOf("json") < 0) return failPwa("manifest-mime:" + ct);
    const man = await mr.json();
    if (man.display !== "standalone") return failPwa("display");
    if (!man.start_url || !man.icons || man.icons.length < 2) return failPwa("manifest-fields");
    for (const ic of man.icons) {
      const ir = await fetch(ic.src);
      if (!ir.ok) return failPwa("icon-fetch:" + ic.src);
    }
    if (!("serviceWorker" in navigator)) return failPwa("no-sw-api");
    let reg = null;
    const t0 = performance.now();
    for (;;) {
      try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { reg = null; }
      if (reg && reg.active) break;
      if (performance.now() - t0 > 20000) return failPwa("sw-timeout");
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!reg.active.scriptURL.endsWith("sw.js")) return failPwa("sw-script");
    const pwa = window.BM.pwa();
    if (!pwa.sw) return failPwa("pwa-sw");
    const ib = document.getElementById("installBtn");
    if (!ib) return failPwa("no-install-btn");
    statusEl.textContent = "PWA checks PASS";
    shellLog("PWA self-test PASS");
    document.title = "BM-PWA-PASS";
  } catch (e) { failPwa("exc:" + String((e && e.message) || e).slice(0, 80)); }
}
if (qs.has("headless")) {
  const tp = qs.get("test");
  if (tp === "pwa") selfTestPwa();
}
async function shellAutoTrapReport() {
  try { await autoTrapReport(l2host, prefs.engine, loadRomId, logTail, shellLog); } catch (e) {}
  var last = logTail[logTail.length - 1] || "";
  if (/NOT SAVED|FAILED/.test(last)) dlFailedToast("bugreport", last);
}
async function shellAutoFaultReport(errMsg) {
  try { await autoFaultReport(l2host, prefs.engine, loadRomId, logTail, shellLog, errMsg); } catch (e) {}
  var last2 = logTail[logTail.length - 1] || "";
  if (/NOT SAVED|FAILED/.test(last2)) dlFailedToast("bugreport", last2);
}
async function shellManualReport() {
  var r = await buildBugReport(l2host, prefs.engine, loadRomId, logTail, "manual");
  var mdl = await saveJsonWithDialog(r, "bmbug-f" + r.frame + "-manual.json");
  var mShown = mdl.name || ("bmbug-f" + r.frame + "-manual.json");
  if (mdl.via === "cancelled") shellLog("bugreport save cancelled");
  else shellLog("bugreport f=" + r.frame + " via " + mdl.via + " -> Downloads/" + mShown);
  if (dlFailed(mdl.via)) dlFailedToast("bugreport", mdl.via);
  return r;
}
window.BM.reportBug = shellManualReport;
reportBtn.addEventListener("click", () => { shellManualReport().catch((e) => { shellLog("report err " + e.message); }); });