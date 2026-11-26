// S6: per-site song override (engine+recomp hook 7). Run: node tools/verify-sound-s6.mjs
// Hook 7 rewrites each lifted site LDA into A = song_site_ovr(bank, cpu, stock);
// the pack sites map (custom.sites) populates the table at spawn (host.js).
// Statics pin the model + plumbing; dynamics prove end-to-end request changes
// on three banks (title 7:a30b, conduct 6:9757, tank destruction 4:8c61).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { siteKey, allSiteInfos, serializeTankSongs, serializeSites, sitesMapOf, SITE_HOOK7_UNHOOKED } from '../src/pack/songs.js';
import { validateCustomPack, applyOverlay, makePatch, diffRuns } from '../src/pack/overlay.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const B = stock.prg;
// ---- A. lib statics ----
const rows = allSiteInfos(B);
let I = 0, L = 0, T = 0, Q = 0, mm = 0;
for (const r of rows) {
  if (r.shape === 'I') I++;
  else if (r.shape === 'L') L++;
  else if (r.shape === 'T') T++;
  else Q++;
  if ((r.shape === 'I' || r.shape === 'L') && r.cur !== r.id) mm++;
}
ok('sites classify', rows.length === 110 && I === 106 && L === 3 && T === 1 && Q === 0 && mm === 0, 'n=' + rows.length);
ok('unhooked list', JSON.stringify(SITE_HOOK7_UNHOOKED) === JSON.stringify(['6:a33b', '6:b66c', '6:9f56', '4:ac80', '4:b879', '4:aec1']));
let uhOk = SITE_HOOK7_UNHOOKED.length === 6;
for (const k of SITE_HOOK7_UNHOOKED) {
  const r = rows.find((x) => x.key === k);
  if (!r || r.shape !== 'I' || r.cur !== r.id) uhOk = false;
}
ok('unhooked are I-sites', uhOk);
const m0 = sitesMapOf({});
ok('map empty', m0.ok && Object.keys(m0.map).length === 0);
const m1 = sitesMapOf({ '7:A30B': 48, '6:9757': 45 });
ok('map norm', m1.ok && m1.map['7:a30b'] === 48 && m1.map['6:9757'] === 45 && Object.keys(m1.map).length === 2, JSON.stringify(m1.map));
ok('map refused', !sitesMapOf({ xx: 1 }).ok && !sitesMapOf({ '3:8000': 1 }).ok && !sitesMapOf({ '4:a120': 9 }).ok && !sitesMapOf({ '6:a33b': 9 }).ok && !sitesMapOf({ '7:a30b': 85 }).ok && !sitesMapOf({ '7:a30b': -1 }).ok && !sitesMapOf({ '7:a30b': 2.5 }).ok && sitesMapOf(null).ok);
// ---- B. overlay statics ----
const doc0 = { customVersion: 1, id: 'c-test', name: 't', baseCrc: stock.meta.crc32, patches: [], sites: { '6:9757': 45 } };
const v0 = validateCustomPack(doc0);
ok('overlay accept', v0.ok && v0.sites && v0.sites['6:9757'] === 45);
const badK = validateCustomPack({ customVersion: 1, id: 'c-t', name: 't', baseCrc: stock.meta.crc32, patches: [], sites: { '6:975x': 1 } });
const badB = validateCustomPack({ customVersion: 1, id: 'c-t', name: 't', baseCrc: stock.meta.crc32, patches: [], sites: { '3:8000': 1 } });
const badV = validateCustomPack({ customVersion: 1, id: 'c-t', name: 't', baseCrc: stock.meta.crc32, patches: [], sites: { '6:9757': 85 } });
const many = {}; for (let i = 0; i < 111; i++) many['6:' + (0x8000 + i).toString(16)] = 1;
const badM = validateCustomPack({ customVersion: 1, id: 'c-t', name: 't', baseCrc: stock.meta.crc32, patches: [], sites: many });
ok('overlay refused', !badK.ok && !badB.ok && !badV.ok && !badM.ok);
const r0 = applyOverlay(stock, doc0);
ok('overlay passthrough', r0.ok && r0.pack.custom.sites && r0.pack.custom.sites['6:9757'] === 45);
const doc1 = { customVersion: 1, id: 'c-t2', name: 't', baseCrc: stock.meta.crc32, patches: [] };
const r1 = applyOverlay(stock, doc1);
ok('overlay absent', r1.ok && r1.pack.custom.sites === undefined);
// ---- C. source statics ----
const ed = readFileSync(PROJ + '/frontend/src/ui/editor.js', 'utf8');
const hx = readFileSync(PROJ + '/frontend/index.html', 'utf8');
const ho = readFileSync(PROJ + '/frontend/src/core/host.js', 'utf8');
const ba = readFileSync(PROJ + '/frontend/src/core/bm_api.c', 'utf8');
const bg = readFileSync(PROJ + '/frontend/tools/build_game.sh', 'utf8');
ok('editor site edit', ed.includes('effSite') && ed.includes('commitSite') && ed.includes('S.edSites') && ed.includes('sitesMapOf(S.edSites') && ed.includes('doc.sites') && ed.includes('siteLiveMap') && ed.includes('unlifted'));
ok('editor tank intact', ed.includes('serializeTankSongs(S.resolved.prg[4]'));
ok('host apply', ho.includes('bm_siteovr_reset') && ho.includes('bm_siteovr_set') && ho.includes('pack.custom.sites'));
ok('engine table', ba.includes('song_site_ovr') && ba.includes('SITEOVR_MAX') && ba.includes('bm_siteovr_reset') && ba.includes('bm_siteovr_info'));
ok('build hook7', bg.includes('tools/patch_hook7.py'));
// ---- D. engine dynamics ----
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function cat(banks) { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; }
const i0 = (await WebAssembly.instantiate(WASMB, { env: { host_frame: () => {} } })).instance;
ok('exports live', typeof i0.exports.bm_siteovr_set === 'function' && typeof i0.exports.bm_siteovr_reset === 'function' && typeof i0.exports.bm_siteovr_info === 'function');
ok('hook7 info', i0.exports.bm_siteovr_info() === 0x67006a, 'info=' + i0.exports.bm_siteovr_info().toString(16));
async function trace(banks, span, padFn, warp, ovr) {
  const evs = []; let last = -1; let n = -1;
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
    const ex = inst.exports;
    const mm8 = new Uint8Array(ex.memory.buffer);
    mm8.set(cat(banks), ex.bm_stage_ptr()); ex.bm_load_prg();
    mm8.set(cat(stock.chr), ex.bm_stage_ptr()); ex.bm_load_chr();
    ex.bm_siteovr_reset();
    if (ovr) for (const o of ovr) ex.bm_siteovr_set(o[0], o[1], o[2]);
    ex.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message }; }
  return { evs };
}
const bootPad = () => 0;
const startPad = (n) => n === 61 ? 8 : 0;
const tapPad = (n) => n === 61 ? 8 : ((n >= 900 && n < 910) ? 2 : 0);
const atT = (evs, e) => evs.filter((s) => s[1] === e).map((s) => s[0]);
const TC = await trace(B, 900, bootPad, null, null);
ok('title control', TC.trap === undefined && atT(TC.evs, 84)[0] === 404, JSON.stringify(TC.evs));
const T1 = await trace(B, 900, bootPad, null, [[7, 0xa30b, 0x30]]);
const T2 = await trace(B, 900, bootPad, null, [[7, 0xa30b, 0x30]]);
const stripT = (evs) => evs.filter((s) => s[1] !== 84 && s[1] !== 48);
ok('title override', T1.trap === undefined && atT(T1.evs, 48)[0] === 404 && atT(T1.evs, 84).indexOf(404) < 0, JSON.stringify(T1.evs));
ok('title determinism', JSON.stringify(T1.evs) === JSON.stringify(T2.evs));
ok('title stripped-eq', JSON.stringify(stripT(T1.evs)) === JSON.stringify(stripT(TC.evs)));
const CC = await trace(B, 960, tapPad, { n: 700, k: 1, raw: false }, null);
ok('tap control', CC.trap === undefined && JSON.stringify(CC.evs.slice(0, 7)) === JSON.stringify([[0, 0], [73, 6], [298, 78], [686, 45], [888, 66], [902, 31], [904, 66]]), JSON.stringify(CC.evs.slice(0, 8)));
const norm902 = (evs) => evs.map((s) => (s[0] === 902 && (s[1] === 31 || s[1] === 45 || s[1] === 46)) ? [902, 'X'] : s);
const D1 = await trace(B, 960, tapPad, { n: 700, k: 1, raw: false }, [[6, 0x9757, 0x2d]]);
const D2 = await trace(B, 960, tapPad, { n: 700, k: 1, raw: false }, [[6, 0x9757, 0x2d]]);
ok('tap override 2D', D1.trap === undefined && atT(D1.evs, 45).indexOf(902) >= 0 && atT(D1.evs, 31).indexOf(902) < 0, JSON.stringify(D1.evs.slice(4, 8)));
ok('tap determinism', JSON.stringify(D1.evs) === JSON.stringify(D2.evs));
ok('tap stripped-eq', JSON.stringify(norm902(D1.evs)) === JSON.stringify(norm902(CC.evs)));
const E1 = await trace(B, 960, tapPad, { n: 700, k: 1, raw: false }, [[6, 0x9757, 0x2e]]);
ok('tap override 2E', E1.trap === undefined && JSON.stringify(atT(E1.evs, 46)) === JSON.stringify([902]) && atT(E1.evs, 31).indexOf(902) < 0, JSON.stringify(E1.evs.slice(4, 8)));
ok('tap 2E stripped-eq', JSON.stringify(norm902(E1.evs)) === JSON.stringify(norm902(CC.evs)));
const KC = await trace(B, 2300, startPad, { n: 700, k: 0, raw: true }, null);
ok('tank control', KC.trap === undefined && JSON.stringify(KC.evs) === JSON.stringify([[0, 0], [73, 6], [298, 78], [686, 45], [938, 30], [1162, 81], [1330, 6], [1567, 30], [1791, 81], [1959, 6], [2196, 30]]), JSON.stringify(KC.evs));
const K1 = await trace(B, 2300, startPad, { n: 700, k: 0, raw: true }, [[4, 0x8c61, 0x30]]);
const K2 = await trace(B, 2300, startPad, { n: 700, k: 0, raw: true }, [[4, 0x8c61, 0x30]]);
const swap81 = (evs) => evs.map((s) => (s[1] === 48) ? [s[0], 81] : s);
ok('tank override', K1.trap === undefined && atT(K1.evs, 48).join(',') === '1162,1791' && atT(K1.evs, 81).length === 0, JSON.stringify(K1.evs));
ok('tank determinism', JSON.stringify(K1.evs) === JSON.stringify(K2.evs));
ok('tank stripped-eq', JSON.stringify(swap81(K1.evs)) === JSON.stringify(KC.evs));
// ---- E. pack roundtrip (editor-shaped doc -> overlay -> spawn-apply) ----
const edSites = { '7:a30b': 48 };
const smE = sitesMapOf(edSites);
const szE = serializeSites(B, edSites);
const runsE = [];
for (const b of szE.banks) for (const run of diffRuns(stock.prg[b], szE.bytes[b])) runsE.push(makePatch('prg', b, run.off, run.bytes));
const docE = { customVersion: 1, id: 'c-s6test', name: 's6test', baseCrc: stock.meta.crc32, patches: runsE, editorVersion: 'p3', builtAt: 't' };
if (smE.ok) docE.sites = smE.map;
const vE = validateCustomPack(docE);
const rE = applyOverlay(stock, docE);
ok('pack roundtrip shape', smE.ok && szE.ok && vE.ok && rE.ok && runsE.length === 1 && rE.pack.custom.sites['7:a30b'] === 48 && rE.pack.prg[7][8970] === 48, 'patches=' + runsE.length);
async function tracePack(pack) {
  const evs = []; let last = -1; let n = -1;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = inst.exports;
    ex.bm_set_pad(bootPad(n));
    ex.bm_snap();
    const e9 = ex.bm_ram_rd(0xE9);
    if (e9 !== last) { evs.push([n, e9]); last = e9; }
    if (n >= 900) throw new Error('STOP');
  } } })).instance;
  try {
    const ex = inst.exports;
    const mm8 = new Uint8Array(ex.memory.buffer);
    let prg = new Uint8Array(8 * 16384), chr = new Uint8Array(16 * 8192);
    for (let i = 0; i < 8; i++) prg.set(pack.prg[i], i * 16384);
    for (let j = 0; j < 16; j++) chr.set(pack.chr[j], j * 8192);
    mm8.set(new Uint8Array(prg), ex.bm_stage_ptr());
    ex.bm_load_prg();
    mm8.set(new Uint8Array(chr), ex.bm_stage_ptr());
    ex.bm_load_chr();
    ex.bm_siteovr_reset();
    var s6sm = (pack && pack.custom && pack.custom.sites) || null;
    if (s6sm) for (var s6sk in s6sm) {
      var s6sp = String(s6sk).split(':');
      ex.bm_siteovr_set(+s6sp[0], parseInt(s6sp[1], 16), s6sm[s6sk] | 0);
    }
    ex.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message }; }
  return { evs };
}
const PE = await tracePack(rE.pack);
ok('pack roundtrip live', PE.trap === undefined && atT(PE.evs, 48)[0] === 404 && atT(PE.evs, 84).indexOf(404) < 0, JSON.stringify(PE.evs));
console.log('---- s6: ' + pass + ' pass / ' + fail + ' ----');
if (fail) process.exit(1);
