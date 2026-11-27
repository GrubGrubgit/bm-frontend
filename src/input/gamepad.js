// src/input/gamepad.js -- Bluetooth/USB pads onto the bus (standard
// mapping + left-stick d-pad with deadzone + hotplug). pollGamepad(nav)
// is pure (takes a navigator-like) so the headless test proves the mapping
// with a fake Gamepad; the rAF loop is just plumbing. Default: A(0)/X(2)
// = NES A, B(1)/Y(3) = NES B, Select(8), Start(9), d-pad 12-15, stick 0.35
// deadzone. Some Android Bluetooth manifests report 8bitdo-style pads
// with A<->B and X<->Y exchanged; opts.swapAB / opts.swapXY un-swap the
// raw indices before the default mapping (both default false = old path).
export const DEFAULT_PADMAP = Object.freeze({ a: [0, 2], b: [1, 3], select: [8], start: [9], up: [12], down: [13], left: [14], right: [15] });
export function pollGamepad(nav, opts) {
  const raw = opts || {};
  const map = (raw.map && typeof raw.map === "object") ? raw.map : DEFAULT_PADMAP;
  const has = function (list) { if (!Array.isArray(list)) return false; for (let k = 0; k < list.length; k++) if (pressed[((list[k] | 0) + 16) % 16]) return true; return false; };
  const swapAB = !!(opts && opts.swapAB);
  const swapXY = !!(opts && opts.swapXY);
  let gps = null;
  try { gps = nav && nav.getGamepads ? nav.getGamepads() : null; }
  catch (e) { return 0; }
  if (!gps) return 0;
  let m = 0;
  const pressed = new Array(16).fill(false);
  const mark = function (i) { i = ((i | 0) + 16) % 16; pressed[i] = true; };
  for (const g of gps) {
    if (!g || g.connected === false) continue;
    const B = (i) => !!(g.buttons && g.buttons[i] && g.buttons[i].pressed);
    let i0 = B(0), i1 = B(1), i2 = B(2), i3 = B(3);
    if (i0) mark(0); if (i1) mark(1); if (i2) mark(2); if (i3) mark(3);
    for (let bi = 4; bi < 16; bi++) if (B(bi)) mark(bi);
    const ax = (i) => (g.axes && g.axes.length > i) ? g.axes[i] : 0;
    if (ax(0) < -0.35) m |= 0x40;
    if (ax(0) > 0.35) m |= 0x80;
    if (ax(1) < -0.35) m |= 0x10;
    if (ax(1) > 0.35) m |= 0x20;
  }
  if (swapAB) { const t0 = pressed[0]; pressed[0] = pressed[1]; pressed[1] = t0; }
  if (swapXY) { const u2 = pressed[2]; pressed[2] = pressed[3]; pressed[3] = u2; }
  if (has(map.a)) m |= 0x01;
  if (has(map.b)) m |= 0x02;
  if (has(map.select)) m |= 0x04;
  if (has(map.start)) m |= 0x08;
  if (has(map.up)) m |= 0x10;
  if (has(map.down)) m |= 0x20;
  if (has(map.left)) m |= 0x40;
  if (has(map.right)) m |= 0x80;
  return m;
}
export function attachGamepad(bus, opts) {
  opts = opts || {};
  const nav = opts.nav || navigator;
  let running = false, raf = 0;
  const tick = () => {
    if (!running) return;
    bus.setSource("gamepad", pollGamepad(nav, opts));
    raf = requestAnimationFrame(tick);
  };
  const onC = () => { if (!running) { running = true; raf = requestAnimationFrame(tick); } };
  const onD = () => { bus.clearSource("gamepad"); };
  window.addEventListener("gamepadconnected", onC);
  window.addEventListener("gamepaddisconnected", onD);
  running = true;
  raf = requestAnimationFrame(tick);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("gamepadconnected", onC);
    window.removeEventListener("gamepaddisconnected", onD);
    bus.clearSource("gamepad");
  };
}
