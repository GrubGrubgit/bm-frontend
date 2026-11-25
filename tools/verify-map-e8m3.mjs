// E8-M3 engine HUD minimap (in-canvas framebuf post-process; the shell
// overlay is gone -- all enhancements live in the engine).
// Run: node tools/verify-map-e8m3.mjs (from frontend/)
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { buildWorld } from '../src/pack/world.js';
import { buildMinimap, decodeCur } from '../src/pack/minimap.js';
import { parseBank } from '../src/pack/levels.js';
import { BG_CHR_BANK } from '../src/pack/tiles.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const mm = buildMinimap(stock);
ok('model builds ok', mm.ok, (mm.errors || []).join(';'));
const w = buildWorld(stock);
const wPer = {};
for (const s of w.sides) wPer[s.level] = (wPer[s.level] || 0) + 1;
let tickTotal = 0, perOk = true;
for (let v = 1; v <= 16; v++) { tickTotal += mm.levels[v].ticks.length; if (mm.levels[v].ticks.length !== (wPer[v] || 0)) perOk = false; }
ok('108 door sides, per-level match world', tickTotal === 108 && perOk, 'total=' + tickTotal);
// Engine NESPAL (copy of bm_api.c table; suite pins the C port against it).
const ENPS = '75,75,75;27,1B,8F;00,00,AB;47,00,9F;8F,00,77;AB,00,13;A7,00,00;7F,0B,00;43,2B,00;00,47,00;00,51,00;00,3A,6B;00,00,00;00,00,00;00,00,00;00,00,00;BC,BC,BC;00,78,F8;00,58,F8;68,44,FC;D8,00,CC;E4,00,58;F8,38,00;E4,5C,10;AC,7C,00;00,B8,00;00,A8,00;00,A8,44;00,88,88;00,00,00;00,00,00;00,00,00;F8,F8,F8;3C,BC,FC;68,88,FC;98,78,F8;F8,78,F8;F8,58,98;F8,78,58;FC,A0,44;F8,B8,00;B8,F8,18;58,D8,54;58,F8,98;00,E8,D8;78,78,78;00,00,00;00,00,00;FC,FC,FC;A4,E4,FC;B8,B8,F8;D8,B8,F8;F8,B8,F8;F8,A8,C0;F0,D0,B0;FC,E0,A8;F8,D8,78;D8,F8,78;B8,F8,B8;B8,F8,D8;00,FC,FC;F8,D8,F8;00,00,00;00,00,00';
const ENP = ENPS.split(';').map((s) => s.split(',').map((h) => parseInt(h, 16)));
function jsThumb(pack, lv) {
  const bank = lv <= 5 ? 0 : ((lv === 6 || lv === 7 || lv === 8 || lv === 9 || lv === 11) ? 1 : 2);
  const P = parseBank(pack.prg[bank], bank);
  const L = P.levels.find((l) => l.level === lv);
  const mapLen = lv === 9 ? 800 : (lv === 13 ? 928 : 1024);
  const rows = mapLen / 32;
  const b4 = BG_CHR_BANK[lv];
  const bg = pack.chr[b4 >> 1].subarray((b4 & 1) * 4096, (b4 & 1) * 4096 + 4096);
  const out = new Array(4096).fill(0);
  for (let bi = 0; bi < rows * 32; bi++) {
    const bx = bi % 32, by = (bi / 32) | 0;
    const blk = L.map[bi];
    for (let q = 0; q < 4; q++) {
      const si = L.blocks[(blk < 0 || blk * 4 + 3 >= L.blocks.length ? 0 : blk) * 4 + q];
      let sr = 0, sg = 0, sb = 0;
      for (let k2 = 0; k2 < 4; k2++) {
        const ci = L.structs[si * 4 + k2];
        const sub = L.attrs[ci] & 3;
        for (let p2 = 0; p2 < 4; p2++) {
          const ti = L.combos[ci * 4 + p2];
          const lo = bg[ti * 16], hi = bg[ti * 16 + 8];
          const v = ((lo >> 7) & 1) | (((hi >> 7) & 1) << 1);
          const pi = (v === 0 ? L.pal[0] : L.pal[sub * 4 + v]) & 63;
          sr += ENP[pi][0]; sg += ENP[pi][1]; sb += ENP[pi][2];
        }
      }
      const ar = (sr / 16) | 0, ag = (sg / 16) | 0, ab = (sb / 16) | 0;
      let best = 0, bestd = 1 << 30;
      for (let c = 0; c < 64; c++) {
        const dr = ar - ENP[c][0], dg = ag - ENP[c][1], db = ab - ENP[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestd) { bestd = d; best = c; }
      }
      out[((by * 2 + (q >> 1)) * 64) + (bx * 2 + (q & 1))] = best;
    }
  }
  let h = 2166136261;
  for (let i = 0; i < 4096; i++) { h ^= out[i]; h = Math.imul(h, 16777219); }
  h ^= rows; h = Math.imul(h, 16777219);
  return { bytes: out, rows: rows, hash: (h >>> 0) & 0x7FFFFFFF };
}
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
async function bootOnly() {
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: () => {} } })).instance;
  return inst.exports;
}
function loadPack(ex) {
  const mm8 = new Uint8Array(ex.memory.buffer);
  const cat2 = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
  mm8.set(cat2(stock.prg), ex.bm_stage_ptr()); ex.bm_load_prg();
  mm8.set(cat2(stock.chr), ex.bm_stage_ptr()); ex.bm_load_chr();
}
{
  const ex = await bootOnly();
  loadPack(ex);
  ok('visible==0 pre-boot (pregame gate)', ex.bm_map_visible() === 0);
  let allHash = true, badLv = '';
  for (let lv = 1; lv <= 16; lv++) {
    const j = jsThumb(stock, lv);
    const c = ex.bm_map_thumb_hash(lv);
    if (c !== j.hash || j.rows !== mm.levels[lv].rows) { allHash = false; badLv += lv + '(c=' + c + ',js=' + j.hash + ') '; }
  }
  ok('thumb hash 16/16 match JS port (pins C parse+sample)', allHash, badLv);
  let allDoors = true;
  for (let lv = 1; lv <= 16; lv++) if (ex.bm_map_doors(lv) !== mm.levels[lv].ticks.length) allDoors = false;
  ok('door counts 16/16 match + bad args', allDoors && ex.bm_map_doors(0) === -1 && ex.bm_map_doors(17) === -1);
  const h1 = ex.bm_map_thumb_hash(2);
  ex.bm_map_invalidate();
  ok('invalidate rebuilds identical', ex.bm_map_thumb_hash(2) === h1);
}
function fnv(b) { let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777219); } return h >>> 0; }
async function drive(o) {
  const rec = [];
  let n = -1;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = win.exports;
    let pad = 0;
    for (const t of (o.taps || [])) if (n >= t.at && n < t.at + 8) pad = t.pad;
    ex.bm_set_pad(pad);
    if (o.onFrame) o.onFrame(ex, n);
    if (o.rec && n % 10 === 0) {
      const mem = new Uint8Array(ex.memory.buffer);
      const vp = ex.bm_video_ptr();
      rec.push({ f: n, cur: ex.bm_visit_cur(), vis: ex.bm_map_visible(), vb: fnv(mem.slice(vp, vp + 256 * 240 * 4)) });
    }
    if (o.frames && o.frames.indexOf(n) >= 0) {
      const mem = new Uint8Array(ex.memory.buffer);
      const vp = ex.bm_video_ptr();
      const vbp = ex.bm_visit_ptr();
      o.frames[n] = null;
      o.out[n] = { f: n, cur: ex.bm_visit_cur(), vis: ex.bm_map_visible(), bytes: Array.from(mem.slice(vp, vp + 256 * 240 * 4)), vb: Array.from(mem.slice(vbp, vbp + 128)) };
    }
    if (n >= o.span) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    loadPack(win.exports);
    win.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  return { ex: win.exports, trap: trap, rec: rec };
}
const WALK = [{ at: 61, pad: 8 }];
function walkOn(enh) { return (ex, f) => { if (f === 200 && enh) ex.bm_enhanced_set(1); if (f === 300) ex.bm_warp_raw(9); if (f >= 400 && f < 1200) ex.bm_set_pad(128); }; }
const outB = {}, outA = {};
const RB = await drive({ span: 1300, rec: true, taps: WALK, frames: [600, 900, 1200], out: outB, onFrame: walkOn(true) });
const RA = await drive({ span: 1300, rec: true, taps: WALK, frames: [600, 900, 1200], out: outA, onFrame: walkOn(false) });
ok('walk runs clean (both hit gameplay)', !RB.trap && !RA.trap && outB[900].cur >= 0 && outA[900].cur >= 0, RB.trap || RA.trap);
// Confinement: A/B diffs lie strictly inside the L2 rect (x 187..254, y 3..69).
{
  let confined = true, inside = 0, detail = '';
  for (const f of [600, 900, 1200]) {
    const a = outA[f].bytes, b = outB[f].bytes;
    let nIn = 0, nOut = 0;
    for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) {
      const o = (y * 256 + x) * 4;
      if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]) {
        if (x >= 187 && x <= 254 && y >= 3 && y <= 69) nIn++;
        else { nOut++; if (detail === '') detail = 'f' + f + ' x' + x + ' y' + y; }
      }
    }
    inside += nIn;
    if (nOut > 0 || nIn < 500) confined = false;
  }
  ok('A/B diffs confined to minimap rect + rect differs', confined, detail + ' inside=' + inside);
}
// Byte-exact expected rect at f=900 (thumb + fog + ticks + dot + border).
{
  const F = outB[900];
  const d = decodeCur(F.cur);
  const th = jsThumb(stock, d.lv);
  const X0 = 188, Y0 = 4, rows = th.rows;
  const exp = {};
  const setP = (x, y, r, g, b) => { exp[y * 256 + x] = [r, g, b]; };
  for (let x = X0 - 1; x <= X0 + 64; x++) { setP(x, Y0 - 1, 117, 117, 117); setP(x, Y0 + rows * 2, 117, 117, 117); }
  for (let y = Y0 - 1; y <= Y0 + rows * 2; y++) { setP(X0 - 1, y, 117, 117, 117); setP(X0 + 64, y, 117, 117, 117); }
  for (let y = 0; y < rows * 2; y++) for (let x = 0; x < 64; x++) {
    const bit = (F.vb[((d.lv - 1) * 8) + (((y >> 3) * 8 + (x >> 3)) >> 3)] >> (((y >> 3) * 8 + (x >> 3)) & 7)) & 1;
    const idx = th.bytes[y * 64 + x];
    const c = ENP[idx];
    if (bit) setP(X0 + x, Y0 + y, c[0], c[1], c[2]);
    else setP(X0 + x, Y0 + y, c[0] >> 2, c[1] >> 2, c[2] >> 2);
  }
  for (const s of w.sides) {
    if (s.level !== d.lv) continue;
    if (s.by >= rows) continue;
    const dx = X0 + s.bx * 2, dy = Y0 + s.by * 2;
    setP(dx, dy, 248, 184, 0); setP(dx + 1, dy, 248, 184, 0); setP(dx, dy + 1, 248, 184, 0); setP(dx + 1, dy + 1, 248, 184, 0);
  }
  const cx = X0 + d.sx * 8 + 4, cy = Y0 + d.sy * 8 + 4;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setP(cx + dx, cy + dy, 167, 0, 0);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) setP(cx + dx, cy + dy, 252, 252, 252);
  let bad = 0, first = '';
  for (const k of Object.keys(exp)) {
    const o = k * 4;
    const e = exp[k];
    if (F.bytes[o] !== e[0] || F.bytes[o + 1] !== e[1] || F.bytes[o + 2] !== e[2]) { bad++; if (first === '') first = 'k' + k + ' got=' + F.bytes[o] + ',' + F.bytes[o + 1] + ',' + F.bytes[o + 2] + ' exp=' + e.join(','); }
  }
  ok('expected rect byte-exact (fog+dot+ticks+border)', bad === 0, 'bad=' + bad + ' ' + first);
  const co = (cy * 256 + cx) * 4;
  ok('player dot center white', F.bytes[co] === 252 && F.bytes[co + 1] === 252 && F.bytes[co + 2] === 252);
}
{
  const mk = () => drive({ span: 1300, rec: true, taps: WALK, onFrame: walkOn(true) });
  const K1 = await mk(), K2 = await mk();
  let bad = 0;
  for (let i = 0; i < K1.rec.length; i++) if (!K1.rec[i] || !K2.rec[i] || K1.rec[i].vb !== K2.rec[i].vb) bad++;
  ok('determinism x2 incl minimap pixels', !K1.trap && !K2.trap && K1.rec.length > 50 && bad === 0, (K1.trap || K2.trap) || ('bad=' + bad));
}
// Gates: pregame 0, gameplay 1, enhanced-off 0.
{
  const vB100 = RB.rec.find((r) => r.f === 100);
  const vB600 = RB.rec.find((r) => r.f === 600);
  const vA600 = RA.rec.find((r) => r.f === 600);
  ok('gates: pregame 0 / gameplay 1 / enh-off 0', vB100.vis === 0 && vB600.vis === 1 && vA600.vis === 0, 'b100=' + vB100.vis + ' b600=' + vB600.vis + ' a600=' + vA600.vis);
}
// Modal: E5 prompt hides the map (gameplay continues underneath).
{
  const ENTRY_TAPS = [{ at: 61, pad: 8 }, { at: 950, pad: 32 }, { at: 958, pad: 32 }, { at: 1000, pad: 16 }];
  const R = await drive({ span: 1160, rec: true, taps: ENTRY_TAPS,
    onFrame: (ex, f) => { if (f === 500) { ex.bm_enhanced_set(1); ex.bm_saving_set(1); } if (f === 800) ex.bm_warp_raw(9); } });
  const r990 = R.rec.find((r) => r.f === 990);
  const r1100 = R.rec.find((r) => r.f === 1100);
  const ev5 = R.ex.bm_ev5_dbg() & 255;
  ok('modal: gameplay 1 pre-prompt, ev5 hides (vis 0)', !R.trap && r990.vis === 1 && r1100.vis === 0, R.trap || ('990=' + r990.vis + ' 1100=' + r1100.vis + ' ev5end=' + ev5));
}
// Shell: no rendering left (sync/persistence only), invalidate wired.
{
  const enh = readFileSync(PROJ + '/frontend/src/ui/enhance.js', 'utf8');
  const has = (s) => enh.indexOf(s) >= 0;
  ok('shell: overlay gone, sync kept, invalidate wired', !has('mapHud') && !has('drawMap') && !has('paintMap') && has('syncVisits(') && has('bm_map_invalidate'), '');
}
console.log('---- E8M3: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
