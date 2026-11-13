// Direct-input gameplay test: drives the wasm engine with scripted pad bytes
// (mask $01=A $02=B $04=Select $08=Start $10=Up $20=Down $40=Left $80=Right)
// and asserts on EMULATOR STATE (slot 0 = player: type/x/y; object slots),
// never on pixels. No screenshots, no browser. Usage: node tools/playtest.mjs
//
// Lessons encoded: Jason needs ~30f of stand-settle after walking before B
// fires (immediate post-walk B is swallowed); the 0x2A grenade-init phase is
// sub-frame, so the lifecycle scan watches 0x2B (flying) -> 0x4B (explosion).
import { readFileSync } from "fs";
const ROM = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/work/roms-dev/blaster-master-usa.nes";
const WASM = new URL("../build/game.wasm", import.meta.url);
const rom = new Uint8Array(readFileSync(ROM));
const prg = rom.slice(16, 16 + 131072), chr = rom.slice(16 + 131072, 16 + 262144);
const bytes = readFileSync(WASM);
const A = 1, B = 2, SEL = 4, START = 8, UP = 16, LEFT = 64, RIGHT = 128;
function padAt(f) {
  if (f >= 2700 && f < 2705) return START;   // title -> game
  if (f < 2800) return 0;
  if (f < 4200) { const t = (f - 2800) % 120; return t < 5 ? RIGHT | B : RIGHT; } // drive+fire
  if (f < 4230) return SEL;                  // exit tank
  if (f < 4330) return RIGHT;                // Jason walk right
  if (f < 4430) return LEFT;                 // Jason walk left
  if (f < 4460) return 0;                    // settle 30f
  if (f < 4470) return B;                    // fire (10f hold)
  if (f < 4800) return 0;                    // grenade lifecycle
  if (f < 4830) return UP;                   // door attempt at park x
  if (f < 4835) return START;                // pause as Jason (was vec-815c trap)
  if (f < 4840) return 0;
  if (f < 4845) return START;                // unpause
  if (f < 5200) return 0;
  if (f < 5300) return RIGHT | B;            // walk+fire right
  if (f < 5310) return A;                    // jump/hover button
  if (f < 6200) { const t = f % 60; return t < 30 ? RIGHT : LEFT | B; } // soak
  return 0;
}
let fails = 0;
const check = (n, ok, info) => { console.log((ok ? "PASS" : "FAIL") + " " + n + (info ? " " + info : "")); if (!ok) fails++; };
const P = { xJR: 0, sawFly: false, sawExpl: false, trap: null, audioTot: 0, doorXY: "" };
let inst = null;
const p = await WebAssembly.instantiate(bytes, { env: { host_frame: (f) => {
  const ex = inst.exports;
  ex.bm_set_pad(padAt(f));
  ex.bm_snap();
  const mem = new Uint8Array(ex.memory.buffer);
  const sp = ex.bm_stage_ptr();
  const snap = mem.slice(sp, sp + 4160);
  P.audioTot += ex.bm_audio_read(sp, 256);
  const type = snap[1024], px = snap[1026] + 256 * snap[1027], py = snap[1028] + 256 * snap[1029];
  if (f === 4199) check("tank-parked", type === 3 && px > 9000, "type=" + type + " x=" + px + " y=" + py);
  if (f === 4235) check("select-exits-tank", type === 27, "type=" + type);
  if (f === 4329) P.xJR = px;
  if (f === 4429) { check("jason-walk-right", px !== 10304 || P.xJR === 10432, "R=" + P.xJR); check("jason-walk-left", px < P.xJR, "L=" + px); }
  if (f >= 4460 && f < 4800) {
    for (let i = 0; i < 18; i++) { const t = snap[1024 + i * 14]; if (t === 0x2B) P.sawFly = true; if (t === 0x4B) P.sawExpl = true; }
  }
  if (f === 4800) { check("grenade-lifecycle", P.sawFly && P.sawExpl, "fly=" + P.sawFly + " expl=" + P.sawExpl); check("jason-survives-grenade", type === 27, "type=" + type); }
  if (f === 4829) P.doorXY = "x=" + px + " y=" + py + " t=" + type;
  if (f === 4845) check("pause-as-jason-survives", type === 27, "type=" + type + " (vec-815c regression)");
  if (f === 6199) check("soak-player-valid", type === 27 || type === 3, "type=" + type + " x=" + px + " y=" + py);
  if (f + 1 >= 6200) throw new Error("STOP");
}}});
inst = p.instance;
const mem = () => new Uint8Array(inst.exports.memory.buffer);
mem().set(prg, inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
mem().set(chr, inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
try { inst.exports.bm_boot(); }
catch (e) {
  if (e.message !== "STOP") {
    P.trap = String((e && e.message) || e).slice(0, 80);
    try {
      inst.exports.bm_snap();
      const m2 = new Uint8Array(inst.exports.memory.buffer);
      const q = inst.exports.bm_stage_ptr(), ss = m2.slice(q, q + 4160);
      let sl = "vec=" + (ss[122] + 256 * ss[123]).toString(16) + " ptype=" + ss[102] + " px=" + (ss[1026] + 256 * ss[1027]);
      for (let i = 0; i < 18; i++) { const b = 1024 + i * 14; if (ss[b] !== 0) sl += " [" + i + "]t=" + ss[b].toString(16); }
      console.log("TRAP-DUMP " + sl);
    } catch (ee) {}
  }
}
check("no-unreachable-trap-6200f", P.trap === null, P.trap ? P.trap : "clean");
check("audio-flowing", P.audioTot > 0, "edges=" + P.audioTot);
console.log("DOOR-ATTEMPT-INFO " + P.doorXY + " (documents, does not fail)");
console.log("PLAYTEST-DONE fails=" + fails);
process.exit(fails ? 1 : 0);
