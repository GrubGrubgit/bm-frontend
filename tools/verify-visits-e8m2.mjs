// E8-M2: exploration tracking in-engine (visited screens + exports).
// Run: node tools/verify-visits-e8m2.mjs (from frontend/)
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const WASMB = new Uint8Array(readFileSync(PROJ + '/frontend/build/game.wasm'));
function fnv(b) { let h = 2166136261; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777219); } return h >>> 0; }
async function drive(o) {
  const rec = [];
  let n = -1;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = win.exports;
    let pad = 0;
    for (const t of (o.taps || [])) if (n >= t.at && n < t.at + 8) pad = t.pad;
    ex.bm_set_pad(pad);
    if (o.onFrame) o.onFrame(ex, n);
    if (o.rec && n % 10 === 0) {
      const mem = new Uint8Array(ex.memory.buffer);
      const vp = ex.bm_visit_ptr();
      rec.push({ f: n, cur: ex.bm_visit_cur(), vb: fnv(mem.slice(vp, vp + 128)) });
    }
    if (n >= o.span) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat2 = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat2(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat2(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  return { ex: inst.exports, trap, rec };
}
const ENHS = (ex) => { ex.bm_enhanced_set(1); };
// run helper shared by C/D/M
async function walkRun(extraTaps) {
  return drive({ span: 1300, rec: true,
    taps: [{ at: 61, pad: 8 }].concat(extraTaps || []),
    onFrame: (ex, f) => { if (f === 200) ENHS(ex); if (f === 300) ex.bm_warp_raw(9); if (f >= 400 && f < 1200) ex.bm_set_pad(128); } });
}
// A: exports exist, pregame cur==-1, get/set/reset roundtrip
{
  const R = await drive({ span: 120, rec: false, taps: [{ at: 61, pad: 8 }],
    onFrame: (ex, f) => { if (f === 100) { ex.bm_enhanced_set(1); } } });
  const ex = R.ex;
  ok('A pregame cur==-1 + zero bits', !R.trap && ex.bm_visit_cur() === -1 && ex.bm_visit_get(2, 0, 0) === 0, R.trap);
  ex.bm_visit_set(2, 3, 4, 1);
  ok('A set/get roundtrip', ex.bm_visit_get(2, 3, 4) === 1 && ex.bm_visit_get(2, 3, 5) === 0, '');
  ex.bm_visit_set(2, 3, 4, 0);
  ok('A clear works', ex.bm_visit_get(2, 3, 4) === 0, '');
  ex.bm_visit_set(5, 0, 0, 1); ex.bm_visit_reset();
  ok('A reset clears all', ex.bm_visit_get(5, 0, 0) === 0, '');
  ok('A bad args safe', ex.bm_visit_get(0, 0, 0) === -1 && ex.bm_visit_get(17, 0, 0) === -1 && ex.bm_visit_get(1, 8, 0) === -1, '');
}
// B: enhanced-off marks nothing
{
  const R = await drive({ span: 900, rec: false, taps: [{ at: 61, pad: 8 }],
    onFrame: (ex, f) => { if (f === 300) ex.bm_warp_raw(9); if (f >= 400 && f < 800) ex.bm_set_pad(128); } });
  const ex = R.ex;
  const mem = new Uint8Array(ex.memory.buffer);
  const sum = mem.slice(ex.bm_visit_ptr(), ex.bm_visit_ptr() + 128).reduce((a, b) => a + b, 0);
  ok('B enhanced-off marks nothing', !R.trap && sum === 0, R.trap || ('sum=' + sum));
}
// C: walk marks screens; cur advances with scroll
{
  const R = await walkRun();
  const ex = R.ex;
  const mem = new Uint8Array(ex.memory.buffer);
  const bits = mem.slice(ex.bm_visit_ptr(), ex.bm_visit_ptr() + 128);
  const marked = [];
  for (let lv = 1; lv <= 16; lv++) for (let s = 0; s < 64; s++) if ((bits[(lv - 1) * 8 + (s >> 3)] >> (s & 7)) & 1) marked.push(lv + ':' + (s % 8) + ',' + ((s / 8) | 0));
  const l2 = marked.filter((m) => m[0] === '2');
  ok('C walk marks L2 path 4,4->5,4 (no init artifact)', !R.trap && l2.length === 2 && l2.indexOf('2:4,4') >= 0 && l2.indexOf('2:5,4') >= 0, R.trap || marked.join(' '));
  const last = R.rec[R.rec.length - 1];
  ok('C cur valid in gameplay', !R.trap && last.cur >= 0, R.trap || ('cur=' + last.cur));
}
// D: door transit marks the new level too
{
  const R = await drive({ span: 1700, rec: false,
    taps: [{ at: 61, pad: 8 }, { at: 950, pad: 32 }, { at: 958, pad: 32 }],
    onFrame: (ex, f) => { if (f === 500) ENHS(ex); if (f === 800) ex.bm_warp_raw(9); } });
  const ex = R.ex;
  const mem = new Uint8Array(ex.memory.buffer);
  const bits = mem.slice(ex.bm_visit_ptr(), ex.bm_visit_ptr() + 128);
  let l1 = 0, l2 = 0;
  for (let s = 0; s < 64; s++) {
    if ((bits[0 * 8 + (s >> 3)] >> (s & 7)) & 1) l1++;
    if ((bits[1 * 8 + (s >> 3)] >> (s & 7)) & 1) l2++;
  }
  ok('D door transit marks both L1+L2', !R.trap && l1 >= 1 && l2 >= 1, R.trap || ('l1=' + l1 + ' l2=' + l2));
}
// M: determinism x2 (video+pre+visited)
{
  const mk = () => walkRun();
  const K1 = await mk(), K2 = await mk();
  let bad = 0;
  for (let i = 0; i < K1.rec.length; i++) {
    const a = K1.rec[i], b = K2.rec[i];
    if (!a || !b || a.cur !== b.cur || a.vb !== b.vb) bad++;
  }
  ok('M determinism x2 (cur+visited)', !K1.trap && !K2.trap && K1.rec.length > 50 && bad === 0, (K1.trap || K2.trap) || ('bad=' + bad + '/' + K1.rec.length));
}
console.log('---- E8M2: ' + pass + ' pass / ' + fail + ' ----');
process.exit(fail ? 1 : 0);
