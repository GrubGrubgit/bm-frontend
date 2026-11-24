// E1b: lives/continues-disable enforcement (infinite lives while saving is on).
// Run: node tools/verify-lives.mjs  (from frontend/)
// Death driver: boot, Start 61-65, warp(9) at f=1000 (dungeon B0, Jason on
// foot), walk right from f=1060. Enemy contact drains ram $40D (Jason HP, full
// 255) to 0; each nonzero-to-0 crossing is a C52A death (sole lives-DEC at
// C537 + sole continues-DEC at C53B in the whole engine; vendor hook 6 gates
// both on saving_on, anchor-asserted count==1 each). Stock (saving off): lives
// 2->1->0->underflow $FF, a continue burned 5->4, then STUCK (no respawn) in the
// continue/game-over flow. Saving on: every death respawns (~243f, hp 255),
// counters frozen, game-over unreachable. $6F3==0 at every observed death, so
// the C530 direct-game-over branch stays cold in this flow.
import { readFileSync } from 'fs';
import { buildPack } from '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/frontend/src/pack/builder.js';
const NL = String.fromCharCode(10);
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const WASMB = readFileSync(PROJ + '/frontend/build/game.wasm');
const VEN = readFileSync(PROJ + '/frontend/build/vendor/combined_off.c', 'utf8');
ok('lives-gate present x2 in vendored build', VEN.split('if (saving_on)').length === 3);
async function soak(o) {
  const deaths = [], respawns = [];
  let lastHP = -1, alive = true, end = null, trap = null, offDone = false;
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    ex.bm_set_pad((f >= 61 && f <= 65) ? 8 : ((f >= 1060) ? 128 : 0));
    if (f === 10) ex.bm_saving_set(o.save ? 1 : 0);
    if (f === 1000) ex.bm_warp(9);
    if (o.forceZeroAt && f === o.forceZeroAt) ex.bm_ram_wr(0xDD, 0);
    if (f >= 1000) {
      const lives = ex.bm_ram_rd(0xDD), cont = ex.bm_ram_rd(0x37E);
      const hp = ex.bm_ram_rd(0x40D), area = ex.bm_ram_rd(0x14), g = ex.bm_ram_rd(0x6F3);
      if (lastHP < 0) lastHP = hp;
      if (alive && lastHP > 0 && hp === 0) { alive = false; deaths.push({ f: f, lives: lives, cont: cont, area: area, g: g }); }
      if (!alive && hp > 0) {
        alive = true; respawns.push({ f: f, hp: hp, lives: lives, cont: cont });
        if (o.saveOffAfterRespawns && respawns.length >= o.saveOffAfterRespawns && !offDone) { offDone = true; ex.bm_saving_set(0); }
      }
      lastHP = hp;
      end = { f: f, lives: lives, cont: cont, hp: hp, area: area, alive: alive };
    }
    if (f + 1 >= 1000 + o.span) throw new Error('STOP');
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
  return { trap: trap, flag: flag, deaths: deaths, respawns: respawns, end: end };
}
// --- saving round-trip on a fresh instance ---
{
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => { if (f + 1 >= 12) throw new Error('STOP'); } } })).instance;
  const ex = inst.exports;
  let trap = null;
  try { ex.bm_boot(); } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 60); }
  const t0 = ex.bm_saving_get() === 0;
  ex.bm_saving_set(1); const t1 = ex.bm_saving_get() === 1;
  ex.bm_saving_set(9); const t2 = ex.bm_saving_get() === 1;
  ex.bm_saving_set(0); const t3 = ex.bm_saving_get() === 0;
  ok('saving default off + round-trip + normalize', !trap && t0 && t1 && t2 && t3, trap);
}
// --- control: saving OFF (stock exhaustion path live) ---
const C1 = await soak({ save: 0, span: 3500 });
const C2 = await soak({ save: 0, span: 3500 });
const cfr = (r) => r.deaths.slice(0, 3).map((d) => d.f).join(',');
ok('control: 3 deaths at exact frames 1487/2095/2703', !C1.trap && cfr(C1) === '1487,2095,2703', C1.trap || cfr(C1));
ok('control: deterministic x2', !C2.trap && cfr(C2) === cfr(C1), C2.trap || cfr(C2));
ok('control: lives 2->1->0->underflow FF, cont 5->4', C1.deaths[0].lives === 2 && C1.deaths[1].lives === 1 && C1.deaths[2].lives === 0 && C1.respawns[0].lives === 1 && C1.respawns[1].lives === 0 && C1.end.lives === 255 && C1.end.cont === 4, 'd=' + C1.deaths.map((d) => d.lives).join(',') + ' end=' + C1.end.lives + '/' + C1.end.cont);
ok('control: stuck after 3rd death (2 respawns, hp 0, no rewind)', C1.respawns.length === 2 && C1.end.hp === 0 && C1.end.alive === false && (C1.end.f - C1.deaths[2].f) >= 1500, 'resp=' + C1.respawns.length + ' endf=' + C1.end.f);
ok('control: 6F3==0 and area 9 at every death', C1.deaths.every((d) => d.g === 0 && d.area === 9), JSON.stringify(C1.deaths.map((d) => d.g)));
// --- saving ON: infinite lives ---
const S1 = await soak({ save: 1, span: 5200 });
const S2 = await soak({ save: 1, span: 5200 });
const sfr = (r) => r.deaths.slice(0, 3).map((d) => d.f).join(',');
ok('saving-on: 8 deaths, all respawned, first-3 frames match control', !S1.trap && S1.deaths.length >= 8 && S1.respawns.length >= S1.deaths.length && sfr(S1) === cfr(C1), S1.trap || (S1.deaths.length + '/' + S1.respawns.length + ' ' + sfr(S1)));
ok('saving-on: lives==2 and cont==5 at every death/respawn/end', S1.deaths.every((d) => d.lives === 2 && d.cont === 5) && S1.respawns.every((r) => r.lives === 2 && r.cont === 5) && S1.end.lives === 2 && S1.end.cont === 5, 'end=' + S1.end.lives + '/' + S1.end.cont);
ok('saving-on: 6F3==0 at every death (direct-game-over path cold)', S1.deaths.every((d) => d.g === 0), JSON.stringify(S1.deaths.map((d) => d.g)));
ok('saving-on: deterministic x2, trap-free', !S1.trap && !S2.trap && S1.flag === 0 && S2.flag === 0 && sfr(S2) === sfr(S1) && S2.end.lives === 2 && S2.end.cont === 5, S1.trap || S2.trap || sfr(S2));
// --- boundary: lives forced to 0 with saving on (would underflow stock) ---
const B1 = await soak({ save: 1, span: 3500, forceZeroAt: 1200 });
ok('boundary lives=0: all deaths respawn, lives stays 0 (never FF), cont 5', !B1.trap && B1.deaths.length >= 2 && B1.respawns.length >= B1.deaths.length && B1.deaths.every((d) => d.lives === 0 && d.cont === 5) && B1.respawns.every((r) => r.lives === 0) && B1.end.lives === 0 && B1.end.cont === 5, B1.trap || ('d=' + B1.deaths.length + ' r=' + B1.respawns.length + ' end=' + B1.end.lives + '/' + B1.end.cont));
// --- dynamic gate: saving off mid-run resumes decrements ---
const T1 = await soak({ save: 1, span: 3000, saveOffAfterRespawns: 2 });
ok('toggle off mid-run: frozen R1/R2 lives 2, then resumes 1/0, cadence intact', !T1.trap && T1.deaths.length >= 4 && T1.respawns[0].lives === 2 && T1.respawns[1].lives === 2 && T1.respawns[2].lives === 1 && T1.respawns[3].lives === 0 && T1.deaths[2].f === 2703 && T1.end.cont === 5 && T1.end.lives === 0, T1.trap || ('resp=' + T1.respawns.map((r) => r.lives).join(',')));
ok('game-over unreachable: saving-on cont still 5 after 8 deaths (control burned one after 3)', S1.end.cont === 5 && C1.end.cont === 4, S1.end.cont + ' vs ' + C1.end.cont);
console.log('----');
console.log((fail === 0 ? 'E1B ALL ' + pass + ' CHECKS GREEN' : 'E1B FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
