// Editor-gap batch: behavior column + trap validation + RE notes + doors.
// Run: node tools/verify-pack-gaps.mjs
import { readFileSync } from "fs";
import { buildPack } from "../src/pack/builder.js";
import { TANK_TYPE_ACTOR, TYPE_ACTOR, TANK_TRAP_TYPES, INVALID_TYPES, TANK_DORMANT_TYPES, tankEmptyType, powerupSubtype, spawnTypeAllowed, SPR_A, SPR_B, spriteTileFor } from "../src/pack/enemies.js";
import { DUN_TABLE, TANK_TABLE } from "../src/pack/behavior.js";
import { behaviorFor, behaviorText, doorsForLevel, levelArea, physicsText, slotText, areaSongText, soundText, soundSitesLine, aiLabelFor, enemyTypeOptions } from "../src/pack/gaps.js";
import { parseDoors, pairOf } from "../src/pack/doors.js";
const PROJ = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n + (x ? " :: " + x : "")); } };
const rom = new Uint8Array(readFileSync(PROJ + "/work/roms-dev/blaster-master-usa.nes"));
const stock = buildPack(rom, "ref.nes").pack;
// ---- behaviorFor ----
{
  const b = behaviorFor(true, 1);
  ok("tank t1 actor+routine", b.actor === 0x27 && b.routine === TANK_TABLE[0] && TANK_TABLE[0] === 0x8af1 && b.tag === "");
  const be = behaviorFor(true, 32);
  ok("tank t32 egg", be.actor === 0x5b && be.routine === TANK_TABLE[31] && be.tag === "egg");
  const bt = behaviorFor(true, 0);
  ok("tank t0 trap", bt.actor == null && bt.tag === "TRAP");
  const bd = behaviorFor(true, 43);
  ok("tank t43 dormant", bd.tag === "dormant");
  const bem = behaviorFor(true, 16);
  ok("tank t16 empty", bem.tag === "empty");
  const bu = behaviorFor(true, 70);
  ok("tank t70 unmapped", bu.actor == null && bu.tag === "" && behaviorText(bu) === "?unmapped");
  const d0 = behaviorFor(false, 0);
  ok("dun t0 walker", d0.actor === 0x55 && d0.routine === DUN_TABLE[0x55] && DUN_TABLE[85] === 0xa40b && d0.note.length > 0);
  const dp = behaviorFor(false, 33);
  ok("dun t33 powerup", dp.actor === 0x35);
  const dt = behaviorFor(false, 9);
  ok("dun t9 trap", dt.actor == null && dt.tag === "TRAP");
  ok("text format", behaviorText(d0) === "$55->$a40b");
}
// ---- spawnTypeAllowed exhaustive ----
{
  const tankRef = [], dunRef = [];
  for (let t = 0; t < 128; t++) {
    if (!spawnTypeAllowed(true, t).ok) tankRef.push(t);
    if (!spawnTypeAllowed(false, t).ok) dunRef.push(t);
  }
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  ok("tank refused==trap set", eq(tankRef, [...TANK_TRAP_TYPES].sort((a, b) => a - b)));
  ok("dun refused==invalid set", eq(dunRef, [...INVALID_TYPES].sort((a, b) => a - b)));
  ok("range", !spawnTypeAllowed(true, -1).ok && !spawnTypeAllowed(true, 128).ok && !spawnTypeAllowed(false, -1).ok && !spawnTypeAllowed(false, 128).ok);
  const b32 = spawnTypeAllowed(true, 32);
  ok("tank t32 warn boss", b32.ok && b32.warn === "boss");
  const d0 = spawnTypeAllowed(false, 0);
  ok("dun t0 clean", d0.ok && !d0.warn);
  const du = spawnTypeAllowed(false, 70);
  ok("dun t70 unmapped", du.ok && du.warn === "unmapped");
}
// ---- texts + doors ----
{
  ok("physics text", physicsText().includes("24") && physicsText().includes("3b80") && physicsText().includes("1680"));
  ok("slot text", slotText().includes("8002") && slotText().includes("8006"));
  ok("levelArea", levelArea(1) === 8 && levelArea(8) === 15 && levelArea(9) === 0 && levelArea(16) === 7);
  const d = doorsForLevel(stock.prg[7], 1);
  ok("doors L1 sides", d.ok && d.area === 8 && d.sides.length > 0, JSON.stringify(d).slice(0, 120));
  const pd = parseDoors(stock.prg[7]);
  let inv = pd.ok && pd.rows.length === 108;
  for (let i = 0; i < 108 && inv; i++) inv = pairOf(pairOf(i)) === i;
  ok("doors 108+involution", inv);
  ok("doors known pair", pd.rows[0].area === 8 && pd.rows[1].area === 9, JSON.stringify(pd.rows[0]) + JSON.stringify(pd.rows[1]));
}

// ---- sound notes (6.4e v2 model, read-only) ----
{
  const a1 = areaSongText(1);
  ok("area song L1", a1.indexOf("area $8") >= 0 && a1.indexOf("song $6") >= 0 && a1.indexOf("$2d") >= 0);
  const a9 = areaSongText(9);
  ok("area song L9", a9.indexOf("area $0") >= 0 && a9.indexOf("$1e") >= 0 && a9.indexOf("$51") >= 0);
  const st = soundText();
  ok("sound text", st.indexOf("50") >= 0 && st.indexOf("43") >= 0 && st.indexOf("15") >= 0 && st.indexOf("110") >= 0 && st.indexOf("$34") >= 0);
  ok("sites 2d", soundSitesLine("2d").indexOf("b6@9499") >= 0 && soundSitesLine("2d").indexOf("byte10==2") >= 0);
  ok("sites dollar+upper", soundSitesLine("$2D").indexOf("b6@9499") >= 0);
  ok("sites invalid", soundSitesLine("zz").indexOf("invalid") >= 0 && soundSitesLine("99").indexOf("invalid") >= 0 && soundSitesLine("").indexOf("invalid") >= 0);
  ok("sites unpinned", soundSitesLine("05").indexOf("no pinned") >= 0);
}
// ---- editor wiring statics ----
{
  const ed = readFileSync(PROJ + "/frontend/src/ui/editor.js", "utf8");
  const hx = readFileSync(PROJ + "/frontend/index.html", "utf8");
  ok("ed imports gaps", ed.includes("../pack/gaps.js"));
  ok("ed trap checks", ed.split("spawnTypeAllowed(key[0]").length - 1 === 2);
  ok("ed AI column", ed.includes(behaviorText.name || "behaviorText") && ed.includes("behaviorFor(key[0]"));
  ok("ed notes call", ed.includes("renderRENotes();") && ed.includes("doorsForLevel(S.resolved"));
  ok("ed sound call", ed.includes("renderSoundNotes();") && ed.includes("areaSongText(S.level"));
  ok("html sound divs", hx.includes("edSoundNotes") && hx.includes("edSoundId") && hx.includes("edSoundOut"));
  ok("html notes divs", hx.includes("edRENotes") && hx.includes("edDoorList"));
  ok("ed enemy markers", ed.includes("renderEnemyMarkers") && ed.includes("enemyHitFromEvent"));
  ok("ed move tool", ed.includes("movingEnemy") && ed.includes("movingBlock") && ed.includes("addEnemyRecAt"));
  ok("ed brush modes", ed.includes("edBrushModeRow") && ed.includes("edEnemyBrushType"));
  ok("ai labels", aiLabelFor(false, 0).indexOf("walker") >= 0 && aiLabelFor(false, 35).indexOf("actor $35") >= 0 && enemyTypeOptions(false).length === 128 && enemyTypeOptions(true).length === 128);
}
// ---- live sprite-table mapping (headless proof 2026-11-27) ----
{
  ok("spr live tank14", spriteTileFor(true, 14) === 0x44);
  ok("spr live dun5", spriteTileFor(false, 5) === 0x5f);
  ok("spr live tank33", spriteTileFor(true, 33) === 0x1a);
  ok("spr live dun0", spriteTileFor(false, 0) === 0x54);
  ok("spr zero+range fallback", spriteTileFor(true, 16) === -1 && spriteTileFor(false, 30) === -1 && spriteTileFor(true, 43) === -1 && spriteTileFor(false, 45) === -1 && spriteTileFor(true, 128) === -1 && spriteTileFor(false, -1) === -1);
}
// ---- live-table dynamics: $FF mode flag + slot sprite bytes ----
{
  const WASMB = new Uint8Array(readFileSync(PROJ + "/frontend/build/game.wasm"));
  const catB = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
  async function snapAt(k) {
    let n = -1; let ram = null;
    const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
      n = n + 1;
      const ex = win.exports;
      ex.bm_set_pad(0);
      if (n === 61) ex.bm_set_pad(8);
      if (n === 700) ex.bm_warp_raw(k);
      if (n === 1150) { ex.bm_snap(); ram = new Uint8Array(2048); for (let a = 0; a < 2048; a++) ram[a] = ex.bm_ram_rd(a); }
      if (n >= 1155) throw new Error("STOP");
    } } })).instance;
    const win = { exports: inst.exports };
    try {
      const mm8 = new Uint8Array(win.exports.memory.buffer);
      mm8.set(catB(stock.prg), win.exports.bm_stage_ptr()); win.exports.bm_load_prg();
      mm8.set(catB(stock.chr), win.exports.bm_stage_ptr()); win.exports.bm_load_chr();
      win.exports.bm_boot();
    } catch (e) { if (e.message !== "STOP") return null; }
    return ram;
  }
  const d1 = await snapAt(8), d2 = await snapAt(8), o1 = await snapAt(0), o2 = await snapAt(0);
  ok("spr dyn boot", !!(d1 && d2 && o1 && o2));
  if (d1 && d2 && o1 && o2) {
    const win1 = (r) => { const o = []; for (let i = 0; i < 16; i++) o.push(r[336 + i]); return o; };
    const eq16 = (a, b) => a.every((v, i) => v === b[i]);
    ok("spr dyn determinism", d1[255] === d2[255] && o1[255] === o2[255] && eq16(win1(d1), win1(d2)) && eq16(win1(o1), win1(o2)));
    ok("dun FF is 90", d1[255] === 0x90);
    ok("ovh FF is b0", o1[255] === 0xb0);
    const setB = new Set(SPR_B), setA = new Set(SPR_A);
    ok("dun s150 in SPR_B", win1(d1).every((v) => v === 0 || setB.has(v)));
    ok("ovh s150 in SPR_A", win1(o1).every((v) => v === 0 || setA.has(v)));
    ok("ovh slot8 t14 tile44", o1[1024 + 8 * 14] === 0x45 && o1[336 + 8] === 0x44);
  }
}
// ---- sprite-marker editor wiring ----
{
  const ed2 = readFileSync(PROJ + "/frontend/src/ui/editor.js", "utf8");
  ok("ed live tile helper", ed2.includes("spriteTileFor(isTank") && ed2.includes("enemySpriteImg"));
  ok("ed live readout", ed2.includes("live on map") && ed2.includes("(live $"));
}
console.log("---- gaps: " + pass + " pass / " + fail + " fail ----");
if (fail) process.exit(1);
