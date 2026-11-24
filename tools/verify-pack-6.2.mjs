// 6.2: overhead attr-bit meanings + transit-door table (static proofs).
// Run: node tools/verify-pack-6.2.mjs  (from frontend/)
// Encodes the headless findings: door-table layout (fixed bank, 108
// entries), door-bit sharing (every entry on a door-bit combo), bit5
// absence, bit6 solid-only, and attr flip round-trip through serializeBank.
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { parseBank, serializeBank } from '../src/pack/levels.js';
import * as OV from '../src/pack/overlay.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
// --- door table (fixed bank7: areas @cpu$DD7E, xhi @$DDEA, yhi @$DE56) ---
const b7 = stock.prg[7];
const A = 0xDD7E - 0xC000, X = 0xDDEA - 0xC000, Y = 0xDE56 - 0xC000;
const entries = [];
for (let i = 0; i < 108; i++) entries.push([b7[A + i], b7[X + i], b7[Y + i]]);
ok('door table has 108 entries', entries.length === 108);
// EOR-1 pairing spot checks (two-sided doors, incl. intra-level L7 pairs)
ok('pair 14<->15 (L1<->L9)', entries[14][0] === 8 && entries[14][1] === 26 && entries[14][2] === 93 &&
  entries[15][0] === 0 && entries[15][1] === 61 && entries[15][2] === 58);
ok('pair 16<->17 (L1<->L9, combo146)', entries[16][0] === 8 && entries[16][1] === 62 && entries[16][2] === 85 &&
  entries[17][0] === 0 && entries[17][1] === 54 && entries[17][2] === 42);
ok('pair 78<->79 intra-level L7', entries[78][0] === 14 && entries[79][0] === 14);
ok('pair 98<->99 (L8<->L16)', entries[98][0] === 15 && entries[99][0] === 7);
ok('7 L1 (area 8) entries', entries.filter(e => e[0] === 8).length === 7,
  JSON.stringify(entries.filter(e => e[0] === 8)));
// --- combo attr lookup per area ---
const bankOf = {};
for (let b = 0; b < 3; b++) for (const L of parseBank(stock.prg[b], b).levels) bankOf[L.level] = b;
const levelForArea = a => (a >= 8 ? a - 7 : a + 9);
function comboAttr(level, cx, cy) {
  const P = parseBank(stock.prg[bankOf[level]], bankOf[level]);
  const L = P.levels.find(l => l.level === level);
  const W = 32, rows = L.map.length / 32;
  const bx = (cx / 4) | 0, by = (cy / 4) | 0;
  if (bx < 0 || by < 0 || bx >= W || by >= rows) return -1;
  const bi = L.map[by * W + bx];
  const si = L.blocks[bi * 4 + (((cy % 4) / 2) | 0) * 2 + (((cx % 4) / 2) | 0)];
  return L.attrs[L.structs[si * 4 + (cy % 2) * 2 + (cx % 2)]];
}
ok('table ends at 107 (idx108 combo L2(125,32) has no door bits)', (comboAttr(2, 125, 32) & 0x0C) === 0);
let bad = [];
for (let i = 0; i < entries.length; i++) {
  const [a, x, y] = entries[i];
  const at = comboAttr(levelForArea(a), x, y);
  if (!(at >= 0 && (at & 0x0C) !== 0)) bad.push([i, a, x, y, at === undefined ? '?' : '0x' + (at >>> 0).toString(16)]);
}
ok('every door-table entry sits on a door-bit combo', bad.length === 0, JSON.stringify(bad.slice(0, 8)));
const ohCount = entries.filter(e => e[0] < 8).length;
ok('37 overhead entries, all door-bit (shared bits 2-3)', ohCount === 37, 'count=' + ohCount);
ok('L9 door entries are attr 0x8', entries.filter(e => e[0] === 0).every(([a, x, y]) => comboAttr(9, x, y) === 0x08));
// --- overhead census: bit5 absent, bit6 solid-only ---
let bit5 = 0, bit6walk = 0;
for (let lvl = 9; lvl <= 16; lvl++) {
  const P = parseBank(stock.prg[bankOf[lvl]], bankOf[lvl]);
  const L = P.levels.find(l => l.level === lvl);
  for (const at of L.attrs) {
    if (at & 0x20) bit5++;
    if ((at & 0x40) && !(at & 0x80)) bit6walk++;
  }
}
ok('bit5 absent from all overhead levels', bit5 === 0, 'count=' + bit5);
ok('bit6 never walkable overhead (solid-only)', bit6walk === 0, 'count=' + bit6walk);
// --- attr flip round-trip (L9 generic floor ci -> 0x42, in place) ---
{
  const P = parseBank(stock.prg[1], 1);
  const L9 = P.levels.find(l => l.level === 9);
  const W = 32;
  const comboAt = (cx, cy) => {
    const bi = L9.map[((cy / 4) | 0) * W + ((cx / 4) | 0)];
    const si = L9.blocks[bi * 4 + (((cy % 4) / 2) | 0) * 2 + (((cx % 4) / 2) | 0)];
    return L9.structs[si * 4 + (cy % 2) * 2 + (cx % 2)];
  };
  const ci = comboAt(85, 22);
  const na = L9.attrs.slice();
  na[ci] = 0x42;
  const s = serializeBank(P, { 9: { attrs: na } });
  ok('attr flip serializes', s.ok, s.ok ? '' : s.errors.join(';'));
  if (s.ok) {
    const ED = await import('../src/ui/editor.js');
    const runs = ED.diffRuns(stock.prg[1], s.bytes);
    ok('attr flip diff small (in-place)', runs.length >= 1 && runs.length <= 3, 'runs=' + runs.length);
    const patches = runs.map(r => OV.makePatch('prg', 1, r.off, r.bytes));
    const doc = { customVersion: 1, id: 'c-62t', name: 't62', baseCrc: stock.meta.crc32, patches, editorVersion: 't', builtAt: 't' };
    ok('custom validates', OV.validateCustomPack(doc).ok);
    const rr = OV.applyOverlay(stock, doc);
    ok('overlay applies', rr.ok);
    if (rr.ok) {
      const P2 = parseBank(rr.pack.prg[1], 1);
      ok('flipped attr survives pack round-trip', P2.levels.find(l => l.level === 9).attrs[ci] === 0x42);
    }
  }
}
console.log('6.2: ' + pass + ' pass, ' + fail + ' fail');
if (fail) process.exit(1);
