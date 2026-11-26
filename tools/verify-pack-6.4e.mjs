// 6.4e sound engine v1: bank-5 driver map + song table + headless song proofs.
// Run: node tools/verify-pack-6.4e.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { SOUND_BANK, DRIVER, QUEUE, CUR_SONG, PERIOD_TABLE, SONG_TABLE, AREA_SONGS, REQ, OBSERVED, songForArea, isSongId } from '../src/pack/sound.js';
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
