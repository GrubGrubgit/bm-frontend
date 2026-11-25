// E8-M1: static world topology (levels, doors->screens, graph). DOM-free.
// Run: node tools/verify-world-e8m1.mjs (from frontend/)
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { parseBank } from '../src/pack/levels.js';
import { parseDoors, pairOf } from '../src/pack/doors.js';
import { buildWorld, AREA_LEVEL, tileWalkable } from '../src/pack/world.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('S stock pack builds', sb.ok);
const stock = sb.pack;
const pd = parseDoors(stock.prg[7]);
ok('S parseDoors ok, 108 rows', pd.ok && pd.rows.length === 108, pd.errors.join(' '));
const w = buildWorld(stock);
ok('S buildWorld ok, 16 levels', w.ok && Object.keys(w.levels).length === 16, w.errors.join(' '));
ok('S 108 sides, 54 door edges', w.sides.length === 108 && w.doorEdges.length === 54);
// A: mapping universality
const oob = w.sides.filter((s) => !s.inMap);
const nodoor = w.sides.filter((s) => !s.doorBit);
ok('A every side in-map on its AREA_LEVEL (108/108)', oob.length === 0, oob.map((s) => s.idx).join(','));
ok('A every side sits on a door-bit combo (108/108)', nodoor.length === 0, nodoor.map((s) => s.idx).join(','));
// B: pairing
let invBad = 0, selfPair = 0;
for (const s of w.sides) {
  if (w.sides[s.pair].pair !== s.idx) invBad++;
  if (s.pair === s.idx) selfPair++;
}
ok('B pair involution, no self-pairs', invBad === 0 && selfPair === 0, 'inv=' + invBad + ' self=' + selfPair);
// C: per-level side counts (L7 is the hub)
const per = {};
for (const s of w.sides) per[s.level] = (per[s.level] || 0) + 1;
const exp = { 1: 7, 2: 7, 3: 7, 4: 6, 5: 7, 6: 5, 7: 26, 8: 6, 9: 5, 10: 4, 11: 5, 12: 4, 13: 5, 14: 4, 15: 5, 16: 5 };
ok('C sides per level match (L7 hub=26)', JSON.stringify(per) === JSON.stringify(exp), JSON.stringify(per));
// D: one traversable world
const dc = w.doorComponents;
ok('D all 108 door screens mutually reachable (1 component)', dc.length === 1 && dc[0].length === 108, dc.length + ' comps');
const main = w.components.slice().sort((a, b) => b.length - a.length)[0];
const doorSet = new Set(w.sides.map((s) => s.level + ':' + s.sx + ',' + s.sy));
ok('D main component holds every door screen (763 screens)', main.length === 763 && [...doorSet].every((k) => main.includes(k)), 'main=' + main.length);
// E: pocket census (INFO only -- isolated walkable pockets have no doors by D,
// so they are map margins or upgrade-sealed; M3 fog-of-war + M4 symbols handle
// them; exact D counts above pin the border rule against regressions)
const parsed = [0, 1, 2].map((b) => parseBank(stock.prg[b], b));
const LL = {};
for (const p of parsed) for (const l of p.levels) LL[l.level] = l;
const mainSet = new Set(main);
const pockets = [];
for (let lv = 1; lv <= 16; lv++) {
  const { screensX, screensY } = w.levels[lv];
  for (let sy = 0; sy < screensY; sy++) for (let sx = 0; sx < screensX; sx++) {
    const k = lv + ':' + sx + ',' + sy;
    if (mainSet.has(k)) continue;
    let c = 0;
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) if (tileWalkable(LL[lv], sx * 32 + tx, sy * 32 + ty)) c++;
    if (c > 128) pockets.push(k + ':' + c);
  }
}
console.log('INFO isolated walkable pockets (>128 tiles): ' + pockets.length);
console.log('INFO ' + pockets.join(' '));
const pocketDoors = w.sides.filter((s) => !mainSet.has(s.level + ':' + s.sx + ',' + s.sy));
ok('E pockets hold no doors (unreachable except via play)', pocketDoors.length === 0, pocketDoors.map((s) => s.idx).join(','));
// F: level geometry
const rowsOk = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 15, 16].every((lv) => w.levels[lv].rows === 32) && w.levels[9].rows === 25 && w.levels[13].rows === 29;
ok('F map rows (32 tank, 25 L9, 29 L13)', rowsOk);
console.log('---- E8M1: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
