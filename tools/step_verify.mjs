import { readFileSync } from "fs";
const ROMPATH = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/work/roms-dev/blaster-master-usa.nes";
const K = +(process.argv[2] || 20000);
const rom = new Uint8Array(readFileSync(ROMPATH));
const prg = rom.slice(16, 16 + 131072), chr = rom.slice(16 + 131072, 16 + 262144);
const bytes = readFileSync("build/game.wasm");
let inst, frames = 0, yields = 0;
let acc = 2166136261;
const YIELD = new Error("YIELD"), DONE = new Error("DONE");
function onFrame(f) {
  inst.exports.bm_set_pad(0);
  let h = inst.exports.bm_hash() >>> 0;
  acc ^= h; acc = Math.imul(acc, 16777619) >>> 0;
  inst.exports.bm_audio_read(inst.exports.bm_stage_ptr(), 256);
  frames++;
  if (frames >= K) throw DONE;
  if (inst.exports.bm_is_spin()) { yields++; throw YIELD; }
}
const p = await WebAssembly.instantiate(bytes, { env: { host_frame: onFrame } });
inst = p.instance;
const mem = () => new Uint8Array(inst.exports.memory.buffer);
mem().set(prg, inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
mem().set(chr, inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
const t0 = Date.now();
let done = false;
try { inst.exports.bm_boot(); done = true; }
catch (e) { if (e !== YIELD && e !== DONE) { console.log("BOOT-ERR frames=" + frames + " " + e.message); process.exit(2); } }
while (!done && frames < K) {
  try { inst.exports.bm_resume(); }
  catch (e) {
    if (e === DONE) { done = true; break; }
    if (e !== YIELD) { console.log("RESUME-ERR frames=" + frames + " yields=" + yields + " " + e.message); process.exit(3); }
  }
}
console.log("STEPK frames=" + frames + " yields=" + yields + " acc=" + (acc >>> 0).toString(16) + " ms=" + (Date.now() - t0));
