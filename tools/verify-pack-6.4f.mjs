// 6.4f movement physics: Jason run/jump + tank drive constants.
// Run: node tools/verify-pack-6.4f.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { SUBPX, ADDR, xPx, JASON_RUN, JASON_JUMP, TANK } from '../src/pack/physics.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n +  (x ? ' :: ' + x : '')); } };
// ---- statics: lib model pins ----
ok('lib addrs', ADDR.X_LO === 0x402 && ADDR.X_HI === 0x403 && ADDR.Y_LO_TANK === 0x404 && ADDR.Y_HI_TANK === 0x405 && ADDR.CAM_X === 0x28 && ADDR.JASON_Y === 0x7D && ADDR.HP === 0x40D);
ok('lib xPx', xPx(24, 128) === 392 && SUBPX === 16 && Math.abs(xPx(25, 0) - xPx(24, 255) - 1 / 16) < 1e-9);
ok('lib jason run', JASON_RUN.ACCEL === 2 && JASON_RUN.VMAX === 24 && JASON_RUN.FRICTION === 1);
ok('lib jump+tank', JASON_JUMP.Y0 === 147 && JASON_JUMP.APEX === 100 && JASON_JUMP.VY0 === -64 && JASON_JUMP.GRAVITY === 2 && JASON_JUMP.REST === 128 && TANK.VMAX === 24);
// ---- dynamic harness ----
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function cat(banks) { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; }
async function trace(k, padFn, span) {
  let n = -1; const snaps = [];
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = win.exports;
    ex.bm_set_pad(padFn(n));
    if (n === 700) ex.bm_warp_raw(k);
    if (n >= span[0] && n <= span[1]) {
      ex.bm_snap();
      const mem = new Uint8Array(ex.memory.buffer);
      const ram = new Uint8Array(2048);
      for (let a = 0; a < 2048; a++) ram[a] = ex.bm_ram_rd(a);
      const oam = mem.slice(ex.bm_oam_ptr(), ex.bm_oam_ptr() + 256);
      snaps.push({ n, ram, oam });
    }
    if (n >= span[1] + 5) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  try {
    const mm8 = new Uint8Array(win.exports.memory.buffer);
    mm8.set(cat(stock.prg), win.exports.bm_stage_ptr()); win.exports.bm_load_prg();
    mm8.set(cat(stock.chr), win.exports.bm_stage_ptr()); win.exports.bm_load_chr();
    win.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') return { trap: e.message, snaps: [] }; }
  return { trap: null, snaps };
}
function wd(vals) { const d = []; for (let i = 1; i < vals.length; i++) { let dd = vals[i] - vals[i-1]; if (dd > 127) dd -= 256; if (dd < -127) dd += 256; d.push(dd); } return d; }
function lockstep(snaps, loA, hiA) {
  for (let i = 1; i < snaps.length; i++) {
    const crossed = snaps[i].ram[loA] < snaps[i-1].ram[loA];
    const dhi = (snaps[i].ram[hiA] - snaps[i-1].ram[hiA] + 256) & 255;
    if (crossed && dhi !== 1) return false;
    if (!crossed && dhi !== 0) return false;
  }
  return true;
}
function flat(snaps, i0, i1) { const v = snaps[i0].ram[ADDR.HP]; for (let i = i0 + 1; i <= i1; i++) if (snaps[i].ram[ADDR.HP] !== v) return false; return true; }
function sig(snaps) { return snaps.map(s => Array.from(s.ram).join(',') + '|' + Array.from(s.oam).join(',')).join(';'); }
// ---- Jason run Right: accel ramp, cruise, release friction, lockstep, camera ----
{
  const R = await trace(8, (n) => n === 61 ? 8 : ((n >= 860 && n < 882) ? 128 : 0), [858, 906]);
  ok('J-R hp flat 255', R.trap === null && flat(R.snaps, 0, R.snaps.length - 1) && R.snaps[0].ram[ADDR.HP] === 255);
  const d = wd(R.snaps.map(s => s.ram[ADDR.X_LO]));
  ok('J-R accel ramp +2/f2', [2,4,6,8,10,12,14,16,18,20,22,24].every((v, j) => d[3 + j] === v), JSON.stringify(d.slice(0, 16)));
  ok('J-R cruise +24 then -1 friction', d.slice(15, 23).every(v => v === 24) && d[25] === 23 && d[26] === 22, JSON.stringify(d.slice(14, 28)));
  ok('J-R X-hi lockstep $403', lockstep(R.snaps, ADDR.X_LO, ADDR.X_HI));
  ok('J-R camera static', R.snaps.every(s => s.ram[ADDR.CAM_X] === R.snaps[0].ram[ADDR.CAM_X]));
}
// ---- Jason reverse + Left symmetry ----
{
  const R = await trace(8, (n) => n === 61 ? 8 : ((n >= 860 && n < 880) ? 128 : ((n >= 880 && n < 900) ? 64 : 0)), [858, 932]);
  ok('J-RL hp flat 255', R.trap === null && flat(R.snaps, 0, R.snaps.length - 1));
  const d = wd(R.snaps.map(s => s.ram[ADDR.X_LO]));
  const brake = [22,20,18,16,14,12,10,8,6,4,2,0];
  ok('J-RL reverse brake -2/f2', brake.every((v, j) => d[23 + j] === v), JSON.stringify(d.slice(22, 40)));
  const iMin = d.indexOf(Math.min(...d));
  ok('J-RL left accel symmetric', Math.min(...d) <= -16 && d[iMin + 1] >= -16, 'min=' + Math.min(...d));
  const tail = d.slice(d.lastIndexOf(-1));
  ok('J-RL release friction +1 to stop', tail.length >= 2 && tail[0] === -1 && tail.slice(1).every(v => v === 0) && d[d.length - 1] === 0, JSON.stringify(d.slice(-8)));
}
// ---- Jason jump: $7D arc + $404 linear velocity ramp ----
{
  const runJump = () => trace(8, (n) => n === 61 ? 8 : ((n >= 960 && n < 975) ? 129 : 0), [950, 1030]);
  const R = await runJump();
  ok('J-J hp flat 255', R.trap === null && flat(R.snaps, 0, R.snaps.length - 1) && R.snaps[0].ram[ADDR.HP] === 255);
  const y = R.snaps.map(s => s.ram[ADDR.JASON_Y]);
  const yd = wd(y);
  const iTake = yd.findIndex(v => v !== 0);
  const iLand = yd.findIndex((v, i) => i > iTake && y[i + 1] === 147);
  ok('J-J arc 147->100->147', y[0] === 147 && Math.min(...y) === 100 && iTake > 0 && iLand > iTake && y[R.snaps.length - 1] === 147, 'take=' + R.snaps[iTake].n + ' land=' + R.snaps[iLand + 1].n);
  ok('J-J arc deltas bounded', yd.every(v => v >= -4 && v <= 4) && (iLand + 1 - iTake) >= 35 && (iLand + 1 - iTake) <= 55, 'air=' + (iLand + 1 - iTake));
  const v = R.snaps.map(s => s.ram[ADDR.Y_LO_TANK]);
  const t64 = v.findIndex((x, i) => i > 4 && x === 64 && v[i - 1] === 128);
  const FLIGHT = [64,2,198,140,84,30,234,184,136,90,46,4,220,182,146,146,148,152,158,166,176,188,202,218,236,0,22,46,72,100,130,162,196,232,14,54,96,140,186,234,28,80,128];
  const fl = t64 > 0 && v.slice(t64, t64 + FLIGHT.length).join(',') === FLIGHT.join(',') && v.slice(0, t64).every(x => x === 128) && v.slice(t64 + FLIGHT.length).every(x => x === 128);
  ok('J-J $404 exact flight series (apex stutter incl)', fl, v.filter((_, i) => i % 4 === 0).join(','));
  ok('J-J $404 rests 128', v[iTake - 1] === 128 && v[v.length - 1] === 128);
  const R2 = await runJump();
  ok('J-J determinism x2', sig(R.snaps) === sig(R2.snaps));
}
// ---- Tank X: instant velocity, lockstep, determinism ----
{
  const runX = () => trace(0, (n) => n === 61 ? 8 : ((n >= 860 && n < 880) ? 128 : 0), [858, 906]);
  const R = await runX();
  ok('T-X hp flat 255', R.trap === null && flat(R.snaps, 0, R.snaps.length - 1) && R.snaps[0].ram[ADDR.HP] === 255);
  const d = wd(R.snaps.map(s => s.ram[ADDR.X_LO]));
  ok('T-X instant +-24 no ramp/friction', d.every(v => v === 0 || v === 24) && d.includes(24) && d.slice(-10).every(v => v === 0), JSON.stringify(d.slice(0, 28)));
  ok('T-X hi lockstep $403', lockstep(R.snaps, ADDR.X_LO, ADDR.X_HI));
  const R2 = await runX();
  ok('T-X determinism x2', sig(R.snaps) === sig(R2.snaps));
}
// ---- Tank Y: Up long (ceiling pin), Down tap, Up tap open-space ----
{
  const R = await trace(0, (n) => n === 61 ? 8 : ((n >= 950 && n < 980) ? 16 : 0), [946, 1020]);
  ok('T-Yup window hp flat', R.trap === null && flat(R.snaps, 4, 34));
  const d = wd(R.snaps.map(s => s.ram[ADDR.Y_LO_TANK]));
  ok('T-Yup instant -24, ceiling -8,0, holds 128', d[5] === -24 && d.slice(5, 26).every(v => v === -24) && d[26] === -8 && d.slice(27, 40).every(v => v === 0), JSON.stringify(d.slice(3, 36)));
  const net = (R.snaps[34].ram[ADDR.Y_HI_TANK] - R.snaps[4].ram[ADDR.Y_HI_TANK] + 256) & 255;
  ok('T-Yup net -512 subunits (hi -2, lo 128->128)', net === 254 && R.snaps[34].ram[ADDR.Y_LO_TANK] === 128, 'hiNet=' + net);
}
{
  const runDn = () => trace(0, (n) => n === 61 ? 8 : ((n >= 950 && n < 955) ? 32 : 0), [946, 995]);
  const R = await runDn();
  ok('T-Ydn window hp flat', R.trap === null && flat(R.snaps, 4, 12));
  const d = wd(R.snaps.map(s => s.ram[ADDR.Y_LO_TANK]));
  ok('T-Ydn instant +24 x5, instant stop', d.slice(5, 10).every(v => v === 24) && d.slice(10, 20).every(v => v === 0), JSON.stringify(d.slice(3, 18)));
  ok('T-Ydn pos holds 248, hi unchanged', R.snaps[R.snaps.length - 1].ram[ADDR.Y_LO_TANK] === 248 && R.snaps[R.snaps.length - 1].ram[ADDR.Y_HI_TANK] === R.snaps[4].ram[ADDR.Y_HI_TANK]);
  const R2 = await runDn();
  ok('T-Ydn determinism x2', sig(R.snaps) === sig(R2.snaps));
}
{
  const R = await trace(0, (n) => n === 61 ? 8 : ((n >= 950 && n < 955) ? 16 : 0), [946, 990]);
  ok('T-Yup-tap window hp flat', R.trap === null && flat(R.snaps, 4, 12));
  const d = wd(R.snaps.map(s => s.ram[ADDR.Y_LO_TANK]));
  ok('T-Yup-tap instant -24 x5, instant stop (no -8)', d.slice(5, 10).every(v => v === -24) && d.slice(10, 20).every(v => v === 0), JSON.stringify(d.slice(3, 18)));
}
{
  const R = await trace(8, (n) => n === 61 ? 8 : ((n >= 960 && n < 975) ? 129 : 0), [950, 1030]);
  ok('V16 window hp flat', R.trap === null && flat(R.snaps, 0, R.snaps.length - 1));
  const S = R.snaps;
  const V = (s) => { const u = (s.ram[ADDR.Y_HI_TANK] << 8) | s.ram[ADDR.Y_LO_TANK]; return (u >= 0x8000 ? u - 0x10000 : u) - JASON_JUMP.VREST; };
  const tk = S.findIndex((s, i) => i + 1 < S.length && s.ram[ADDR.Y_LO_TANK] === 128 && s.ram[ADDR.Y_HI_TANK] === 59 && S[i + 1].ram[ADDR.Y_LO_TANK] !== 128);
  ok('V16 takeoff found', tk > 0, 'tk=' + tk);
  const Vs = S.map(V);
  const ds = [];
  for (let i = tk; i < S.length - 1; i++) ds.push(Vs[i + 1] - Vs[i]);
  const exp = [];
  for (let v = -64; v <= -36; v += 2) exp.push(v);
  exp.push(0);
  for (let v = 2; v <= 52; v += 2) exp.push(v);
  exp.push(48);
  const flight = ds.slice(0, exp.length);
  ok('V16 exact 43-frame flight series', flight.length === exp.length && flight.every((v, i) => v === exp[i]), flight.slice(0, 6).join(',') + '...');
  ok('V16 rest zeros after landing', ds.slice(exp.length).every(v => v === 0));
  ok('7D = Y0 + floor(V/16) all frames', S.every(s => s.ram[ADDR.JASON_Y] === JASON_JUMP.Y0 + Math.floor(V(s) / 16)));
  ok('405 rest 59 both ends', S[0].ram[ADDR.Y_HI_TANK] === 59 && S[S.length - 1].ram[ADDR.Y_HI_TANK] === 59);
  const R2 = await trace(8, (n) => n === 61 ? 8 : ((n >= 960 && n < 975) ? 129 : 0), [950, 1030]);
  ok('V16 determinism x2', sig(R.snaps) === sig(R2.snaps));
}
{
  const R = await trace(0, (n) => n === 61 ? 8 : 0, [858, 866]);
  ok('tank rest pair (22,128)', R.trap === null && R.snaps.every(s => s.ram[ADDR.Y_LO_TANK] === 128 && s.ram[ADDR.Y_HI_TANK] === 22));
}
console.log('---- 6.4f: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
