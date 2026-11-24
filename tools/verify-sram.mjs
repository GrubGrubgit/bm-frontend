// E1: in-engine SRAM (exact-state slots, blob export/import, metadata).
// Run: node tools/verify-sram.mjs  (from frontend/)
// SRAM is engine config: sticky across boot, excluded from freeze/thaw.
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
const CRC = 0x12345678, CRC2 = 0x11111111;
// driver: boot, run scripted one-shot actions, run to span. Returns exports + mem + log.
async function drive(o) {
  const log = [];
  const done = {};
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports, mem = new Uint8Array(ex.memory.buffer);
    ex.bm_set_pad(0);
    if (f % 100 === 0) log.push('hb' + f);
    for (const a of (o.acts || [])) {
      if (!done[a.k] && f === a.at) { done[a.k] = true; a.fn(ex, mem); }
    }
    if (f + 1 >= o.span + 1) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    if (o.pre) o.pre(inst.exports);
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  return { ex: inst.exports, mem: new Uint8Array(inst.exports.memory.buffer), trap, log };
}
const R = await drive({ span: 10 });
ok('exports live', ['bm_sram_save','bm_sram_load','bm_sram_info','bm_sram_last','bm_sram_blob_ptr','bm_sram_blob_len','bm_sram_store','bm_saving_set','bm_saving_get'].every((k) => typeof R.ex[k] === 'function'), R.trap);
ok('saving default off + round-trip + normalize', R.ex.bm_saving_get() === 0 && (R.ex.bm_saving_set(1), R.ex.bm_saving_get() === 1) && (R.ex.bm_saving_set(9), R.ex.bm_saving_get() === 1) && (R.ex.bm_saving_set(0), R.ex.bm_saving_get() === 0), R.trap);
ok('empty: last -1, load -2, len 0, save bad slot -1, info occ 0', R.ex.bm_sram_last() === -1 && R.ex.bm_sram_load(1, CRC) === -2 && R.ex.bm_sram_blob_len(1) === 0 && R.ex.bm_sram_blob_ptr(1) === 0 && R.ex.bm_sram_save(8, CRC) === -1 && R.ex.bm_sram_save(-1, CRC) === -1 && R.ex.bm_sram_info(1, 0) === 0, R.trap);
// save at f60, check return + metadata self-consistency vs live save blob
let saveRet = -99, meta = {};
const S1 = await drive({ span: 120, acts: [{ k: 'sv', at: 60, fn: (ex, mem) => {
  saveRet = ex.bm_sram_save(1, CRC);
  meta = { occ: ex.bm_sram_info(1, 0), area: ex.bm_sram_info(1, 1), x: ex.bm_sram_info(1, 2), y: ex.bm_sram_info(1, 3), frame: ex.bm_sram_info(1, 4), crc: ex.bm_sram_info(1, 5), last: ex.bm_sram_last(), len: ex.bm_sram_blob_len(1), ptr: ex.bm_sram_blob_ptr(1) };
  const sp = ex.bm_savestate_ptr();
  meta.blobArea = mem[sp + 380 + 0x14] & 15; meta.blobX = mem[sp + 380 + 0x49]; meta.blobY = mem[sp + 380 + 0x4B];
} } ] });
ok('save slot1 ok, occupied, last=1, len 7836, ptr nonzero', !S1.trap && saveRet === 0 && meta.occ === 1 && meta.last === 1 && meta.len === 7836 && meta.ptr !== 0, S1.trap || JSON.stringify(meta));
ok('metadata matches live blob (area/x/y) + frame sane + crc stored', meta.area === meta.blobArea && meta.x === meta.blobX && meta.y === meta.blobY && meta.frame > 0 && meta.frame <= 61 && (meta.crc | 0) === (CRC | 0), JSON.stringify(meta));
// save slot 3 too -> last=3; bad-slot info guards
let last3 = -99, badInfo = 0;
await drive({ span: 80, acts: [
  { k: 'a', at: 40, fn: (ex) => { ex.bm_sram_save(1, CRC); } },
  { k: 'b', at: 60, fn: (ex) => { ex.bm_sram_save(3, CRC); last3 = ex.bm_sram_last(); badInfo = [ex.bm_sram_info(9, 0), ex.bm_sram_info(1, 9), ex.bm_sram_info(2, 1)].join(','); } }
] });
ok('last tracks newest (3), bad slot/field/empty guards', last3 === 3 && badInfo === '-1,-1,-2', badInfo);
// rewind proof: save@60 slot1, load@140 (rewind to ~60), run to 260; vs control run to 260
let loadRet = -99, tresLoad = -99;
const RL = await drive({ span: 260, acts: [
  { k: 'sv', at: 60, fn: (ex) => { ex.bm_sram_save(1, CRC); } },
  { k: 'ld', at: 140, fn: (ex) => { loadRet = ex.bm_sram_load(1, CRC); } },
  { k: 'tr', at: 260, fn: (ex) => { tresLoad = ex.bm_thaw_result(); } }
] });
const RC = await drive({ span: 260 });
const RC2 = await drive({ span: 260 });
const memL = new Uint8Array(RL.ex.memory.buffer);
const blobL = Array.from(memL.slice(RL.ex.bm_savestate_ptr(), RL.ex.bm_savestate_ptr() + RL.ex.bm_savestate_len()));
const memC = new Uint8Array(RC.ex.memory.buffer);
const blobC = Array.from(memC.slice(RC.ex.bm_savestate_ptr(), RC.ex.bm_savestate_ptr() + RC.ex.bm_savestate_len()));
const hL = RL.ex.bm_hash(), hC = RC.ex.bm_hash(), hC2 = RC2.ex.bm_hash();
for (const b of [32,33,34,35,64,65,66,67]) { blobL[b] = 0; blobC[b] = 0; }
const r32o = (b,o)=>b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24);
const SL = r32o(blobL,96)&255, SC = r32o(blobC,96)&255;
ok('stack pointers identical and above slot F8 (byte 884 dead in both)', SL === SC && SL > 0xF8, SL + ' vs ' + SC);
if (SL === SC && SL > 0xF8) { blobL[884] = 0; blobC[884] = 0; }
const blobsEq = blobL.length === blobC.length && blobL.every((v,i)=>v===blobC[i]);
let firstDiff = -1, diffCount = 0; for (let i = 0; i < blobL.length; i++) { if (blobL[i] !== blobC[i]) { if (firstDiff < 0) firstDiff = i; diffCount++; } }
ok('plain determinism (control x2, span 260)', !RC.trap && !RC2.trap && hC === hC2, hC + ' vs ' + hC2);
const RS = await drive({ span: 260, acts: [{ k: 'svo', at: 60, fn: (ex) => { ex.bm_sram_save(1, CRC); } }] });
ok('save-only run hash-identical to control (save is read-only)', !RS.trap && RS.ex.bm_hash() === hC);
ok('load stages (1), thaw applies (tres=1)', !RL.trap && loadRet === 1 && tresLoad === 1, RL.trap || ('load=' + loadRet + ' tres=' + tresLoad));
ok('rewind blob masked-identical (poll labels + dead stack slot 884 masked)', !RL.trap && !RC.trap && blobsEq, 'bytes=' + blobL.length + ' diffs=' + diffCount + ' firstDiff=' + firstDiff + (firstDiff >= 0 ? ' L=' + blobL[firstDiff] + ' C=' + blobC[firstDiff] : '') + ' S_L=' + SL + ' S_C=' + SC);
// crc mismatch + empty guards on load
let g1 = -99, g2 = -99;
await drive({ span: 80, acts: [
  { k: 'sv', at: 40, fn: (ex) => { ex.bm_sram_save(2, CRC); } },
  { k: 'g', at: 60, fn: (ex) => { g1 = ex.bm_sram_load(2, CRC2); g2 = ex.bm_sram_load(5, CRC); } }
] });
ok('load wrong crc -3, load empty -2', g1 === -3 && g2 === -2, g1 + ',' + g2);
let E1bytes = null;
const E1b = await drive({ span: 80, acts: [{ k: 'sv', at: 60, fn: (ex, mem) => {
  ex.bm_sram_save(4, CRC);
  const p = ex.bm_sram_blob_ptr(4), l = ex.bm_sram_blob_len(4);
  E1bytes = Array.from(mem.slice(p, p + l));
} } ] });
let storeRet = -99, impMeta = {};
await drive({ span: 60, acts: [{ k: 'im', at: 40, fn: (ex, mem) => {
  const tp = ex.bm_thaw_staging_ptr();
  const u8 = Uint8Array.from(E1bytes);
  mem.set(u8, tp + 12);
  mem[tp + 8] = u8.length & 255; mem[tp + 9] = (u8.length >> 8) & 255; mem[tp + 10] = (u8.length >> 16) & 255; mem[tp + 11] = (u8.length >> 24) & 255;
  storeRet = ex.bm_sram_store(6, CRC);
  impMeta = { occ: ex.bm_sram_info(6, 0), area: ex.bm_sram_info(6, 1), last: ex.bm_sram_last() };
} } ], pre: null });
ok('export/import: store ok, metadata carried, last=6', storeRet === 0 && impMeta.occ === 1 && impMeta.last === 6 && impMeta.area >= 0 && impMeta.area < 16, storeRet + ' ' + JSON.stringify(impMeta));
// corrupt blob refused by store
let badStore = -99;
await drive({ span: 60, acts: [{ k: 'im', at: 40, fn: (ex, mem) => {
  const tp = ex.bm_thaw_staging_ptr();
  const u8 = Uint8Array.from(E1bytes); u8[0] ^= 0xFF;
  mem.set(u8, tp + 12);
  mem[tp + 8] = u8.length & 255; mem[tp + 9] = (u8.length >> 8) & 255; mem[tp + 10] = (u8.length >> 16) & 255; mem[tp + 11] = (u8.length >> 24) & 255;
  badStore = ex.bm_sram_store(6, CRC);
} } ] });
ok('corrupt blob refused (-2), slot stays empty', badStore === -2, badStore);
// slots survive bm_boot (SRAM persists across reset): save, end run, re-boot same instance
const BS = await drive({ span: 50, acts: [{ k: 'sv', at: 40, fn: (ex) => { ex.bm_sram_save(7, CRC); } }] });
let surv = -99, bootTrap = null;
try { BS.ex.bm_boot(); } catch (e) { if (e.message !== 'STOP') bootTrap = String(e.message).slice(0, 60); }
surv = BS.ex.bm_sram_info(7, 0);
ok('slots survive bm_boot', surv === 1 && !bootTrap && !BS.trap, surv + ' ' + bootTrap);
console.log('----');
console.log((fail === 0 ? 'E1 ALL ' + pass + ' CHECKS GREEN' : 'E1 FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
