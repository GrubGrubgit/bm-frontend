// src/input/touch.js -- thumb controls onto the bus. Fixed bottom overlay
// (d-pad left, Select/Start center, B/A right) with >=56px targets that
// works in portrait and landscape; L6 skins it, L5 proves it. Multitouch:
// each button tracks its own pointerIds, so run+jump (Right+A held by two
// thumbs) is one combined mask. Pointer Events unify mouse/touch; the
// headless test drives the same handlers with synthetic PointerEvents.
const BTNS = [
  { id: "up", label: "\u25B2", bit: 16 },
  { id: "down", label: "\u25BC", bit: 32 },
  { id: "left", label: "\u25C0", bit: 64 },
  { id: "right", label: "\u25B6", bit: 128 },
  { id: "select", label: "SEL", bit: 4 },
  { id: "start", label: "STA", bit: 8 },
  { id: "b", label: "B", bit: 2 },
  { id: "a", label: "A", bit: 1 }
];
export function mountTouch(bus, parent) {
  const root = document.createElement("div");
  root.id = "touchPad";
  root.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:30;" +
    "display:flex;justify-content:space-between;align-items:flex-end;" +
    "padding:10px 12px calc(10px + env(safe-area-inset-bottom));" +
    "pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;";
  const mkGroup = () => {
    const g = document.createElement("div");
    g.style.cssText = "display:flex;gap:10px;align-items:flex-end;pointer-events:none;";
    return g;
  };
  const mkBtn = (label, bit) => {
    const el = document.createElement("div");
    el.textContent = label;
    el.setAttribute("data-bit", String(bit));
    el.style.cssText = "pointer-events:auto;touch-action:none;min-width:56px;min-height:56px;" +
      "display:flex;align-items:center;justify-content:center;font:bold 20px monospace;" +
      "color:#eee;background:rgba(60,60,70,0.55);border:2px solid rgba(200,200,210,0.6);" +
      "border-radius:12px;";
    return el;
  };
  const held = new Map();
  const recompute = () => {
    let m = 0;
    held.forEach((ids, bit) => { if (ids.size > 0) m |= bit; });
    bus.setSource("touch", m);
  };
  const els = {};
  const groups = [mkGroup(), mkGroup(), mkGroup()];
  groups[0].style.display = "grid";
  groups[0].style.gridTemplateColumns = "repeat(3, auto)";
  const spacer = () => {
    const d = document.createElement("div");
    d.style.cssText = "min-width:56px;min-height:56px;visibility:hidden;";
    return d;
  };
  const place = { select: 1, start: 1, b: 2, a: 2 };
  const byId = {};
  for (const b of BTNS) {
    const el = mkBtn(b.label, b.bit);
    els[b.id] = el;
    byId[b.id] = el;
    held.set(b.bit, new Set());
    if (place[b.id] !== undefined) groups[place[b.id]].appendChild(el);
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      held.get(b.bit).add(e.pointerId);
      recompute();
    });
    const release = (e) => {
      const s = held.get(b.bit);
      if (s.delete(e.pointerId)) recompute();
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  groups[0].appendChild(spacer());
  groups[0].appendChild(byId.up);
  groups[0].appendChild(spacer());
  groups[0].appendChild(byId.left);
  groups[0].appendChild(spacer());
  groups[0].appendChild(byId.right);
  groups[0].appendChild(spacer());
  groups[0].appendChild(byId.down);
  groups[0].appendChild(spacer());
  for (const g of groups) root.appendChild(g);
  (parent || document.body).appendChild(root);
  return {
    root: root,
    buttons: els,
    unmount: () => { root.remove(); bus.clearSource("touch"); }
  };
}
