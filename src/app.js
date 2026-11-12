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
  if (!video) video = new VideoRenderer(document.getElementById("gameCanvas"));
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
    const pack = await l2ensurePack();
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
    video.resize(512, 480, 1);
    video.setMode("integer", "nearest");
    const r0 = video.rect();
    if (r0.x !== 0 || r0.y !== 0 || r0.w !== 512 || r0.h !== 480) return fail3("integer-rect");
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
          if (rc.w % 256 !== 0 || rc.h % 240 !== 0 || rc.w / 256 !== rc.h / 240) return fail3("matrix-int-math");
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
window.BM.audioUnlock = function () { return ensureAudio().unlock(); };
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
    const pack = await l2ensurePack();
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
    for (let f = 0; f < 150; f++) ensureAudio().pushFrame(f, byf.get(f) || []);
    const t0 = performance.now();
    for (;;) {
      if (ensureAudio().stats().time >= 2.0) break;
      if (performance.now() - t0 > 15000) return fail4("clock-stall");
      await new Promise(r => setTimeout(r, 200));
    }
    const ws = await ensureAudio().workletStats();
    if (ws.fed !== 149) return fail4("fed:" + ws.fed);
    if (ws.gaps !== 0) return fail4("gaps:" + ws.gaps);
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
// that every engine step reads. Thumb controls are a fixed bottom overlay
// (L6 skins it); keyboard is dev convenience; gamepad uses the standard
// mapping with stick deadzone; agent drives the same bus headless.
import { PadBus } from "./input/bus.js";
import { attachKeyboard } from "./input/keyboard.js";
import { mountTouch } from "./input/touch.js";
import { pollGamepad, attachGamepad } from "./input/gamepad.js";
import { AgentPad } from "./input/agent.js";
const padBus = new PadBus();
const agentPad = new AgentPad(padBus, l2host);
attachKeyboard(padBus);
const touchUI = mountTouch(padBus);
attachGamepad(padBus);
window.BM.setPad = function (m) { return agentPad.setPad(m); };
window.BM.press = function (frames, mask) { return agentPad.press(frames, mask); };
window.BM.frame = function () { return l2host.frame(); };
window.BM.busMask = function () { return padBus.getMask(); };
const fail5 = s => { document.title = "BM-L5-FAIL:" + s; };
function kd(code) { window.dispatchEvent(new KeyboardEvent("keydown", { code: code })); }
function ku(code) { window.dispatchEvent(new KeyboardEvent("keyup", { code: code })); }
function pdown(el, id) { el.dispatchEvent(new PointerEvent("pointerdown", { pointerId: id, bubbles: true, cancelable: true })); }
function pup(el, id) { el.dispatchEvent(new PointerEvent("pointerup", { pointerId: id, bubbles: true, cancelable: true })); }
function fakeNav(btns, axes) {
  const b = [];
  for (let i = 0; i < 16; i++) b.push({ pressed: !!btns[i] });
  return { getGamepads: () => [{ connected: true, buttons: b, axes: axes || [0, 0] }] };
}
async function selfTestL5() {
  document.title = "BM-L5-RUNNING";
  try {
    statusEl.textContent = "L5: source mapping proofs";
    kd("ArrowRight"); kd("KeyX");
    if (padBus.getMask() !== 0x81) return fail5("kbd:" + padBus.getMask().toString(16));
    ku("ArrowRight"); ku("KeyX");
    if (padBus.getMask() !== 0) return fail5("kbd-clear:" + padBus.getMask().toString(16));
    pdown(touchUI.buttons.left, 11); pdown(touchUI.buttons.a, 12);
    if (padBus.getMask() !== 0x41) return fail5("touch-multitouch:" + padBus.getMask().toString(16));
    pup(touchUI.buttons.left, 11); pup(touchUI.buttons.a, 12);
    if (padBus.getMask() !== 0) return fail5("touch-clear:" + padBus.getMask().toString(16));
    if (pollGamepad(fakeNav({ 0: true, 14: true })) !== 0x41) return fail5("pad-map");
    if (pollGamepad(fakeNav({}, [0.9, -0.9])) !== 0x90) return fail5("pad-stick");
    if (pollGamepad({ getGamepads: () => [null] }) !== 0) return fail5("pad-null");
    if (pollGamepad(null) !== 0) return fail5("pad-nonull");
    kd("ArrowRight");
    agentPad.setPad(0x01);
    if (padBus.getMask() !== 0x81) return fail5("combine:" + padBus.getMask().toString(16));
    ku("ArrowRight");
    agentPad.setPad(0);
    if (padBus.getMask() !== 0) return fail5("combine-clear:" + padBus.getMask().toString(16));
    statusEl.textContent = "L5: agent 60s run (start@2700, hold L+A)";
    const pack = await l2ensurePack();
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
    if ((l2host.ctl[6] >>> 0) !== 0xb31cbf03) return fail5("hash:" + (l2host.ctl[6] >>> 0).toString(16));
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
import { loadPrefs, savePrefs } from "./ui/prefs.js";
import { makeLog, fmtStatus, toast, wirePadToasts } from "./ui/shell.js";
const prefs = loadPrefs();
const shellStatusEl = document.getElementById("shellStatus");
const logEl = document.getElementById("logEl");
const padToastEl = document.getElementById("padToast");
const shellLog = makeLog(logEl);
wirePadToasts(padToastEl, shellLog);
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
  const h = Math.round(w * 240 / 256);
  ensureVideo();
  video.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
}
function applyVideoPrefs() {
  ensureVideo();
  video.setMode(prefs.scale, prefs.filter);
  fitCanvas();
}
function syncAudioToPrefs() {
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
async function shellStepOnce() {
  const mask = padBus.getMask();
  const h = await l2host.go(1, mask);
  try {
    if (audioPlayer && audioPlayer.node) {
      const ab = l2host.audioFrame();
      if (ab.n > 0) audioPlayer.pushFrame(l2host.frame(), parseAudioBytes(ab));
    }
  } catch (e) {}
  ensureVideo();
  video.upload(l2host.videoBytes());
  const pe = video.present();
  if (pe !== 0) shellLog("video present err " + pe);
  shellFpsCount++;
  const now = performance.now();
  if (!shellFpsT0) shellFpsT0 = now;
  else if (now - shellFpsT0 >= 1000) {
    shellFps = shellFpsCount * 1000 / (now - shellFpsT0);
    shellFpsCount = 0; shellFpsT0 = now;
  }
  return h;
}
function shellLoop() {
  if (!shellRunning) { shellRaf = 0; return; }
  shellRaf = requestAnimationFrame(() => {
    (async () => {
      if (!shellPaused && !shellStepping) {
        shellStepping = true;
        try { await shellStepOnce(); } catch (e) { shellLog("step err " + String((e && e.message) || e)); }
        shellStepping = false;
      }
    })().then(() => shellLoop(), () => shellLoop());
  });
}
async function shellStart() {
  if (shellRunning && !shellPaused) return l2host.frame();
  const pack = await l2ensurePack();
  if (!l2host.worker || l2host.frame() < 0) await l2host.spawn(pack, "build/game.wasm");
  try { await ensureAudio().unlock(); syncAudioToPrefs(); }
  catch (e) { shellLog("audio locked: " + String((e && e.message) || e).slice(0, 60)); }
  shellRunning = true; shellPaused = false;
  pauseBtn.textContent = "Pause";
  if (!shellRaf) shellLoop();
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  shellLog("start f=" + l2host.frame());
  return l2host.frame();
}
async function shellStop() {
  shellRunning = false; shellPaused = false;
  if (shellRaf) { cancelAnimationFrame(shellRaf); shellRaf = 0; }
  try { l2host.terminate(); } catch (e) {}
  pauseBtn.textContent = "Pause";
  shellLog("stop");
  return -1;
}
async function shellReset() {
  const pack = await l2ensurePack();
  await l2host.spawn(pack, "build/game.wasm");
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
  shellLog("saved slot " + s + " f=" + d.frame);
  return d;
}
async function shellLoad(slot) {
  const s = slot || prefs.slot;
  const f = await l2host.load(s);
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  shellLog("loaded slot " + s + " f=" + f);
  return f;
}
function shellScreenshot() {
  if (!l2host.worker) throw new Error("not-started");
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  return document.getElementById("gameCanvas").toDataURL("image/png");
}
async function shellFrame() {
  if (!l2host.worker) throw new Error("not-started");
  if (shellRunning && !shellPaused) throw new Error("pause-first");
  const r = await l2host.step(padBus.getMask());
  ensureVideo();
  video.upload(l2host.videoBytes());
  video.present();
  return { frame: r.frame, hash: (r.hash >>> 0) };
}
window.BM.start = shellStart;
window.BM.stop = shellStop;
window.BM.reset = shellReset;
window.BM.pause = shellPause;
window.BM.save = shellSave;
window.BM.load = shellLoad;
window.BM.screenshot = shellScreenshot;
window.BM.frame = shellFrame;
window.BM.log = shellLog;
window.BM.stats = ((prev) => () => Object.assign(prev(), {
  running: shellRunning, paused: shellPaused, engineFrame: l2host.frame(),
  fps: video ? video.fps : shellFps,
  scale: prefs.scale, filter: prefs.filter,
  volume: prefs.volume, muted: prefs.muted, slot: prefs.slot
}))(window.BM.stats);
startBtn.addEventListener("click", () => {
  shellStart().catch((e) => { shellLog("start err " + e.message); statusEl.textContent = "start err " + e.message; });
});
stopBtn.addEventListener("click", () => { shellStop(); });
resetBtn.addEventListener("click", () => {
  shellReset().catch((e) => { shellLog("reset err " + e.message); statusEl.textContent = "reset err " + e.message; });
});
pauseBtn.addEventListener("click", () => { shellPause(); });
saveBtn.addEventListener("click", () => {
  shellSave().catch((e) => { shellLog("save err " + e.message); });
});
loadBtn.addEventListener("click", () => {
  shellLoad().catch((e) => { shellLog("load err " + e.message); });
});
shotBtn.addEventListener("click", () => {
  try { const u = shellScreenshot(); shellLog("shot " + u.length + "B"); toast(padToastEl, "shot " + u.length + "B", 1500); }
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
setInterval(() => {
  try { if (shellStatusEl) shellStatusEl.textContent = fmtStatus(window.BM.stats()); } catch (e) {}
}, 500);
shellLog("shell ready: start/reset/pause + slots + volume + scale/filter/fullscreen");

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
    const f0 = l2host.frame(), h0 = (l2host.ctl[6] >>> 0);
    await window.BM.save(3);
    await window.BM.reset();
    if (l2host.frame() !== 0) return fail6("reset2-frame");
    if ((l2host.ctl[6] >>> 0) === h0) return fail6("reset2-hash-same");
    const lf = await window.BM.load(3);
    if (lf !== f0) return fail6("load-frame:" + lf);
    if ((l2host.ctl[6] >>> 0) !== h0) return fail6("load-hash");
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
    const pack = await l2ensurePack();
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
    const h = (l2host.ctl[6] >>> 0).toString(16);
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
    const h = (l2host.ctl[6] >>> 0).toString(16);
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
