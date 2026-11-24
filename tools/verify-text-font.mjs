// E0: text font map (Blaster Master uses ASCII tile indices for text).
// Separator byte is $00 (blank tile); literal $2E periods exist in the staff
// roll but tile $2E is blank on the title font page (credits page or
// routine translation TBD -- open micro-item for E2).
// Run: node tools/verify-text-font.mjs  (from frontend/)
// Proven headless: title-screen nametable spells stock strings with tile
// index == ASCII byte ($00 = blank/space separator); font glyphs live in
// CHR bank 3 $1000-half (4KB page 7 of concatenated stock.chr). Open
// micro-item: the text-draw routine entry (not needed for engine overlay
// work -- the overlay blits harvested glyph pixels directly).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const B7 = stock.prg[7];
const asc = (o, s) => { for (let i = 0; i < s.length; i++) if (B7[o + i] !== s.charCodeAt(i)) return false; return true; };
ok('CONTINUE @rel 37C4', asc(0x37C4, 'CONTINUE'));
ok('END @rel 37CD', asc(0x37CD, 'END'));
ok('SELECT START AREA @rel 3525', asc(0x3525, 'SELECT START AREA'));
ok('ENTERING INTO @rel 3708 + $00 + AREA', asc(0x3708, 'ENTERING INTO') && B7[0x3708+13] === 0 && asc(0x3708+14, 'AREA'));
ok('CREDIT @rel 35D1', asc(0x35D1, 'CREDIT'));
ok('staff roll THANKS @rel 3B55 (ctx $00/periods)', asc(0x3B55, 'THANKS') && B7[0x3B55-1] === 0 && B7[0x3B55+6] === 0x2E && B7[0x3B55+7] === 0x2E);
const chr = Buffer.concat(stock.chr.map((b) => Buffer.from(b)));
ok('chr layout 16x8KB', stock.chr.length === 16 && stock.chr[0].length === 8192);
const blank = (t) => { const base = 7 * 4096 + t * 16; for (let i = 0; i < 16; i++) if (chr[base + i] !== 0) return false; return true; };
ok('tile $00 blank (space separator)', blank(0x00));
ok('tile $2E blank ($00 is the separator, not period)', blank(0x2E));
ok('glyphs present: A S 8 semi (non-blank)', !blank(0x41) && !blank(0x53) && !blank(0x38) && !blank(0x3B));
ok('digits + uppercase complete', (() => { for (let t = 0x30; t <= 0x39; t++) if (blank(t)) return false; for (let t = 0x41; t <= 0x5A; t++) if (blank(t)) return false; return true; })());
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
let blob = null, trap = null;
const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
  const ex = win.exports;
  ex.bm_set_pad(0);
  if (f === 300) { const mem = new Uint8Array(ex.memory.buffer); const sp = ex.bm_savestate_ptr(), sl = ex.bm_savestate_len(); blob = mem.slice(sp, sp + sl); }
  if (f + 1 >= 400) throw new Error('STOP');
} } })).instance;
const win = { exports: inst.exports };
try {
  const mm = () => new Uint8Array(inst.exports.memory.buffer);
  const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
  mm().set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
  mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
  inst.exports.bm_boot();
} catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
let flag = -1; try { flag = inst.exports.bm_trap_flag(); } catch (e) {}
ok('title boot trap-free, blob staged (magic+7836)', !trap && flag === 0 && blob && blob.length === 7836 && (blob[0] | (blob[1] << 8) | (blob[2] << 16) | (blob[3] << 24)) >>> 0 === 0x424D5356);
const vram = blob.slice(2428, 2428 + 2048);
const row = (t, r) => Array.from(vram.slice(t * 1024 + r * 32, t * 1024 + r * 32 + 32));
const isTxt = (t, s) => { for (let i = 0; i < s.length; i++) if (t[i] !== (s[i] === ' ' ? 0 : s.charCodeAt(i))) return false; return true; };
ok('NT0 row22 = SUN Corp text (identity map)', isTxt(row(0, 22).slice(2, 28), 'SUN CORPORATION OF AMERICA'));
ok('NT0 row23 = LICENSED BY NINTENDO OF', isTxt(row(0, 23).slice(2, 27), 'LICENSED BY NINTENDO OF'));
ok('NT0 row21 = (c)1988 prefix', row(0, 21)[9] === 0x10 && row(0, 21)[10] === 0x31 && row(0, 21)[11] === 0x39 && row(0, 21)[12] === 0x38 && row(0, 21)[13] === 0x38);
console.log('----');
console.log((fail === 0 ? 'E0-FONT ALL ' + pass + ' CHECKS GREEN' : 'E0-FONT FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
