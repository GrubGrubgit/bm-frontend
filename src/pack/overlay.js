// src/pack/overlay.js -- custom packs: stock base + patch list. Pure, no DOM.
// A custom pack never stores full banks:
//   {customVersion:1, id, name, baseCrc, patches:[{area,bank,offset,bytes}],
//    editorVersion, builtAt}
// Applied over the validated stock pack at spawn (app.js l2ensurePack) for
// BOTH engines, so the wasm stage path and the mesen rebuild path consume
// identical bytes. Bounds-checked; baseCrc must match the stock pack or the
// overlay is refused (never silently boot wrong content).
import { validatePack } from "./reader.js";
import { crc32Hex } from "../rom/crc.js";
export const CUSTOM_PACK_VERSION = 1;
export const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BANK_BYTES = { prg: 16384, chr: 8192 };
const BANK_COUNT = { prg: 8, chr: 16 };
const MAX_PATCHES = 4096;
function b64enc(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 8192, u8.length)));
  return btoa(s);
}
function b64dec(b64) {
  const s = atob(String(b64));
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255;
  return o;
}
export function newCustomId() {
  return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
export function makePatch(area, bank, offset, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return { area: area, bank: bank | 0, offset: offset | 0, bytes: b64enc(b) };
}
function checkPatch(p, i, errors) {
  if (!p || typeof p !== "object") { errors.push("patch:" + i + ":not-object"); return null; }
  if (p.area !== "prg" && p.area !== "chr") { errors.push("patch:" + i + ":bad-area"); return null; }
  const nb = BANK_COUNT[p.area], sz = BANK_BYTES[p.area];
  if (!Number.isInteger(p.bank) || p.bank < 0 || p.bank >= nb) { errors.push("patch:" + i + ":bad-bank"); return null; }
  if (!Number.isInteger(p.offset) || p.offset < 0 || p.offset >= sz) { errors.push("patch:" + i + ":bad-offset"); return null; }
  let raw = null;
  try { raw = b64dec(p.bytes); } catch (e) { errors.push("patch:" + i + ":bad-bytes"); return null; }
  if (raw.length === 0) { errors.push("patch:" + i + ":empty"); return null; }
  if (p.offset + raw.length > sz) { errors.push("patch:" + i + ":overflow"); return null; }
  return { area: p.area, bank: p.bank, offset: p.offset, bytes: raw };
}
export function validateCustomPack(p) {
  const errors = [];
  if (!p || typeof p !== "object") return { ok: false, errors: ["not-object"] };
  if (p.customVersion !== CUSTOM_PACK_VERSION) errors.push("bad-version");
  if (typeof p.id !== "string" || !CUSTOM_ID_RE.test(p.id)) errors.push("bad-id");
  if (typeof p.name !== "string" || p.name.length === 0 || p.name.length > 80) errors.push("bad-name");
  if (typeof p.baseCrc !== "string" || !/^[0-9a-f]{8}$/i.test(p.baseCrc)) errors.push("bad-baseCrc");
  if (!Array.isArray(p.patches)) errors.push("bad-patches");
  else if (p.patches.length > MAX_PATCHES) errors.push("too-many-patches");
  const clean = [];
  if (errors.length === 0) {
    for (let i = 0; i < p.patches.length; i++) {
      const c = checkPatch(p.patches[i], i, errors);
      if (c) clean.push(c);
      if (errors.length > 8) { errors.push("..."); break; }
    }
  }
  if (errors.length) return { ok: false, errors: errors };
  return { ok: true, errors: [], clean: clean };
}
export function resolvedBytesCrc(prg, chr) {
  const all = new Uint8Array(8 * 16384 + 16 * 8192);
  for (let i = 0; i < 8; i++) all.set(prg[i], i * 16384);
  all.set(chr[0], 8 * 16384);
  let o = 8 * 16384;
  for (let j = 0; j < 16; j++) { all.set(chr[j], o); o += 8192; }
  return crc32Hex(all);
}
export function applyOverlay(stockPack, customPack) {
  const sv = validatePack(stockPack);
  if (!sv.ok) return { ok: false, errors: ["stock:" + sv.errors.join(" ")], pack: null };
  const cv = validateCustomPack(customPack);
  if (!cv.ok) return { ok: false, errors: cv.errors, pack: null };
  if (String(customPack.baseCrc).toLowerCase() !== String(stockPack.meta.crc32).toLowerCase())
    return { ok: false, errors: ["base-mismatch pack=" + customPack.baseCrc + " stock=" + stockPack.meta.crc32], pack: null };
  const prg = stockPack.prg.map(function (b) { return b.slice(); });
  const chr = stockPack.chr.map(function (b) { return b.slice(); });
  for (const c of cv.clean) {
    const bank = c.area === "prg" ? prg[c.bank] : chr[c.bank];
    bank.set(c.bytes, c.offset);
  }
  const crc = resolvedBytesCrc(prg, chr);
  return {
    ok: true, errors: [],
    pack: {
      meta: Object.assign({}, stockPack.meta),
      prg: prg, chr: chr,
      custom: { id: customPack.id, name: customPack.name, crc: crc }
    }
  };
}
export function packIdOf(pack) {
  return (pack && pack.custom && pack.custom.id) || "stock";
}
export function packCrcOf(pack) {
  if (pack && pack.custom && pack.custom.crc) return pack.custom.crc;
  if (pack && pack.meta && pack.meta.crc32) return String(pack.meta.crc32);
  return "unknown";
}
