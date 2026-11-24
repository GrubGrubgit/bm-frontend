// 6.1b: enemy stat tables (HP table bank6 $A36A, damage byte), type->actor/
// statidx maps, R1 non-spawn indices, A-group (tank) consumer, trap set.
// Run: node tools/verify-pack-6.1b.mjs (from frontend/)
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
const b3 = stock.prg[3], b6 = stock.prg[6], b7 = stock.prg[7];
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const hx = (b, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += b[o + i].toString(16).padStart(2, '0'); return s; };
// ---- static: R1 master table ----
ok('R1[1]=A174 spawn table', u16(b3, 2) === 0xA174);
ok('R1[0]=8004 variant table', u16(b3, 0) === 0x8004);
ok('R1[14]=0042 zp/sram path', u16(b3, 28) === 0x0042);
ok('R1[2..13,15] in bank3', (() => { for (const i of [2,3,4,5,6,7,8,9,10,11,12,13,15]) { const t = u16(b3, i*2); if (t < 0x8000 || t >= 0xC000) return false; } return true; })());
// ---- static: A174 area list ----
const A = u16(b3, 2) - 0x8000;
ok('G0=A19B A-group', u16(b3, A) === 0xA19B);
ok('G9=B2A2 B-group', u16(b3, A + 18) === 0xB2A2);
ok('A-group triplets ordered', (() => {
  for (let i = 0; i < 8; i++) {
    const tri = u16(b3, A + i * 2) - 0x8000;
    const tb = u16(b3, tri) - 0x8000, xb = u16(b3, tri + 2) - 0x8000, yb = u16(b3, tri + 4) - 0x8000;
    if (!(tri + 6 <= tb && tb < xb && xb < yb)) return false;
  }
  return true;
})());
// ---- static: HP stat table bank6 ----
const HT = 0xA36A - 0x8000;
ok('HP table e0=[04 08 2C 60]', hx(b6, HT, 4) === '04082c60');
ok('HP table ends A3E1, code resumes jmp A40A', hx(b6, HT + 120, 5) === '4c0aa4a900');
ok('HP table e5.byte0=06 e3.byte0=20', b6[HT + 5*4] === 0x06 && b6[HT + 3*4] === 0x20);
// ---- static: actor vector entries (type->actor init targets) ----
const vent = (a) => u16(b6, 2 + (a - 1) * 2);
ok('vec55=A40B vec59=A53A', vent(0x55) === 0xA40B && vent(0x59) === 0xA53A);
ok('vec5C=A6E4 vec60=A7EE vec65=A9DE vec67=AA6C', vent(0x5C) === 0xA6E4 && vent(0x60) === 0xA7EE && vent(0x65) === 0xA9DE && vent(0x67) === 0xAA6C);
// ---- static: sprite tables ----
ok('LCB7C[0..8]=54 56 58 5B 5D 5F 62 64 66', hx(b7, 0xCB7C - 0xC000, 9) === '5456585b5d5f626466');
ok('spawn path uses EA3A $31 (bank3 R1[1])', (() => {
  const code = hx(b7, 0, 0x4000);
  return code.includes('a931203aea'); // lda #$31; jsr EA3A
})());
// ---- headless harness ----
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
function packWith(list) {
  const p = stock.prg.map(b => b.slice());
  const patches = list.map(pl => { p[pl[0]] = p[pl[0]].slice(); p[pl[0]][pl[1]] = pl[2]; return OV.makePatch('prg', pl[0], pl[1], p[pl[0]].slice(pl[1], pl[1] + 1)); });
  const doc = { customVersion: 1, id: 'c61b', name: '61b', baseCrc: stock.meta.crc32, patches, editorVersion: '61b', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const rr = OV.applyOverlay(stock, doc);
  if (!rr.ok) throw new Error('overlay failed');
  return rr.pack;
}
async function census(prgBanks, opt) {
  const { area, raw, span, padFn, fine } = opt;
  const warpF = 1000, endF = warpF + span + 1;
  let snap = null, trapMsg = null;
  const drops = [];
  let lastHP = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : (padFn ? padFn(f) : 0));
    if (f === warpF) { if (raw) ex.bm_warp_raw(area); else ex.bm_warp(area); }
    const doSnap = fine ? (f >= warpF + 100 && f <= warpF + span && (f % 5 === 0)) : (f === warpF + span);
    if (doSnap) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      snap = mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160);
      if (fine) {
        const hp = snap[0x40D];
        if (lastHP !== null && hp !== lastHP) drops.push([f - warpF, lastHP, hp]);
        lastHP = hp;
      }
    }
    if (f + 1 >= endF) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trapFlag = -1;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const o = new Uint8Array(banks[0].length * banks.length); banks.forEach((b, i) => o.set(b, i * banks[0].length)); return o; };
    mm().set(cat(prgBanks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trapMsg = String((e && e.message) || e).slice(0, 80); }
  try { trapFlag = inst.exports.bm_trap_flag(); } catch (e) {}
  if (!snap) return { trapMsg, trapFlag, nosnap: 1, drops };
  const h = (a, n) => { let s = ''; for (let i = 0; i < n; i++) s += snap[a + i].toString(16).padStart(2, '0'); return s; };
  return { trapMsg, trapFlag, zp: h(0, 6), s8: h(0x400 + 8 * 14, 14), drops };
}
const TB = 0xB2A8 - 0x8000;
// H1 determinism
const D1 = await census(stock.prg, { area: 9, span: 150 });
const D2 = await census(stock.prg, { area: 9, span: 150 });
ok('stock deterministic x2', !D1.nosnap && D1.s8 === D2.s8, (D1.s8 || 'NA') + ' vs ' + (D2.s8 || 'NA'));
// H2 HP write path (x2 each)
for (const [idx, type, val] of [[5, 5, 0x02], [3, 3, 0x07]]) {
  const r1 = await census(packWith([[6, HT + idx * 4, val], [3, TB, type]]).prg, { area: 9, span: 150 });
  const r2 = await census(packWith([[6, HT + idx * 4, val], [3, TB, type]]).prg, { area: 9, span: 150 });
  ok('HP e' + idx + '->0x' + val.toString(16) + ' type' + type + ' deterministic', !r1.nosnap && r1.s8.slice(26, 28) === val.toString(16).padStart(2, '0') && r1.s8 === r2.s8, r1.s8 + ' / ' + r2.s8);
}
// H3 damage write path: e0.byte1 08->30, first drop must be 30 (control: 08)
const walk = (f) => (f >= 1060 ? 128 : 0);
const C0 = await census(stock.prg, { area: 9, span: 400, padFn: walk, fine: true });
const C1 = await census(packWith([[6, HT + 1, 0x30]]).prg, { area: 9, span: 400, padFn: walk, fine: true });
const firstDrop = (d) => d.length ? (d[0][1] - d[0][2]) : -1;
ok('control first hit = 08 (e0.byte1)', firstDrop(C0.drops) === 0x08, JSON.stringify(C0.drops.slice(0, 3)));
ok('patched first hit = 30 (e0.byte1=30)', firstDrop(C1.drops) === 0x30, JSON.stringify(C1.drops.slice(0, 3)));
// H4 A-group consumer: warp_raw(0) parks A0 triplet, spawns via same path
const G = await census(stock.prg, { area: 0, raw: true, span: 150 });
ok('warp_raw(0): ZP parks A0 triplet tail', !G.nosnap && G.zp.slice(2) === 'a127a2aca2', G.zp);
ok('warp_raw(0): slot8 spawned (actor 45)', !G.nosnap && G.s8.slice(0, 2) === '45', G.s8);
// H5 trap set determinism + A6 stock trap note
for (const t of [9, 15]) {
  const q1 = await census(packWith([[3, TB, t]]).prg, { area: 9, span: 150 });
  const q2 = await census(packWith([[3, TB, t]]).prg, { area: 9, span: 150 });
  ok('type' + t + ' traps deterministic x2', q1.nosnap && q2.nosnap && q1.trapFlag === 1, q1.trapMsg);
}
const A6 = await census(stock.prg, { area: 6, raw: true, span: 150 });
ok('NOTE warp_raw(6) traps on STOCK (pre-existing, not spawn-list)', A6.nosnap && A6.trapFlag === 1, A6.trapMsg || 'no trap?!');
console.log('----');
console.log((fail === 0 ? '6.1b ALL ' + pass + ' CHECKS GREEN' : '6.1b FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
