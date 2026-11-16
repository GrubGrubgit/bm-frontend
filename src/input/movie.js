// src/input/movie.js -- input movies: record / share / replay.
//
// Recording is free: GameHost.padLog already stores one NES pad byte per
// consumed edge. A movie = {app,v,rom,frame,pads} with pads as base64 of
// the raw bytes (1/frame; ~3.6KB per minute, trivial to share as a file).
// Replay = fresh spawn + fast-forward (deterministic: same proof as
// save/load in L2/L6 self-tests). Movies replay across engines with
// the same bit order (bit i = button bit i).
export function encodePads(pads) {
  const b = pads instanceof Uint8Array ? pads : Uint8Array.from(pads);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] & 255);
  return btoa(s);
}
export function decodePads(b64) {
  const s = atob(String(b64));
  const o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255;
  return o;
}
export function makeMovie(pads, romCrc) {
  const b = pads instanceof Uint8Array ? pads : Uint8Array.from(pads);
  return { app: "bm-movie", v: 1, rom: String(romCrc), frame: b.length, pads: encodePads(b) };
}
export function makeMovieV2(pads, romCrc, opts) {
  const b = pads instanceof Uint8Array ? pads : Uint8Array.from(pads);
  const o = opts || {};
  const start = Math.max(0, Math.min(b.length, o.start | 0));
  return {
    app: "bm-movie", v: 2, rom: String(romCrc), frame: b.length, start: start,
    anchorHash: o.anchorHash != null ? String(o.anchorHash) : null,
    engine: o.engine || "unknown", pads: encodePads(b)
  };
}
export function parseMovie(o) {
  if (!o || o.app !== "bm-movie") throw new Error("movie-format");
  const pads = decodePads(o.pads);
  if (pads.length !== o.frame) throw new Error("movie-length");
  if (pads.length === 0) throw new Error("movie-empty");
  if (o.v !== 1 && o.v !== 2) throw new Error("movie-format");
  const start = o.v === 2 ? Math.max(0, Math.min(pads.length, o.start | 0)) : 0;
  return {
    pads: pads, frame: o.frame, rom: String(o.rom),
    version: o.v, start: start,
    anchorHash: o.v === 2 && o.anchorHash != null ? String(o.anchorHash) : null,
    engine: o.v === 2 ? String(o.engine || "unknown") : "unknown"
  };
}
// APK bridge: BMApk.saveMovie returns a status string ("saved ..." or
// "FAILED: ..."). Returns null when no bridge exists. In an app context
// (Cordova/file) without the bridge, anchor downloads are silently dropped
// by the WebView, so report FAILED instead of lying about success.
function apkHasBridge() {
  try { return !!(window.BMApk && (typeof window.BMApk.saveFile === "function" || typeof window.BMApk.saveMovie === "function")); }
  catch (e) { return false; }
}
function apkSaveDataUrl(name, mime, dataUrl) {
  try {
    if (window.BMApk && typeof window.BMApk.saveFile === "function")
      return "apk:" + String(window.BMApk.saveFile(name, mime, dataUrl));
    if (String(mime).indexOf("json") >= 0 && window.BMApk && typeof window.BMApk.saveMovie === "function")
      return "apk:" + String(window.BMApk.saveMovie(name, dataUrl));
  } catch (e) { return "apk-error:" + String((e && e.message) || e).slice(0, 60); }
  return null;
}
function apkSave(name, text) {
  var r = apkSaveDataUrl(name, "application/json", "data:application/json;base64," + btoa(text));
  if (r !== null) return r;
  try {
    if (apkHasBridge()) return "apk-error:no-save-method";
  } catch (e) {}
  if ((typeof window.cordova !== "undefined") || location.protocol === "file:") return "FAILED-no-bridge";
  return null;
}
function anchorDownload(dataUrl, name) {
  var a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { a.remove(); }, 2000);
  return { fname: name, via: "browser" };
}
export function downloadMovie(movie, fname) {
  const name = fname || ("bmmovie-f" + movie.frame + ".json");
  const text = JSON.stringify(movie);
  const apkr = apkSave(name, text);
  if (apkr !== null) return { frame: movie.frame, via: apkr };
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  anchorDownload(url, name);
  return { frame: movie.frame, via: "browser" };
}
export function downloadPng(dataUrl, fname) {
  const name = fname || "bmshot.png";
  const apkr = apkSaveDataUrl(name, "image/png", dataUrl);
  if (apkr !== null) return { fname: name, via: apkr };
  if ((typeof window.cordova !== "undefined") || (typeof location !== "undefined" && location.protocol === "file:")) return { fname: name, via: "FAILED-no-bridge" };
  return anchorDownload(dataUrl, name);
}
export async function replayMovie(host, pads, onProgress) {
  await host.reset();
  let i = 0;
  while (i < pads.length) {
    const q = pads[i];
    let j = i + 1;
    while (j < pads.length && pads[j] === q && (j - i) < 600) j++;
    await host.go(j - i, q);
    i = j;
    if (onProgress) onProgress(i, pads.length);
  }
  return host.frame();
}
export function downloadJson(obj, fname) {
  const text = JSON.stringify(obj);
  const apkr = apkSave(fname, text);
  if (apkr !== null) return { fname: fname, via: apkr };
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return { fname: fname, via: "browser" };
}
