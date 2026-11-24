// 6.1: bank-3 enemy/powerup spawn tables (pointer chain + record format + write path).
// Run: node tools/verify-pack-6.1.mjs  (from frontend/)
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
const b3 = stock.prg[3], b6 = stock.prg[6];
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
ok('R1[1]=$A174 (area spawn-list table)', u16(b3, 2) === 0xA174, u16(b3, 2).toString(16));
ok('area-1 list B1=$B2A2', u16(b3, 0x2174 + 2 * 9) === 0xB2A2, u16(b3, 0x2174 + 18).toString(16));
const T = 0x32A2;
ok('B1 triplet [B2A8][B320][B397]', u16(b3, T) === 0xB2A8 && u16(b3, T + 2) === 0xB320 && u16(b3, T + 4) === 0xB397);
const TB = 0xB2A8 - 0x8000, XB = 0xB320 - 0x8000;
ok('x anchors (4B 4F 54 52)', b3[XB] === 0x4B && b3[XB + 2] === 0x4F && b3[XB + 0x0E] === 0x54 && b3[XB + 0x26] === 0x52);
ok('type anchors (0 0 1 2)', b3[TB] === 0 && b3[TB + 2] === 0 && b3[TB + 0x0E] === 1 && b3[TB + 0x26] === 2);
ok('types <0x80 (bpl scan, first 0x40)', (() => { for (let i = 0; i < 0x40; i++) if (b3[TB + i] >= 0x80) return false; return true; })());
const vecbase = u16(b6, 0);
const vent = u16(b6, vecbase - 0x8000 + (0x55 - 1) * 2);
ok('bank6 vector base=8002 [0x54]=A40B ->jmp', vecbase === 0x8002 && vent === 0xA40B && b6[vent - 0x8000] === 0x4C);
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
async function census(prgBanks, warpA, span) {
  let win = null;
  const warpF = 1000, endF = warpF + span + 1;
  let snap = null, trapMsg = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === warpF) ex.bm_warp(warpA);
    if (f === warpF + span) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      snap = mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160);
      snap.video = mem.slice(ex.bm_video_ptr(), ex.bm_video_ptr() + 256 * 240 * 4);
    }
    if (f + 1 >= endF) throw new Error('STOP');
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const o = new Uint8Array(banks[0].length * banks.length); banks.forEach((b, i) => o.set(b, i * banks[0].length)); return o; };
    mm().set(cat(prgBanks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trapMsg = String((e && e.message) || e).slice(0, 80); }
  let trapFlag = -1;
  try { trapFlag = inst.exports.bm_trap_flag(); } catch (e) {}
  const hx = (a, n) => { let s = ''; for (let i = 0; i < n; i++) s += snap[a + i].toString(16).padStart(2, '0'); return s; };
  const slot = (s) => hx(0x400 + s * 14, 14);
  return { trapMsg, trapFlag, r14: snap[0x14], zp: hx(0, 6), e8: snap[0x8E],
    t100: hx(0x100, 4), h150: hx(0x150, 16),
    s8: slot(8), s9: slot(9), s10: slot(10), s11: slot(11), video: snap.video };
}
function patchedPack(off, val) {
  const p = stock.prg.map(b => b.slice());
  p[3] = p[3].slice(); p[3][off] = val;
  const patches = [OV.makePatch('prg', 3, off, p[3].slice(off, off + 1))];
  const doc = { customVersion: 1, id: 'c-61', name: '61', baseCrc: stock.meta.crc32, patches, editorVersion: '61', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const r = OV.applyOverlay(stock, doc);
  if (!r.ok) throw new Error('overlay failed');
  return r.pack;
}
const A = await census(stock.prg, 9, 150);
const B = await census(stock.prg, 9, 150);
ok('stock trap-free, warp(9)->area1', !A.trapMsg && A.trapFlag === 0 && A.r14 === 9, A.trapMsg || ('flag=' + A.trapFlag + ' 14=' + A.r14));
ok('ZP parks B1 triplet', A.zp === '00b220b397b3', A.zp);
ok('slots 8/9 actor 0x55 @4B/4F', A.s8.slice(0, 8) === '5501804b' && A.s9.slice(0, 8) === '5501804f', A.s8 + ' / ' + A.s9);
ok('slots 10/11 placeholder 01 @54/52', A.s10.slice(0, 8) === '01008054' && A.s11.slice(0, 8) === '01008052', A.s10 + ' / ' + A.s11);
ok('T100 = 00 02 0e 26', A.t100 === '00020e26', A.t100);
ok('H150 sprites 54 54', A.h150.slice(16, 20) === '5454', A.h150);
ok('deterministic (2 stock runs identical)', A.s8 === B.s8 && A.h150 === B.h150);
const P = patchedPack(TB, 5);
const C = await census(P.prg, 9, 150);
ok('type patch trap-free', !C.trapMsg && C.trapFlag === 0, C.trapMsg || ('flag=' + C.trapFlag));
ok('t[0]=05: slot8 actor 55->60 @4B', C.s8.slice(0, 8) === '60c8804b' && C.s8.slice(8) !== A.s8.slice(8), C.s8);
ok('t[0]=05: slot8 sprite 54->5F', C.h150.slice(16, 18) === '5f', C.h150);
ok('type controls unchanged (s9-11,T100,8E)', C.s9 === A.s9 && C.s10 === A.s10 && C.s11 === A.s11 && C.t100 === A.t100 && C.e8 === A.e8);
const sad = (a, b) => { let x = 0; for (let i = 0; i < a.length; i += 401) x += Math.abs(a[i] - b[i]); return x; };
ok('type patch changes pixels', sad(C.video, A.video) > 0, 'sad=' + sad(C.video, A.video));
const Q = patchedPack(XB, 0x51);
const D = await census(Q.prg, 9, 150);
ok('x patch trap-free', !D.trapMsg && D.trapFlag === 0, D.trapMsg || ('flag=' + D.trapFlag));
ok('x[0]=51: slot8 spawns at px-hi 51 (x-array mapping)', D.s8.slice(0, 8) === '01008051', D.s8);
ok('x[0]=51: slot8 stays dormant 01 (activation is position-gated)', D.s8.slice(0, 2) === '01', D.s8);
console.log('----');
console.log((fail === 0 ? '6.1 ALL ' + pass + ' CHECKS GREEN' : '6.1 FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
