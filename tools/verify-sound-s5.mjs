import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { TANK_SONGS, tankTableOffset, getTankSongs, serializeTankSongs, siteKey, sitePatchInfo, allSiteInfos, serializeSites } from '../src/pack/songs.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const B = stock.prg;
ok('tank const', TANK_SONGS.BANK === 4 && TANK_SONGS.COUNT === 8);
const toff = tankTableOffset(B[4]);
let hits = 0;
const seq = [42, 9, 9, 42, 9, 9, 42, 9];
for (let i = 0; i + 8 <= B[4].length; i++) { let m = true; for (let k = 0; k < 8; k++) if (B[4][i + k] !== seq[k]) { m = false; break; } if (m) hits++; }
ok('tank table', toff === 8484 && hits === 1 && getTankSongs(B[4]).join(',') === seq.join(','), 'off=' + toff + ' hits=' + hits);
ok('tank bad', getTankSongs(null) === null && tankTableOffset(null) === -1);
const rows = allSiteInfos(B);
let I = 0, L = 0, T = 0, Q = 0, mm = 0;
for (const r of rows) {
  if (r.shape === 'I') I++;
  else if (r.shape === 'L') L++;
  else if (r.shape === 'T') T++;
  else Q++;
  if ((r.shape === 'I' || r.shape === 'L') && r.cur !== r.id) mm++;
}
ok('sites classify', rows.length === 110 && I === 106 && L === 3 && T === 1 && Q === 0 && mm === 0, 'n=' + rows.length + ' I=' + I + ' L=' + L + ' T=' + T + ' Q=' + Q + ' mm=' + mm);
let guards = 0;
for (const r of rows) {
  if (r.shape !== 'I' && r.shape !== 'L') continue;
  const BB = B[r.bank];
  if (r.shape === 'I' && BB[r.off - 1] === 169 && BB[r.off + 1] === 32) guards++;
  if (r.shape === 'L' && BB[r.off - 1] === 169) guards++;
}
ok('site guards', guards === 109, 'guards=' + guards);
ok('siteKey', siteKey(7, 41739) === '7:a30b');
const noop = serializeSites(B, {});
let noopSame = noop.ok;
if (noopSame) for (let b = 0; b < B.length; b++) if (!noop.bytes[b].every((v, i) => v === B[b][i])) noopSame = false;
ok('ser noop', noopSame);
const one = serializeSites(B, { '7:a30b': 78 });
let diffs = 0, at = -1;
if (one.ok) for (let b = 0; b < B.length; b++) for (let i = 0; i < B[b].length; i++) if (one.bytes[b][i] !== B[b][i]) { diffs++; at = b + ':' + i; }
ok('ser one-byte', one.ok && diffs === 1 && at === '7:8970' && one.bytes[7][8970] === 78 && one.banks.join(',') === '7', 'diffs=' + diffs + ' at=' + at);
ok('ser refused', !serializeSites(B, { '7:0': 1 }).ok && !serializeSites(B, { '7:a30b': 85 }).ok && !serializeSites(B, { '7:a30b': -1 }).ok && !serializeSites(B, { xx: 1 }).ok && !serializeSites(null, {}).ok);
const tn = serializeTankSongs(B[4], {});
ok('tank noop', tn.ok && tn.bytes.every((v, i) => v === B[4][i]));
const t1 = serializeTankSongs(B[4], { 0: 78 });
let td = 0;
for (let i = 0; i < B[4].length; i++) if (t1.bytes[i] !== B[4][i]) td++;
ok('tank one-byte', t1.ok && td === 1 && t1.bytes[toff] === 78, 'td=' + td);
ok('tank refused', !serializeTankSongs(B[4], { 8: 1 }).ok && !serializeTankSongs(B[4], { 0: 85 }).ok && !serializeTankSongs(null, {}).ok);
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function cat(banks) { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; }
async function trace(banks, span, padFn, warp) {
  const evs = [];
  let last = -1;
  let n = -1;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = inst.exports;
    ex.bm_set_pad(padFn(n));
    if (warp && n === warp.n) (warp.raw ? ex.bm_warp_raw(warp.k) : ex.bm_warp(warp.k));
    ex.bm_snap();
    const e9 = ex.bm_ram_rd(0xE9);
    if (e9 !== last) { evs.push([n, e9]); last = e9; }
    if (n >= span) throw new Error('STOP');
  } } })).instance;
  try {
    const mm8 = new Uint8Array(inst.exports.memory.buffer);
    mm8.set(cat(banks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm8.set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message }; }
  return { evs };
}
const atT = (evs, e) => evs.filter((s) => s[1] === e).map((s) => s[0]);
const bootPad = () => 0;
const startPad = (n) => n === 61 ? 8 : 0;
const tapPad = (n) => n === 61 ? 8 : ((n >= 900 && n < 910) ? 2 : 0);
const BC = await trace(B, 900, bootPad, null);
ok('title anchor', BC.trap === undefined && atT(BC.evs, 84)[0] === 404, JSON.stringify(BC.evs));
const BT = await trace(serializeSites(B, { '7:a30b': 78 }).bytes, 900, bootPad, null);
ok('title site no-effect', BT.trap === undefined && atT(BT.evs, 84)[0] === 404 && atT(BT.evs, 78).length === 0, JSON.stringify(BT.evs));
const CC = await trace(B, 960, tapPad, { n: 700, k: 1, raw: false });
const ccPre = JSON.stringify(CC.evs.slice(0, 4)) === JSON.stringify([[0, 0], [73, 6], [298, 78], [686, 45]]); ok('conduct control', CC.trap === undefined && ccPre && JSON.stringify(atT(CC.evs, 31)) === JSON.stringify([902]) && atT(CC.evs, 66).indexOf(904) >= 0, JSON.stringify(CC.evs));
const KC = await trace(B, 2300, startPad, { n: 700, k: 0, raw: true });
const k81 = atT(KC.evs, 81);
ok('tank control', KC.trap === undefined && JSON.stringify(k81) === JSON.stringify([1162, 1791]), JSON.stringify(KC.evs));
const cook = (banks) => { const c = banks.map((b) => b.slice()); c[3][8701] = 32; return c; };
const BC2 = await trace(cook(B), 2000, startPad, { n: 1000, k: 0, raw: true });
ok('boss control', BC2.trap === undefined && atT(BC2.evs, 42).join(',') === '1609' && atT(BC2.evs, 8).indexOf(1134) >= 0, JSON.stringify(BC2.evs));
const ckB = cook(B); ckB[4] = serializeTankSongs(B[4], { 0: 48 }).bytes;
const BP = await trace(ckB, 2000, startPad, { n: 1000, k: 0, raw: true });
const strip4248 = (evs) => evs.filter((s) => s[1] !== 42 && s[1] !== 48); ok('boss table swap', BP.trap === undefined && atT(BP.evs, 42).length === 0 && atT(BP.evs, 48).join(',') === '1609' && JSON.stringify(strip4248(BP.evs)) === JSON.stringify(strip4248(BC2.evs)), JSON.stringify(BP.evs));
const BP2 = await trace(ckB, 2000, startPad, { n: 1000, k: 0, raw: true });
ok('boss determinism', JSON.stringify(BP.evs) === JSON.stringify(BP2.evs));
const ed = readFileSync(PROJ + '/frontend/src/ui/editor.js', 'utf8');
const hx = readFileSync(PROJ + '/frontend/index.html', 'utf8');
ok('browser sites', ed.includes('renderSites') && ed.includes('edSiteFilter') && ed.includes('commitSite') && ed.includes('S.edSites'));
ok('tank edit fns', ed.includes('effTankSong') && ed.includes('commitTankSong') && ed.includes('renderTankSongs') && ed.includes('S.edTankSongs'));
ok('tank save path', ed.includes('serializeTankSongs(S.resolved.prg[4]'));
ok('site save path', ed.includes('serializeSites(S.resolved.prg') && ed.includes('doc.sites'));
ok('html sites', hx.includes('edSiteTbl') && hx.includes('edSiteFilter') && hx.includes('edSiteInfo'));
ok('html tank', hx.includes('edTankTbl') && hx.includes('edTankInfo'));
console.log('---- s5: ' + pass + ' pass / ' + fail + ' fail ----');
if (fail) process.exit(1);
