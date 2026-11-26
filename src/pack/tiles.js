// src/pack/tiles.js -- NES tile decode + level-map canvas paint. Pure render
// helpers (takes a canvas; no app state). Own code.
// Geometry (measured headless on device: 2-block stripe period 128px,
// 8px pattern grid): pattern 8x8, combo 16x16 (2x2 patterns), struct
// 32x32 (2x2 combos), block 64x64 (2x2 structs), all row-major
// [TL,TR,BL,BR] (row-major PROVEN exact 2026-11-23: full 32x30 L1 spawn
// vicinity reproduced the live PPU nametable + attr bytes 960/960).
// Master palette mirrors the engine NESPAL (bm_api.c) so the
// editor preview matches wasm-engine colors exactly.
// Map is 32 blocks wide; rows = 32 tank, 25 level 9, 29 level 13.
export const NES_PALETTE = ["#757575","#271b8f","#0000ab","#47009f","#8f0077","#ab0013","#a70000","#7f0b00","#432b00","#004700","#005100","#003a6b","#000000","#000000","#000000","#000000","#bcbcbc","#0078f8","#0058f8","#6844fc","#d800cc","#e40058","#f83800","#e45c10","#ac7c00","#00b800","#00a800","#00a844","#008888","#000000","#000000","#000000","#f8f8f8","#3cbcfc","#6888fc","#9878f8","#f878f8","#f85898","#f87858","#fca044","#f8b800","#b8f818","#58d854","#58f898","#00e8d8","#787878","#000000","#000000","#fcfcfc","#a4e4fc","#b8b8f8","#d8b8f8","#f8b8f8","#f8a8c0","#f0d0b0","#fce0a8","#f8d878","#d8f878","#b8f8b8","#b8f8d8","#00fcfc","#f8d8f8","#000000","#000000"];
// BG 4KB CHR bank per game level (Data Crystal CHR-ROM table).
export const BG_CHR_BANK = { 1: 8, 2: 9, 3: 10, 4: 11, 5: 12, 6: 13, 7: 14, 8: 15, 9: 17, 16: 17, 11: 18, 13: 18, 10: 19, 14: 19, 12: 20, 15: 20 };
export const MAP_COLS = 32;
export function mapRows(mapLen) { return mapLen / MAP_COLS; }
// pack chr = 16 x 8KB; 4KB bank B lives at chr[B>>1] + (B&1)*4096.
export function chrBankBytes(chrBanks, bank4k) {
  const b = chrBanks[bank4k >> 1];
  if (!b) return null;
  return b.subarray((bank4k & 1) * 4096, (bank4k & 1) * 4096 + 4096);
}
export function decodeTile(bank4kBytes, tile) {
  const o = (tile & 255) * 16;
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const lo = bank4kBytes[o + y], hi = bank4kBytes[o + 8 + y];
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      px[y * 8 + x] = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
    }
  }
  return px;
}
function hexRgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
const PAL_RGB = NES_PALETTE.map(hexRgb);
// Resolve one 64x64 block to 8x8 tile grid: [{tile, sub}] row-major.
// (2026-11-27: fixed intra-block assembly order -- the old nested
// push() emitted (sy,sx,cy,cx,ty,tx) nesting order, NOT geometric
// row-major; every consumer indexed out[ty*8+tx] geometrically, so
// detail tiles were permuted within each block. Proven vs live PPU
// vram: L1 spawn window now matches 832/832 tile indices.)
export function blockTiles(L, blockIdx) {
  const out = new Array(64);
  for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
    const structIdx = L.blocks[blockIdx * 4 + sy * 2 + sx];
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
      const comboIdx = L.structs[structIdx * 4 + cy * 2 + cx];
      const sub = L.attrs[comboIdx] & 3;
      for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
        out[(sy * 4 + cy * 2 + ty) * 8 + (sx * 4 + cx * 2 + tx)] = { tile: L.combos[comboIdx * 4 + ty * 2 + tx], sub };
      }
    }
  }
  return out; // 64 entries, row-major 8x8
}
export function renderBlockImage(L, bgBankBytes, pal, blockIdx) {
  const cv = document.createElement("canvas");
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(64, 64);
  const tiles = blockTiles(L, blockIdx);
  const cache = {};
  for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
    const { tile, sub } = tiles[ty * 8 + tx];
    const key = tile * 4 + sub;
    let px = cache[key];
    if (!px) { px = decodeTile(bgBankBytes, tile); cache[key] = px; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = px[y * 8 + x];
      const ci = pal[sub * 4 + v] & 63;
      const rgb = PAL_RGB[ci];
      const o = (((ty * 8 + y) * 64) + (tx * 8 + x)) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
// Paint the whole map. opts: {pxPerBlock, scrollV, scrollH, showScroll}.
// Returns {w, h} in device px.
export function paintMap(canvas, L, bgBankBytes, pal, opts) {
  const o = opts || {};
  const bpx = o.pxPerBlock || 16;
  const cols = MAP_COLS, rows = L.map.length / MAP_COLS;
  canvas.width = cols * bpx; canvas.height = rows * bpx;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const seen = new Map();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const bi = L.map[y * cols + x];
    let cv = seen.get(bi);
    if (!cv) { cv = renderBlockImage(L, bgBankBytes, pal, bi); seen.set(bi, cv); }
    ctx.drawImage(cv, x * bpx, y * bpx, bpx, bpx);
  }
  if (o.doorBlocks && o.doorBlocks.size) {
    // Door-combo highlight: blocks containing a combo whose attr has
    // door bits 2-3 set (shared tank+overhead per 6.2: all 15 overhead
    // door-table entries sit on door-bit combos; e.g. combo146 block
    // (15,21) = L1 table entry (area8, xhi62, yhi85)).
    ctx.fillStyle = "rgba(255,200,0,0.20)";
    ctx.strokeStyle = "#fc0"; ctx.lineWidth = 2;
    for (const bi of o.doorBlocks) {
      const bx = bi % cols, by = (bi / cols) | 0;
      if (bx < 0 || by < 0 || bx >= cols || by >= rows) continue;
      ctx.fillRect(bx * bpx, by * bpx, bpx, bpx);
      ctx.strokeRect(bx * bpx + 1, by * bpx + 1, bpx - 2, bpx - 2);
    }
  }
  if (o.showScroll && o.scrollV && o.scrollH) {
    // screens are 4x4 blocks; planes are 8x8 bit grids PROVEN headless:
    // H byte i = map screen ROW i, bit j = column j; H bit6 is a ROW flag
    // (+32px camera-origin shift for the whole row, causal +/-32 in
    // follow; NOT per-cell: origin constant across columns). V bytes are
    // row-indexed the same way (CD1D/LCC6D symmetry); V bit6 shows NO
    // Y-shift headless (L9 follow 1:1 smooth with mixed V bit6), so V
    // cells render without a shift marker. Column-hypothesis refuted
    // headless: scy follows py walking straight down L9 screen col 5
    // where V[5]=00 throughout (bits must be row-indexed to have effect).
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const v = (o.scrollV[r] >> c) & 1, h = (o.scrollH[r] >> c) & 1;
      if (!v && !h) continue;
      ctx.fillStyle = v && h ? "rgba(255,255,0,0.25)" : v ? "rgba(0,255,255,0.25)" : "rgba(255,0,255,0.25)";
      ctx.fillRect(c * 4 * bpx, r * 4 * bpx, 4 * bpx, 4 * bpx);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
      ctx.strokeRect(c * 4 * bpx + 0.5, r * 4 * bpx + 0.5, 4 * bpx - 1, 4 * bpx - 1);
    }
    // H row-flag marker: bit6 set => +32px X-origin for that row.
    ctx.fillStyle = "#ff0";
    ctx.font = "bold 10px monospace";
    for (let r = 0; r < 8; r++) {
      if (((o.scrollH[r] >> 6) & 1) && r * 4 * bpx < canvas.height) {
        ctx.fillText("+32", 2, r * 4 * bpx + 11);
      }
    }
  }
  return { w: canvas.width, h: canvas.height };
}
// 8x8 bit-grid editor. onToggle(plane, row, col). Returns element.
export function bitGrid(el, bytes, plane, onToggle) {
  el.innerHTML = "";
  const t = document.createElement("table");
  t.style.borderCollapse = "collapse";
  for (let r = 0; r < 8; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < 8; c++) {
      const td = document.createElement("td");
      const on = (bytes[r] >> c) & 1;
      td.textContent = on ? "1" : "0";
      td.style.cssText = "border:1px solid #666;min-width:44px;min-height:44px;text-align:center;cursor:pointer;background:" + (on ? "#246" : "#111");
      td.addEventListener("click", () => onToggle(plane, r, c));
      tr.appendChild(td);
    }
    t.appendChild(tr);
  }
  el.appendChild(t);
}
