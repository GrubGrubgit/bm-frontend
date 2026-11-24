// src/ui/prefs.js -- shell preferences, persisted in localStorage.
// Scale/filter/volume/muted/slot/engine/pad-swaps survive reload; engine
// saves live in IDB.
const KEY = "bm-prefs-v1";
export const PREF_DEFAULTS = Object.freeze({
  scale: "integer", filter: "nearest", volume: 0.8, muted: false, slot: 1,
  engine: "wasm", swapAB: false, swapXY: false, touch: true,
  pack: "stock",
});
const SCALES = ["integer", "fit", "fill", "stretch"];
const FILTERS = ["nearest", "bilinear"];
const ENGINES = ["wasm", "mesen"];
export function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { p = {}; }
  const out = Object.assign({}, PREF_DEFAULTS, p);
  if (SCALES.indexOf(out.scale) < 0) out.scale = "integer";
  if (FILTERS.indexOf(out.filter) < 0) out.filter = "nearest";
  out.volume = Math.max(0, Math.min(1, Number(out.volume)));
  if (!isFinite(out.volume)) out.volume = 0.8;
  out.muted = !!out.muted;
  out.slot = Math.max(1, Math.min(8, parseInt(out.slot, 10) || 1));
  if (ENGINES.indexOf(out.engine) < 0) out.engine = "wasm";
  if (typeof out.pack !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(out.pack)) out.pack = "stock";
  out.swapAB = !!out.swapAB;
  out.swapXY = !!out.swapXY;
  out.touch = out.touch !== false;
  return out;
}
export function savePrefs(p) {
  const clean = {
    scale: SCALES.indexOf(p.scale) >= 0 ? p.scale : "integer",
    filter: FILTERS.indexOf(p.filter) >= 0 ? p.filter : "nearest",
    volume: Math.max(0, Math.min(1, Number(p.volume) || 0)),
    muted: !!p.muted,
    slot: Math.max(1, Math.min(8, parseInt(p.slot, 10) || 1)),
    engine: ENGINES.indexOf(p.engine) >= 0 ? p.engine : "wasm",
    swapAB: !!p.swapAB,
    swapXY: !!p.swapXY,
    touch: p.touch !== false,
    pack: (typeof p.pack === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(p.pack)) ? p.pack : "stock",
  };
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch (e) {}
  return clean;
}

// ---- E4 settings sync: shell prefs as a sync wrapper over the engine core ----
// Canonical store lives in the engine (bm_api.c E2/E4-core): volume 0-10,
// mute 0/1, scale 0-3 INTEGER/FIT/FILL/STRETCH, filter 0/1 NEAREST/BILINEAR,
// with bm_setting_get/set exports. prefs.js persists to localStorage and
// pushes into the engine on spawn; the per-frame shell tick pulls in-game
// menu edits back out. Shell controls ALWAYS work (never gated on enhanced
// mode); the in-game settings menu requires enhancements on (engine gate).
// Engine/slot/pad-swap/pack/touch stay frontend-owned and never enter the core.
export const SCALE_ORDER = Object.freeze(["integer", "fit", "fill", "stretch"]);
export const FILTER_ORDER = Object.freeze(["nearest", "bilinear"]);
export function prefsToSettings(q) {
  const raw = Number(q.volume) * 10;
  const vol = Math.max(0, Math.min(10, Math.round(raw)));
  const mute = q.muted ? 1 : 0;
  let sc = SCALE_ORDER.indexOf(q.scale); if (sc < 0) sc = 0;
  let fi = FILTER_ORDER.indexOf(q.filter); if (fi < 0) fi = 0;
  return { volume: isFinite(vol) ? vol : 8, mute: mute, scale: sc, filter: fi };
}
export function settingsToPrefs(v, m, s, f) {
  let vv = Math.max(0, Math.min(10, parseInt(v, 10))); if (!isFinite(vv)) vv = 8;
  let ss = Math.max(0, Math.min(3, parseInt(s, 10))); if (!isFinite(ss)) ss = 0;
  let ff = parseInt(f, 10) ? 1 : 0; if (!isFinite(ff)) ff = 0;
  return { volume: vv / 10, muted: !!m, scale: SCALE_ORDER[ss], filter: ff ? "bilinear" : "nearest" };
}
export function pushPrefsToEngine(ex, q) {
  if (!ex || typeof ex.bm_setting_set !== "function") return false;
  const s = prefsToSettings(q);
  ex.bm_setting_set(0, s.volume); ex.bm_setting_set(1, s.mute);
  ex.bm_setting_set(2, s.scale); ex.bm_setting_set(3, s.filter);
  return true;
}
export function pullEngineToPrefs(ex, q) {
  if (!ex || typeof ex.bm_setting_get !== "function") return false;
  const v = ex.bm_setting_get(0), m = ex.bm_setting_get(1);
  const s = ex.bm_setting_get(2), f = ex.bm_setting_get(3);
  if (typeof v !== "number" || typeof m !== "number" || typeof s !== "number" || typeof f !== "number") return false;
  const want = settingsToPrefs(v, m, s, f);
  let ch = false;
  if (Math.round(Number(q.volume) * 10) !== Math.round(want.volume * 10)) { q.volume = want.volume; ch = true; }
  if (!!q.muted !== want.muted) { q.muted = want.muted; ch = true; }
  if (q.scale !== want.scale) { q.scale = want.scale; ch = true; }
  if (q.filter !== want.filter) { q.filter = want.filter; ch = true; }
  return ch;
}
