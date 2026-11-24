// P3d: tank-side per-type HP/damage editing via bank-4 stat table ($B326, 16x4B).
// Run: node tools/verify-pack-p3d.mjs  (from frontend/)
// Lib (pre-existing 6.1c): getTankStatEntry/serializeTankStats (byte0=HP,
// byte1=shot damage; bytes 2-3 never touched). Editor: stat table for A-list
// areas (levels 9-16, $14 0-7), GLOBAL-per-type, traps locked, boss egg noted.
// Boot proofs reuse the 6.1c alone-method census: slot byte13 == HP,
// fine-grained player-HP drops == damage, B-areas unaffected (table is A-only).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import * as OV from '../src/pack/overlay.js';
import { getTankStatEntry, serializeTankStats, tankStatIdxFor, tankStatByteRel, TANK_STAT_BANK, TANK_STAT_COUNT, TANK_STAT_TABLE_REL, TANK_TRAP_TYPES, TANK_DORMANT_TYPES, tankEmptyType } from '../src/pack/enemies.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const b4 = stock.prg[TANK_STAT_BANK];
const hx = (B, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += B[o + i].toString(16).padStart(2, '0'); return s; };
const TT = TANK_STAT_TABLE_REL;
ok('table e0=[04 10 1a 90] @3326', hx(b4, TT, 4) === '04101a90');
ok('table ends B366, 16 entries (e16=JMP B392)', hx(b4, TT + 64, 3) === '4c92b3');
ok('tank HP byte0 matches sweep (16/16)', (() => {
  const HP = [4, 1, 2, 1, 2, 1, 8, 1, 24, 8, 8, 8, 6, 8, 32, 4];
  for (let e = 0; e < 16; e++) if (b4[TT + e * 4] !== HP[e]) return false;
  return true;
})());
ok('tank dmg byte1 matches contact obs', b4[TT + 1 * 4 + 1] === 16 && b4[TT + 10 * 4 + 1] === 24 && b4[TT + 14 * 4 + 1] === 48 && b4[TT + 8 * 4 + 1] === 32);
ok('tankStatIdxFor 0/15->0/15, 16/32->-1', tankStatIdxFor(0) === 0 && tankStatIdxFor(15) === 15 && tankStatIdxFor(16) === -1 && tankStatIdxFor(32) === -1);
ok('getTankStatEntry e1={1,16} e14={32,48}', (() => { const a = getTankStatEntry(b4, 1), c = getTankStatEntry(b4, 14); return a && a.hp === 1 && a.dmg === 16 && c && c.hp === 32 && c.dmg === 48; })());
ok('getTankStatEntry guards (bad idx/bank)', getTankStatEntry(b4, 16) === null && getTankStatEntry(b4, -1) === null && getTankStatEntry(null, 0) === null);
ok('TANK_TRAP_TYPES covers known traps', [0, 3, 4, 7, 42, 44, 50, 51, 52, 55, 59, 60, 61].every((t) => TANK_TRAP_TYPES.has(t)));
ok('TANK_DORMANT 43/45/63 + empty 16-31', TANK_DORMANT_TYPES.has(43) && TANK_DORMANT_TYPES.has(45) && TANK_DORMANT_TYPES.has(63) && tankEmptyType(16) && tankEmptyType(31) && !tankEmptyType(15) && !tankEmptyType(32));
const r0 = serializeTankStats(b4, {});
ok('noop rebuild ok + byte-identical', r0.ok && r0.bytes.every((v, i) => v === b4[i]));
const r1 = serializeTankStats(b4, { 1: { hp: 7 } });
ok('hp edit one byte @tankStatByteRel(1,0)', r1.ok && r1.bytes.filter((v, i) => v !== b4[i]).length === 1 && r1.bytes[tankStatByteRel(1, 0)] === 7);
const r1b = serializeTankStats(b4, { 1: { dmg: 48 } });
ok('dmg edit one byte @tankStatByteRel(1,1)', r1b.ok && r1b.bytes.filter((v, i) => v !== b4[i]).length === 1 && r1b.bytes[tankStatByteRel(1, 1)] === 48);
const r1c = serializeTankStats(b4, { 1: { hp: 7 } });
ok('bytes 2-3 of entry untouched', r1c.bytes[tankStatByteRel(1, 2)] === b4[tankStatByteRel(1, 2)] && r1c.bytes[tankStatByteRel(1, 3)] === b4[tankStatByteRel(1, 3)]);
ok('reject bad idx', !serializeTankStats(b4, { 16: { hp: 1 } }).ok);
ok('reject hp>255', !serializeTankStats(b4, { 1: { hp: 256 } }).ok);
ok('reject dmg<0', !serializeTankStats(b4, { 1: { dmg: -1 } }).ok);
ok('reject fractional', !serializeTankStats(b4, { 1: { dmg: 1.5 } }).ok);
ok('reject bad bank', !serializeTankStats(b4.slice(0, 100), { 1: { hp: 1 } }).ok);
const rD = serializeTankStats(b4, { 1: { hp: 7 }, 14: { dmg: 9 } });
ok('multi-edit deterministic x2', rD.ok && serializeTankStats(b4, { 1: { hp: 7 }, 14: { dmg: 9 } }).bytes.every((v, i) => v === rD.bytes[i]));
const A0TB = 0x21A1;
function overlayPack(mut) {
  const p = stock.prg.map((b) => b.slice());
  mut(p);
  const patchList = [];
  for (const bn of [3, 4]) for (const x of OV.diffRuns(stock.prg[bn], p[bn])) patchList.push(OV.makePatch('prg', bn, x.off, x.bytes));
  const doc = { customVersion: 1, id: 'c-p3d', name: 'p3d', baseCrc: stock.meta.crc32, patches: patchList, editorVersion: 'p3d', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const q = OV.applyOverlay(stock, doc);
  if (!q.ok) throw new Error('overlay failed');
  return q.pack;
}
function packAlone(t, statEd) {
  return overlayPack((p) => {
    const n = 133;
    for (let i = 0; i < n; i++) p[3][A0TB + i] = 16;
    p[3][A0TB + 92] = t;
    if (statEd) for (const k of Object.keys(statEd)) for (const f of Object.keys(statEd[k])) p[4][TT + (+k) * 4 + (+f)] = statEd[k][f];
  });
}
function packTankEd(statEd) {
  const rs = serializeTankStats(stock.prg[TANK_STAT_BANK], statEd);
  if (!rs.ok) throw new Error('stats: ' + rs.errors.join(' '));
  const p = stock.prg.map((bb) => bb.slice());
  p[TANK_STAT_BANK] = rs.bytes;
  const patchList = [];
  for (const x of OV.diffRuns(stock.prg[TANK_STAT_BANK], p[TANK_STAT_BANK])) patchList.push(OV.makePatch('prg', TANK_STAT_BANK, x.off, x.bytes));
  const doc = { customVersion: 1, id: 'c-p3d', name: 'p3d', baseCrc: stock.meta.crc32, patches: patchList, editorVersion: 'p3d', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const q = OV.applyOverlay(stock, doc);
  if (!q.ok) throw new Error('overlay failed');
  return q.pack;
}
ok('stat patches validate+apply', !!packTankEd({ 1: { hp: 7 } }));
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
async function census(prgBanks, o) {
  const warpF = 1000, endF = warpF + o.span + 1;
  let win = null, snap = null, trapMsg = null;
  const drops = []; let lastHP = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : (o.padFn ? o.padFn(f) : 0));
    if (f === warpF) { if (o.raw) ex.bm_warp_raw(o.area); else ex.bm_warp(o.area); }
    const doSnap = o.fine ? (f >= warpF + 100 && f <= warpF + o.span && (f % 5 === 0)) : (f === warpF + o.span);
    if (doSnap) {
      ex.bm_snap(); const mem = new Uint8Array(ex.memory.buffer); snap = mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160);
      if (o.fine) { const hp = snap[1037]; if (lastHP !== null && hp !== lastHP) drops.push([f - warpF, lastHP, hp]); lastHP = hp; }
    }
    if (f + 1 >= endF) throw new Error('STOP');
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat(prgBanks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trapMsg = String(e.message).slice(0, 80); }
  let flag = -1; try { flag = inst.exports.bm_trap_flag(); } catch (e) {}
  if (!snap) return { trap: trapMsg || 'NO_SNAP', flag: flag, drops: drops };
  const h = (a, n2) => { let s = ''; for (let i = 0; i < n2; i++) s += snap[a + i].toString(16).padStart(2, '0'); return s; };
  return { trap: trapMsg, flag: flag, s8: h(1136, 14), drops: drops };
}
const S1 = await census(stock.prg, { area: 0, span: 250, raw: true });
const S2 = await census(stock.prg, { area: 0, span: 250, raw: true });
ok('stock A0 anchor trap-free + deterministic x2', !S1.trap && S1.flag === 0 && S1.s8 === S2.s8, S1.s8);
const H1 = await census(packAlone(1, { 1: { 0: 7 } }).prg, { area: 0, span: 250, raw: true });
const H2 = await census(packAlone(1, { 1: { 0: 7 } }).prg, { area: 0, span: 250, raw: true });
ok('HP e1->07 visible in slot byte13 x2', !H1.trap && H1.s8.slice(26, 28) === '07' && H1.s8 === H2.s8, H1.s8);
const G1 = await census(packAlone(14, { 14: { 0: 9 } }).prg, { area: 0, span: 250, raw: true });
const G2 = await census(packAlone(14, { 14: { 0: 9 } }).prg, { area: 0, span: 250, raw: true });
ok('HP e14->09 visible in slot byte13 x2', !G1.trap && G1.s8.slice(26, 28) === '09' && G1.s8 === G2.s8, G1.s8);
const walk = (f) => (f >= 1060 ? 128 : 0);
const C0 = await census(packAlone(1).prg, { area: 0, span: 600, padFn: walk, fine: true, raw: true });
const firstFrames = (d) => d.map((x) => x[0]);
const mags = (d) => d.map((x) => x[1] - x[2]);
ok('control hits = 16/16/16 at 310/405/535', JSON.stringify(firstFrames(C0.drops)) === '[310,405,535]' && JSON.stringify(mags(C0.drops)) === '[16,16,16]', JSON.stringify(C0.drops));
const C1 = await census(packAlone(1, { 1: { 1: 48 } }).prg, { area: 0, span: 600, padFn: walk, fine: true, raw: true });
const C2 = await census(packAlone(1, { 1: { 1: 48 } }).prg, { area: 0, span: 600, padFn: walk, fine: true, raw: true });
ok('DAMAGE PATCH: byte1 16->48 gives 16/48/16 at same frames x2', JSON.stringify(firstFrames(C1.drops)) === '[310,405,535]' && JSON.stringify(mags(C1.drops)) === '[16,48,16]' && JSON.stringify(C1.drops) === JSON.stringify(C2.drops), JSON.stringify(C1.drops));
const B0 = await census(stock.prg, { area: 9, span: 150 });
const B1 = await census(packTankEd({ 1: { hp: 7 } }).prg, { area: 9, span: 150 });
ok('B-area unaffected by tank edit', !B0.trap && !B1.trap && B0.s8 === B1.s8, (B0.s8 || '') + ' vs ' + (B1.s8 || ''));
console.log('----');
console.log((fail === 0 ? 'P3D ALL ' + pass + ' CHECKS GREEN' : 'P3D FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
