// S2 area entry-music table (LCDC8, fixed bank 7): lib + ROM pin + Start-flow proof + editor wiring.
// Run: node tools/verify-sound-s2.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { AREA_SONGS, AREA_TABLE, getAreaSongs, serializeAreaSongs } from '../src/pack/sound.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
// ---- lib ----
ok('lib table', AREA_TABLE.BANK === 7 && AREA_TABLE.OFFSET === 3528 && AREA_TABLE.COUNT === 8);
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const B7 = stock.prg[7];
const got = getAreaSongs(B7);
ok('lib get', got !== null && got.join(',') === AREA_SONGS.join(','));
ok('lib bad', getAreaSongs(null) === null && getAreaSongs(new Uint8Array(100)) === null && getAreaSongs('x') === null);
// ---- ROM pin: unique 8-byte seq, code-tight ----
const seq = AREA_SONGS;
const hits = [];
for (let b = 0; b < stock.prg.length; b++) { const B = stock.prg[b]; for (let i = 0; i + 8 <= B.length; i++) { let m = true; for (let k = 0; k < 8; k++) if (B[i + k] !== seq[k]) { m = false; break; } if (m) hits.push(b + ':' + i); } }
ok('rom unique', hits.length === 1 && hits[0] === '7:3528', JSON.stringify(hits));
ok('rom neighbors', B7[3525] === 0x4C && B7[3526] === 0xCC && B7[3527] === 0xDE && B7[3536] === 0xA5 && B7[3537] === 0x15, 'jmp-decc/lda-15');
// ---- serialize ----
const noop = serializeAreaSongs(B7, {});
ok('ser noop', noop.ok && noop.bytes.length === B7.length && noop.bytes.every((v, i) => v === B7[i]));
const ed1 = serializeAreaSongs(B7, { 0: 19 });
let diffs = 0; for (let i = 0; i < B7.length; i++) if (ed1.bytes[i] !== B7[i]) diffs++;
ok('ser one-byte', ed1.ok && diffs === 1 && ed1.bytes[3528] === 19);
ok('ser refused', !serializeAreaSongs(B7, { 8: 1 }).ok && !serializeAreaSongs(B7, { 0: 85 }).ok && !serializeAreaSongs(B7, { 0: -1 }).ok && !serializeAreaSongs(B7, { 0: 1.5 }).ok && !serializeAreaSongs(null, {}).ok);
// ---- dynamics: Start@61 flow, stock vs patched bank7 ----
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function cat(banks) { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; }
const SP = 0x20000;
async function run(banks, padFn, span) {
  let n = -1; const first = {}; const per = {}; let hash = 2166136261 >>> 0;
  const mix = (v) => { hash ^= v; hash = Math.imul(hash, 16777619) >>> 0; };
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = inst.exports;
    ex.bm_set_pad(padFn(n));
    ex.bm_snap();
    const e9 = ex.bm_ram_rd(0xE9);
    if (!(e9 in first)) first[e9] = n;
    mix(e9);
    const gotN = ex.bm_audio_read(SP, 256);
    if (!per[e9]) per[e9] = { frames: 0, ev: 0 };
    if (gotN > 0) per[e9].frames++;
    per[e9].ev += gotN;
    if (n >= span) throw new Error('STOP');
  } } })).instance;
  try {
    const mm8 = new Uint8Array(inst.exports.memory.buffer);
    mm8.set(cat(banks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm8.set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message }; }
  return { first, per, hash };
}
const key = (R) => Object.keys(R.first).map(Number).sort((a, b) => a - b).join(',');
const sig = (R) => R.hash.toString(16) + '|' + key(R);
const C = await run(stock.prg, (n) => n === 61 ? 8 : 0, 1200);
ok('control anchor', C.trap === undefined && C.first[6] === 73 && key(C) === '0,6,45,78', JSON.stringify(C.first));
const pBanks = stock.prg.map((b, i) => i === 7 ? serializeAreaSongs(B7, { 0: 19 }).bytes : b);
const P = await run(pBanks, (n) => n === 61 ? 8 : 0, 1200);
ok('patched song19', P.trap === undefined && P.first[19] === 73 && P.first[6] === undefined && key(P) === '0,19', JSON.stringify(P.first));
ok('intro gated on song end', P.per[19].frames > 1000 && P.per[19].ev > 1000 && P.first[78] === undefined && P.first[45] === undefined, '19=' + JSON.stringify(P.per[19]));
const P2 = await run(pBanks, (n) => n === 61 ? 8 : 0, 1200);
ok('patched determinism', sig(P) === sig(P2));
// ---- editor wiring statics ----
const ed = readFileSync(PROJ + '/frontend/src/ui/editor.js', 'utf8');
const hx = readFileSync(PROJ + '/frontend/index.html', 'utf8');
ok('ed area fns', ed.includes('effAreaSong') && ed.includes('commitAreaSong') && ed.includes('renderAreaSongs') && ed.includes('S.edAreaSongs'));
ok('ed save path', ed.includes('serializeAreaSongs') && ed.includes('AREA_TABLE.BANK'));
ok('html area table', hx.includes('edAreaSongTbl') && hx.includes('edAreaSongInfo'));
console.log('---- s2: ' + pass + ' pass / ' + fail + ' fail ----');
if (fail) process.exit(1);
