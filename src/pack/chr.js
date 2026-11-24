// src/pack/chr.js -- NES 2bpp CHR codec + tile/bank helpers. Pure, no DOM.
// A tile is 16 bytes: 8 lo-plane bytes then 8 hi-plane bytes, MSB-left
// (pixel x=0 is bit 7). Decoded pixels are Uint8Array(64) values 0-3.
// A 4KB bank holds 256 tiles (4096 bytes); the stock pack carries chr as
// 16 x 8KB banks, so 4KB bank B lives at chr[B>>1] + (B&1)*4096
// (see tiles.js chrBankBytes / BG_CHR_BANK for the per-level mapping).
export const TILE_BYTES = 16, TILES_PER_BANK4K = 256, BANK4K_BYTES = 4096;
export function decodeTile(u8, off) {
  if (!(u8 instanceof Uint8Array)) throw new RangeError('decodeTile: not-bytes');
  off = off | 0;
  if (off < 0 || off + TILE_BYTES > u8.length) throw new RangeError('decodeTile: bad-off');
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const lo = u8[off + y], hi = u8[off + 8 + y];
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      px[y * 8 + x] = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
    }
  }
  return px;
}
export function encodeTile(px) {
  if (!(px instanceof Uint8Array) || px.length !== 64) throw new RangeError('encodeTile: need-64px');
  const out = new Uint8Array(TILE_BYTES);
  for (let y = 0; y < 8; y++) {
    let lo = 0, hi = 0;
    for (let x = 0; x < 8; x++) {
      const v = px[y * 8 + x];
      if (v < 0 || v > 3) throw new RangeError('encodeTile: bad-pixel:' + v);
      const bit = 7 - x;
      if (v & 1) lo |= (1 << bit);
      if (v & 2) hi |= (1 << bit);
    }
    out[y] = lo; out[8 + y] = hi;
  }
  return out;
}
// Whole-4KB-bank helpers (bank4k = Uint8Array(4096)).
export function decodeBank4k(bank4k) {
  if (!(bank4k instanceof Uint8Array) || bank4k.length !== BANK4K_BYTES) throw new RangeError('decodeBank4k: need-4KB');
  const all = new Uint8Array(TILES_PER_BANK4K * 64);
  for (let t = 0; t < TILES_PER_BANK4K; t++) all.set(decodeTile(bank4k, t * TILE_BYTES), t * 64);
  return all;
}
export function encodeBank4k(all) {
  if (!(all instanceof Uint8Array) || all.length !== TILES_PER_BANK4K * 64) throw new RangeError('encodeBank4k: need-256x64');
  const out = new Uint8Array(BANK4K_BYTES);
  for (let t = 0; t < TILES_PER_BANK4K; t++) out.set(encodeTile(all.subarray(t * 64, t * 64 + 64)), t * TILE_BYTES);
  return out;
}
// Session-edit assembly (pure; the exact logic the editor save path uses,
// covered headless in verify-pack-p2). chrEdits = {bank4k: {tile: px64}}.
// base = active-pack chr banks (so prior custom chr edits survive), stock =
// stock-pack chr banks (diff target). Returns descriptors
// [{bank: b8, offset, bytes}] with changed runs only (same <16B coalescing
// rule as overlay diffRuns). The caller wraps each in a patch.
export function runsFor(a, b) {
  const runs = [];
  let i = 0;
  while (i < a.length) {
    if (a[i] === b[i]) { i++; continue; }
    let j = i;
    while (j < a.length && a[j] !== b[j]) j++;
    let k = j;
    while (k < a.length) {
      let eq = 0;
      while (k + eq < a.length && a[k + eq] === b[k + eq] && eq < 16) eq++;
      if (eq >= 16 || k + eq >= a.length) break;
      k += eq;
      while (k < a.length && a[k] !== b[k]) k++;
    }
    runs.push({ off: i, bytes: b.slice(i, k) });
    i = k;
  }
  return runs;
}
export function chrPatchDescs(stockChr, baseChr, chrEdits) {
  const descs = [];
  for (const b4s of Object.keys(chrEdits || {})) {
    const b4 = b4s | 0;
    const tiles = chrEdits[b4];
    if (!tiles || !Object.keys(tiles).length) continue;
    if (b4 < 0 || b4 >= 32) throw new RangeError('chrPatchDescs: bad-bank:' + b4);
    const b8 = b4 >> 1;
    const base = baseChr[b8].slice();
    const half = (b4 & 1) * BANK4K_BYTES;
    for (const ts of Object.keys(tiles)) {
      const t = ts | 0;
      if (t < 0 || t >= TILES_PER_BANK4K) throw new RangeError('chrPatchDescs: bad-tile:' + t);
      base.set(encodeTile(tiles[t]), half + t * TILE_BYTES);
    }
    for (const run of runsFor(stockChr[b8], base)) {
      descs.push({ bank: b8, offset: run.off, bytes: run.bytes });
    }
  }
  return descs;
}
// Get/set one tile within a 4KB bank image. getTile decodes; setTile
// returns a NEW bank image with the tile replaced (stock never mutated).
export function getTile(bank4k, tile) {
  tile = tile | 0;
  if (!(bank4k instanceof Uint8Array) || bank4k.length !== BANK4K_BYTES) throw new RangeError('getTile: need-4KB');
  if (tile < 0 || tile >= TILES_PER_BANK4K) throw new RangeError('getTile: bad-tile');
  return decodeTile(bank4k, tile * TILE_BYTES);
}
export function setTile(bank4k, tile, px) {
  tile = tile | 0;
  if (!(bank4k instanceof Uint8Array) || bank4k.length !== BANK4K_BYTES) throw new RangeError('setTile: need-4KB');
  if (tile < 0 || tile >= TILES_PER_BANK4K) throw new RangeError('setTile: bad-tile');
  const enc = encodeTile(px);
  const out = bank4k.slice();
  out.set(enc, tile * TILE_BYTES);
  return out;
}
