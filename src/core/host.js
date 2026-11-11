// L2 host: spawns the game worker, SAB stepping, pad log, replay save/load.
// Owns the ONLY access to compiled game code (SPEC section 6): app.js and
// the headless self-test drive the engine exclusively through GameHost.
// Save/load is replay by design (deterministic engine, proven in node):
// save = pad log + frame count into the IDB saves store; load = fresh
// worker + fast-forward the log, then continue. Exact, no stack capture.
import { saveSlot, loadSlot } from "../pack/store.js";
var VW = 256, VH = 240;
var VBYTES = VW * VH * 4, ABYTES = 256 * 8, HMAX = 8192;
var SAB_BYTES = 64 + VBYTES + ABYTES + HMAX * 4;
var IDX_STATE = 0, IDX_CMD = 1, IDX_PAD = 2, IDX_FRAME = 3;
var IDX_RUN_N = 4, IDX_AUDIO_N = 5, IDX_HASH = 6, IDX_MEMSIZE = 7;
var IDX_ERR = 8, IDX_HASH_N = 9;
var IDX_AUDIO_SUM = 10;
var CMD_PARK = 0, CMD_GO = 1;
var VO = 64, AO = 64 + VBYTES, HO = 64 + VBYTES + ABYTES;
function waitFor(w, tag, tmoMs) {
  return new Promise(function (res, rej) {
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; rej(new Error("worker-timeout:" + tag)); } }, tmoMs || 15000);
    var h = function (e) {
      var m = e.data;
      if (!m) return;
      if (m.t === tag) {
        if (done) return; done = true; clearTimeout(to);
        wkrDetach(h); res(m);
      } else if (m.t === "fatal") {
        if (done) return; done = true; clearTimeout(to);
        wkrDetach(h); rej(new Error("worker-fatal:" + m.msg));
      }
    };
    var wkrDetach = function (hh) { w.removeEventListener("message", hh); };
    w.addEventListener("message", h);
  });
}
export function GameHost() {
  this.pack = null;
  this.wasmUrl = null;
  this.worker = null;
  this.sab = null;
  this.ctl = null;
  this.padLog = [];
  this.audioTotal = 0;
}
GameHost.prototype.videoBytes = function () { return new Uint8Array(this.sab, VO, VBYTES); };
GameHost.prototype.frame = function () { return this.ctl ? this.ctl[IDX_FRAME] : -1; };
GameHost.prototype.spawn = async function (pack, wasmUrl) {
  this.pack = pack;
  this.wasmUrl = wasmUrl;
  if (this.worker) this.worker.terminate();
  this.sab = new SharedArrayBuffer(SAB_BYTES);
  this.ctl = new Int32Array(this.sab, 0, 16);
  this.padLog = [];
  this.audioTotal = 0;
  var w = new Worker(new URL("./worker.js", import.meta.url), { type: "classic" });
  this.worker = w;
  var resp = await fetch(wasmUrl);
  if (!resp.ok) throw new Error("wasm-fetch:" + resp.status);
  var wasm = await resp.arrayBuffer();
  var prg = new Uint8Array(8 * 16384), chr = new Uint8Array(16 * 8192);
  for (var i = 0; i < 8; i++) prg.set(pack.prg[i], i * 16384);
  for (var j = 0; j < 16; j++) chr.set(pack.chr[j], j * 8192);
  var booted = waitFor(w, "booted", 20000);
  w.postMessage({ t: "boot", wasm: wasm, prg: prg.buffer, chr: chr.buffer, sab: this.sab },
    [wasm, prg.buffer, chr.buffer]);
  await booted;
  var parked = waitFor(w, "parked", 20000);
  await parked;
  this.audioTotal += this.ctl[IDX_AUDIO_SUM];
  return this.frame();
};
GameHost.prototype.go = async function (n, pad) {
  var w = this.worker, ctl = this.ctl;
  var left = n, hashes = [];
  while (left > 0) {
    var chunk = left > HMAX ? HMAX : left;
    ctl[IDX_PAD] = pad & 0xFF;
    ctl[IDX_RUN_N] = chunk;
    for (var i = 0; i < chunk; i++) this.padLog.push(pad & 0xFF);
    var s0 = ctl[IDX_AUDIO_SUM] >>> 0;
    var p = waitFor(w, "parked", 30000);
    ctl[IDX_CMD] = CMD_GO;
    Atomics.notify(ctl, IDX_CMD, 1);
    var m = await p;
    var hn = ctl[IDX_HASH_N];
    var hv = new Int32Array(this.sab, HO, hn);
    for (var k = 0; k < hn; k++) hashes.push(hv[k] >>> 0);
    this.audioTotal += this.ctl[IDX_AUDIO_SUM] - s0;
    left -= chunk;
    if (m.t !== "parked") throw new Error("unexpected:" + m.t);
  }
  return hashes;
};
GameHost.prototype.step = async function (pad) {
  var h = await this.go(1, pad);
  return { frame: this.frame(), hash: h[0] };
};
GameHost.prototype.reset = async function () {
  return this.spawn(this.pack, this.wasmUrl);
};
GameHost.prototype.save = async function (slot) {
  var data = { v: 1, frame: this.frame(), pads: this.padLog.slice() };
  await saveSlot(slot, data);
  return data;
};
GameHost.prototype.load = async function (slot) {
  var data = await loadSlot(slot);
  if (!data || data.v !== 1) throw new Error("no-save:" + slot);
  await this.spawn(this.pack, this.wasmUrl);
  var i = 0;
  while (i < data.pads.length) {
    var p = data.pads[i], j = i;
    while (j < data.pads.length && data.pads[j] === p) j++;
    await this.go(j - i, p);
    i = j;
  }
  return this.frame();
};
GameHost.prototype.terminate = function () {
  if (this.worker) this.worker.terminate();
  this.worker = null;
};
