// B2EC regression: user movie trapped vec007A-unmapped val=$B2EC at f=2521
// (area-8 dungeon L1, slot actor type 125; bank6 behavior word[125]=B2EC,
// direct-path vector, only the +3 twin B2EF had been observed before).
// Fix: manual_B2EC thunk (JMP B308) + vec case. This suite replays the
// user pad log (enhanced+saves on, matching the bug report) trap-free.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildPack } from "../src/pack/builder.js";
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n + (x ? " :: " + x : "")); } };
const rom = new Uint8Array(readFileSync(PROJ + "/work/roms-dev/blaster-master-usa.nes"));
const stock = buildPack(rom, "ref.nes").pack;
ok("stock pack builds", stock && stock.ok !== false);
{
  const b6 = stock.prg[6];
  const w125 = b6[2 + 2 * 124] | (b6[3 + 2 * 124] << 8);
  ok("bank6 behavior word[125]==B2EC (direct-path premise)", w125 === 0xB2EC, "got 0x" + w125.toString(16));
}
const pads = Buffer.from(readFileSync(join(HERE, "bug2521-pads.b64"), "utf8").trim(), "base64");
ok("pad log 2521 frames", pads.length === 2521, "got " + pads.length);
function fnv(b) { let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777219); } return h >>> 0; }
async function replay() {
  const WASMB = new Uint8Array(readFileSync(PROJ + "/frontend/build/game.wasm"));
  const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((b, i) => q.set(b, i * banks[0].length)); return q; };
  let win = null, trap = null;
  const vids = [];
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad(f < pads.length ? pads[f] : 0);
    if (f % 100 === 0) {
      const mem = new Uint8Array(ex.memory.buffer);
      const vp = ex.bm_video_ptr();
      vids.push(fnv(mem.slice(vp, vp + 256 * 240 * 4)));
    }
    if (f >= 2600) throw new Error("STOP");
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = new Uint8Array(inst.exports.memory.buffer);
    mm.set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm.set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_enhanced_set(1); inst.exports.bm_saving_set(1);
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== "STOP") trap = String((e && e.message) || e).slice(0, 80); }
  const ex = win.exports;
  const g = (a) => { try { return ex.bm_ram_rd(a); } catch (e) { return -99; } };
  let slots = "";
  for (let s = 0; s < 18; s++) { const t = g(0x400 + s * 14); if (t !== 0) slots += s + ":" + t + " "; }
  return { trap, flag: ex.bm_trap_flag(), area: g(0x14), slots, vids };
}
const R = await replay();
ok("movie replays trap-free past f=2521", R.trap === null && R.flag === 0, R.trap || ("flag=" + R.flag));
ok("ends in area 8 dungeon gameplay", R.area === 8, "area=" + R.area);
ok("type-125 actor present (the B2EC dispatcher)", R.slots.indexOf(":125 ") >= 0, R.slots);
const K1 = R.vids.join(","), R2 = await replay();
ok("determinism x2 (video hashes + slot state)", R2.trap === null && R2.vids.join(",") === K1 && R2.slots === R.slots, "");
console.log("---- B2EC: " + pass + " pass / " + fail + " ----");
if (fail > 0) process.exit(1);
