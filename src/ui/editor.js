// src/ui/editor.js -- P1 tile-map editor view (lazy-loaded by app.js).
// Reads the LOADED (resolved) pack, edits banks 0-2 in memory, writes a NEW
// custom pack (never mutates stock). Overhead combo attrs editable per
// research 6.2 (bit meanings PROVEN headless, see levels.js).
import { parseBank, serializeBank, LEVEL_MODE, bankFreeBytes } from "../pack/levels.js";
import { BG_CHR_BANK, chrBankBytes, paintMap, bitGrid, renderBlockImage, NES_PALETTE, MAP_COLS } from "../pack/tiles.js";
import { decodeTile, encodeTile, chrPatchDescs, TILES_PER_BANK4K } from "../pack/chr.js";
import { SPR_PAL, SPR_CYCLE, spriteBanksFor, isPureSpriteBank } from "../pack/sprites.js";
import { makePatch, newCustomId, diffRuns } from "../pack/overlay.js";
import { parseSpawns, serializeSpawns, rebuildSpawns, spawnBudget, actorSpriteFor, liveSpriteSummary, SPAWN_BANK, serializeStats, getStatEntry, STAT_BANK, statIdxFor, INVALID_TYPES, TYPE_ACTOR, BOSS_TYPE, BOSS_REC, keyForLevel, serializeTankStats, getTankStatEntry, TANK_STAT_BANK, tankStatIdxFor, TANK_TRAP_TYPES, TANK_TYPE_ACTOR, spawnTypeAllowed } from "../pack/enemies.js";
import { behaviorFor, behaviorText, doorsForLevel, physicsText, slotText, areaSongText, soundText, soundSitesLine, aiLabelFor, enemyTypeOptions } from "../pack/gaps.js";
import { getAreaSongs, serializeAreaSongs, AREA_TABLE } from "../pack/sound.js";
import { parseSong, songLine, remapSongs, ptrOf, allSiteInfos, getTankSongs, serializeTankSongs, sitesMapOf, SITE_HOOK7_UNHOOKED } from '../pack/songs.js';
export { diffRuns };
import { loadCustomPack, saveCustomPack } from "../pack/store.js";
let api = null;
const S = {
  open: false, stock: null, parsed: {}, edited: {}, level: 1,
  brush: 0, mode: "paint", tool: "paint", brushMode: "block", enemyBrushType: 0, selCell: -1, selEnemy: -1, movingEnemy: null, movingBlock: null, selStruct: -1, selCombo: -1, showScroll: false,
  chr: {}, enemies: null, edEnemies: {}, edStats: {}, edTankStats: {}, edAreaSongs: {}, edSongPtr: {}, edSiteFilter: '', edTankSongs: {}, edSites: {},
  chrBank: -1, chrTile: 0, chrInk: 3, chrSub: 0, palSlot: 0,
  undo: [], redo: [], painting: false, strokeOpen: false, chrPainting: false, keysWired: false,
};
// 4KB CHR bank -> levels using it as bg bank (labels for the bank picker).
const BANK_USERS = {};
for (const [lvl, b] of Object.entries(BG_CHR_BANK)) {
  (BANK_USERS[b] = BANK_USERS[b] || []).push(lvl);
}
for (const k of Object.keys(BANK_USERS)) BANK_USERS[k].sort((a, b) => a - b);
function el(id) { return document.getElementById(id); }
function log(m) { try { api.log(m); } catch (e) {} }
const ED_LEVEL_KEY = "bm-editor-level";
function loadPersistedLevel() {
  try {
    const v = parseInt(localStorage.getItem(ED_LEVEL_KEY), 10);
    if (v >= 1 && v <= 16) return v;
  } catch (e) {}
  return null;
}
function persistLevel(lvl) {
  try { localStorage.setItem(ED_LEVEL_KEY, String(lvl)); } catch (e) {}
}
function showNoRomNotice(msg) {
  const ctn = el("editorCtn");
  if (!ctn) return;
  let n = el("edNoRom");
  if (!n) {
    n = document.createElement("div");
    n.id = "edNoRom";
    n.style.cssText = "background:#332200;border:1px solid #fc6;color:#ffe;padding:10px;margin:8px 0;text-align:left";
    ctn.insertBefore(n, ctn.firstChild);
  }
  n.hidden = false;
  n.textContent = msg;
}
function hideNoRomNotice() {
  const n = el("edNoRom");
  if (n) n.hidden = true;
}
// ---- Editor tabs + map zoom (one section visible at a time) ----
const ED_TAB_KEY = "bm-editor-tab";
const ED_ZOOM_KEY = "bm-editor-zoom";
const ED_ZOOMS = [4, 8, 12, 16, 24, 32, 48, 64];
const ED_TOOL_KEY = "bm-editor-tool";
const ED_BRUSHMODE_KEY = "bm-editor-brushmode";
const ED_TOOLS = [
  { id: "scroll", label: "Pan", title: "pan/scroll the map (drag scrolls, never paints; use on touch)" },
  { id: "paint", label: "Brush", title: "paint the brush block (see brush row above the map)" },
  { id: "erase", label: "Eraser", title: "erase: stamp block 0" },
  { id: "pick", label: "Picker", title: "eyedropper: tap a map cell to load its block into the brush" },
  { id: "inspect", label: "Inspect", title: "select a map cell to show its block/struct/combo chain (never paints, never changes the brush)" },
  { id: "move", label: "Move", title: "drag a block or an enemy to move it (enemy x/y follow automatically)" },
];
function loadBrushMode() {
  try {
    const v = localStorage.getItem(ED_BRUSHMODE_KEY);
    if (v === "enemy" || v === "block") return v;
  } catch (e) {}
  return "block";
}
function loadPersistedTool() {
  try {
    const v = localStorage.getItem(ED_TOOL_KEY);
    if (ED_TOOLS.some((t) => t.id === v)) return v;
  } catch (e) {}
  return "paint";
}
const ED_TABS = [
  { id: "map", label: "Map", anchors: ["edLevelSel", "edModeBadge", "edMap", "edBrush", "edCellInfo", "edInspector", "edScrollV", "edScrollH", "edScrollHint"] },
  { id: "pal", label: "Palette", anchors: ["edPal", "edPalSlots", "edPalInfo", "edPalPick"] },
  { id: "chr", label: "CHR", anchors: ["edChrBank", "edChrInfo", "edChrGrid", "edChrTile", "edChrPrev", "edChrInk", "edChrSub"] },
  { id: "enemies", label: "Enemies", anchors: ["edEnemyInfo", "edEnemyWarn", "edEnemyTbl", "edEnemyType", "edEnemyX", "edEnemyY", "edEnemyAddBtn", "edEnemyBudget"] },
  { id: "stats", label: "Stats", anchors: ["edStatInfo", "edStatTbl"] },
  { id: "sound", label: "Sound", anchors: ["edSoundNotes", "edAreaSongInfo", "edAreaSongTbl", "edSoundId", "edSoundOut", "edSongSel", "edSongOut", "edPtrId", "edPtrTarget", "edPtrOut", "edSiteInfo", "edSiteFilter", "edSiteTbl", "edTankInfo", "edTankTbl"] },
  { id: "notes", label: "Notes", anchors: ["edRENotes", "edDoorList"] },
];
function loadPersistedTab() {
  try {
    const v = localStorage.getItem(ED_TAB_KEY);
    if (ED_TABS.some((t) => t.id === v)) return v;
  } catch (e) {}
  return null;
}
function loadZoom() {
  try {
    const v = parseInt(localStorage.getItem(ED_ZOOM_KEY), 10);
    if (ED_ZOOMS.indexOf(v) >= 0) return v;
  } catch (e) {}
  return 16;
}
function editorTabOf(child) {
  for (const t of ED_TABS) {
    for (const a of t.anchors) {
      if (child.id === a) return t.id;
      try {
        if (child.querySelector && child.querySelector("#" + a)) return t.id;
      } catch (e) {}
    }
  }
  return null;
}
function buildEditorTabs() {
  const ctn = el("editorCtn");
  if (!ctn || el("edTabBar")) return;
  const bar = document.createElement("div");
  bar.id = "edTabBar";
  bar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;";
  const h3 = ctn.querySelector("h3");
  if (h3 && h3.nextSibling) ctn.insertBefore(bar, h3.nextSibling);
  else ctn.insertBefore(bar, ctn.firstChild);
  for (const t of ED_TABS) {
    const b = document.createElement("button");
    b.textContent = t.label;
    b.dataset.edTabBtn = t.id;
    b.addEventListener("click", () => setEditorTab(t.id));
    bar.appendChild(b);
  }
  for (const child of Array.from(ctn.children)) {
    if (child.id === "edTabBar" || child.id === "edNoRom") continue;
    const tag = (child.tagName || "").toUpperCase();
    if (tag === "H3" || tag === "HR") continue;
    try {
      if (child.querySelector && (child.querySelector("#edSaveBtn") || child.querySelector("#edPackName"))) continue;
    } catch (e) {}
    const tab = editorTabOf(child);
    child.dataset.edTab = tab || "map";
  }
  const counts = {};
  for (const child of Array.from(ctn.children)) {
    if (child.dataset && child.dataset.edTab) counts[child.dataset.edTab] = (counts[child.dataset.edTab] || 0) + 1;
  }
  for (const t of ED_TABS) {
    if (!counts[t.id]) {
      const b = bar.querySelector('[data-ed-tab-btn="' + t.id + '"]');
      if (b) b.hidden = true;
    }
  }
}
function setEditorTab(id) {
  if (!ED_TABS.some((t) => t.id === id)) id = "map";
  S.tab = id;
  try { localStorage.setItem(ED_TAB_KEY, id); } catch (e) {}
  const ctn = el("editorCtn");
  if (ctn) {
    for (const child of Array.from(ctn.children)) {
      if (child.dataset && child.dataset.edTab) child.hidden = child.dataset.edTab !== id;
    }
  }
  const bar = el("edTabBar");
  if (bar) {
    for (const b of Array.from(bar.querySelectorAll("[data-ed-tab-btn]"))) {
      const on = b.dataset.edTabBtn === id;
      b.style.fontWeight = on ? "bold" : "";
      b.style.background = on ? "#246" : "";
    }
  }
}
function mapScrollBox() {
  const cv = el("edMap");
  return cv && cv.parentNode ? cv.parentNode : null;
}
function buildToolRow() {
  if (el("edToolRow")) return;
  const box = mapScrollBox();
  if (!box || !box.parentNode) return;
  const row = document.createElement("div");
  row.id = "edToolRow";
  row.dataset.edTab = "map";
  row.style.cssText = "display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap;";
  const lab = document.createElement("span");
  lab.textContent = "Map tool:";
  lab.style.cssText = "font-weight:bold;";
  row.appendChild(lab);
  for (const t of ED_TOOLS) {
    const bb = document.createElement("button");
    bb.textContent = t.label;
    bb.title = t.title;
    bb.dataset.edToolBtn = t.id;
    bb.style.cssText = "min-width:64px;min-height:44px;";
    bb.addEventListener("click", () => setEditorTool(t.id));
    row.appendChild(bb);
  }
  box.parentNode.insertBefore(row, box);
  refreshToolRow();
}
function refreshToolRow() {
  const row = el("edToolRow");
  if (!row) return;
  for (const bb of Array.from(row.querySelectorAll("[data-ed-tool-btn]"))) {
    const on = bb.dataset.edToolBtn === (S.tool || "paint");
    bb.style.fontWeight = on ? "bold" : "";
    bb.style.background = on ? "#246" : "";
  }
}
function setEditorTool(id) {
  if (!ED_TOOLS.some((t) => t.id === id)) id = "paint";
  S.tool = id;
  try { localStorage.setItem(ED_TOOL_KEY, id); } catch (e) {}
  refreshToolRow();
  applyToolToMap();
}
function applyToolToMap() {
  const cv = el("edMap");
  if (!cv) return;
  const t = S.tool || "paint";
  cv.style.touchAction = t === "scroll" ? "pan-x pan-y" : "none";
  cv.style.cursor = t === "scroll" ? "grab" : t === "pick" ? "copy" : t === "inspect" ? "cell" : t === "move" ? "move" : "crosshair";
}
function buildZoomRow() {
  const stale = el("edZoomRow");
  if (stale) {
    const cvx = el("edMap");
    if (cvx && stale.parentNode === cvx.parentNode) stale.remove();
  }
  if (el("edZoomRow")) return;
  const cv = el("edMap");
  if (!cv || !cv.parentNode) return;
  const row = document.createElement("div");
  row.id = "edZoomRow";
  row.dataset.edTab = "map";
  row.style.cssText = "display:flex;gap:8px;align-items:center;margin:8px 0;";
  const lab0 = document.createElement("span");
  lab0.textContent = "Map zoom:";
  lab0.style.cssText = "font-weight:bold;";
  const out = document.createElement("button");
  out.id = "edZoomOut";
  out.textContent = "-";
  out.title = "zoom out (smaller blocks, see more of the map)";
  out.setAttribute("aria-label", "zoom out");
  out.style.cssText = "min-width:48px;min-height:44px;font-size:20px;";
  const lab = document.createElement("span");
  lab.id = "edZoomLabel";
  const inp = document.createElement("button");
  inp.id = "edZoomIn";
  inp.textContent = "+";
  inp.title = "zoom in (bigger blocks, paint precisely)";
  inp.setAttribute("aria-label", "zoom in");
  inp.style.cssText = "min-width:48px;min-height:44px;font-size:20px;";
  out.addEventListener("click", () => stepZoom(-1));
  inp.addEventListener("click", () => stepZoom(1));
  row.appendChild(lab0);
  row.appendChild(out); row.appendChild(lab); row.appendChild(inp);
  const box = mapScrollBox();
  if (box && box.parentNode) box.parentNode.insertBefore(row, box);
  else cv.parentNode.insertBefore(row, cv);
  updateZoomLabel();
}
function updateZoomLabel() {
  const lab = el("edZoomLabel");
  if (lab) lab.textContent = (S.zoom || 16) + " px/block";
}
function stepZoom(d) {
  const z = S.zoom || 16;
  let i = ED_ZOOMS.indexOf(z);
  if (i < 0) i = ED_ZOOMS.indexOf(16);
  i = Math.max(0, Math.min(ED_ZOOMS.length - 1, i + d));
  S.zoom = ED_ZOOMS[i];
  try { localStorage.setItem(ED_ZOOM_KEY, String(S.zoom)); } catch (e) {}
  updateZoomLabel();
  repaint();
}
// ---- Map-editor usability: theme, previews, undo, touch ----
function ensureEditorTheme() {
  if (document.getElementById("edTheme")) return;
  const rules = [
    "#editorCtn { color-scheme: dark; color: #eee; }",
    "#editorCtn button { background: #243; color: #eee; border: 1px solid #6c6; }",
    "#editorCtn button:disabled { opacity: 0.45; }",
    "#editorCtn input, #editorCtn select, #editorCtn textarea { background: #111; color: #eee; border: 1px solid #666; }",
    "#editorCtn label, #editorCtn span { color: #eee; }",
    "#editorCtn table td { color: #eee; }",
    "#editorCtn canvas { touch-action: none; }",
    "#editorCtn .edHelp { background: #1a2a1a; border: 1px solid #6c6; color: #eee; padding: 8px; margin: 6px 0; text-align: left; font-size: 13px; white-space: normal; }",
    "#editorCtn .edPrev { image-rendering: pixelated; vertical-align: middle; border: 1px solid #666; }",
  ];
  const st = document.createElement("style");
  st.id = "edTheme";
  st.textContent = rules.join("\n");
  document.head.appendChild(st);
}
function snapEdits() {
  return { edited: structuredClone(S.edited), chr: structuredClone(S.chr), en: structuredClone(S.edEnemies) };
}
function pushHistory(label) {
  try {
    S.undo.push({ label, snap: snapEdits() });
    if (S.undo.length > 60) S.undo.shift();
    S.redo.length = 0;
  } catch (e) {}
  updateUndoBtns();
}
function doUndo() {
  if (!S.undo || !S.undo.length) return;
  try {
    S.redo.push(snapEdits());
    const h = S.undo.pop();
    S.edited = h.snap.edited; S.chr = h.snap.chr; if (h.snap.en) S.edEnemies = h.snap.en; S.selEnemy = -1;
    log("editor: undo " + h.label);
  } catch (e) { log("editor: undo failed"); }
  updateUndoBtns(); repaint();
}
function doRedo() {
  if (!S.redo || !S.redo.length) return;
  try {
    S.undo.push({ label: "redo", snap: snapEdits() });
    const h = S.redo.pop();
    S.edited = h.edited; S.chr = h.chr; if (h.en) S.edEnemies = h.en; S.selEnemy = -1;
    log("editor: redo");
  } catch (e) { log("editor: redo failed"); }
  updateUndoBtns(); repaint();
}
function updateUndoBtns() {
  const u = el("edUndoBtn"), r = el("edRedoBtn"), info = el("edUndoInfo");
  if (u) u.disabled = !S.undo.length;
  if (r) r.disabled = !S.redo.length;
  if (info) info.textContent = S.undo.length ? "will undo: " + S.undo[S.undo.length - 1].label : "nothing to undo yet";
}
function buildUndoRow() {
  if (el("edUndoRow")) return;
  const sv = el("edSaveBtn");
  if (!sv || !sv.parentNode || !sv.parentNode.parentNode) return;
  const row = document.createElement("div");
  row.id = "edUndoRow";
  row.className = "shellRow";
  const u = document.createElement("button");
  u.id = "edUndoBtn";
  u.textContent = "Undo";
  u.title = "undo last edit (Ctrl+Z)";
  u.style.cssText = "min-height:44px;";
  const r = document.createElement("button");
  r.id = "edRedoBtn";
  r.textContent = "Redo";
  r.title = "redo (Ctrl+Shift+Z / Ctrl+Y)";
  r.style.cssText = "min-height:44px;";
  const info = document.createElement("span");
  info.id = "edUndoInfo";
  u.addEventListener("click", doUndo);
  r.addEventListener("click", doRedo);
  row.appendChild(u); row.appendChild(r); row.appendChild(info);
  sv.parentNode.parentNode.insertBefore(row, sv.parentNode);
  updateUndoBtns();
}
function wireUndoKeys() {
  if (S.keysWired) return; S.keysWired = true;
  document.addEventListener("keydown", (ev) => {
    if (!S.open) return;
    const tag = (ev.target && ev.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const k = (ev.key || "").toLowerCase();
    if (k === "z" && !ev.shiftKey) { ev.preventDefault(); doUndo(); }
    else if ((k === "z" && ev.shiftKey) || k === "y") { ev.preventDefault(); doRedo(); }
  });
}
function buildBrushPreview() {
  if (el("edBrushPrev")) return;
  const br = el("edBrush");
  if (!br || !br.parentNode) return;
  br.title = "block index stamped by paint mode (preview on the right)";
  const cap = document.createElement("span");
  cap.textContent = " brush preview:";
  const cv = document.createElement("canvas");
  cv.id = "edBrushPrev";
  cv.title = "what the brush block looks like (64x64px = 2x2 structs)";
  br.parentNode.appendChild(cap);
  br.parentNode.appendChild(cv);
}
function nBlocksOf(E) { return E.blocks.length / 4; }
function syncBrushInputs(E) {
  const n = E ? nBlocksOf(E) : null;
  if (n !== null) S.brush = Math.max(0, Math.min(n - 1, S.brush | 0));
  const br = el("edBrush");
  if (br) {
    if (n !== null) br.max = n - 1;
    if (String(br.value) !== String(S.brush)) br.value = S.brush;
  }
  const sel = el("edBrushSel");
  if (sel) {
    if (n !== null && sel.options.length !== n) {
      sel.innerHTML = "";
      for (let i = 0; i < n; i++) {
        const o = document.createElement("option");
        o.value = i;
        o.textContent = "block " + i;
        sel.appendChild(o);
      }
    }
    if (String(sel.value) !== String(S.brush)) sel.value = S.brush;
  }
}
function buildBrushPicker() {
  if (el("edBrushSel")) return;
  const br = el("edBrush");
  if (!br || !br.parentNode) return;
  br.title = "brush block index (synced with the dropdown; Picker tool or Alt+click eyedrops from the map)";
  const sel = document.createElement("select");
  sel.id = "edBrushSel";
  sel.title = "brush block: every valid block in this level";
  sel.style.cssText = "max-width:150px;";
  sel.addEventListener("change", () => {
    S.brush = sel.value | 0;
    syncBrushInputs(cur() ? effLevel(cur()) : null);
    repaint();
  });
  br.parentNode.insertBefore(sel, br.nextSibling);
  br.addEventListener("change", () => {
    S.brush = Math.max(0, br.value | 0);
    syncBrushInputs(cur() ? effLevel(cur()) : null);
    repaint();
  });
  syncBrushInputs(cur() ? effLevel(cur()) : null);
}
function setBrushMode(m) {
  S.brushMode = (m === "enemy") ? "enemy" : "block";
  try { localStorage.setItem(ED_BRUSHMODE_KEY, S.brushMode); } catch (e) {}
  renderBrushMode();
}
function buildBrushModeRow() {
  if (el("edBrushModeRow")) return;
  const br = el("edBrush");
  if (!br || !br.parentNode || !br.parentNode.parentNode) return;
  const host = br.parentNode;
  const row = document.createElement("div");
  row.id = "edBrushModeRow";
  row.dataset.edTab = "map";
  row.style.cssText = "display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap;";
  const lab = document.createElement("span");
  lab.textContent = "Brush paints:";
  lab.style.cssText = "font-weight:bold;";
  row.appendChild(lab);
  const modes = [["block", "Blocks", "stamp map blocks"], ["enemy", "Enemies", "tap the map to add a spawn record of the chosen type"]];
  for (const m of modes) {
    const b = document.createElement("button");
    b.textContent = m[1];
    b.title = m[2];
    b.dataset.edBrushModeBtn = m[0];
    b.style.cssText = "min-width:64px;min-height:44px;";
    b.addEventListener("click", () => setBrushMode(m[0]));
    row.appendChild(b);
  }
  const tsel = document.createElement("select");
  tsel.id = "edEnemyBrushType";
  tsel.title = "enemy type to stamp (sprite bytes + AI label follow)";
  tsel.style.cssText = "max-width:300px;";
  tsel.addEventListener("change", () => { S.enemyBrushType = tsel.value | 0; renderBrushMode(); });
  row.appendChild(tsel);
  const info = document.createElement("span");
  info.id = "edEnemyBrushInfo";
  row.appendChild(info);
  host.parentNode.insertBefore(row, host.nextSibling);
  renderBrushMode();
}
function renderBrushMode() {
  const row = el("edBrushModeRow");
  if (!row) return;
  for (const b of Array.from(row.querySelectorAll("[data-edBrushModeBtn]"))) {
    const on = b.dataset.edBrushModeBtn === (S.brushMode || "block");
    b.style.fontWeight = on ? "bold" : "";
    b.style.background = on ? "#246" : "";
  }
  const tsel = el("edEnemyBrushType"), info = el("edEnemyBrushInfo");
  const show = (S.brushMode || "block") === "enemy";
  if (tsel) tsel.hidden = !show;
  if (info) info.hidden = !show;
  if (!show) return;
  const key = enemyKeyForLevel(S.level);
  const isTank = isTankKey(key);
  if (tsel) {
    if (tsel.dataset.mode !== (isTank ? "A" : "B")) {
      tsel.innerHTML = "";
      for (const o of enemyTypeOptions(isTank)) {
        const op = document.createElement("option");
        op.value = o.t;
        op.textContent = o.label;
        tsel.appendChild(op);
      }
      tsel.dataset.mode = isTank ? "A" : "B";
    }
    if (String(tsel.value) !== String(S.enemyBrushType | 0)) tsel.value = S.enemyBrushType | 0;
  }
  if (info) {
    const tt = S.enemyBrushType | 0;
    info.textContent = "live: " + liveSpriteSummary(isTank, tt) + " | AI " + aiLabelFor(isTank, tt);
  }
}
function paintPreviewInto(cv, img, size) {
  if (!cv) return;
  cv.width = 64; cv.height = 64;
  cv.className = "edPrev";
  cv.style.width = size + "px"; cv.style.height = size + "px";
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(img, 0, 0);
}
function renderComboPreview(E, ci, cv) {
  if (!cv) return;
  const bytes = bgBank();
  if (!bytes) return;
  cv.width = 16; cv.height = 16;
  cv.className = "edPrev";
  cv.style.width = "64px"; cv.style.height = "64px";
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const sub = E.attrs[ci] & 3;
  for (let i = 0; i < 4; i++) {
    const px = decodeTile(bytes, E.combos[ci * 4 + i] * 16);
    const tx = (i % 2) * 8, ty = Math.floor(i / 2) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = NES_PALETTE[E.pal[sub * 4 + px[y * 8 + x]] & 63];
      ctx.fillRect(tx + x, ty + y, 1, 1);
    }
  }
}
function buildScrollHelp() {
  if (el("edScrollHelp")) return;
  const v = el("edScrollV");
  if (!v || !v.parentNode) return;
  const d = document.createElement("div");
  d.id = "edScrollHelp";
  d.className = "edHelp";
  d.textContent = "Scroll planes: the level map is an 8x8 grid of screens (each screen = 4x4 blocks). V marks screens the camera can scroll into VERTICALLY, H marks HORIZONTAL scrolling (click a cell to include or exclude it). H column 6 is special: it shifts that row's camera origin +32px X. On the map (turn on 'scroll overlay' above it): cyan = V, magenta = H, yellow = both.";
  v.parentNode.insertBefore(d, v);
}
function mapCellFromEvent(ev) {
  const L = cur();
  if (!L) return -1;
  const E = effLevel(L);
  const cv = el("edMap");
  if (!cv) return -1;
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return -1;
  const bx = Math.floor((ev.clientX - r.left) / r.width * MAP_COLS);
  const by = Math.floor((ev.clientY - r.top) / r.height * (E.map.length / MAP_COLS));
  if (bx < 0 || by < 0 || bx >= MAP_COLS || by >= E.map.length / MAP_COLS) return -1;
  return by * MAP_COLS + bx;
}
function stampMapCell(cell, value, label, startStroke) {
  const L = cur();
  if (!L || cell < 0) return;
  const E = effLevel(L);
  const nBlk = E.blocks.length / 4;
  const v = Math.max(0, Math.min(nBlk - 1, value | 0));
  const m = ((S.edited[E.level] && S.edited[E.level].map) || E.map).slice();
  if (m[cell] === v) { S.selCell = cell; repaint(); return; }
  if (startStroke) { pushHistory(label); S.strokeOpen = true; }
  m[cell] = v;
  editsFor(E.level).map = m;
  S.selCell = cell;
  repaint();
}
function applyMapCell(cell, startStroke) {
  const t = S.tool || "paint";
  if (t === "scroll") return;
  if (t === "pick") { pickMapCell(cell); return; }
  if (t === "inspect") { S.selCell = cell; repaint(); return; }
  stampMapCell(cell, t === "erase" ? 0 : S.brush, t === "erase" ? "erase block" : "paint block", startStroke);
}
function pickMapCell(cell) {
  if (cell < 0) return;
  const L = cur();
  if (!L) return;
  const E = effLevel(L);
  S.brush = Math.max(0, Math.min(E.blocks.length / 4 - 1, E.map[cell] | 0));
  S.selCell = cell;
  syncBrushInputs(E);
  const info = el("edCellInfo");
  if (info) info.textContent = "picked block " + S.brush + " from cell (" + (cell % MAP_COLS) + "," + Math.floor(cell / MAP_COLS) + ")";
  log("editor: pick block " + S.brush);
  repaint();
}
function onMapPointerDown(ev) {
  const t = S.tool || "paint";
  if (t === "scroll") return;
  if (ev.altKey) { pickMapCell(mapCellFromEvent(ev)); return; }
  if (t === "move") {
    const key = enemyKeyForLevel(S.level);
    const hi = enemyHitFromEvent(ev);
    if (ev.cancelable) ev.preventDefault();
    if (hi >= 0) {
      if (!ensureEnemyEdit(key)) return;
      pushHistory("move enemy");
      S.movingEnemy = { key: key, idx: hi };
      S.selEnemy = hi;
      try { el("edMap").setPointerCapture(ev.pointerId); } catch (e) {}
      repaint();
      return;
    }
    const cell = mapCellFromEvent(ev);
    if (cell >= 0) {
      const L = cur();
      if (!L) return;
      S.movingBlock = { cell: cell, value: effLevel(L).map[cell], snap: snapEdits() };
      S.selCell = cell;
      S.selEnemy = -1;
      try { el("edMap").setPointerCapture(ev.pointerId); } catch (e) {}
      repaint();
    }
    return;
  }
  if (t === "inspect") {
    if (ev.cancelable) ev.preventDefault();
    const hi = enemyHitFromEvent(ev);
    if (hi >= 0) { S.selEnemy = hi; repaint(); return; }
    S.selEnemy = -1;
    applyMapCell(mapCellFromEvent(ev), true);
    return;
  }
  if (t === "erase") {
    if (ev.cancelable) ev.preventDefault();
    const hi = enemyHitFromEvent(ev);
    if (hi >= 0) { deleteEnemyRec(enemyKeyForLevel(S.level), hi); S.selEnemy = -1; repaint(); return; }
    S.painting = true; S.strokeOpen = false;
    try { el("edMap").setPointerCapture(ev.pointerId); } catch (e) {}
    applyMapCell(mapCellFromEvent(ev), true);
    return;
  }
  if (t === "pick") { pickMapCell(mapCellFromEvent(ev)); return; }
  if (ev.cancelable) ev.preventDefault();
  S.painting = true; S.strokeOpen = false;
  try { el("edMap").setPointerCapture(ev.pointerId); } catch (e) {}
  if (t === "paint" && (S.brushMode || "block") === "enemy") addEnemyAtEvent(ev);
  else applyMapCell(mapCellFromEvent(ev), true);
}
function onMapPointerMove(ev) {
  if (S.movingEnemy) {
    if (ev.pointerType === "mouse" && (ev.buttons & 1) === 0) { S.movingEnemy = null; return; }
    const b = canvasByteXY(ev);
    if (!b) return;
    const cur = ensureEnemyEdit(S.movingEnemy.key);
    if (!cur) { S.movingEnemy = null; return; }
    cur.xs[S.movingEnemy.idx] = b.x;
    cur.ys[S.movingEnemy.idx] = b.y;
    if (ev.cancelable) ev.preventDefault();
    repaint();
    return;
  }
  if (S.movingBlock) {
    if (ev.pointerType === "mouse" && (ev.buttons & 1) === 0) { S.movingBlock = null; repaint(); return; }
    if (ev.cancelable) ev.preventDefault();
    return;
  }
  if (!S.painting) return;
  if (ev.pointerType === "mouse" && (ev.buttons & 1) === 0) { S.painting = false; return; }
  if ((S.tool || "paint") === "paint" && (S.brushMode || "block") === "enemy") { S.painting = false; return; }
  if ((S.tool || "paint") !== "paint" && (S.tool || "paint") !== "erase") { S.painting = false; return; }
  if (ev.cancelable) ev.preventDefault();
  applyMapCell(mapCellFromEvent(ev), !S.strokeOpen);
}
function onMapPointerUp(ev) {
  if (S.movingEnemy) {
    const m = S.movingEnemy;
    S.movingEnemy = null;
    const E = effEnemyList(m.key);
    if (E) log("editor: moved enemy " + m.key + "[" + m.idx + "] to x=" + E.xs[m.idx] + " y=" + E.ys[m.idx]);
    updateUndoBtns();
    repaint();
    return;
  }
  if (S.movingBlock) {
    const mb = S.movingBlock;
    S.movingBlock = null;
    const cell = mapCellFromEvent(ev);
    if (cell >= 0 && cell !== mb.cell) {
      const L = cur();
      if (L) {
        const E = effLevel(L);
        if (mb.value !== E.map[cell]) {
          S.undo.push({ label: "move block", snap: mb.snap });
          if (S.undo.length > 60) S.undo.shift();
          S.redo.length = 0;
          const mp = ((S.edited[E.level] && S.edited[E.level].map) || E.map).slice();
          mp[mb.cell] = 0;
          mp[cell] = mb.value;
          editsFor(E.level).map = mp;
          log("editor: moved block " + mb.value + " (" + cellCoords(mb.cell) + ") -> (" + cellCoords(cell) + ")");
        }
      }
    }
    S.selCell = cell >= 0 ? cell : mb.cell;
    updateUndoBtns();
    repaint();
    return;
  }
  S.painting = false; S.strokeOpen = false;
}
function chrGridPick(ev) {
  const grid = el("edChrGrid");
  if (!grid) return;
  const r = grid.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const tx = Math.floor((ev.clientX - r.left) / r.width * 16);
  const ty = Math.floor((ev.clientY - r.top) / r.height * 16);
  if (tx < 0 || ty < 0 || tx > 15 || ty > 15) return;
  S.chrTile = ty * 16 + tx;
  log("editor: chr bank " + S.chrBank + " tile " + S.chrTile);
  repaint();
}
function onChrGridPointerDown(ev) {
  if (ev.cancelable) ev.preventDefault();
  chrGridPick(ev);
}
function chrTilePaint(ev, startStroke) {
  const big = el("edChrTile");
  if (!big) return;
  const r = big.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const px = Math.floor((ev.clientX - r.left) / r.width * 8);
  const py = Math.floor((ev.clientY - r.top) / r.height * 8);
  if (px < 0 || py < 0 || px > 7 || py > 7) return;
  if (startStroke) pushHistory("chr pixel");
  const cur = chrTilePx(S.chrBank, S.chrTile).slice();
  cur[py * 8 + px] = S.chrInk;
  setChrPx(S.chrBank, S.chrTile, cur);
  log("editor: chr bank " + S.chrBank + " tile " + S.chrTile + " (" + px + "," + py + ") -> " + S.chrInk);
  repaint();
}
function onChrTilePointerDown(ev) {
  if (ev.cancelable) ev.preventDefault();
  S.chrPainting = true;
  try { el("edChrTile").setPointerCapture(ev.pointerId); } catch (e) {}
  chrTilePaint(ev, true);
}
function onChrTilePointerMove(ev) {
  if (!S.chrPainting) return;
  if (ev.pointerType === "mouse" && (ev.buttons & 1) === 0) { S.chrPainting = false; return; }
  if (ev.cancelable) ev.preventDefault();
  chrTilePaint(ev, false);
}
function onChrTilePointerUp(ev) { S.chrPainting = false; }
function buildEditorChrome() {
  ensureEditorTheme();
  wireUndoKeys();
  if (!S.tabsBuilt) {
    if (!S.zoom) S.zoom = loadZoom();
    S.tool = loadPersistedTool();
    S.brushMode = loadBrushMode();
    buildEditorTabs();
    buildToolRow();
    buildZoomRow();
    buildBrushPicker();
    buildBrushPreview();
    buildBrushModeRow();
    buildUndoRow();
    updateZoomLabel();
    updateUndoBtns();
    S.tabsBuilt = true;
  }
  setEditorTab(S.tab || loadPersistedTab() || "map");
  applyToolToMap();
}

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
  const bpv0 = el("edBrushPrev");
  if (bpv0) {
    const nBlk = E.blocks.length / 4;
    paintPreviewInto(bpv0, renderBlockImage(E, bgBank(), E.pal, Math.max(0, Math.min(nBlk - 1, S.brush | 0))), 56);
  }
  syncBrushInputs(E);
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
    pxPerBlock: S.zoom || 16, showScroll: S.showScroll,
    scrollV: scroll.subarray(0, 8), scrollH: scroll.subarray(8, 16),
    doorBlocks: doorCells,
  });
  renderEnemyMarkers(S.zoom || 16);
  renderBrushMode();
  renderInspector(E);
  renderScrollGrids(E);
  renderEnemies();
  renderStatTbl();
  renderRENotes();
  renderSoundNotes();
  renderAreaSongs();
  renderSongBrowser();
  renderSongPtr();
  renderSites();
  renderTankSongs();
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
      b.addEventListener("click", () => { pushHistory("palette slot"); S.palSlot = i; repaint(); });
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
        pushHistory("palette");
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
function renderEnemyPanel(E, box) {
  if (S.selEnemy < 0) return;
  const key = enemyKeyForLevel(S.level);
  const EL = effEnemyList(key);
  if (!EL || S.selEnemy >= EL.n) { S.selEnemy = -1; return; }
  const i = S.selEnemy, isTank = isTankKey(key);
  const t = EL.types[i];
  const sec = document.createElement("div");
  sec.style.cssText = "border:1px solid #ffd23f;padding:6px;margin:6px 0;text-align:left;";
  const hd = document.createElement("div");
  hd.textContent = "enemy r" + i + " (area " + key + ") — record type, sprite + AI";
  hd.style.cssText = "font-weight:bold;";
  sec.appendChild(hd);
  const tRow = document.createElement("div");
  tRow.textContent = "type (drives sprite + AI): ";
  const tsel = document.createElement("select");
  tsel.style.cssText = "max-width:300px;";
  for (const o of enemyTypeOptions(isTank)) {
    const op = document.createElement("option");
    op.value = o.t;
    op.textContent = o.label;
    tsel.appendChild(op);
  }
  tsel.value = t;
  tsel.addEventListener("change", () => commitEnemyRec(key, i, "t", tsel.value | 0));
  tRow.appendChild(tsel);
  sec.appendChild(tRow);
  const spRow = document.createElement("div");
  spRow.textContent = "live sprites: " + liveSpriteSummary(isTank, t) + " (staged bytes are spawn-time only, never drawn)";
  sec.appendChild(spRow);
  const bh = behaviorFor(isTank, t);
  const aiRow = document.createElement("div");
  aiRow.textContent = "AI (fixed by type): " + aiLabelFor(isTank, t);
  aiRow.title = behaviorText(bh) + (bh.note ? " — " + bh.note : "");
  sec.appendChild(aiRow);
  const xyRow = document.createElement("div");
  xyRow.textContent = "pos x/y (auto-set by the Move tool): ";
  const fields = [["x", EL.xs[i]], ["y", EL.ys[i]]];
  for (let k = 0; k < fields.length; k++) {
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = 0; inp.max = 255; inp.value = fields[k][1];
    inp.style.width = "64px";
    inp.dataset.f = fields[k][0];
    inp.title = fields[k][0] + " pixel-hi (world px = v*16+8)";
    inp.addEventListener("change", function () { commitEnemyRec(key, i, this.dataset.f, this.value | 0); });
    xyRow.appendChild(inp);
  }
  sec.appendChild(xyRow);
  const del = document.createElement("button");
  del.textContent = "delete record " + i;
  del.addEventListener("click", () => { deleteEnemyRec(key, i); S.selEnemy = -1; repaint(); });
  sec.appendChild(del);
  if (isTank && t === BOSS_TYPE) {
    const w = document.createElement("div");
    w.textContent = "BOSS egg: killing it sets this area clear bit — retype/delete refused, moving far unwise.";
    w.style.cssText = "color:#fc6;";
    sec.appendChild(w);
  }
  box.appendChild(sec);
}
function renderInspector(E) {
  const box = el("edInspector");
  if (!box) return;
  box.innerHTML = "";
  const add = (tag, text) => { const d = document.createElement(tag); d.textContent = text; box.appendChild(d); return d; };
  const helpTop = document.createElement("div");
  helpTop.className = "edHelp";
  helpTop.id = "edMapHelp";
  helpTop.textContent = "Map cells hold blocks: 1 block = 64px (2x2 structs); 1 struct = 32px (2x2 combos); 1 combo = 16px (2x2 tiles + 1 attr byte). Tools above the map: Pan scrolls (touch-safe, never paints); Brush stamps the brush block; Eraser stamps block 0; Picker loads a tapped cell into the brush (or hold Alt and tap any time). Move drags blocks or enemies on the map (enemy x/y follow; eraser on an enemy deletes its spawn record). Dots on the map are spawn records (red = boss egg, gold ring = selected). Undo/redo buttons sit by the save row (Ctrl+Z / Ctrl+Shift+Z).";
  box.appendChild(helpTop);
  renderEnemyPanel(E, box);
  if (S.selCell >= 0) {
    const bi = E.map[S.selCell];
    const cx = S.selCell % MAP_COLS, cy = Math.floor(S.selCell / MAP_COLS);
    add("div", "selected cell (" + cx + "," + cy + "): block " + bi);
    const setRow = document.createElement("div");
    setRow.textContent = "set this cell to block: ";
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = 0; inp.max = E.blocks.length / 4 - 1; inp.value = bi;
    inp.style.width = "90px";
    const btn = document.createElement("button");
    btn.textContent = "set";
    btn.addEventListener("click", () => {
      pushHistory("set block");
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
    add("div", "block " + bi + " = structs [" + st.join(",") + "] (chain:)");
    const bpvRow = document.createElement("div");
    const bpvLab = document.createElement("span");
    bpvLab.textContent = "block preview: ";
    const bpv = document.createElement("canvas");
    paintPreviewInto(bpv, renderBlockImage(E, bgBank(), E.pal, bi), 96);
    bpv.title = "block " + bi + " = 2x2 structs [" + st.join(",") + "]";
    bpvRow.appendChild(bpvLab); bpvRow.appendChild(bpv); box.appendChild(bpvRow);
    for (let k = 0; k < 4; k++) {
      const si = st[k];
      const scc = [];
      for (let j = 0; j < 4; j++) scc.push(E.structs[si * 4 + j]);
      add("div", "struct " + si + " = combos [" + scc.join(",") + "]");
    }
  }
  // struct browser
  const sRow = document.createElement("div");
  sRow.textContent = "browse struct (each = 2x2 combos): ";
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
  cRow.textContent = "browse combo (each = 2x2 tiles + attr): ";
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
  const cpRow = document.createElement("div");
  const cpLab = document.createElement("span");
  cpLab.textContent = "combo preview: ";
  const cpv = document.createElement("canvas");
  renderComboPreview(E, ci, cpv);
  cpv.title = "combo " + ci + " = 2x2 tiles [" + cp.join(",") + "] attr $" + E.attrs[ci].toString(16);
  cpRow.appendChild(cpLab); cpRow.appendChild(cpv); box.appendChild(cpRow);
  // pattern index editors
  const pRow = document.createElement("div");
  pRow.textContent = "patterns: ";
  for (let i = 0; i < 4; i++) {
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = 0; inp.max = 255; inp.value = cp[i];
    inp.style.width = "70px";
    inp.dataset.pi = i;
    inp.title = "tile index (8x8 pattern) into this level's bg CHR bank";
    inp.addEventListener("change", () => {
      pushHistory("combo pattern");
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
        pushHistory("combo attr");
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
  const sprTags = spriteBanksFor(S.level);
  for (let b = 0; b < 32; b++) {
    const o = document.createElement("option");
    o.value = b;
    o.textContent = "bank " + b + (BANK_USERS[b] ? " (L" + BANK_USERS[b].join(",L") + ")" : "") + (sprTags.indexOf(b) >= 0 ? " [spr L" + S.level + "]" : "");
    sel.appendChild(o);
  }
  sel.value = S.chrBank;
}
function renderChrTab(E) {
  const info = el("edChrInfo");
  if (info) {
    const n = S.chr[S.chrBank] ? Object.keys(S.chr[S.chrBank]).length : 0;
    info.textContent = (isPureSpriteBank(S.level, S.chrBank) ? "sprite bank for L" + S.level + " (sprite pal)" : (BANK_USERS[S.chrBank] ? "bg for L" + BANK_USERS[S.chrBank].join(",L") : "no level bg use")) +
      " | editing tile " + S.chrTile + (n ? " (" + n + " tile(s) edited in bank)" : "");
  }
  const sprView = isPureSpriteBank(E.level, S.chrBank);
  const sprPal = [0x0F, SPR_PAL[0], SPR_PAL[1], SPR_PAL[2], 0x0F, SPR_PAL[3], SPR_PAL[4], SPR_PAL[5], 0x0F, SPR_PAL[6], SPR_PAL[7], SPR_PAL[8], 0x00, SPR_CYCLE[0], SPR_CYCLE[0], SPR_CYCLE[0]];
  const pal = sprView ? sprPal : E.pal;
  const sub = S.chrSub & 3;
  const col = v => NES_PALETTE[pal[sub * 4 + (v & 3)] & 63];
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
        ctx.fillStyle = NES_PALETTE[pal[s2 * 4 + px[y * 8 + x]] & 63];
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
  chrGridPick(ev);
}
function onChrTileClick(ev) {
  chrTilePaint(ev, true);
}
function renderScrollGrids(E) {
  const v = el("edScrollV"), h = el("edScrollH");
  if (!v || !h) return;
  buildScrollHelp();
  const toggle = (plane, r, c) => {
    pushHistory("scroll plane");
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
  applyMapCell(mapCellFromEvent(ev), true);
}
function enemyKeyForLevel(level) { return keyForLevel(level); } // single source: enemies.js (palette-proven mapping)
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
function isTankKey(key) { return key[0] === "A"; }
function ensureEnemyEdit(key) {
  const E = effEnemyList(key);
  if (!E) return null;
  if (!S.edEnemies[key]) S.edEnemies[key] = { types: E.L.types.slice(), xs: E.L.xs.slice(), ys: E.L.ys.slice() };
  return S.edEnemies[key];
}
function enemyBlockXY(x, y) { return { bx: (x * 16 + 8) / 64, by: (y * 16 + 8) / 64 }; }
function curMapRows() { const L = cur(); if (!L) return 0; return effLevel(L).map.length / MAP_COLS; }
function canvasByteXY(ev) {
  const cv = el("edMap");
  if (!cv) return null;
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const gx = (ev.clientX - r.left) / r.width * MAP_COLS * 64;
  const gy = (ev.clientY - r.top) / r.height * curMapRows() * 64;
  return { x: Math.max(0, Math.min(255, Math.round((gx - 8) / 16))), y: Math.max(0, Math.min(255, Math.round((gy - 8) / 16))) };
}
function enemyHitFromEvent(ev) {
  const key = enemyKeyForLevel(S.level);
  const E = effEnemyList(key);
  if (!E) return -1;
  const cv = el("edMap");
  if (!cv) return -1;
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return -1;
  const bpx = S.zoom || 16;
  const px = (ev.clientX - r.left) / r.width * cv.width;
  const py = (ev.clientY - r.top) / r.height * cv.height;
  const rad = Math.max(8, bpx * 0.75);
  let best = -1, bd = rad * rad;
  for (let i = 0; i < E.n; i++) {
    const p = enemyBlockXY(E.xs[i], E.ys[i]);
    const dx = p.bx * bpx - px, dy = p.by * bpx - py;
    const d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}
function cellCoords(c) { return (c % MAP_COLS) + "," + Math.floor(c / MAP_COLS); }
function nesRgb(ci) {
  const h = NES_PALETTE[ci & 63];
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function enemyActorImg(isTank, type) {
  const spec = actorSpriteFor(isTank, type);
  if (!spec) return null;
  const banks = spriteBanksFor(S.level);
  if (!banks.length) return null;
  const tall = !!isTank;
  const cv = document.createElement("canvas");
  cv.width = spec.w; cv.height = spec.h;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(spec.w, spec.h);
  const pal = [0x0F, SPR_PAL[0], SPR_PAL[1], SPR_PAL[2], 0x0F, SPR_PAL[3], SPR_PAL[4], SPR_PAL[5], 0x0F, SPR_PAL[6], SPR_PAL[7], SPR_PAL[8], 0x00, SPR_CYCLE[0], SPR_CYCLE[0], SPR_CYCLE[0]];
  const base = (spec.sub & 3) * 4;
  let painted = 0;
  const put = function (px, dx, dy) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = px[y * 8 + x];
      if (!v) continue;
      const xx = dx + x, yy = dy + y;
      if (xx < 0 || yy < 0 || xx >= spec.w || yy >= spec.h) continue;
      const rgb = nesRgb(pal[base + (v & 3)]);
      const o = (yy * spec.w + xx) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
      painted++;
    }
  };
  for (let i = 0; i < spec.tiles.length; i++) {
    const s = spec.tiles[i];
    if (tall) {
      const bk = (s.t & 1) ? (banks.length > 1 ? banks[1] : banks[0]) : banks[0];
      let p1 = null, p2 = null;
      try { p1 = chrTilePx(bk, s.t & ~1); } catch (e) { p1 = null; }
      try { p2 = chrTilePx(bk, s.t | 1); } catch (e) { p2 = null; }
      if (!p1 || !p2) return null;
      put(p1, s.dx, s.dy); put(p2, s.dx, s.dy + 8);
    } else {
      let px = null;
      try { px = chrTilePx(banks[0], s.t); } catch (e) { px = null; }
      if (!px) return null;
      put(px, s.dx, s.dy);
    }
  }
  if (!painted) return null;
  ctx.putImageData(img, 0, 0);
  return cv;
}

function renderEnemyMarkers(bpx) {
  const cv = el("edMap");
  if (!cv) return;
  const key = enemyKeyForLevel(S.level);
  const E = effEnemyList(key);
  if (!E) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const isTank = isTankKey(key);
  const cache = {};
  const imgFor = function (type) {
    const k = (isTank ? "A" : "B") + (type | 0);
    if (cache[k] === undefined) cache[k] = enemyActorImg(isTank, type);
    return cache[k];
  };
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < E.n; i++) {
    const p = enemyBlockXY(E.xs[i], E.ys[i]);
    const cx = p.bx * bpx, cy = p.by * bpx;
    if (cx < -32 || cy < -32 || cx > cv.width + 32 || cy > cv.height + 32) continue;
    const boss = isTank && E.types[i] === BOSS_TYPE;
    const img = imgFor(E.types[i]);
    if (img) {
      const sc = Math.max(1, Math.round(bpx * 0.75 / img.height));
      const w = img.width * sc, h = img.height * sc;
      ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
      const rr = Math.max(w, h) / 2 + 3;
      if (boss) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, 6.2832);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#c00";
        ctx.stroke();
      }
      if (i === S.selEnemy) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr + 2, 0, 6.2832);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#ffd23f";
        ctx.stroke();
      }
      if (bpx >= 16) {
        ctx.font = "bold 9px monospace";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(String(i), cx, cy + h / 2 + 7);
        ctx.fillStyle = (i === S.selEnemy) ? "#ffd23f" : "#fff";
        ctx.fillText(String(i), cx, cy + h / 2 + 7);
      }
    } else {
      const rr = Math.max(3, bpx * 0.4);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, 6.2832);
      ctx.fillStyle = boss ? "#c00" : "rgba(10,10,10,0.85)";
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, bpx * 0.12);
      ctx.strokeStyle = (i === S.selEnemy) ? "#ffd23f" : "#fff";
      ctx.stroke();
      if (bpx >= 10) {
        ctx.fillStyle = "#fff";
        ctx.font = Math.max(9, bpx * 0.55) + "px monospace";
        ctx.fillText(String(i), cx, cy);
      }
      if (i === S.selEnemy) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr + 3, 0, 6.2832);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffd23f";
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
function commitEnemyRec(key, i, field, value) {
  const E = effEnemyList(key);
  if (!E || i < 0 || i >= E.n) return;
  if (field === 't' && i === bossIdxOf(key, E.types, E.n) && (value | 0) !== BOSS_TYPE) {
    log('editor: enemies refusing to retype BOSS record r' + i);
    repaint();
    return;
  }
  pushHistory("enemy edit");
  const cur = S.edEnemies[key] || { types: E.L.types.slice(), xs: E.L.xs.slice(), ys: E.L.ys.slice() };
  S.edEnemies[key] = cur;
  if (field === 't') {
    const chk2 = spawnTypeAllowed(key[0] === 'A', value | 0);
    if (!chk2.ok) {
      log('editor: enemies refusing retype to ' + (value | 0) + ' in ' + key + ' (' + chk2.reason + ' at activation, area-proven)');
      repaint();
      return;
    }
  }
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
  pushHistory("delete enemy");
  S.edEnemies[key] = { types: Uint8Array.from(t), xs: Uint8Array.from(x), ys: Uint8Array.from(y) };
  log('editor: enemies deleted ' + key + '[' + i + '] (' + E.n + '->' + x.length + ')');
  repaint();
}
function addEnemyAtEvent(ev) {
  const b = canvasByteXY(ev);
  if (!b) return;
  addEnemyRecAt(enemyKeyForLevel(S.level), S.enemyBrushType | 0, b.x, b.y);
}
function addEnemyRecAt(key, t, x, y) {
  const E = effEnemyList(key);
  if (!E) return false;
  t = Math.max(0, Math.min(127, t | 0));
  x = Math.max(0, Math.min(255, x | 0));
  y = Math.max(0, Math.min(255, y | 0));
  const chk = spawnTypeAllowed(key[0] === 'A', t);
  if (!chk.ok) {
    log('editor: enemies refusing type ' + t + ' in ' + key + ' (' + chk.reason + ' at activation, area-proven)');
    repaint();
    return;
  }
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
  pushHistory("add enemy");
  S.edEnemies[key] = { types, xs, ys };
  S.selEnemy = E.n;
  log('editor: enemies added ' + key + '[' + E.n + '] t=' + t + ' x=' + x + ' y=' + y);
  repaint();
  return true;
}
function addEnemyRec(key) {
  const tEl = el('edEnemyType'), xEl = el('edEnemyX'), yEl = el('edEnemyY');
  addEnemyRecAt(key, (tEl && tEl.value | 0) || 0, (xEl && xEl.value | 0) || 0, (yEl && yEl.value | 0) || 0);
}
function renderRENotes() {
  const nz = el('edRENotes'), dz = el('edDoorList');
  if (!nz && !dz) return;
  const isTank = enemyKeyForLevel(S.level)[0] === 'A';
  if (nz) nz.textContent = physicsText() + ' || ' + slotText() + (isTank ? ' || tank: type->actor->routine in AI column' : ' || overhead: type->actor->routine in AI column');
  if (dz) {
    dz.textContent = '';
    try {
      const d = doorsForLevel(S.resolved ? S.resolved.prg[7] : null, S.level);
      if (!d.ok) dz.textContent = 'doors: n/a';
      else if (!d.sides.length) dz.textContent = 'no door sides in area $' + d.area.toString(16);
      else dz.textContent = 'area $' + d.area.toString(16) + ': ' + d.sides.map(function (s) { return 'r' + s.row + '($' + s.x.toString(16) + ',$' + s.y.toString(16) + ')->a$' + s.toArea.toString(16) + '($' + s.toX.toString(16) + ',$' + s.toY.toString(16) + ')'; }).join(' ');
    } catch (err) { dz.textContent = 'doors: n/a'; }
  }
}


function effAreaSong(i) {
  const base = S.resolved ? S.resolved.prg[AREA_TABLE.BANK] : null;
  const songs = getAreaSongs(base) || [6, 4, 2, 19, 7, 5, 55, 43];
  const e = S.edAreaSongs[i];
  return (e === undefined) ? songs[i] : e;
}
function commitAreaSong(i, value) {
  if (!(i >= 0 && i < AREA_TABLE.COUNT) || !Number.isInteger(value) || value < 0 || value > 84) {
    log("editor: areaSongs refusing out-of-range a" + i + "=" + value);
    repaint();
    return;
  }
  S.edAreaSongs[i] = value;
  log("editor: areaSongs a" + i + " -> " + value + " (GLOBAL per area&7)");
  repaint();
}


function effSongPtr(id) {
  const base = S.resolved ? S.resolved.prg[5] : null;
  if (!base) return null;
  const e = S.edSongPtr[id];
  const t = (e === undefined) ? id : e;
  return { from: ptrOf(base, id), to: ptrOf(base, t), target: t };
}
function commitSongPtr(id, target) {
  if (!(id >= 0 && id < 85 && (id | 0) === id) || !Number.isInteger(target) || target < 0 || target > 84) {
    log("editor: songPtr refusing out-of-range " + id + "->" + target);
    repaint();
    return;
  }
  S.edSongPtr[id] = target;
  log("editor: songPtr $" + id.toString(16) + " -> $" + target.toString(16) + " (pointer word copy)");
  repaint();
}
function renderSongPtr() {
  const a = el("edPtrId"), b = el("edPtrTarget"), out = el("edPtrOut");
  if (!a && !out) return;
  const upd = function () {
    if (!out) return;
    try {
      const id = parseInt(String(a.value).trim(), 10);
      const m = effSongPtr(id);
      if (!m || m.from == null) { out.textContent = 'ptr: n/a'; return; }
      out.textContent = 'ptr $' + m.from.toString(16) + (m.target === id ? ' (stock)' : ' -> $' + m.to.toString(16) + ' (remapped)');
    } catch (err) { out.textContent = 'ptr: n/a'; }
  };
  if (a) {
    if (!a.dataset.wired) {
      a.dataset.wired = '1';
      a.addEventListener('change', upd);
      if (b) b.addEventListener('change', function () { commitSongPtr(parseInt(String(a.value).trim(), 10), parseInt(String(b.value).trim(), 10)); upd(); });
    }
    upd();
  }
}
function renderSites() {
  const info = el('edSiteInfo'), tbl = el('edSiteTbl'), filt = el('edSiteFilter');
  if (!tbl) return;
  if (filt && !filt.dataset.wired) {
    filt.dataset.wired = '1';
    filt.addEventListener('change', function () { S.edSiteFilter = String(filt.value || '').toLowerCase(); renderSites(); });
  }
  if (filt && document.activeElement !== filt) filt.value = S.edSiteFilter || '';
  const B = S.resolved ? S.resolved.prg : null;
  tbl.innerHTML = '';
  if (!B) { if (info) info.textContent = 'sites: n/a'; return; }
  let infos = [];
  try { infos = allSiteInfos(B); } catch (err) { if (info) info.textContent = 'sites: n/a'; return; }
  const q = S.edSiteFilter || '';
  const rows = [];
  for (let i = 0; i < infos.length; i++) {
    const r = infos[i];
    if (r.shape !== 'I' && r.shape !== 'L') continue;
    const hay = (r.key + ' ' + r.song + ' ' + r.note).toLowerCase();
    if (q && hay.indexOf(q) < 0) continue;
    rows.push(r);
  }
  const hr = document.createElement('tr');
  const heads = ['site', 'song', 'ovr', 'note'];
  for (let h = 0; h < heads.length; h++) { const th = document.createElement('th'); th.textContent = heads[h]; hr.appendChild(th); }
  tbl.appendChild(hr);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tr = document.createElement('tr');
    const td0 = document.createElement('td'); td0.textContent = r.key + ' ' + r.shape; tr.appendChild(td0);
    const td1 = document.createElement('td'); td1.textContent = '$' + r.id.toString(16) + ' (' + r.cur + ')'; tr.appendChild(td1);
    const td2 = document.createElement('td');
    if (SITE_HOOK7_UNHOOKED.indexOf(r.key) >= 0) { td2.textContent = 'unlifted'; td2.title = 'no lifted LDA in this build: override has no effect (see songs.js SITE_HOOK7_UNHOOKED)'; }
    else {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = 0; inp.max = 84; inp.value = effSite(r.key, r.cur);
      inp.style.width = '56px'; inp.dataset.key = r.key;
      inp.addEventListener('change', function () { commitSite(this.dataset.key, this.value | 0); });
      td2.appendChild(inp);
      const lv = siteLiveMap()[r.key];
      if (lv !== undefined) { const sp = document.createElement('span'); sp.textContent = ' pack:$' + lv.toString(16); sp.title = 'active pack override (engine-live)'; td2.appendChild(sp); }
    }
    tr.appendChild(td2);
    const td3 = document.createElement('td'); td3.textContent = r.note; tr.appendChild(td3);
    tbl.appendChild(tr);
  }
  if (info) info.textContent = rows.length + ' I/L sites, hook-7 live overrides (blank = stock)' + ' | unlifted rows read-only | tank table below is data';
}
function siteLiveMap() {
  try {
    const c = S.resolved && S.resolved.custom;
    if (c && c.sites && typeof c.sites === 'object') return c.sites;
  } catch (err) {}
  return {};
}
function effSite(key, cur) {
  const e = S.edSites[key];
  return (e === undefined) ? cur : e;
}
function commitSite(key, value) {
  if (SITE_HOOK7_UNHOOKED.indexOf(key) >= 0 || !Number.isInteger(value) || value < 0 || value > 84) {
    log('editor: sites refusing out-of-range/unlifted ' + key + '=' + value);
    repaint();
    return;
  }
  S.edSites[key] = value;
  log('editor: sites ' + key + ' -> $' + value.toString(16));
  repaint();
}
function effTankSong(i) {
  const base = S.resolved ? S.resolved.prg[4] : null;
  let songs = null;
  try { songs = getTankSongs(base); } catch (err) { songs = null; }
  if (!songs) songs = [42, 9, 9, 42, 9, 9, 42, 9];
  const e = S.edTankSongs[i];
  return (e === undefined) ? songs[i] : e;
}
function commitTankSong(i, value) {
  if (!(i >= 0 && i < 8 && (i | 0) === i) || !Number.isInteger(value) || value < 0 || value > 84) {
    log('editor: tankSongs refusing out-of-range t' + i + '=' + value);
    repaint();
    return;
  }
  S.edTankSongs[i] = value;
  log('editor: tankSongs t' + i + ' -> $' + value.toString(16) + ' (LA124 table)');
  repaint();
}
function renderTankSongs() {
  const info = el('edTankInfo'), tbl = el('edTankTbl');
  if (!tbl) return;
  tbl.innerHTML = '';
  const hr = document.createElement('tr');
  const heads = ['slot', 'song'];
  for (let h = 0; h < heads.length; h++) { const th = document.createElement('th'); th.textContent = heads[h]; hr.appendChild(th); }
  tbl.appendChild(hr);
  for (let i = 0; i < 8; i++) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td'); td0.textContent = 't' + i; tr.appendChild(td0);
    const td1 = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = 0; inp.max = 84; inp.value = effTankSong(i);
    inp.style.width = '64px';
    inp.dataset.i = i;
    inp.addEventListener('change', function () { commitTankSong(this.dataset.i | 0, this.value | 0); });
    td1.appendChild(inp); tr.appendChild(td1);
    tbl.appendChild(tr);
  }
  if (info) info.textContent = 'LA124 table bank4, exact 8 bytes (1 patch per changed byte); A118 refresh plays LA124[$14&7] after boss-countdown expiry';
}
function renderSongBrowser() {
  const inp = el("edSongSel"), out = el("edSongOut");
  if (!inp && !out) return;
  const show = function (raw) {
    if (!out) return;
    try {
      const base = S.resolved ? S.resolved.prg[5] : null;
      if (!base) { out.textContent = 'song: n/a'; return; }
      let s = String(raw == null ? '' : raw).trim().toLowerCase();
      if (s.charAt(0) === '$') s = s.slice(1);
      const id = parseInt(s, 16);
      const r = parseSong(base, id);
      if (!r.ok) { out.textContent = 'song $' + s + ': ' + r.errors.join(' '); return; }
      out.textContent = songLine(r);
    } catch (err) { out.textContent = 'song: n/a'; }
  };
  if (inp) {
    if (!inp.dataset.wired) {
      inp.dataset.wired = '1';
      inp.addEventListener('change', function () { show(inp.value); });
    }
    show(inp.value);
  }
}
function renderAreaSongs() {
  const info = el("edAreaSongInfo"), tbl = el("edAreaSongTbl");
  if (!tbl) return;
  tbl.innerHTML = "";
  const hr = document.createElement("tr");
  const heads = ["area", "levels", "song"];
  for (let h = 0; h < heads.length; h++) { const th = document.createElement("th"); th.textContent = heads[h]; hr.appendChild(th); }
  tbl.appendChild(hr);
  for (let i = 0; i < AREA_TABLE.COUNT; i++) {
    const tr = document.createElement("tr");
    const td0 = document.createElement("td"); td0.textContent = "a" + i; tr.appendChild(td0);
    const td1 = document.createElement("td"); td1.textContent = "tank L" + (i + 9) + " + dung L" + (i + 1); tr.appendChild(td1);
    const td2 = document.createElement("td");
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = 0; inp.max = 84; inp.value = effAreaSong(i);
    inp.style.width = "64px";
    inp.dataset.i = i;
    inp.addEventListener("change", function () { commitAreaSong(this.dataset.i | 0, this.value | 0); });
    td2.appendChild(inp); tr.appendChild(td2);
    tbl.appendChild(tr);
  }
  if (info) info.textContent = "LCDC8 bank7+3528, exact 8 bytes (1 patch per changed byte). Note: intro advance waits for the entry song to end, so a longer song delays the dungeon BGM";
}
function renderSoundNotes() {
  const nz = el("edSoundNotes"), inp = el("edSoundId"), out = el("edSoundOut");
  if (!nz && !out) return;
  try {
    if (nz) nz.textContent = areaSongText(S.level) + ' || ' + soundText();
  } catch (err) { if (nz) nz.textContent = "sound: n/a"; }
  if (inp && out) {
    if (!inp.dataset.wired) {
      inp.dataset.wired = "1";
      inp.addEventListener("change", function () {
        try { out.textContent = soundSitesLine(inp.value); } catch (err) { out.textContent = 'sound: n/a'; }
      });
    }
    try { out.textContent = soundSitesLine(inp.value); } catch (err) { out.textContent = 'sound: n/a'; }
  }
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
  const heads = ['rec', 'type', 'x', 'y', 'live', 'AI', ''];
  for (let h = 0; h < heads.length; h++) { const th = document.createElement('th'); th.textContent = heads[h]; hr.appendChild(th); }
  tbl.appendChild(hr);
  for (let i = 0; i < n; i++) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td'); td0.textContent = (i === bIdx ? i + ' BOSS' : i);
    td0.style.cssText = 'cursor:pointer;text-decoration:underline;';
    td0.title = 'select this enemy on the tilemap';
    (function (idx) { td0.addEventListener('click', function () { S.selEnemy = idx; S.selCell = -1; setEditorTab('map'); repaint(); }); })(i);
    tr.appendChild(td0);
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
    const td = document.createElement('td');
    td.textContent = liveSpriteSummary(key[0] === 'A', E.types[i]);
    tr.appendChild(td);
    const bh = behaviorFor(key[0] === 'A', E.types[i]);
    const tdB = document.createElement('td');
    tdB.textContent = aiLabelFor(key[0] === 'A', E.types[i]);
    tdB.title = behaviorText(bh) + (bh.note ? ' — ' + bh.note : '');
    tr.appendChild(tdB);
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
function effTankStat(idx) {
  const base = S.resolved ? S.resolved.prg[TANK_STAT_BANK] : null;
  const cur = getTankStatEntry(base, idx) || { hp: 0, dmg: 0 };
  const e = S.edTankStats[idx];
  if (e) { if (e.hp !== undefined) cur.hp = e.hp; if (e.dmg !== undefined) cur.dmg = e.dmg; }
  return cur;
}
function commitTankStat(idx, field, value) {
  if (!(idx >= 0) || !Number.isInteger(value) || value < 0 || value > 255) {
    log(String("editor: tank stats refusing out-of-range e") + idx + "." + field + "=" + value);
    repaint();
    return;
  }
  const cur = S.edTankStats[idx] || {};
  S.edTankStats[idx] = cur;
  cur[field] = value;
  log(String("editor: tank stats e") + idx + "." + field + " -> " + value + " (GLOBAL per type)");
  repaint();
}
function renderStatTbl() {
  const info = el('edStatInfo'), tbl = el('edStatTbl');
  if (!tbl) return;
  tbl.innerHTML = '';
  const key = enemyKeyForLevel(S.level);
  const E = effEnemyList(key);
  if (!E) { if (info) info.textContent = ''; return; }
  if (E.L.mode !== 'tank') {
    if (info) info.textContent = 'HP/damage table (bank 4, CPU $B326, 16 entries e0-e15): one row per enemy TYPE, shared by every level that spawns it (Sophia overhead areas, levels 9-16). byte 0 = max HP the enemy spawns with; byte 1 = damage its shots/contact deal.';
    const seenT = {};
    const rowsT = [];
    const noEntryT = [];
    for (let i = 0; i < E.n; i++) {
      const t = E.types[i];
      const idx = tankStatIdxFor(t);
      if (idx < 0) { if (noEntryT.indexOf(t) < 0) noEntryT.push(t); continue; }
      if (seenT[idx] !== undefined) continue;
      seenT[idx] = t;
      rowsT.push({ type: t, idx: idx });
    }
    rowsT.sort(function (a, b) { return a.idx - b.idx; });
    const hrT = document.createElement('tr');
    const headsT = ['type (table entry)', 'AI actor', 'HP = max health (byte 0)', 'dmg = attack damage (byte 1)', ''];
    for (let h = 0; h < headsT.length; h++) { const th = document.createElement('th'); th.textContent = headsT[h]; hrT.appendChild(th); }
    tbl.appendChild(hrT);
    for (let r = 0; r < rowsT.length; r++) {
      const type = rowsT[r].type, idx = rowsT[r].idx;
      const locked = TANK_TRAP_TYPES.has(type);
      const st = effTankStat(idx);
      const tr = document.createElement('tr');
      const td0 = document.createElement('td'); td0.textContent = 'type ' + type + ' -> entry e' + idx; td0.title = 'table entry e' + idx + ' drives every level that spawns type ' + type; tr.appendChild(td0);
      const tdA = document.createElement('td');
      tdA.textContent = aiLabelFor(true, type); tdA.title = behaviorText(behaviorFor(true, type)); tr.appendChild(tdA);
      const fields = [['hp', st.hp], ['dmg', st.dmg]];
      for (let k = 0; k < fields.length; k++) {
        const td = document.createElement('td');
        if (locked) { td.textContent = fields[k][1]; }
        else {
          const inp = document.createElement('input');
          inp.type = 'number'; inp.min = 0; inp.max = 255; inp.value = fields[k][1];
          inp.style.width = '64px';
          inp.dataset.idx = idx; inp.dataset.f = fields[k][0];
          inp.addEventListener('change', function () { commitTankStat(this.dataset.idx | 0, this.dataset.f, this.value | 0); });
          td.appendChild(inp);
        }
        tr.appendChild(td);
      }
      const tdN = document.createElement('td');
      tdN.textContent = locked ? 'locked: trap type (activation-trap, proven harmful — not editable)' : '';
      tr.appendChild(tdN);
      tbl.appendChild(tr);
    }
    let extraT = '';
    for (let i = 0; i < E.n; i++) if (E.types[i] === BOSS_TYPE) { extraT += ' | boss egg (type 32): HP $80 fixed by its hatch routine, not table-driven'; break; }
    if (noEntryT.length && info) info.textContent += ' | types with no table entry keep stock HP ($20): types ' + noEntryT.join(',');
    if (extraT && info) info.textContent += extraT;
    return;
  }
  if (info) info.textContent = 'HP/damage table (bank 6, CPU $A36A, 30 entries e0-e29): one row per enemy TYPE, shared by every level that spawns it (Jason side-view dungeons, levels 1-8). byte 0 = max HP the enemy spawns with; byte 1 = contact damage it deals.';
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
  const heads = ['type (table entry)', 'AI actor', 'HP = max health (byte 0)', 'dmg = contact damage (byte 1)', ''];
  for (let h = 0; h < heads.length; h++) { const th = document.createElement('th'); th.textContent = heads[h]; hr.appendChild(th); }
  tbl.appendChild(hr);
  for (let r = 0; r < rows.length; r++) {
    const type = rows[r].type, idx = rows[r].idx;
    const locked = INVALID_TYPES.has(type);
    const st = effStat(idx);
    const tr = document.createElement('tr');
    const td0 = document.createElement('td'); td0.textContent = 'type ' + type + ' -> entry e' + idx; td0.title = 'table entry e' + idx + ' drives every level that spawns type ' + type; tr.appendChild(td0);
    const tdA = document.createElement('td');
    tdA.textContent = aiLabelFor(false, type); tdA.title = behaviorText(behaviorFor(false, type)); tr.appendChild(tdA);
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
    tdN.textContent = locked ? 'locked: trap type (activation-trap, proven harmful — not editable)' : (idx === 2 ? 'entry e2 also drives type 1 (shared actor)' : '');
    tr.appendChild(tdN);
    tbl.appendChild(tr);
  }
  if (noEntry.length && info) info.textContent += ' | types with no table entry keep stock HP: types ' + noEntry.join(',');
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
    if (Object.keys(S.edTankStats).length) {
      const tr2 = serializeTankStats(S.resolved.prg[TANK_STAT_BANK], S.edTankStats);
      if (!tr2.ok) throw new Error('serialize tank stats: ' + tr2.errors.join(' '));
      for (const run of diffRuns(S.stock.prg[TANK_STAT_BANK], tr2.bytes)) {
        patches.push(makePatch('prg', TANK_STAT_BANK, run.off, run.bytes));
      }
    }
    if (Object.keys(S.edAreaSongs).length) {
      const ar = serializeAreaSongs(S.resolved.prg[AREA_TABLE.BANK], S.edAreaSongs);
      if (!ar.ok) throw new Error("serialize areaSongs: " + ar.errors.join(" "));
      for (const run of diffRuns(S.stock.prg[AREA_TABLE.BANK], ar.bytes)) {
        patches.push(makePatch("prg", AREA_TABLE.BANK, run.off, run.bytes));
      }
    }
    if (Object.keys(S.edSongPtr).length) {
      const rp = remapSongs(S.resolved.prg[5], S.edSongPtr);
      if (!rp.ok) throw new Error("serialize songPtr: " + rp.errors.join(" "));
      for (const run of diffRuns(S.stock.prg[5], rp.bytes)) {
        patches.push(makePatch("prg", 5, run.off, run.bytes));
      }
    }
    if (Object.keys(S.edTankSongs).length) {
      const tz = serializeTankSongs(S.resolved.prg[4], S.edTankSongs);
      if (!tz.ok) throw new Error('serialize tankSongs: ' + tz.errors.join(' '));
      for (const run of diffRuns(S.stock.prg[4], tz.bytes)) {
        patches.push(makePatch('prg', 4, run.off, run.bytes));
      }
    }
    let sitesDoc = undefined;
    if (Object.keys(S.edSites).length) {
      const sm = sitesMapOf(S.edSites);
      if (!sm.ok) throw new Error('serialize sites: ' + sm.errors.join(' '));
      const sz = serializeSites(S.resolved.prg, S.edSites);
      if (!sz.ok) throw new Error('serialize sites: ' + sz.errors.join(' '));
      for (let bi = 0; bi < sz.banks.length; bi++) {
        const b = sz.banks[bi];
        for (const run of diffRuns(S.stock.prg[b], sz.bytes[b])) {
          patches.push(makePatch('prg', b, run.off, run.bytes));
        }
      }
      sitesDoc = sm.map;
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
    if (sitesDoc) doc.sites = sitesDoc;
    await saveCustomPack(doc);
    S.edited = {};
    S.chr = {};
    S.edEnemies = {};
    S.edStats = {};
    S.edTankStats = {};
    S.edAreaSongs = {};
    S.edSongPtr = {};
    S.edTankSongs = {};
    S.edSites = {};
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
  S.undo = []; S.redo = []; S.painting = false; S.strokeOpen = false;
  updateUndoBtns();
  S.edEnemies = {};
  S.edStats = {};
  S.edTankStats = {};
  S.edTankSongs = {};
  S.edSites = {};
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
  lvl = Math.max(1, Math.min(16, lvl | 0));
  S.level = lvl;
  persistLevel(lvl);
  S.chrBank = BG_CHR_BANK[lvl];
  S.chrTile = 0;
  S.selCell = -1; S.selStruct = -1; S.selCombo = -1; S.selEnemy = -1; S.movingEnemy = null; S.movingBlock = null;
  const badge = el("edModeBadge");
  if (badge) badge.textContent = LEVEL_MODE[lvl];
  const L = cur();
  if (L) {
    const br = el("edBrush");
    if (br) { br.max = effLevel(L).blocks.length / 4 - 1; }
  }
  repaint();
}
export function isEditorOpen() { return S.open; }
export function getEditorLevel() { return S.level; }
export function closeEditor() {
  const ctn = el("editorCtn");
  if (ctn) ctn.hidden = true;
  S.open = false;
}
export async function openEditor(a, opts) {
  api = a || api;
  const ctn = el("editorCtn");
  if (!ctn) return false;
  if (S.open) { ctn.hidden = false; return true; }
  const want = opts && opts.initialLevel >= 1 && opts.initialLevel <= 16
    ? opts.initialLevel : (loadPersistedLevel() || S.level || 1);
  S.level = want;
  try {
    await loadAll();
  } catch (e) {
    const msg = String((e && e.message) || e);
    log("editor: " + msg);
    ctn.hidden = false;
    S.open = false;
    showNoRomNotice("Pick a ROM on the play page first - the editor needs the stock pack to load levels.");
    return false;
  }
  hideNoRomNotice();
  ctn.hidden = false;
  S.open = true;
  fillLevelSel();
  const sel = el("edLevelSel");
  if (sel) sel.onchange = () => selectLevel(sel.value | 0);
  const cv = el("edMap");
  if (cv) {
    cv.onpointerdown = onMapPointerDown;
    cv.onpointermove = onMapPointerMove;
    cv.onpointerup = onMapPointerUp;
    cv.onpointercancel = onMapPointerUp;
    applyToolToMap();
  }
  document.querySelectorAll('input[name="edMode"]').forEach(r => {
    try {
      const lab = r.closest ? r.closest("label") : r.parentNode;
      if (lab && lab.tagName === "LABEL") lab.hidden = true;
    } catch (e) {}
  });
  S.mode = "paint";
  const sc = el("edScrollChk");
  if (sc) sc.onchange = () => { S.showScroll = !!sc.checked; repaint(); };
  const br = el("edBrush");
  if (br) br.onchange = () => { S.brush = Math.max(0, br.value | 0); };
  const sv = el("edSaveBtn");
  if (sv) sv.onclick = saveAsPack;
  const eAdd = el('edEnemyAddBtn');
  if (eAdd) eAdd.onclick = () => addEnemyRec(enemyKeyForLevel(S.level));
  const grid = el("edChrGrid");
  if (grid) { grid.onpointerdown = onChrGridPointerDown; grid.style.touchAction = "none"; }
  const big = el("edChrTile");
  if (big) { big.onpointerdown = onChrTilePointerDown; big.onpointermove = onChrTilePointerMove; big.onpointerup = onChrTilePointerUp; big.style.touchAction = "none"; }
  const cbs = el("edChrBank");
  if (cbs) cbs.onchange = () => { S.chrBank = cbs.value | 0; S.chrTile = 0; repaint(); };
  const sbs = el("edChrSub");
  if (sbs) sbs.onchange = () => { S.chrSub = sbs.value | 0; repaint(); };
  await selectLevel(S.level);
  buildEditorChrome();
  log("editor: open (level " + S.level + ", " + Object.keys(S.parsed).filter(k => k[0] === "b").length + " banks)");
  return true;
}
export async function toggleEditor(a, opts) {
  if (S.open) { closeEditor(); return; }
  await openEditor(a, opts);
}
