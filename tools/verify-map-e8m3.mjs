// E8-M3 engine HUD minimap: abstract room grid (Metroid-style).
// Fixed 48x32 box top-right: 6x4 cell per screen, 5x3 visited fill,
// dark unvisited, gold door notches, 2x2 blinking player dot.
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
      o.out[n] = { f: n, fno: ex.bm_frame_no(), be: ex.bm_ram_rd(0xBE), cur: ex.bm_visit_cur(), vis: ex.bm_map_visible(), bytes: Array.from(mem.slice(vp, vp + 256 * 240 * 4)), vb: Array.from(mem.slice(vbp, vbp + 128)) };
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
        if (x >= 203 && x <= 252 && y >= 3 && y <= 36) nIn++;
        else { nOut++; if (detail === '') detail = 'f' + f + ' x' + x + ' y' + y; }
      }
    }
    inside += nIn;
    if (nOut > 0 || nIn < 200) confined = false;
  }
  ok('A/B diffs confined to minimap box + box differs', confined, detail + ' inside=' + inside);
}
const HX0 = 204, HY0 = 4, HBW = 48, HBH = 32;
const C_BG = [5, 5, 18], C_RM = [64, 128, 232], C_GOLD = [248, 184, 0], C_GR = [117, 117, 117];
const C_W = [252, 252, 252], C_R = [248, 56, 56];
// Room-grid semantics on the natural walk (f=900): fills track visits,
// unvisited cells stay dark, dot shows the blink phase color.
{
  const F = outB[900];
  const d = decodeCur(F.cur);
  const rows = mm.levels[d.lv].rows;
  const maxsy = (rows + 3) >> 2;
  const bit = (sx, sy) => { const q = F.vb[((d.lv - 1) * 8) + (((sy * 8 + sx) >> 3))]; return (q >> ((sy * 8 + sx) & 7)) & 1; };
  const dotX = HX0 + d.sx * 6 + 2, dotY = HY0 + d.sy * 4 + 1;
  const frozen = F.be === 0;
  const blink = (F.fno >> 4) & 1;
  const dotC = frozen ? C_R : (blink ? C_W : C_R);
  const inDot = (x, y) => x >= dotX && x <= dotX + 1 && y >= dotY && y <= dotY + 1;
  let bad = 0, detail = '', nW = 0, nR = 0;
  for (let y = HY0; y < HY0 + HBH; y++) for (let x = HX0; x < HX0 + HBW; x++) {
    const o = (y * 256 + x) * 4;
    if (F.bytes[o] === 252 && F.bytes[o + 1] === 252 && F.bytes[o + 2] === 252) nW++;
    if (F.bytes[o] === 248 && F.bytes[o + 1] === 56 && F.bytes[o + 2] === 56) nR++;
  }
  const expW = dotC === C_W ? 4 : 0;
  if (nW !== expW || nR !== (4 - expW)) { bad++; detail = 'dot W=' + nW + ' R=' + nR + ' blink=' + blink + ' be=' + F.be; }
  for (let sy = 0; sy < 8 && bad < 5; sy++) for (let sx = 0; sx < 8 && bad < 5; sx++) {
    const vis = sy < maxsy && bit(sx, sy);
    for (let dy = 0; dy < 3 && bad < 5; dy++) for (let dx = 0; dx < 5; dx++) {
      const x = HX0 + sx * 6 + dx, y = HY0 + sy * 4 + dy;
      const o = (y * 256 + x) * 4;
      const r = F.bytes[o], g = F.bytes[o + 1], b = F.bytes[o + 2];
      if (inDot(x, y)) {
        if (r !== dotC[0] || g !== dotC[1] || b !== dotC[2]) { bad++; detail = 'dotpx ' + x + ',' + y; }
      } else if (vis) {
        if (r !== 64 || g !== 128 || b !== 232) { bad++; detail = 'fill ' + x + ',' + y + '=' + r + ',' + g + ',' + b; }
      } else {
        if (r !== 5 || g !== 5 || b !== 18) { bad++; detail = 'unvis ' + x + ',' + y + '=' + r + ',' + g + ',' + b; }
      }
      if (bad >= 5) break;
    }
  }
  ok('walk: fills track visits, unvisited dark, dot blink phase', bad === 0, detail);
}
// Staged byte-exact box (fills + notches + border + dot), JS mirror of map_blit.
function expectedBox(F, lv, rows) {
  const maxsy = (rows + 3) >> 2;
  const exp = {};
  const setP = (x, y, c) => { exp[y * 256 + x] = c; };
  for (let x = HX0 - 1; x <= HX0 + HBW; x++) { setP(x, HY0 - 1, C_GR); setP(x, HY0 + HBH, C_GR); }
  for (let y = HY0 - 1; y <= HY0 + HBH; y++) { setP(HX0 - 1, y, C_GR); setP(HX0 + HBW, y, C_GR); }
  for (let y = 0; y < HBH; y++) for (let x = 0; x < HBW; x++) setP(HX0 + x, HY0 + y, C_BG);
  const bit = (sx, sy) => { const q = F.vb[((lv - 1) * 8) + (((sy * 8 + sx) >> 3))]; return (q >> ((sy * 8 + sx) & 7)) & 1; };
  for (let sy = 0; sy < maxsy; sy++) for (let sx = 0; sx < 8; sx++) {
    if (!bit(sx, sy)) continue;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 5; dx++) setP(HX0 + sx * 6 + dx, HY0 + sy * 4 + dy, C_RM);
  }
  for (const s of w.sides) {
    if (s.level !== lv || s.by >= rows) continue;
    const osx = s.bx >> 2, osy = s.by >> 2, ox = s.bx & 3, oy = s.by & 3;
    if (osx < 0 || osx > 7 || osy < 0 || osy >= maxsy) continue;
    if (!bit(osx, osy)) continue;
    const dn = oy, ds = 3 - oy, dw = ox, de = 3 - ox;
    let edge = 0, m = dn;
    if (ds < m) { m = ds; edge = 1; }
    if (dw < m) { m = dw; edge = 2; }
    if (de < m) { m = de; edge = 3; }
    const nx = HX0 + osx * 6, ny = HY0 + osy * 4;
    if (edge === 0) for (let k = 1; k <= 3; k++) setP(nx + k, ny - 1, C_GOLD);
    else if (edge === 1) for (let k = 1; k <= 3; k++) setP(nx + k, ny + 3, C_GOLD);
    else if (edge === 2) for (let k = 0; k <= 2; k++) setP(nx - 1, ny + k, C_GOLD);
    else for (let k = 0; k <= 2; k++) setP(nx + 5, ny + k, C_GOLD);
  }
  const d = decodeCur(F.cur);
  const blink = (F.fno >> 4) & 1;
  const dot = F.be === 0 ? C_R : (blink ? C_W : C_R);
  const cx0 = HX0 + d.sx * 6 + 2, cy0 = HY0 + d.sy * 4 + 1;
  setP(cx0, cy0, dot); setP(cx0 + 1, cy0, dot); setP(cx0, cy0 + 1, dot); setP(cx0 + 1, cy0 + 1, dot);
  return exp;
}
{
  const outS = {};
  const RS = await drive({ span: 500, rec: false, taps: [{ at: 61, pad: 8 }], frames: [410], out: outS,
    onFrame: (ex, f) => {
      if (f === 200) ex.bm_enhanced_set(1);
      if (f === 300) ex.bm_warp_raw(9);
      if (f === 400) {
        const cells = [[4, 4], [1, 5], [1, 6], [7, 0], [4, 2], [5, 3], [2, 1]];
        for (const c of cells) ex.bm_visit_set(2, c[0], c[1], 1);
      }
    } });
  let bad = 0, first = '';
  if (!RS.trap && outS[410]) {
    const F = outS[410];
    const d = decodeCur(F.cur);
    const exp = expectedBox(F, d.lv, mm.levels[d.lv].rows);
    for (const k of Object.keys(exp)) {
      const o = k * 4, e = exp[k];
      if (F.bytes[o] !== e[0] || F.bytes[o + 1] !== e[1] || F.bytes[o + 2] !== e[2]) { bad++; if (first === '') first = 'k' + k + ' got=' + F.bytes[o] + ',' + F.bytes[o + 1] + ',' + F.bytes[o + 2] + ' exp=' + e.join(','); }
    }
    if (Object.keys(exp).length !== 1700) { bad++; first = 'expkeys=' + Object.keys(exp).length; }
  } else { bad++; first = RS.trap || 'no frame'; }
  ok('staged byte-exact box (fills+notches+border+dot)', bad === 0, 'bad=' + bad + ' ' + first);
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
// E8-M6: modal font pin (regression for the garbled-text bug: render must
// use the E0 font page for modal NT, which menu_draw clears to text-only).
// Real boot, E2 menu open: NT bytes are ASCII AND the pixels match the
// staged font tile bits exactly (white 252 on black 0, palhi 0).
{
  const outM = {};
  const RM = await drive({ span: 400, rec: false, taps: [{ at: 120, pad: 8 }], frames: [250], out: outM,
    onFrame: (ex, f) => { if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); } } });
  const mm = new Uint8Array(RM.ex.memory.buffer);
  const sb = Array.from(mm.slice(RM.ex.bm_savestate_ptr(), RM.ex.bm_savestate_ptr() + RM.ex.bm_savestate_len()));
  const ntAt = (r, c) => sb[2428 + r * 32 + c];
  const hdrOk = (() => { let s = ''; for (let c = 0; c < 32; c++) { const b = ntAt(4, c); s += (b === 0 ? ' ' : String.fromCharCode(b)); } return s.indexOf('BLASTER MASTER') >= 0; })();
  const flat = [];
  for (const bb of stock.chr) for (let i = 0; i < bb.length; i++) flat.push(bb[i]);
  const F = outM[250].bytes;
  const spots = [[4, 9, 66], [4, 10, 76], [8, 9, 1]];
  let pxBad = 0, pxChecked = 0, pxFirst = '', ntOk = true;
  for (const sp of spots) {
    const r = sp[0], c = sp[1], want = sp[2];
    if (ntAt(r, c) !== want) { ntOk = false; pxFirst += 'nt' + r + 'x' + c + '=' + ntAt(r, c) + ' '; continue; }
    const t = want;
    for (let pr = 0; pr < 8; pr++) for (let pc = 0; pc < 8; pc++) {
      const lo = flat[7 * 4096 + t * 16 + pr], hi = flat[7 * 4096 + t * 16 + 8 + pr];
      const bit = ((lo >> (7 - pc)) & 1) | (((hi >> (7 - pc)) & 1) << 1);
      const o = ((r * 8 + pr) * 256 + (c * 8 + pc)) * 4;
      const er = bit ? 252 : 0, eg = bit ? 252 : 0, eb = bit ? 252 : 0;
      pxChecked++;
      if (F[o] !== er || F[o + 1] !== eg || F[o + 2] !== eb) { pxBad++; if (!pxFirst) pxFirst = 't' + t + ' px' + pr + ',' + pc + ' got=' + F[o] + ',' + F[o + 1] + ',' + F[o + 2] + ' exp=' + er + ',' + eg + ',' + eb; }
    }
  }
  ok('E2 menu open in real boot (header + NT bytes)', !RM.trap && hdrOk && ntOk, RM.trap || pxFirst);
  ok('E2 menu pixels match font tiles exactly', !RM.trap && pxBad === 0 && pxChecked === 192, 'bad=' + pxBad + ' checked=' + pxChecked + ' ' + pxFirst);
}
// E8-M5: minimap HUD toggle (default on; off == enhanced-off video exactly).
{
  const onF = (ex, f) => { if (f === 200) ex.bm_enhanced_set(1); if (f === 300) ex.bm_warp_raw(9); if (f >= 400 && f < 1200) ex.bm_set_pad(128); };
  const offF = (ex, f) => { onF(ex, f); if (f === 500) ex.bm_map_show_set(0); };
  const D0 = await bootOnly(); loadPack(D0);
  ok('map_show default on at boot', D0.bm_map_show_get() === 1, 'got=' + D0.bm_map_show_get());
  D0.bm_map_show_set(0);
  const g0 = D0.bm_map_show_get() === 0; D0.bm_map_show_set(1);
  ok('map_show set/get round-trip', g0 && D0.bm_map_show_get() === 1, '');
  const outOn = {}, outOff = {};
  const RN = await drive({ span: 1300, rec: true, taps: WALK, frames: [900], out: outOn, onFrame: onF });
  const RF = await drive({ span: 1300, rec: true, taps: WALK, frames: [900], out: outOff, onFrame: offF });
  let sameOffA = true, diffOnOff = 0, outRect = true;
  if (!RN.trap && !RF.trap && outOn[900] && outOff[900] && outA[900]) {
    const a = outA[900].bytes, b = outOn[900].bytes, c = outOff[900].bytes;
    for (let y = 0; y < 240 && sameOffA; y++) for (let x = 0; x < 256; x++) {
      const o = (y * 256 + x) * 4;
      if (c[o] !== a[o] || c[o + 1] !== a[o + 1] || c[o + 2] !== a[o + 2]) { sameOffA = false; break; }
    }
    for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) {
      const o = (y * 256 + x) * 4;
      if (b[o] !== c[o] || b[o + 1] !== c[o + 1] || b[o + 2] !== c[o + 2]) {
        diffOnOff++;
        if (x < 203 || x > 252 || y < 3 || y > 36) outRect = false;
      }
    }
  } else { sameOffA = false; }
  ok('map off == enhanced-off video (suppression complete)', !RN.trap && !RF.trap && sameOffA, RN.trap || RF.trap);
  ok('map on/off diff confined to HUD rect + non-empty', !RN.trap && !RF.trap && outRect && diffOnOff > 500, 'diff=' + diffOnOff + ' rect=' + outRect);
  const K1 = await drive({ span: 1300, rec: true, taps: WALK, onFrame: offF });
  const K2 = await drive({ span: 1300, rec: true, taps: WALK, onFrame: offF });
  let bad = 0;
  for (let i = 0; i < K1.rec.length; i++) if (!K1.rec[i] || !K2.rec[i] || K1.rec[i].vb !== K2.rec[i].vb) bad++;
  ok('map-off determinism x2', !K1.trap && !K2.trap && K1.rec.length > 50 && bad === 0, (K1.trap || K2.trap) || ('bad=' + bad));
  const enh2 = readFileSync(PROJ + '/frontend/src/ui/enhance.js', 'utf8');
  const has2 = (s) => enh2.indexOf(s) >= 0;
  ok('shell: map toggle wired (persist/show/status)', has2('MAP_KEY') && has2('bm_map_show_set') && has2('show minimap') && has2('mapStat'), '');
}
{
  const enh = readFileSync(PROJ + '/frontend/src/ui/enhance.js', 'utf8');
  const has = (s) => enh.indexOf(s) >= 0;
  ok('shell: overlay gone, sync kept, invalidate wired', !has('mapHud') && !has('drawMap') && !has('paintMap') && has('syncVisits(') && has('bm_map_invalidate'), '');
}
console.log('---- E8M3: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
