// src/pack/ips.js -- custom pack -> IPS patch file. Pure, no DOM.
//
// Maps overlay patches (raw PRG/CHR bank bytes) to iNES file offsets and
// emits a standard IPS file ("PATCH" header, records, "EOF" trailer) that
// can be applied to the stock ROM with any IPS patcher.
//
// File layout (trainer unsupported -- rejected by builder -- so header is
// always 16 bytes; 8x16K PRG + 16x8K CHR):
//   prg bank b offset o -> 16 + b*16384 + o
//   chr bank b offset o -> 16 + 8*16384 + b*8192 + o
//
// NOTE: S6 per-site song overrides (pack `sites` map) are a wasm-engine
// hook, not ROM bytes -- deliberately excluded from IPS output. The caller
// is expected to warn when the exported pack carries sites.
export const IPS_PRG_BANK_SIZE = 16384;
export const IPS_CHR_BANK_SIZE = 8192;
export const IPS_PRG_COUNT = 8;
export const IPS_CHR_COUNT = 16;
export const IPS_HEADER_LEN = 16;

export function ipsFileOffset(area, bank, offset) {
  if (area === "prg") return IPS_HEADER_LEN + bank * IPS_PRG_BANK_SIZE + offset;
  return IPS_HEADER_LEN + IPS_PRG_COUNT * IPS_PRG_BANK_SIZE + bank * IPS_CHR_BANK_SIZE + offset;
}

// cleanPatches: decoded entries as returned by validateCustomPack().clean --
// [{area:"prg"|"chr", bank, offset, bytes:Uint8Array}]. Records are sorted
// by file offset and split so no record exceeds 0xFFFF bytes (plain
// records only; size 0 is reserved for RLE and never emitted).
export function buildIps(cleanPatches) {
  if (!Array.isArray(cleanPatches)) return { ok: false, errors: ["not-array"], bytes: null };
  const recs = [];
  for (let i = 0; i < cleanPatches.length; i++) {
    const p = cleanPatches[i];
    if (!p || (p.area !== "prg" && p.area !== "chr")) return { ok: false, errors: ["patch:" + i + ":bad-area"], bytes: null };
    const nb = p.area === "prg" ? IPS_PRG_COUNT : IPS_CHR_COUNT;
    const sz = p.area === "prg" ? IPS_PRG_BANK_SIZE : IPS_CHR_BANK_SIZE;
    if (!Number.isInteger(p.bank) || p.bank < 0 || p.bank >= nb) return { ok: false, errors: ["patch:" + i + ":bad-bank"], bytes: null };
    if (!Number.isInteger(p.offset) || p.offset < 0 || p.offset >= sz) return { ok: false, errors: ["patch:" + i + ":bad-offset"], bytes: null };
    const raw = p.bytes instanceof Uint8Array ? p.bytes : Uint8Array.from(p.bytes || []);
    if (raw.length === 0) return { ok: false, errors: ["patch:" + i + ":empty"], bytes: null };
    if (p.offset + raw.length > sz) return { ok: false, errors: ["patch:" + i + ":overflow"], bytes: null };
    recs.push({ at: ipsFileOffset(p.area, p.bank, p.offset), bytes: raw });
  }
  if (recs.length === 0) return { ok: false, errors: ["empty"], bytes: null };
  recs.sort((a, b) => a.at - b.at);
  let total = 5 + 3;
  for (const r of recs) {
    let left = r.bytes.length;
    while (left > 0) { const n = Math.min(left, 0xFFFF); total += 3 + 2 + n; left -= n; }
  }
  const out = new Uint8Array(total);
  out[0] = 0x50; out[1] = 0x41; out[2] = 0x54; out[3] = 0x43; out[4] = 0x48; // PATCH
  let o = 5;
  for (const r of recs) {
    let at = r.at, i = 0;
    while (i < r.bytes.length) {
      const n = Math.min(r.bytes.length - i, 0xFFFF);
      out[o++] = (at >>> 16) & 0xFF; out[o++] = (at >>> 8) & 0xFF; out[o++] = at & 0xFF;
      out[o++] = (n >>> 8) & 0xFF; out[o++] = n & 0xFF;
      out.set(r.bytes.subarray(i, i + n), o); o += n;
      at += n; i += n;
    }
  }
  out[o++] = 0x45; out[o++] = 0x4F; out[o++] = 0x46; // EOF
  return { ok: true, errors: [], bytes: out };
}
