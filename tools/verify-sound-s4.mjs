// S4 song pointer-table remap: lib + Start-flow proof (id 6 remapped to $54 data) + editor wiring.
// NOTE: exact event-sequence equality with the title run does NOT hold ($54 data
// diverges by start-frame state -- RNG-gated branches and/or $E0 carry); the decisive
// proof is request-intact + different-music + determinism, plus the S2 gating finding
// (long song holds the intro gate: key stays '0,6', no $4E/$2D within the span).
// Run: node tools/verify-sound-s4.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { SONG_PTR, songPtr, remapSongs, ptrOf } from '../src/pack/songs.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const B5 = stock.prg[5];
ok('ptrOf', ptrOf(B5, 0x2D) === songPtr(B5, 0x2D) && ptrOf(null, 0) === null && ptrOf(new Uint8Array(10), 0) === null);
const rp = remapSongs(B5, { 45: 84 });
let diffs = 0; for (let i = 0; i < B5.length; i++) if (rp.bytes[i] !== B5[i]) diffs++;
ok('remap one-word', rp.ok && diffs === 2 && rp.bytes[1200 + 45 * 2] === B5[1200 + 84 * 2] && rp.bytes[1200 + 45 * 2 + 1] === B5[1200 + 84 * 2 + 1], 'diffs=' + diffs);
const noop = remapSongs(B5, {});
ok('remap noop', noop.ok && noop.bytes.every((v, i) => v === B5[i]));
const self = remapSongs(B5, { 6: 6 });
ok('remap self', self.ok && self.bytes.every((v, i) => v === B5[i]));
ok('remap refused', !remapSongs(B5, { 85: 0 }).ok && !remapSongs(B5, { 0: 85 }).ok && !remapSongs(B5, { 0: -1 }).ok && !remapSongs(B5, { 'x': 0 }).ok && !remapSongs(null, {}).ok);
// ---- dynamics: remap 6->84, Start-flow id-6 window must equal title id-84 window ----
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function cat(banks) { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; }
const SP = 0x20000;
async function runW(banks, padFn, span, watch, w0, w1) {
  let n = -1; const first = {}; let hash = 2166136261 >>> 0; let seqH = 2166136261 >>> 0; let seqN = 0;
  const mix = (h, v) => { h ^= v; return Math.imul(h, 16777619) >>> 0; };
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = inst.exports;
    ex.bm_set_pad(padFn(n));
    ex.bm_snap();
    const e9 = ex.bm_ram_rd(0xE9);
    if (!(e9 in first)) first[e9] = n;
    hash = mix(hash, e9);
    const gotN = ex.bm_audio_read(SP, 256);
    if (e9 === watch && n >= w0 && n < w1) {
      const mem = new Uint8Array(inst.exports.memory.buffer);
      for (let i = 0; i < gotN; i++) {
        const a = mem[SP + i * 8] | (mem[SP + i * 8 + 1] << 8); const v = mem[SP + i * 8 + 2];
        seqH = mix(seqH, a); seqH = mix(seqH, v); seqN++;
      }
    }
    if (n >= span) throw new Error('STOP');
  } } })).instance;
  try {
    const mm8 = new Uint8Array(inst.exports.memory.buffer);
    mm8.set(cat(banks), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm8.set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message }; }
  return { first, hash, seqH, seqN };
}
const key = (R) => Object.keys(R.first).map(Number).sort((a, b) => a - b).join(',');
const sig = (R) => R.hash.toString(16) + '|' + key(R);
const T = await runW(stock.prg, () => 0, 900, 84, 404, 629);
ok('title anchor', T.trap === undefined && T.first[84] === 404 && T.seqN > 500, 'seqN=' + T.seqN);
const C = await runW(stock.prg, (n) => n === 61 ? 8 : 0, 1200, 6, 73, 298);
ok('control anchor', C.trap === undefined && C.first[6] === 73 && C.seqN > 100, 'seqN=' + C.seqN);
const pBanks = stock.prg.map((b, i) => i === 5 ? remapSongs(B5, { 6: 84 }).bytes : b);
const P = await runW(pBanks, (n) => n === 61 ? 8 : 0, 1200, 6, 73, 298);
ok('remap request intact', P.trap === undefined && P.first[6] === 73, JSON.stringify(P.first));
ok('remap changes music', P.seqN > 100 && C.seqN > 100 && P.seqN !== C.seqN && P.seqH !== C.seqH, 'p=' + P.seqN + ' c=' + C.seqN);
const P2 = await runW(pBanks, (n) => n === 61 ? 8 : 0, 1200, 6, 73, 298);
ok('remap determinism', sig(P) === sig(P2) && P2.seqH === P.seqH);
const ed = readFileSync(PROJ + '/frontend/src/ui/editor.js', 'utf8');
const hx = readFileSync(PROJ + '/frontend/index.html', 'utf8');
ok('ed ptr fns', ed.includes('effSongPtr') && ed.includes('commitSongPtr') && ed.includes('renderSongPtr') && ed.includes('S.edSongPtr'));
ok('ed ptr save', ed.includes('remapSongs(S.resolved.prg[5]') && ed.includes('makePatch("prg", 5,'));
ok('html ptr', hx.includes('edPtrId') && hx.includes('edPtrTarget') && hx.includes('edPtrOut'));
console.log('---- s4: ' + pass + ' pass / ' + fail + ' fail ----');
if (fail) process.exit(1);
