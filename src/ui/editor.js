// src/ui/editor.js -- P1 tile-map editor view (lazy-loaded by app.js).
// Reads the LOADED (resolved) pack, edits banks 0-2 in memory, writes a NEW
// custom pack (never mutates stock). Overhead combo attrs editable per
// research 6.2 (bit meanings PROVEN headless, see levels.js).
import { parseBank, serializeBank, LEVEL_MODE, bankFreeBytes } from "../pack/levels.js";
import { BG_CHR_BANK, chrBankBytes, paintMap, bitGrid, NES_PALETTE, MAP_COLS } from "../pack/tiles.js";
import { decodeTile, encodeTile, chrPatchDescs, TILES_PER_BANK4K } from "../pack/chr.js";
import { makePatch, newCustomId, diffRuns } from "../pack/overlay.js";
import { parseSpawns, serializeSpawns, rebuildSpawns, spawnBudget, spriteFor, SPAWN_BANK, serializeStats, getStatEntry, STAT_BANK, statIdxFor, INVALID_TYPES, TYPE_ACTOR, BOSS_TYPE, BOSS_REC } from "../pack/enemies.js";
export { diffRuns };
import { loadCustomPack, saveCustomPack } from "../pack/store.js";
let api = null;
const S = {
  open: false, stock: null, parsed: {}, edited: {}, level: 1,
  brush: 0, mode: "paint", selCell: -1, selStruct: -1, selCombo: -1, showScroll: false,
  chr: {}, enemies: null, edEnemies: {}, edStats: {},
  chrBank: -1, chrTile: 0, chrInk: 3, chrSub: 0, palSlot: 0,
};
// 4KB CHR bank -> levels using it as bg bank (labels for the bank picker).
const BANK_USERS = {};
for (const [lvl, b] of Object.entries(BG_CHR_BANK)) {
  (BANK_USERS[b] = BANK_USERS[b] || []).push(lvl);
}
for (const k of Object.keys(BANK_USERS)) BANK_USERS[k].sort((a, b) => a - b);
function el(id) { return document.getElementById(id); }
function log(m) { try { api.log(m); } catch (e) {} }
function cur() { return S.parsed[S.level] ? S.parsed[S.level].L : null; }
function bankOfLevel(level) { for (const b of [0, 1, 2]) { const p = S.parsed["b" + b]; if (p && p.levels.some(L => L.level === level)) return b; } return -1; }
function editsFor(level) { if (!S.edited[level]) S.edited[level] = {}; return S.edited[level]; }
function effLevel(L) {
  const e = S.edited[L.level] || {};
  return {
    level: L.level, mode: L.mode, bank: L.bank,
    pal: e.pal || L.pal, scroll: e.scroll || L.scroll, attrs: e.attrs || L.attrs,
    combos: e.combos || L.combos, structs: e.structs || L.structs,
    blocks: e.blocks || L.blocks, map: e.map || L.map,
  };
}
function chrBankView(b4) {
  // active-pack 4KB bank image with this session's chr edits applied
  let bytes = chrBankBytes(S.resolved.chr, b4);
  const ov = S.chr[b4];
  if (ov) {
    bytes = bytes.slice();
    for (const t of Object.keys(ov)) bytes.set(encodeTile(ov[t]), (t | 0) * 16);
  }
  return bytes;
}
function bgBank() {
  return chrBankView(BG_CHR_BANK[S.level]);
}
function chrTilePx(b4, tile) {
  const ov = S.chr[b4];
  if (ov && ov[tile]) return ov[tile];
  return decodeTile(chrBankBytes(S.resolved.chr, b4), tile * 16);
}
function setChrPx(b4, tile, px) {
  if (!S.chr[b4]) S.chr[b4] = {};
  S.chr[b4][tile] = px;
}
function repaint() {
  const L = cur();
  if (!L) return;
  const E = effLevel(L);
  const br0 = el("edBrush");
  if (br0) br0.max = E.blocks.length / 4 - 1;
  const cv = el("edMap");
  const doorCells = new Set();
  try {
    const isDoorAttr = (a) => ((a & 0x0C) !== 0 || a === 0x8B);
    const doorCombo = new Set();
    for (let ci = 0; ci < E.attrs.length; ci++) if (isDoorAttr(E.attrs[ci])) doorCombo.add(ci);
    const doorStruct = new Set();
    for (let si = 0; si < E.structs.length / 4; si++) {
      for (let k = 0; k < 4; k++) if (doorCombo.has(E.structs[si * 4 + k])) { doorStruct.add(si); break; }
    }
    const doorBlock = new Set();
    for (let bi = 0; bi < E.blocks.length / 4; bi++) {
      for (let k = 0; k < 4; k++) if (doorStruct.has(E.blocks[bi * 4 + k])) { doorBlock.add(bi); break; }
    }
    for (let mi = 0; mi < E.map.length; mi++) if (doorBlock.has(E.map[mi])) doorCells.add(mi);
  } catch (e) {}

  const scroll = E.scroll;
  paintMap(cv, E, bgBank(), E.pal, {
    pxPerBlock: 16, showScroll: S.showScroll,
    scrollV: scroll.subarray(0, 8), scrollH: scroll.subarray(8, 16),
    doorBlocks: doorCells,
  });
  renderInspector(E);
  renderScrollGrids(E);
  renderEnemies();
  renderStatTbl();
  renderPalStrip(E);
  fillChrBankSel();
  renderChrTab(E);
}
function renderPalStrip(E) {
  const cv = el("edPal");
  if (cv) {
    cv.width = 16 * 24; cv.height = 24;
    const ctx = cv.getContext("2d");
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = NES_PALETTE[E.pal[i] & 63]; ctx.fillRect(i * 24, 0, 24, 24);
      if (i === S.palSlot) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.strokeRect(1, 1, 22, 22); }
    }
  }
  // slot buttons
  const slots = el("edPalSlots");
  if (slots) {
    slots.innerHTML = "";
    for (let i = 0; i < 16; i++) {
      const b = document.createElement("button");
      b.textContent = i;
      b.title = "slot " + i + " = $" + E.pal[i].toString(16).padStart(2, "0");
      b.style.cssText = "width:30px;height:24px;margin:1px;background:" + NES_PALETTE[E.pal[i] & 63] + ";color:#fff;border:" + (i === S.palSlot ? "2px solid #fff" : "1px solid #666");
      b.addEventListener("click", () => { S.palSlot = i; repaint(); });
      slots.appendChild(b);
    }
  }
  const info = el("edPalInfo");
  if (info) info.textContent = " slot " + S.palSlot + " = $" + E.pal[S.palSlot].toString(16).padStart(2, "0") + " (sub" + (S.palSlot >> 2) + " color" + (S.palSlot & 3) + ")";
  // 64-color picker
  const pick = el("edPalPick");
  if (pick) {
    pick.innerHTML = "";
    for (let c = 0; c < 64; c++) {
      const b = document.createElement("button");
      b.title = "$" + c.toString(16).padStart(2, "0");
      b.style.cssText = "width:28px;height:20px;margin:1px;background:" + NES_PALETTE[c] + ";border:" + (E.pal[S.palSlot] === c ? "2px solid #fff" : "1px solid #333");
      b.addEventListener("click", () => {
        const arr = ((S.edited[E.level] && S.edited[E.level].pal) || E.pal).slice();
        arr[S.palSlot] = c;
        editsFor(E.level).pal = arr;
        log("editor: L" + E.level + " pal[" + S.palSlot + "] -> $" + c.toString(16).padStart(2, "0"));
        repaint();
      });
      pick.appendChild(b);
    }
  }
}
const ATTR_BITS_TANK = ["pal0", "pal1", "door/ent0", "door/ent1", "damage", "ladder", "water(brk)", "solid"];
const ATTR_BITS_OVERHEAD = ["pal0", "pal1", "door/ent0", "door/ent1", "bit4(no-eff)", "bit5(unused)", "bit6(solid-only)", "solid"]; // 6.2
function renderInspector(E) {
  const box = el("edInspector");
  if (!box) return;
  box.innerHTML = "";
  const add = (tag, text) => { const d = document.createElement(tag); d.textContent = text; box.appendChild(d); return d; };
  if (S.selCell >= 0) {
    const bi = E.map[S.selCell];
    const cx = S.selCell % MAP_COLS, cy = Math.floor(S.selCell / MAP_COLS);
    add("div", "cell (" + cx + "," + cy + ") block " + bi);
    const setRow = document.createElement("div");
    setRow.textContent = "set block: ";
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = 0; inp.max = E.blocks.length / 4 - 1; inp.value = bi;
    inp.style.width = "90px";
    const btn = document.createElement("button");
    btn.textContent = "paint";
    btn.addEventListener("click", () => {
      const v = Math.max(0, Math.min(E.blocks.length / 4 - 1, inp.value | 0));
      const m = (S.edited[E.level] && S.edited[E.level].map) ? S.edited[E.level].map.slice() : E.map.slice();
      m[S.selCell] = v;
      editsFor(E.level).map = m;
      S.brush = v;
      const br = el("edBrush"); if (br) br.value = v;
      log("editor: cell (" + cx + "," + cy + ") -> block " + v);
      repaint();
    });
    setRow.appendChild(inp); setRow.appendChild(btn); box.appendChild(setRow);
    const st = [];
    for (let i = 0; i < 4; i++) st.push(E.blocks[bi * 4 + i]);
    add("div", "block " + bi + " structs [" + st.join(",") + "]");
  }
  // struct browser
  const sRow = document.createElement("div");
  sRow.textContent = "struct ";
  const sSel = document.createElement("select");
  const nS = E.structs.length / 4;
  for (let i = 0; i < nS; i++) { const o = document.createElement("option"); o.value = i; o.textContent = i; sSel.appendChild(o); }
  sSel.value = S.selStruct >= 0 ? S.selStruct : 0;
  sSel.addEventListener("change", () => { S.selStruct = sSel.value | 0; S.selCombo = -1; repaint(); });
  sRow.appendChild(sSel);
  const si = S.selStruct >= 0 ? S.selStruct : 0;
  const sc = [];
  for (let i = 0; i < 4; i++) sc.push(E.structs[si * 4 + i]);
  const sInfo = document.createElement("span");
  sInfo.textContent = " combos [" + sc.join(",") + "]";
  sRow.appendChild(sInfo); box.appendChild(sRow);
  // combo browser + patterns + attr editor
  const cRow = document.createElement("div");
  cRow.textContent = "combo ";
  const cSel = document.createElement("select");
  const nC = E.combos.length / 4;
  for (let i = 0; i < nC; i++) { const o = document.createElement("option"); o.value = i; o.textContent = i; cSel.appendChild(o); }
  cSel.value = S.selCombo >= 0 ? S.selCombo : 0;
  cSel.addEventListener("change", () => { S.selCombo = cSel.value | 0; repaint(); });
  cRow.appendChild(cSel);
  const ci = S.selCombo >= 0 ? S.selCombo : 0;
  const cp = [];
  for (let i = 0; i < 4; i++) cp.push(E.combos[ci * 4 + i]);
  const cInfo = document.createElement("span");
  cInfo.textContent = " patterns [" + cp.join(",") + "] attr $" + E.attrs[ci].toString(16);
  cRow.appendChild(cInfo); box.appendChild(cRow);
  // pattern index editors
  const pRow = document.createElement("div");
  pRow.textContent = "patterns: ";
  for (let i = 0; i < 4; i++) {
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = 0; inp.max = 255; inp.value = cp[i];
    inp.style.width = "70px";
    inp.dataset.pi = i;
    inp.addEventListener("change", () => {
      const v = Math.max(0, Math.min(255, inp.value | 0));
      const arr = ((S.edited[E.level] && S.edited[E.level].combos) || E.combos).slice();
      arr[ci * 4 + (inp.dataset.pi | 0)] = v;
      editsFor(E.level).combos = arr;
      log("editor: L" + E.level + " combo " + ci + "[" + inp.dataset.pi + "] -> tile " + v);
      repaint();
    });
    pRow.appendChild(inp);
  }
  box.appendChild(pRow);
  // attr bit editor (per-mode meanings; overhead per research 6.2)
  const aRow = document.createElement("div");
  {
    const labels = E.mode === "overhead" ? ATTR_BITS_OVERHEAD : ATTR_BITS_TANK;
    aRow.textContent = "attr bits (" + E.mode + "): ";
    for (let b = 0; b < 8; b++) {
      const lab = document.createElement("label");
      lab.style.margin = "0 4px";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !!((E.attrs[ci] >> b) & 1);
      cb.dataset.bit = b;
      cb.addEventListener("change", () => {
        const arr = ((S.edited[E.level] && S.edited[E.level].attrs) || E.attrs).slice();
        const bit = cb.dataset.bit | 0;
        arr[ci] = cb.checked ? (arr[ci] | (1 << bit)) : (arr[ci] & ~(1 << bit));
        editsFor(E.level).attrs = arr;
        log("editor: L" + E.level + " combo " + ci + " attr bit " + bit + " -> " + (cb.checked ? 1 : 0));
        repaint();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(labels[b]));
      aRow.appendChild(lab);
    }
  }
  box.appendChild(aRow);
}
// Door-combo heuristic (both modes; door bits 2-3 shared per 6.2): a set
// scroll screen should contain a doorway combo (solid+door links regions).
export function doorComboSet(L) {
  const d = new Set();
  for (let i = 0; i < L.attrs.length; i++) if ((L.attrs[i] & 0x0C) !== 0) d.add(i);
  return d;
}
export function screenHasDoor(L, doors, sr, sc) {
  for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
    const bi = L.map[(sr * 4 + by) * 32 + sc * 4 + bx];
    for (let k = 0; k < 4; k++) {
      const si = L.blocks[bi * 4 + k];
      for (let j = 0; j < 4; j++) if (doors.has(L.structs[si * 4 + j])) return true;
    }
  }
  return false;
}
// Live free-space accounting: serialize the effective (edited) model per
// bank in memory and report free bytes; overflow surfaces here as well as
// at save time.
function effFreeLine() {
  const parts = [];
  for (const b of [0, 1, 2]) {
    const P = S.parsed["b" + b];
    if (!P) continue;
    try {
      const ed = {};
      for (const L of P.levels) if (S.edited[L.level]) ed[L.level] = S.edited[L.level];
      const r = serializeBank(P, ed);
      if (!r.ok) { parts.push("bank" + b + " OVERFLOW (" + r.errors[0] + ")"); continue; }
      const q = parseBank(r.bytes, b);
      parts.push("bank" + b + " free " + (q.ok ? bankFreeBytes(q) : -1) + "B");
    } catch (e) { parts.push("bank" + b + " free ?"); }
  }
  return parts.join(" | ");
}
function scrollHint(E) {
  // rectangularity + doorway hints per plane over the 8x8 screen grid
  const hint = el("edScrollHint");
  if (!hint) return;
  const msgs = [];
  const rows = E.map.length / 32;
  const evenScreens = (rows % 4 === 0);
  const doors = doorComboSet(E); // door bits 2-3 shared by tank+overhead (6.2)
  for (const [name, bytes] of [["V", E.scroll.subarray(0, 8)], ["H", E.scroll.subarray(8, 16)]]) {
    let cells = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((bytes[r] >> c) & 1) cells.push([r, c]);
    if (!cells.length) { msgs.push(name + ": empty"); continue; }
    const rs = cells.map(c => c[0]), cs = cells.map(c => c[1]);
    const r0 = Math.min(...rs), r1 = Math.max(...rs), c0 = Math.min(...cs), c1 = Math.max(...cs);
    const full = (r1 - r0 + 1) * (c1 - c0 + 1);
    // Shape is informational only: stock maps prove non-rectangular
    // regions are legitimate (e.g. stock L1 V), so shape is never flagged.
    let m = name + ": " + cells.length + " cells " + (cells.length === full ? "rectangular [" + r0 + "-" + r1 + "," + c0 + "-" + c1 + "]" : "(non-rectangular bbox [" + r0 + "-" + r1 + "," + c0 + "-" + c1 + "])");
    if (evenScreens) {
      // Informational only: stock maps prove doorless scroll screens and
      // even doorless regions are legitimate (dead-ends, loops, drops),
      // so absence of a door is never flagged as an error here.
      let with_ = 0;
      for (const [r, c] of cells) if (screenHasDoor(E, doors, r, c)) with_++;
      m += " doors " + with_ + "/" + cells.length + " screens";
    }
    msgs.push(m);
  }
  if (!evenScreens) msgs.push("doorway check n/a (rows not multiple of 4)");
  hint.textContent = msgs.join(" | ") + " [" + effFreeLine() + "]";
}
function fillChrBankSel() {
  const sel = el("edChrBank");
  if (!sel) return;
  if (sel.options.length === 32) { sel.value = S.chrBank; return; }
  sel.innerHTML = "";
  for (let b = 0; b < 32; b++) {
    const o = document.createElement("option");
    o.value = b;
    o.textContent = "bank " + b + (BANK_USERS[b] ? " (L" + BANK_USERS[b].join(",L") + ")" : "");
    sel.appendChild(o);
  }
  sel.value = S.chrBank;
}
function renderChrTab(E) {
  const info = el("edChrInfo");
  if (info) {
    const n = S.chr[S.chrBank] ? Object.keys(S.chr[S.chrBank]).length : 0;
    info.textContent = (BANK_USERS[S.chrBank] ? "bg for L" + BANK_USERS[S.chrBank].join(",L") : "no level bg use") +
      " | editing tile " + S.chrTile + (n ? " (" + n + " tile(s) edited in bank)" : "");
  }
  const sub = S.chrSub & 3;
  const col = v => NES_PALETTE[E.pal[sub * 4 + (v & 3)] & 63];
  // tile grid (16x16 tiles @8px)
  const grid = el("edChrGrid");
  if (grid) {
    grid.width = 128; grid.height = 128;
    grid.style.width = "512px"; grid.style.height = "512px";
    const ctx = grid.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 128, 128);
    for (let t = 0; t < TILES_PER_BANK4K; t++) {
      const px = chrTilePx(S.chrBank, t);
      const tx = (t % 16) * 8, ty = Math.floor(t / 16) * 8;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = col(px[y * 8 + x]);
        ctx.fillRect(tx + x, ty + y, 1, 1);
      }
    }
    if (S.chrTile >= 0) {
      ctx.strokeStyle = "#ff0"; ctx.lineWidth = 2;
      ctx.strokeRect((S.chrTile % 16) * 8 + 1, Math.floor(S.chrTile / 16) * 8 + 1, 6, 6);
    }
  }
  // big pixel editor (8x8 rects @16px)
  const big = el("edChrTile");
  if (big) {
    const ctx = big.getContext("2d");
    const px = chrTilePx(S.chrBank, S.chrTile);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = col(px[y * 8 + x]);
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * 16 + 0.5, 0); ctx.lineTo(i * 16 + 0.5, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 16 + 0.5); ctx.lineTo(128, i * 16 + 0.5); ctx.stroke();
    }
  }
  // 4-subpalette preview of the selected tile
  const prev = el("edChrPrev");
  if (prev) {
    prev.innerHTML = "";
    const px = chrTilePx(S.chrBank, S.chrTile);
    for (let s2 = 0; s2 < 4; s2++) {
      const lab = document.createElement("span");
      lab.textContent = "sub" + s2 + " ";
      prev.appendChild(lab);
      const cv = document.createElement("canvas");
      cv.width = 8; cv.height = 8;
      cv.style.cssText = "image-rendering:pixelated;width:48px;height:48px;vertical-align:middle;margin-right:8px";
      const ctx = cv.getContext("2d");
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        ctx.fillStyle = NES_PALETTE[E.pal[s2 * 4 + px[y * 8 + x]] & 63];
        ctx.fillRect(x, y, 1, 1);
      }
      prev.appendChild(cv);
    }
  }
  // ink buttons in current subpalette
  const inks = el("edChrInk");
  if (inks) {
    inks.innerHTML = "";
    for (let v = 0; v < 4; v++) {
      const b = document.createElement("button");
      b.textContent = v;
      b.title = "ink " + v;
      b.style.cssText = "width:36px;height:28px;margin:1px;background:" + col(v) + ";color:#fff;border:" + (S.chrInk === v ? "3px solid #ff0" : "1px solid #666");
      b.addEventListener("click", () => { S.chrInk = v; renderChrTab(cur() ? effLevel(cur()) : E); });
      inks.appendChild(b);
    }
  }
}
function onChrGridClick(ev) {
  const grid = el("edChrGrid");
  if (!grid) return;
  const r = grid.getBoundingClientRect();
  const tx = Math.floor((ev.clientX - r.left) / r.width * 16);
  const ty = Math.floor((ev.clientY - r.top) / r.height * 16);
  if (tx < 0 || ty < 0 || tx > 15 || ty > 15) return;
  S.chrTile = ty * 16 + tx;
  log("editor: chr bank " + S.chrBank + " tile " + S.chrTile);
  repaint();
}
function onChrTileClick(ev) {
  const big = el("edChrTile");
  if (!big) return;
  const r = big.getBoundingClientRect();
  const px = Math.floor((ev.clientX - r.left) / r.width * 8);
  const py = Math.floor((ev.clientY - r.top) / r.height * 8);
  if (px < 0 || py < 0 || px > 7 || py > 7) return;
  const cur = chrTilePx(S.chrBank, S.chrTile).slice();
  cur[py * 8 + px] = S.chrInk;
  setChrPx(S.chrBank, S.chrTile, cur);
  log("editor: chr bank " + S.chrBank + " tile " + S.chrTile + " (" + px + "," + py + ") -> " + S.chrInk);
  repaint();
}
function renderScrollGrids(E) {
  const v = el("edScrollV"), h = el("edScrollH");
  if (!v || !h) return;
  const toggle = (plane, r, c) => {
    const arr = ((S.edited[E.level] && S.edited[E.level].scroll) || E.scroll).slice();
    const i = plane === "V" ? r : 8 + r;
    arr[i] ^= (1 << c);
    editsFor(E.level).scroll = arr;
    log("editor: L" + E.level + " scroll " + plane + "[" + r + "] bit " + c + " toggled");
    repaint();
  };
  bitGrid(v, E.scroll.subarray(0, 8), "V", toggle);
  bitGrid(h, E.scroll.subarray(8, 16), "H", toggle);
  scrollHint(E);
}
function onMapClick(ev) {
  const L = cur();
  if (!L) return;
  const E = effLevel(L);
  const cv = el("edMap");
  const r = cv.getBoundingClientRect();
  const bx = Math.floor((ev.clientX - r.left) / r.width * MAP_COLS);
  const by = Math.floor((ev.clientY - r.top) / r.height * (E.map.length / MAP_COLS));
  if (bx < 0 || by < 0 || bx >= MAP_COLS || by >= E.map.length / MAP_COLS) return;
  const cell = by * MAP_COLS + bx;
  if (S.mode === "paint") {
    const m = ((S.edited[E.level] && S.edited[E.level].map) || E.map).slice();
    m[cell] = S.brush;
    editsFor(E.level).map = m;
    S.selCell = cell;
    repaint();
  } else {
    S.selCell = cell;
    repaint();
  }
}
function enemyKeyForLevel(level) { return level <= 8 ? 'A' + (level - 1) : 'B' + (level - 9); }
function effEnemyList(key) {
  if (!S.enemies || !S.enemies.ok) return null;
  const L = S.enemies.lists.find(l => l.key === key);
  if (!L) return null;
  const e = S.edEnemies[key] || {};
  const types = e.types || L.types, xs = e.xs || L.xs, ys = e.ys || L.ys;
  return { L, types, xs, ys, n: xs.length };
}
function bossIdxOf(key, types, n) {
  if (key[0] !== 'A') return -1;
  for (let i = 0; i < n; i++) if (types[i] === BOSS_TYPE) return i;
  return -1;
}
function commitEnemyRec(key, i, field, value) {
  const E = effEnemyList(key);
  if (!E || i < 0 || i >= E.n) return;
  if (field === 't' && i === bossIdxOf(key, E.types, E.n) && (value | 0) !== BOSS_TYPE) {
    log('editor: enemies refusing to retype BOSS record r' + i);
    repaint();
    return;
  }
  const cur = S.edEnemies[key] || { types: E.L.types.slice(), xs: E.L.xs.slice(), ys: E.L.ys.slice() };
  S.edEnemies[key] = cur;
  if (field === 't') cur.types[i] = Math.max(0, Math.min(127, value | 0));
  if (field === 'x') cur.xs[i] = Math.max(0, Math.min(255, value | 0));
  if (field === 'y') cur.ys[i] = Math.max(0, Math.min(255, value | 0));
  log('editor: enemies ' + key + '[' + i + '].' + field + ' -> ' + value);
  repaint();
}
function deleteEnemyRec(key, i) {
  const E = effEnemyList(key);
  if (!E || i < 0 || i >= E.n) return;
  if (i === bossIdxOf(key, E.types, E.n)) {
    log('editor: enemies refusing to delete BOSS record r' + i + ' (killing it sets the clear bit)');
    repaint();
    return;
  }
  const t = Array.from(E.types.slice(0, E.n)); t.splice(i, 1); t.push(0xFF);
  const x = Array.from(E.xs); x.splice(i, 1);
  const y = Array.from(E.ys); y.splice(i, 1);
  S.edEnemies[key] = { types: Uint8Array.from(t), xs: Uint8Array.from(x), ys: Uint8Array.from(y) };
  log('editor: enemies deleted ' + key + '[' + i + '] (' + E.n + '->' + x.length + ')');
  repaint();
}
function addEnemyRec(key) {
  const E = effEnemyList(key);
  if (!E) return;
  const tEl = el('edEnemyType'), xEl = el('edEnemyX'), yEl = el('edEnemyY');
  const t = Math.max(0, Math.min(127, (tEl && tEl.value | 0) || 0));
  const x = Math.max(0, Math.min(255, (xEl && xEl.value | 0) || 0));
  const y = Math.max(0, Math.min(255, (yEl && yEl.value | 0) || 0));
  if (key[0] === 'A' && t === BOSS_TYPE) {
    log('editor: enemies refusing to add a second type-32 to tank area ' + key);
    repaint();
    return;
  }
  const types = Uint8Array.from([...E.types.slice(0, E.n), t, 0xFF]);
  const xs = Uint8Array.from([...E.xs, x]);
  const ys = Uint8Array.from([...E.ys, y]);
  const trial = {};
  for (const k of Object.keys(S.edEnemies)) trial[k] = S.edEnemies[k];
  trial[key] = { types, xs, ys };
  const bud = spawnBudget(S.enemies, trial);
  if (!bud.ok || bud.free < 0) {
    log('editor: enemies over budget (need ' + (-bud.free) + ' more bytes: delete records first)');
    repaint();
    return;
  }
  S.edEnemies[key] = { types, xs, ys };
  log('editor: enemies added ' + key + '[' + E.n + '] t=' + t + ' x=' + x + ' y=' + y);
  repaint();
}
function renderEnemies() {
  const info = el('edEnemyInfo'), tbl = el('edEnemyTbl'), warn = el('edEnemyWarn'), bud = el('edEnemyBudget');
  if (!tbl) return;
  const key = enemyKeyForLevel(S.level);
  const E = effEnemyList(key);
  tbl.innerHTML = '';
  if (!E) { if (info) info.textContent = 'no spawn data'; if (warn) warn.textContent = ''; return; }
  const n = E.n;
  if (info) info.textContent = 'area ' + key + ' (' + E.L.mode + '): ' + n + ' spawn records';
  const freq = {};
  for (let i = 0; i < n; i++) freq[E.types[i]] = (freq[E.types[i]] || 0) + 1;
  const uniq = Object.keys(freq).filter(function (t) { return freq[t] === 1; });
  const bIdx = bossIdxOf(key, E.types, n);
  const bossHere = bIdx >= 0;
  const others = uniq.filter(function (t) { return !(bossHere && +t === BOSS_TYPE); });
  if (warn) warn.textContent = (bossHere ? ('BOSS record r' + bIdx + ' (type 32): killing it sets this area' + String.fromCharCode(39) + 's clear bit -- do not delete/retype/move far. ') : '') + (others.length ? ('unique type(s) ' + others.join(',') + ' here: possibly a miniboss -- verify in-game before moving far.') : '');
  const trial = {};
  for (const k of Object.keys(S.edEnemies)) trial[k] = S.edEnemies[k];
  const bg = spawnBudget(S.enemies, trial);
  if (bud) bud.textContent = bg.ok ? ('bank-3 budget: ' + bg.free + ' bytes free (~' + Math.max(0, Math.floor(bg.free / 3)) + ' adds)') : 'bank-3 budget: n/a';
  const hr = document.createElement('tr');
  const heads = ['rec', 'type', 'x', 'y', 'sprA/B', ''];
  for (let h = 0; h < heads.length; h++) { const th = document.createElement('th'); th.textContent = heads[h]; hr.appendChild(th); }
  tbl.appendChild(hr);
  for (let i = 0; i < n; i++) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td'); td0.textContent = (i === bIdx ? i + ' BOSS' : i); tr.appendChild(td0);
    const fields = [['t', E.types[i], 127], ['x', E.xs[i], 255], ['y', E.ys[i], 255]];
    for (let k = 0; k < fields.length; k++) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.max = fields[k][2]; inp.value = fields[k][1];
      inp.style.width = '64px';
      inp.dataset.i = i; inp.dataset.f = fields[k][0];
      inp.addEventListener('change', function () { commitEnemyRec(key, this.dataset.i | 0, this.dataset.f, this.value | 0); });
      td.appendChild(inp); tr.appendChild(td);
    }
    const sp = spriteFor(E.types[i]);
    const td = document.createElement('td');
    td.textContent = String.fromCharCode(36) + sp.a.toString(16) + '/' + String.fromCharCode(36) + sp.b.toString(16);
    tr.appendChild(td);
    const tdD = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'x';
    del.title = (i === bIdx) ? 'BOSS record: cannot delete' : 'delete record ' + i;
    del.disabled = (i === bIdx);
    del.dataset.i = i;
    del.addEventListener('click', function () { deleteEnemyRec(key, this.dataset.i | 0); });
    tdD.appendChild(del); tr.appendChild(tdD);
    tbl.appendChild(tr);
  }
}
function effStat(idx) {
  const base = S.resolved ? S.resolved.prg[STAT_BANK] : null;
  const cur = getStatEntry(base, idx) || { hp: 0, dmg: 0 };
  const e = S.edStats[idx];
  if (e) { if (e.hp !== undefined) cur.hp = e.hp; if (e.dmg !== undefined) cur.dmg = e.dmg; }
  return cur;
}
function commitStat(idx, field, value) {
  if (!(idx >= 0) || !Number.isInteger(value) || value < 0 || value > 255) {
    log('editor: stats refusing out-of-range e' + idx + '.' + field + '=' + value);
    repaint();
    return;
  }
  const cur = S.edStats[idx] || {};
  S.edStats[idx] = cur;
  cur[field] = value;
  log('editor: stats e' + idx + '.' + field + ' -> ' + value + ' (GLOBAL per type)');
  repaint();
}
function renderStatTbl() {
  const info = el('edStatInfo'), tbl = el('edStatTbl');
  if (!tbl) return;
  tbl.innerHTML = '';
  const key = enemyKeyForLevel(S.level);
  const E = effEnemyList(key);
  if (!E) { if (info) info.textContent = ''; return; }
  if (E.L.mode !== 'overhead') {
    if (info) info.textContent = 'tank area: enemy stats live in bank-4 actors (6.1c open), not editable here';
    return;
  }
  if (info) info.textContent = 'bank-6 table: edits are GLOBAL per type (all overhead areas)';
  const seen = {};
  const rows = [];
  const noEntry = [];
  for (let i = 0; i < E.n; i++) {
    const t = E.types[i];
    const idx = statIdxFor(t);
    if (idx < 0) { if (noEntry.indexOf(t) < 0) noEntry.push(t); continue; }
    if (seen[idx] !== undefined) continue;
    seen[idx] = t;
    rows.push({ type: t, idx: idx });
  }
  rows.sort(function (a, b) { return a.idx - b.idx; });
  const hr = document.createElement('tr');
  const heads = ['type', 'actor', 'HP', 'dmg', ''];
  for (let h = 0; h < heads.length; h++) { const th = document.createElement('th'); th.textContent = heads[h]; hr.appendChild(th); }
  tbl.appendChild(hr);
  for (let r = 0; r < rows.length; r++) {
    const type = rows[r].type, idx = rows[r].idx;
    const locked = INVALID_TYPES.has(type);
    const st = effStat(idx);
    const tr = document.createElement('tr');
    const td0 = document.createElement('td'); td0.textContent = type + ' (e' + idx + ')'; tr.appendChild(td0);
    const tdA = document.createElement('td');
    const av = TYPE_ACTOR[type];
    tdA.textContent = (av === undefined) ? '?' : ('$' + av.toString(16)); tr.appendChild(tdA);
    const fields = [['hp', st.hp], ['dmg', st.dmg]];
    for (let k = 0; k < fields.length; k++) {
      const td = document.createElement('td');
      if (locked) { td.textContent = fields[k][1]; }
      else {
        const inp = document.createElement('input');
        inp.type = 'number'; inp.min = 0; inp.max = 255; inp.value = fields[k][1];
        inp.style.width = '64px';
        inp.dataset.idx = idx; inp.dataset.f = fields[k][0];
        inp.addEventListener('change', function () { commitStat(this.dataset.idx | 0, this.dataset.f, this.value | 0); });
        td.appendChild(inp);
      }
      tr.appendChild(td);
    }
    const tdN = document.createElement('td');
    tdN.textContent = locked ? 'locked: activation-traps here' : (idx === 2 ? 'shared by types 1+2' : '');
    tr.appendChild(tdN);
    tbl.appendChild(tr);
  }
  if (noEntry.length && info) info.textContent += ' | no table entry (stock HP): types ' + noEntry.join(',');
}
async function saveAsPack() {
  const nameEl = el("edPackName");
  const stEl = el("edStatus");
  const name = (nameEl && nameEl.value || "").trim().slice(0, 80) || ("edited-" + Date.now().toString(36));
  const say = m => { if (stEl) stEl.textContent = m; log("editor: " + m); };
  try {
    if (!S.stock) throw new Error("no stock pack (pick a ROM first)");
    const patches = [];
    // P2: chr edits -> 8KB-bank diffs via the covered chr.js helper
    // (base = active pack, so prior custom chr edits survive).
    for (const d of chrPatchDescs(S.stock.chr, S.resolved.chr, S.chr)) {
      patches.push(makePatch("chr", d.bank, d.offset, d.bytes));
    }
    if (Object.keys(S.chr).length) log("editor: chr banks " + Object.keys(S.chr).join(","));
    for (const b of [0, 1, 2]) {
      const P = S.parsed["b" + b];
      if (!P) continue;
      const ed = {};
      for (const L of P.levels) if (S.edited[L.level]) ed[L.level] = S.edited[L.level];
      if (!Object.keys(ed).length) continue;
      const r = serializeBank(P, ed);
      if (!r.ok) throw new Error("serialize bank" + b + ": " + r.errors.join(" "));
      for (const run of diffRuns(S.stock.prg[b], r.bytes)) {
        patches.push(makePatch("prg", b, run.off, run.bytes));
      }
    }
    if (Object.keys(S.edStats).length) {
      const sr = serializeStats(S.resolved.prg[STAT_BANK], S.edStats);
      if (!sr.ok) throw new Error('serialize stats: ' + sr.errors.join(' '));
      for (const run of diffRuns(S.stock.prg[STAT_BANK], sr.bytes)) {
        patches.push(makePatch('prg', STAT_BANK, run.off, run.bytes));
      }
    }
    if (Object.keys(S.edEnemies).length) {
      let structural = false;
      for (const k of Object.keys(S.edEnemies)) {
        const L = S.enemies.lists.find(l => l.key === k);
        const e = S.edEnemies[k] || {};
        const xs = e.xs || (L && L.xs);
        if (L && xs && xs.length !== L.n) structural = true;
      }
      const er = structural ? rebuildSpawns(S.enemies, S.edEnemies) : serializeSpawns(S.enemies, S.edEnemies);
      if (!er.ok) throw new Error("serialize enemies: " + er.errors.join(" "));
      for (const run of diffRuns(S.stock.prg[SPAWN_BANK], er.bytes)) {
        patches.push(makePatch("prg", SPAWN_BANK, run.off, run.bytes));
      }
    }
    if (!patches.length) { say("no changes to save"); return; }
    const id = newCustomId();
    const doc = { customVersion: 1, id, name, baseCrc: S.stock.meta.crc32, patches, editorVersion: "p3", builtAt: new Date().toISOString() };
    await saveCustomPack(doc);
    S.edited = {};
    S.chr = {};
    S.edEnemies = {};
    S.edStats = {};
    repaint();
    try { await api.refreshPacks(); } catch (e) {}
    try { if (api.setPack) api.setPack(id); } catch (e2) {}
    say("saved pack " + name + " [" + id + "] (" + patches.length + " patches, now active)");
  } catch (e) { say("save failed: " + String((e && e.message) || e).slice(0, 120)); }
}
async function loadAll() {
  const stock = await api.loadStock();
  if (!stock) throw new Error("no stock pack (pick a ROM first)");
  S.stock = stock;
  const active = await api.ensurePack();
  S.resolved = active;
  S.parsed = {};
  for (const b of [0, 1, 2]) {
    const r = parseBank(active.prg[b], b);
    if (!r.ok) throw new Error("parse bank" + b + ": " + r.errors.join(" "));
    S.parsed["b" + b] = r;
    for (const L of r.levels) S.parsed[L.level] = { L, bank: b };
  }
  S.edited = {};
  S.chr = {};
  S.edEnemies = {};
  S.edStats = {};
  const pe = parseSpawns(active.prg[SPAWN_BANK]);
  if (!pe.ok) throw new Error("parse enemies: " + pe.errors.join(" "));
  S.enemies = pe;
  S.chrBank = -1;
  S.chrTile = 0;
  S.chrInk = 3;
  S.chrSub = 0;
  S.palSlot = 0;
}
function fillLevelSel() {
  const sel = el("edLevelSel");
  if (!sel) return;
  sel.innerHTML = "";
  for (let l = 1; l <= 16; l++) {
    const o = document.createElement("option");
    o.value = l;
    o.textContent = "level " + l + " (" + LEVEL_MODE[l] + ")";
    sel.appendChild(o);
  }
  sel.value = S.level;
}
async function selectLevel(lvl) {
  S.level = lvl;
  S.chrBank = BG_CHR_BANK[lvl];
  S.chrTile = 0;
  S.selCell = -1; S.selStruct = -1; S.selCombo = -1;
  const badge = el("edModeBadge");
  if (badge) badge.textContent = LEVEL_MODE[lvl];
  const L = cur();
  if (L) {
    const br = el("edBrush");
    if (br) { br.max = effLevel(L).blocks.length / 4 - 1; }
  }
  repaint();
}
export async function toggleEditor(a) {
  api = a;
  const ctn = el("editorCtn");
  if (!ctn) return;
  if (S.open) { ctn.hidden = true; S.open = false; return; }
  try {
    await loadAll();
  } catch (e) { log("editor: " + String((e && e.message) || e)); return; }
  ctn.hidden = false;
  S.open = true;
  fillLevelSel();
  const sel = el("edLevelSel");
  if (sel) sel.onchange = () => selectLevel(sel.value | 0);
  const cv = el("edMap");
  if (cv) cv.onclick = onMapClick;
  document.querySelectorAll('input[name="edMode"]').forEach(r => {
    r.checked = r.value === S.mode;
    r.onchange = () => { S.mode = r.value; };
  });
  const sc = el("edScrollChk");
  if (sc) sc.onchange = () => { S.showScroll = !!sc.checked; repaint(); };
  const br = el("edBrush");
  if (br) br.onchange = () => { S.brush = Math.max(0, br.value | 0); };
  const sv = el("edSaveBtn");
  if (sv) sv.onclick = saveAsPack;
  const eAdd = el('edEnemyAddBtn');
  if (eAdd) eAdd.onclick = () => addEnemyRec(enemyKeyForLevel(S.level));
  const grid = el("edChrGrid");
  if (grid) grid.onclick = onChrGridClick;
  const big = el("edChrTile");
  if (big) big.onclick = onChrTileClick;
  const cbs = el("edChrBank");
  if (cbs) cbs.onchange = () => { S.chrBank = cbs.value | 0; S.chrTile = 0; repaint(); };
  const sbs = el("edChrSub");
  if (sbs) sbs.onchange = () => { S.chrSub = sbs.value | 0; repaint(); };
  await selectLevel(S.level);
  log("editor: open (level " + S.level + ", " + Object.keys(S.parsed).filter(k => k[0] === "b").length + " banks)");
}
