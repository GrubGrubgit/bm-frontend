// P3c: per-type HP/damage editing via bank-6 stat table ($A36A, 30x4B).
// Run: node tools/verify-pack-p3c.mjs  (from frontend/)
// Lib: getStatEntry/serializeStats (byte0=HP, byte1=damage; bytes 2-3 never
// touched). Boot proofs reuse the 6.1b census patterns: slot byte13 == HP,
// fine-grained $40D drops == damage, tank areas unaffected (table is
// overhead-only).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import * as OV from '../src/pack/overlay.js';
import { getStatEntry, serializeStats, statIdxFor, statByteRel, STAT_BANK, STAT_COUNT, STAT_TABLE_REL, INVALID_TYPES } from '../src/pack/enemies.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const b6 = stock.prg[STAT_BANK];
const hx = (B, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += B[o + i].toString(16).padStart(2, '0'); return s; };
ok('table e0=[04 08 ..] @236A', hx(b6, STAT_TABLE_REL, 3) === '04082c');
ok('table ends A3E1, code resumes jmp A40A', hx(b6, STAT_TABLE_REL + 120, 5) === '4c0aa4a900');
ok('statIdxFor 0/1/2/29->0/2/2/29, 30/33->-1', statIdxFor(0) === 0 && statIdxFor(1) === 2 && statIdxFor(2) === 2 && statIdxFor(29) === 29 && statIdxFor(30) === -1 && statIdxFor(33) === -1);
ok('getStatEntry e0={4,8}', (() => { const e = getStatEntry(b6, 0); return e && e.hp === 4 && e.dmg === 8; })());
ok('getStatEntry e5.hp=06 e3.hp=20', getStatEntry(b6, 5).hp === 6 && getStatEntry(b6, 3).hp === 32);
ok('getStatEntry guards (bad idx/bank)', getStatEntry(b6, 30) === null && getStatEntry(b6, -1) === null && getStatEntry(null, 0) === null);
ok('INVALID_TYPES covers known traps', [9, 15, 21, 25, 29, 30].every((t) => INVALID_TYPES.has(t)));
const r0 = serializeStats(b6, {});
ok('noop rebuild ok + byte-identical', r0.ok && r0.bytes.every((v, i) => v === b6[i]));
const r1 = serializeStats(b6, { 5: { hp: 2 } });
ok('hp edit one byte @statByteRel(5,0)', r1.ok && r1.bytes.filter((v, i) => v !== b6[i]).length === 1 && r1.bytes[statByteRel(5, 0)] === 2);
const r1b = serializeStats(b6, { 0: { dmg: 48 } });
ok('dmg edit one byte @statByteRel(0,1)', r1b.ok && r1b.bytes.filter((v, i) => v !== b6[i]).length === 1 && r1b.bytes[statByteRel(0, 1)] === 48);
const r1c = serializeStats(b6, { 5: { hp: 2 } });
ok('bytes 2-3 of entry untouched', r1c.bytes[statByteRel(5, 2)] === b6[statByteRel(5, 2)] && r1c.bytes[statByteRel(5, 3)] === b6[statByteRel(5, 3)]);
ok('reject bad idx', !serializeStats(b6, { 30: { hp: 1 } }).ok);
ok('reject hp>255', !serializeStats(b6, { 5: { hp: 256 } }).ok);
ok('reject dmg<0', !serializeStats(b6, { 5: { dmg: -1 } }).ok);
ok('reject fractional', !serializeStats(b6, { 5: { dmg: 1.5 } }).ok);
ok('reject bad bank', !serializeStats(b6.slice(0, 100), { 5: { hp: 1 } }).ok);
const rD = serializeStats(b6, { 3: { hp: 7 }, 5: { dmg: 9 } });
ok('multi-edit deterministic x2', rD.ok && serializeStats(b6, { 3: { hp: 7 }, 5: { dmg: 9 } }).bytes.every((v, i) => v === rD.bytes[i]));
function packFromStats(statEd, tb, tv) {
  const rs = serializeStats(stock.prg[STAT_BANK], statEd);
  if (!rs.ok) throw new Error('stats: ' + rs.errors.join(' '));
  const p = stock.prg.map((bb) => bb.slice());
  p[STAT_BANK] = rs.bytes;
  if (tb !== undefined) { p[3] = p[3].slice(); p[3][tb] = tv; }
  const patchList = [];
  for (const bn of [3, STAT_BANK]) for (const x of OV.diffRuns(stock.prg[bn], p[bn])) patchList.push(OV.makePatch('prg', bn, x.off, x.bytes));
  const doc = { customVersion: 1, id: 'c-p3c', name: 'p3c', baseCrc: stock.meta.crc32, patches: patchList, editorVersion: 'p3c', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const q = OV.applyOverlay(stock, doc);
  if (!q.ok) throw new Error('overlay failed');
  return q.pack;
}
ok('stat patches validate+apply', !!packFromStats({ 5: { hp: 2 } }));
// --- dynamic ---
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
  const h = (a, n) => { let s = ''; for (let i = 0; i < n; i++) s += snap[a + i].toString(16).padStart(2, '0'); return s; };
  return { trap: trapMsg, flag: flag, s8: h(1136, 14), drops: drops };
}
const TB = 0xB2A8 - 0x8000;
const S1 = await census(stock.prg, { area: 9, span: 150 });
const S2 = await census(stock.prg, { area: 9, span: 150 });
ok('stock B1 anchor trap-free + deterministic x2', !S1.trap && S1.flag === 0 && S1.s8 === S2.s8, S1.s8);
const P1 = packFromStats({ 5: { hp: 2 } }, TB, 5);
const H1 = await census(P1.prg, { area: 9, span: 150 });
const H2 = await census(P1.prg, { area: 9, span: 150 });
ok('HP e5->02 visible in slot byte13 x2', !H1.trap && H1.s8.slice(26, 28) === '02' && H1.s8 === H2.s8, H1.s8);
const P3 = packFromStats({ 3: { hp: 7 } }, TB, 3);
const H3 = await census(P3.prg, { area: 9, span: 150 });
const H4 = await census(P3.prg, { area: 9, span: 150 });
ok('HP e3->07 visible in slot byte13 x2', !H3.trap && H3.s8.slice(26, 28) === '07' && H3.s8 === H4.s8, H3.s8);
const walk = (f) => (f >= 1060 ? 128 : 0);
const C0 = await census(stock.prg, { area: 9, span: 400, padFn: walk, fine: true });
ok('control first hit = 08 (e0.byte1)', C0.drops.length > 0 && (C0.drops[0][1] - C0.drops[0][2]) === 8, JSON.stringify(C0.drops.slice(0, 2)));
const P2 = packFromStats({ 0: { dmg: 48 } });
const C1 = await census(P2.prg, { area: 9, span: 400, padFn: walk, fine: true });
const C2 = await census(P2.prg, { area: 9, span: 400, padFn: walk, fine: true });
ok('patched first hit = 30 x2', C1.drops.length > 0 && (C1.drops[0][1] - C1.drops[0][2]) === 48 && JSON.stringify(C1.drops) === JSON.stringify(C2.drops), JSON.stringify(C1.drops.slice(0, 2)));
const T1 = await census(P1.prg, { area: 0, span: 150, raw: true });
const T0 = await census(stock.prg, { area: 0, span: 150, raw: true });
ok('tank area unaffected by stat edit', !T1.trap && T1.s8 === T0.s8, T1.s8);
console.log('----');
console.log((fail === 0 ? 'P3C ALL ' + pass + ' CHECKS GREEN' : 'P3C FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
