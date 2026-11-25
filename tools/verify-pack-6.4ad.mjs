// 6.4d sprite CHR banks + 6.4a sprite palettes. Run: node tools/verify-pack-6.4ad.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { BG_CHR_BANK } from '../src/pack/tiles.js';
import { AREA_LEVEL } from '../src/pack/world.js';
import { SPR_BANK_DUNGEON, SPR_BANK_OVERHEAD, SPR_PAL, SPR_CYCLE, SPR_ROM, SPR_PIN, spriteBanksFor, isPureSpriteBank } from '../src/pack/sprites.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const B7 = rom.slice(16 + 7 * 16384, 16 + 8 * 16384);
const eq = (u8, arr) => u8.length === arr.length && Array.from(u8).every((v, i) => v === arr[i]);
ok('ROM sprite palettes pinned (LC6BF/LC6CB identical 12B)', eq(B7.slice(SPR_ROM.palOver, SPR_ROM.palOver + 12), SPR_PIN.pal) && eq(B7.slice(SPR_ROM.palDung, SPR_ROM.palDung + 12), SPR_PIN.pal));
ok('ROM aux24 pinned (LC6D7)', eq(B7.slice(SPR_ROM.aux, SPR_ROM.aux + 24), SPR_PIN.aux));
ok('ROM bgc16 pinned (LC71A)', eq(B7.slice(SPR_ROM.bgc, SPR_ROM.bgc + 16), SPR_PIN.bgc));
ok('ROM chord16 pinned (LC72A)', eq(B7.slice(SPR_ROM.chord, SPR_ROM.chord + 16), SPR_PIN.chord));
ok('ROM t4-8 pinned (LC73A)', eq(B7.slice(SPR_ROM.t4, SPR_ROM.t4 + 8), SPR_PIN.t4));
ok('ROM cyc8 pinned (LC651)', eq(B7.slice(SPR_ROM.cyc, SPR_ROM.cyc + 8), SPR_PIN.cyc));
ok('ROM palette LUT anchors (LEBF4 identity+mirrors)', B7[SPR_ROM.lut + 0x22] === 0x22 && B7[SPR_ROM.lut + 0x30] === 0x30 && B7[SPR_ROM.lut + 0x0D] === 0x0F && B7[SPR_ROM.lut] === 0x00);
{
  let bad = '';
  for (let a = 0; a < 16; a++) if (SPR_PIN.bgc[a] !== BG_CHR_BANK[AREA_LEVEL(a)]) bad += a + ' ';
  ok('bgc cross-check vs BG_CHR_BANK 16/16', bad === '', bad);
}
{
  let m = true, d = '';
  for (let lv = 1; lv <= 8; lv++) if (SPR_PIN.chord[8 + lv - 1] !== SPR_BANK_DUNGEON[lv]) { m = false; d += 'd' + lv; }
  for (let i = 0; i < 8; i++) if (SPR_PIN.chord[i] !== SPR_BANK_OVERHEAD) { m = false; d += 'o' + i; }
  const p = SPR_PIN.pal;
  if (SPR_PAL.join(',') !== [p[1], p[2], p[3], p[5], p[6], p[7], p[9], p[10], p[11]].join(',')) { m = false; d += 'pal'; }
  if (SPR_CYCLE.join(',') !== SPR_PIN.cyc.join(',')) { m = false; d += 'cyc'; }
  if (spriteBanksFor(1).join(',') !== '0' || spriteBanksFor(9).join(',') !== '16,17' || !isPureSpriteBank(1, 0) || isPureSpriteBank(9, 17)) { m = false; d += 'api'; }
  ok('lib model == ROM tables + api', m, d);
}
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function loadPackInto(ex, pk) {
  const mm8 = new Uint8Array(ex.memory.buffer);
  const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
  mm8.set(cat(pk.prg), ex.bm_stage_ptr()); ex.bm_load_prg();
  mm8.set(cat(pk.chr), ex.bm_stage_ptr()); ex.bm_load_chr();
}
async function surveyArea(k, pk, frames) {
  let n = -1;
  const snaps = [];
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = win.exports;
    ex.bm_set_pad(n === 61 ? 8 : 0);
    if (n === 700) ex.bm_warp_raw(k);
    if (n >= frames[0] && n <= frames[1] && n % 10 === 0) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      const st = ex.bm_stage_ptr();
      snaps.push({ f: n, area: mem[ex.bm_pre_ptr() + 0x14] & 15, dd: ex.bm_ram_rd(0xDD),
        r2000: mem[st + 4096 + 34], chr0: mem[st + 4096 + 35], chr1: mem[st + 4096 + 36],
        sp: Array.from(mem.slice(st + 4096 + 16, st + 4096 + 32)), r10: ex.bm_ram_rd(0x10) });
    }
    if (n >= frames[1] + 10) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  try {
    loadPackInto(win.exports, pk || stock);
    win.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: String(e.message).slice(0, 60), snaps: [] }; }
  return { trap: null, snaps };
}
function fnv(b) { let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777219); } return h >>> 0; }
{
  let allOk = true, detail = '';
  for (let k = 0; k < 16; k++) {
    if (k === 6) continue;
    const R = await surveyArea(k, null, [950, 1150]);
    const S = R.snaps;
    const expChr0 = k < 8 ? 16 : SPR_BANK_DUNGEON[AREA_LEVEL(k)];
    const expChr1 = BG_CHR_BANK[AREA_LEVEL(k)];
    const expR = k < 8 ? 0xB0 : 0x90;
    let good = !R.trap && S.length === 21 && S.every((s) => s.area === k && s.dd === 2);
    const L = S[S.length - 1];
    if (good) {
      good = L.chr0 === expChr0 && L.chr1 === expChr1 && L.r2000 === expR && L.sp[12] === 0x00 &&
        L.sp[1] === SPR_PAL[0] && L.sp[2] === SPR_PAL[1] && L.sp[3] === SPR_PAL[2] &&
        L.sp[5] === SPR_PAL[3] && L.sp[6] === SPR_PAL[4] && L.sp[7] === SPR_PAL[5] &&
        L.sp[9] === SPR_PAL[6] && L.sp[10] === SPR_PAL[7] && L.sp[11] === SPR_PAL[8];
    }
    if (!good) { allOk = false; detail += 'a' + k + (R.trap ? ':trap' : ':n=' + S.length + ' dd=' + (L && L.dd) + ' chr=' + (L && L.chr0) + '/' + (L && L.chr1)) + ' '; }
  }
  ok('15-area settled survey (banks+r2000+pal, hostile spawns alive)', allOk, detail);
}
{
  const R = await surveyArea(6, null, [950, 1150]);
  ok('area6 warp_raw traps (pre-existing stock init trap, static-only)', !!R.trap, R.trap || ('snaps=' + R.snaps.length));
  ok('area6 table entries pinned (bgc=0x14 chord=0x10)', SPR_PIN.bgc[6] === 0x14 && SPR_PIN.chord[6] === 0x10, '');
}
async function videoRun(k, pk, span, drive) {
  let n = -1; const rec = [];
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = win.exports;
    ex.bm_set_pad(n === 61 ? 8 : (drive && n > 700 ? 128 : 0));
    if (n === 700) ex.bm_warp_raw(k);
    if (n % 10 === 0 && n >= 950 && n <= span) {
      const mem = new Uint8Array(ex.memory.buffer);
      rec.push(fnv(mem.slice(ex.bm_video_ptr(), ex.bm_video_ptr() + 256 * 240 * 4)));
    }
    if (n >= span + 5) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  try { loadPackInto(win.exports, pk || stock); win.exports.bm_boot(); }
  catch (e) { if (e.message !== 'STOP') return { trap: e.message, rec: [] }; }
  return { trap: null, rec };
}
{
  const rp = rom.slice();
  rp[16 + 7 * 16384 + 0x732] = 3;
  const pk = buildPack(rp, 'patched.nes').pack;
  const R = await surveyArea(8, pk, [950, 1150]);
  const L = R.snaps[R.snaps.length - 1];
  const V = await videoRun(8, pk, 1600, true);
  const C = await videoRun(8, null, 1600, true);
  let diff = 0;
  for (let i = 0; i < V.rec.length && i < C.rec.length; i++) if (V.rec[i] !== C.rec[i]) diff++;
  ok('CHR patch-proof (LC72A L1 0->3: chr0==3 + drive-right video differs)', !R.trap && L.chr0 === 3 && diff > 5, R.trap || ('chr0=' + (L && L.chr0) + ' diff=' + diff));
}
{
  const rp = rom.slice();
  rp[16 + 7 * 16384 + 0x6CC] = 0x35;
  const pk = buildPack(rp, 'patched2.nes').pack;
  const R = await surveyArea(8, pk, [950, 1150]);
  const L = R.snaps[R.snaps.length - 1];
  const V = await videoRun(8, pk, 1150);
  const C = await videoRun(8, null, 1150);
  let diff = 0;
  for (let i = 0; i < V.rec.length && i < C.rec.length; i++) if (V.rec[i] !== C.rec[i]) diff++;
  ok('palette patch-proof (LC6CB[1] 30->35: sp[1]==35 + video differs)', !R.trap && L.sp[1] === 0x35 && diff > 0, R.trap || ('sp1=' + (L && L.sp[1]) + ' diff=' + diff));
}
{
  let n = -1; const rows = [];
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = win.exports;
    ex.bm_set_pad(n === 61 ? 8 : 0);
    if (n === 700) ex.bm_warp_raw(8);
    if (n >= 1400 && n < 1416) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      const st = ex.bm_stage_ptr();
      rows.push({ r10: ex.bm_ram_rd(0x10), p29: mem[st + 4096 + 29], p30: mem[st + 4096 + 30], p31: mem[st + 4096 + 31] });
    }
    if (n >= 1420) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  try { loadPackInto(win.exports, stock); win.exports.bm_boot(); }
  catch (e) { if (e.message !== 'STOP') rows.push({ err: String(e.message) }); }
  let cycOk = rows.length === 16;
  for (const r of rows) {
    const exp = SPR_CYCLE[(r.r10 - 1) & 7];
    if (!(r.p29 === exp && r.p30 === exp && r.p31 === exp)) cycOk = false;
  }
  ok('sub-3 cycle proof (pal29-31 == LC651[(r10-1)&7] x16)', cycOk, 'n=' + rows.length);
}
{
  const mk = () => surveyArea(8, null, [950, 1150]);
  const A = await mk(), B = await mk();
  let same = A.snaps.length === B.snaps.length && A.snaps.length > 0;
  if (same) for (let i = 0; i < A.snaps.length; i++) {
    const a = A.snaps[i], b = B.snaps[i];
    if (a.chr0 !== b.chr0 || a.chr1 !== b.chr1 || a.r2000 !== b.r2000 || a.dd !== b.dd) same = false;
  }
  ok('determinism x2 (area8 survey)', same, '');
}
{
  const ed = readFileSync(PROJ + '/frontend/src/ui/editor.js', 'utf8');
  const has = (s) => ed.indexOf(s) >= 0;
  ok('editor: sprite model wired (labels + preview palette)', has('sprites.js') && has('SPR_PAL') && has('spriteBanksFor'), 'missing');
}
console.log('---- 6.4ad: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
