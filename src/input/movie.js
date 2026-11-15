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
export function parseMovie(o) {
  if (!o || o.app !== "bm-movie" || o.v !== 1) throw new Error("movie-format");
  const pads = decodePads(o.pads);
  if (pads.length !== o.frame) throw new Error("movie-length");
  if (pads.length === 0) throw new Error("movie-empty");
  return { pads: pads, frame: o.frame, rom: String(o.rom) };
}
export function downloadMovie(movie, fname) {
  const name = fname || ("bmmovie-f" + movie.frame + ".json");
  const text = JSON.stringify(movie);
  try {
    if (window.BMApk && typeof window.BMApk.saveMovie === "function") {
      window.BMApk.saveMovie(name, "data:application/json;base64," + btoa(text));
      return { frame: movie.frame, via: "apk" };
    }
  } catch (e) { /* fall through to anchor download */ }
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return { frame: movie.frame, via: "browser" };
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
  try {
    if (window.BMApk && typeof window.BMApk.saveMovie === "function") {
      window.BMApk.saveMovie(fname, "data:application/json;base64," + btoa(text));
      return { fname: fname, via: "apk" };
    }
  } catch (e) {}
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return { fname: fname, via: "browser" };
}
