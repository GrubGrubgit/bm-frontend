// src/ui/editor.js -- P1 tile-map editor view (lazy-loaded by app.js).
// Reads the LOADED (resolved) pack, edits banks 0-2 in memory, writes a NEW
// custom pack (never mutates stock). Overhead combo attrs are read-only
// until research 6.2; map/scroll/palette-view work for both modes.
import { parseBank, serializeBank, LEVEL_MODE } from "../pack/levels.js";
import { BG_CHR_BANK, chrBankBytes, paintMap, bitGrid, NES_PALETTE, MAP_COLS } from "../pack/tiles.js";
import { makePatch, newCustomId } from "../pack/overlay.js";
import { loadCustomPack, saveCustomPack } from "../pack/store.js";
let api = null;
const S = {
  open: false, stock: null, parsed: {}, edited: {}, level: 1,
  brush: 0, mode: "paint", selCell: -1, selStruct: -1, selCombo: -1, showScroll: false,
};
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
function bgBank() {
  const pack = S.resolved;
  const b4 = BG_CHR_BANK[S.level];
  return chrBankBytes(pack.chr, b4);
}
function repaint() {
  const L = cur();
  if (!L) return;
  const E = effLevel(L);
  const cv = el("edMap");
  const scroll = E.scroll;
  paintMap(cv, E, bgBank(), E.pal, {
    pxPerBlock: 16, showScroll: S.showScroll,
    scrollV: scroll.subarray(0, 8), scrollH: scroll.subarray(8, 16),
  });
  renderInspector(E);
  renderScrollGrids(E);
  renderPalStrip(E);
}
function renderPalStrip(E) {
  const cv = el("edPal");
  if (!cv) return;
  cv.width = 16 * 24; cv.height = 24;
  const ctx = cv.getContext("2d");
  for (let i = 0; i < 16; i++) { ctx.fillStyle = NES_PALETTE[E.pal[i] & 63]; ctx.fillRect(i * 24, 0, 24, 24); }
}
const ATTR_BITS_TANK = ["pal0", "pal1", "door/ent0", "door/ent1", "damage", "ladder", "water(brk)", "solid"];
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
  // attr bit editor (tank only)
  const aRow = document.createElement("div");
  if (E.mode === "overhead") {
    aRow.textContent = "attr bits read-only for overhead (research 6.2 pending): $" + E.attrs[ci].toString(16) + " = " + E.attrs[ci].toString(2).padStart(8, "0");
  } else {
    aRow.textContent = "attr bits: ";
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
      lab.appendChild(document.createTextNode(ATTR_BITS_TANK[b]));
      aRow.appendChild(lab);
    }
  }
  box.appendChild(aRow);
}
function scrollHint(E) {
  // rectangularity hint per plane over the 8x8 screen grid
  const hint = el("edScrollHint");
  if (!hint) return;
  const msgs = [];
  for (const [name, bytes] of [["V", E.scroll.subarray(0, 8)], ["H", E.scroll.subarray(8, 16)]]) {
    let cells = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((bytes[r] >> c) & 1) cells.push([r, c]);
    if (!cells.length) { msgs.push(name + ": empty"); continue; }
    const rs = cells.map(c => c[0]), cs = cells.map(c => c[1]);
    const r0 = Math.min(...rs), r1 = Math.max(...rs), c0 = Math.min(...cs), c1 = Math.max(...cs);
    const full = (r1 - r0 + 1) * (c1 - c0 + 1);
    msgs.push(name + ": " + cells.length + " cells" + (cells.length === full ? " rectangular [" + r0 + "-" + r1 + "," + c0 + "-" + c1 + "]" : " NON-RECTANGULAR bbox [" + r0 + "-" + r1 + "," + c0 + "-" + c1 + "]"));
  }
  hint.textContent = msgs.join(" | ") + " (plane orientation unverified; doorway combos link regions)";
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
export function diffRuns(a, b) {
  const runs = [];
  let i = 0;
  while (i < a.length) {
    if (a[i] === b[i]) { i++; continue; }
    let j = i;
    while (j < a.length && a[j] !== b[j]) j++;
    // coalesce small equal gaps (<16B) to keep patch count low
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
async function saveAsPack() {
  const nameEl = el("edPackName");
  const stEl = el("edStatus");
  const name = (nameEl && nameEl.value || "").trim().slice(0, 80) || ("edited-" + Date.now().toString(36));
  const say = m => { if (stEl) stEl.textContent = m; log("editor: " + m); };
  try {
    if (!S.stock) throw new Error("no stock pack (pick a ROM first)");
    const patches = [];
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
    if (!patches.length) { say("no changes to save"); return; }
    const id = "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    const doc = { customVersion: 1, id, name, baseCrc: S.stock.meta.crc32, patches, editorVersion: "p1", builtAt: new Date().toISOString() };
    await saveCustomPack(doc);
    S.edited = {};
    try { await api.refreshPacks(); } catch (e) {}
    say("saved pack " + name + " [" + id + "] (" + patches.length + " patches)");
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
  await selectLevel(S.level);
  log("editor: open (level " + S.level + ", " + Object.keys(S.parsed).filter(k => k[0] === "b").length + " banks)");
}
