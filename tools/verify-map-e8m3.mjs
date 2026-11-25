// E8-M3: HUD minimap model + shell wiring statics + engine bit cross-check.
// Run: node tools/verify-map-e8m3.mjs (from frontend/)
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { buildMinimap, decodeCur, isVisited, visitsHash, fogCells, minimapCacheKey, screensYOf, VISIT_ROWS } from '../src/pack/minimap.js';
import { buildWorld } from '../src/pack/world.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const mm = buildMinimap(stock);
ok('model builds ok', mm.ok, (mm.errors || []).join(';'));
// rows match the engine visit_rows table (bm_api.c visit_rows)
let rowsOk = true;
for (let v = 1; v <= 16; v++) if (mm.levels[v].rows !== VISIT_ROWS[v - 1]) rowsOk = false;
ok('rows match engine visit_rows (25 L9, 29 L13)', rowsOk);
let syOk = true;
for (let v = 1; v <= 16; v++) if (mm.levels[v].screensY !== screensYOf(VISIT_ROWS[v - 1])) syOk = false;
ok('screensY = ceil(rows/4) (L9=7, rest 8)', syOk && mm.levels[9].screensY === 7 && mm.levels[13].screensY === 8);
const w = buildWorld(stock);
const wPer = {};
for (const s of w.sides) wPer[s.level] = (wPer[s.level] || 0) + 1;
let tickTotal = 0, perOk = true;
for (let v = 1; v <= 16; v++) { tickTotal += mm.levels[v].ticks.length; if (mm.levels[v].ticks.length !== (wPer[v] || 0)) perOk = false; }
ok('108 door ticks, per-level counts match world sides', mm.ok && tickTotal === 108 && perOk, 'total=' + tickTotal);
let tickPos = true;
for (const s of w.sides) {
  const t = mm.levels[s.level].ticks.find((t) => t.side === s.idx);
  if (!t || t.sx !== s.sx || t.sy !== s.sy || t.pair !== s.pair) { tickPos = false; break; }
  if (t.bx < 0 || t.bx >= 32 || t.by < 0 || t.by >= mm.levels[s.level].rows) { tickPos = false; break; }
  if (t.px < 0 || t.px > 128 || t.py < 0 || t.py > 128) { tickPos = false; break; }
}
ok('tick screens match world sides, pixels in-bounds', tickPos);
// decodeCur vectors
const d0 = decodeCur(0), d63 = decodeCur(63), d64 = decodeCur(64), dM = decodeCur(1023);
ok('decodeCur vectors', d0 && d0.lv === 1 && d0.sx === 0 && d0.sy === 0 && d63.lv === 1 && d63.sx === 7 && d63.sy === 7 && d64.lv === 2 && d64.sx === 0 && d64.sy === 0 && dM.lv === 16 && dM.sx === 7 && dM.sy === 7 && decodeCur(-1) === null && decodeCur(1024) === null);
// fog: zero bytes
const zero = new Array(128).fill(0);
const f2 = fogCells(zero, mm.levels[2]);
ok('fog L2 zero bytes: 64 fogged, 0 void', f2.filter((c) => !c.void && !c.visited).length === 64 && f2.filter((c) => c.void).length === 0);
const f9 = fogCells(zero, mm.levels[9]);
ok('fog L9 zero bytes: 56 fogged + 8 void', f9.filter((c) => !c.void && !c.visited).length === 56 && f9.filter((c) => c.void).length === 8);
const full = new Array(128).fill(255);
const fF = fogCells(full, mm.levels[2]);
ok('fog full bytes: 0 fogged', fF.filter((c) => !c.void && !c.visited).length === 0);
// engine bit-index cross-check (no boot: visit fns are static RAM ops)
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: () => {} } })).instance;
const ex = inst.exports;
const mem = () => new Uint8Array(ex.memory.buffer);
ok('engine pregame cur == -1 (fresh, no boot)', ex.bm_visit_cur() === -1);
ex.bm_visit_set(3, 2, 5, 1); ex.bm_visit_set(16, 7, 7, 1);
const eb = Array.from(mem().slice(ex.bm_visit_ptr(), ex.bm_visit_ptr() + 128));
ok('model bit-index matches engine set bits', isVisited(eb, 3, 2, 5) && isVisited(eb, 16, 7, 7) && !isVisited(eb, 3, 2, 4) && ex.bm_visit_get(3, 2, 5) === 1);
ex.bm_visit_set(3, 2, 5, 0);
const eb2 = Array.from(mem().slice(ex.bm_visit_ptr(), ex.bm_visit_ptr() + 128));
ok('clear reflected in model', !isVisited(eb2, 3, 2, 5) && isVisited(eb2, 16, 7, 7));
ok('visitsHash stable + sensitive', visitsHash(eb) === visitsHash(eb.slice()) && visitsHash(eb) !== visitsHash(eb2));
ok('cacheKey distinct per pack/level', minimapCacheKey('stock', 'c1', 1) !== minimapCacheKey('stock', 'c1', 2) && minimapCacheKey('stock', 'c1', 1) !== minimapCacheKey('other', 'c1', 1));
ok('determinism: rebuild identical', JSON.stringify(buildMinimap(stock).levels) === JSON.stringify(buildMinimap(stock).levels));
// shell wiring statics (enhance.js HUD + sync)
const enh = readFileSync(PROJ + '/frontend/src/ui/enhance.js', 'utf8');
const has = (s) => enh.indexOf(s) >= 0;
const syncCalls = (enh.match(/syncVisits\(/g) || []).length;
ok('shell: mapHud overlay + paint + cur + ram + visits IO', has('mapHud') && has('paintMap(') && has('bm_visit_cur') && has('bm_ram_rd') && has('loadVisits') && has('saveVisits'), '');
ok('shell: syncVisits wired (>= def + pack + edge + timer)', syncCalls >= 4, 'calls=' + syncCalls);
ok('shell: no dead union (old fns gone or delegated)', enh.indexOf('async function unionVisits') < 0 && enh.indexOf('function ensureVisits') < 0, '');
console.log('---- E8M3: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
