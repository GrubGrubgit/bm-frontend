// src/pack/minimap.js -- E8-M3 HUD minimap model (pure, no DOM, no engine).
// Screen grid: 8 screens per row (32 blocks / 4); rows vary per level
// (32 tank, 25 L9, 29 L13). Screen bit index matches the engine
// visit_bits layout: bit (sy*8+sx), byte ((sy*8+sx)>>3) of the level's
// 8-byte row (see visit_mark in src/core/bm_api.c).
import { parseBank } from './levels.js';
import { parseDoors, pairOf } from './doors.js';
import { AREA_LEVEL, MAP_COLS } from './world.js';
export var MINI_PX = 4;
export var MINI_W = 128;
export var MINI_H = 128;
export var VISIT_ROWS = [32, 32, 32, 32, 32, 32, 32, 32, 25, 32, 32, 32, 29, 32, 32, 32];
export function screensYOf(rows) { return Math.ceil(rows / 4); }
export function decodeCur(cur) {
  if (typeof cur !== 'number' || cur < 0 || cur > 1023) return null;
  var lv = ((cur / 64) | 0) + 1;
  var s = cur % 64;
  return { lv: lv, sx: s % 8, sy: ((s / 8) | 0) };
}
export function isVisited(bytes, lv, sx, sy) {
  if (!bytes || lv < 1 || lv > 16 || sx < 0 || sx > 7 || sy < 0 || sy > 7) return false;
  var i = sy * 8 + sx;
  return ((((bytes[(lv - 1) * 8 + (i >> 3)] | 0) >> (i & 7)) & 1) === 1);
}
export function visitsHash(bytes) {
  var h = 2166136261;
  for (var i = 0; i < 128; i++) { h ^= (bytes[i] | 0) & 255; h = Math.imul(h, 16777219); }
  return (h >>> 0).toString(16);
}
export function minimapCacheKey(packId, packCrc, lv) {
  return String(packId) + '::' + String(packCrc) + '::L' + (lv | 0);
}
export function buildMinimap(pack) {
  var errors = [];
  if (!pack || !pack.prg || pack.prg.length < 8 || !pack.chr) return { ok: false, errors: ['bad-pack'], levels: null };
  var parsed = [0, 1, 2].map(function (b) { return parseBank(pack.prg[b], b); });
  for (var k = 0; k < 3; k++) if (!parsed[k].ok) return { ok: false, errors: ['parseBank:' + parsed[k].errors.join(';')], levels: null };
  var L = {};
  for (var p = 0; p < 3; p++) {
    var ls = parsed[p].levels;
    for (var j = 0; j < ls.length; j++) L[ls[j].level] = ls[j];
  }
  for (var lv = 1; lv <= 16; lv++) if (!L[lv]) return { ok: false, errors: ['missing-level:' + lv], levels: null };
  var pd = parseDoors(pack.prg[7]);
  if (!pd.ok) return { ok: false, errors: pd.errors.slice(), levels: null };
  var levels = {};
  for (var v = 1; v <= 16; v++) {
    var rows = L[v].map.length / MAP_COLS;
    levels[v] = { level: v, rows: rows, screensX: 8, screensY: screensYOf(rows), ticks: [] };
  }
  for (var i = 0; i < pd.rows.length; i++) {
    var r = pd.rows[i];
    var lvl = AREA_LEVEL(r.area);
    var bx = r.x >> 2, by = r.y >> 2;
    var sx = bx >> 2, sy = by >> 2;
    levels[lvl].ticks.push({ side: i, pair: pairOf(i), bx: bx, by: by, sx: sx, sy: sy, px: bx * MINI_PX + 2, py: by * MINI_PX + 2, cx: sx * 16 + 8, cy: sy * 16 + 8 });
  }
  return { ok: true, errors: [], levels: levels };
}
export function fogCells(bytes, info) {
  // Screen-level fog for one level. void=true for screens at/below the
  // map bottom (sy*4 >= rows, e.g. L9 screen-row 7); those never clear.
  // M3 shows plain fog for everything unvisited (incl. the 64 M1 pockets,
  // which hold no doors and stay fogged forever); symbols wait for M4.
  var out = [];
  for (var sy = 0; sy < 8; sy++) for (var sx = 0; sx < 8; sx++) {
    if (sy * 4 >= info.rows) out.push({ sx: sx, sy: sy, visited: false, void: true });
    else out.push({ sx: sx, sy: sy, visited: isVisited(bytes, info.level, sx, sy), void: false });
  }
  return out;
}
