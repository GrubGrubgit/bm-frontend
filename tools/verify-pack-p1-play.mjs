// P1 acceptance: edited map boots and PLAYS on both engines (warp + walk).
// Run: node tools/verify-pack-p1-play.mjs  (from frontend/)
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { parseBank, serializeBank } from '../src/pack/levels.js';
import { buildPack } from '../src/pack/builder.js';
import * as OV from '../src/pack/overlay.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const p = parseBank(stock.prg[0], 0);
const L1 = p.levels.find(l => l.level === 1);
ok('L1 found', !!L1);
const safeBlock = (bi) => {
  for (let k = 0; k < 4; k++) { const si = L1.blocks[bi * 4 + k];
    for (let j = 0; j < 4; j++) { const ci = L1.structs[si * 4 + j]; if ((L1.attrs[ci] & 0xFC) !== 0) return false; } }
  return true; };
const use = new Map();
for (let i = 0; i < L1.map.length; i++) { const b = L1.map[i]; if (safeBlock(b)) use.set(b, (use.get(b) || 0) + 1); }
const ranked = [...use.entries()].sort((a, b) => b[1] - a[1]);
ok('safe floor blocks exist', ranked.length >= 2, JSON.stringify(ranked.slice(0, 4)));
const dom = ranked[0][0], rep = ranked[1][0];
const m = L1.map.slice();
const cells = [14*32+6, 14*32+9, 14*32+10, 14*32+11];
const pre = cells.map(i => m[i]);
for (const i of cells) m[i] = rep;
ok('edit stamped', cells.every(i => m[i] === rep));
ok('edit changes map', pre.some((b, k) => b !== m[cells[k]]), 'pre=' + pre.join(','));
const ED = await import('../src/ui/editor.js');
const s = serializeBank(p, { 1: { map: m } });
ok('edited serializes', s.ok);
const runs = ED.diffRuns(stock.prg[0], s.bytes);
ok('diff small', runs.length > 0 && runs.length < 20, 'runs=' + runs.length);
const patches = runs.map(r => OV.makePatch('prg', 0, r.off, r.bytes));
const doc = { customVersion: 1, id: 'c-p1play', name: 'p1play', baseCrc: stock.meta.crc32, patches, editorVersion: 'p1play', builtAt: 't' };
ok('custom validates', OV.validateCustomPack(doc).ok);
const rr = OV.applyOverlay(stock, doc);
ok('overlay applies', rr.ok);
const edited = rr.pack;
const cat = (banks) => { const o = new Uint8Array(banks[0].length * banks.length); banks.forEach((b, i) => o.set(b, i * banks[0].length)); return o; };
const eprg = cat(edited.prg), echr = cat(edited.chr);
const padAt = (f) => { if (f >= 2700 && f < 2705) return 8; if (f < 2800) return 0; return 128; };
let win = null, trap = null, px0 = 0, px1 = 0, t3000 = -1;
const seenTypes = {};
const inst = (await WebAssembly.instantiate(readFileSync(PROJ + '/frontend/build/game.wasm'), { env: { host_frame: (f) => {
  const ex = win.exports;
  ex.bm_set_pad(padAt(f));
  if (f === 2750) ex.bm_warp(0);
  ex.bm_snap();
  const mem = new Uint8Array(ex.memory.buffer);
  const sp = ex.bm_stage_ptr(), sn = mem.slice(sp, sp + 4160);
  if (f % 100 === 0) seenTypes[sn[1024]] = (seenTypes[sn[1024]] || 0) + 1;
  if (f === 2800) px0 = sn[1026] + 256 * sn[1027];
  if (f === 3000) t3000 = sn[1024];
  if (f === 4300) px1 = sn[1026] + 256 * sn[1027];
  if (f + 1 >= 4301) throw new Error('STOP');
} } })).instance;
win = { exports: inst.exports };
try {
  const mm = () => new Uint8Array(inst.exports.memory.buffer);
  mm().set(eprg, inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
  mm().set(echr, inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
  inst.exports.bm_boot();
} catch (e) { if (e.message !== 'STOP') trap = String((e && e.message) || e).slice(0, 80); }
let trapFlag = -1;
try { trapFlag = inst.exports.bm_trap_flag(); } catch (e) {}
console.log('INFO wasm types_after_warp=' + JSON.stringify(seenTypes) + ' dx=' + (px1 - px0));
ok('wasm edited boots trap-free', trap === null && trapFlag === 0, 'trap=' + trap + ' flag=' + trapFlag);
ok('wasm warp(0) gives tank', t3000 === 3, 't=' + t3000);
ok('wasm tank walks (scroll regions)', (px1 - px0) > 2000, 'dx=' + (px1 - px0));
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
    if (f === 2800 || f === 4300) {
      const pr = mod._mesen_frame(), w = mod._mesen_fw(), h = mod._mesen_fh();
      shots[f] = Buffer.from(mod.HEAPU32.subarray(pr >> 2, (pr >> 2) + w * h));
    } }
  return shots; }
const sad = (a, b) => { let x = 0; for (let i = 0; i < a.length; i++) x += Math.abs(a[i] - b[i]); return x; };
const st = await runMesen(stock), ed = await runMesen(edited);
const div = sad(st[4300], ed[4300]), mot = sad(ed[2800], ed[4300]), idle = sad(st[2800], st[4300]);
console.log('INFO mesen div=' + div + ' motEdited=' + mot + ' motStock=' + idle);
ok('mesen edited boots (both runs complete)', !!st[4300] && !!ed[4300]);
ok('mesen edit visible in-engine', div > 1000000, 'div=' + div);
ok('mesen tank drives (screen scrolls)', mot > 500000, 'mot=' + mot);
console.log('----');
console.log('pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
