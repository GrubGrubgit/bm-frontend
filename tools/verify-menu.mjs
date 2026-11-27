// E2: in-engine main menu (title Start edge + intro skip -> menu when enhanced).
// Run: node tools/verify-menu.mjs  (from frontend/)
// Menu lives in the engine (bm_api.c E2 section, no shell dependence): full-NT0
// takeover drawn post-game-logic, pad filtered while modal. START=new game,
// CONTINUE=last save (saving on + save exists), LOAD=slot menu, SETTINGS menu.
// Pregame gate (lives==0 && cont==0) keeps it out of gameplay/demo/game-over.
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
const NL = String.fromCharCode(10);
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
const CRC = 0x12345678;
const chr = Buffer.concat(stock.chr.map((b) => Buffer.from(b)));
const blank = (t) => { const base = 7 * 4096 + t * 16; for (let i = 0; i < 16; i++) if (chr[base + i] !== 0) return false; return true; };
ok('menu vocab glyphs all present (A-Z 0-9 + $01 block)', (() => {
  for (let c = 65; c <= 90; c++) if (blank(c)) return false;
  for (let c = 48; c <= 57; c++) if (blank(c)) return false;
  return !blank(1);
})());
// NT0 text helpers over a staged blob (save-state layout: ram@12..2060)
const rowText = (blob, r) => {
  let s = '';
  for (let c = 0; c < 32; c++) { const b = blob[2428 + r * 32 + c]; s += (b === 0 ? ' ' : String.fromCharCode(b)); }
  return s;
};
const findRow = (blob, t) => { for (let r = 0; r < 30; r++) if (rowText(blob, r).indexOf(t) >= 0) return r; return -1; };
// driver: fresh instance, scripted host; hooks observe/poke per frame
async function drive(o) {
  const log = [];
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    let pad = 0;
    for (const t of (o.taps || [])) if (f >= t.at && f < t.at + 8) pad = t.pad;
    if (o.holdRight && f >= o.holdRight) pad = 128;
    ex.bm_set_pad(pad);
    if (o.onFrame) o.onFrame(ex, f, log);
    if (f + 1 >= o.span + 1) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    if (o.pre) o.pre(inst.exports);
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  return { ex: inst.exports, trap: trap, log: log };
}
const blobOf = (ex) => {
  const mem = new Uint8Array(ex.memory.buffer);
  return Array.from(mem.slice(ex.bm_savestate_ptr(), ex.bm_savestate_ptr() + ex.bm_savestate_len()));
};
// --- settings exports: defaults, round-trip, clamp, bad id ---
{
  const R = await drive({ span: 12 });
  const ex = R.ex;
  const dflt = ex.bm_setting_get(0) === 8 && ex.bm_setting_get(1) === 0 && ex.bm_setting_get(2) === 0 && ex.bm_setting_get(3) === 0;
  ex.bm_setting_set(0, 5); ex.bm_setting_set(1, 1); ex.bm_setting_set(2, 2); ex.bm_setting_set(3, 1);
  const rt = ex.bm_setting_get(0) === 5 && ex.bm_setting_get(1) === 1 && ex.bm_setting_get(2) === 2 && ex.bm_setting_get(3) === 1;
  ex.bm_setting_set(0, 99); ex.bm_setting_set(0, -3); ex.bm_setting_set(2, 9);
  const cl = ex.bm_setting_get(0) === 0 && ex.bm_setting_get(2) === 3;
  const bad = ex.bm_setting_get(4) === -1 && ex.bm_setting_get(-1) === -1;
  ok('settings defaults + round-trip + clamp + bad id', !R.trap && dflt && rt && cl && bad, R.trap);
}
// --- enhanced OFF: Start on title goes stock (no menu, game starts) ---
{
  const R = await drive({ span: 800, taps: [{ at: 120, pad: 8 }],
    onFrame: (ex, f) => {
      if (f === 120) ex.bm_enhanced_set(0);
    } });
  const b = blobOf(R.ex);
  ok('enhanced off: no menu on title Start, stock new game starts', !R.trap && findRow(b, 'BLASTER MASTER') < 0 && R.ex.bm_ram_rd(0xDD) === 2 && R.ex.bm_ram_rd(0x37E) === 5, R.trap || ('DD=' + R.ex.bm_ram_rd(0xDD)));
}
// --- enhanced ON, saving OFF: menu opens, START+SETTINGS only ---
let menuBlob = null;
{
  const R = await drive({ span: 400, taps: [{ at: 120, pad: 8 }],
    onFrame: (ex, f) => {
      if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); }
    } });
  const b = blobOf(R.ex);
  menuBlob = b;
  const h = findRow(b, 'BLASTER MASTER');
  const s = findRow(b, 'START');
  const st = findRow(b, 'SETTINGS');
  ok('menu opens on title Start (header+START+SETTINGS, game held)', !R.trap && h === 4 && s === 8 && st === 10 && R.ex.bm_ram_rd(0x14) === 0 && R.ex.bm_ram_rd(0xDD) === 0, R.trap || ('h=' + h + ' s=' + s + ' area=' + R.ex.bm_ram_rd(0x14)));
  ok('no CONTINUE/LOAD when saving off', findRow(b, 'CONTINUE') < 0 && findRow(b, 'LOAD') < 0, 'c=' + findRow(b, 'CONTINUE') + ' l=' + findRow(b, 'LOAD'));
  ok('cursor on START (tile $01 col9 row8)', b[2428 + 8 * 32 + 9] === 1 && b[2428 + 10 * 32 + 9] === 0, 'c8=' + b[2428 + 8 * 32 + 9]);
}
// --- navigation: Down Down wraps, Up goes back ---
{
  const R = await drive({ span: 500, taps: [{ at: 120, pad: 8 }, { at: 260, pad: 32 }, { at: 300, pad: 32 }, { at: 340, pad: 16 }],
    onFrame: (ex, f, log) => {
      if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); }
      if (f === 280 || f === 320 || f === 360) {
        const b = blobOf(ex);
        const cur = (b[2428 + 8 * 32 + 9] === 1) ? 8 : ((b[2428 + 10 * 32 + 9] === 1) ? 10 : -1);
        log.push('cur' + f + '=' + cur);
      }
    } });
  ok('navigate Down/Down-wrap/Up (10/8/10)', !R.trap && R.log.join(',') === 'cur280=10,cur320=8,cur360=10', R.trap || R.log.join('|'));
}
// --- START select: menu closes, stock new game, no reopen on intro skips ---
{
  const taps = [{ at: 120, pad: 8 }, { at: 300, pad: 1 }];
  for (let t = 500; t < 1100; t += 50) taps.push({ at: t, pad: 8 });
  const R = await drive({ span: 1200, taps: taps,
    onFrame: (ex, f, log) => {
      if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); }
      if (f === 700 || f === 900) {
        const b = blobOf(ex);
        log.push('hdr' + f + '=' + findRow(b, 'BLASTER MASTER'));
      }
    } });
  ok('START: closes menu, stock init runs, intro skips never reopen', !R.trap && R.ex.bm_ram_rd(0xDD) === 2 && R.ex.bm_ram_rd(0x37E) === 5 && R.ex.bm_ram_rd(0x14) === 8 && R.log.join(',') === 'hdr700=-1,hdr900=-1', R.trap || ('DD=' + R.ex.bm_ram_rd(0xDD) + ' ' + R.log.join(',')));
}
// --- saving ON, no saves: START/LOAD/SETTINGS (no CONTINUE) ---
{
  const R = await drive({ span: 400, taps: [{ at: 120, pad: 8 }],
    onFrame: (ex, f) => {
      if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(1); }
    } });
  const b = blobOf(R.ex);
  ok('saving on, no saves: START+LOAD+SETTINGS, no CONTINUE', !R.trap && findRow(b, 'START') === 8 && findRow(b, 'LOAD') === 10 && findRow(b, 'SETTINGS') === 12 && findRow(b, 'CONTINUE') < 0, R.trap);
}
// --- save flow: gameplay save, fresh-state menu, CONTINUE loads it back ---
{
  const A = await drive({ span: 1100, taps: [{ at: 61, pad: 8 }],
    onFrame: (ex, f) => {
      if (f === 700) ex.bm_warp(9);
      if (f === 1000) ex.bm_sram_save(1, CRC);
    } });
  const memA = new Uint8Array(A.ex.memory.buffer);
  const p = A.ex.bm_sram_blob_ptr(1), l = A.ex.bm_sram_blob_len(1);
  const exp = Array.from(memA.slice(p, p + l));
  const savedArea = exp[380 + 0x14] & 15;
  const savedDD = exp[380 + 0xDD], savedCont = exp[380 + 0x37E];
  let B = null, loadSeen = null;
  B = await drive({ span: 900,
    taps: [{ at: 330, pad: 8 }, { at: 500, pad: 32 }, { at: 540, pad: 1 }],
    onFrame: (ex, f) => {
      if (f === 10) {
        ex.bm_enhanced_set(1); ex.bm_saving_set(1);
        const tp = ex.bm_thaw_staging_ptr();
        const mm = new Uint8Array(ex.memory.buffer);
        mm.set(exp, tp + 12);
        mm[tp + 8] = l & 255; mm[tp + 9] = (l >> 8) & 255; mm[tp + 10] = (l >> 16) & 255; mm[tp + 11] = (l >> 24) & 255;
        const st = ex.bm_sram_store(1, CRC);
        if (st !== 0) ex.bm_ram_wr(0x6F0, 99);
      }
      if (f === 460) {
        const b = blobOf(ex);
        if (findRow(b, 'CONTINUE') < 0) ex.bm_ram_wr(0x6F0, 98);
      }
      if (ex.bm_thaw_result() === 1 && loadSeen === null) {
        loadSeen = { f: f, area: ex.bm_ram_rd(0x14), dd: ex.bm_ram_rd(0xDD), cont: ex.bm_ram_rd(0x37E), hp: ex.bm_ram_rd(0x40D) };
      }
    } });
  const memB = new Uint8Array(B.ex.memory.buffer);
  ok('CONTINUE appears with a save + loads exact state back', !A.trap && !B.trap && memB[0x6F0] !== 99 && memB[0x6F0] !== 98 && loadSeen !== null && loadSeen.area === savedArea && loadSeen.dd === savedDD && loadSeen.cont === savedCont, (A.trap || B.trap) || ('saved=' + savedArea + '/' + savedDD + '/' + savedCont + ' got=' + JSON.stringify(loadSeen)));
}
// --- LOAD submenu: occupancy list, BACK, empty noop, slot load ---
{
  const A = await drive({ span: 1100, taps: [{ at: 61, pad: 8 }],
    onFrame: (ex, f) => {
      if (f === 700) ex.bm_warp(9);
      if (f === 1000) ex.bm_sram_save(0, CRC);
    } });
  const memA = new Uint8Array(A.ex.memory.buffer);
  const p = A.ex.bm_sram_blob_ptr(0), l = A.ex.bm_sram_blob_len(0);
  const exp = Array.from(memA.slice(p, p + l));
  const sp = A.ex.bm_savestate_ptr();
  const savedArea = memA[sp + 380 + 0x14] & 15;
  const B = await drive({ span: 1150,
    taps: [{ at: 330, pad: 8 }, { at: 480, pad: 32 }, { at: 520, pad: 32 }, { at: 560, pad: 1 }, { at: 640, pad: 2 }, { at: 720, pad: 32 }, { at: 760, pad: 32 }, { at: 840, pad: 1 }, { at: 880, pad: 32 }, { at: 920, pad: 1 }, { at: 980, pad: 16 }, { at: 1020, pad: 1 }],
    onFrame: (ex, f, log) => {
      if (f === 10) {
        ex.bm_enhanced_set(1); ex.bm_saving_set(1);
        const tp = ex.bm_thaw_staging_ptr();
        const mm = new Uint8Array(ex.memory.buffer);
        mm.set(exp, tp + 12);
        mm[tp + 8] = l & 255; mm[tp + 9] = (l >> 8) & 255; mm[tp + 10] = (l >> 16) & 255; mm[tp + 11] = (l >> 24) & 255;
        ex.bm_sram_store(0, CRC);
      }
      if (f === 460 || f === 620 || f === 700) {
        const b = blobOf(ex);
        log.push('f' + f + ' load=' + findRow(b, 'LOAD') + ' slot1=' + findRow(b, 'SLOT 1 AREA') + ' empty2=' + findRow(b, 'SLOT 2 EMPTY') + ' main=' + findRow(b, 'BLASTER MASTER'));
      }
      if (f === 960) {
        const b = blobOf(ex);
        log.push('noop load=' + findRow(b, 'LOAD') + ' main=' + findRow(b, 'BLASTER MASTER'));
      }
      if (f >= 1040 && ex.bm_thaw_result() === 1 && log.indexOf('LOADED') < 0) log.push('LOADED area=' + ex.bm_ram_rd(0x14));
    } });
  ok('LOAD submenu lists occupancy, BACK works, empty noop, slot loads', !A.trap && !B.trap && B.log.indexOf('f460 load=12 slot1=-1 empty2=-1 main=4') >= 0 && B.log.indexOf('f620 load=4 slot1=7 empty2=8 main=-1') >= 0 && B.log.indexOf('f700 load=12 slot1=-1 empty2=-1 main=4') >= 0 && B.log.indexOf('noop load=4 main=-1') >= 0 && B.log.some((x) => x === 'LOADED area=' + savedArea), (A.trap || B.trap) || B.log.join(' | '));
}
// --- SETTINGS submenu: adjust all four, BACK, sticky across boot ---
// NOTE: mid-drive bm_boot() NESTS the game loop (outer frames never resume),
// so the boot is single-shot guarded and the inner run coasts to STOP.
{
 let booted = false;
 const R = await drive({ span: 740,
 taps: [{ at: 120, pad: 8 }, { at: 200, pad: 32 }, { at: 240, pad: 1 }, { at: 280, pad: 128 }, { at: 300, pad: 32 }, { at: 320, pad: 128 }, { at: 340, pad: 32 }, { at: 360, pad: 128 }, { at: 380, pad: 32 }, { at: 400, pad: 128 }, { at: 420, pad: 32 }, { at: 440, pad: 1 }, { at: 460, pad: 32 }, { at: 480, pad: 1 }],
 onFrame: (ex, f, log) => {
 if (booted) {
 if (f === 11) log.push('sticky=' + ex.bm_setting_get(0) + ',' + ex.bm_setting_get(1) + ',' + ex.bm_setting_get(2) + ',' + ex.bm_setting_get(3));
 return;
 }
 if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); }
 if (f === 260) log.push('sub=' + findRow(blobOf(ex), 'SETTINGS'));
 if (f === 300) log.push('vol=' + ex.bm_setting_get(0));
 if (f === 510) log.push('pre=' + ex.bm_setting_get(0) + ',' + ex.bm_setting_get(1) + ',' + ex.bm_setting_get(2) + ',' + ex.bm_setting_get(3) + ' main=' + findRow(blobOf(ex), 'BLASTER MASTER'));
 if (f === 540) { booted = true; ex.bm_boot(); }
 } });
 ok('SETTINGS adjusts all four, BACK returns, sticky across boot', !R.trap && R.log.indexOf('sub=4') >= 0 && R.log.indexOf('vol=9') >= 0 && R.log.some((x) => x === 'pre=9,1,1,1 main=4') && R.log.indexOf('sticky=9,1,1,1') >= 0, R.trap || R.log.join(' | '));
}
// --- pregame gate: lives==0 mid-gameplay + Start opens nothing ---
// NOTE: new-game init writes DD=2/cont=5 ~600f after the area-8 transition,
// so the test waits for real gameplay (warp at 1100) before forcing lives 0.
{
 const R = await drive({ span: 1280,
 taps: [{ at: 61, pad: 8 }, { at: 150, pad: 1 }, { at: 250, pad: 8 }, { at: 1210, pad: 8 }],
 onFrame: (ex, f, log) => {
 if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); }
 if (f === 1100) ex.bm_warp(9);
 if (f === 1180) ex.bm_ram_wr(0xDD, 0);
 if (f === 1230) {
 const b = blobOf(ex);
 log.push('hdr=' + findRow(b, 'BLASTER MASTER') + ' area=' + ex.bm_ram_rd(0x14) + ' dd=' + ex.bm_ram_rd(0xDD) + ' cont=' + ex.bm_ram_rd(0x37E));
 }
 } });
 ok('lives 0 mid-game + Start opens no menu (cont nonzero gate)', !R.trap && R.log.indexOf('hdr=-1 area=9 dd=0 cont=5') >= 0, R.trap || R.log.join(' | '));
}
// --- determinism x2: open + header bytes identical ---
{
  const grab = async () => {
    const R = await drive({ span: 400, taps: [{ at: 120, pad: 8 }],
      onFrame: (ex, f) => { if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); } } });
    return blobOf(R.ex).join(',');
  };
  const g1 = await grab(), g2 = await grab();
  ok('menu open deterministic x2', g1 === g2, 'len ' + g1.length + ' vs ' + g2.length);
}
console.log('----');
console.log((fail === 0 ? 'E2 ALL ' + pass + ' CHECKS GREEN' : 'E2 FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
