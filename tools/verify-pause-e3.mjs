// E3: in-game pause menu (engine-side, Select while Start-paused -> menu).
// Run: node tools/verify-pause-e3.mjs  (from frontend/)
// All runs are SINGLE-RUN (fresh boot, Start@61, settle to gameplay): the
// suite never thaws a gameplay blob across boots. Cross-boot thaw of a
// running-gameplay blob into a title-destination wedges (pre-existing thaw
// constraint, proven by probes: destination must be booted/running; P4 only
// ever thawed title/transition states or same-run deltas). In-menu LOAD uses
// resume-then-thaw (engine defers sram_load until be==1) which is same-run
// and proven. drive() still counts host_frame invocations (n) so any
// frame_no rewind (LOAD) cannot desync taps/recording.
// Pause model (headless RE): Start toggles Start-pause (video BLINKS 2-cycle,
// b7 latches $04), Select toggles Select-pause (video FROZEN, b7 untouched);
// resume is same-button-only. presnap $BE is 1 while gameplay runs, 0 while
// idle. Cause attribution: nearest Start/Select edge within 100 ticks of the
// presnap-$BE 1->0 flip. CONTINUE resumes via injected stock Start edge;
// QUIT is the in-engine reset; render snap/restore on open/close.
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const WASMB = readFileSync(process.env.E3WASM || (PROJ + '/frontend/build/game.wasm'));
const CRC = 0x12345678;
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
      rec.push({ f: n, dd: ex.bm_ram_rd(0xDD), cont: ex.bm_ram_rd(0x37E), area: ex.bm_ram_rd(0x14) & 15,
        b7: ex.bm_ram_rd(0xB7), be: mem[pp + 0xBE],
        vf: fnv(mem.slice(vp, vp + 256 * 240 * 4)), pf: fnv(mem.slice(pp, pp + 2048)) });
    }
    if (n >= o.span) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat2 = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat2(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat2(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    if (o.pre) o.pre(inst.exports);
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  return { ex: inst.exports, trap: trap, rec: rec };
}
const blobOf = (ex) => {
  const mem = new Uint8Array(ex.memory.buffer);
  return Array.from(mem.slice(ex.bm_savestate_ptr(), ex.bm_savestate_ptr() + ex.bm_savestate_len()));
};
const rowText = (blob, r) => {
  let s = '';
  for (let c = 0; c < 32; c++) { const b = blob[2428 + r * 32 + c]; s += (b === 0 ? ' ' : String.fromCharCode(b)); }
  return s;
};
const findRow = (blob, t) => { for (let r = 0; r < 30; r++) if (rowText(blob, r).indexOf(t) >= 0) return r; return -1; };
const ENH = (ex) => { ex.bm_enhanced_set(1); ex.bm_saving_set(0); };
const ENHS = (ex) => { ex.bm_enhanced_set(1); ex.bm_saving_set(1); };
// ---- Run A: open, nav wrap, settings adjust, back, toggle-close ----
{
  const blobs = {};
  const want = new Set([850, 1340, 1440, 1490, 1540, 1640, 1690, 1760]);
  const R = await drive({ span: 1900, rec: true,
    taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 4 },
      { at: 1400, pad: 16 }, { at: 1450, pad: 32 }, { at: 1500, pad: 32 }, { at: 1550, pad: 1 },
      { at: 1600, pad: 128 }, { at: 1650, pad: 2 }, { at: 1700, pad: 4 }],
    onFrame: (ex, f) => {
      if (f === 700) ENH(ex);
      if (want.has(f)) blobs[f] = blobOf(ex);
    } });
  const run = R.rec.filter((r) => r.f >= 750 && r.f <= 850);
  ok('A gameplay runs pre-pause (DD2 area8 BE1 churn)', !R.trap && run.every((r) => r.be === 1 && r.dd === 2) && new Set(run.map((r) => r.pf)).size > 3, R.trap);
  ok('A gameplay runs unpaused pre-pause (no menu, DD2 BE1)', !R.trap && findRow(blobs[850], 'PAUSED') < 0 && R.rec[850].dd === 2 && R.rec[850].be === 1, R.trap);
  ok('A soak pre-pause running', !R.trap && R.rec[1150].be === 1, R.trap);
  const b = blobs[1340];
  ok('Select while Start-paused opens menu (PAUSED+3 items, no LOAD)', !R.trap && findRow(b, 'PAUSED') === 4 && findRow(b, 'CONTINUE') === 8 && findRow(b, 'SETTINGS') === 10 && findRow(b, 'QUIT') === 12 && findRow(b, 'LOAD') < 0 && b[2428 + 8 * 32 + 9] === 1, R.trap);
  ok('nav Up-wrap 0->2 + Down-wrap 2->0 + step to SETTINGS', !R.trap && blobs[1440][2428 + 12 * 32 + 9] === 1 && blobs[1490][2428 + 8 * 32 + 9] === 1 && blobs[1540][2428 + 10 * 32 + 9] === 1, R.trap);
  ok('SETTINGS submenu adjusts volume 8->9', !R.trap && findRow(blobs[1640], 'SETTINGS') === 4 && R.ex.bm_setting_get(0) === 9, R.trap || ('vol=' + R.ex.bm_setting_get(0)));
  ok('BACK returns to pause main', !R.trap && findRow(blobs[1690], 'PAUSED') === 4, R.trap);
  const tail = R.rec.filter((r) => r.f >= 1750);
  const blink = new Set(R.rec.filter((r) => r.f >= 1210 && r.f <= 1290).map((r) => r.vf));
  ok('Start-pause video blinks (not frozen) + BE0 + B7 latch', !R.trap && blink.size >= 2 && R.rec[1250].be === 0 && (R.rec[1250].b7 & 4) === 4, R.trap || ('vfN=' + blink.size));
  ok('Select toggle-close: menu gone, still paused + frozen-ish BE0', !R.trap && findRow(blobs[1760], 'PAUSED') < 0 && R.rec[1800].be === 0, R.trap);
}
// ---- Run Bdung: dungeon soak + pause + open ----
{
  const walk = [];
  for (let t = 800; t < 950; t += 8) walk.push({ at: t, pad: 128 });
  const blobs = {};
  const R = await drive({ span: 1500, rec: true,
    taps: walk.concat([{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 4 }]),
    onFrame: (ex, f) => {
      if (f === 700) ENH(ex);
      if (f === 700) ex.bm_warp(9);
      if (f === 1400) blobs[1400] = blobOf(ex);
    } });
  const soak = R.rec.filter((r) => r.f >= 1150 && r.f <= 1195);
  ok('dungeon soak runs (DD2 area9, rare lag-dip BE tolerated + churn)', !R.trap && soak.filter((r) => r.be !== 1).length <= 5 && soak.every((r) => r.dd === 2) && soak[0].area === 9 && new Set(soak.map((r) => r.pf)).size > 3, R.trap || ('beBad=' + soak.filter((r) => r.be !== 1).length));
  ok('dungeon Start-pause + Select opens menu (PAUSED, BE0)', !R.trap && findRow(blobs[1400], 'PAUSED') === 4 && R.rec[1400].be === 0, R.trap);
  ok('Bdung still Start-paused at end (B7 latch)', !R.trap && (R.rec[1450].b7 & 4) === 4, R.trap);
}
// ---- Run Btrans: door transit (BE dips mid-transit, gate stays closed) ----
{
  const down = [];
  for (let t = 850; t < 1400; t += 8) down.push({ at: t, pad: 32 });
  const blobs = {};
  const R = await drive({ span: 1500, rec: true, taps: [{ at: 61, pad: 8 }].concat(down),
    onFrame: (ex, f) => {
      if (f === 650) ENH(ex);
      if (f === 700) ex.bm_warp_raw(9);
      if (f === 920 || f === 1200 || f === 1400) blobs[f] = blobOf(ex);
    } });
  let land = -1, b7at = -1;
  for (const r of R.rec) { if (r.f >= 850 && r.area === 8) { land = r.f; b7at = r.b7; break; } }
  const post = R.rec.filter((r) => r.f >= 1000 && r.f <= 1450);
  ok('door transit completes 9->8 with $B7==1 at landing', !R.trap && land > 0 && b7at === 1, R.trap || ('land=' + land + ' b7=' + b7at));
  ok('mid-transit idle (BE0) shows no menu (b7 transit flag guards gate)', !R.trap && findRow(blobs[920], 'PAUSED') < 0 && R.rec[920].be === 0 && (R.rec[920].b7 & ~4) !== 0, R.trap);
  ok('post-transit running (DD2, rare lag-dip BE tolerated + churn, PAUSED never)', !R.trap && post.filter((r) => r.be !== 1).length <= 8 && post.every((r) => r.dd === 2) && new Set(post.map((r) => r.pf)).size > 3 && findRow(blobs[1200], 'PAUSED') < 0 && findRow(blobs[1400], 'PAUSED') < 0, R.trap || ('beBad=' + post.filter((r) => r.be !== 1).length));
}
// ---- Run Btitle: title Select is nothing (pregame gate) ----
{
  const blobs = {};
  const R = await drive({ span: 350, rec: true, taps: [{ at: 200, pad: 4 }],
    onFrame: (ex, f) => {
      if (f === 10) ex.bm_enhanced_set(1);
      if (f === 260) blobs[260] = blobOf(ex);
    } });
  ok('title Select opens nothing (DD stays 0)', !R.trap && findRow(blobs[260], 'PAUSED') < 0 && R.rec[260].dd === 0, R.trap);
}
// ---- Run C: Select-pause model (freeze, b7 clean, same-button resume) ----
{
  const blobs = {};
  const R = await drive({ span: 1620, rec: true, taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 4 }, { at: 1400, pad: 4 }],
    onFrame: (ex, f) => {
      if (f === 700) ENH(ex);
      if (f === 1300) blobs[1300] = blobOf(ex);
    } });
  const frz = R.rec.filter((r) => r.f >= 1260 && r.f <= 1360);
  ok('Select-pause freezes video + presnap-$BE==0, b7 untouched', !R.trap && frz.every((r) => r.vf === frz[0].vf && r.be === 0) && R.rec[1300].b7 === 0 && findRow(blobs[1300], 'PAUSED') < 0, R.trap);
  const mov = new Set(R.rec.filter((r) => r.f >= 1460 && r.f <= 1560).map((r) => r.pf));
  ok('2nd Select resumes Select-pause (churn + $BE==1)', !R.trap && mov.size > 3 && R.rec[1500].be === 1, R.trap || ('pfN=' + mov.size));
}
// ---- Run D1: Start-pause model + Select opens menu (E3 hijack, not stock transient) ----
{
  const blobs = {};
  const D1 = await drive({ span: 1560, rec: true, taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1400, pad: 4 }],
    onFrame: (ex, f) => { if (f === 700) ENH(ex); if (f === 1450) blobs[1450] = blobOf(ex); } });
  const frz = D1.rec.filter((r) => r.f >= 1260 && r.f <= 1340);
  const blink = new Set(frz.map((r) => r.vf));
  ok('Start-pause: $BE 1->0 by +60f, b7 latches $04, video blinks', !D1.trap && D1.rec[1260].be === 0 && (D1.rec[1300].b7 & 4) === 4 && blink.size >= 2, D1.trap || ('vfN=' + blink.size));
  ok('Select-during-Start-pause opens E3 menu (stock transient hijacked)', !D1.trap && findRow(blobs[1450], 'PAUSED') === 4, D1.trap);
}
// ---- Run E: stale-latch attribution corner ----
{
  const blobs = {};
  const R = await drive({ span: 1660, rec: true,
    taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 8 }, { at: 1400, pad: 4 }, { at: 1500, pad: 4 }],
    onFrame: (ex, f) => {
      if (f === 700) ENH(ex);
      if (f === 1260 || f === 1460) blobs[f] = blobOf(ex);
    } });
  const mov1 = new Set(R.rec.filter((r) => r.f >= 1340 && r.f <= 1390).map((r) => r.pf));
  const frz = R.rec.filter((r) => r.f >= 1440 && r.f <= 1490);
  const mov2 = new Set(R.rec.filter((r) => r.f >= 1560 && r.f <= 1620).map((r) => r.pf));
  ok('Start-pause/resume sane + no menu (sanity leg)', !R.trap && mov1.size > 3 && R.rec[1360].be === 1 && findRow(blobs[1260], 'PAUSED') < 0, R.trap);
  ok('Select-pause after prior Start: no menu, 2nd Select resumes (stale-latch immune)', !R.trap && frz.every((r) => r.vf === frz[0].vf && r.be === 0) && findRow(blobs[1460], 'PAUSED') < 0 && mov2.size > 3 && R.rec[1600].be === 1, R.trap || ('pfN=' + mov2.size));
}
// Run F: CONTINUE resumes via stock Start path; matches control at +100f.
{
  const ctrl = await drive({ span: 1600, rec: true, taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1400, pad: 8 }],
    onFrame: (ex, f) => { if (f === 700) ENH(ex); } });
  const blobs = {};
  const tst = await drive({ span: 1600, rec: true,
    taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 4 }, { at: 1400, pad: 8 }],
    onFrame: (ex, f) => {
      if (f === 700) ENH(ex);
      if (f === 1340 || f === 1450) blobs[f] = blobOf(ex);
    } });
  ok('F menu opened before CONTINUE', !tst.trap && findRow(blobs[1340], 'PAUSED') === 4 && findRow(blobs[1340], 'LOAD') < 0, tst.trap);
  ok('F CONTINUE: menu gone running DD2', !tst.trap && findRow(blobs[1450], 'PAUSED') < 0 && tst.rec[1480].be === 1 && tst.rec[1480].dd === 2, tst.trap);
  const mv = new Set(tst.rec.filter((r) => r.f >= 1500 && r.f <= 1560).map((r) => r.pf));
  ok('F post-CONTINUE ram churns', !tst.trap && mv.size > 3, 'pfN=' + mv.size);
  let best = -1, bestBad = 1000000;
  for (let off = -20; off <= 20; off++) {
    let bad = 0;
    for (let k = 40; k <= 100; k++) {
      const a = ctrl.rec[1400 + k], b = tst.rec[1400 + off + k];
      if (!a || !b || a.vf !== b.vf || a.pf !== b.pf) bad++;
    }
    if (bad < bestBad) { bestBad = bad; best = off; }
  }
  ok('F CONTINUE reconverges with stock resume', !ctrl.trap && !tst.trap && bestBad === 0, 'best=' + best + ' bad=' + bestBad);
  ok('F pmenu dbg exports live', typeof tst.ex.bm_pmenu_dbg === 'function' && typeof tst.ex.bm_pmenu_dbg2 === 'function', 'no export');
}
// Run G: toggle-close reconverges EXACTLY with the never-opened control.
{
  const ctrl = await drive({ span: 1600, rec: true, taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }],
    onFrame: (ex, f) => { if (f === 700) ENH(ex); } });
  const blobs = {};
  const tst = await drive({ span: 1600, rec: true,
    taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 4 }, { at: 1400, pad: 4 }],
    onFrame: (ex, f) => {
      if (f === 700) ENH(ex);
      if (f === 1340 || f === 1450) blobs[f] = blobOf(ex);
    } });
  ok('G menu opened then toggle-closed', !tst.trap && findRow(blobs[1340], 'PAUSED') === 4 && findRow(blobs[1450], 'PAUSED') < 0, tst.trap);
  let pfBad = 0, vfBad = 0;
  for (let f = 1300; f <= 1520; f++) { if (ctrl.rec[f].pf !== tst.rec[f].pf) pfBad++; }
  for (let f = 1450; f <= 1530; f++) { if (ctrl.rec[f].vf !== tst.rec[f].vf) vfBad++; }
  ok('G ram untouched by open-close pf x221f', !ctrl.trap && !tst.trap && pfBad === 0, 'bad=' + pfBad);
  ok('G render restored exactly vf x81f', !ctrl.trap && !tst.trap && vfBad === 0, 'bad=' + vfBad);
  ok('G still Start-paused after close', !tst.trap && tst.rec[1500].be === 0, 'be=' + tst.rec[1500].be);
}
// Run H2: LOAD flow with saving on (save slot 0, pause, open, LOAD, confirm).
{
  const blobs = {};
  const R = await drive({ span: 1850, rec: true,
    taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 4 }, { at: 1400, pad: 32 }, { at: 1460, pad: 1 }, { at: 1560, pad: 1 }],
    onFrame: (ex, f) => {
      if (f === 700) ENHS(ex);
      if (f === 1100) ex.bm_sram_save(0, CRC);
      if (f === 1340 || f === 1500 || f === 1700) blobs[f] = blobOf(ex);
    } });
  ok('H2 menu shows LOAD when saving on', !R.trap && findRow(blobs[1340], 'PAUSED') === 4 && findRow(blobs[1340], 'LOAD') >= 0, R.trap);
  ok('H2 load submenu lists SLOT 1 AREA 8', !R.trap && findRow(blobs[1500], 'SLOT') >= 0 && findRow(blobs[1500], 'AREA') >= 0, R.trap);
  const mv = new Set(R.rec.filter((r) => r.f >= 1720 && r.f <= 1800).map((r) => r.pf));
  ok('H2 LOAD slot0 running area-8 (resume-then-thaw)', !R.trap && R.rec[1750].be === 1 && R.rec[1750].dd === 2 && R.rec[1750].area === 8 && mv.size > 3 && R.ex.bm_thaw_result() === 1, R.trap || ('be=' + R.rec[1750].be + ' tres=' + R.ex.bm_thaw_result()));
  ok('H2 menu dismissed after LOAD', !R.trap && findRow(blobs[1700], 'PAUSED') < 0, R.trap);
}
// Run I: QUIT TO TITLE lands on title; title Start reopens the E2 menu.
{
  const blobs = {};
  const R = await drive({ span: 1850, rec: true,
    taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 4 }, { at: 1400, pad: 32 }, { at: 1450, pad: 32 }, { at: 1500, pad: 1 }, { at: 1700, pad: 8 }],
    onFrame: (ex, f) => {
      if (f === 700) ENH(ex);
      if (f === 1600 || f === 1760) blobs[f] = blobOf(ex);
    } });
  ok('I QUIT lands on title DD0', !R.trap && R.rec[1600].dd === 0 && findRow(blobs[1600], 'PAUSED') < 0, R.trap || ('dd=' + R.rec[1600].dd));
  ok('I title Start reopens E2 START row8', !R.trap && findRow(blobs[1760], 'START') === 8 && R.rec[1760].dd === 0, R.trap);
}
// Run J: enhanced OFF is pure stock (same-button pause/resume, no menu ever).
{
  const blobs = {};
  const taps = [{ at: 61, pad: 8 }, { at: 200, pad: 4 }, { at: 1500, pad: 8 }, { at: 1700, pad: 8 }];
  const R = await drive({ span: 1900, rec: true, taps: taps,
    onFrame: (ex, f) => { if (f === 200 || f === 1560 || f === 1660) blobs[f] = blobOf(ex); } });
  const frz = R.rec.filter((r) => r.f >= 1550 && r.f <= 1595);
  const blink = new Set(frz.map((r) => r.vf));
  const pch = new Set(R.rec.filter((r) => r.f >= 1760 && r.f <= 1860).map((r) => r.pf));
  ok('J stock: title Select nothing, gameplay runs unpaused', !R.trap && findRow(blobs[200], 'PAUSED') < 0 && R.rec[200].dd === 0 && R.rec[1400].dd === 2 && R.rec[1400].be === 1, R.trap);
  ok('J stock: Start pauses (BE0+B7 latch, no menu, video blinks)', !R.trap && frz.every((r) => r.be === 0) && (R.rec[1580].b7 & 4) === 4 && findRow(blobs[1560], 'PAUSED') < 0 && blink.size >= 2, R.trap);
  ok('J stock: same-button Start resumes running, no menu ever', !R.trap && R.rec[1800].be === 1 && R.rec[1800].dd === 2 && pch.size > 3 && findRow(blobs[1660], 'PAUSED') < 0, R.trap);
  let pm = -1;
  try { pm = R.ex.bm_pmenu_dbg(); } catch (e) { pm = -1; }
  ok('J pmenu fully idle with enhanced off', !R.trap && (pm & 255) === 0, 'dbg=' + pm);
}
// Run K: determinism (same open/nav/close twice => identical streams).
{
  const mk = () => drive({ span: 1620, rec: true,
    taps: [{ at: 61, pad: 8 }, { at: 1200, pad: 8 }, { at: 1300, pad: 4 }, { at: 1400, pad: 32 }, { at: 1450, pad: 4 }],
    onFrame: (ex, f) => { if (f === 700) ENH(ex); } });
  const K1 = await mk(), K2 = await mk();
  let bad = 0;
  for (let f = 0; f <= 1620; f++) {
    const a = K1.rec[f], b = K2.rec[f];
    if (!a || !b || a.vf !== b.vf || a.pf !== b.pf || a.be !== b.be || a.dd !== b.dd || a.b7 !== b.b7) bad++;
  }
  ok('K determinism x2 vf+pf+be+dd+b7', !K1.trap && !K2.trap && bad === 0, (K1.trap || K2.trap) || ('bad=' + bad));
}
// Run L: engine-only statics + tally.
{
  const src = readFileSync(PROJ + '/frontend/src/core/bm_api.c', 'utf8');
  const count = (s, t) => s.split(t).length - 1;
  ok('L bm_setting_set refs == 5', count(src, 'bm_setting_set') === 5, 'n=' + count(src, 'bm_setting_set'));
  const app = readFileSync(PROJ + '/frontend/src/app.js', 'utf8');
  ok('L shell untouched no pmenu in app.js', app.indexOf('pmenu') < 0, 'found');
  ok('L gate refs present', src.indexOf('presnap_ram[0xBE]') >= 0 && src.indexOf('presnap_ram[0xB7] & ~4') >= 0, 'missing');
  const bootOk = /void bm_boot\(void\) \{\s*engine_reset_to_title\(\);\s*\}/.test(src);
  ok('L bm_boot body is factored reset', bootOk, 'body changed');
  const rs = src.slice(src.indexOf('static void engine_reset_to_title'));
  const rb = rs.slice(rs.indexOf('{'), rs.indexOf('}'));
  ok('L reset preserves config', rb.indexOf('enhanced_mode') < 0 && rb.indexOf('saving_on') < 0 && rb.indexOf('sram_') < 0, 'leak');
  ok('L LOAD is resume-then-thaw (pending)', src.indexOf('pmenu_pending_load') >= 0, 'missing');
}
console.log('---- E3: ' + pass + ' pass / ' + fail + ' fail ----');
process.exit(fail ? 1 : 0);
