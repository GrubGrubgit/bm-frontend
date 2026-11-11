// L2 node harness, PLAIN single-entry semantics (no asyncify, 2026-11-11).
// ONE bm_boot() call runs the game; the host_frame import drives control
// (throw STOP to run exactly stopAt frames). Checks: boot determinism,
// replay save/load roundtrip (memory image + reboot + pad-log fast-forward),
// audio drain, snapshot + render for the oracle cross-check.
// Usage: node tools/test_game.mjs <rom> [K]
import { readFileSync, writeFileSync } from "fs";
import { deflateSync, crc32 } from "zlib";
function pngRGB(w, h, rgba) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3); row[0] = 0;
    for (let x = 0; x < w; x++) { row[1+x*3] = rgba[(y*w+x)*4]; row[1+x*3+1] = rgba[(y*w+x)*4+1]; row[1+x*3+2] = rgba[(y*w+x)*4+2]; }
    rows.push(row);
  }
  const c = deflateSync(Buffer.concat(rows), { level: 6 });
  const chunk = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); t.copy(h, 4);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, d])) >>> 0, 0); return Buffer.concat([h, d, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk(Buffer.from("IHDR"), ihdr), chunk(Buffer.from("IDAT"), c), chunk(Buffer.from("IEND"), Buffer.alloc(0))]);
}
const ROMPATH = process.argv[2], K = +(process.argv[3] || 40);
const rom = new Uint8Array(readFileSync(ROMPATH));
const prg = rom.slice(16, 16 + 131072), chr = rom.slice(16 + 131072, 16 + 262144);
const bytes = readFileSync("build/game.wasm");
async function runBoot(stopAt, padAt, onFrame) {
  const hashes = [];
  let audio = 0;
  const p = await WebAssembly.instantiate(bytes, { env: { host_frame: f => {
    inst.exports.bm_set_pad(padAt ? padAt(f) : 0);
    hashes.push(inst.exports.bm_hash() >>> 0);
    audio += inst.exports.bm_audio_read(inst.exports.bm_stage_ptr(), 256);
    if (onFrame) onFrame(inst, f);
    if (f + 1 >= stopAt) throw new Error("STOP");
  } } });
  const inst = p.instance;
  const mem = () => new Uint8Array(inst.exports.memory.buffer);
  mem().set(prg, inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
  mem().set(chr, inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
  try { inst.exports.bm_boot(); } catch (e) { if (e.message !== "STOP") throw e; }
  return { inst, hashes, audio };
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
let fail = 0;
const t0 = Date.now();
const a = await runBoot(K);
const b = await runBoot(K);
console.log((eq(a.hashes, b.hashes) ? "PASS" : "FAIL") + " reset-determinism K=" + K);
if (!eq(a.hashes, b.hashes)) fail = 1;
const SAVE_AT = 10;
let savedImage = null;
const u = await runBoot(20, null, (inst, f) => { if (f + 1 === SAVE_AT) savedImage = Buffer.from(inst.exports.memory.buffer.slice(0)); });
const c10 = await runBoot(SAVE_AT);
const same10 = savedImage && Buffer.from(c10.inst.exports.memory.buffer.slice(0)).equals(savedImage);
console.log((same10 ? "PASS" : "FAIL") + " save-image-stable frame=" + SAVE_AT);
if (!same10) fail = 1;
const c = await runBoot(20);
const replayOk = eq(u.hashes.slice(SAVE_AT), c.hashes.slice(SAVE_AT));
console.log((replayOk ? "PASS" : "FAIL") + " replay-load-continue");
if (!replayOk) fail = 1;
console.log("audio-events-total-" + K + "f:" + a.audio);
const dt = Date.now() - t0;
const vp = a.inst.exports.bm_video_ptr();
const memA = new Uint8Array(a.inst.exports.memory.buffer);
writeFileSync("work/title.png", pngRGB(256, 240, Buffer.from(memA.slice(vp, vp + 256 * 240 * 4))));
a.inst.exports.bm_snap();
const sp = a.inst.exports.bm_stage_ptr();
writeFileSync("work/snap.bin", Buffer.from(new Uint8Array(a.inst.exports.memory.buffer).slice(sp, sp + 4160)));
writeFileSync("work/chr.bin", Buffer.from(chr));
console.log("wrote work/title.png work/snap.bin work/chr.bin frames=" + a.inst.exports.bm_frame_no() + " harness-ms=" + dt);
process.exit(fail);
