// src/ui/report.js -- one-tap bug reports: deterministic movie + full RAM
// snap + shell log tail + trap name (wasm port). Everything needed to
// reproduce and name a crash, with zero manual steps from the player:
// traps auto-save on first hit, freezes save on Report tap.
import { makeMovieV2, downloadJson } from "../input/movie.js";
function b64bytes(u8) {
  var s = "";
  for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(s);
}
// One-line human-readable trap banner for the shell log + status line.
// Unmapped-vector traps carry the faulting address in val; named stubs carry
// the code location in name (val 0). Never empty: there is always something
// to show, which is the whole point (no more silent unreachable).
export function formatTrapBanner(ti, frame, engine) {
  var nm = ti && ti.name ? String(ti.name) : "unmapped-vector";
  var vv = ti && typeof ti.val === "number" ? ti.val : 0;
  var hex = ("0000" + (vv & 0xFFFF).toString(16)).slice(-4).toUpperCase();
  return "TRAP " + nm + " val=$" + hex + " f=" + frame + " engine=" + engine;
}
export async function buildBugReport(host, engineName, getCrc, tail, why, packTag) {
  var pads = host.padLog.slice(0, host.frame());
  var crc = "unknown";
  try { var id = await getCrc(); if (id && id.crc32) crc = id.crc32; } catch (e) {}
  var pt = packTag || {};
  var pk = pt.pack != null ? pt.pack : (pt.id != null ? pt.id : "unknown");
  var pc = pt.packCrc != null ? pt.packCrc : (pt.crc != null ? pt.crc : "unknown");
  var m = makeMovieV2(pads, crc, { start: 0, anchorHash: null, engine: engineName || "unknown", pack: pk, packCrc: pc });
  var snapB64 = "";
  try {
    var ex = host.inst && host.inst.exports;
    if (ex && ex.bm_snap) {
      ex.bm_snap();
      var mem = new Uint8Array(ex.memory.buffer);
      snapB64 = b64bytes(mem.slice(ex.bm_stage_ptr(), ex.bm_stage_ptr() + 4160));
    }
  } catch (e2) {}
  var trap = null;
  try { trap = host.trapInfo ? host.trapInfo() : null; } catch (e3) {}
  var wwwv = "";
  try { var r = await fetch("PACKAGING.json"); if (r.ok) wwwv = (await r.json()).version || ""; } catch (e4) {}
  return { app: "bm-bugreport", v: 1, www: wwwv, engine: engineName || "wasm", frame: host.frame(), why: why, trap: trap, rom: crc, pack: m.pack, packCrc: m.packCrc, movie: m, snap: snapB64, log: tail.slice(-60) };
}
export async function saveBugReport(r, fname) { return downloadJson(r, fname); }
export async function autoTrapReport(host, engineName, getCrc, tail, log, packTag) {
  var ti = null;
  try { ti = host.trapInfo ? host.trapInfo() : null; } catch (e) {}
  if (!ti) return;
  var key = host.frame() + ":" + ti.name + ":" + ti.val;
  if (typeof window !== "undefined" && window.__bmLastTrapKey === key) return;
  if (typeof window !== "undefined") window.__bmLastTrapKey = key;
  try {
    var r = await buildBugReport(host, engineName, getCrc, tail, "auto-trap", packTag);
    var dl = await saveBugReport(r, "bmbug-f" + r.frame + "-" + (ti.name || "trap") + ".json");
    log("bugreport f=" + r.frame + " trap=" + (ti.name || "?") + " val=" + ti.val + " via " + dl.via);
  } catch (e2) { log("bugreport err " + String((e2 && e2.message) || e2).slice(0, 80)); }
}
// Same as autoTrapReport but for faults where trapInfo() is null (wasm
// RuntimeError without trap_flag, go-stall, boot-returned, replay guard).
// Previously these froze with only "step err ..." and no bmbug, no popup.
export async function autoFaultReport(host, engineName, getCrc, tail, log, errMsg, packTag) {
  try {
    var r = await buildBugReport(host, engineName, getCrc, tail, "auto-fault: " + String(errMsg || "?").slice(0, 120), packTag);
    var dl = await saveBugReport(r, "bmbug-f" + r.frame + "-fault.json");
    log("bugreport f=" + r.frame + " fault=" + String(errMsg || "?").slice(0, 60) + " via " + dl.via);
  } catch (e2) { log("bugreport err " + String((e2 && e2.message) || e2).slice(0, 80)); }
}
export async function manualBugReport(host, engineName, getCrc, tail, log, packTag) {
  var r = await buildBugReport(host, engineName, getCrc, tail, "manual", packTag);
  var dl = await saveBugReport(r, "bmbug-f" + r.frame + "-manual.json");
  log("bugreport f=" + r.frame + " via " + dl.via + " -> Downloads/bmbug-f" + r.frame + "-manual.json");
  return r;
}
