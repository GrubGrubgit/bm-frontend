// Editor-gap batch: behavior column + trap validation + RE notes + doors.
// Run: node tools/verify-pack-gaps.mjs
import { readFileSync } from "fs";
import { buildPack } from "../src/pack/builder.js";
import { TANK_TYPE_ACTOR, TYPE_ACTOR, TANK_TRAP_TYPES, INVALID_TYPES, TANK_DORMANT_TYPES, tankEmptyType, powerupSubtype, spawnTypeAllowed } from "../src/pack/enemies.js";
import { DUN_TABLE, TANK_TABLE } from "../src/pack/behavior.js";
import { behaviorFor, behaviorText, doorsForLevel, levelArea, physicsText, slotText } from "../src/pack/gaps.js";
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
// ---- editor wiring statics ----
{
  const ed = readFileSync(PROJ + "/frontend/src/ui/editor.js", "utf8");
  const hx = readFileSync(PROJ + "/frontend/index.html", "utf8");
  ok("ed imports gaps", ed.includes("../pack/gaps.js"));
  ok("ed trap checks", ed.split("spawnTypeAllowed(key[0]").length - 1 === 2);
  ok("ed AI column", ed.includes(behaviorText.name || "behaviorText") && ed.includes("behaviorFor(key[0]"));
  ok("ed notes call", ed.includes("renderRENotes();") && ed.includes("doorsForLevel(S.resolved"));
  ok("html notes divs", hx.includes("edRENotes") && hx.includes("edDoorList"));
}
console.log("---- gaps: " + pass + " pass / " + fail + " fail ----");
if (fail) process.exit(1);
