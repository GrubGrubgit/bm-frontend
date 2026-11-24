// P3b: add/remove spawn records via zero-sum compacting rebuild.
// Run: node tools/verify-pack-p3b.mjs  (from frontend/)
// Bank 3 spawn region is EXACTLY full (arrays 6826 + triplets 96 = region
// [0x219B,0x3CA5) 6922, zero slack): adds must be funded by removals.
// Rebuild moves triplets too (they interleave the arrays); the A174 table
// stays fixed. Asserts: byte-identical no-op rebuild, remove/add/move,
// over-budget + boss-guard rejects, boot behavior (spawn gone/added,
// cross-area isolation incl. early-list edit moving every later triplet).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import * as OV from '../src/pack/overlay.js';
import { parseSpawns, rebuildSpawns, spawnBudget, SUB_KEYS, BOSS_REC } from '../src/pack/enemies.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const ps = parseSpawns(stock.prg[3]);
ok('parseSpawns ok, 16 sublists', ps.ok && ps.lists.length === 16, ps.errors.join(' '));
const r0 = rebuildSpawns(ps, {});
ok('no-op rebuild ok', r0.ok, JSON.stringify(r0.errors));
ok('no-op rebuild byte-identical', r0.ok && r0.bytes.every((v, i) => v === stock.prg[3][i]));
ok('budget stock free=0', spawnBudget(ps, {}).free === 0);
const B1 = ps.lists.find((l) => l.key === 'B1');
const B3 = ps.lists.find((l) => l.key === 'B3');
const A0 = ps.lists.find((l) => l.key === 'A0');
const drop0 = (L) => ({ types: L.types.slice(1), xs: L.xs.slice(1), ys: L.ys.slice(1) });
const r1 = rebuildSpawns(ps, { B3: drop0(B3) });
ok('B3-1 rebuild ok', r1.ok, JSON.stringify(r1.errors));
const p1 = parseSpawns(r1.bytes);
ok('B3-1 reparse ok, n-1, others intact',
  p1.ok && p1.lists.find((l) => l.key === 'B3').n === B3.n - 1 &&
  p1.lists.filter((l) => l.key !== 'B3').every((l) => { const o = ps.lists.find((q) => q.key === l.key); return l.n === o.n && l.types.every((v, i) => v === o.types[i]); }),
  p1.ok ? '' : JSON.stringify(p1.errors));
ok('budget B3-1 free=3', spawnBudget(ps, { B3: drop0(B3) }).free === 3);
const addEnd = (L, tt, xx, yy) => ({ types: Uint8Array.from([...L.types.slice(0, L.n), tt, 255]), xs: Uint8Array.from([...L.xs, xx]), ys: Uint8Array.from([...L.ys, yy]) });
const r2 = rebuildSpawns(ps, { B3: drop0(B3), B1: addEnd(B1, 5, 81, B1.ys[0]) });
ok('zero-sum move (B3-1/B1+1) ok', r2.ok, JSON.stringify(r2.errors));
const p2 = parseSpawns(r2.bytes);
ok('move reparse counts', p2.ok && p2.lists.find((l) => l.key === 'B1').n === B1.n + 1 && p2.lists.find((l) => l.key === 'B3').n === B3.n - 1);
const r3 = rebuildSpawns(ps, { B1: addEnd(B1, 5, 81, 99) });
ok('net+1 over-budget:3', !r3.ok && r3.errors[0] === 'over-budget:3', JSON.stringify(r3.errors));
const r4 = rebuildSpawns(ps, { A0: (() => { const e = drop0(A0); return e; })() });
ok('setup sanity A0.n>boss idx', A0.n > BOSS_REC.A0);
const dropBoss = (L, i) => ({ types: Uint8Array.from([...L.types.slice(0, i), ...L.types.slice(i + 1)]), xs: Uint8Array.from([...L.xs.slice(0, i), ...L.xs.slice(i + 1)]), ys: Uint8Array.from([...L.ys.slice(0, i), ...L.ys.slice(i + 1)]) });
const r5 = rebuildSpawns(ps, { A0: dropBoss(A0, BOSS_REC.A0) });
ok('boss delete rejected', !r5.ok && r5.errors.join().indexOf('boss-count=0') >= 0, JSON.stringify(r5.errors));
const rt = Array.from(A0.types); rt[BOSS_REC.A0] = 5;
const r6 = rebuildSpawns(ps, { A0: { types: Uint8Array.from(rt), xs: A0.xs, ys: A0.ys } });
ok('boss retype rejected', !r6.ok && r6.errors.join().indexOf('boss-count=0') >= 0, JSON.stringify(r6.errors));
const dup = Array.from(B1.types); dup[B1.n - 1] = 32;
const r6b = rebuildSpawns(ps, { B1: { types: Uint8Array.from(dup), xs: B1.xs, ys: B1.ys } });
ok('B-list type-32 edit allowed (boss guard is tank-only)', r6b.ok, JSON.stringify(r6b.errors));
const r7 = rebuildSpawns(ps, { B1: { types: B1.types, xs: B1.xs.slice(0, 3), ys: B1.ys } });
ok('len-mismatch rejected', !r7.ok, JSON.stringify(r7.errors));
const r8 = rebuildSpawns(ps, { Z9: {} });
ok('bad-key rejected', !r8.ok, JSON.stringify(r8.errors));
const r9 = rebuildSpawns(ps, { B1: { types: Uint8Array.from([]), xs: Uint8Array.from([]), ys: Uint8Array.from([]) } });
ok('empty list rejected', !r9.ok, JSON.stringify(r9.errors));
const badT = B1.types.slice(); badT[0] = 128;
const r10 = rebuildSpawns(ps, { B1: { types: badT, xs: B1.xs, ys: B1.ys } });
ok('type>=0x80 rejected', !r10.ok, JSON.stringify(r10.errors));
const badE = B1.types.slice(); badE[B1.n] = 0;
const r11 = rebuildSpawns(ps, { B1: { types: badE, xs: B1.xs, ys: B1.ys } });
ok('terminator-not-FF rejected', !r11.ok, JSON.stringify(r11.errors));
const r12 = rebuildSpawns(ps, { B3: drop0(B3), B1: addEnd(B1, 5, 81, B1.ys[0]) });
ok('rebuild deterministic x2', r12.ok && r12.bytes.every((v, i) => v === r2.bytes[i]));
// --- dynamic: overlay -> engine ---
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
async function census(prgBanks, warpA, span, raw) {
  let win = null, snap = null, trapMsg = null;
  const warpF = 1000, endF = warpF + span + 1;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === warpF) { if (raw) ex.bm_warp_raw(warpA); else ex.bm_warp(warpA); }
    if (f === warpF + span) { ex.bm_snap(); const mem = new Uint8Array(ex.memory.buffer); snap = mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160); }
    if (f + 1 >= endF) throw new Error('STOP');
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const o = new Uint8Array(banks[0].length * banks.length); banks.forEach((b, i) => o.set(b, i * banks[0].length)); return o; };
    mm().set(cat(prgBanks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trapMsg = String(e.message).slice(0, 80); }
  if (!snap) return { trap: trapMsg || 'NO_SNAP' };
  let acts = [];
  for (let s = 0; s < 18; s++) { const b0 = snap[1024 + s * 14]; if (b0 !== 0) acts.push(s + ':' + b0.toString(16).padStart(2, '0') + ' x=' + snap[1024 + s * 14 + 3].toString(16) + ' y=' + snap[1024 + s * 14 + 5].toString(16)); }
  let flag = -1; try { flag = inst.exports.bm_trap_flag(); } catch (e) {}
  return { trap: trapMsg, flag: flag, r14: snap[20], slots: acts.join(' ') };
}
function packFromRebuild(edited) {
  const r = rebuildSpawns(ps, edited);
  if (!r.ok) throw new Error('rebuild: ' + r.errors.join(' '));
  const runs = OV.diffRuns(stock.prg[3], r.bytes);
  const patches = runs.map((x) => OV.makePatch('prg', 3, x.off, x.bytes));
  const doc = { customVersion: 1, id: 'c-p3b', name: 'p3b', baseCrc: stock.meta.crc32, patches: patches, editorVersion: 'p3b', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const q = OV.applyOverlay(stock, doc);
  if (!q.ok) throw new Error('overlay failed');
  return { pack: q.pack, runs: runs.length };
}
const STOCK_B1 = '0:03 x=45 y=4b 8:55 x=4b y=45 9:55 x=4f y=45 10:01 x=54 y=44 11:01 x=52 y=4b';
const S1 = await census(stock.prg, 9, 150);
const S1b = await census(stock.prg, 9, 150);
ok('stock B1 anchor trap-free + deterministic x2', !S1.trap && S1.flag === 0 && S1.slots === STOCK_B1 && S1b.slots === S1.slots, S1.slots);
const PA = packFromRebuild({ B1: drop0(B1) });
const A1 = await census(PA.pack.prg, 9, 150);
const A2 = await census(PA.pack.prg, 9, 150);
ok('removed record gone (slot8 x 4b->4f) x2', !A1.trap && A1.flag === 0 && A1.slots !== STOCK_B1 && A1.slots.indexOf('8:55 x=4f') >= 0 && A1.slots === A2.slots, A1.slots);
const PB = packFromRebuild({ B3: drop0(B3), B1: addEnd(B1, 5, 81, B1.ys[0]) });
const B_1 = await census(PB.pack.prg, 9, 150);
const B_2 = await census(PB.pack.prg, 9, 150);
ok('added record spawns (new slot x=51) x2', !B_1.trap && B_1.flag === 0 && B_1.slots.indexOf('x=51') >= 0 && B_1.slots === B_2.slots, B_1.slots);
const PC = packFromRebuild({ B3: drop0(B3) });
const C1 = await census(PC.pack.prg, 9, 150);
const C2 = await census(PC.pack.prg, 9, 150);
ok('B3-only edit leaves B1 identical x2', !C1.trap && C1.slots === STOCK_B1 && C2.slots === STOCK_B1, C1.slots);
const PD = packFromRebuild({ A0: drop0(A0) });
const D1 = await census(PD.pack.prg, 9, 150);
const D2 = await census(PD.pack.prg, 9, 150);
ok('early-list edit (A0) leaves later B1 identical x2', !D1.trap && D1.slots === STOCK_B1 && D2.slots === STOCK_B1, D1.slots);
const E1 = await census(PD.pack.prg, 0, 150, true);
ok('tank area boots clean after table motion', !E1.trap && E1.flag === 0, E1.slots);
console.log('----');
console.log((fail === 0 ? 'P3B ALL ' + pass + ' CHECKS GREEN' : 'P3B FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
