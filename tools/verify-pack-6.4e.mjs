// 6.4e sound engine v1: bank-5 driver map + song table + headless song proofs.
// Run: node tools/verify-pack-6.4e.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { SOUND_BANK, DRIVER, QUEUE, CUR_SONG, PERIOD_TABLE, SONG_TABLE, AREA_SONGS, REQ, OBSERVED, songForArea, isSongId, REQ_PATHS, MUSIC, SITES, sitesFor, siteCount, JASON_SLOT, TANK_DESTRUCTION } from '../src/pack/sound.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
// ---- statics: lib model ----
ok('lib driver addrs', DRIVER.INIT === 0x8000 && DRIVER.START === 0x8013 && DRIVER.TICK === 0x8077 && DRIVER.VEC_INIT === 0xBFE5 && DRIVER.VEC_START === 0xBFE8 && DRIVER.VEC_TICK === 0xBFF1);
ok('lib queue+cur', QUEUE.BASE === 0x0370 && QUEUE.SLOTS === 8 && CUR_SONG === 0xE9);
ok('lib area songs', AREA_SONGS.join(',') === '6,4,2,19,7,5,55,43' && songForArea(8) === 6 && songForArea(9) === 4 && songForArea(0) === 6 && songForArea(15) === 43);
ok('lib isSongId', isSongId(0) && isSongId(84) && !isSongId(85) && !isSongId(-1));
ok('lib named ids', REQ.TITLE === 0x54 && REQ.INTRO === 0x4E && REQ.DEATH === 0x3D && REQ.DOOR_SAME === 0x39 && REQ.DOOR_DUNGEON === 0x01 && REQ.DOOR_OVERHEAD === 0x38 && OBSERVED.BGM_DUNGEON === 0x2D);
// ---- statics: ROM pins ----
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const B5 = stock.prg[SOUND_BANK];
const pw = []; for (let i = 0; i < PERIOD_TABLE.WORDS; i++) pw.push(B5[PERIOD_TABLE.OFFSET + i * 2] | (B5[PERIOD_TABLE.OFFSET + i * 2 + 1] << 8));
ok('rom period table', pw[0] === 0x06AE && pw[1] === 0x064E && pw[96] === 0x0000 && pw.every((w, i) => i === 0 || w < pw[i - 1]), 'w0=' + pw[0].toString(16));
const sw = []; for (let i = 0; i < SONG_TABLE.COUNT; i++) sw.push(B5[SONG_TABLE.OFFSET + i * 2] | (B5[SONG_TABLE.OFFSET + i * 2 + 1] << 8));
ok('rom song table', sw.length === 85 && sw.every(w => w >= 0x8000 && w < 0xC000) && sw[0] === 0x983A && sw[6] === 0x983A && new Set(sw).size === 84, 'distinct=' + new Set(sw).size);
let areaHits = []; for (let b = 0; b < stock.prg.length; b++) { const B = stock.prg[b]; for (let i = 0; i + 8 <= B.length; i++) { let m = true; for (let k = 0; k < 8; k++) if (B[i + k] !== AREA_SONGS[k]) { m = false; break; } if (m) areaHits.push(b + ':' + i); } }
ok('rom area table in fixed bank', areaHits.length === 1 && areaHits[0].startsWith('7:'), JSON.stringify(areaHits));
ok('rom driver opcodes', B5[0] === 0xA9 && B5[1] === 0x00 && B5[2] === 0x85 && B5[0x13] === 0x85 && B5[0x14] === 0xE9 && [0x4C,0x13,0x80].every((v, i) => B5[0x3FE8 + i] === v) && [0x4C,0x77,0x80].every((v, i) => B5[0x3FF1 + i] === v));
// ---- dynamics harness ----
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function cat(banks) { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; }
const SP = 0x20000;
async function run(padFn, warps, span) {
  let n = -1; const first = {}; const per = {}; let hash = 2166136261 >>> 0; const addrs = {}; let saw4017 = false; let dmc = false;
  const mix = (v) => { hash ^= v; hash = Math.imul(hash, 16777619) >>> 0; };
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = inst.exports;
    ex.bm_set_pad(padFn(n));
    for (const w of warps) if (n === w.n) (w.raw ? ex.bm_warp_raw(w.k) : ex.bm_warp(w.k));
    ex.bm_snap();
    const e9 = ex.bm_ram_rd(0xE9);
    if (!(e9 in first)) first[e9] = n;
    mix(e9);
    const got = ex.bm_audio_read(SP, 256);
    const mem = new Uint8Array(ex.memory.buffer);
    if (!per[e9]) per[e9] = { frames: 0, ev: 0 };
    if (got > 0) per[e9].frames++;
    per[e9].ev += got;
    for (let i = 0; i < got; i++) {
      const a = mem[SP + i * 8] | (mem[SP + i * 8 + 1] << 8); const v = mem[SP + i * 8 + 2];
      addrs[a] = (addrs[a] || 0) + 1; mix(a); mix(v);
      if (a === 0x4017) saw4017 = true;
      if (a === 0x4015 && (v & 0x10)) dmc = true;
    }
    if (n >= span) throw new Error('STOP');
  } } })).instance;
  try {
    const mm8 = new Uint8Array(inst.exports.memory.buffer);
    mm8.set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm8.set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message }; }
  return { first, per, hash, addrs, saw4017, dmc };
}
const key = (R) => Object.keys(R.first).map(Number).sort((a, b) => a - b).join(',');
const sig = (R) => R.hash.toString(16) + '|' + key(R) + '|' + Object.keys(R.per).map(Number).sort((a, b) => a - b).map(k => k + ':' + R.per[k].frames + '/' + R.per[k].ev).join(',');
// ---- title: no input ----
const T = await run(() => 0, [], 900);
ok('title song $54@404', T.trap === undefined && T.first[0] === 0 && T.first[84] === 404, JSON.stringify(T.first));
ok('title song84 extent', T.per[84].frames === 497 && T.per[84].ev === 1256, JSON.stringify(T.per[84]));
ok('title init writes', T.per[0].ev === 5 && T.addrs[0x4010] === 1, 'addrs=' + JSON.stringify(T.addrs));
const T2 = await run(() => 0, [], 900);
ok('title determinism x2', sig(T) === sig(T2));
// ---- Start@61: area-8 intro medley -> dungeon BGM ----
const S = await run((n) => n === 61 ? 8 : 0, [], 1200);
ok('start sequence 6/78/45', S.first[6] === 73 && S.first[78] === 298 && S.first[45] === 686, JSON.stringify(S.first));
ok('start song extents', S.per[6].frames === 225 && S.per[6].ev === 707 && S.per[78].frames === 380 && S.per[78].ev === 1354, '6=' + JSON.stringify(S.per[6]) + ' 78=' + JSON.stringify(S.per[78]));
const S2 = await run((n) => n === 61 ? 8 : 0, [], 1200);
ok('start determinism x2', sig(S) === sig(S2));
const allA = Object.keys(S.addrs).map(Number);
ok('addr audit range', allA.every(a => (a >= 0x4000 && a <= 0x400F) || a === 0x4015 || a === 0x4010), JSON.stringify(allA.map(a => a.toString(16))));
ok('addr audit no-4017 no-dmc', S.saw4017 === false && S.dmc === false);
ok('song contrast title vs area8', key(T) === '0,84' && key(S) === '0,6,45,78');
// ---- area-9 rotation + area-0 cues (requesters TBD v2) ----
const W1 = await run((n) => n === 61 ? 8 : 0, [{ n: 800, k: 1, raw: false }], 1260);
ok('warp1 firsts', W1.first[66] === 988 && W1.first[60] === 1054 && W1.first[41] === 1218, JSON.stringify(W1.first));
ok('warp1 song set', key(W1) === '0,6,41,45,60,66,78');
const W12 = await run((n) => n === 61 ? 8 : 0, [{ n: 800, k: 1, raw: false }], 1260);
ok('warp1 determinism x2', sig(W1) === sig(W12));
const W0 = await run((n) => n === 61 ? 8 : 0, [{ n: 800, k: 0, raw: true }], 1300);
ok('warp0 firsts+set', W0.first[30] === 1038 && W0.first[81] === 1262 && key(W0) === '0,6,30,45,78,81');
const W02 = await run((n) => n === 61 ? 8 : 0, [{ n: 800, k: 0, raw: true }], 1300);
ok('warp0 determinism x2', sig(W0) === sig(W02));
console.log(fail === 0 ? 'ALL_GREEN_6.4e' : 'FAILURES_6.4e:' + fail);
// ---- 6.4e v2: music-state machine (requester logic) ----
ok('v2 lib MUSIC ids', MUSIC.BGM_DUNGEON === 0x2D && MUSIC.HIT_DUNGEON === 0x3C && MUSIC.HIT_TANK === 0x1E && MUSIC.EXPLOSION === 0x51 && MUSIC.VOCALIZE === 0x42 && MUSIC.VOCALIZE_RANDOM === 0x29 && MUSIC.BOMB_SONG === 0x34 && MUSIC.CONDUCT_1F === 0x1F && MUSIC.SPAWN === 0x28 && MUSIC.DOOR_FANFARE === 0x2E && MUSIC.DEATH_CHAIN.join(',') === '44,63,64');
ok('v2 lib machine consts', REQ_PATHS.BANK6 === 50 && REQ_PATHS.BANK4 === 43 && REQ_PATHS.BANK7 === 15 && JASON_SLOT.HIT === 2 && JASON_SLOT.STAGING === 3 && TANK_DESTRUCTION.SONG === 0x51 && TANK_DESTRUCTION.CYCLE_IDLE === 629 && siteCount() === 110 && sitesFor(0x2D).length === 1 && sitesFor(0x2D)[0].cpu === 0x9499 && sitesFor(0x42).length === 2);
const B6 = stock.prg[6], B4 = stock.prg[4], B7 = stock.prg[7];
function census(B, lo, hi) { const ids = []; let tails = 0; for (let i = 0; i + 2 < B.length; i++) { if (B[i] === 0x20 && B[i+1] === lo && B[i+2] === hi) { if (B[i-2] === 0xA9) ids.push(B[i-1].toString(16)); else tails++; } } ids.sort((a, b) => parseInt(a, 16) - parseInt(b, 16)); return { ids, tails }; }
const c6 = census(B6, 0xCC, 0xDE), c4 = census(B4, 0x16, 0xC2), c7 = census(B7, 0xCC, 0xDE);
ok('v2 census6', c6.ids.join(',') === '1d,1d,20,23,24,24,24,25,25,27,27,27,28,28,28,28,29,29,29,29,2c,2d,2e,2f,2f,30,31,32,33,34,3b,3c,3e,3e,3f,40,41,41,42,42,43,43,44,45,46,4a,4c,4d,51' && c6.tails === 1, 'tails=' + c6.tails);
ok('v2 census4', c4.ids.join(',') === '8,a,b,c,d,e,10,11,12,14,15,15,16,16,1a,1a,1a,1b,1b,1b,1b,1b,1c,1e,1e,24,28,28,2c,35,37,3a,3f,40,47,48,49,4b,4f,50,51,52' && c4.tails === 1, 'tails=' + c4.tails);
ok('v2 census7', c7.ids.join(',') === '1,3,c,d,17,18,18,19,1d,36,38,39,3d,4e,54' && c7.tails === 0, 'tails=' + c7.tails);
function jsrCount(B, lo, hi) { let n = 0; for (let i = 0; i + 2 < B.length; i++) if (B[i] === 0x20 && B[i+1] === lo && B[i+2] === hi) n++; return n; }
function staCount(B) { let n = 0; for (let i = 0; i + 2 < B.length; i++) if (B[i] === 0x8D && B[i+1] === 0x70 && B[i+2] === 0x03) n++; return n; }
const ccde = stock.prg.map((B) => jsrCount(B, 0xCC, 0xDE)), lc2 = stock.prg.map((B) => jsrCount(B, 0x16, 0xC2)), stas = stock.prg.map(staCount);
ok('v2 xbank exclusivity', ccde.join(',') === '0,0,0,0,0,0,50,15' && lc2.join(',') === '0,0,0,0,43,0,0,0' && stas.every((n) => n === 0), 'ccde=' + ccde.join(',') + ' lc2=' + lc2.join(','));
let siteFails = []; const perBank = { 4: 0, 6: 0, 7: 0 };
for (const k in SITES) for (const s of SITES[k]) { perBank[s.b]++; const B = s.b === 6 ? B6 : s.b === 4 ? B4 : B7; const i = s.cpu - 0x8000; const pair = s.b === 4 ? [0x16, 0xC2] : [0xCC, 0xDE]; const isJsr = B[i] === 0x20 && B[i+1] === pair[0] && B[i+2] === pair[1]; const isLda = B[i] === 0xA9 && B[i+1] === parseInt(k, 16); if (!isJsr && !isLda) siteFails.push(k + '@' + s.cpu.toString(16)); }
const romJsr = (B, lo, hi) => { const t = new Set(); for (let i = 0; i + 2 < B.length; i++) if (B[i] === 0x20 && B[i+1] === lo && B[i+2] === hi) t.add(i + 0x8000); return t; }; const miss6 = romJsr(B6, 0xCC, 0xDE), miss4 = romJsr(B4, 0x16, 0xC2), miss7 = romJsr(B7, 0xCC, 0xDE); for (const k in SITES) for (const t of SITES[k]) { if (t.b === 6) miss6.delete(t.cpu); else if (t.b === 4) miss4.delete(t.cpu); else miss7.delete(t.cpu); } ok('v2 sites-x-rom', siteFails.length === 0 && JSON.stringify([...miss6]) === '[38761]' && miss4.size === 0 && miss7.size === 0, siteFails.join(' ') + ' miss6=' + JSON.stringify([...miss6]) + ' miss4=' + JSON.stringify([...miss4]));
const hb = (arr) => arr.map((v) => v.toString(16)).join(' ');
const at6 = (cpu, n) => Array.from(B6.slice(cpu - 0x8000, cpu - 0x8000 + n)), at4 = (cpu, n) => Array.from(B4.slice(cpu - 0x8000, cpu - 0x8000 + n));
ok('v2 conduct triple', hb(at6(0x9757, 21)) === 'a9 1f a2 0 f0 a a9 21 a2 1 d0 4 a9 22 a2 2 86 b9 20 cc de', hb(at6(0x9757, 21)));
ok('v2 vocalize gate', hb(at6(0xA40E, 24)) === 'a9 80 85 42 a9 40 85 43 a5 50 d0 6b a5 52 f0 5 c6 52 4c 4e a4 a5 11 29', hb(at6(0xA40E, 24)));
ok('v2 grid bytes', hb(at6(0xA423, 11)) === 'a5 11 29 f d0 5 a9 42 20 cc de', hb(at6(0xA423, 11)));
ok('v2 hush52 paths', hb(at6(0xA447, 7)) === '29 f 18 69 18 85 52' && hb(at6(0xA463, 10)) === '20 71 eb 29 f 18 69 30 85 52', hb(at6(0xA463, 10)));
ok('v2 rng29', hb(at6(0xA477, 9)) === 'a9 29 20 cc de a9 e0 85 4d', hb(at6(0xA477, 9)));
const dcB6 = hb(at6(0x9CDA, 28)), dcB4 = hb(at4(0x9690, 28));
ok('v2 deathchain twins', dcB6 === dcB4 && dcB6 === 'a2 2 bd f0 6 c9 64 90 5 a9 63 9d f0 6 ca 10 f1 a5 50 c9 6 b0 13 4a b0 8 a9 2c' && hb(at6(0x9CF9, 16)) === '4c 9 9d a9 3f 20 cc de 4c 9 9d a9 40 20 cc de', dcB6);
ok('v2 bomb880B', hb(at6(0x880B, 25)) === 'a5 f3 29 40 f0 18 a9 1c 85 0 a2 e 20 cf d7 f0 d a9 2a 9d 0 4 20 c0 d7' && hb(at6(0x8824, 5)) === 'a9 34 20 cc de', hb(at6(0x8824, 5)));
ok('v2 tankdestroy', hb(at4(0x8C46, 24)) === 'a5 53 d0 1d a5 4f d0 16 a9 4 85 46 a9 0 85 51 a5 c5 9 8 85 c5 20 c0' && hb(at4(0x8C5C, 8)) === '20 c0 c0 a9 51 20 16 c2', hb(at4(0x8C5C, 8)));
ok('v2 jason948B', hb(at6(0x948B, 16)) === 'a5 f3 10 4e a9 2e 20 cc de 4c 9c 94 a9 2d 20 cc', hb(at6(0x948B, 16)));
ok('v2 la124', hb(at4(0xA118, 12)) === 'a5 14 29 7 aa bd 24 a1 20 16 c2 60' && hb(at4(0xA124, 8)) === '2a 9 9 2a 9 9 2a 9', hb(at4(0xA118, 19)));
// ---- v2 dynamics: headless oracles (all x2) ----
async function run2(padFn, warp, span, log) {
  let n = -1;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = inst.exports;
    ex.bm_set_pad(padFn(n));
    if (warp && n === warp.n) (warp.raw ? ex.bm_warp_raw(warp.k) : ex.bm_warp(warp.k));
    ex.bm_snap();
    log(n, ex);
    if (n >= span) throw new Error('STOP');
  } } })).instance;
  try {
    const mm8 = new Uint8Array(inst.exports.memory.buffer);
    mm8.set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm8.set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message }; }
  return {};
}
async function area9trace() { const starts = []; let last = -1; await run2((n) => n === 61 ? 8 : 0, { n: 700, k: 1, raw: false }, 1400, (n, ex) => { const e9 = ex.bm_ram_rd(0xE9); if (e9 !== last) { starts.push([n, e9, ex.bm_ram_rd(0x11)]); last = e9; } }); return starts; }
const g1 = await area9trace(), g2 = await area9trace();
const s66 = g1.filter((s) => s[1] === 66);
ok('v2 grid phase', s66.length >= 5 && s66.every((s) => (s[2] & 15) === 1), JSON.stringify(s66.map((s) => s[2])));
const s60 = g1.filter((s) => s[1] === 60).map((s) => s[0]);
const at45 = new Set(g1.filter((s) => s[1] === 45).map((s) => s[0]));
ok('v2 hit pairing', s60.length >= 5 && s60.every((t) => at45.has(t + 2)), JSON.stringify(s60));
ok('v2 presence', g1.some((s) => s[1] === 41) && !g1.some((s) => s[1] === 31) && !g1.some((s) => s[1] === 52), JSON.stringify(g1.map((s) => s[1])));
ok('v2 grid determinism x2', JSON.stringify(g1) === JSON.stringify(g2));
async function introtrace() { const evs = []; let last = ''; await run2((n) => n === 61 ? 8 : 0, null, 760, (n, ex) => { if (n < 600) return; const s = [ex.bm_ram_rd(0xE9), ex.bm_ram_rd(0x40A), ex.bm_ram_rd(0x8F)].join(','); if (s !== last) { evs.push([n, s]); last = s; } }); return evs; }
const d1 = await introtrace(), d2 = await introtrace();
ok('v2 intro staging', JSON.stringify(d1) === JSON.stringify([[600, '78,0,0'], [663, '78,2,0'], [686, '45,3,4'], [687, '45,3,3'], [688, '45,3,2'], [689, '45,3,1'], [690, '45,0,0']]), JSON.stringify(d1));
ok('v2 intro determinism x2', JSON.stringify(d1) === JSON.stringify(d2));
async function bombtrace(padFn) { const evs = []; let last = -1; await run2(padFn, { n: 700, k: 1, raw: false }, 960, (n, ex) => { const e9 = ex.bm_ram_rd(0xE9); if (e9 !== last) { evs.push([n, e9]); last = e9; } }); return evs; }
const tapPad = (n) => n === 61 ? 8 : ((n >= 900 && n < 910) ? 2 : 0);
const holdPad = (n) => n === 61 ? 8 : ((n >= 860 && n < 1000) ? 2 : 0);
const tap1 = await bombtrace(tapPad), tap2 = await bombtrace(tapPad), hold1 = await bombtrace(holdPad);
ok('v2 bomb tap', JSON.stringify(tap1.slice(0, 7)) === JSON.stringify([[0, 0], [73, 6], [298, 78], [686, 45], [888, 66], [902, 31], [904, 66]]), JSON.stringify(tap1));
ok('v2 bomb tap x2', JSON.stringify(tap1) === JSON.stringify(tap2));
ok('v2 bomb hold', hold1.some((s) => s[0] === 862 && s[1] === 31) && hold1.some((s) => s[0] === 880 && s[1] === 40), JSON.stringify(hold1));
async function tanktrace() { const evs = []; let last = -1; const hp = []; const marks = {}; let r11 = -1; await run2((n) => n === 61 ? 8 : 0, { n: 700, k: 0, raw: true }, 2300, (n, ex) => { const e9 = ex.bm_ram_rd(0xE9); if (e9 !== last) { evs.push([n, e9]); last = e9; } if (n >= 930 && n <= 1170) { const h = ex.bm_ram_rd(0x40D); if (hp.length === 0 || hp[hp.length - 1][1] !== h) hp.push([n, h]); } if (n === 702) r11 = ex.bm_ram_rd(0x11); if (n === 1262 || n === 1552) marks[n] = [e9, ex.bm_ram_rd(0xC5), ex.bm_ram_rd(0x400), ex.bm_ram_rd(0x40D)]; }); return { evs, hp, marks, r11 }; }
const k1 = await tanktrace(), k2 = await tanktrace();
ok('v2 tank cycle', JSON.stringify(k1.evs) === JSON.stringify([[0, 0], [73, 6], [298, 78], [686, 45], [938, 30], [1162, 81], [1330, 6], [1567, 30], [1791, 81], [1959, 6], [2196, 30]]), JSON.stringify(k1.evs));
ok('v2 tank hpsteps', JSON.stringify(k1.hp) === JSON.stringify([[930, 255], [938, 207], [970, 159], [1002, 111], [1034, 63], [1066, 15], [1098, 0]]), JSON.stringify(k1.hp));
const t30 = k1.evs.filter((s) => s[1] === 30).map((s) => s[0]);
const t45 = k1.evs.filter((s) => s[1] === 45).map((s) => s[0]);
ok('v2 tank marks', JSON.stringify(k1.marks) === JSON.stringify({ 1262: [81, 8, 4, 0], 1552: [6, 0, 3, 255] }) && t30.every((t) => !t45.some((u) => u > t && u <= t + 30)) && k1.r11 <= 2, JSON.stringify(k1.marks) + ' r11=' + k1.r11);
ok('v2 tank determinism x2', JSON.stringify(k1) === JSON.stringify(k2));
