// src/core/mesen_host.js -- Mesen (libretro core compiled to wasm) behind
// the GameHost surface (spawn/go/step/reset/save/load/frame/videoBytes/
// hash/padLog/inst), so the shell, movies, slots and bus run unmodified on
// the accurate engine. Pads are the SAME 1B/frame NES-bit log, so a movie
// recorded on any engine replays on any other (that cross-check is the
// point: Mesen is the accuracy oracle for the pause behavior that the
// static port gets wrong).
//
// Video bytes are RGBA like the port (converted from the core's XRGB8888);
// hash is FNV-1a over the frame words (engine-local, only compared within
// Mesen). Audio bypasses the APU-voice path: raw 44100Hz mono int16 batches
// via audio/pcm.js, for raw PCM. Save/load is replay by determinism
// (pad log + frame count; fresh module per spawn is bit-identical, proven
// by the mesen smoke page: MESEN-SMOKE-PASS ... det+bootdet).
//
// ROM bytes are rebuilt from the pack (header: meta.mapper/meta.mirror/
// meta.format + prg/chr banks). Blaster Master only needs mapper 1;
// battery/trainer packs are rejected by the builder anyway.
//
// The wasm glue (src/core/mesen/mesen.js, classic script, sets
// window.createMesen) + mesen.wasm ship with the app via make-www (src/
// is copied whole). The ROM buffer stays malloc'd for the whole session:
// g_gameExt.persistent_data=true, the core may reference it at any time.
import { saveSlot, loadSlot } from "../pack/store.js";
var VW = 256, VH = 240, VWORDS = VW * VH;
function fnvWords(sub32) {
  var h = 2166136261;
  for (var i = 0; i < sub32.length; i++) { h ^= sub32[i] & 0xFFFFFF; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function MesenHost() {
  this.pack = null;
  this.mod = null;
  this.romPtr = 0;
  this.namePtr = 0;
  this.inst = null;
  this.consumed = 0;
  this.padLog = [];
  this._hash = 0;
  this._rgba = new Uint8Array(VWORDS * 4);
  this._rgbaDirty = true;
  this._au = [];
  this.audioTotal = 0;
}
MesenHost.prototype._buildRomBytes = function (pack) {
  var m = pack.meta;
  var mapper = m.mapper | 0;
  var mir = m.mirror === "v" ? 1 : (m.mirror === "4" ? 8 : 0);
  var total = 16 + 8 * 16384 + 16 * 8192;
  var b = new Uint8Array(total);
  b[0] = 0x4E; b[1] = 0x45; b[2] = 0x53; b[3] = 0x1A;
  b[4] = 8; b[5] = 16;
  b[6] = ((mapper & 0xF) << 4) | mir;
  b[7] = (mapper & 0xF0) | (m.format === "nes2" ? 0x08 : 0x00);
  var o = 16;
  for (var i = 0; i < 8; i++) { b.set(pack.prg[i], o); o += 16384; }
  for (var j = 0; j < 16; j++) { b.set(pack.chr[j], o); o += 8192; }
  return b;
};
MesenHost.prototype.spawn = async function (pack) {
  this.terminate();
  this.pack = pack;
  this.consumed = 0;
  this.padLog = [];
  this._hash = 0;
  this._au = [];
  this.audioTotal = 0;
  this._rgba = new Uint8Array(VWORDS * 4);
  this._rgbaDirty = true;
  if (!window.createMesen) throw new Error("mesen-missing");
  var mod = await window.createMesen();
  var rom = this._buildRomBytes(pack);
  var rp = mod._malloc(rom.length);
  mod.HEAPU8.set(rom, rp);
  var nm = new TextEncoder().encode("game.nes");
  var np = mod._malloc(64);
  mod.HEAPU8.set(nm, np);
  mod.HEAPU8[np + nm.length] = 0;
  var ok = false;
  try { ok = !!mod._mesen_boot(rp, rom.length, np); } catch (e) { ok = false; }
  if (!ok) throw new Error("mesen-boot");
  // Persistent: g_gameExt.persistent_data=true, core may reference the ROM
  // at any time. Freed on terminate (next spawn/stop).
  this.mod = mod;
  this.romPtr = rp;
  this.namePtr = np;
  this.inst = mod;
  return this.frame();
};
MesenHost.prototype._pullFrame = function (pad) {
  var mod = this.mod;
  if (!mod) throw new Error("mesen-dead");
  mod._mesen_setpad(pad & 0xFF);
  mod._mesen_run();
  var p = mod._mesen_frame(), w = mod._mesen_fw(), h = mod._mesen_fh();
  if (p && w === VW && h === VH) {
    var src = mod.HEAPU32.subarray(p >> 2, (p >> 2) + VWORDS);
    var o = this._rgba;
    for (var i = 0, j = 0; i < VWORDS; i++, j += 4) {
      var px = src[i];
      o[j] = px & 255; o[j + 1] = (px >> 8) & 255; o[j + 2] = (px >> 16) & 255; o[j + 3] = 255;
    }
    this._rgbaDirty = false;
    this._hash = fnvWords(src);
  }
  var ap = mod._mesen_audio(), n = mod._mesen_alen();
  if (ap && n > 0) {
    var s16 = mod.HEAPU16.subarray(ap >> 1, (ap >> 1) + n);
    for (var k = 0; k < s16.length; k++) {
      var v = s16[k];
      this._au.push(v < 0 ? v / 32768 : v / 32767);
    }
    this.audioTotal += n;
    mod._mesen_aclear();
  }
  this.padLog.push(pad & 0xFF);
  this.consumed++;
  return this._hash;
};
MesenHost.prototype.go = async function (n, pad) {
  var hashes = [];
  for (var i = 0; i < n; i++) hashes.push(this._pullFrame(pad));
  return hashes;
};
MesenHost.prototype.step = async function (pad) {
  await this.go(1, pad);
  return { frame: this.frame(), hash: this.hash() };
};
MesenHost.prototype.reset = async function () {
  return this.spawn(this.pack);
};
MesenHost.prototype.frame = function () { return this.consumed; };
MesenHost.prototype.videoBytes = function () { return this._rgba; };
MesenHost.prototype.hash = function () { return this._hash >>> 0; };
MesenHost.prototype.audioFrame = function () { return { n: 0, bytes: new Uint8Array(0) }; };
MesenHost.prototype.pcmDrain = function () {
  if (this._au.length === 0) return new Float32Array(0);
  var o = new Float32Array(this._au);
  this._au = [];
  return o;
};
MesenHost.prototype.save = async function (slot) {
  var data = { v: 1, frame: this.frame(), pads: this.padLog.slice(0, this.frame()) };
  await saveSlot(slot, data);
  return data;
};
MesenHost.prototype.load = async function (slot) {
  var data = await loadSlot(slot);
  if (!data || data.v !== 1) throw new Error("no-save:" + slot);
  await this.spawn(this.pack);
  var i = 0;
  while (i < data.pads.length) {
    var q = data.pads[i], j = i;
    while (j < data.pads.length && data.pads[j] === q) j++;
    await this.go(j - i, q);
    i = j;
  }
  return this.frame();
};
MesenHost.prototype.terminate = function () {
  var mod = this.mod, rp = this.romPtr, np = this.namePtr;
  this.mod = null;
  this.inst = null;
  this.romPtr = 0;
  this.namePtr = 0;
  if (mod) {
    try { if (rp) mod._free(rp); } catch (e) {}
    try { if (np) mod._free(np); } catch (e2) {}
  }
};
