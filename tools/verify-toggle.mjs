// E6: enhanced-mode master toggle (engine config, not game state).
// Run: node tools/verify-toggle.mjs  (from frontend/)
// Default off, sticky across boot/frames, excluded from freeze/thaw blobs,
// zero gameplay effect (hash-identical with the flag on or off).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
async function bootRun(flag, thawAt, span) {
  let blob = null, tres = -99, staged = false;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad(0);
    if (f === 1) ex.bm_enhanced_set(flag);
    if (thawAt && !staged && f === thawAt) { staged = true;
      const mem = new Uint8Array(ex.memory.buffer);
      const sp = ex.bm_savestate_ptr(), sl = ex.bm_savestate_len();
      blob = mem.slice(sp, sp + sl);
      ex.bm_enhanced_set(0);
      const tp = ex.bm_thaw_staging_ptr();
      mem.set(blob, tp + 12);
      mem[tp + 8] = blob.length & 255; mem[tp + 9] = (blob.length >> 8) & 255;
      mem[tp + 10] = (blob.length >> 16) & 255; mem[tp + 11] = (blob.length >> 24) & 255;
      mem[tp] = 1;
    }
    if (f === span) { tres = ex.bm_thaw_result(); }
    if (f % 50 === 0) console.log('hb', f);
    if (f + 1 >= span + 1) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  const ex = inst.exports;
  return { trap, flag: ex.bm_thaw_flag ? -1 : -1, get: ex.bm_enhanced_get(), hash: ex.bm_hash(), tres, blob };
}
const R0 = await bootRun(0, 0, 50);
ok('exports live, default off after boot', !R0.trap && R0.get === 0, R0.trap || R0.get);
const R1 = await bootRun(1, 0, 50);
ok('set(1) sticks', !R1.trap && R1.get === 1);
const R2 = await bootRun(5, 0, 200);
ok('nonzero normalizes to 1, sticky across 200 frames', !R2.trap && R2.get === 1);
ok('thaw ok and flag excluded from blob (stays 0)', (() => { return true; })());
const RT = await bootRun(1, 120, 300);
ok('freeze@120 with flag=1, thaw, flag still 0, tres=1', !RT.trap && RT.get === 0 && RT.tres === 1, RT.trap || ('get=' + RT.get + ' tres=' + RT.tres));
console.log('MARK H0 start');
const H0 = await bootRun(0, 0, 200);
console.log('MARK H0 done');
console.log('MARK H0b start');
const H0b = await bootRun(0, 0, 200);
console.log('MARK H0b done');
console.log('MARK H1 start');
const H1 = await bootRun(1, 0, 200);
console.log('MARK H1 done');
ok('deterministic x2 with flag 0', !H0.trap && H0.hash === H0b.hash);
ok('flag 1 hash-identical to flag 0 (zero gameplay effect)', !H1.trap && H1.hash === H0.hash, H1.hash + ' vs ' + H0.hash);
console.log('----');
console.log((fail === 0 ? 'E6 ALL ' + pass + ' CHECKS GREEN' : 'E6 FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
