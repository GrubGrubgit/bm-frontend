// src/ui/prefs.js -- shell preferences, persisted in localStorage.
// Scale/filter/volume/muted/slot survive reload; engine saves live in IDB.
const KEY = "bm-prefs-v1";
export const PREF_DEFAULTS = Object.freeze({
  scale: "integer", filter: "nearest", volume: 0.8, muted: false, slot: 1,
});
const SCALES = ["integer", "fit", "fill", "stretch"];
const FILTERS = ["nearest", "bilinear"];
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
  return out;
}
export function savePrefs(p) {
  const clean = {
    scale: SCALES.indexOf(p.scale) >= 0 ? p.scale : "integer",
    filter: FILTERS.indexOf(p.filter) >= 0 ? p.filter : "nearest",
    volume: Math.max(0, Math.min(1, Number(p.volume) || 0)),
    muted: !!p.muted,
    slot: Math.max(1, Math.min(8, parseInt(p.slot, 10) || 1)),
  };
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch (e) {}
  return clean;
}
