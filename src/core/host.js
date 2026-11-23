// L2 host: spawns the game, suspension stepping, pad log, replay save/load.
// Owns the ONLY access to compiled game code (SPEC section 6): app.js and
// the headless self-test drive the engine exclusively through GameHost.
// No worker, no SharedArrayBuffer, no isolation needed, no unwind tricks:
// the engine runs on the main thread and each vblank edge calls the
// host_frame suspending import, which latches video/audio/hash and SUSPENDS
// the wasm continuation (exact C stack preserved, resumed by go()).
// Frame accounting is consumption-based: every latched edge is eventually
// consumed exactly once, in order, so go(n) returns exactly n hashes.
// The pad is sampled at latch time (like the classic worker) and recorded
// per latch. The visible state (video/hash/audio accessors) is the last
// CONSUMED edge, not the last latched one: after go() resolves the final
// edge, the engine runs on and latches the next edge in-flight, which must
// stay invisible until consumed. Save() stores the pads of the consumed
// edges only. Save/load is replay by determinism: save = pad log + frame
// count into the IDB saves store; load = fresh instance + fast-forward.
// No stack capture.
import { saveSlot, loadSlot } from "../pack/store.js";
var VW = 256, VH = 240;
var VBYTES = VW * VH * 4;
export function GameHost() {
  this.pack = null;
  this.wasmUrl = null;
  this.inst = null;
  this.consumed = 0;
  this.f0 = 0;
  this.pad = 0;
  this.padLog = [];
  this.hashLog = [];
  this.audioTotal = 0;
  this.curVideo = new Uint8Array(0);
  this.curAudio = new Uint8Array(0);
  this.curAudioN = 0;
  this.curHash = 0;
  this._pending = [];
  this._fatal = null;
}
GameHost.prototype.frame = function () { return this.consumed - this.f0; };
GameHost.prototype.padWall = function () { try { if (this.inst && this.inst.exports.bm_pad_wall) return this.inst.exports.bm_pad_wall() >>> 0; } catch (e) {} return null; };
GameHost.prototype.videoBytes = function () { return this.curVideo; };
GameHost.prototype.hash = function () { return this.curHash >>> 0; };
GameHost.prototype.audioFrame = function () {
  return { n: this.curAudioN, bytes: this.curAudio.slice() };
};
// Cheat hook (set by app.js from ui/tweaks.js): runs while the engine is
// suspended inside host_frame, so RAM writes land cleanly between edges.
GameHost.prototype.cheatsApply = null;
GameHost.prototype.onFrame = function (f) {
  var self = this;
  var ex = this.inst.exports;
  try { if (this.cheatsApply) this.cheatsApply(ex); } catch (eCheat) {}
  var mem = new Uint8Array(ex.memory.buffer);
  var vp = ex.bm_video_ptr();
  var vd = mem.slice(vp, vp + VBYTES);
  var n = ex.bm_audio_read(ex.bm_stage_ptr(), 256);
  var sp = ex.bm_stage_ptr();
  var ab = mem.slice(sp, sp + n * 8);
  var h = ex.bm_hash() >>> 0;
  this.hashLog.push(h);
  this.audioTotal += n;
  return new Promise(function (res) { self._pending.push({ f: f, res: res, vd: vd, ab: ab, n: n, h: h }); });
};
GameHost.prototype.nextEdge = async function () {
  if (this._fatal) throw this._fatal;
  while (this._pending.length === 0) {
    if (this._fatal) throw this._fatal;
    await new Promise(function (r) { setTimeout(r, 0); });
  }
  return this._pending.shift();
};
GameHost.prototype.spawn = async function (pack, wasmUrl) {
  if (this.inst) {
    try { await this.nextEdge(); } catch (e) {}
    this._pending = [];
  }
  this.pack = pack;
  this.wasmUrl = wasmUrl;
  this.inst = null;
  this.consumed = 0;
  this.f0 = 0;
  this.pad = 0;
  this.padLog = [];
  this.hashLog = [];
  this.audioTotal = 0;
  this.curVideo = new Uint8Array(0);
  this.curAudio = new Uint8Array(0);
  this.curAudioN = 0;
  this.curHash = 0;
  this._pending = [];
  this._fatal = null;
  var self = this;
  var resp = await fetch(wasmUrl);
  if (!resp.ok) throw new Error("wasm-fetch:" + resp.status);
  var wasm = await resp.arrayBuffer();
  var prg = new Uint8Array(8 * 16384), chr = new Uint8Array(16 * 8192);
  for (var i = 0; i < 8; i++) prg.set(pack.prg[i], i * 16384);
  for (var j = 0; j < 16; j++) chr.set(pack.chr[j], j * 8192);
  var suspFrame = new WebAssembly.Suspending(function (f) { return self.onFrame(f); });
  var r = await WebAssembly.instantiate(wasm, { env: { host_frame: suspFrame } });
  this.inst = r.instance;
  var ex = this.inst.exports;
  var mem = new Uint8Array(ex.memory.buffer);
  mem.set(new Uint8Array(prg), ex.bm_stage_ptr());
  ex.bm_load_prg();
  mem.set(new Uint8Array(chr), ex.bm_stage_ptr());
  ex.bm_load_chr();
  var bootP = WebAssembly.promising(ex.bm_boot)();
  bootP.then(function () { self._fatal = new Error("boot-returned"); },
    function (e) { self._fatal = e; });
  // Edge 0 latched during boot: boot edges are not counted and boot pads
  // are not replayed, but the boot frame is the visible post-spawn state
  // and boot audio proves the drain is live. Resume exactly; edge 1 is
  // consumed by the first go().
  var e0 = await this.nextEdge();
  this.consumed = 0;
  this.f0 = 0;
  this.padLog = [];
  this.hashLog = [];
  this.curVideo = e0.vd;
  this.curAudio = e0.ab;
  this.curAudioN = e0.n;
  this.curHash = e0.h;
  e0.res(0);
  return this.frame();
};
GameHost.prototype.go = async function (n, pad) {
  this.pad = pad & 0xFF;
  var hashes = [];
  for (var i = 0; i < n; i++) {
    var e = await this.nextEdge();
    this.inst.exports.bm_set_pad(this.pad & 0xFF);
    this.padLog.push(this.pad & 0xFF);
    this.curVideo = e.vd;
    this.curAudio = e.ab;
    this.curAudioN = e.n;
    this.curHash = e.h;
    hashes.push(e.h >>> 0);
    this.consumed++;
    e.res(0);
  }
  return hashes;
};
GameHost.prototype.step = async function (pad) {
  await this.go(1, pad);
  return { frame: this.frame(), hash: this.hash() };
};
GameHost.prototype.reset = async function () {
  return this.spawn(this.pack, this.wasmUrl);
};
// Savestates are replay-anchored: pads + frame + rom are ALL the state the
// deterministic engine needs (a suspended JSPI continuation cannot be
// serialized, so restore = fresh spawn + fast-forward). v2 adds the engine
// tag and the post-restore hash: load replays, then compares against the
// saved hash and throws LOAD-MISMATCH instead of silently desyncing.
GameHost.prototype.save = async function (slot) {
  var data = { v: 2, engine: "wasm", frame: this.frame(), hash: (this.hash() >>> 0).toString(16), audioTotal: this.audioTotal, pads: this.padLog.slice(0, this.frame()) };
  await saveSlot(slot, data);
  return data;
};
GameHost.prototype.load = async function (slot, onProgress) {
  var data = await loadSlot(slot);
  if (!data || (data.v !== 1 && data.v !== 2)) throw new Error("no-save:" + slot);
  if (data.v === 2 && data.engine && data.engine !== "wasm") throw new Error("save-engine:" + data.engine + " (current wasm)");
  await this.spawn(this.pack, this.wasmUrl);
  var n = data.pads.length, i = 0, last = -1;
  while (i < n) {
    var q = data.pads[i], j = i;
    while (j < n && data.pads[j] === q) j++;
    await this.go(j - i, q);
    i = j;
    if (onProgress) {
      var pc = Math.floor(i * 10 / n);
      if (pc !== last) { last = pc; try { onProgress(i, n); } catch (e) {} }
    }
  }
  if (data.v === 2 && data.hash != null) {
    var got = (this.hash() >>> 0).toString(16);
    if (got !== String(data.hash)) throw new Error("load-mismatch expect=" + data.hash + " got=" + got);
  }
  return this.frame();
};
GameHost.prototype.terminate = function () {
  this.inst = null;
  this._pending = [];
};
GameHost.prototype.trapInfo = function () {
  try {
    var ex = this.inst && this.inst.exports;
    if (!ex || !ex.bm_trap_flag || !ex.bm_trap_flag()) return null;
    var mem = new Uint8Array(ex.memory.buffer);
    var np = ex.bm_trap_namep();
    var s = "";
    for (var i = 0; i < 24 && mem[np + i]; i++) s += String.fromCharCode(mem[np + i]);
    return { name: s, val: ex.bm_trap_code() };
  } catch (e) { return null; }
};
