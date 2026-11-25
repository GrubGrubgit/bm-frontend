// E5: entrance-save prompt (engine-side, supersedes P4 shell detector).
// Run: node tools/verify-entrance-e5.mjs  (from frontend/)
// Up at a doorway opens an in-canvas prompt (SAVE HERE / slot / A SAVE B
// LEAVE / DOWN ENTER); A files an exact-state save into the shared E1
// slots, Down enters the door, B leaves. Pause-while-prompt rides a LEVEL
// Start inject. Detector: 6-frame presnap table overlap + presnap $B7 bit0
// (transit marker; warp-init transients are b7==0) + fresh Up edge or held
// Up + new side key. No BE gate: running, transition and stock-paused
// stands all qualify. All runs single-run (no cross-boot thaw).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { parseDoors, pairOf, findSide } from '../src/pack/doors.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const pd = parseDoors(stock.prg[7]);
ok('parseDoors ok, 108 rows', pd.ok && pd.rows.length === 108, pd.errors.join(' '));
const i9 = findSide(pd.rows, 9, 69, 75);
ok('pair (9,69,75)r1 <-> (8,9,125)r0', i9 === 1 && pd.rows[pairOf(i9)].area === 8 && pd.rows[pairOf(i9)].x === 9 && pd.rows[pairOf(i9)].y === 125, 'i9=' + i9);
const WASMB = readFileSync(process.env.E5WASM || (PROJ + '/frontend/build/game.wasm'));
function fnv(bytes) { let h = 2166136261; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777219); } return h >>> 0; }
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
    if (o.rec) {
      const mem = new Uint8Array(ex.memory.buffer);
      const vp = ex.bm_video_ptr();
      const pp = ex.bm_pre_ptr();
      rec.push({ f: n, dd: ex.bm_ram_rd(0xDD), area: ex.bm_ram_rd(0x14) & 15,
        be: mem[pp + 0xBE], ev5: ex.bm_ev5_dbg(),
        vf: fnv(mem.slice(vp, vp + 256 * 240 * 4)), pf: fnv(mem.slice(pp, pp + 2048)) });
    }
    if (n >= o.span) throw new Error("STOP");
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat2 = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat2(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat2(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== "STOP") trap = String(e.message).slice(0, 80); }
  return { ex: inst.exports, trap: trap, rec: rec };
}
const blobOf = (ex) => {
  const mem = new Uint8Array(ex.memory.buffer);
  return Array.from(mem.slice(ex.bm_savestate_ptr(), ex.bm_savestate_ptr() + ex.bm_savestate_len()));
};
const rowText = (blob, r) => {
  let s = '';
  for (let c = 0; c < 32; c++) { const b = blob[2428 + r * 32 + c]; s += (b === 0 ? " " : String.fromCharCode(b)); }
  return s;
};
const findRow = (blob, t) => { for (let r = 0; r < 30; r++) if (rowText(blob, r).indexOf(t) >= 0) return r; return -1; };
const ENHS = (ex) => { ex.bm_enhanced_set(1); ex.bm_saving_set(1); };
const evPh = (ex) => ex.bm_ev5_dbg() & 255;
const evCur = (ex) => (ex.bm_ev5_dbg() >> 8) & 255;
// common drive: boot, warp_raw(9), Down-entry, Up mid-transit
const ENTRY_TAPS = [{ at: 61, pad: 8 }, { at: 950, pad: 32 }, { at: 958, pad: 32 }, { at: 1000, pad: 16 }];
function entryOn(ex, f) { if (f === 500) ENHS(ex); if (f === 800) ex.bm_warp_raw(9); }
// ---- Run A: pre-prompt gameplay + transit lands ----
{
  const R = await drive({ span: 990, rec: true, taps: [{ at: 61, pad: 8 }, { at: 950, pad: 32 }, { at: 958, pad: 32 }],
    onFrame: (ex, f) => { entryOn(ex, f); } });
  const run = R.rec.filter((r) => r.f >= 936 && r.f <= 948);
  ok('A pre-entry running (DD2 area9 BE1 churn)', !R.trap && run.every((r) => r.be === 1 && r.dd === 2) && run[0].area === 9 && new Set(run.map((r) => r.pf)).size > 3, R.trap);
  ok('A transit lands area8 + BE dip', !R.trap && R.rec[985].area === 8 && R.rec[985].be === 0, R.trap);
}
// ---- Run C: Up mid-transit opens prompt, pause engages on BE 0->1 ----
{
  const blobs = {};
  const R = await drive({ span: 1160, rec: true, taps: ENTRY_TAPS,
    onFrame: (ex, f) => { entryOn(ex, f); if (f === 1140) blobs[f] = blobOf(ex); } });
  ok('C prompt rows SAVE HERE + slot line (post-pause)', !R.trap && findRow(blobs[1140], 'SAVE HERE') === 4 && findRow(blobs[1140], 'SLOT ') === 8 && findRow(blobs[1140], 'A SAVE B LEAVE') === 12 && findRow(blobs[1140], 'DOWN ENTER') === 14, R.trap);
  ok('C phase==1 by f1020 + BE0 mid-transit', !R.trap && ((R.rec[1020].ev5 & 255) === 1) && R.rec[1050].be === 0, R.trap);
  ok('C pause engages on BE 0->1 (BE0 sustained)', !R.trap && R.rec[1100].be === 0 && R.rec[1140].be === 0, R.trap);
}
// ---- Run D: slot cursor nav ----
{
  const R = await drive({ span: 1400, rec: true,
    taps: ENTRY_TAPS.concat([{ at: 1200, pad: 128 }, { at: 1300, pad: 64 }]),
    onFrame: (ex, f) => { entryOn(ex, f); } });
  const c1 = R.rec.find((r) => r.f === 1250), c0 = R.rec.find((r) => r.f === 1350);
  ok('D cursor values track nav', !R.trap && ((c1.ev5 >> 8) & 255) === 1 && ((c0.ev5 >> 8) & 255) === 0, R.trap);
}
// ---- Run E: A-save files slot0 + resume ----
{
  const blobs = {};
  const R = await drive({ span: 1560, rec: true, taps: ENTRY_TAPS.concat([{ at: 1400, pad: 1 }]),
    onFrame: (ex, f) => { entryOn(ex, f); if (f === 1500) blobs[f] = blobOf(ex); } });
  const ex = R.ex;
  ok('E slot0 filed (occ + area8 + crc0 + last0)', !R.trap && ex.bm_sram_info(0, 0) === 1 && ex.bm_sram_info(0, 1) === 8 && ex.bm_sram_info(0, 5) === 0 && ex.bm_sram_last() === 0, R.trap || ('occ=' + ex.bm_sram_info(0, 0) + ' area=' + ex.bm_sram_info(0, 1)));
  ok('E resume running + rows gone', !R.trap && R.rec[1500].be === 1 && findRow(blobs[1500], 'SAVE HERE') < 0, R.trap);
}
// ---- Run F: save perturbs nothing (prompt + B-leave control, same pause edges) ----
{
  const ctrl = await drive({ span: 1600, rec: true, taps: ENTRY_TAPS.concat([{ at: 1400, pad: 2 }]),
    onFrame: (ex, f) => { entryOn(ex, f); } });
  const tst = await drive({ span: 1600, rec: true, taps: ENTRY_TAPS.concat([{ at: 1400, pad: 1 }]),
    onFrame: (ex, f) => { entryOn(ex, f); } });
  let best = -1, bestBad = 1000000;
  for (let off = -20; off <= 20; off++) {
    let bad = 0;
    for (let k = 40; k <= 100; k++) {
      const a = ctrl.rec[1400 + k], b = tst.rec[1400 + off + k];
      if (!a || !b || a.vf !== b.vf || a.pf !== b.pf) bad++;
    }
    if (bad < bestBad) { bestBad = bad; best = off; }
  }
  ok('F save+resume reconverges with control', !ctrl.trap && !tst.trap && bestBad === 0, 'best=' + best + ' bad=' + bestBad);
}
// ---- Run G: B-leave resumes, saves nothing ----
{
  const blobs = {};
  const R = await drive({ span: 1500, rec: true, taps: ENTRY_TAPS.concat([{ at: 1200, pad: 2 }]),
    onFrame: (ex, f) => { entryOn(ex, f); if (f === 1400) blobs[f] = blobOf(ex); } });
  ok('G B-leave resumes running, slot0 empty, rows gone', !R.trap && R.rec[1400].be === 1 && R.ex.bm_sram_info(0, 0) === 0 && findRow(blobs[1400], 'SAVE HERE') < 0, R.trap);
}
// ---- Run H: Down-enter transits 8->9 ----
{
  const R = await drive({ span: 1560, rec: true, taps: ENTRY_TAPS.concat([{ at: 1200, pad: 32 }]),
    onFrame: (ex, f) => { entryOn(ex, f); } });
  const land = R.rec.find((r) => r.f >= 1230 && r.area === 9);
  ok('H Down-enter transits to area9 + running', !R.trap && !!land && R.rec[1500].be === 1 && R.rec[1500].area === 9, R.trap);
}
// ---- Run I: Up with no doorway does nothing ----
{
  const blobs = {};
  const R = await drive({ span: 1400, rec: true, taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 16 }],
    onFrame: (ex, f) => { entryOn(ex, f); if (f === 1300) blobs[f] = blobOf(ex); } });
  ok('I no-door Up: no prompt, still running', !R.trap && findRow(blobs[1300], 'SAVE HERE') < 0 && R.rec[1300].be === 1 && (R.ex.bm_ev5_dbg() & 255) === 0, R.trap);
}
// ---- Run J: enhanced off -> Up at door does nothing ----
{
  const blobs = {};
  const R = await drive({ span: 1200, rec: true, taps: [{ at: 61, pad: 8 }, { at: 950, pad: 32 }, { at: 958, pad: 32 }, { at: 1000, pad: 16 }],
    onFrame: (ex, f) => { if (f === 500) { ex.bm_enhanced_set(1); ex.bm_saving_set(1); } if (f === 800) ex.bm_warp_raw(9); if (f === 900) ex.bm_enhanced_set(0); if (f === 1100) blobs[f] = blobOf(ex); } });
  ok('J enhanced-off: no prompt, transit untouched', !R.trap && findRow(blobs[1100], 'SAVE HERE') < 0 && R.rec[1050].area === 8, R.trap);
}
// ---- Run K: saving off -> Up at door does nothing ----
{
  const blobs = {};
  const R = await drive({ span: 1200, rec: true, taps: [{ at: 61, pad: 8 }, { at: 950, pad: 32 }, { at: 958, pad: 32 }, { at: 1000, pad: 16 }],
    onFrame: (ex, f) => { if (f === 500) { ex.bm_enhanced_set(1); ex.bm_saving_set(1); } if (f === 800) ex.bm_warp_raw(9); if (f === 900) ex.bm_saving_set(0); if (f === 1100) blobs[f] = blobOf(ex); } });
  ok('K saving-off: no prompt, transit untouched', !R.trap && findRow(blobs[1100], 'SAVE HERE') < 0 && R.rec[1050].area === 8, R.trap);
}
// ---- Run L: saved slot roundtrips through the load path ----
{
  const R = await drive({ span: 1900, rec: true, taps: ENTRY_TAPS.concat([{ at: 1400, pad: 1 }, { at: 1750, pad: 8 }]),
    onFrame: (ex, f) => {
      entryOn(ex, f);
      if (f === 1600) { ex.bm_sram_load(0, ex.bm_sram_info(0, 5)); }
    } });
  ok('L slot loads + thaw ok + resumes at doorway area8', !R.trap && R.ex.bm_thaw_result() === 1 && R.rec[1850].area === 8 && R.rec[1850].be === 1, R.trap || ('tres=' + R.ex.bm_thaw_result()));
}
// ---- Run M: determinism x2 ----
{
  const mk = () => drive({ span: 1500, rec: true, taps: ENTRY_TAPS.concat([{ at: 1200, pad: 128 }, { at: 1300, pad: 64 }, { at: 1400, pad: 1 }]),
    onFrame: (ex, f) => { entryOn(ex, f); } });
  const K1 = await mk(), K2 = await mk();
  let bad = 0;
  for (let f = 0; f <= 1500; f++) {
    const a = K1.rec[f], b = K2.rec[f];
    if (!a || !b || a.vf !== b.vf || a.pf !== b.pf || a.be !== b.be || a.ev5 !== b.ev5) bad++;
  }
  ok('M determinism x2 (vf+pf+be+ev5)', !K1.trap && !K2.trap && bad === 0, (K1.trap || K2.trap) || ('bad=' + bad));
}
// ---- Run N: shell shrink statics ----
{
  const enhSrc = readFileSync(PROJ + '/frontend/src/ui/enhance.js', 'utf8');
  ok('N shell has no doorway detector', !/stepDetector|createDetector|resetDetector|matchDoor|parseDoors/.test(enhSrc));
  ok('N shell drives engine slots + IDB store', /bm_sram_info/.test(enhSrc) && /bm_sram_store/.test(enhSrc) && /bm_sram_blob_ptr/.test(enhSrc) && /saveEntrance/.test(enhSrc) && /loadEntrance/.test(enhSrc));
  const apiSrc = readFileSync(PROJ + '/frontend/src/core/bm_api.c', 'utf8');
  ok('N engine E5 section present', /ev5_phase/.test(apiSrc) && /bm_ev5_dbg/.test(apiSrc) && /bm_sram_store/.test(apiSrc));
}
console.log('---- E5: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
