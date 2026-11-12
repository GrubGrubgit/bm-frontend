// src/ui/shell.js -- thin shell helpers. No game logic, only DOM wiring:
// log view (timestamped, last 200 lines), status-line formatting, pad
// toasts. All controls are plain buttons/selects/inputs owned by index.html.
export function makeLog(logEl) {
  const lines = [];
  return function shellLog(msg) {
    const t = new Date().toISOString().slice(11, 19);
    lines.push("[" + t + "] " + msg);
    if (lines.length > 200) lines.splice(0, lines.length - 200);
    if (logEl) logEl.textContent = lines.join("\n");
    try { console.log("[BM] " + msg); } catch (e) {}
  };
}
export function fmtStatus(s) {
  return "fps " + (s.fps == null ? "-" : Number(s.fps).toFixed(0)) +
    " | frame " + s.engineFrame +
    " | audio " + (s.audio && s.audio.ready ? (s.audio.sampleRate + "Hz") : "locked") +
    " | " + s.scale + "/" + s.filter +
    " | vol " + Math.round(s.volume * 100) + "%" + (s.muted ? " (muted)" : "") +
    " | slot " + s.slot + (s.running ? (s.paused ? " | PAUSED" : " | RUNNING") : " | stopped");
}
export function toast(toastEl, msg, ms) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, ms || 2000);
}
export function wirePadToasts(toastEl, log) {
  window.addEventListener("gamepadconnected", (e) => {
    const id = (e.gamepad && e.gamepad.id || "pad").slice(0, 40);
    toast(toastEl, "pad connected: " + id, 2500);
    if (log) log("pad connected: " + id);
  });
  window.addEventListener("gamepaddisconnected", () => {
    toast(toastEl, "pad disconnected", 2500);
    if (log) log("pad disconnected");
  });
}
