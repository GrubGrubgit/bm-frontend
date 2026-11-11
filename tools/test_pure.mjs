// L1 pure-module tests (node): vectors, synthetic ROM, bad inputs,
// and the canonical device-local ROM (path via argv, never in repo).
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { parseHeader } from "../src/rom/header.js";
import { crc32Hex, md5Hex } from "../src/rom/crc.js";
import { buildPack } from "../src/pack/builder.js";
import { validatePack } from "../src/pack/reader.js";
let fails = 0;
const check = (n, ok) => { console.log((ok ? "PASS" : "FAIL") + " " + n); if (!ok) fails++; };
const enc = s => new TextEncoder().encode(s);
check("crc123456789", crc32Hex(enc("123456789")) === "cbf43926");
check("md5abc", md5Hex(enc("abc")) === "900150983cd24fb0d6963f7d28e17f72");
// synthetic structurally-valid ROM: BM-like header, patterned PRG/CHR
const HDR = [0x4E,0x45,0x53,0x1A,8,16,0x10,0x08,0,0,0,7,0,0,0,0];
const syn = new Uint8Array(16 + 8*16384 + 16*8192);
syn.set(HDR, 0);
for (let i = 16; i < syn.length; i++) syn[i] = i & 0xFF;
const h = parseHeader(syn);
check("syn-header-ok", h.ok && h.mapper === 1 && h.known && h.format === "nes2");
const b = buildPack(syn, "synthetic");
check("syn-pack-ok", b.ok && b.gaps.length === 0 && b.pack.prg.length === 8 && b.pack.chr.length === 16);
check("syn-pack-valid", validatePack(b.pack).ok);
check("short-fails", buildPack(new Uint8Array(8), "x").ok === false);
const bad = syn.slice(); bad[0] = 0x00;
check("badmagic-fails", buildPack(bad, "x").ok === false);
const trunc = syn.slice(0, syn.length - 7);
check("trunc-fails", buildPack(trunc, "x").ok === false);
const trail = new Uint8Array(syn.length + 1); trail.set(syn);
check("trailing-fails", buildPack(trail, "x").ok === false);
// canonical ROM (device-local reference, path from argv)
const romPath = process.argv[2];
if (romPath) {
  const rom = new Uint8Array(readFileSync(romPath));
  const rh = parseHeader(rom);
  check("rom-header", rh.ok && rh.known && rh.format === "nes2" && rh.mapper === 1 && rom.length === 262160);
  const rb = buildPack(rom, "canonical-device-rom");
  check("rom-pack-zero-gaps", rb.ok && rb.gaps.length === 0 && validatePack(rb.pack).ok);
  console.log("ROMLOG len=" + rom.length + " crc32=" + rb.pack.meta.crc32 + " md5=" + rb.pack.meta.md5);
  const prg = rom.slice(16, 16 + 131072), chr = rom.slice(16 + 131072);
  console.log("ROMLOG prg-sha1=" + createHash("sha1").update(prg).digest("hex") + " chr-sha1=" + createHash("sha1").update(chr).digest("hex"));
}
process.exit(fails ? 1 : 0);
