// Node Mesen A/V probe: boot the libretro core, run frames, measure
// wall-time, audio stats (peak/DC/clip) on title + music phases, and
// dump framebuffers as PNG (normal XRGB8888 decode) for visual check.
// Usage: node tools/mesen_probe.mjs [frames=300] [pngprefix]
// - frames>600: taps START at 600 (12f), music stats cover 612..frames.
// - pngprefix: writes <prefix>-title.png (f=38) and <prefix>-game.png (last).
import { readFileSync, writeFileSync } from "fs";
import { inflateSync, deflateSync, crc32 } from "zlib";
const NF = +(process.argv[2] || 300);
const PFX = process.argv[3] || "";
function pngRGB(w, h, rgba) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3); row[0] = 0;
    for (let x = 0; x < w; x++) { row[1+x*3] = rgba[(y*w+x)*4]; row[1+x*3+1] = rgba[(y*w+x)*4+1]; row[1+x*3+2] = rgba[(y*w+x)*4+2]; }
    rows.push(row);
  }
  const c = deflateSync(Buffer.concat(rows), { level: 6 });
  const chunk = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); t.copy(h, 4);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, d])) >>> 0, 0); return Buffer.concat([h, d, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk(Buffer.from("IHDR"), ihdr), chunk(Buffer.from("IDAT"), c), chunk(Buffer.from("IEND"), Buffer.alloc(0))]);
}
const rom = new Uint8Array(readFileSync("/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/work/roms-dev/blaster-master-usa.nes"));
const mapper = ((rom[6] >> 4) | (rom[7] & 240));
const mir = (rom[6] & 8) ? 8 : ((rom[6] & 1) ? 1 : 0);
const rb = new Uint8Array(16 + 8 * 16384 + 16 * 8192);
rb[0] = 78; rb[1] = 69; rb[2] = 83; rb[3] = 26; rb[4] = 8; rb[5] = 16;
rb[6] = ((mapper & 15) << 4) | mir; rb[7] = (mapper & 240);
rb.set(rom.slice(16, 16 + 131072), 16);
rb.set(rom.slice(16 + 131072, 16 + 262144), 16 + 131072);
const MDIR = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/work/mesen-wasm";
const createMesen = (await import(MDIR + "/mesen.js")).default;
const mod = await createMesen({ locateFile: (f) => MDIR + "/" + f });
const rp = mod._malloc(rb.length);
mod.HEAPU8.set(rb, rp);
const nm = new TextEncoder().encode("game.nes");
const np = mod._malloc(64);
mod.HEAPU8.set(nm, np);
mod.HEAPU8[np + nm.length] = 0;
if (!mod._mesen_boot(rp, rb.length, np)) throw new Error("boot");
function grabRGBA() {
  const p = mod._mesen_frame(), w = mod._mesen_fw(), h = mod._mesen_fh();
  if (w !== 256 || h !== 240) return null;
  const src = mod.HEAPU32.subarray(p >> 2, (p >> 2) + 256 * 240);
  const o = new Uint8Array(256 * 240 * 4);
  for (let i = 0, j = 0; i < 256 * 240; i++, j += 4) {
    const px = src[i];
    o[j] = (px >> 16) & 255; o[j + 1] = (px >> 8) & 255; o[j + 2] = px & 255; o[j + 3] = 255;
  }
  return o;
}
let st = { n: 0, peak: 0, sum: 0, clip: 0 };
function drain(to) {
  const ap = mod._mesen_audio(), al = mod._mesen_alen();
  const u16 = mod.HEAPU16.subarray(ap >> 1, (ap >> 1) + al);
  for (let k = 0; k < u16.length; k++) {
    const v = u16[k], x = v >= 32768 ? (v - 65536) / 32768 : v / 32767;
    const ax = Math.abs(x);
    if (ax > to.peak) to.peak = ax;
    to.sum += x; if (ax >= 0.999) to.clip++;
    to.n++;
  }
  mod._mesen_aclear();
  return al;
}
const t0 = Date.now();
let title = null, game = null, per = 0, fall = 0;
for (let f = 0; f < NF; f++) {
  let pad = 0;
  if (NF > 600 && f >= 600 && f < 612) pad = 8;
  mod._mesen_setpad(pad);
  mod._mesen_run();
  const al = drain(st);
  per += al;
  if (f === 38) title = grabRGBA();
  if (f === NF - 1) game = grabRGBA();
}
const ms = Date.now() - t0;
const rep = (t, tag) => "phase-" + tag + ": n=" + t.n + " peak=" + t.peak.toFixed(3) + " dc=" + (t.sum / Math.max(1, t.n)).toFixed(4) + " clipPct=" + (100 * t.clip / Math.max(1, t.n)).toFixed(2);
console.log("frames=" + NF + " wall=" + ms + "ms fps=" + (NF * 1000 / ms).toFixed(1) + " sampPerFrame=" + (per / NF).toFixed(1));
console.log(rep(st, "all"));
if (PFX !== "") {
  if (title) writeFileSync(PFX + "-title.png", pngRGB(256, 240, title));
  if (game) writeFileSync(PFX + "-game.png", pngRGB(256, 240, game));
  console.log("pngs written: " + PFX + "-title.png " + PFX + "-game.png");
}
