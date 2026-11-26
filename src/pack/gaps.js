// Editor-gap batch: read-only RE summaries for the editor (pure, no DOM).
// Wires 6.4f physics + 6.4g behavior + P4 doors into the enemies tab and a
// notes panel. All facts proven headless elsewhere (see PLAN 6.1/6.4f/6.4g).
import { TANK_TYPE_ACTOR, TYPE_ACTOR, TANK_TRAP_TYPES, INVALID_TYPES, TANK_DORMANT_TYPES, tankEmptyType, powerupSubtype, BOSS_TYPE } from "./enemies.js";
import { DUN_TABLE, TANK_TABLE, SLOT_BASE, SLOT_STRIDE, SLOT_N, DUN_TABLE_BASE, TANK_TABLE_BASE } from "./behavior.js";
import { JASON_RUN, JASON_JUMP, TANK } from "./physics.js";
import { parseDoors, pairOf } from "./doors.js";
const NOTES = { 85: "dungeon walker: falls to floor, patrols X +-15/f", 89: "converter output (camera-approach)", 69: "tank flyer: slow +X drift, rising Y", 35: "powerup loiter (static, countdown)", 91: "boss egg: b11 C0-set countdown", 99: "boss: dormant post-morph, then active" };
export function behaviorFor(isTank, type) {
  const t = type | 0;
  let actor = null;
  if (isTank) actor = (t in TANK_TYPE_ACTOR) ? TANK_TYPE_ACTOR[t] : null;
  else actor = powerupSubtype(t) >= 0 ? 53 : ((t in TYPE_ACTOR) ? TYPE_ACTOR[t] : null);
  const table = isTank ? TANK_TABLE : DUN_TABLE;
  const idx = isTank ? t - 1 : actor;
  const routine = (actor == null || idx == null || idx < 0 || idx >= table.length) ? null : table[idx];
  let tag = "";
  if (isTank) {
    if (TANK_TRAP_TYPES.has(t)) tag = "TRAP";
    else if (TANK_DORMANT_TYPES.has(t)) tag = "dormant";
    else if (tankEmptyType(t)) tag = "empty";
    else if (t === BOSS_TYPE) tag = "egg";
  } else if (INVALID_TYPES.has(t)) tag = "TRAP";
  return { actor, routine, tag, note: (actor != null && NOTES[actor]) || "" };
}
export function behaviorText(b) {
  if (b.actor == null || b.routine == null) return "?" + (b.tag || "unmapped");
  return "$" + b.actor.toString(16) + "->$" + b.routine.toString(16) + (b.tag ? " " + b.tag : "");
}
export function levelArea(level) { return level <= 8 ? level + 7 : level - 9; }
export function doorsForLevel(prg7, level) {
  const d = parseDoors(prg7);
  if (!d.ok) return { ok: false, errors: d.errors };
  const area = levelArea(level);
  const out = [];
  for (let i = 0; i < d.rows.length; i++) {
    const r = d.rows[i];
    if (r.area !== area) continue;
    const q = d.rows[pairOf(i)];
    out.push({ row: i, x: r.x, y: r.y, toArea: q.area, toX: q.x, toY: q.y });
  }
  return { ok: true, area, sides: out };
}
export function physicsText() {
  return "run accel +-" + JASON_RUN.ACCEL + "/f2 vmax +-" + JASON_RUN.VMAX + "/f friction -+" + JASON_RUN.FRICTION + "/f2" + " | jump $7D " + JASON_JUMP.Y0 + "->" + JASON_JUMP.APEX + "->" + JASON_JUMP.Y0 + " VREST=$" + JASON_JUMP.VREST.toString(16) + " | tank vel=dir*" + TANK.VMAX + "/f instant YREST=$" + TANK.YREST.toString(16);
}
export function slotText() {
  return "slots " + SLOT_N + "x14B @ $" + SLOT_BASE.toString(16) + " stride $" + SLOT_STRIDE.toString(16) + " | dungeon ($7A)=$" + DUN_TABLE_BASE.toString(16) + " word[actor] tank ($7A)=$" + TANK_TABLE_BASE.toString(16) + " word[type-1]";
}
