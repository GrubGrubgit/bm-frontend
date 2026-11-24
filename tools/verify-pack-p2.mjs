// P2 acceptance: chr codec round-trip, palette write-back, edited tile +
// palette visible in-game on BOTH engines (wasm trap-free + video diff,
// mesen stock-vs-edited divergence). Run: node tools/verify-pack-p2.mjs
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { parseBank, serializeBank } from '../src/pack/levels.js';
import { buildPack } from '../src/pack/builder.js';
import * as CHR from '../src/pack/chr.js';
import { BG_CHR_BANK } from '../src/pack/tiles.js';
import * as OV from '../src/pack/overlay.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
// --- 1. codec round-trip over every stock chr bank ---
let tiles = 0, rtBad = 0;
for (let j = 0; j < 16; j++) {
  const b = stock.chr[j];
  if (b.length !== 8192) { ok('chr bank ' + j + ' size', false, 'len=' + b.length); continue; }
  for (let half = 0; half < 2; half++) {
    const b4 = b.subarray(half * 4096, half * 4096 + 4096);
    const dec = CHR.decodeBank4k(b4);
    const enc = CHR.encodeBank4k(dec);
    if (enc.length !== 4096) rtBad++;
    else for (let i = 0; i < 4096; i++) if (enc[i] !== b4[i]) { rtBad++; break; }
    tiles += 256;
  }
}
ok('codec round-trip 16 banks (' + tiles + ' tiles)', rtBad === 0, 'bad=' + rtBad);
// --- 2. codec error cases ---
let threw = 0;
try { CHR.encodeTile(new Uint8Array(63)); } catch (e) { threw++; }
try { CHR.encodeTile(Uint8Array.from({length: 64}, (_, i) => i === 7 ? 4 : 1)); } catch (e) { threw++; }
try { CHR.decodeTile(new Uint8Array(15), 0); } catch (e) { threw++; }
try { CHR.getTile(new Uint8Array(4096), 256); } catch (e) { threw++; }
try { CHR.setTile('nope', 0, new Uint8Array(64)); } catch (e) { threw++; }
ok('codec rejects bad input (5/5 throw)', threw === 5, 'threw=' + threw);
// setTile returns a copy, stock untouched
const b4copy = stock.chr[4].slice(0, 4096);
const px0 = CHR.getTile(b4copy, 0);
const solid = new Uint8Array(64).fill(3);
const b4mod = CHR.setTile(b4copy, 0, solid);
ok('setTile copy semantics', b4mod.length === 4096 && CHR.getTile(b4mod, 0).every(v => v === 3) && !px0.every(v => v === 3) === false ? true : CHR.getTile(b4copy, 0).every((v, i) => v === px0[i]), 'orig-mutated?');
// --- 3. palette write-back: L1 pal edit = fast path, 16B diff at pal span ---
const p0 = parseBank(stock.prg[0], 0);
ok('bank0 parses', p0.ok);
const L1 = p0.levels.find(l => l.level === 1);
ok('L1 found', !!L1);
const palEdit = L1.pal.slice();
palEdit[1] = 0x30; palEdit[5] = 0x16; // sky + accent shifts, highly visible
const sr = serializeBank(p0, { 1: { pal: palEdit } });
ok('pal edit serializes', sr.ok, (sr.errors || []).join(' '));
const ED = await import('../src/ui/editor.js');
const runs = ED.diffRuns(stock.prg[0], sr.bytes);
ok('pal diff is one run inside pal span', runs.length === 1 && runs[0].off === L1.ptrs.pal + 1 && runs[0].bytes.length === 5 && runs[0].bytes[0] === 0x30 && runs[0].bytes[4] === 0x16, JSON.stringify(runs.map(r => [r.off, r.bytes.length])));
const fsr = serializeBank(p0, { 1: { pal: palEdit } });
ok('pal serialize deterministic', fsr.ok && ED.diffRuns(sr.bytes, fsr.bytes).length === 0);
// --- 4. chr write-back: most-used L1 pattern -> solid, overlay applies ---
const freq = new Map();
for (let mi = 0; mi < L1.map.length; mi++) {
  const bi = L1.map[mi];
  for (let k = 0; k < 4; k++) { const si = L1.blocks[bi * 4 + k];
    for (let j = 0; j < 4; j++) { const ci = L1.structs[si * 4 + j];
      for (let q = 0; q < 4; q++) { const t = L1.combos[ci * 4 + q]; freq.set(t, (freq.get(t) || 0) + 1); } } }
}
const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
ok('dominant L1 tile found', !!top && top[1] > 100, JSON.stringify(top));
const b4 = BG_CHR_BANK[1]; // 4KB bank for L1 bg
const chr8 = b4 >> 1, chrOff = (b4 & 1) * 4096 + top[0] * 16;
const patches = runs.map(r => OV.makePatch('prg', 0, r.off, r.bytes));
// editor save path, verbatim (saveAsPack): helper -> makePatch
const chrEdits = {};
chrEdits[b4] = {}; chrEdits[b4][top[0]] = solid;
const descs = CHR.chrPatchDescs(stock.chr, stock.chr, chrEdits);
ok('helper yields one desc inside edited tile', descs.length === 1 && descs[0].bank === chr8 && descs[0].offset >= chrOff && descs[0].offset < chrOff + 16, JSON.stringify(descs.map(d => [d.bank, d.offset, d.bytes.length])));
ok('helper descs reconstruct solid tile', (() => { const r = stock.chr[chr8].slice(); for (const d of descs) r.set(d.bytes, d.offset); return CHR.decodeTile(r, (b4 & 1) * 4096 + top[0] * 16).every(v => v === 3); })());
for (const d of descs) patches.push(OV.makePatch('chr', d.bank, d.offset, d.bytes));
// helper edge cases
ok('helper empty edits -> no descs', CHR.chrPatchDescs(stock.chr, stock.chr, {}).length === 0);
ok('helper skips tile-less bank', CHR.chrPatchDescs(stock.chr, stock.chr, {8: {}}).length === 0);
let threwH = 0;
try { CHR.chrPatchDescs(stock.chr, stock.chr, {32: {0: solid}}); } catch (e) { threwH++; }
try { CHR.chrPatchDescs(stock.chr, stock.chr, {8: {256: solid}}); } catch (e) { threwH++; }
try { CHR.chrPatchDescs(stock.chr, stock.chr, {8: {0: new Uint8Array(64).fill(9)}}); } catch (e) { threwH++; }
ok('helper rejects bad bank/tile/pixel (3/3 throw)', threwH === 3, 'threw=' + threwH);
// overlay diffRuns (moved module) agrees with editor re-export on the pal case
ok('overlay diffRuns == editor diffRuns', JSON.stringify(OV.diffRuns(stock.prg[0], sr.bytes)) === JSON.stringify(ED.diffRuns(stock.prg[0], sr.bytes)));
const doc = { customVersion: 1, id: 'c-p2', name: 'p2', baseCrc: stock.meta.crc32, patches, editorVersion: 'p2', builtAt: 't' };
ok('p2 custom validates', OV.validateCustomPack(doc).ok, OV.validateCustomPack(doc).errors.join(' '));
const rr = OV.applyOverlay(stock, doc);
ok('p2 overlay applies', rr.ok, (rr.errors || []).join(' '));
const edited = rr.pack;
ok('chr patch landed', edited.chr[chr8][chrOff] !== stock.chr[chr8][chrOff]);
ok('prg pal patch landed', edited.prg[0][L1.ptrs.pal + 1] === 0x30);
// --- 5. wasm: edited boots trap-free, video differs ---
function fnv(u8) { let h = 2166136261; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
async function bootVideo(prgBanks, chrBanks, frames) {
  const bytes = readFileSync(PROJ + '/frontend/build/game.wasm');
  let inst;
  const padAt = (f) => { if (f >= 2700 && f < 2705) return 8; if (f < 2800) return 0; return 128; };
  const p = await WebAssembly.instantiate(bytes, { env: { host_frame: (f) => {
    const ex = inst.exports;
    ex.bm_set_pad(padAt(f));
    if (f === 2750) ex.bm_warp(0);
    ex.bm_snap();
    if (f === 3000) {
      // gameplay state must be identical across packs (same pads+physics);
      // video must differ (edit visible). L1 is on screen here; by 4300 the
      // tank has walked out of edited L1, so 4300 converges (verified).
      const mem2 = new Uint8Array(ex.memory.buffer);
      const sp = ex.bm_stage_ptr(), sn = mem2.slice(sp, sp + 4160);
      const vp = ex.bm_video_ptr();
      out = { type: sn[1024], px: sn[1026] + 256 * sn[1027],
        vhash: fnv(mem2.slice(vp, vp + 256 * 240 * 4)) };
    }
    if (f + 1 >= frames) throw new Error('STOP');
  } } });
  inst = p.instance; const ex = inst.exports;
  let out = null;
  const mem = () => new Uint8Array(ex.memory.buffer);
  const prg = new Uint8Array(8 * 16384), chr = new Uint8Array(16 * 8192);
  for (let i = 0; i < 8; i++) prg.set(prgBanks[i], i * 16384);
  for (let j = 0; j < 16; j++) chr.set(chrBanks[j], j * 8192);
  mem().set(prg, ex.bm_stage_ptr()); ex.bm_load_prg();
  mem().set(chr, ex.bm_stage_ptr()); ex.bm_load_chr();
  try { ex.bm_boot(); } catch (e) { if (e.message !== 'STOP') throw e; }
  out.trap = ex.bm_trap_flag() ? 1 : 0;
  return out;
}
const FR = 3100;
const vs = await bootVideo(stock.prg, stock.chr, FR);
const ve = await bootVideo(edited.prg, edited.chr, FR);
ok('wasm stock boots trap-free', vs.trap === 0);
ok('wasm p2-edited boots trap-free', ve.trap === 0);
ok('wasm same gameplay state (warp ok)', vs.type === 3 && ve.type === 3 && vs.px === ve.px, JSON.stringify({vs, ve}));
ok('wasm p2 edit visible (video differs)', vs.vhash !== ve.vhash, 'stock=' + vs.vhash + ' ed=' + ve.vhash);
// --- 6. mesen: warp+walk both packs, stock-vs-edited diverges ---
function buildRomBytes(pack) {
  const m2 = pack.meta;
  const b = new Uint8Array(16 + 8 * 16384 + 16 * 8192);
  b[0]=0x4E; b[1]=0x45; b[2]=0x53; b[3]=0x1A; b[4]=8; b[5]=16;
  b[6]=((m2.mapper&0xF)<<4)|(m2.mirror==='v'?1:(m2.mirror==='4'?8:0));
  b[7]=(m2.mapper&0xF0)|(m2.format==='nes2'?0x08:0x00);
  let o = 16;
  for (let i = 0; i < 8; i++) { b.set(pack.prg[i], o); o += 16384; }
  for (let j = 0; j < 16; j++) { b.set(pack.chr[j], o); o += 8192; }
  return b; }
const createMesen = require(PROJ + '/work/mesen-wasm/mesen.js');
async function runMesen(pack) {
  const mod = await createMesen({ locateFile: (f) => PROJ + '/work/mesen-wasm/' + f });
  const rb = buildRomBytes(pack);
  const rp = mod._malloc(rb.length); mod.HEAPU8.set(rb, rp);
  const nm = Buffer.from('game.nes'); const np = mod._malloc(64);
  mod.HEAPU8.set(nm, np); mod.HEAPU8[np + nm.length] = 0;
  if (!mod._mesen_boot(rp, rb.length, np)) throw new Error('mesen-boot');
  const shots = {};
  for (let f = 0; f <= 4300; f++) {
    mod._mesen_setpad((f >= 2700 && f < 2705) ? 8 : (f >= 2800 ? 128 : 0));
    mod._mesen_run();
    if (f === 4300) { const pr = mod._mesen_frame(), w = mod._mesen_fw(), h = mod._mesen_fh(); shots[f] = Buffer.from(mod.HEAPU32.subarray(pr >> 2, (pr >> 2) + w * h)); } }
  return shots; }
const sad = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += Math.abs(a[i] - b[i]); return x; };
const st = await runMesen(stock), ed = await runMesen(edited);
const div = sad(st[4300], ed[4300]);
console.log('INFO mesen div=' + div);
ok('mesen both runs complete', !!st[4300] && !!ed[4300]);
let diffpx = 0; for (let i = 0; i < st[4300].length; i++) if (st[4300][i] !== ed[4300][i]) diffpx++;
console.log('INFO mesen diffpx=' + diffpx);
ok('mesen p2 edit visible in-engine', div > 100000 && diffpx > 1000, 'div=' + div + ' px=' + diffpx);
console.log('----');
console.log('pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
