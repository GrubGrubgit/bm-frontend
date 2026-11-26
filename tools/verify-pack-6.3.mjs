// 6.3: tank boss linkage (boss egg type $20 per area, kill chain, $03FB bits).
// Run: node tools/verify-pack-6.3.mjs (from frontend/)
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import * as OV from '../src/pack/overlay.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const b3 = stock.prg[3], b4 = stock.prg[4];
const b7f = stock.prg[7];
const hx = (B, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += B[o + i].toString(16).padStart(2, '0'); return s; };
const u16 = (B, o) => B[o] | (B[o + 1] << 8);
ok('L9FE6 boss actors', hx(b4, 0x1FE6, 8) === '625e605c645e5c66');
ok('LBF8A area bits', hx(b4, 0x3F8A, 8) === '0102040810204080');
ok('A072 area-bit loader', hx(b4, 0x2072, 8) === 'a5142907aabd8abf');
ok('LA100 ora+sta FB', hx(b4, 0x2100, 12) === '200ec12072a00dfb038dfb03');
ok('9F93 and-FC branch', hx(b4, 0x1F93, 8) === '2072a02dfc03d019');
ok('9FBA dec51+L9FE6+FF/FD', hx(b4, 0x1FBA, 16) === 'c651d015a5142907aabde69f8546a9ff');
ok('C742 head', hx(b7f, 0x742, 17) === '2003eaad0220a9208d0620a9008d0620a5');
ok('C742 cmp07+ldaFB+0A', hx(b7f, 0x75C, 11) === 'fb031004a90ad003bd6ac7');
ok('C742 jmpE9B8', hx(b7f, 0x767, 3) === '4cb8e9');
ok('LC76A table', hx(b7f, 0x76A, 8) === '0503060407030409');
ok('newgame clears FE+FB+FC', hx(b7f, 0x2CD, 9) === '8dfe038dfb038dfc03');
ok('dead FF-set @44C', hx(b7f, 0x44C, 5) === 'a9ff8dfb03' && hx(b7f, 0x451, 3) === '4cd5c3');
ok('C56D clears FB', hx(b7f, 0x570, 5) === 'a9008dfb03');
ok('03FC setter pair', hx(b4, 0x2038, 9) === '2072a00dfc038dfc03');
ok('gate x cmp1C', b7f[0xAA9] === 0xC9 && b7f[0xAAA] === 0x1C);
ok('gate y cmp1B', b7f[0xAB9] === 0xC9 && b7f[0xABA] === 0x1B);
ok('dedupe cmp0100,y', hx(b7f, 0xACA, 5) === 'd90001d003');
ok('spawn logs staF8,y', hx(b7f, 0xB4B, 3) === '99f800');
ok('room clear loop', hx(b7f, 0xBA9, 7) === 'a249a9ff9d0001');
const A = u16(b3, 2) - 0x8000;
const tbl = (a) => { const tri = u16(b3, A + a * 2) - 0x8000; return { tb: u16(b3, tri) - 0x8000, xb: u16(b3, tri + 2) - 0x8000, yb: u16(b3, tri + 4) - 0x8000 }; };
const bossIdx = { 0: 29, 1: 125, 2: 164, 3: 3, 4: 186, 5: 19, 6: 42, 7: 122 };
let uniqOk = true, uniqNote = '';
for (let a = 0; a < 8; a++) {
  const t = tbl(a), n = t.yb - t.xb, found = [];
  for (let i = 0; i < n; i++) if (b3[t.tb + i] === 0x20) found.push(i);
  if (found.length !== 1 || found[0] !== bossIdx[a]) { uniqOk = false; uniqNote += 'A' + a + ':' + JSON.stringify(found) + ' '; }
}
ok('one type-20 per tank area', uniqOk, uniqNote);
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
function packWith(list) {
  const p = stock.prg.map(b => b.slice());
  const patches = list.map(pl => { p[pl[0]] = p[pl[0]].slice(); p[pl[0]][pl[1]] = pl[2]; return OV.makePatch('prg', pl[0], pl[1], p[pl[0]].slice(pl[1], pl[1] + 1)); });
  const doc = { customVersion: 1, id: 'c63', name: '63', baseCrc: stock.meta.crc32, patches, editorVersion: '63', builtAt: 't' };
  const v = OV.validateCustomPack(doc);
  if (!v.ok) throw new Error('pack invalid: ' + v.error);
  const rr = OV.applyOverlay(stock, doc);
  if (!rr.ok) throw new Error('overlay failed');
  return rr.pack;
}
async function run(P, o) {
  const sset = new Set(o.snaps);
  const fmax = Math.max(...o.snaps);
  const out = {};
  let trapMsg = null;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : 0);
    if (f === 1000) { if (o.cooked) ex.bm_warp(o.area); else ex.bm_warp_raw(o.area); }
    if (o.jam) for (const jm of o.jam) if (f === jm.f) ex.bm_ram_wr(jm.a, jm.v);
    if (sset.has(f)) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      const snap = mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160);
      const h = (a, n) => { let s = ''; for (let i = 0; i < n; i++) s += snap[a + i].toString(16).padStart(2, '0'); return s; };
      let acts = [];
      for (let s = 0; s < 18; s++) { const b0 = snap[0x400 + s * 14]; if (b0 !== 0) acts.push(s + ':' + b0.toString(16).padStart(2, '0')); }
      out[f] = 'slots=[' + acts.join(' ') + '] fb=' + h(0x3FB, 4);
    }
    if (f + 1 >= fmax + 1) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const o2 = new Uint8Array(banks[0].length * banks.length); banks.forEach((b, i) => o2.set(b, i * banks[0].length)); return o2; };
    mm().set(cat(P.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trapMsg = String((e && e.message) || e).slice(0, 60); }
  return { out, trapMsg };
}
const ev = (r, f) => r.out[f] || 'MISSING';
const hasActor = (r, f, a) => (r.out[f] || '').indexOf(':' + a + ' ') >= 0 || (r.out[f] || '').indexOf(':' + a + ']') >= 0;
const S1 = await run(stock, { area: 0, snaps: [1150] });
const S2 = await run(stock, { area: 0, snaps: [1150] });
ok('stock deterministic x2', !S1.trapMsg && ev(S1, 1150) === ev(S2, 1150), ev(S1, 1150));
const eggJobs = [
  { a: 0, p: [[3, 8701, 0x20]], f: 1200 },
  { a: 1, p: [[3, 9270, 61], [3, 9399, 54]], f: 1200 },
  { a: 2, p: [[3, 9779, 20], [3, 9984, 90]], f: 1200 },
  { a: 3, p: [[3, 10192, 30]], f: 1200 },
  { a: 4, p: [[3, 11140, 90]], f: 1300 },
  { a: 5, p: [[3, 11335, 73], [3, 11468, 119]], f: 1200 },
  { a: 7, p: [[3, 12522, 21]], f: 1300 },
];
for (const j of eggJobs) {
  const P = packWith(j.p);
  const R1 = await run(P, { area: j.a, snaps: [j.f] });
  const R2 = await run(P, { area: j.a, snaps: [j.f] });
  ok('A' + j.a + ' egg x2', !R1.trapMsg && hasActor(R1, j.f, '5b') && ev(R1, j.f) === ev(R2, j.f), ev(R1, j.f));
}
{
  const P = packWith([[3, 8701, 0x20]]);
  const R1 = await run(P, { area: 0, snaps: [1200, 1400] });
  const R2 = await run(P, { area: 0, snaps: [1200, 1400] });
  ok('A0 morph 5b->63 x2', hasActor(R1, 1200, '5b') && hasActor(R1, 1400, '63') && ev(R1, 1200) === ev(R2, 1200) && ev(R1, 1400) === ev(R2, 1400), ev(R1, 1200) + ' / ' + ev(R1, 1400));
}
{
  const P = packWith([[3, 8701, 0x2F]]);
  const o = { area: 0, snaps: [1450, 1550, 1800, 1900], jam: [{ f: 1500, a: 1024 + 8 * 14 + 13, v: 0 }] };
  const R1 = await run(P, o), R2 = await run(P, o);
  ok('kill boss x2', hasActor(R1, 1450, '5d') && ev(R1, 1450) === ev(R2, 1450), ev(R1, 1450));
  ok('kill FD counts', ev(R1, 1550).endsWith('fb=00001900'), ev(R1, 1550));
  ok('kill FB=01+6a x2', hasActor(R1, 1800, '6a') && ev(R1, 1800) === ev(R2, 1800) && ev(R1, 1800).indexOf('fb=01008000') >= 0, ev(R1, 1800));
  ok('kill stable+FC=00', ev(R1, 1900) === ev(R1, 1800), ev(R1, 1900));
}
// ---- item 4: L9FE6 +1 mechanism (actor-62 behavior A571 inc, sole user) ----
{
  const tbase = 0x8006 - 0x8000;
  ok('tank behavior table base 8006', (b4[0x00] | (b4[0x01] << 8)) === 0x8006, hx(b4, 0, 2));
  const e62 = b4[tbase + 97 * 2] | (b4[tbase + 97 * 2 + 1] << 8);
  ok('actor-62 behavior is A571', e62 === 0xA571, e62.toString(16));
  const users = [];
  for (let i = 0; i < 140; i++) { const w = b4[tbase + i * 2] | (b4[tbase + i * 2 + 1] << 8); if (w === 0xA571) users.push(i); }
  ok('A571 sole user is index 97', users.length === 1 && users[0] === 97, JSON.stringify(users));
  ok('A571 init plus inc46+rts', hx(b4, 0x2571, 16) === 'eaeaeaa9808553a90085508551a90085' && hx(b4, 0x2586, 3) === 'e64660', hx(b4, 0x2571, 8));
}
console.log('----');
console.log((fail === 0 ? '6.3 ALL ' + pass + ' CHECKS GREEN' : '6.3 FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
