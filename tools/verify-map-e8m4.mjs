// E8-M4 pause full-map (engine-side): E3 MAP row -> phase 4, 2x full-level map
// + symbols (gold doors, white cross-area entrances, cyan breakable borders,
// player dot) + fog + vram legend. Run: node tools/verify-map-e8m4.mjs
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
      out[n] = { f: n, cur: ex.bm_visit_cur(), vis: ex.bm_map_visible(), dbg: ex.bm_pmenu_dbg(), mylv: ex.bm_map_mylv(),
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
function enhOff(ex, f) { if (f === 700) ex.bm_enhanced_set(1); }
{
  const R = await drive({ span: 1600, rec: true, taps: OPEN, frames: [1340, 1450], out: {}, onFrame: enhOff });
  const M = R.out[1340], F = R.out[1450];
  ok('open clean + menu rows (CONTINUE 8 MAP 10 SETTINGS 12 QUIT 14)', !R.trap && findRow(M.blob, 'CONTINUE') === 8 && findRow(M.blob, 'MAP') === 10 && findRow(M.blob, 'SETTINGS') === 12 && findRow(M.blob, 'QUIT') === 14 && findRow(M.blob, 'LOAD') < 0, R.trap);
  ok('A on MAP opens phase 4 mylv==L1', !R.trap && ((F.dbg & 255) === 4) && F.mylv === 1, R.trap || ('dbg=' + (F && F.dbg) + ' mylv=' + (F && F.mylv)));
  ok('HUD hidden in MAP (vis 0)', !R.trap && F.vis === 0, R.trap || ('vis=' + (F && F.vis)));
  ok('legend rows (MAP L/DUNGEON/GOLD/WHITE/CYAN/DARK/DOT/LEVEL/BACK)', !R.trap && findRow(F.blob, 'MAP L') === 18 && findRow(F.blob, 'DUNGEON') === 18 && findRow(F.blob, 'GOLD DOOR') === 19 && findRow(F.blob, 'WHITE ENTRANCE') === 20 && findRow(F.blob, 'CYAN BREAKABLE') === 21 && findRow(F.blob, 'DARK UNSEEN') === 22 && findRow(F.blob, 'DOT YOU') === 23 && findRow(F.blob, 'LEFT RIGHT LEVEL') === 24 && findRow(F.blob, 'B BACK') === 25, R.trap);
}
{
  const R = await drive({ span: 1600, rec: true, taps: OPEN, frames: [1450], out: {}, onFrame: enhOff });
  const F = R.out[1450];
  const px = (x, y) => { const o = (y * 256 + x) * 4; return [F.bytes[o], F.bytes[o + 1], F.bytes[o + 2]]; };
  const isGray = (p) => p[0] === 117 && p[1] === 117 && p[2] === 117;
  ok('map border gray (top/bottom/left/right)', !R.trap && isGray(px(100, 7)) && isGray(px(100, 136)) && isGray(px(63, 50)) && isGray(px(192, 50)) && isGray(px(192, 7)), R.trap);
  const w = buildWorld(stock);
  const cur = F.cur;
  const dc = cur >= 0 ? { lv: ((cur / 64) | 0) + 1, sx: (cur % 64) % 8, sy: (((cur % 64) / 8) | 0) } : null;
  const brkSet = new Set();
  { const bits = JB[1].bits; for (let bi = 0; bi < 1024; bi++) if ((bits[bi >> 3] >> (bi & 7)) & 1) brkSet.add(bi); }
  const doorSet = new Set(w.sides.filter((s) => s.level === 1).map((s) => s.by * 32 + s.bx));
  let doorPick = null, brkPick = null;
  for (const s of w.sides) {
    if (s.level !== 1 || s.by >= 32) continue;
    if (dc && s.sx === dc.sx && s.sy === dc.sy) continue;
    const t = w.sides[s.pair];
    const cross = (s.level <= 8) !== (t.level <= 8);
    if (!doorPick && !brkSet.has(s.by * 32 + s.bx)) doorPick = { s, cross };
  }
  for (let bi = 0; bi < 1024; bi++) {
    if (!brkSet.has(bi) || doorSet.has(bi)) continue;
    const sx = bi % 32, sy = (bi / 32) | 0;
    if (dc && (sx >> 2) === dc.sx && (sy >> 2) === dc.sy) continue;
    brkPick = bi; break;
  }
  let doorOk = false, doorDetail = 'none';
  if (doorPick) {
    const dx = 64 + doorPick.s.bx * 4, dy = 8 + doorPick.s.by * 4;
    const exp = doorPick.cross ? [252, 252, 252] : [248, 184, 0];
    doorOk = true;
    for (let qy = 1; qy <= 2; qy++) for (let qx = 1; qx <= 2; qx++) {
      const p = px(dx + qx, dy + qy);
      if (p[0] !== exp[0] || p[1] !== exp[1] || p[2] !== exp[2]) { doorOk = false; doorDetail = 'x' + (dx + qx) + ' y' + (dy + qy) + ' got=' + p.join(','); }
    }
    doorDetail = (doorPick.cross ? 'white' : 'gold') + ' bx' + doorPick.s.bx + ' by' + doorPick.s.by + ' ' + doorDetail;
  }
  ok('door tick color (gold intra / white entrance)', !R.trap && doorOk, R.trap || doorDetail);
  let brkOk = false, brkDetail = 'none';
  if (brkPick !== null) {
    const dx = 64 + (brkPick % 32) * 4, dy = 8 + (((brkPick / 32) | 0)) * 4;
    const a = px(dx, dy), b = px(dx + 3, dy);
    brkOk = a[0] === 0 && a[1] === 232 && a[2] === 216 && b[0] === 0 && b[1] === 232 && b[2] === 216;
    brkDetail = 'bi' + brkPick + ' a=' + a.join(',') + ' b=' + b.join(',');
  }
  ok('breakable border cyan', !R.trap && brkOk, R.trap || brkDetail);
  let dotOk = false;
  if (dc && dc.lv === 1) {
    const cx = 64 + dc.sx * 16 + 8, cy = 8 + dc.sy * 16 + 8;
    const c = px(cx, cy), r = px(cx + 2, cy);
    dotOk = c[0] === 252 && c[1] === 252 && c[2] === 252 && r[0] === 167 && r[1] === 0 && r[2] === 0;
    if (!dotOk) dotOk = 'cx' + cx + ' cy' + cy + ' c=' + c.join(',') + ' r=' + r.join(',');
  }
  ok('player dot center white + red rim', !R.trap && dotOk === true, R.trap || dotOk);
  const G = R.out;
  const M2 = (await drive({ span: 1450, rec: false, taps: OPEN.slice(0, 3), frames: [1340], out: {}, onFrame: enhOff })).out[1340];
  let cornerSame = true;
  for (const [x, y] of [[0, 0], [255, 0], [0, 239], [255, 239]]) {
    const o = (y * 256 + x) * 4;
    if (F.bytes[o] !== M2.bytes[o] || F.bytes[o + 1] !== M2.bytes[o + 1] || F.bytes[o + 2] !== M2.bytes[o + 2]) cornerSame = false;
  }
  let inside = 0;
  for (let y = 8; y <= 136; y++) for (let x = 64; x <= 192; x++) {
    const o = (y * 256 + x) * 4;
    if (F.bytes[o] !== M2.bytes[o] || F.bytes[o + 1] !== M2.bytes[o + 1] || F.bytes[o + 2] !== M2.bytes[o + 2]) inside++;
  }
  ok('corners untouched + interior differs (map drawn)', !R.trap && cornerSame && inside > 1000, R.trap || ('inside=' + inside));
}
{
  const CYC = OPEN.concat([{ at: 1500, pad: 128 }, { at: 1540, pad: 128 }, { at: 1580, pad: 16 }, { at: 1620, pad: 64 }, { at: 1660, pad: 64 }, { at: 1700, pad: 128 }, { at: 1740, pad: 2 }, { at: 1780, pad: 1 }]);
  const R = await drive({ span: 1920, rec: true, taps: CYC, frames: [1520, 1560, 1600, 1640, 1680, 1720, 1780, 1840], out: {}, onFrame: enhOff });
  const g = (f) => (R.out[f] ? R.out[f].mylv : -99);
  const ph = (f) => (R.out[f] ? R.out[f].dbg & 255 : -99);
  const cu = (f) => (R.out[f] ? (R.out[f].dbg >> 8) & 255 : -99);
  ok('cycle Right 1->2->3, Up 3->2, Left 2->1', !R.trap && g(1520) === 2 && g(1560) === 3 && g(1600) === 2 && g(1640) === 1, R.trap || ([1520, 1560, 1600, 1640].map((f) => f + '=' + g(f)).join(' ')));
  ok('wrap Left 1->16, Right 16->1', !R.trap && g(1680) === 16 && g(1720) === 1, R.trap || ('1680=' + g(1680) + ' 1720=' + g(1720)));
  ok('B back to main cursor MAP + A reopens', !R.trap && ph(1780) === 1 && cu(1780) === 1 && ph(1840) === 4, R.trap || ('1780 ph=' + ph(1780) + ' cu=' + cu(1780) + ' 1840 ph=' + ph(1840)));
}
{
  const mk = () => drive({ span: 1600, rec: true, taps: OPEN, onFrame: enhOff });
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
console.log('---- E8M4: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
