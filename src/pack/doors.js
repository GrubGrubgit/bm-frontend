// P4: static door table (PRG bank 7 = fixed bank, bank-rel 0x1D7E).
// Layout (probe-proven 2026-11-24): areas[108] @0x1D7E, xhi @+108,
// yhi @+216. Consecutive rows are EOR-1 pairs (side Y <-> Y^1).
// The fixed-bank dispatcher (b7 C78F/C79D/C7A8) teleports on EXACT
// match areas[Y]==$14 AND xcol[Y]==$49 AND ycol[Y]==$4B (FOUND: Y^=1).
// Known proof pair: row1 (9,69,75) <-> row0 (8,9,125) (Down-entry
// from area 9 lands area 8 at (9,125); suite drives it).
export const DOOR_BASE = 0x1D7E;
export const DOOR_N = 108;
export function parseDoors(bank7) {
  const errors = [];
  if (!bank7 || bank7.length < DOOR_BASE + DOOR_N * 3) errors.push('bank7 too small');
  const rows = [];
  if (!errors.length) {
    for (let i = 0; i < DOOR_N; i++) {
      const area = bank7[DOOR_BASE + i] & 15;
      const raw = bank7[DOOR_BASE + i];
      if (raw >= 16) errors.push('row' + i + ' area>=16');
      rows.push({ area, x: bank7[DOOR_BASE + DOOR_N + i], y: bank7[DOOR_BASE + DOOR_N * 2 + i] });
    }
  }
  return { ok: errors.length === 0, rows, errors };
}
export function pairOf(i) { return i ^ 1; }
export function findSide(rows, area, x, y) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.area === area && r.x === x && r.y === y) return i;
  }
  return -1;
}
// Exact-match overlap (mirrors the dispatcher's Y-loop predicate).
export function matchDoor(rows, area, x, y) {
  const i = findSide(rows, area, x, y);
  return i < 0 ? null : rows[pairOf(i)];
}

