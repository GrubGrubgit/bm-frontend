// Pack builder: ROM bytes -> versioned pack. Pure, no DOM. Own code.
// Every input byte is accounted: header->meta, PRG->prg[], CHR->chr[].
// Anything else (trainer, trailing bytes, short reads) fails loudly.
import { parseHeader } from "../rom/header.js";
import { crc32Hex, md5Hex } from "../rom/crc.js";
import { PACK_VERSION, EXPECT } from "./schema.js";

export function buildPack(fullBytes, sourceName) {
  const errors = [];
  if (!(fullBytes instanceof Uint8Array)) return { ok: false, errors: ["not-bytes"], pack: null };
  const h = parseHeader(fullBytes);
  for (const e of h.errors) errors.push(e);
  if (!h.ok) return { ok: false, errors, pack: null };
  if (h.trainer) errors.push("trainer-unsupported");
  const gaps = [];
  if (fullBytes.length > h.totalExpected) {
    gaps.push({ offset: h.totalExpected, length: fullBytes.length - h.totalExpected, reason: "trailing" });
  }
  if (h.prgUnits !== EXPECT.prgBanks || h.chrUnits !== EXPECT.chrBanks) {
    gaps.push({ offset: 0, length: 0, reason: "layout:prg" + h.prgUnits + "/chr" + h.chrUnits });
  }
  for (const g of gaps) errors.push("gap:" + g.reason + "@" + g.offset + "+" + g.length);
  if (errors.length > 0) return { ok: false, errors, pack: null, gaps };
  const prg = [];
  for (let i = 0; i < EXPECT.prgBanks; i++) {
    prg.push(fullBytes.slice(h.headerLen + i * EXPECT.prgBankSize, h.headerLen + (i + 1) * EXPECT.prgBankSize));
  }
  const chr = [];
  const chrBase = h.headerLen + h.prgSize;
  for (let i = 0; i < EXPECT.chrBanks; i++) {
    chr.push(fullBytes.slice(chrBase + i * EXPECT.chrBankSize, chrBase + (i + 1) * EXPECT.chrBankSize));
  }
  const pack = {
    meta: {
      packVersion: PACK_VERSION,
      sourceName: String(sourceName || "unknown"),
      format: h.format, mapper: h.mapper, mirror: h.mirror,
      prgUnits: h.prgUnits, chrUnits: h.chrUnits,
      crc32: crc32Hex(fullBytes), md5: md5Hex(fullBytes),
      warnings: h.warnings.slice(),
      builtAt: new Date().toISOString(),
      provenance: "user-supplied ROM, extracted in-page"
    },
    prg, chr
  };
  return { ok: true, errors: [], pack, gaps: [] };
}
