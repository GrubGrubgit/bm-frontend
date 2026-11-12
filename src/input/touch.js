// src/input/touch.js -- real cross d-pad + round B/A + compact SEL/STA.
// Same shape as the ffvport SNES pad: four discrete direction buttons fused
// into a 3x3 cross around a pivot nub, thumb-roll across buttons via
// elementFromPoint hit-testing, per-pointerId tracking so run+jump (hold A
// on one thumb while rolling the cross with the other) is one mask,
// .pressed highlight on the held button, guarded vibrate on trusted
// (real-thumb) gestures only. Sizes are vw-capped so the row always fits.
export function mountTouch(bus, parent) {
  const st = document.createElement("style");
  st.textContent = "#touchPad .tBtn.pressed{background:rgba(200,200,80,0.75);}";
  document.head.appendChild(st);
  const root = document.createElement("div");
  root.id = "touchPad";
  root.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:30;" +
    "display:flex;justify-content:space-between;align-items:flex-end;" +
    "gap:min(2vw,10px);padding:8px 10px calc(8px + env(safe-area-inset-bottom));" +
    "pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;";
  const CELL = "min(15vw,60px)";
  const face = "pointer-events:auto;touch-action:none;box-sizing:border-box;" +
    "border:2px solid rgba(200,200,210,0.6);background:rgba(60,60,70,0.55);" +
    "color:#eee;-webkit-tap-highlight-color:transparent;padding:0;";
  const mkBtn = (name, label, bit, css) => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.className = "tBtn";
    el.setAttribute("data-btn", name);
    el.setAttribute("data-bit", String(bit));
    el.style.cssText = face + css;
    return el;
  };
  // ---- cross d-pad (3x3 fused grid) ----
  const dir = document.createElement("div");
  dir.id = "tDir";
  dir.style.cssText = "display:grid;grid-template-columns:" + CELL + " " + CELL + " " + CELL + ";" +
    "grid-template-rows:" + CELL + " " + CELL + " " + CELL + ";pointer-events:none;";
  const spacer = () => {
    const d = document.createElement("div");
    d.style.cssText = "pointer-events:none;";
    return d;
  };
  const dbtn = "width:" + CELL + ";height:" + CELL + ";margin:-0.5px;font:bold 20px monospace;";
  const dirs = {};
  dirs.up = mkBtn("up", "\u25B2", 16, dbtn + "border-radius:12px 12px 0 0;");
  dirs.left = mkBtn("left", "\u25C0", 64, dbtn + "border-radius:12px 0 0 12px;");
  dirs.right = mkBtn("right", "\u25B6", 128, dbtn + "border-radius:0 12px 12px 0;");
  dirs.down = mkBtn("down", "\u25BC", 32, dbtn + "border-radius:0 0 12px 12px;");
  const pivot = document.createElement("div");
  pivot.style.cssText = "width:" + CELL + ";height:" + CELL + ";margin:-0.5px;position:relative;" +
    "background:rgba(60,60,70,0.9);border:2px solid rgba(200,200,210,0.6);box-sizing:border-box;" +
    "pointer-events:auto;";
  const nub = document.createElement("div");
  nub.style.cssText = "position:absolute;left:50%;top:50%;width:36%;height:36%;" +
    "transform:translate(-50%,-50%);border-radius:50%;background:rgba(160,160,160,0.5);" +
    "pointer-events:none;";
  pivot.appendChild(nub);
  dir.appendChild(spacer()); dir.appendChild(dirs.up); dir.appendChild(spacer());
  dir.appendChild(dirs.left); dir.appendChild(pivot); dir.appendChild(dirs.right);
  dir.appendChild(spacer()); dir.appendChild(dirs.down); dir.appendChild(spacer());
  // ---- SEL/STA column + round B/A ----
  const mid = document.createElement("div");
  mid.style.cssText = "display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;flex:none;";
  const right = document.createElement("div");
  right.style.cssText = "display:flex;gap:10px;align-items:flex-end;pointer-events:none;flex:none;";
  const BTN = "min(17vw,74px)";
  const els = {};
  const defs = [
    ["select", "SEL", 4, "width:min(13vw,54px);height:40px;border-radius:20px;font:bold 12px monospace;", mid],
    ["start", "STA", 8, "width:min(13vw,54px);height:40px;border-radius:20px;font:bold 12px monospace;", mid],
    ["b", "B", 2, "width:" + BTN + ";height:" + BTN + ";border-radius:50%;font:bold 22px monospace;", right],
    ["a", "A", 1, "width:" + BTN + ";height:" + BTN + ";border-radius:50%;font:bold 22px monospace;", right]
  ];
  const bits = { up: 16, down: 32, left: 64, right: 128, select: 4, start: 8, b: 2, a: 1 };
  for (const d of defs) {
    const el = mkBtn(d[0], d[1], d[2], d[3]);
    el.setAttribute("data-btn", d[0]);
    els[d[0]] = el;
    d[4].appendChild(el);
  }
  for (const k of ["up", "down", "left", "right"]) els[k] = dirs[k];
  root.appendChild(dir);
  root.appendChild(mid);
  root.appendChild(right);
  (parent || document.body).appendChild(root);
  const byPointer = new Map();
  const buzz = (m, e) => {
    try {
      if (m && (!e || e.isTrusted) && typeof navigator.vibrate === "function") navigator.vibrate(8);
    } catch (err) {}
  };
  const recompute = () => {
    let m = 0;
    byPointer.forEach((name) => { m |= bits[name] || 0; });
    bus.setSource("touch", m);
  };
  const press = (btn, on) => {
    const el = els[btn];
    if (!el) return;
    try { el.classList.toggle("pressed", on); } catch (err) {}
  };
  const btnFromPoint = (x, y) => {
    try {
      const el = document.elementFromPoint(x, y);
      const b = el && el.closest ? el.closest("[data-btn]") : null;
      return b && root.contains(b) ? b.getAttribute("data-btn") : null;
    } catch (err) { return null; }
  };
  const start = (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-btn]") : null;
    if (!t || !root.contains(t)) return;
    e.preventDefault();
    const name = t.getAttribute("data-btn");
    const prev = byPointer.get(e.pointerId);
    if (prev !== undefined && prev !== name) press(prev, false);
    byPointer.set(e.pointerId, name);
    press(name, true);
    buzz(1, e);
    recompute();
    try { t.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const move = (e) => {
    if (!byPointer.has(e.pointerId)) return;
    if (e.cancelable) e.preventDefault();
    const under = btnFromPoint(e.clientX, e.clientY);
    if (under && under !== byPointer.get(e.pointerId)) {
      press(byPointer.get(e.pointerId), false);
      byPointer.set(e.pointerId, under);
      press(under, true);
      buzz(1, e);
      recompute();
    }
  };
  const end = (e) => {
    const cur = byPointer.get(e.pointerId);
    if (cur === undefined) return;
    press(cur, false);
    byPointer.delete(e.pointerId);
    recompute();
  };
  root.addEventListener("pointerdown", start);
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
  root.addEventListener("lostpointercapture", end);
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  return {
    root: root,
    pad: dir,
    dirs: dirs,
    buttons: els,
    unmount: () => {
      root.removeEventListener("pointerdown", start);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", end);
      root.removeEventListener("pointercancel", end);
      root.removeEventListener("lostpointercapture", end);
      st.remove();
      root.remove();
      bus.clearSource("touch");
    }
  };
}
