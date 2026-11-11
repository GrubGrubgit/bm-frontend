// L2 game worker: owns game.wasm, single-entry boot, SAB stepping.
// Protocol (frozen SPEC section 5): the host boots us once with the wasm
// bytes, PRG/CHR sections and a SharedArrayBuffer. We instantiate, load
// sections, post booted, then call bm_boot() EXACTLY ONCE (it never
// returns). Each vblank edge the engine calls host_frame(f): we latch the
// pad, copy video + drain audio into the SAB, publish frame/hash, then
// either keep running (CMD=go, RUN_N left) or park in Atomics.wait.
// Pause = host stops sending go. Save/load = pad log + fresh worker
// (replay, exact by determinism); this worker never exports memory.
"use strict";
var IDX_STATE = 0, IDX_CMD = 1, IDX_PAD = 2, IDX_FRAME = 3;
var IDX_RUN_N = 4, IDX_AUDIO_N = 5, IDX_HASH = 6, IDX_MEMSIZE = 7;
var IDX_ERR = 8, IDX_HASH_N = 9;
var IDX_AUDIO_SUM = 10;
var ST_BOOTING = 0, ST_PARKED = 1, ST_FATAL = 4;
var CMD_PARK = 0, CMD_GO = 1;
var OFF = 64;
var VBYTES = 256 * 240 * 4, ABYTES = 256 * 8;
var VO = OFF, AO = OFF + VBYTES, HO = OFF + VBYTES + ABYTES;
var HMAX = 8192;
var S = null;
function onFrame(f) {
  var x = S;
  var ex = x.inst.exports;
  ex.bm_set_pad(x.ctl[IDX_PAD] & 0xFF);
  var mem = new Uint8Array(ex.memory.buffer);
  var vp = ex.bm_video_ptr();
  x.vram8.set(mem.subarray(vp, vp + VBYTES));
  var n = ex.bm_audio_read(ex.bm_stage_ptr(), 256);
  x.aram8.set(mem.subarray(ex.bm_stage_ptr(), ex.bm_stage_ptr() + n * 8));
  var h = ex.bm_hash() >>> 0;
  x.ctl[IDX_FRAME] = f;
  x.ctl[IDX_AUDIO_N] = n;
  x.ctl[IDX_AUDIO_SUM] += n;
  x.ctl[IDX_HASH] = h;
  if (x.hcount < HMAX) { x.hram32[x.hcount] = h; x.hcount++; }
  x.ctl[IDX_HASH_N] = x.hcount;
  if (x.ctl[IDX_CMD] === CMD_GO && x.ctl[IDX_RUN_N] > 0) {
    x.ctl[IDX_RUN_N]--;
    if (x.ctl[IDX_RUN_N] > 0) return;
  }
  x.ctl[IDX_CMD] = CMD_PARK;
  x.ctl[IDX_STATE] = ST_PARKED;
  postMessage({ t: "parked", f: f });
  Atomics.wait(x.ctl, IDX_CMD, CMD_PARK);
  x.hcount = 0;
  x.ctl[IDX_HASH_N] = 0;
}
onmessage = function (e) {
  var m = e.data;
  if (!m || m.t !== "boot") return;
  try {
    var ctl = new Int32Array(m.sab, 0, 16);
    var st = {
      ctl: ctl,
      vram8: new Uint8Array(m.sab, VO, VBYTES),
      aram8: new Uint8Array(m.sab, AO, ABYTES),
      hram32: new Int32Array(m.sab, HO, HMAX),
      hcount: 0, inst: null
    };
    S = st;
    ctl[IDX_STATE] = ST_BOOTING;
    WebAssembly.instantiate(m.wasm, { env: { host_frame: onFrame } }).then(function (r) {
      st.inst = r.instance;
      var ex = st.inst.exports;
      var mem = new Uint8Array(ex.memory.buffer);
      mem.set(new Uint8Array(m.prg), ex.bm_stage_ptr());
      ex.bm_load_prg();
      mem.set(new Uint8Array(m.chr), ex.bm_stage_ptr());
      ex.bm_load_chr();
      ctl[IDX_MEMSIZE] = ex.memory.buffer.byteLength;
      postMessage({ t: "booted", memsize: ex.memory.buffer.byteLength });
      try {
        ex.bm_boot();
      } catch (err) {
        ctl[IDX_ERR] = 1;
        ctl[IDX_STATE] = ST_FATAL;
        postMessage({ t: "fatal", msg: String((err && err.message) || err) });
      }
    }, function (err) {
      ctl[IDX_STATE] = ST_FATAL;
      postMessage({ t: "fatal", msg: "instantiate: " + String((err && err.message) || err) });
    });
  } catch (err) {
    postMessage({ t: "fatal", msg: "boot: " + String((err && err.message) || err) });
  }
};
