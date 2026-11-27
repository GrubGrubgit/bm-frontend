// Editor-gap batch: read-only RE summaries for the editor (pure, no DOM).
// Wires 6.4f physics + 6.4g behavior + P4 doors + 6.4e sound into the enemies tab and a
// notes panel. All facts proven headless elsewhere (see PLAN 6.1/6.4f/6.4g/6.4e).
import { TANK_TYPE_ACTOR, TYPE_ACTOR, TANK_TRAP_TYPES, INVALID_TYPES, TANK_DORMANT_TYPES, tankEmptyType, powerupSubtype, BOSS_TYPE, spriteFor, spawnTypeAllowed } from "./enemies.js";
import { DUN_TABLE, TANK_TABLE, SLOT_BASE, SLOT_STRIDE, SLOT_N, DUN_TABLE_BASE, TANK_TABLE_BASE } from "./behavior.js";
import { JASON_RUN, JASON_JUMP, TANK } from "./physics.js";
import { parseDoors, pairOf } from "./doors.js";
import { songForArea, isSongId, sitesFor, siteCount, REQ_PATHS, MUSIC } from "./sound.js";
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

export function areaSongText(level) {
  const area = levelArea(level);
  const song = songForArea(area);
  const hex = function (n) { return "$" + n.toString(16); };
  if (level > 8) return "L" + level + " area " + hex(area) + " entry song " + hex(song) + " | tank hits " + hex(MUSIC.HIT_TANK) + " fire-and-forget, destruction " + hex(MUSIC.EXPLOSION) + " -> area-0 reload";
  return "L" + level + " area " + hex(area) + " entry song " + hex(song) + " | dungeon BGM " + hex(MUSIC.BGM_DUNGEON) + ", hit " + hex(MUSIC.HIT_DUNGEON) + " -> restore, Up fanfare " + hex(MUSIC.DOOR_FANFARE);
}
export function soundText() {
  return "sound: bank6 " + REQ_PATHS.BANK6 + " + bank4 " + REQ_PATHS.BANK4 + " + bank7 " + REQ_PATHS.BANK7 + " request sites, " + siteCount() + " pinned song-site rows; song table 85 ids (0/6 alias); $34/$52 triggers unobserved";
}
export function soundSitesLine(raw) {
  let s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (s.charAt(0) === "$") s = s.slice(1);
  if (s.charAt(0) === "0" && s.charAt(1) === "x") s = s.slice(2);
  let hexok = s.length >= 1 && s.length <= 2;
  for (let i = 0; i < s.length && hexok; i++) hexok = "0123456789abcdef".indexOf(s.charAt(i)) >= 0;
  const id = hexok ? parseInt(s, 16) : -1;
  if (!hexok || !isSongId(id)) return "invalid song id (00-54 hex)";
  const rows = sitesFor(id);
  const tag = "$" + (s.length === 1 ? "0" + s : s);
  if (!rows.length) return "song " + tag + ": no pinned request sites";
  return "song " + tag + ": " + rows.map(function (r) { return "b" + r.b + "@" + r.cpu.toString(16) + " " + r.n; }).join(" | ");
}

// Friendly AI names for the WYSIWYG editor (actor ids are decimal here:
// $55=85 walker, $59=89 converter, $45=69 tank-flyer, $23=35 powerup,
// $5B=91 egg, $63=99 boss; see NOTES above + 6.4g traces).
const AI_SHORT = { 85: "walker", 89: "converter", 69: "tank-flyer", 35: "powerup", 91: "egg", 99: "boss" };
export function aiShortFor(isTank, type) {
  const b = behaviorFor(isTank, type);
  if (b.actor == null || b.routine == null) return "?";
  return AI_SHORT[b.actor] || ("actor $" + b.actor.toString(16));
}
export function aiLabelFor(isTank, type) {
  const b = behaviorFor(isTank, type);
  if (b.actor == null || b.routine == null) return "? unmapped" + (b.tag ? " [" + b.tag + "]" : "");
  const nm = AI_SHORT[b.actor] || ("actor $" + b.actor.toString(16));
  return nm + " -> $" + b.routine.toString(16) + (b.tag ? " [" + b.tag + "]" : "");
}
export function enemyTypeOptions(isTank) {
  const out = [];
  for (let t = 0; t < 128; t++) {
    const bb = behaviorFor(isTank, t);
    const sp = spriteFor(t);
    const chk = spawnTypeAllowed(isTank, t);
    const spr = "$" + (sp.a < 0 ? "--" : sp.a.toString(16)) + "/$" + (sp.b < 0 ? "--" : sp.b.toString(16));
    let label = "t" + t + ": " + aiLabelFor(isTank, t) + " (spr " + spr + ")";
    if (!chk.ok) label += " [REFUSED: " + chk.reason + "]";
    else if (chk.warn) label += " [" + chk.warn + "]";
    out.push({ t: t, label: label, tag: bb.tag || "", ok: chk.ok, warn: chk.warn || "" });
  }
  return out;
}
