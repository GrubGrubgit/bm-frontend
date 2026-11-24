// src/pack/enemies.js -- bank-3 spawn-list parser/serializer. Pure, no DOM.
// Layout (PROVEN headless, research 6.1 + P3 survey):
// R1 (bank-rel 0, 16xLE CPU) -> R1[1] = area spawn-list table (16xLE:
// A0-A7 tank areas (levels 1-8), B0-B7 overhead areas (levels 9-16)).
// Each subpointer aims at a 6-byte triplet [type[]][x[]][y[]] (CPU addrs)
// followed immediately by the arrays: type[n+1] (type[n] is the $FF scan
// terminator on stock), x[n], y[n]. n = x-segment length; y is capped at
// n so a divergent tail (B7: y runs into the $BF53 stub, which has no
// bank-3 callers) is never touched.
// Record i spawns via CA89 as a slot ($403=xhi, $405=yhi, sprite base
// LCB51/LCB7C[type[i]], actor id via the bank6 vector[0] init); dormant
// slots (byte0=1) convert near the camera (~32px band, 813C test).
// serializeSpawns only supports same-size (in-place) edits; structural
// changes (add/remove records) fail loudly -- no free-space map yet (P3b).
export const SPAWN_BANK = 3;
export const BANK_SIZE = 16384, CPU_BASE = 0x8000;
export const R1_REL = 0, R1_SPAWN_INDEX = 1;
export const SUB_KEYS = [];
for (let i = 0; i < 8; i++) SUB_KEYS.push('A' + i);
for (let i = 0; i < 8; i++) SUB_KEYS.push('B' + i);
export function subLevel(key) {
  const i = key.charCodeAt(1) - 48;
  return key[0] === 'A' ? i + 1 : i + 9;
}
export function subMode(key) { return key[0] === 'A' ? 'tank' : 'overhead'; }
function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
export function parseSpawns(bankBytes) {
  const errors = [];
  if (!(bankBytes instanceof Uint8Array) || bankBytes.length !== BANK_SIZE) {
    return { ok: false, errors: ['bad-bank-bytes'] };
  }
  const r1 = [];
  for (let i = 0; i < 16; i++) r1.push(u16le(bankBytes, R1_REL + i * 2));
  const listRel = r1[R1_SPAWN_INDEX] - CPU_BASE;
  if (listRel < 32 || listRel + 32 > BANK_SIZE) {
    return { ok: false, errors: ['bad-spawn-list-ptr:' + r1[R1_SPAWN_INDEX].toString(16)] };
  }
  const raw = [];
  for (let i = 0; i < 16; i++) {
    const tri = u16le(bankBytes, listRel + i * 2) - CPU_BASE;
    if (tri < 32 || tri + 6 > BANK_SIZE) { errors.push(SUB_KEYS[i] + ':bad-tri-ptr'); continue; }
    const tb = u16le(bankBytes, tri) - CPU_BASE;
    const xb = u16le(bankBytes, tri + 2) - CPU_BASE;
    const yb = u16le(bankBytes, tri + 4) - CPU_BASE;
    raw.push({ key: SUB_KEYS[i], tri, tb, xb, yb });
  }
  if (errors.length) return { ok: false, errors };
  const byTri = raw.slice().sort((a, b) => a.tri - b.tri);
  const lists = [];
  for (let k = 0; k < byTri.length; k++) {
    const r = byTri[k];
    const end = k + 1 < byTri.length ? byTri[k + 1].tri : BANK_SIZE;
    if (!(r.tri + 6 <= r.tb && r.tb < r.xb && r.xb < r.yb && r.yb <= end)) {
      errors.push(r.key + ':bad-order'); continue;
    }
    const xn = r.yb - r.xb;
    const yn = Math.min(end - r.yb, xn);
    if (xn <= 0 || yn <= 0) { errors.push(r.key + ':empty-arrays'); continue; }
    if (r.tb + xn + 1 > r.xb) { errors.push(r.key + ':type-array-short'); continue; }
    lists.push({
      key: r.key, mode: subMode(r.key), level: subLevel(r.key),
      tri: r.tri, tb: r.tb, xb: r.xb, yb: r.yb, n: yn,
      types: bankBytes.slice(r.tb, r.tb + yn + 1),
      xs: bankBytes.slice(r.xb, r.xb + yn),
      ys: bankBytes.slice(r.yb, r.yb + yn),
    });
  }
  if (errors.length) return { ok: false, errors };
  lists.sort((a, b) => SUB_KEYS.indexOf(a.key) - SUB_KEYS.indexOf(b.key));
  return { ok: true, errors: [], bank: SPAWN_BANK, bytes: bankBytes.slice(), lists };
}
// edited: {key: {types?, xs?, ys?}} -- same lengths as parsed (n+1 types).
// Record types must be <0x80 (engine treats >=0x80 as scan control flow);
// the terminator byte types[n] is immutable (byte-equal to parsed).
export function serializeSpawns(parsed, edited) {
  const errors = [];
  if (!parsed || !parsed.ok || !(parsed.bytes instanceof Uint8Array)) {
    return { ok: false, errors: ['bad-parsed'] };
  }
  const out = new Uint8Array(BANK_SIZE);
  out.set(parsed.bytes);
  const byKey = {};
  for (const L of parsed.lists) byKey[L.key] = L;
  for (const key of Object.keys(edited || {})) {
    const L = byKey[key];
    if (!L) { errors.push(key + ':bad-key'); continue; }
    const e = edited[key] || {};
    const t = e.types || L.types, x = e.xs || L.xs, y = e.ys || L.ys;
    if (!(t instanceof Uint8Array) || t.length !== L.n + 1) { errors.push(key + ':types-len'); continue; }
    if (!(x instanceof Uint8Array) || x.length !== L.n) { errors.push(key + ':xs-len'); continue; }
    if (!(y instanceof Uint8Array) || y.length !== L.n) { errors.push(key + ':ys-len'); continue; }
    for (let i = 0; i < L.n; i++) {
      if (t[i] >= 0x80) { errors.push(key + ':type-control-byte:' + i); break; }
    }
    if (t[L.n] !== L.types[L.n]) errors.push(key + ':terminator-changed');
    if (errors.length) continue;
    out.set(t, L.tb);
    out.set(x, L.xb);
    out.set(y, L.yb);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], bytes: out };
}

// Spawn sprite tables (fixed bank 7, bank-rel $B51/$B7C, 43/45 bytes;
// CA89 slot-fill picks A when $FF bit5 set else B, indexed by type[i].
// $0150 snapshot values (B1 area-1: type0->$54) confirm table B live.
export const SPR_A = [0x24,0x26,0x28,0x2B,0x2E,0x30,0x32,0x35,0x37,0x39,0x3B,0x3D,0x3F,0x41,0x44,0x46,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x5A,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,0x20,0x21,0x22,0x68];
export const SPR_B = [0x54,0x56,0x58,0x5B,0x5D,0x5F,0x62,0x64,0x66,0x68,0x6A,0x6C,0x6E,0x70,0x72,0x74,
  0x76,0x78,0x7A,0x4E,0x50,0x7E,0x80,0x82,0x85,0x52,0x88,0x8A,0x8C,0x8D,0,0,
  0x90,0x2C,0x2D,0x30,0x31,0x2E,0x2F,0x32,0x33,0x34,0x24,0x26,0x28];
export function spriteFor(type) {
  return { a: type < SPR_A.length ? SPR_A[type] : -1, b: type < SPR_B.length ? SPR_B[type] : -1 };
}

// ---- 6.1b: per-type stat table (bank6, overhead areas) ----
// 30 entries x 4 bytes at CPU $A36A (bank-rel $236A), ends $A3E1; code
// resumes $A3E2 (JMP $A40A). Proven headless (verify-pack-6.1b, 25 green):
// byte0 = max HP (slot $040D), byte1 = contact/attack damage ($44 -> $7E
// grid, D697 subtract; $40 = L898D fallback constant, not table-driven).
// statidx = record type for types 0-29 EXCEPT type1->e2 (shares actor $59
// with type2); types 30+ have no entry (HP stays $20 spawn default).
// Tank areas (bank4 actors) do NOT use this table (6.1c open).
export const STAT_BANK = 6;
export const STAT_TABLE_CPU = 0xA36A;
export const STAT_TABLE_REL = 0x236A;
export const STAT_ENTRY_LEN = 4;
export const STAT_COUNT = 30;
export function statIdxFor(type) {
  if (type === 1) return 2;
  if (type >= 0 && type < STAT_COUNT) return type;
  return -1;
}
export function statByteRel(idx, field) {
  return STAT_TABLE_REL + idx * STAT_ENTRY_LEN + field;
}
// Empirical type->actor map (area-9 overhead sweep, 64 values; trap +
// no-actor outcomes excluded -- editor must validate per area before pack).
export const TYPE_ACTOR = {
  0: 0x55, 1: 0x59, 2: 0x59, 3: 0x5C, 4: 0x5E, 5: 0x60, 6: 0x63, 7: 0x65,
  8: 0x67, 10: 0x6B, 11: 0x6D, 12: 0x6F, 13: 0x71, 14: 0x73, 16: 0x77,
  17: 0x79, 18: 0x7B, 19: 0x4F, 20: 0x51, 22: 0x81, 23: 0x83, 24: 0x86,
  26: 0x89, 27: 0x8B, 28: 0x8E, 32: 0x32, 42: 0x25, 43: 0x27, 44: 0x29,
  53: 0x10, 55: 0x60, 57: 0x03, 58: 0x86, 62: 0x86,
};
// Types 33-41 -> actor 0x35 (powerup, subtype = type-33 in slot byte10).
export function powerupSubtype(type) {
  return type >= 33 && type <= 41 ? type - 33 : -1;
}
// Types that trap (area-9, activation-time, deterministic x2) or yield no
// actor (00 empty / 01 dormant-forever). Do not pack without per-area proof.
export const INVALID_TYPES = new Set([
  9, 15, 21, 25, 29, 30, 31, 45, 46, 47, 48, 49, 50, 51, 52, 54, 56,
  59, 60, 61, 63,
]);

// ---- 6.3: tank boss linkage (boss egg type $20, kill chain, $03FB bits) ----
// One type-$20 record per tank area (static ROM census, all 8 areas). In
// 7/8 areas it is proven to spawn actor $5B (boss egg) when in the camera
// band (A0/A1/A2/A3/A4/A7 headless, verify-pack-6.3; A5 needs stacking onto
// an active spawner; A6 honest-open: warp_raw(6) traps on stock and the
// cooked-warp spawn trajectory never covers its egg, so A6 rests on the
// static unique-type fact + the 7-area pattern).
// Chain (bank4): $20 -> $5B egg -> per-frame $51 countdown (~192f, set $C0
// on spawn while boss alive) -> morph to the area boss (observed A0->0x63,
// A5->0x5F; L9FE6 table reads 62 5E 60 5C 64 5E 5C 66, i.e. observed = table
// +1, micro-item open). Killing the boss (HP->0) runs A07B: $03FD counts to
// $80, then LA100 sets the $03FB area bit (LBF8A masks 01..80) + actor $5A;
// re-entering then spawns $68/$6A ($68 if area==7), or jumps LC14A/D804 when
// the $03FC area bit is set ($03FC is normally $00: sole direct writer is
// new-game clear; gameplay sets bits via the hidden jsr-A072/ora/sta $03FC
// setter after L9FE6; readers in prg4/6/7 gate upgrades/variants).
// C742/LC76A picks the area-7/15 variant (boss bit7: level $0A else table
// 05 03 06 04 07 03 04 09); door-path only, static-proven, no headless door
// driver exists so dynamic is open. Editor rule: NEVER delete/retype/move
// the boss record far (kill sets $03FB; the egg needs its camera band: CA89
// 28/27px gate, $8E cursor is scratch and raw warps do not reset it).
export const BOSS_TYPE = 0x20;
export const BOSS_REC = { A0: 29, A1: 125, A2: 164, A3: 3, A4: 186, A5: 19, A6: 42, A7: 122 };
export function isBossRecord(key, idx) {
  return BOSS_REC[key] === idx;
}
export function areaBitFor(area) {
  return 1 << (area & 7);
}
