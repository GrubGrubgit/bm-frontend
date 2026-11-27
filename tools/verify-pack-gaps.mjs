// Editor-gap batch: behavior column + trap validation + RE notes + doors.
// Run: node tools/verify-pack-gaps.mjs
import { readFileSync } from "fs";
import { buildPack } from "../src/pack/builder.js";
import { TANK_TYPE_ACTOR, TYPE_ACTOR, TANK_TRAP_TYPES, INVALID_TYPES, TANK_DORMANT_TYPES, tankEmptyType, powerupSubtype, spawnTypeAllowed, SPR_A, SPR_B, actorSpriteFor, actorFor, liveSpriteSummary, parseSpawns, serializeSpawns } from "../src/pack/enemies.js";
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
// ---- live OAM-observed actor sprites (headless proof 2026-11-27; staged SPR_* retired from markers) ----
{
  const has = (s, t) => !!s && s.tiles.some((e) => e.t === t);
  const s45 = actorSpriteFor(true, 14);
  ok("live t45 7spr cf sub1", !!s45 && s45.tiles.length === 7 && s45.sub === 1 && has(s45, 0xcf) && has(s45, 0x4c) && s45.w === 24);
  const s31 = actorSpriteFor(true, 5);
  ok("live t5 pair c7d7", !!s31 && s31.tiles.length === 2 && s31.tiles[0].t === 0xc7 && s31.tiles[1].t === 0xd7 && s31.sub === 1);
  const s23 = actorSpriteFor(true, 33);
  ok("live t33 pair 8090", !!s23 && s23.tiles.length === 2 && s23.tiles[0].t === 0x80 && s23.tiles[1].t === 0x90);
  ok("live egg null", actorSpriteFor(true, 32) === null);
  const sb = actorSpriteFor(true, 49);
  ok("live boss pair a7b7 sub2", !!sb && sb.tiles.length === 2 && sb.tiles[0].t === 0xa7 && sb.sub === 2);
  const d55 = actorSpriteFor(false, 0);
  ok("live d0 walker c2d2", !!d55 && d55.tiles.length === 2 && has(d55, 0xc2) && has(d55, 0xd2) && d55.sub === 1);
  const d59 = actorSpriteFor(false, 2);
  ok("live d2 conv eefc", !!d59 && d59.tiles.length === 4 && has(d59, 0xee) && has(d59, 0xfd));
  const d35 = actorSpriteFor(false, 33);
  ok("live d33 pow 6070", !!d35 && d35.tiles.length === 4 && has(d35, 0x60) && has(d35, 0x71));
  const d60 = actorSpriteFor(false, 5);
  ok("live d5 ab-ac-ae", !!d60 && d60.tiles.length === 6 && has(d60, 0xab) && has(d60, 0xbe));
  ok("live unmapped undefined", actorSpriteFor(true, 70) === undefined && actorSpriteFor(false, 70) === undefined);
  ok("live range undef", actorSpriteFor(true, -1) === undefined && actorSpriteFor(false, 200) === undefined);
  const s10 = actorSpriteFor(true, 10);
  ok("live t10 visible-as 3c", !!s10 && s10.tiles.length === 2 && s10.tiles[0].t === 0xa7 && s10.tiles[1].t === 0xb7 && s10.sub === 1);
  ok("live null spawners", actorSpriteFor(true, 6) === null && actorSpriteFor(false, 42) === null);
  const d19 = actorSpriteFor(false, 19);
  ok("live d19 visible-as 7c", !!d19 && d19.tiles.length === 4 && d19.tiles[0].t === 0xd8);
  const d32 = actorSpriteFor(false, 32);
  ok("live d32 visible-as 91", !!d32 && d32.tiles.length === 12 && d32.tiles[0].t === 0xb6);
  ok("live summary", liveSpriteSummary(true, 14).indexOf("$cf") >= 0 && liveSpriteSummary(true, 32).indexOf("invisible") >= 0 && liveSpriteSummary(false, 4).indexOf("unobserved") >= 0 && liveSpriteSummary(true, 70).indexOf("no actor") >= 0 && liveSpriteSummary(true, 10).indexOf("3c") >= 0 && liveSpriteSummary(false, 19).indexOf("7c") >= 0);
  ok("live actor ids", actorFor(true, 14) === 0x45 && actorFor(true, 33) === 0x23 && actorFor(false, 0) === 0x55 && actorFor(false, 33) === 0x35);
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
// ---- live-OAM dynamics: cooked all-same-type packs, slots + OAM clusters (x2) ----
{
  const cook = (key, type) => {
    const P = { prg: stock.prg.map((b) => b.slice()), chr: stock.chr.map((b) => b.slice()) };
    const p = parseSpawns(P.prg[3]);
    const L = p.lists.filter((z) => z.key === key)[0];
    const t = L.types.slice();
    for (let i = 0; i < L.n; i++) t[i] = type;
    const ed = {};
    ed[key] = { types: t, xs: L.xs.slice(), ys: L.ys.slice() };
    const s = serializeSpawns(p, ed);
    if (!s.ok) return null;
    P.prg[3] = s.bytes;
    return P;
  };
  const runOAM = async (P, warpKind, k, warpAt, padFn, snapsAt) => {
    let n = -1;
    const out = [];
    const inst = (await WebAssembly.instantiate(WASMB2, { env: { host_frame: (f) => {
      n++;
      const ex = win.exports;
      ex.bm_set_pad(padFn(n));
      if (n === warpAt) { if (warpKind === 0) ex.bm_warp_raw(k); else ex.bm_warp(k); }
      if (snapsAt.indexOf(n) >= 0) {
        ex.bm_snap();
        const ram = new Uint8Array(2048);
        for (let a = 0; a < 2048; a++) ram[a] = ex.bm_ram_rd(a);
        const mem = new Uint8Array(ex.memory.buffer);
        const op = ex.bm_oam_ptr();
        out.push({ n, ram, oam: mem.slice(op, op + 256) });
      }
      if (n >= snapsAt[snapsAt.length - 1] + 5) throw new Error("STOP");
    } } })).instance;
    const win = { exports: inst.exports };
    try {
      const mm8 = new Uint8Array(win.exports.memory.buffer);
      mm8.set(catB2(P.prg), win.exports.bm_stage_ptr()); win.exports.bm_load_prg();
      mm8.set(catB2(P.chr), win.exports.bm_stage_ptr()); win.exports.bm_load_chr();
      win.exports.bm_boot();
    } catch (e) { if (e.message !== "STOP") return []; }
    return out;
  };
  const WASMB2 = new Uint8Array(readFileSync(PROJ + "/frontend/build/game.wasm"));
  const catB2 = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
  const still = (n) => n === 61 ? 8 : 0;
  const drive = (n) => n === 61 ? 8 : ((n >= 860) ? 128 : 0);
  const hasTile = (oam, t) => { for (let i = 0; i < 64; i++) if (oam[i * 4 + 1] === t) return true; return false; };
  const actors = (ram) => { const o = []; for (let i = 0; i < 18; i++) o.push(ram[1024 + i * 14]); return o; };
  const PT = cook("A0", 14);
  const T1 = await runOAM(PT, 0, 0, 700, still, [1150]);
  const T2 = await runOAM(PT, 0, 0, 700, still, [1150]);
  ok("live dyn T45 boot", T1.length === 1 && T2.length === 1);
  if (T1.length && T2.length) {
    const a1 = actors(T1[0].ram), a2 = actors(T2[0].ram);
    ok("live dyn T45 slots", a1[8] === 0x45 && a1[11] === 0x45 && a2[8] === 0x45);
    ok("live dyn T45 oam cf", hasTile(T1[0].oam, 0xcf) && hasTile(T2[0].oam, 0xcf));
    ok("live dyn T45 deter", a1.every((v, i) => v === a2[i]) && T1[0].oam.every((v, i) => v === T2[0].oam[i]));
  }
  const PD = cook("B1", 33);
  const D1 = await runOAM(PD, 1, 9, 700, drive, [1000]);
  const D2 = await runOAM(PD, 1, 9, 700, drive, [1000]);
  ok("live dyn Dpow boot", D1.length === 1 && D2.length === 1);
  if (D1.length && D2.length) {
    const a1 = actors(D1[0].ram);
    ok("live dyn Dpow slots", a1.indexOf(0x35) >= 0);
    ok("live dyn Dpow oam 60", hasTile(D1[0].oam, 0x60) && hasTile(D2[0].oam, 0x60));
    ok("live dyn Dpow deter", a1.every((v, i) => v === actors(D2[0].ram)[i]));
  }
}
// ---- sprite-marker editor wiring ----
{
  const ed2 = readFileSync(PROJ + "/frontend/src/ui/editor.js", "utf8");
  ok("ed live tile helper", ed2.includes("actorSpriteFor(isTank") && ed2.includes("enemyActorImg"));
  ok("ed live readout", ed2.includes("live sprites: ") && ed2.includes("live: "));
  ok("ed no staged markers", !ed2.includes("spriteTileFor") && !ed2.includes("enemySpriteImg") && ed2.includes("liveSpriteSummary"));
}

console.log("---- gaps: " + pass + " pass / " + fail + " fail ----");
if (fail) process.exit(1);
