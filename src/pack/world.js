// src/pack/world.js -- E8-M1 static world topology (no DOM, no engine).
// Levels (game levels 1-16) from levels.js; door sides from doors.js.
// Door side -> level: area$14 a -> a<8 ? a+9 : a-7 (PROVEN: all 108 sides
// land on door-combo blocks of exactly that level, see verify-world-e8m1).
// Door coords: block = (xhi>>2, yhi>>2), screen = (bx>>2, by>>2).
// Screens are 4x4 blocks; the map is 32 blocks wide -> 8 screens per row.
// Graph nodes are (level, sx, sy) screens; edges are door pairs (teleports)
// plus walkable screen borders (tile-level: a shared border row/col with a
// walkable tile on both sides; walkable = combo attr bit7 clear -- 0x42
// walkable proves bit7 is the solid bit; door-bit combos 0x8/0x9/0xB have
// bit7 clear and pass as walkable floor).
import { parseBank, mapLenOf } from './levels.js';
import { parseDoors, pairOf } from './doors.js';
import { blockTiles } from './tiles.js';
export const MAP_COLS = 32;
export const AREA_LEVEL = (a) => ((a & 15) < 8 ? (a & 15) + 9 : (a & 15) - 7);
export function isDoorAttr(a) { return ((a & 0x0C) !== 0 || a === 0x8B); }
// combo index at (tileX, tileY) of level L's map (tile = 8px units).
function comboAt(L, tx, ty) {
  const cols = MAP_COLS, rows = L.map.length / MAP_COLS;
  const bx = tx >> 3, by = ty >> 3;
  if (bx < 0 || by < 0 || bx >= cols || by >= rows) return -1;
  const bi = L.map[by * cols + bx];
  const tiles = blockTiles(L, bi); // 64 entries row-major 8x8
  return tiles[(ty & 7) * 8 + (tx & 7)].tile;
}
function attrAt(L, tx, ty) {
  const ci = comboAt(L, tx, ty);
  if (ci < 0 || ci >= L.attrs.length) return 0x80; // out of map = solid
  return L.attrs[ci];
}
export function tileWalkable(L, tx, ty) { return (attrAt(L, tx, ty) & 0x80) === 0; }
export function screensOf(levelRowCount) { return { x: 8, y: Math.ceil(levelRowCount / 4) }; }
export function screenOfBlock(bx, by) { return { sx: bx >> 2, sy: by >> 2 }; }
export function buildWorld(pack) {
  const errors = [];
  const parsed = [0, 1, 2].map((b) => parseBank(pack.prg[b], b));
  for (const p of parsed) if (!p.ok) return { ok: false, errors: ['parseBank:' + p.errors.join(';')] };
  const L = {};
  for (const p of parsed) for (const l of p.levels) L[l.level] = l;
  for (let lv = 1; lv <= 16; lv++) if (!L[lv]) return { ok: false, errors: ['missing-level:' + lv] };
  const pd = parseDoors(pack.prg[7]);
  if (!pd.ok) return { ok: false, errors: pd.errors.slice() };
  const levels = {};
  for (let lv = 1; lv <= 16; lv++) {
    const l = L[lv];
    const rows = l.map.length / MAP_COLS;
    levels[lv] = {
      level: lv, mode: l.mode, bank: l.bank, rows,
      screensX: 8, screensY: Math.ceil(rows / 4),
      scrollV: Array.from(l.scroll.slice(0, 8)), scrollH: Array.from(l.scroll.slice(8, 16)),
      pal: Array.from(l.pal),
    };
  }
  // door sides -> screens
  const sides = pd.rows.map((r, i) => {
    const level = AREA_LEVEL(r.area);
    const bx = r.x >> 2, by = r.y >> 2;
    const { sx, sy } = screenOfBlock(bx, by);
    return { idx: i, area: r.area, x: r.x, y: r.y, pair: pairOf(i), level, bx, by, sx, sy };
  });
  // door-combo check per side (block contains a door-attr combo)
  for (const s of sides) {
    const l = L[s.level];
    s.inMap = s.bx >= 0 && s.bx < MAP_COLS && s.by >= 0 && s.by < l.map.length / MAP_COLS;
    s.doorBit = false;
    if (s.inMap) {
      const bi = l.map[s.by * MAP_COLS + s.bx];
      const b4 = [l.blocks[bi * 4], l.blocks[bi * 4 + 1], l.blocks[bi * 4 + 2], l.blocks[bi * 4 + 3]];
      outer: for (const si of b4) {
        for (let k = 0; k < 4; k++) {
          if (isDoorAttr(l.attrs[l.structs[si * 4 + k]])) { s.doorBit = true; break outer; }
        }
      }
    }
  }
  // union-find over screens
  const key = (lv, sx, sy) => lv + ':' + sx + ',' + sy;
  const parent = {};
  const find = (k) => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let lv = 1; lv <= 16; lv++) {
    const { screensX, screensY } = levels[lv];
    for (let sy = 0; sy < screensY; sy++) for (let sx = 0; sx < screensX; sx++) parent[key(lv, sx, sy)] = key(lv, sx, sy);
  }
  // door-pair edges
  const doorEdges = [];
  for (const s of sides) {
    const t = sides[s.pair];
    if (!t) { errors.push('dangling-pair:' + s.idx); continue; }
    union(key(s.level, s.sx, s.sy), key(t.level, t.sx, t.sy));
    if (s.idx < s.pair) doorEdges.push([key(s.level, s.sx, s.sy), key(t.level, t.sx, t.sy)]);
  }
  // walkable-border edges (tile level, 32 tiles per screen side)
  const borderEdges = [];
  for (let lv = 1; lv <= 16; lv++) {
    const l = L[lv], { screensX, screensY } = levels[lv];
    const W = (sx, sy) => {
      // walkability of every border tile around screen (sx,sy): {e:[32], s:[32]}
      const e = [], sso = [];
      for (let t = 0; t < 32; t++) {
        e.push(tileWalkable(l, sx * 32 + 31, sy * 32 + t) && tileWalkable(l, sx * 32 + 32, sy * 32 + t));
        sso.push(tileWalkable(l, sx * 32 + t, sy * 32 + 31) && tileWalkable(l, sx * 32 + t, sy * 32 + 32));
      }
      return { e, s: sso };
    };
    for (let sy = 0; sy < screensY; sy++) for (let sx = 0; sx < screensX; sx++) {
      const w = W(sx, sy);
      if (sx + 1 < screensX && w.e.some(Boolean)) { union(key(lv, sx, sy), key(lv, sx + 1, sy)); borderEdges.push([key(lv, sx, sy), key(lv, sx + 1, sy)]); }
      if (sy + 1 < screensY && w.s.some(Boolean)) { union(key(lv, sx, sy), key(lv, sx, sy + 1)); borderEdges.push([key(lv, sx, sy), key(lv, sx, sy + 1)]); }
    }
  }
  // components
  const comp = {};
  for (let lv = 1; lv <= 16; lv++) {
    const { screensX, screensY } = levels[lv];
    for (let sy = 0; sy < screensY; sy++) for (let sx = 0; sx < screensX; sx++) {
      const r = find(key(lv, sx, sy));
      (comp[r] = comp[r] || []).push(key(lv, sx, sy));
    }
  }
  const doorScreens = new Set(sides.map((s) => key(s.level, s.sx, s.sy)));
  const doorComp = {};
  for (const k of doorScreens) { const r = find(k); (doorComp[r] = doorComp[r] || []).push(k); }
  return {
    ok: errors.length === 0, errors, levels, sides, doorEdges,
    borderEdgeCount: borderEdges.length,
    components: Object.values(comp), doorComponents: Object.values(doorComp),
  };
}
