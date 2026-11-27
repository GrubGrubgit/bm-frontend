// E8-M4 pause full-map (engine-side, abstract room grid matching the E8-M3 HUD
// minimap): E3 MAP row -> phase 4, centered 12x8 grid, visited fills, dark
// unvisited (never pre-revealed), gold intra-level door notches / white
// cross-area entrance notches on visited-room borders, cyan breakable-cell
// borders, frozen-red player dot while paused, visit-gated level cycling
// (skips unentered levels, current always selectable) + vram legend.
// Run: node tools/verify-map-e8m4.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { buildWorld, AREA_LEVEL } from '../src/pack/world.js';
import { buildMinimap } from '../src/pack/minimap.js';
import { parseBank } from '../src/pack/levels.js';
import { parseDoors, pairOf } from '../src/pack/doors.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
ok('stock pack builds', !!stock);
// JS twin: breakable blocks (tank lv<=8, any combo attr bit7+bit6).
function jsBrk(pack) {
  const out = {};
  for (let b = 0; b < 3; b++) {
    const P = parseBank(pack.prg[b], b);
    for (const L of P.levels) {
      const bits = new Uint8Array(128);
      let n = 0;
      for (let bi = 0; bi < L.map.length; bi++) {
        let blk = L.map[bi];
        if (blk < 0 || blk * 4 + 3 >= L.blocks.length) blk = 0;
        let brk = false;
        for (let q = 0; q < 4 && !brk; q++) {
          const si = L.blocks[blk * 4 + q];
          for (let k = 0; k < 4; k++) {
            const ci = L.structs[si * 4 + k];
            if (L.level <= 8 && (L.attrs[ci] & 0xC0) === 0xC0) { brk = true; break; }
          }
        }
        if (brk) { bits[bi >> 3] |= (1 << (bi & 7)); n++; }
      }
      out[L.level] = { bits, count: n, rows: L.map.length / 32 };
    }
  }
  return out;
}
function jsHash(bits, rows) {
  let h = 2166136261;
  for (let i = 0; i < 128; i++) { h ^= bits[i]; h = Math.imul(h, 16777219); }
  h ^= rows; h = Math.imul(h, 16777219);
  return (h >>> 0) & 0x7FFFFFFF;
}
function jsEnt(pack) {
  const pd = parseDoors(pack.prg[7]);
  const per = {};
  for (let i = 0; i < pd.rows.length; i++) {
    const j = i ^ 1;
    const ai = pd.rows[i].area & 15, aj = pd.rows[j].area & 15;
    const li = ai < 8 ? ai + 9 : ai - 7, lj = aj < 8 ? aj + 9 : aj - 7;
    if ((li <= 8) !== (lj <= 8)) per[li] = (per[li] || 0) + 1;
  }
  return per;
}
const PIN_BRK = { 1: 3, 2: 9, 3: 4, 4: 0, 5: 6, 6: 44, 7: 113, 8: 20, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0, 14: 0, 15: 0, 16: 0 };
const PIN_ENT = { 1: 5, 2: 4, 3: 5, 4: 4, 5: 5, 6: 4, 7: 5, 8: 5, 9: 5, 10: 4, 11: 5, 12: 4, 13: 5, 14: 4, 15: 5, 16: 5 };
const JB = jsBrk(stock), JE = jsEnt(stock);
{
  let bad = '';
  for (let lv = 1; lv <= 16; lv++) if (JB[lv].count !== PIN_BRK[lv]) bad += lv + '=' + JB[lv].count + ' ';
  ok('breakable blocks match pinned (3/9/4/0/6/44/113/20, overhead 0)', bad === '', bad);
}
{
  let bad = '', tot = 0;
  for (let lv = 1; lv <= 16; lv++) { const v = JE[lv] || 0; tot += v; if (v !== PIN_ENT[lv]) bad += lv + '=' + v + ' '; }
  ok('cross-area entrance sides match pinned (74 total)', bad === '' && tot === 74, bad + 'tot=' + tot);
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
  let bc = true, bh = true, ec = true, bd = '';
  for (let lv = 1; lv <= 16; lv++) {
    if (ex.bm_map_brkcnt(lv) !== JB[lv].count) { bc = false; bd += lv + '(c=' + ex.bm_map_brkcnt(lv) + ',js=' + JB[lv].count + ') '; }
    if (ex.bm_map_brkhash(lv) !== jsHash(JB[lv].bits, JB[lv].rows)) { bh = false; bd += lv + ':hash '; }
    if (ex.bm_map_entcnt(lv) !== (JE[lv] || 0)) { ec = false; bd += lv + ':ent '; }
  }
  ok('C brkcnt 16/16 match JS', bc, bd);
  ok('C brkhash 16/16 match JS (pins bit layout)', bh, bd);
  ok('C entcnt 16/16 match JS', ec, bd);
  ok('bad args -1', ex.bm_map_brkcnt(0) === -1 && ex.bm_map_brkcnt(17) === -1 && ex.bm_map_brkhash(0) === -1 && ex.bm_map_entcnt(17) === -1, '');
}
function fnv(bytes) { let h = 2166136261; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777219); } return h >>> 0; }
// Full-map geometry (must match bm_api.c FM_X0/FM_CW/FM_CH + Y0 rule).
const FM_X0 = 80, FM_CW = 12, FM_CH = 8;
const fmY0 = (maxsy) => ((140 - maxsy * FM_CH) / 2) | 0;
// L1 door cells to mark visited pre-drive (block coords from world sides).
const w0 = buildWorld(stock);
const doorCellsL1 = [];
for (const s of w0.sides) {
  if (s.level !== 1 || s.by >= 32) continue;
  const cx = s.bx >> 2, cy = s.by >> 2;
  if (cy >= 8) continue;
  if (!doorCellsL1.some((c) => c[0] === cx && c[1] === cy)) doorCellsL1.push([cx, cy]);
}
function markAll(ex, f) {
  if (f === 700) ex.bm_enhanced_set(1);
  if (f === 1100) {
    for (const c of doorCellsL1) ex.bm_visit_set(1, c[0], c[1], 1);
    ex.bm_visit_set(2, 1, 1, 1);
    ex.bm_visit_set(3, 2, 2, 1);
  }
}
async function drive(o) {
  const rec = {};
  const out = {};
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
      rec[n] = { f: n, cur: ex.bm_visit_cur(), vis: ex.bm_map_visible(), dbg: ex.bm_pmenu_dbg(), mylv: ex.bm_map_mylv(), vb: fnv(mem.slice(vp, vp + 256 * 240 * 4)) };
    }
    if (o.frames && o.frames.indexOf(n) >= 0) {
      const mem = new Uint8Array(ex.memory.buffer);
      const vp = ex.bm_video_ptr();
      out[n] = { f: n, fno: ex.bm_frame_no(), be: ex.bm_ram_rd(0xBE), cur: ex.bm_visit_cur(), vis: ex.bm_map_visible(), dbg: ex.bm_pmenu_dbg(), mylv: ex.bm_map_mylv(),
        bytes: Array.from(mem.slice(vp, vp + 256 * 240 * 4)),
        blob: Array.from(mem.slice(ex.bm_savestate_ptr(), ex.bm_savestate_ptr() + ex.bm_savestate_len())) };
    }
    if (n >= o.span) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    loadPack(win.exports);
    win.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  return { ex: win.exports, trap, rec, out };
}
const rowText = (blob, r) => {
  let s = '';
  for (let c = 0; c < 32; c++) { const b = blob[2428 + r * 32 + c]; s += (b === 0 ? ' ' : String.fromCharCode(b)); }
  return s;
};
const findRow = (blob, t) => { for (let r = 0; r < 30; r++) if (rowText(blob, r).indexOf(t) >= 0) return r; return -1; };
const WALK = [{ at: 61, pad: 8 }];
const OPEN = WALK.concat([{ at: 1200, pad: 8 }, { at: 1300, pad: 4 }, { at: 1350, pad: 32 }, { at: 1400, pad: 1 }]);
{
  const R = await drive({ span: 1600, rec: true, taps: OPEN, frames: [1340, 1450], out: {}, onFrame: markAll });
  const M = R.out[1340], F = R.out[1450];
  ok('open clean + menu rows (CONTINUE 8 MAP 10 SETTINGS 12 QUIT 14)', !R.trap && findRow(M.blob, 'CONTINUE') === 8 && findRow(M.blob, 'MAP') === 10 && findRow(M.blob, 'SETTINGS') === 12 && findRow(M.blob, 'QUIT') === 14 && findRow(M.blob, 'LOAD') < 0, R.trap);
  ok('A on MAP opens phase 4 mylv==L1', !R.trap && ((F.dbg & 255) === 4) && F.mylv === 1, R.trap || ('dbg=' + (F && F.dbg) + ' mylv=' + (F && F.mylv)));
  ok('HUD hidden in MAP (vis 0)', !R.trap && F.vis === 0, R.trap || ('vis=' + (F && F.vis)));
  ok('legend rows (MAP L/DUNGEON/GOLD/WHITE/CYAN/DARK/DOT/LEVEL/BACK)', !R.trap && findRow(F.blob, 'MAP L') === 18 && findRow(F.blob, 'DUNGEON') === 18 && findRow(F.blob, 'GOLD DOOR') === 19 && findRow(F.blob, 'WHITE ENTRANCE') === 20 && findRow(F.blob, 'CYAN BREAKABLE') === 21 && findRow(F.blob, 'DARK UNSEEN') === 22 && findRow(F.blob, 'DOT YOU') === 23 && findRow(F.blob, 'LEFT RIGHT LEVEL') === 24 && findRow(F.blob, 'B BACK') === 25, R.trap);
}
{
  const R = await drive({ span: 1600, rec: true, taps: OPEN, frames: [1450], out: {}, onFrame: markAll });
  const F = R.out[1450];
  const px = (x, y) => { const o = (y * 256 + x) * 4; return [F.bytes[o], F.bytes[o + 1], F.bytes[o + 2]]; };
  const isGray = (p) => p[0] === 117 && p[1] === 117 && p[2] === 117;
  // L1: rows=32 maxsy=8 Y0=38. Border: x 79/176, y 37/102.
  ok('map border gray (top/bottom/left/right)', !R.trap && isGray(px(100, 37)) && isGray(px(100, 102)) && isGray(px(79, 50)) && isGray(px(176, 50)) && isGray(px(176, 37)), R.trap);
  const w = buildWorld(stock);
  const cur = F.cur;
  const dc = cur >= 0 ? { lv: ((cur / 64) | 0) + 1, sx: (cur % 64) % 8, sy: (((cur % 64) / 8) | 0) } : null;
  const brkSet = new Set();
  { const bits = JB[1].bits; for (let bi = 0; bi < 1024; bi++) if ((bits[bi >> 3] >> (bi & 7)) & 1) brkSet.add(bi); }
  const Y0 = fmY0(8);
  const notchXY = (s) => {
    const osx = s.bx >> 2, osy = s.by >> 2, ox = s.bx & 3, oy = s.by & 3;
    const dn = oy, ds = 3 - oy, dw = ox, de = 3 - ox;
    let edge = 0, m = dn;
    if (ds < m) { m = ds; edge = 1; }
    if (dw < m) { m = dw; edge = 2; }
    if (de < m) { m = de; edge = 3; }
    const nx = FM_X0 + osx * FM_CW, ny = Y0 + osy * FM_CH;
    if (edge === 0) return [nx + 4, ny - 1, nx + 7, ny - 1];
    if (edge === 1) return [nx + 4, ny + FM_CH - 1, nx + 7, ny + FM_CH - 1];
    if (edge === 2) return [nx - 1, ny + 2, nx - 1, ny + 5];
    return [nx + FM_CW, ny + 2, nx + FM_CW, ny + 5];
  };
  let doorPick = null;
  for (const s of w.sides) {
    if (s.level !== 1 || s.by >= 32) continue;
    if (dc && (s.bx >> 2) === dc.sx && (s.by >> 2) === dc.sy) continue;
    if (brkSet.has(s.by * 32 + s.bx)) continue;
    const t = w.sides[s.pair];
    const cross = (s.level <= 8) !== (t.level <= 8);
    if (!doorPick) doorPick = { s, cross };
  }
  let doorOk = false, doorDetail = 'none';
  if (doorPick) {
    const q = notchXY(doorPick.s);
    const exp = doorPick.cross ? [252, 252, 252] : [248, 184, 0];
    const p1 = px(q[0], q[1]), p2 = px(q[2], q[3]);
    doorOk = p1[0] === exp[0] && p1[1] === exp[1] && p1[2] === exp[2] && p2[0] === exp[0] && p2[1] === exp[1] && p2[2] === exp[2];
    doorDetail = (doorPick.cross ? 'white' : 'gold') + ' (' + q[0] + ',' + q[1] + ')=' + p1.join(',') + ' (' + q[2] + ',' + q[3] + ')=' + p2.join(',');
  }
  ok('door notch color (gold intra / white entrance)', !R.trap && doorOk, R.trap || doorDetail);
  const doorSet = new Set(w.sides.filter((s) => s.level === 1).map((s) => s.by * 32 + s.bx));
  let brkPick = null;
  for (let bi = 0; bi < 1024; bi++) {
    if (!brkSet.has(bi) || doorSet.has(bi)) continue;
    const sx = bi % 32, sy = (bi / 32) | 0;
    if (dc && (sx >> 2) === dc.sx && (sy >> 2) === dc.sy) continue;
    brkPick = bi; break;
  }
  let brkOk = false, brkDetail = 'none';
  if (brkPick !== null) {
    const cx0 = FM_X0 + ((brkPick % 32) >> 2) * FM_CW, cy0 = Y0 + (((brkPick / 32) | 0) >> 2) * FM_CH;
    const a = px(cx0 + 2, cy0), b = px(cx0 + 9, cy0 + FM_CH - 1);
    brkOk = a[0] === 0 && a[1] === 232 && a[2] === 216 && b[0] === 0 && b[1] === 232 && b[2] === 216;
    brkDetail = 'bi' + brkPick + ' a=' + a.join(',') + ' b=' + b.join(',');
  }
  ok('breakable cell border cyan', !R.trap && brkOk, R.trap || brkDetail);
  // Unvisited cell stays dark: first L1 cell with no door, no brk, not current.
  let fogOk = false, fogDetail = 'none';
  {
    const occ = new Set(doorSet);
    for (const b of brkSet) occ.add((((b / 32) | 0) >> 2) * 8 + ((b % 32) >> 2));
    let pick = null;
    for (let cy = 0; cy < 8 && !pick; cy++) for (let cx = 0; cx < 8 && !pick; cx++) {
      if (occ.has(cy * 8 + cx)) continue;
      if (dc && cx === dc.sx && cy === dc.sy) continue;
      pick = [cx, cy];
    }
    if (pick) {
      const c = px(FM_X0 + pick[0] * FM_CW + 6, Y0 + pick[1] * FM_CH + 4);
      fogOk = c[0] === 5 && c[1] === 5 && c[2] === 18;
      fogDetail = 'cell' + pick.join(',') + ' c=' + c.join(',');
    }
  }
  ok('unvisited cell stays dark (fog, never pre-revealed)', !R.trap && fogOk, R.trap || fogDetail);
  // Visited fill: door cell center shows room fill.
  let fillOk = false, fillDetail = 'none';
  if (doorPick) {
    const c = px(FM_X0 + ((doorPick.s.bx >> 2)) * FM_CW + 6, Y0 + ((doorPick.s.by >> 2)) * FM_CH + 4);
    fillOk = c[0] === 64 && c[1] === 128 && c[2] === 232;
    fillDetail = 'c=' + c.join(',');
  }
  ok('visited cell shows room fill', !R.trap && fillOk, R.trap || fillDetail);
  let dotOk = false, dotDetail = 'none';
  if (dc && dc.lv === 1) {
    const cx = FM_X0 + dc.sx * FM_CW + 4, cy = Y0 + dc.sy * FM_CH + 2;
    const c = px(cx + 1, cy + 1);
    const blink = (F.be === 0) ? 0 : ((F.fno >> 4) & 1);
    const exp = blink ? [252, 252, 252] : [248, 56, 56];
    dotOk = c[0] === exp[0] && c[1] === exp[1] && c[2] === exp[2];
    dotDetail = 'cx' + cx + ' cy' + cy + ' be=' + F.be + ' fno=' + F.fno + ' c=' + c.join(',');
  }
  ok('player dot 4x4 (BE-aware frozen/blink)', !R.trap && dotOk, R.trap || dotDetail);
  const G = R.out;
  const M2 = (await drive({ span: 1450, rec: false, taps: OPEN.slice(0, 3), frames: [1340], out: {}, onFrame: markAll })).out[1340];
  let cornerSame = true;
  for (const [x, y] of [[0, 0], [255, 0], [0, 239], [255, 239]]) {
    const o = (y * 256 + x) * 4;
    if (F.bytes[o] !== M2.bytes[o] || F.bytes[o + 1] !== M2.bytes[o + 1] || F.bytes[o + 2] !== M2.bytes[o + 2]) cornerSame = false;
  }
  let inside = 0;
  for (let y = 38; y <= 102; y++) for (let x = 80; x <= 176; x++) {
    const o = (y * 256 + x) * 4;
    if (F.bytes[o] !== M2.bytes[o] || F.bytes[o + 1] !== M2.bytes[o + 1] || F.bytes[o + 2] !== M2.bytes[o + 2]) inside++;
  }
  ok('corners untouched + interior differs (map drawn)', !R.trap && cornerSame && inside > 1000, R.trap || ('inside=' + inside));
}
{
  // Visit-gated cycling: only L1 (current) + L2 + L3 marked. Right 1->2->3->1
  // (wrap skips 4..16), Up 1->3 (wrap skips 16..4), Left 3->2->1, Right 1->2...
  // taps: Right,Right,Up,Left,Left,Right then B, A.
  const CYC = OPEN.concat([{ at: 1500, pad: 128 }, { at: 1540, pad: 128 }, { at: 1580, pad: 16 }, { at: 1620, pad: 64 }, { at: 1660, pad: 64 }, { at: 1700, pad: 128 }, { at: 1740, pad: 2 }, { at: 1780, pad: 1 }]);
  const R = await drive({ span: 1920, rec: true, taps: CYC, frames: [1520, 1560, 1600, 1640, 1680, 1720, 1780, 1840], out: {}, onFrame: markAll });
  const g = (f) => (R.out[f] ? R.out[f].mylv : -99);
  const ph = (f) => (R.out[f] ? R.out[f].dbg & 255 : -99);
  const cu = (f) => (R.out[f] ? (R.out[f].dbg >> 8) & 255 : -99);
  ok('cycle Right 1->2->3, Up 3->2', !R.trap && g(1520) === 2 && g(1560) === 3 && g(1600) === 2, R.trap || ([1520, 1560, 1600].map((f) => f + '=' + g(f)).join(' ')));
  ok('Left 2->1, Left wraps 1->3 skipping unentered, Right wraps 3->1', !R.trap && g(1640) === 1 && g(1680) === 3 && g(1720) === 1, R.trap || ([1640, 1680, 1720].map((f) => f + '=' + g(f)).join(' ')));
  ok('B back to main cursor MAP + A reopens', !R.trap && ph(1780) === 1 && cu(1780) === 1 && ph(1840) === 4, R.trap || ('1780 ph=' + ph(1780) + ' cu=' + cu(1780) + ' 1840 ph=' + ph(1840)));
}
{
  const mk = () => drive({ span: 1600, rec: true, taps: OPEN, onFrame: markAll, frames: [] });
  const K1 = await mk(), K2 = await mk();
  let bad = 0;
  for (const k of Object.keys(K1.rec)) if (!K2.rec[k] || K1.rec[k].vb !== K2.rec[k].vb) bad++;
  ok('determinism x2 incl MAP pixels', !K1.trap && !K2.trap && bad === 0, (K1.trap || K2.trap) || ('bad=' + bad));
}
{
  const R = await drive({ span: 1400, rec: false, taps: WALK.concat([{ at: 1200, pad: 8 }, { at: 1300, pad: 4 }]), frames: [1340], out: {}, onFrame: (ex, f) => {} });
  const M = R.out[1340];
  ok('enhanced-off: no menu, no MAP', !R.trap && ((M.dbg & 255) === 0) && findRow(M.blob, 'MAP') < 0, R.trap);
}
{
  const enh = readFileSync(PROJ + '/frontend/src/ui/enhance.js', 'utf8');
  const has = (s) => enh.indexOf(s) >= 0;
  ok('shell: overlay gone, sync kept, invalidate wired', !has('mapHud') && !has('drawMap') && !has('paintMap') && has('syncVisits(') && has('bm_map_invalidate'), '');
  const e3 = readFileSync(PROJ + '/frontend/tools/verify-pause-e3.mjs', 'utf8');
  ok('E3 suite updated for MAP row', e3.indexOf('MAP') >= 0, 'no MAP');
}
{
  // Pause SETTINGS MAP row toggles the HUD minimap live (Left/Right/A-row).
  const seen = {};
  const R = await drive({ span: 1900, rec: false,
    taps: WALK.concat([{ at: 1200, pad: 8 }, { at: 1300, pad: 4 }, { at: 1350, pad: 32 }, { at: 1400, pad: 32 }, { at: 1450, pad: 1 }, { at: 1500, pad: 32 }, { at: 1540, pad: 32 }, { at: 1580, pad: 32 }, { at: 1620, pad: 32 }, { at: 1660, pad: 128 }, { at: 1700, pad: 64 }, { at: 1740, pad: 2 }]),
    frames: [1490, 1780], out: {},
    onFrame: (ex, f) => {
      markAll(ex, f);
      if (f === 1300) seen.m0 = ex.bm_map_show_get();
      if (f === 1690) seen.m1 = ex.bm_map_show_get();
      if (f === 1730) seen.m2 = ex.bm_map_show_get();
    } });
  const S = R.out[1490], Back = R.out[1780];
  ok('SETTINGS shows MAP row at 16 + BACK moved to 18', !R.trap && findRow(S.blob, 'SETTINGS') === 4 && findRow(S.blob, 'MAP ') === 16 && rowText(S.blob, 16).indexOf('BACK') < 0 && rowText(S.blob, 18).indexOf('BACK') >= 0, R.trap);
  ok('MAP row Right toggles minimap flag', !R.trap && seen.m1 === (seen.m0 ? 0 : 1), R.trap || ('m0=' + seen.m0 + ' m1=' + seen.m1));
  ok('MAP row Left toggles back + B returns to pause main', !R.trap && seen.m2 === seen.m0 && findRow(Back.blob, 'PAUSED') === 4, R.trap || ('m2=' + seen.m2 + ' m0=' + seen.m0));
}
console.log('---- E8M4: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
