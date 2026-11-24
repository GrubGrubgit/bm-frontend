// P4: entrance-save system - door table + exact-state freeze/thaw proof.
// Run: node tools/verify-pack-p4.mjs  (from frontend/)
// Proof bar: freeze at an NMI-entry boundary, rewind K frames, re-run,
// byte-identical save buffers EXCEPT informational wait-poll labels
// (int_pc@32, nmi_pc@64: E93A vs E93C - the catching poll can shift one
// poll with identical cycles/gameplay; the pushed PC is discarded by RTI,
// so the label never affects resumption). Those 8 bytes are masked.
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { parseDoors, pairOf, findSide, matchDoor } from '../src/pack/doors.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const pd = parseDoors(stock.prg[7]);
ok('parseDoors ok, 108 rows', pd.ok && pd.rows.length === 108, pd.errors.join(' '));
ok('all door areas<16', pd.rows.every(r => r.area < 16));
const i9 = findSide(pd.rows, 9, 69, 75);
ok('side (9,69,75) is row1, pair row0 is (8,9,125)', i9 === 1 && pd.rows[pairOf(i9)].area === 8 && pd.rows[pairOf(i9)].x === 9 && pd.rows[pairOf(i9)].y === 125, 'i9=' + i9);
const i10 = findSide(pd.rows, 10, 85, 7);
ok('side (10,85,7) is row5, pair row4 is (9,22,93)', i10 === 5 && pd.rows[pairOf(i10)].area === 9 && pd.rows[pairOf(i10)].x === 22 && pd.rows[pairOf(i10)].y === 93, 'i10=' + i10);
const m1 = matchDoor(pd.rows, 9, 69, 75);
ok('matchDoor (9,69,75)->(8,9,125)', m1 && m1.area === 8 && m1.x === 9 && m1.y === 125);
const m2 = matchDoor(pd.rows, 8, 9, 125);
ok('matchDoor reverses (8,9,125)->(9,69,75)', m2 && m2.area === 9 && m2.x === 69 && m2.y === 75);
ok('pairOf involution all 108', pd.rows.every((r, i) => pairOf(pairOf(i)) === i));
let missY = -1;
for (let y = 0; y < 256; y++) { if (findSide(pd.rows, pd.rows[0].area, pd.rows[0].x, y) < 0) { missY = y; break; } }
ok('matchDoor miss returns null', missY >= 0 && matchDoor(pd.rows, pd.rows[0].area, pd.rows[0].x, missY) === null);
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
const NB = 16;
async function bootRun(drive) {
  let win = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => { drive(win.exports, f); } } })).instance;
  win = { exports: inst.exports };
  const mm = () => new Uint8Array(inst.exports.memory.buffer);
  const cat = new Uint8Array(16384 * NB);
  for (let b = 0; b < NB; b++) cat.set(rom.slice(16 + b * 16384, 16 + (b + 1) * 16384), b * 16384);
  mm().set(cat, inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
  const chroff = 16 + 262144;
  const nbchr = Math.floor((rom.length - chroff) / 8192);
  const cc = new Uint8Array(8192 * nbchr);
  for (let b = 0; b < nbchr; b++) cc.set(rom.slice(chroff + b * 8192, chroff + (b + 1) * 8192), b * 8192);
  mm().set(cc, inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
  inst.exports.bm_boot();
  return inst.exports;
}
function grabSave(ex) {
  const m = new Uint8Array(ex.memory.buffer);
  const p = ex.bm_savestate_ptr(), l = ex.bm_savestate_len();
  return m.slice(p, p + l);
}
function stageBuf(ex, buf) {
  const m = new Uint8Array(ex.memory.buffer);
  const tp = ex.bm_thaw_staging_ptr();
  m.set(buf, tp + 12);
  m[tp + 8] = buf.length & 255; m[tp + 9] = (buf.length >> 8) & 255;
  m[tp + 10] = (buf.length >> 16) & 255; m[tp + 11] = (buf.length >> 24) & 255;
  m[tp] = 1;
}
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function maskedDiff(a, b) {
  const d = [];
  for (let i = 0; i < a.length; i++) {
    if (i >= 32 && i < 36) continue;
    if (i >= 64 && i < 68) continue;
    if (a[i] !== b[i]) d.push(i);
  }
  return d;
}
const WAIT = new Set([0xE93A, 0xE93C]);

let landedDoor = null;
try {
  await bootRun((ex, f) => {
    ex.bm_set_pad(f >= 61 && f <= 65 ? 8 : 0);
    if (f === 1000) ex.bm_warp_raw(9);
    if (f >= 1150) ex.bm_set_pad(32);
    if (f >= 1150 && ex.bm_ram_rd(0x14) === 8 && !landedDoor) {
      landedDoor = { f, x: ex.bm_ram_rd(0x49), y: ex.bm_ram_rd(0x4B), b7: ex.bm_ram_rd(0xB7) };
    }
    if (f >= 1900 || landedDoor) throw new Error('STOP');
  });
} catch (e) { if (e.message !== 'STOP') throw e; }
ok('Down-entry teleports area9->area8', !!landedDoor, 'no teleport by f1900');
ok('landing coords are pair side (9,125)', !!landedDoor && landedDoor.x === 9 && landedDoor.y === 125, landedDoor && ('x=' + landedDoor.x + ' y=' + landedDoor.y + ' f=' + landedDoor.f));
ok('dispatcher flag $B7==1 at landing', !!landedDoor && landedDoor.b7 === 1, landedDoor && ('b7=' + landedDoor.b7));
async function thawProof(area, F, K) {
  let win = null, saved = null, SA = null, SB = null, tres = null;
  let waitFreeze = -1, phase = 0, done = false, frames = 0;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports; frames++;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === 1000) ex.bm_warp_raw(area);
    if (phase === 0 && f === 1000 + F) { saved = grabSave(ex); waitFreeze = ex.bm_last_int_pc(); phase = 1; }
    else if (phase === 1 && f === 1000 + F + K) { SA = grabSave(ex); stageBuf(ex, saved); phase = 2; }
    else if (phase === 2 && f < 1000 + F + K) { phase = 3; }
    else if (phase === 3 && f === 1000 + F + K) { SB = grabSave(ex); tres = ex.bm_thaw_result(); done = true; }
    if (done || frames > 60000) throw new Error('STOP');
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = new Uint8Array(16384 * NB);
    for (let b = 0; b < NB; b++) cat.set(rom.slice(16 + b * 16384, 16 + (b + 1) * 16384), b * 16384);
    mm().set(cat, inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    const chroff = 16 + 262144;
    const nbchr = Math.floor((rom.length - chroff) / 8192);
    const cc = new Uint8Array(8192 * nbchr);
    for (let b = 0; b < nbchr; b++) cc.set(rom.slice(chroff + b * 8192, chroff + (b + 1) * 8192), b * 8192);
    mm().set(cc, inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { error: String(e.message).slice(0, 80) }; }
  if (!SA || !SB) return { error: 'incomplete' };
  const d = maskedDiff(SA, SB);
  return {
    tres, ndiff: d.length, offs: d.slice(0, 12),
    magic: u32(SA, 0) === 0x424D5356 && u32(SB, 0) === 0x424D5356,
    len: SA.length === 7836 && SB.length === 7836,
    waitOk: WAIT.has(waitFreeze),
  };
}
for (const [area, F, K] of [[0, 300, 1], [0, 300, 25], [8, 300, 25], [9, 300, 25]]) {
  const r = await thawProof(area, F, K);
  ok('thaw area' + area + ' K=' + K + ' tres==1', r.tres === 1, 'tres=' + r.tres + ' ' + (r.error || ''));
  ok('thaw area' + area + ' K=' + K + ' masked byte-identical', r.ndiff === 0, 'ndiff=' + r.ndiff + ' offs=' + (r.offs || []).join(','));
  ok('thaw area' + area + ' K=' + K + ' magic+len+waitset', r.magic && r.len && r.waitOk, JSON.stringify([r.magic, r.len, r.waitOk]));
}
const long8 = await thawProof(8, 300, 300);
ok('thaw area8 K=300 tres==1', long8.tres === 1, 'tres=' + long8.tres + ' ' + (long8.error || ''));
ok('thaw area8 K=300 masked byte-identical', long8.ndiff === 0, 'ndiff=' + long8.ndiff + ' offs=' + (long8.offs || []).join(','));

let rMagic = null, rVer = null, rLen = null, contFrame = -1;
try {
  await bootRun((ex, f) => {
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === 1000) ex.bm_warp_raw(0);
    if (f === 1300 || f === 1350 || f === 1400) {
      const good = grabSave(ex);
      const bad = good.slice();
      if (f === 1300) bad[0] ^= 0xFF;
      else if (f === 1350) bad[4] ^= 0xFF;
      if (f === 1400) {
        const m = new Uint8Array(ex.memory.buffer);
        const tp = ex.bm_thaw_staging_ptr();
        m.set(good, tp + 12);
        const L = good.length + 16;
        m[tp + 8] = L & 255; m[tp + 9] = (L >> 8) & 255; m[tp + 10] = (L >> 16) & 255; m[tp + 11] = (L >> 24) & 255;
        m[tp] = 1;
      } else stageBuf(ex, bad);
    }
    if (f === 1301) rMagic = ex.bm_thaw_result();
    if (f === 1351) rVer = ex.bm_thaw_result();
    if (f === 1401) rLen = ex.bm_thaw_result();
    if (f === 1430) { contFrame = u32(grabSave(ex), 12); throw new Error('STOP'); }
    if (f > 1500) throw new Error('STOP');
  });
} catch (e) { if (e.message !== 'STOP') throw e; }
ok('refuse bad magic tres==-2', rMagic === -2, 'tres=' + rMagic);
ok('refuse bad version tres==-3', rVer === -3, 'tres=' + rVer);
ok('refuse len mismatch tres==-4', rLen === -4, 'tres=' + rLen);
ok('refused thaws never rewind (frame_no continuity)', contFrame === 1430, 'frame=' + contFrame);
let unstaged = null;
try {
  await bootRun((ex, f) => {
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === 1000) ex.bm_warp_raw(0);
    if (f === 1400) {
      const s = grabSave(ex);
      unstaged = { tres: ex.bm_thaw_result(), magic: u32(s, 0) === 0x424D5356, len: s.length };
      throw new Error('STOP');
    }
    if (f > 1500) throw new Error('STOP');
  });
} catch (e) { if (e.message !== 'STOP') throw e; }
ok('unstaged run thaw_result stays 0', !!unstaged && unstaged.tres === 0, unstaged && ('tres=' + unstaged.tres));
ok('unstaged freeze magic+len valid', !!unstaged && unstaged.magic && unstaged.len === 7836, unstaged && (unstaged.len + ''));
console.log('----');
console.log('pass=' + pass + ' fail=' + fail);
if (fail) process.exit(1);

