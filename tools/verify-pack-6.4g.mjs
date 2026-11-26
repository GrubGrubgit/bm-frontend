// 6.4g enemy behavior: slot arch + dispatch tables + actor state machines.
// Run: node tools/verify-pack-6.4g.mjs
import { readFileSync } from "fs";
import { buildPack } from "../src/pack/builder.js";
import { SLOT_BASE, SLOT_STRIDE, SLOT_N, ZP_BASE, DISP_DUN, DISP_TANK, DUN_TABLE_BASE, TANK_TABLE_BASE, BOSS_EGG, BOSS_ACTOR, BOSS_HP, EGG_B11_INIT, BOSS_INIT, DUN_TABLE, TANK_TABLE } from "../src/pack/behavior.js";
const PROJ = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n + (x ? " :: " + x : "")); } };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const Hx = (v) => "0x" + v.toString(16).padStart(2, "0");
const rom = new Uint8Array(readFileSync(PROJ + "/work/roms-dev/blaster-master-usa.nes"));
const stock = buildPack(rom, "ref.nes").pack;
const WASMB = new Uint8Array(readFileSync(PROJ + "/frontend/build/game.wasm"));
const B7 = 16 + 7 * 0x4000;
const hb = (rel, n) => Array.from(rom.slice(B7 + rel, B7 + rel + n)).map(v => v.toString(16).padStart(2, "0")).join("");
// ---- statics ----
ok("lib slot arch", SLOT_BASE === 0x400 && SLOT_STRIDE === 14 && SLOT_N === 18 && ZP_BASE === 0x46);
ok("lib dispatch consts", DISP_DUN === 0x40 && DISP_TANK === 0x60 && DUN_TABLE_BASE === 0x8002 && TANK_TABLE_BASE === 0x8006);
ok("lib boss consts", BOSS_EGG === 0x5b && BOSS_ACTOR === 0x63 && BOSS_HP === 0x80 && EGG_B11_INIT === 0xc0 && BOSS_INIT.b6 === 0 && BOSS_INIT.b7 === 8 && BOSS_INIT.b13 === 0x80);
ok("LC8DF 73B", hb(0x8df, 73) === "a456b900048546b901048547b902048548b903048549b90404854ab90504854bb90604854cb90704854db90804854eb90904854fb90a048550b90b048551b90c048552b90d04855360");
ok("LC928 73B", hb(0x928, 73) === "a456a546990004a547990104a548990204a549990304a54a990404a54b990504a54c990604a54d990704a54e990804a54f990904a550990a04a551990b04a552990c04a553990d0460");
ok("C971 head", hb(0x971, 11) === "a90085568557a656bd0004");
{
  const blob = hb(0x9a4, 50);
  ok("C9A4 bank select", blob.slice(0, 20) === "a240a5142908f002a260", blob.slice(0, 20));
  ok("C9A4 sbc01", blob.includes("a54638e901"), blob);
}
ok("EA3A 28B", hb(0x2a3a, 28) === "a27aa84a4a4a4a201be698290f0aa8b900809500b901809501a00060");
ok("EB51 19B", hb(0x2b51, 19) === "0aa89002e67bb17ac8aab17a857b867aa00060");
// ---- vector tables lib-vs-ROM ----
{
  const b4 = 16 + 4 * 0x4000 + 6, b6 = 16 + 6 * 0x4000;
  const W = (off, n) => { const o = []; for (let i = 0; i < n; i++) o.push(rom[off + i * 2] | (rom[off + i * 2 + 1] << 8)); return o; };
  ok("tank table len+eq", TANK_TABLE.length === 140 && eq(TANK_TABLE, W(b4, 140)));
  ok("tank idx0/97", TANK_TABLE[0] === 0x8af1 && TANK_TABLE[97] === 0xa571);
  ok("dun table len+eq", DUN_TABLE.length === 146 && eq(DUN_TABLE, W(b6, 146)));
  ok("dun idx85/89 actor55/59", DUN_TABLE[85] === 0xa40b && DUN_TABLE[89] === 0xa53a);
  ok("dun nulls 55/87", DUN_TABLE[55] === 0 && DUN_TABLE[87] === 0);
  ok("dun end guard", (rom[b6 + 146 * 2] | (rom[b6 + 146 * 2 + 1] << 8)) === 0x5b4c);
}
// ---- dynamic harness ----
function cat(banks) { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; }
async function run(P, warpKind, k, warpAt, padFn, snapsAt) {
  let n = -1; const snaps = [];
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    n++;
    const ex = win.exports;
    ex.bm_set_pad(padFn(n));
    if (n === warpAt) { if (warpKind === 0) ex.bm_warp_raw(k); else ex.bm_warp(k); }
    if (snapsAt.includes(n)) {
      ex.bm_snap();
      const ram = new Uint8Array(2048);
      for (let a = 0; a < 2048; a++) ram[a] = ex.bm_ram_rd(a);
      snaps.push({ n, ram });
    }
    if (n >= snapsAt[snapsAt.length - 1] + 5) throw new Error("STOP");
  } } })).instance;
  const win = { exports: inst.exports };
  try {
    const mm8 = new Uint8Array(win.exports.memory.buffer);
    mm8.set(cat(P.prg), win.exports.bm_stage_ptr()); win.exports.bm_load_prg();
    mm8.set(cat(P.chr), win.exports.bm_stage_ptr()); win.exports.bm_load_chr();
    win.exports.bm_boot();
  } catch (e) { if (e.message !== "STOP") return { trap: e.message, snaps: [] }; }
  return { trap: null, snaps };
}
const slot = (s, i) => { const o = 0x400 + i * 14; return Array.from(s.ram.slice(o, o + 14)); };
const diffs = (A, B) => { let d = 0; for (let i = 0; i < A.length; i++) for (let a = 0; a < 2048; a++) { if (a === 0x10) continue; if (A[i].ram[a] !== B[i].ram[a]) d++; } return d; };
// ---- dungeon run: warp(9), Right from 860, 49 snaps 860-1100 ----
const atD = [];
for (let f = 860; f <= 1100; f += 5) atD.push(f);
const padD = (n) => n === 61 ? 8 : ((n >= 860) ? 128 : 0);
const RD1 = await run(stock, 1, 9, 700, padD, atD);
const RD2 = await run(stock, 1, 9, 700, padD, atD);
ok("D traps null", RD1.trap === null && RD2.trap === null);
ok("D determinism x2", diffs(RD1.snaps, RD2.snaps) === 0);
{
  const S = RD1.snaps;
  const col = (i, j) => S.map(s => slot(s, i)[j]);
  ok("D s8 stays actor55", col(8, 0).every(v => v === 0x55));
  ok("D s8 b1 exact", eq(col(8, 1), [0x01,0x00,0x00,0x02,0x02,0x02,0x01,0x01,0x00,0x00,0x00,0x02,0x02,0x02,0x01,0x01,0x00,0x00,0x00,0x02,0x02,0x02,0x01,0x01,0x01,0x00,0x00,0x00,0x02,0x02,0x02,0x01,0x01,0x01,0x00,0x00,0x00,0x02,0x02,0x02,0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x02,0x02]));
  ok("D s8 b6 exact", eq(col(8, 6), [0xf1,0xf1,0xf1,0xf1,0xf1,0xf1,0xf1,0xf1,0xf1,0xf1,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f]));
  ok("D s8 xhi exact", eq(col(8, 3), [0x4b,0x4b,0x4a,0x4a,0x4a,0x4a,0x49,0x49,0x49,0x48,0x49,0x49,0x49,0x4a,0x4a,0x4a,0x4a,0x4b,0x4b,0x4b,0x4b,0x4c,0x4c,0x4c,0x4c,0x4d,0x4d,0x4d,0x4d,0x4e,0x4e,0x4e,0x4e,0x4f,0x4f,0x4f,0x4f,0x50,0x50,0x50,0x50,0x51,0x51,0x51,0x51,0x52,0x52,0x52,0x52]));
  ok("D s8 turnaround", col(8, 3)[9] === 0x48 && col(8, 6)[9] === 0xf1 && col(8, 6)[10] === 0x0f, "min-xhi + dir flip");
  ok("D s8 xlo exact", eq(col(8, 2), [0x80,0x35,0xea,0x9f,0x54,0x09,0xbe,0x73,0x28,0xdd,0x28,0x73,0xbe,0x09,0x54,0x9f,0xdb,0x26,0x71,0xbc,0xf8,0x34,0x70,0xbb,0xf7,0x33,0x6f,0xab,0xf6,0x32,0x7d,0xb9,0xf5,0x31,0x7c,0xb8,0xf4,0x30,0x6c,0xb7,0xf3,0x2f,0x6b,0xa7,0xf2,0x2e,0x6a,0xa6,0xe2]));
  const yhi = col(8, 5), ylo = col(8, 4);
  ok("D s8 falls to floor", eq(yhi.slice(0, 5), [0x47,0x48,0x49,0x4a,0x4a]) && eq(ylo.slice(0, 5), [0x38,0x28,0x18,0x08,0xf8]) && yhi.slice(5).every(v => v === 0x4b) && ylo.slice(5).every(v => v === 0xc0));
  ok("D s8 b8 exact", eq(col(8, 8), [0x5e,0x6f,0x7f,0x90,0x90,0xa1,0xa0,0xa0,0xa0,0x9f,0xa0,0xa0,0xa0,0xa1,0xa1,0xa1,0xa1,0xa2,0xa2,0xa2,0xa2,0xa3,0xa3,0xa3,0xa3,0xa4,0xa4,0xa4,0xa4,0xa5,0xa5,0xa5,0xa5,0xa6,0xa6,0xa6,0xa6,0xa7,0xa7,0xa7,0xa7,0xa8,0xa8,0xa8,0xa8,0xa9,0xa9,0xa9,0xa9]));
  ok("D s8 b10 enter-then-patrol", col(8, 10).slice(0, 5).every(v => v === 1) && col(8, 10).slice(5).every(v => v === 0));
  ok("D s8 HP const", col(8, 13).every(v => v === 4));
  const b10 = col(10, 0), b11 = col(11, 0);
  ok("D s10 converts f980", b10.slice(0, 24).every(v => v === 1) && b10.slice(24).every(v => v === 0x59), b10.map(Hx).join(","));
  ok("D s11 converts f955", b11.slice(0, 19).every(v => v === 1) && b11.slice(19, 44).every(v => v === 0x59) && b11.slice(44).every(v => v === 0x02), b11.map(Hx).join(","));
  ok("D converted HP 08", slot(S[20], 11)[13] === 8 && slot(S[25], 10)[13] === 8);
  ok("D Jason alive thru window", S[S.length - 1].ram[0x40D] > 0, "hp=" + S[S.length - 1].ram[0x40D]);
}
// ---- tank run: warp_raw(0), Right from 860, 25 snaps 860-1100 ----
const atT = [];
for (let f = 860; f <= 1100; f += 10) atT.push(f);
const padT = (n) => n === 61 ? 8 : ((n >= 860) ? 128 : 0);
const RT1 = await run(stock, 0, 0, 700, padT, atT);
const RT2 = await run(stock, 0, 0, 700, padT, atT);
ok("T traps null", RT1.trap === null && RT2.trap === null);
ok("T determinism x2", diffs(RT1.snaps, RT2.snaps) === 0);
{
  const S = RT1.snaps;
  const col = (i, j) => S.map(s => slot(s, i)[j]);
  ok("T s8 stays actor45", col(8, 0).every(v => v === 0x45));
  ok("T s8 xhi exact", eq(col(8, 3), [0x5a,0x5a,0x5a,0x5b,0x5b,0x5b,0x5b,0x5b,0x5b,0x5b,0x5b,0x5c,0x5c,0x5c,0x5d,0x5d,0x5d,0x5d,0x5e,0x5e,0x5e,0x5e,0x5f,0x5f,0x5f]));
  ok("T s8 yhi exact", eq(col(8, 5), [0x19,0x19,0x19,0x18,0x18,0x18,0x17,0x17,0x17,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16,0x16]));
  const ylo = col(8, 4);
  let rise = true;
  for (let i = 0; i < 10; i++) if (((ylo[i + 1] - ylo[i] + 256) & 255) !== 0xb0) rise = false;
  ok("T s8 ylo rise -0x50/10f", rise, ylo.slice(0, 11).map(Hx).join(","));
  ok("T s8 hover bob", eq(ylo.slice(11, 14), [0x7c,0x86,0x81]) && ylo.slice(11, 22).every((v, i) => v === ylo[11 + (i % 3)]));
  ok("T s8 b6 const 07", col(8, 6).every(v => v === 7));
  ok("T s8 b8 exact", eq(col(8, 8), [0x7f,0x7f,0x7f,0x6f,0x6f,0x6f,0x5e,0x5e,0x5e,0x4d,0x4d,0x4e,0x4e,0x4e,0x4f,0x4f,0x4f,0x4f,0x50,0x50,0x50,0x50,0x51,0x51,0x51]));
  ok("T s8 HP const 20", col(8, 13).every(v => v === 0x20));
  ok("T s23 b11 exact", eq(col(11, 11), [0xf9,0xf7,0xf4,0xf2,0xef,0xed,0xea,0xe8,0xe5,0xe3,0xe0,0xde,0xdb,0xd9,0xd6,0xd4,0xd1,0xcf,0xcc,0xca,0xc7,0xc5,0xc2,0xc0,0xbd]));
  ok("T s23 static pos", S.every(s => slot(s, 11)[3] === 0x5e && slot(s, 11)[2] === 0x80 && slot(s, 11)[5] === 0x1e && slot(s, 11)[4] === 0x80));
  ok("T s9/s10 stay dormant", S.every(s => slot(s, 9)[0] === 1 && slot(s, 10)[0] === 1));
}
// ---- egg run: cooked pack bank3[8701]=0x20, warp_raw(0)@1000, 21 snaps ----
const egg = buildPack(rom, "ref.nes").pack;
egg.prg[3][8701] = 0x20;
const atE = [];
for (let f = 1140; f <= 1340; f += 10) atE.push(f);
const padE = (n) => (n >= 61 && n <= 65) ? 8 : 0;
const RE1 = await run(egg, 0, 0, 1000, padE, atE);
const RE2 = await run(egg, 0, 0, 1000, padE, atE);
ok("E traps null", RE1.trap === null && RE2.trap === null);
ok("E determinism x2", diffs(RE1.snaps, RE2.snaps) === 0);
{
  const S = RE1.snaps;
  const col = (i, j) => S.map(s => slot(s, i)[j]);
  ok("E egg b11 exact", eq(col(8, 11), [0xba,0xb0,0xa6,0x9c,0x92,0x88,0x7e,0x74,0x6a,0x60,0x56,0x4c,0x42,0x38,0x2e,0x24,0x1a,0x10,0x06,0x00,0x00]));
  let rate = true;
  for (let i = 0; i < 18; i++) if (((col(8, 11)[i + 1] - col(8, 11)[i] + 256) & 255) !== 0xf6) rate = false;
  ok("E egg b11 -0x0a/10f", rate);
  ok("E morph window", col(8, 0)[18] === 0x5b && col(8, 0)[19] === 0x63 && col(8, 0).slice(19).every(v => v === 0x63));
  const m = slot(S[19], 8);
  ok("E A571 init bytes", m[6] === BOSS_INIT.b6 && m[7] === BOSS_INIT.b7 && m[10] === BOSS_INIT.b10 && m[11] === BOSS_INIT.b11 && m[13] === BOSS_INIT.b13, m.map(Hx).join(","));
  ok("E boss HP 80", col(8, 13).slice(19).every(v => v === 0x80));
}
console.log(fail === 0 ? "ALL 6.4g GREEN (" + pass + ")" : "FAILURES: " + fail + " (pass " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
