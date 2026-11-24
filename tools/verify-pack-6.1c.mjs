// 6.1c: tank-side stats + activation (bank-4 table, vector dispatch).
// Run: node tools/verify-pack-6.1c.mjs  (from frontend/)
// Tank stat table: 16x4B at CPU $B326 (bank-rel $3326, ends $B366, code
// resumes JMP $B392); byte0 = max HP, byte1 = shot damage; bytes 2-3
// UNIDENTIFIED (never written). Types 0-15 only (16-31 empty, 32+ special:
// egg/powerup/boss/splitter). Dispatch: EA3A($40)=bank4 R1[0]=$8006 vector
// base; EB51(actor-1)->init; dormant slots start byte0=01/HP=$20 (fixed-bank
// filler), converter overwrites actor+HP from the table.
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import * as OV from '../src/pack/overlay.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const b3 = stock.prg[3], b4 = stock.prg[4], b7 = stock.prg[7];
const u16 = (B, o) => B[o] | (B[o + 1] << 8);
const hx = (B, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += B[o + i].toString(16).padStart(2, '0'); return s; };
const TT = 0x3326;
ok('tank table e0=[04 10 1a 90]', hx(b4, TT, 4) === '04101a90');
ok('tank table e14=[20 30 22 ff]', hx(b4, TT + 14 * 4, 4) === '203022ff');
ok('tank table ends B366, 16 entries (e16=JMP B392)', hx(b4, TT + 64, 3) === '4c92b3');
ok('tank HP byte0 matches sweep (16/16)', (() => {
  const HP = [4, 1, 2, 1, 2, 1, 8, 1, 24, 8, 8, 8, 6, 8, 32, 4];
  for (let e = 0; e < 16; e++) if (b4[TT + e * 4] !== HP[e]) return false;
  return true;
})());
ok('tank dmg byte1 matches contact obs', b4[TT + 1 * 4 + 1] === 16 && b4[TT + 10 * 4 + 1] === 24 && b4[TT + 14 * 4 + 1] === 48 && b4[TT + 8 * 4 + 1] === 32);
ok('R1[0]=$8006 vector base (tank)', u16(b4, 0) === 0x8006);
ok('vent 45->BE61 5b->9FB7 63->A589', u16(b4, 6 + 68 * 2) === 0xBE61 && u16(b4, 6 + 90 * 2) === 0x9FB7 && u16(b4, 6 + 98 * 2) === 0xA589);
ok('EA3A reads R1 word (a2 7a ... b9 00 80)', hx(b7, 0x2A3A, 12) === 'a27aa84a4a4a4a201be69829');
ok('EB51 indexes vector word (0a a8 ... b1 7a)', hx(b7, 0x2B51, 10) === '0aa89002e67bb17ac8aa');
ok('filler bytes (bank7 LCB: 01 dormant + 20 HP)', (() => {
  const code = hx(b7, 0, 0x4000);
  return code.includes('a9019d0004') && code.includes('a9209d0d04');
})());
// --- dynamic: alone-method sweep spots + table patch proofs ---
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
const A0TB = 0x21A1;
function packAlone(t, statEd) {
  const p = stock.prg.map((b) => b.slice());
  p[3] = p[3].slice();
  const n = 133;
  for (let i = 0; i < n; i++) p[3][A0TB + i] = 16;
  p[3][A0TB + 92] = t;
  if (statEd) { p[4] = p[4].slice(); for (const k of Object.keys(statEd)) for (const f of Object.keys(statEd[k])) p[4][TT + (+k) * 4 + (+f)] = statEd[k][f]; }
  const patchList = [];
  for (const bn of [3, 4]) for (const x of OV.diffRuns(stock.prg[bn], p[bn])) patchList.push(OV.makePatch('prg', bn, x.off, x.bytes));
  const doc = { customVersion: 1, id: 'c-61c', name: '61c', baseCrc: stock.meta.crc32, patches: patchList, editorVersion: '61c', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const q = OV.applyOverlay(stock, doc);
  if (!q.ok) throw new Error('overlay failed');
  return q.pack;
}
async function census(prgBanks, o) {
  const warpF = 1000, endF = warpF + o.span + 1;
  let win = null, snap = null, trapMsg = null;
  const drops = []; let lastHP = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : (o.padFn ? o.padFn(f) : 0));
    if (f === warpF) ex.bm_warp_raw(o.area);
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
const slotActor = (s8) => s8.slice(0, 2);
const slotHP = (s8) => s8.slice(26, 28);
const R1 = await census(packAlone(1).prg, { area: 0, span: 250 });
const R2 = await census(packAlone(1).prg, { area: 0, span: 250 });
ok('T1 alone: actor 27 HP 01 x2', !R1.trap && slotActor(R1.s8) === '27' && slotHP(R1.s8) === '01' && R1.s8 === R2.s8, R1.s8);
const R14 = await census(packAlone(14).prg, { area: 0, span: 250 });
ok('T14 alone: actor 45 HP 20', !R14.trap && slotActor(R14.s8) === '45' && slotHP(R14.s8) === '20', R14.s8);
const R32 = await census(packAlone(32).prg, { area: 0, span: 250 });
ok('T32 alone: egg 5b HP 20', !R32.trap && slotActor(R32.s8) === '5b' && slotHP(R32.s8) === '20', R32.s8);
const R49 = await census(packAlone(49).prg, { area: 0, span: 250 });
ok('T49 alone: boss 63 HP 80', !R49.trap && slotActor(R49.s8) === '63' && slotHP(R49.s8) === '80', R49.s8);
const RT = await census(packAlone(0).prg, { area: 0, span: 250 });
ok('T0 traps x2', RT.trap && RT.flag === 1 && (await census(packAlone(0).prg, { area: 0, span: 250 })).flag === 1, RT.trap);
const R16 = await census(packAlone(16).prg, { area: 0, span: 250 });
ok('T16 empty (no slot8 actor)', !R16.trap && slotActor(R16.s8) === '01', R16.s8);
const R33 = await census(packAlone(33).prg, { area: 0, span: 250 });
ok('T33 powerup 23 subtype 00', !R33.trap && slotActor(R33.s8) === '23' && R33.s8.slice(20, 22) === '00', R33.s8);
const PH = await census(packAlone(1, { 1: { 0: 7 } }).prg, { area: 0, span: 250 });
const PH2 = await census(packAlone(1, { 1: { 0: 7 } }).prg, { area: 0, span: 250 });
ok('TABLE PATCH: e1.hp 01->07 visible at spawn x2', !PH.trap && slotHP(PH.s8) === '07' && PH.s8 === PH2.s8, PH.s8);
const walk = (f) => (f >= 1060 ? 128 : 0);
const C0 = await census(packAlone(1).prg, { area: 0, span: 600, padFn: walk, fine: true });
const firstDrop = (d) => d.length ? d[0][1] - d[0][2] : -1;
const frames = (d) => d.map((x) => x[0]);
const mags = (d) => d.map((x) => x[1] - x[2]);
ok('control hits = 16/16/16 at 310/405/535 (contact 16 + shot e1.byte1)', JSON.stringify(frames(C0.drops)) === '[310,405,535]' && JSON.stringify(mags(C0.drops)) === '[16,16,16]', JSON.stringify(C0.drops));
const C1 = await census(packAlone(1, { 1: { 1: 48 } }).prg, { area: 0, span: 600, padFn: walk, fine: true });
const C2 = await census(packAlone(1, { 1: { 1: 48 } }).prg, { area: 0, span: 600, padFn: walk, fine: true });
ok('DAMAGE PATCH: byte1 16->48 gives 16/48/16 at same frames x2 (contact fixed)', JSON.stringify(frames(C1.drops)) === '[310,405,535]' && JSON.stringify(mags(C1.drops)) === '[16,48,16]' && JSON.stringify(C1.drops) === JSON.stringify(C2.drops), JSON.stringify(C1.drops));
console.log('----');
console.log((fail === 0 ? '6.1C ALL ' + pass + ' CHECKS GREEN' : '6.1C FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);

