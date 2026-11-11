// Pack reader: validate + accessors. Pure, no DOM. Own code.
import { PACK_VERSION, EXPECT } from "./schema.js";

export function validatePack(p) {
  const errors = [];
  if (!p || typeof p !== "object") { errors.push("not-object"); return { ok: false, errors }; }
  if (!p.meta || p.meta.packVersion !== PACK_VERSION) errors.push("bad-version");
  if (!Array.isArray(p.prg) || p.prg.length !== EXPECT.prgBanks) errors.push("bad-prg-count");
  if (!Array.isArray(p.chr) || p.chr.length !== EXPECT.chrBanks) errors.push("bad-chr-count");
  if (errors.length === 0) {
    for (let i = 0; i < p.prg.length; i++) {
      if (!(p.prg[i] instanceof Uint8Array) || p.prg[i].length !== EXPECT.prgBankSize) { errors.push("bad-prg-bank:" + i); break; }
    }
    for (let i = 0; i < p.chr.length; i++) {
      if (!(p.chr[i] instanceof Uint8Array) || p.chr[i].length !== EXPECT.chrBankSize) { errors.push("bad-chr-bank:" + i); break; }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function prgBank(p, i) { return p.prg[i]; }
export function chrBank(p, i) { return p.chr[i]; }
