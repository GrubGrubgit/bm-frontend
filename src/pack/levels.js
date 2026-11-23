// src/pack/levels.js -- Blaster Master level table parser/serializer. Pure, no DOM. Own code.
// Layout (verified byte-exact vs Data Crystal ROM map on the reference ROM):
// PRG banks 0-2 hold level data. Each bank head has per-level 4B base
// pointers: [tablePtr, scrollPtr] (CPU addresses, same-bank 0x8000-0xBFFF).
// The table is 6 LE pointers in fixed order: [pal, attr, combo, struct,
// block, map]. pal = 16B bg palette, scroll = 16B (8B vertical + 8B
// horizontal flags over the 8x8 screen grid, grid offset +32/+32px),
// combo = N x 4B pattern indices, struct = M x 4B combo indices,
// block = K x 4B struct indices, map = block indices (1024B tank,
// 800B level 9, 928B level 13), attr = N x 1B combo attributes.
// Lengths are derived exactly like the engine must: attr runs to the next
// span (attr count == combo count), combo is 4x attr, struct/block run to
// the next span and must be multiples of 4, map length is fixed per level,
// pal/scroll/table are fixed. Inter-table gaps (L10/L12/L14/L16, 4-12B)
// and bank-tail free space are preserved verbatim on the fast path and
// absorbed into one contiguous tail region on the compact path.
// Combo attr bits (tank; overhead physics bits DIFFER - overhead attrs are
// read-only until research item 6.2): 0-1 palette, 2-3 door/overhead
// entrance, 4 damage, 5 ladder, 6 water (solid+water = breakable),
// 7 solid (solid+door = scrolling-region doorway).
export const LEVEL_BANK = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1, 9: 1, 11: 1, 13: 2, 10: 2, 14: 2, 16: 2, 12: 2, 15: 2 };
export const BANK_LEVELS = { 0: [1, 2, 3, 4, 5], 1: [6, 7, 8, 9, 11], 2: [13, 10, 14, 16, 12, 15] };
export const LEVEL_MODE = {};
for (let l = 1; l <= 8; l++) LEVEL_MODE[l] = "tank";
for (let l = 9; l <= 16; l++) LEVEL_MODE[l] = "overhead";
export const MAP_LEN = { 9: 800, 13: 928 };
export function mapLenOf(level) { return MAP_LEN[level] || 1024; }
export const BANK_SIZE = 16384, CPU_BASE = 0x8000;
// Documented bank-tail free-space starts (bank-relative; Data Crystal ROM
// map, verified: nothing but free space follows these offsets). A span at
// or past its bank's free start is corruption, never content.
export const FREE_START = { 0: 0x3D8C, 1: 0x382B, 2: 0x3A63 };
export const TABLE_ORDER = ["pal", "attr", "combo", "struct", "block", "map"];
function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
function w16le(b, o, v) { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; }
export function parseBank(bankBytes, bank) {
  const errors = [];
  if (!(bankBytes instanceof Uint8Array) || bankBytes.length !== BANK_SIZE) { errors.push("bad-bank-bytes"); return { ok: false, errors }; }
  if (BANK_LEVELS[bank] == null) { errors.push("bad-bank:" + bank); return { ok: false, errors }; }
  const levels = [];
  const headLen = BANK_LEVELS[bank].length * 4;
  for (let s = 0; s < BANK_LEVELS[bank].length; s++) {
    const level = BANK_LEVELS[bank][s];
    const headOff = s * 4;
    const tableCpu = u16le(bankBytes, headOff), scrollCpu = u16le(bankBytes, headOff + 2);
    const tableRel = tableCpu - CPU_BASE, scrollRel = scrollCpu - CPU_BASE;
    if (tableRel < headLen || tableRel + 12 > BANK_SIZE) { errors.push("L" + level + ":bad-table-ptr"); continue; }
    if (scrollRel < 0 || scrollRel + 16 > BANK_SIZE) { errors.push("L" + level + ":bad-scroll-ptr"); continue; }
    const ptrs = {};
    let badPtr = false;
    for (let i = 0; i < 6; i++) {
      const rel = u16le(bankBytes, tableRel + i * 2) - CPU_BASE;
      if (rel < headLen || rel > BANK_SIZE) { errors.push("L" + level + ":bad-ptr:" + TABLE_ORDER[i]); badPtr = true; break; }
      ptrs[TABLE_ORDER[i]] = rel;
    }
    if (badPtr) continue;
    levels.push({ level, mode: LEVEL_MODE[level], bank, headOff, tableRel, scrollRel, ptrs });
  }
  if (errors.length) return { ok: false, errors };
  // every span start in the bank bounds every variable table
  const starts = [];
  for (const L of levels) {
    starts.push(L.tableRel, L.ptrs.pal, L.ptrs.map, L.scrollRel);
    for (const k of ["combo", "struct", "block", "attr"]) starts.push(L.ptrs[k]);
  }
  const spanEnd = off => {
    // Bound = nearest following span start; only when no span follows
    // (stock trailing attr before documented free space) use the
    // fallback: FREE_START inside the stock region, bank end beyond it.
    let end = -1;
    for (const q of starts) if (q > off && (end < 0 || q < end)) end = q;
    if (end < 0) end = off < FREE_START[bank] ? FREE_START[bank] : BANK_SIZE;
    return end;
  };
  const gaps = [];
  for (const L of levels) {
    const attrLen = spanEnd(L.ptrs.attr) - L.ptrs.attr;
    const comboMax = spanEnd(L.ptrs.combo) - L.ptrs.combo;
    if (attrLen <= 0) { errors.push("L" + L.level + ":empty-attr"); continue; }
    const nCombo = attrLen;
    const comboLen = nCombo * 4;
    if (comboLen > comboMax) { errors.push("L" + L.level + ":combo-overflow"); continue; }
    if (comboMax - comboLen > 0) gaps.push({ off: L.ptrs.combo + comboLen, len: comboMax - comboLen, bytes: bankBytes.slice(L.ptrs.combo + comboLen, L.ptrs.combo + comboMax) });
    const structLen = spanEnd(L.ptrs.struct) - L.ptrs.struct;
    const blockLen = spanEnd(L.ptrs.block) - L.ptrs.block;
    if (structLen <= 0 || structLen % 4 !== 0) { errors.push("L" + L.level + ":bad-struct-len"); continue; }
    if (blockLen <= 0 || blockLen % 4 !== 0) { errors.push("L" + L.level + ":bad-block-len"); continue; }
    const mapLen = mapLenOf(L.level);
    const mapNext = spanEnd(L.ptrs.map);
    if (L.ptrs.map + mapLen > mapNext) { errors.push("L" + L.level + ":map-overflow"); continue; }
    if (mapNext - (L.ptrs.map + mapLen) > 0) gaps.push({ off: L.ptrs.map + mapLen, len: mapNext - (L.ptrs.map + mapLen), bytes: bankBytes.slice(L.ptrs.map + mapLen, mapNext) });
    // overlap sanity on this level's own spans
    const own = [
      [L.tableRel, 12], [L.ptrs.pal, 16], [L.ptrs.combo, comboLen],
      [L.ptrs.struct, structLen], [L.ptrs.block, blockLen],
      [L.ptrs.map, mapLen], [L.ptrs.attr, attrLen], [L.scrollRel, 16],
    ].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < own.length; i++) {
      if (own[i][0] < own[i - 1][0] + own[i - 1][1]) { errors.push("L" + L.level + ":overlap"); break; }
    }
    if (errors.length) continue;
    L.nCombo = nCombo; L.nStruct = structLen / 4; L.nBlock = blockLen / 4;
    L.pal = bankBytes.slice(L.ptrs.pal, L.ptrs.pal + 16);
    L.scroll = bankBytes.slice(L.scrollRel, L.scrollRel + 16);
    L.attrs = bankBytes.slice(L.ptrs.attr, L.ptrs.attr + attrLen);
    L.combos = bankBytes.slice(L.ptrs.combo, L.ptrs.combo + comboLen);
    L.structs = bankBytes.slice(L.ptrs.struct, L.ptrs.struct + structLen);
    L.blocks = bankBytes.slice(L.ptrs.block, L.ptrs.block + blockLen);
    L.map = bankBytes.slice(L.ptrs.map, L.ptrs.map + mapLen);
    L.lens = { combo: comboLen, struct: structLen, block: blockLen, attr: attrLen, map: mapLen };
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], bank, bytes: bankBytes.slice(), levels, gaps };
}
// Free space = bank tail after the last span start... plus recorded gaps.
// Computed at serialize time from the parse (gaps) and current placements.
function freeList(parsed) {
  let last = parsed.levels.length * 4 + 4;
  const bump = o => { if (o > last) last = o; };
  for (const L of parsed.levels) {
    bump(L.tableRel + 12); bump(L.ptrs.pal + 16); bump(L.scrollRel + 16);
    bump(L.ptrs.map + L.lens.map);
    bump(L.ptrs.combo + L.lens.combo); bump(L.ptrs.struct + L.lens.struct);
    bump(L.ptrs.block + L.lens.block); bump(L.ptrs.attr + L.lens.attr);
    for (const g of parsed.gaps) bump(g.off + g.len);
  }
  const free = parsed.gaps.map(g => ({ off: g.off, len: g.len }));
  if (last < BANK_SIZE) free.push({ off: last, len: BANK_SIZE - last });
  return free;
}
// Serialize parsed (possibly edited) levels back into a bank image.
// edited: {level: {pal?, scroll?, attrs?, combos?, structs?, blocks?, map?}}.
// Size-unchanged tables keep offsets (=> byte-identical round-trip).
// ANY size change compacts the whole bank deterministically (levels in
// order, tables contiguous, final span fixed-size scroll) so re-parse
// derives exact lengths. Overflow (or any inconsistency) fails loudly
// with no output bytes.
export function serializeBank(parsed, edited) {
  const errors = [];
  if (!parsed || !parsed.ok || !(parsed.bytes instanceof Uint8Array)) { errors.push("bad-parsed"); return { ok: false, errors }; }
  const want = {};
  for (const L of parsed.levels) {
    const e = (edited && edited[L.level]) || {};
    const t = {
      pal: e.pal || L.pal, scroll: e.scroll || L.scroll, attrs: e.attrs || L.attrs,
      combos: e.combos || L.combos, structs: e.structs || L.structs,
      blocks: e.blocks || L.blocks, map: e.map || L.map,
    };
    for (const k of Object.keys(t)) {
      if (!(t[k] instanceof Uint8Array)) { errors.push("L" + L.level + ":bad-" + k); }
    }
    if (t.pal.length !== 16) errors.push("L" + L.level + ":pal-len");
    if (t.scroll.length !== 16) errors.push("L" + L.level + ":scroll-len");
    if (t.map.length !== mapLenOf(L.level)) errors.push("L" + L.level + ":map-len");
    if (t.combos.length % 4 !== 0) errors.push("L" + L.level + ":combo-len");
    if (t.structs.length % 4 !== 0) errors.push("L" + L.level + ":struct-len");
    if (t.blocks.length % 4 !== 0) errors.push("L" + L.level + ":block-len");
    if (t.combos.length !== t.attrs.length * 4) errors.push("L" + L.level + ":combo-attr-count");
    if (t.combos.length === 0) errors.push("L" + L.level + ":empty-combo");
    if (t.structs.length === 0) errors.push("L" + L.level + ":empty-struct");
    if (t.blocks.length === 0) errors.push("L" + L.level + ":empty-block");
    want[L.level] = t;
  }
  if (errors.length) return { ok: false, errors };
  let resized = false;
  for (const L of parsed.levels) {
    const t = want[L.level];
    if (t.attrs.length !== L.lens.attr || t.combos.length !== L.lens.combo ||
        t.structs.length !== L.lens.struct || t.blocks.length !== L.lens.block) { resized = true; break; }
  }
  if (resized) return serializeCompact(parsed, want);
  const out = new Uint8Array(BANK_SIZE);
  out.set(parsed.bytes);
  for (const L of parsed.levels) {
    const t = want[L.level];
    out.set(t.pal, L.ptrs.pal);
    out.set(t.attrs, L.ptrs.attr);
    out.set(t.combos, L.ptrs.combo);
    out.set(t.structs, L.ptrs.struct);
    out.set(t.blocks, L.ptrs.block);
    out.set(t.map, L.ptrs.map);
    out.set(t.scroll, L.scrollRel);
  }
  return { ok: true, errors: [], bytes: out };
}
// Compact path: deterministic full-bank relayout (levels in order, tables
// in file order, contiguous after the bank head). Gaps/free merge into one tail
// region. Every variable table is immediately followed by another span and
// the final span is always fixed-size (scroll), so re-parse derives exact
// lengths and parse(serialize(x)) == x (up to the edited model).
function serializeCompact(parsed, want) {
  const out = new Uint8Array(BANK_SIZE);
  out.set(parsed.bytes.subarray(0, parsed.levels.length * 4 + 4)); // bank head + slack preserved
  let at = parsed.levels.length * 4 + 4;
  const place = (bytes, what) => {
    if (at + bytes.length > BANK_SIZE) return -1;
    const off = at;
    out.set(bytes, off); at += bytes.length;
    return off;
  };
  const offs = {};
  // pass 1: reserve 6-pointer tables (12B each) right after the head
  for (const L of parsed.levels) { offs[L.level + ":table"] = place(new Uint8Array(12), "table"); }
  for (const L of parsed.levels) {
    const t = want[L.level];
    offs[L.level + ":pal"] = place(t.pal, "pal");
    offs[L.level + ":attr"] = place(t.attrs, "attr");
    offs[L.level + ":combo"] = place(t.combos, "combo");
    offs[L.level + ":struct"] = place(t.structs, "struct");
    offs[L.level + ":block"] = place(t.blocks, "block");
    offs[L.level + ":map"] = place(t.map, "map");
    offs[L.level + ":scroll"] = place(t.scroll, "scroll");
    if (Object.keys(offs).length === 0) break;
    for (const k of ["table", "pal", "attr", "combo", "struct", "block", "map", "scroll"]) {
      if (offs[L.level + ":" + k] < 0) return { ok: false, errors: ["overflow:L" + L.level + ":" + k] };
    }
  }
  for (const L of parsed.levels) {
    const g = k => offs[L.level + ":" + k];
    w16le(out, L.headOff, CPU_BASE + g("table"));
    w16le(out, L.headOff + 2, CPU_BASE + g("scroll"));
    const order = ["pal", "attr", "combo", "struct", "block", "map"];
    for (let i = 0; i < 6; i++) w16le(out, g("table") + i * 2, CPU_BASE + g(order[i]));
  }
  return { ok: true, errors: [], bytes: out };
}
