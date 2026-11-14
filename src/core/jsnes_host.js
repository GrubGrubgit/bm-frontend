// src/core/jsnes_host.js -- DEBUG engine: bfirsh/jsnes behind the GameHost
// surface (spawn/go/step/reset/save/load/frame/videoBytes/hash/padLog /
// inst), so the shell, movies, slots and bus run unmodified on either
// engine. Pads are the SAME 1B/frame NES-bit log, so a movie recorded on
// jsnes replays on the wasm port and vice versa (that cross-check is the
// point). Video bytes are RGBA like the port; hash is FNV-1a over the
// jsnes framebuffer (engine-local, only compared within jsnes). Audio
// bypasses the APU-voice path: raw 44100Hz mono via audio/pcm.js.
// ROM bytes are rebuilt from the pack (header: meta.mapper/meta.mirror/
// meta.format + prg/chr banks). Blaster Master only needs mapper 1;
// battery/trainer packs are rejected by the builder anyway.
import "../vendor/jsnes.min.js";
import { saveSlot, loadSlot } from "../pack/store.js";
function fnvFb(fb) {
  let h = 2166136261;
  for (let i = 0; i < fb.length; i++) { h ^= (fb[i] & 0xFFFFFF); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function JsnesHost() {
  this.pack = null;
  this.nes = null;
  this.inst = null;
  this.consumed = 0;
  this.padLog = [];
  this._fb = new Array(256 * 240).fill(0);
  this._rgba = new Uint8Array(256 * 240 * 4);
  this._rgbaDirty = true;
  this._hash = 0;
  this._au = [];
  this._lastPad = -1;
  this._romStr = null;
  this._C = null;
}
JsnesHost.prototype._buildRomStr = function (pack) {
  const m = pack.meta;
  const mapper = m.mapper | 0;
  const mir = m.mirror === "v" ? 1 : (m.mirror === "4" ? 8 : 0);
  const h = new Uint8Array(16);
  h[0] = 0x4E; h[1] = 0x45; h[2] = 0x53; h[3] = 0x1A;
  h[4] = 8; h[5] = 16;
  h[6] = ((mapper & 0xF) << 4) | mir;
  h[7] = (mapper & 0xF0) | (m.format === "nes2" ? 0x08 : 0x00);
  let s = "";
  for (let i = 0; i < 16; i++) s += String.fromCharCode(h[i]);
  const push = (u8) => {
    for (let o = 0; o < u8.length; o += 8192) {
      const n = Math.min(8192, u8.length - o);
      let c = "";
      for (let i = 0; i < n; i++) c += String.fromCharCode(u8[o + i] & 255);
      s += c;
    }
  };
  for (let i = 0; i < 8; i++) push(pack.prg[i]);
  for (let i = 0; i < 16; i++) push(pack.chr[i]);
  return s;
};
JsnesHost.prototype.spawn = async function (pack) {
  this.pack = pack;
  this.consumed = 0;
  this.padLog = [];
  this._au = [];
  this._lastPad = -1;
  this._fb = new Array(256 * 240).fill(0);
  this._rgbaDirty = true;
  this._hash = 0;
  const J = window.jsnes;
  if (!J || !J.NES) throw new Error("jsnes-missing");
  this._C = J.Controller;
  if (!this._romStr) this._romStr = this._buildRomStr(pack);
  const self = this;
  this.nes = new J.NES({
    onFrame: function (fb) { self._fb = fb.slice(); self._rgbaDirty = true; },
    onAudioSample: function (l, r) { self._au.push((l + r) * 0.5); },
    sampleRate: 44100
  });
  this.nes.loadROM(this._romStr);
  this.inst = this.nes;
  return this.frame();
};
JsnesHost.prototype._applyPad = function (pad) {
  pad &= 0xFF;
  if (pad === this._lastPad) return;
  const C = this._C, nes = this.nes;
  const bits = [[0x01, C.BUTTON_A], [0x02, C.BUTTON_B], [0x04, C.BUTTON_SELECT], [0x08, C.BUTTON_START], [0x10, C.BUTTON_UP], [0x20, C.BUTTON_DOWN], [0x40, C.BUTTON_LEFT], [0x80, C.BUTTON_RIGHT]];
  for (let i = 0; i < bits.length; i++) {
    const was = (this._lastPad >= 0) ? (this._lastPad & bits[i][0]) : 0;
    const is = pad & bits[i][0];
    if (is && !was) nes.buttonDown(1, bits[i][1]);
    else if (!is && was) nes.buttonUp(1, bits[i][1]);
  }
  this._lastPad = pad;
};
JsnesHost.prototype.go = async function (n, pad) {
  const hashes = [];
  for (let i = 0; i < n; i++) {
    this._applyPad(pad);
    this.nes.frame();
    this.padLog.push(pad & 0xFF);
    this._hash = fnvFb(this._fb);
    hashes.push(this._hash);
    this.consumed++;
  }
  return hashes;
};
JsnesHost.prototype.step = async function (pad) {
  await this.go(1, pad);
  return { frame: this.frame(), hash: this.hash() };
};
JsnesHost.prototype.reset = async function () {
  return this.spawn(this.pack);
};
JsnesHost.prototype.frame = function () { return this.consumed; };
JsnesHost.prototype.videoBytes = function () {
  if (this._rgbaDirty) {
    const fb = this._fb, o = this._rgba;
    for (let i = 0, j = 0; i < fb.length; i++, j += 4) {
      const p = fb[i] | 0;
      o[j] = p & 255; o[j + 1] = (p >> 8) & 255; o[j + 2] = (p >> 16) & 255; o[j + 3] = 255;
    }
    this._rgbaDirty = false;
  }
  return this._rgba;
};
JsnesHost.prototype.hash = function () { return this._hash >>> 0; };
JsnesHost.prototype.audioFrame = function () { return { n: 0, bytes: new Uint8Array(0) }; };
JsnesHost.prototype.pcmDrain = function () {
  if (this._au.length === 0) return new Float32Array(0);
  const o = new Float32Array(this._au);
  this._au = [];
  return o;
};
JsnesHost.prototype.save = async function (slot) {
  const data = { v: 1, frame: this.frame(), pads: this.padLog.slice(0, this.frame()) };
  await saveSlot(slot, data);
  return data;
};
JsnesHost.prototype.load = async function (slot) {
  const data = await loadSlot(slot);
  if (!data || data.v !== 1) throw new Error("no-save:" + slot);
  await this.spawn(this.pack);
  let i = 0;
  while (i < data.pads.length) {
    const q = data.pads[i]; let j = i;
    while (j < data.pads.length && data.pads[j] === q) j++;
    await this.go(j - i, q);
    i = j;
  }
  return this.frame();
};
JsnesHost.prototype.terminate = function () {
  this.nes = null;
  this.inst = null;
};
