// P3: bank-3 spawn tables end-to-end (enemies.js + overlay write path).
// Run: node tools/verify-pack-p3.mjs  (from frontend/)
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { parseBank, LEVEL_MODE } from '../src/pack/levels.js';
import * as OV from '../src/pack/overlay.js';
import { parseSpawns, serializeSpawns, SUB_KEYS, keyForLevel, levelForKey, subLevel, subMode } from '../src/pack/enemies.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const ps = parseSpawns(stock.prg[3]);
ok('parseSpawns ok, 16 sublists', ps.ok && ps.lists.length === 16, ps.errors.join(' '));
ok('keys/modes/levels B0-B7 L1-8, A0-A7 L9-16 (palette-proven)',
  ps.lists.map(l => l.key).join(',') === SUB_KEYS.join(',') &&
  ps.lists.every(l => (l.key[0] === 'A' ? (l.mode === 'overhead' && l.level === (l.key.charCodeAt(1) - 48) + 9)
    : (l.mode === 'tank' && l.level === (l.key.charCodeAt(1) - 48) + 1))));
ok('all n>0', ps.lists.every(l => l.n > 0), JSON.stringify(ps.lists.map(l => l.n)));
const byTri = ps.lists.slice().sort((a, b) => a.tri - b.tri);
let contig = true;
for (let k = 0; k < byTri.length; k++) {
  const L = byTri[k];
  const end = k + 1 < byTri.length ? byTri[k + 1].tri : 0x4000;
  if (!(L.tri + 6 <= L.tb && L.tb + L.n + 1 <= L.xb && L.xb + L.n <= L.yb && L.yb + L.n <= end)) contig = false;
}
ok('regions ordered + contiguous (B7 tail excluded)', contig);
ok('B7 y-tail stays below $BF53 stub', byTri[15].yb + byTri[15].n < 0x3F53,
  (byTri[15].yb + byTri[15].n).toString(16));
ok('all type[n]==$FF terminator', ps.lists.every(l => l.types[l.n] === 0xFF),
  JSON.stringify(ps.lists.filter(l => l.types[l.n] !== 0xFF).map(l => l.key)));
ok('all record types <0x80', ps.lists.every(l => { for (let i = 0; i < l.n; i++) if (l.types[i] >= 0x80) return false; return true; }));
const b1 = ps.lists.find(l => l.key === 'B1');
ok('B1 anchors (n=119, x[0]=4B t[0]=0)', b1.n === 119 && b1.xs[0] === 0x4B && b1.types[0] === 0, b1.n + '/' + b1.xs[0]);
const rt = serializeSpawns(ps, {});
ok('round-trip byte-identical', rt.ok && rt.bytes.every((v, i) => v === stock.prg[3][i]));
const badT = b1.types.slice(); badT[0] = 0x80;
ok('reject type>=0x80', !serializeSpawns(ps, { B1: { types: badT } }).ok);
ok('reject wrong lengths', !serializeSpawns(ps, { B1: { xs: b1.xs.slice(0, 3) } }).ok);
ok('reject bad key', !serializeSpawns(ps, { Z9: {} }).ok);
// --- dynamic: enemies.js edit -> overlay -> engine ---
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
async function census(prgBanks, warpA, span) {
  let win = null;
  const warpF = 1000, endF = warpF + span + 1;
  let snap = null, trapMsg = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === warpF) ex.bm_warp(warpA);
    if (f === warpF + span) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      snap = mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160);
    }
    if (f + 1 >= endF) throw new Error('STOP');
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const o = new Uint8Array(banks[0].length * banks.length); banks.forEach((b, i) => o.set(b, i * banks[0].length)); return o; };
    mm().set(cat(prgBanks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trapMsg = String((e && e.message) || e).slice(0, 80); }
  let trapFlag = -1;
  try { trapFlag = inst.exports.bm_trap_flag(); } catch (e) {}
  const hx = (a, n) => { let s = ''; for (let i = 0; i < n; i++) s += snap[a + i].toString(16).padStart(2, '0'); return s; };
  return { trapMsg, trapFlag, r14: snap[0x14], s8: hx(0x400 + 8 * 14, 8) };
}
function packFromEdit(key, fn) {
  const L = ps.lists.find(l => l.key === key);
  const e = { types: L.types.slice(), xs: L.xs.slice(), ys: L.ys.slice() };
  fn(e);
  const r = serializeSpawns(ps, { [key]: e });
  if (!r.ok) throw new Error('serialize: ' + r.errors.join(' '));
  const runs = OV.diffRuns(stock.prg[3], r.bytes);
  const patches = runs.map(x => OV.makePatch('prg', 3, x.off, x.bytes));
  const doc = { customVersion: 1, id: 'c-p3', name: 'p3', baseCrc: stock.meta.crc32, patches, editorVersion: 'p3', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const q = OV.applyOverlay(stock, doc);
  if (!q.ok) throw new Error('overlay failed');
  return { pack: q.pack, runs: runs.length };
}
const A = await census(stock.prg, 9, 150);
ok('stock anchor trap-free, slot8 actor 55 @4B', !A.trapMsg && A.trapFlag === 0 && A.r14 === 9 && A.s8.slice(0, 8) === '5501804b', A.s8);
const T = packFromEdit('B1', e => { e.types[0] = 5; });
ok('type edit serializes to few runs', T.runs > 0 && T.runs <= 3, 'runs=' + T.runs);
const C = await census(T.pack.prg, 9, 150);
ok('type edit boots, slot8 actor 55->60', !C.trapMsg && C.trapFlag === 0 && C.s8.slice(0, 4) === '60c8', C.s8);
const Q = packFromEdit('B1', e => { e.xs[0] = 0x51; });
const D = await census(Q.pack.prg, 9, 150);
ok('x edit boots, slot8 spawns @51 dormant', !D.trapMsg && D.trapFlag === 0 && D.s8.slice(0, 8) === '01008051', D.s8);// --- P3e: level<->sublist mapping (palette-proven 2026-11-24) ---
// warp_raw(k) loads the level map whose bg palette matches level k<8?k+9:k-7.
// $14 6 excluded: stock area-6 init traps (pre-existing vector gap); A6<->L15
// by triplet order + elimination + door-pair structure (k<->k+8).
const KEYMAP = {};
for (let l = 1; l <= 8; l++) KEYMAP[l] = 'B' + (l - 1);
for (let l = 9; l <= 16; l++) KEYMAP[l] = 'A' + (l - 9);
ok('keyForLevel 16-level truth table', Object.keys(KEYMAP).every(l => keyForLevel(+l) === KEYMAP[l]));
ok('levelForKey round-trips all 16', Object.keys(KEYMAP).every(l => levelForKey(KEYMAP[l]) === +l));
ok('keyForLevel inverts parsed lists + modes match LEVEL_MODE',
  ps.lists.every(l => keyForLevel(l.level) === l.key && l.mode === LEVEL_MODE[l.level] && subMode(l.key) === l.mode && subLevel(l.key) === l.level));
ok('keyForLevel/levelForKey reject bad input', keyForLevel(0) === null && keyForLevel(17) === null && levelForKey('Z9') === null && levelForKey('A8') === null);
async function rawSnap(prgBanks, k, span) {
  const warpF = 1000, endF = warpF + span + 1;
  let win = null, snap = null, trapMsg = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === warpF) ex.bm_warp_raw(k);
    if (f === warpF + span) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      snap = mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160);
    }
    if (f + 1 >= endF) throw new Error('STOP');
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const o = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => o.set(bb, i * banks[0].length)); return o; };
    mm().set(cat(prgBanks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trapMsg = String((e && e.message) || e).slice(0, 80); }
  let trapFlag = -1;
  try { trapFlag = inst.exports.bm_trap_flag(); } catch (e) {}
  if (!snap) return { trapMsg, trapFlag, nosnap: true };
  const hx = (a, n) => { let s = ''; for (let i = 0; i < n; i++) s += snap[a + i].toString(16).padStart(2, '0'); return s; };
  return { trapMsg, trapFlag, r14: snap[0x14], pal: hx(4096, 16),
    a8: snap[0x400 + 8 * 14], s8: hx(0x400 + 8 * 14, 8), s9: hx(0x400 + 9 * 14, 8), s10: hx(0x400 + 10 * 14, 8) };
}
const lvPal = {};
for (const b of [0, 1, 2]) {
  const pb = parseBank(stock.prg[b], b);
  if (!pb.ok) throw new Error('pal parse bank ' + b + ': ' + pb.errors.join(' '));
  for (const L of pb.levels) lvPal[L.level] = stock.prg[b].slice(L.ptrs.pal, L.ptrs.pal + 16);
}
const palHx = (a) => Array.from(a).map(v => v.toString(16).padStart(2, '0')).join('');
for (let k = 0; k < 16; k++) {
  if (k === 6) continue;
  const r = await rawSnap(stock.prg, k, 150);
  const expectL = k < 8 ? k + 9 : k - 7;
  ok('area ' + k + ' loads level-' + expectL + ' map (palette)', !r.nosnap && !r.trapMsg && r.trapFlag === 0 && r.r14 === k && r.pal === palHx(lvPal[expectL]), r.pal);
}
const r6 = await rawSnap(stock.prg, 6, 150);
ok('area-6 stock init trap (excluded, A6<->L15 by elimination)', !!r6.nosnap, r6.trapMsg || ('flag=' + r6.trapFlag));
const A0 = ps.lists.find(l => l.key === 'A0');
ok('A0 anchor rec92 type14', A0.types[92] === 14, 'got ' + A0.types[92]);
const EA = packFromEdit('A0', e => { e.types[92] = 2; });
const R0 = await rawSnap(stock.prg, 0, 150);
ok('stock area0 slot8 actor 45', !R0.trapMsg && R0.trapFlag === 0 && R0.a8 === 0x45, R0.s8);
const R8 = await rawSnap(stock.prg, 8, 150);
ok('stock area8 B0 dormant baseline', !R8.trapMsg && R8.trapFlag === 0 && R8.s8.slice(0, 2) === '01', R8.s8 + '/' + R8.s9 + '/' + R8.s10);
const EA0 = await rawSnap(EA.pack.prg, 0, 250); // bank4 actor conversion lands by ~250f (0x29 at 150)
ok('A0 type92 14->2 live at area0 (slot8 actor 45->2a)', !EA0.trapMsg && EA0.trapFlag === 0 && EA0.a8 === 0x2a, EA0.s8);
const EA8 = await rawSnap(EA.pack.prg, 8, 150);
ok('A0 edit invisible at area8 (isolation)', !EA8.trapMsg && EA8.trapFlag === 0 && EA8.s8 === R8.s8 && EA8.s9 === R8.s9 && EA8.s10 === R8.s10, EA8.s8);
const EB = packFromEdit('B1', e => { e.types[0] = 5; });
const EB0 = await rawSnap(EB.pack.prg, 0, 150);
ok('B1 edit invisible at area0 (slot8 stays 45)', !EB0.trapMsg && EB0.trapFlag === 0 && EB0.a8 === 0x45, EB0.s8);

console.log('----');
console.log((fail === 0 ? 'P3 ALL ' + pass + ' CHECKS GREEN' : 'P3 FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
