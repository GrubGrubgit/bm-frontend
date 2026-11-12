// src/input/touch.js -- thumb controls onto the bus. Fixed bottom overlay
// that always fits the viewport width: sliding cross d-pad (left), small
// Select/Start (center), big B/A (right). The cross is ONE pointer surface:
// press-and-slide rolls across directions without lifting (8-way, diagonals
// allowed), tracked by a single active pointerId so B/A multitouch
// (run+jump) keeps working. A nub follows the thumb; the pad brightens
// while held. Short guarded vibrate on direction change where supported.
// Headless drives pointerdown/move/up with clientX/Y coords.
const DEAD = 0.28;
function buzz(m) {
  try {
    if (m && typeof navigator.vibrate === "function") navigator.vibrate(8);
  } catch (err) {}
}
export function mountTouch(bus, parent) {
  const root = document.createElement("div");
  root.id = "touchPad";
  root.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:30;" +
    "display:flex;justify-content:space-between;align-items:flex-end;" +
    "gap:min(2vw,10px);padding:10px 10px calc(10px + env(safe-area-inset-bottom));" +
    "pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;";
  const face = "color:#eee;background:rgba(60,60,70,0.55);border:2px solid rgba(200,200,210,0.6);";
  const mkBtn = (label, bit, w, h, round, fs) => {
    const el = document.createElement("div");
    el.textContent = label;
    el.setAttribute("data-bit", String(bit));
    el.style.cssText = "pointer-events:auto;touch-action:none;flex:0 1 auto;" +
      "width:" + w + ";height:" + h + ";display:flex;align-items:center;justify-content:center;" +
      "font:bold " + fs + " monospace;" + face + "border-radius:" + round + ";";
    return el;
  };
  // ---- sliding cross pad (single surface) ----
  const pad = document.createElement("div");
  pad.setAttribute("data-pad", "cross");
  pad.style.cssText = "pointer-events:auto;touch-action:none;flex:0 1 auto;" +
    "position:relative;width:min(38vw,190px);aspect-ratio:1/1;" + face + "border-radius:18px;";
  const barH = document.createElement("div");
  barH.style.cssText = "position:absolute;left:4px;right:4px;top:33%;bottom:33%;" +
    "background:rgba(200,200,210,0.18);border-radius:10px;pointer-events:none;";
  const barV = document.createElement("div");
  barV.style.cssText = "position:absolute;top:4px;bottom:4px;left:33%;right:33%;" +
    "background:rgba(200,200,210,0.18);border-radius:10px;pointer-events:none;";
  const nub = document.createElement("div");
  nub.style.cssText = "position:absolute;left:35%;top:35%;width:30%;height:30%;border-radius:50%;" +
    "background:rgba(230,230,240,0.75);pointer-events:none;";
  pad.appendChild(barH);
  pad.appendChild(barV);
  pad.appendChild(nub);
  let crossMask = 0;
  let activeId = null;
  const held = new Map();
  const recompute = () => {
    let m = crossMask;
    held.forEach((ids, bit) => { if (ids.size > 0) m |= bit; });
    bus.setSource("touch", m);
  };
  const moveNub = (dx, dy, w) => {
    const cell = w / 3;
    nub.style.transform = "translate(" + (dx * cell).toFixed(1) + "px," + (dy * cell).toFixed(1) + "px)";
  };
  const crossFromEvent = (e) => {
    const r = pad.getBoundingClientRect();
    const hw = r.width / 2, hh = r.height / 2;
    if (hw <= 0 || hh <= 0) return 0;
    let dx = (e.clientX - (r.left + hw)) / hw;
    let dy = (e.clientY - (r.top + hh)) / hh;
    if (dx > 1) dx = 1; else if (dx < -1) dx = -1;
    if (dy > 1) dy = 1; else if (dy < -1) dy = -1;
    let m = 0;
    if (dx > DEAD) m |= 128; else if (dx < -DEAD) m |= 64;
    if (dy > DEAD) m |= 32; else if (dy < -DEAD) m |= 16;
    moveNub(dx, dy, r.width);
    pad.style.filter = m ? "brightness(1.35)" : "";
    return m;
  };
  pad.addEventListener("pointerdown", (e) => {
    if (activeId !== null) return;
    e.preventDefault();
    activeId = e.pointerId;
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    crossMask = crossFromEvent(e);
    buzz(crossMask);
    recompute();
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    const m = crossFromEvent(e);
    if (m !== crossMask) { crossMask = m; buzz(m); recompute(); }
  });
  const endCross = (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    crossMask = 0;
    nub.style.transform = "";
    pad.style.filter = "";
    recompute();
  };
  pad.addEventListener("pointerup", endCross);
  pad.addEventListener("pointercancel", endCross);
  pad.addEventListener("contextmenu", (e) => e.preventDefault());
  // ---- discrete face buttons ----
  const els = {};
  const defs = [
    ["select", "SEL", 4, "min(13vw,54px)", "40px", "12px", "12px"],
    ["start", "STA", 8, "min(13vw,54px)", "40px", "12px", "12px"],
    ["b", "B", 2, "min(17vw,74px)", "min(17vw,74px)", "50%", "22px"],
    ["a", "A", 1, "min(17vw,74px)", "min(17vw,74px)", "50%", "22px"]
  ];
  const mid = document.createElement("div");
  mid.style.cssText = "display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;";
  const right = document.createElement("div");
  right.style.cssText = "display:flex;gap:min(2vw,10px);align-items:flex-end;pointer-events:none;";
  for (const d of defs) {
    const el = mkBtn(d[1], d[2], d[3], d[4], d[5], d[6]);
    els[d[0]] = el;
    held.set(d[2], new Set());
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      held.get(d[2]).add(e.pointerId);
      recompute();
    });
    const release = (e) => {
      const s = held.get(d[2]);
      if (s.delete(e.pointerId)) recompute();
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    if (d[0] === "select" || d[0] === "start") mid.appendChild(el);
    else right.appendChild(el);
  }
  root.appendChild(pad);
  root.appendChild(mid);
  root.appendChild(right);
  (parent || document.body).appendChild(root);
  return {
    root: root,
    pad: pad,
    buttons: els,
    unmount: () => { root.remove(); bus.clearSource("touch"); }
  };
}
