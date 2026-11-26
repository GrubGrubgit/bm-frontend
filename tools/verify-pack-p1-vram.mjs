// P1-vram: editor tile decode vs LIVE PPU nametable (ground truth).
// Boots stock, warps raw to L1 ($14=8), snaps vram+scroll+chr, and
// requires the repo blockTiles() grid to reproduce ALL 960 NT bytes
// at some map offset (HUD rows included). Guards the 2026-11-27 fix
// of the intra-block assembly order (nested-push scrambled detail
// tiles within every block; coarse structure still looked right).
// Run: node tools/verify-pack-p1-vram.mjs  (from frontend/)
import { readFileSync } from 'fs';
import { parseBank } from '../src/pack/levels.js';
import { blockTiles, BG_CHR_BANK, MAP_COLS } from '../src/pack/tiles.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const eprg = new Uint8Array(8 * 16384);
for (let i = 0; i < 8; i++) eprg.set(rom.slice(16 + i * 16384, 16 + (i + 1) * 16384), i * 16384);
const echr = new Uint8Array(16 * 8192);
for (let j = 0; j < 16; j++) echr.set(rom.slice(16 + 8 * 16384 + j * 8192, 16 + 8 * 16384 + (j + 1) * 8192), j * 8192);
const p0 = parseBank(eprg.slice(0, 16384), 0);
ok('bank0 parses', p0.ok, (p0.errors || []).join(' '));
const L1 = p0.levels.find((l) => l.level === 1);
ok('L1 found', !!L1);
const MW = 256, MH = L1.map.length / MAP_COLS * 8;
const grid = new Uint8Array(MW * MH);
ok('blockTiles 64 entries', blockTiles(L1, L1.map[0]).length === 64);
for (let by = 0; by < L1.map.length / MAP_COLS; by++) for (let bx = 0; bx < MAP_COLS; bx++) {
  const tiles = blockTiles(L1, L1.map[by * MAP_COLS + bx]);
  for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) grid[(by * 8 + ty) * MW + (bx * 8 + tx)] = tiles[ty * 8 + tx].tile;
}
const wasm = readFileSync(PROJ + '/frontend/build/game.wasm');
async function snapOnce() {
  let win = null;
  const inst = (await WebAssembly.instantiate(wasm, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 2700 && f < 2705) ? 8 : 0);
    if (f === 3100) ex.bm_warp_raw(8);
    if (f === 4300) { ex.bm_snap(); throw new Error('STOP'); }
  } } })).instance;
  win = { exports: inst.exports };
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    mm().set(eprg, inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(echr, inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') throw e; }
  const mem = new Uint8Array(inst.exports.memory.buffer);
  return mem.slice(inst.exports.bm_stage_ptr(), inst.exports.bm_stage_ptr() + 4160);
}
const sn = await snapOnce();
const sn2 = await snapOnce();
function fnv(u8) { let h = 2166136261; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
const h1 = fnv(sn.slice(2048, 3072)), h2 = fnv(sn2.slice(2048, 3072));
ok('L1 vram deterministic x2', h1 === h2, h1 + ' vs ' + h2);
ok('L1 vram hash pinned', h1 === '4132f492', h1);
const scx = sn[4128], scy = sn[4129], r2000 = sn[4130], chr0 = sn[4131], chr1 = sn[4132], mmc = sn[4133];
ok('L1 video mode dungeon', r2000 === 0x90 && (mmc & 3) === 2, 'r2000=' + r2000.toString(16) + ' mmc=' + mmc.toString(16));
ok('L1 chr banks (spr0/bg8)', chr0 === 0 && chr1 === BG_CHR_BANK[1], 'chr0=' + chr0 + ' chr1=' + chr1);
const palBg = Array.from(sn.slice(4096, 4112));
ok('staged bg pal == level pal', palBg.every((v, i) => v === L1.pal[i]), palBg.map((v) => v.toString(16)).join(','));
const baseX = r2000 & 1;
const scr = [];
for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++) {
  const vx = (baseX * 256 + scx + tx * 8) % 512;
  const vy = (scy + ty * 8) % 240;
  const nt = (vx >= 256) ? 1 : 0;
  scr.push(sn[2048 + (nt ? 1024 : 0) + ((vy >> 3) * 32) + ((vx & 255) >> 3)]);
}
let best = { hit: -1 };
for (let oy = 0; oy <= MH - 30; oy++) for (let ox = 0; ox <= MW - 32; ox++) {
  let hit = 0;
  for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++) if (grid[(oy + ty) * MW + (ox + tx)] === scr[ty * 32 + tx]) hit++;
  if (hit > best.hit) best = { ox, oy, hit };
}
console.log('INFO best offset=(' + best.ox + ',' + best.oy + ') hit=' + best.hit + '/960');
ok('editor grid reproduces live NT 960/960', best.hit === 960, 'hit=' + best.hit);
console.log('----');
console.log('pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
