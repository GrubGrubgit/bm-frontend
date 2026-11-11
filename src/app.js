// L0 shell skeleton: wiring only. Exposes window.BM for users + headless.
const bootMs = Date.now();
let frames = 0;
const errors = [];
addEventListener("error", e => errors.push(String(e.message || e.error)));
addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
const statusEl = document.getElementById("statusEl");
function tick() { frames++; if (statusEl && frames % 30 === 0) statusEl.textContent = "ok f=" + frames; requestAnimationFrame(tick); }
requestAnimationFrame(tick);
window.BM = {
  stats() { return { ok: errors.length === 0, frames, errors: errors.slice(), upMs: Date.now() - bootMs }; }
};
if (new URLSearchParams(location.search).has("headless")) { document.title = "BM-HEADLESS-READY"; }
