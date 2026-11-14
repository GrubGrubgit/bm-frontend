// src/input/gamepad.js -- Bluetooth/USB pads onto the bus (standard
// mapping + left-stick d-pad with deadzone + hotplug). pollGamepad(nav)
// is pure (takes a navigator-like) so the headless test proves the mapping
// with a fake Gamepad; the rAF loop is just plumbing. Default: A(0)/X(2)
// = NES A, B(1)/Y(3) = NES B, Select(8), Start(9), d-pad 12-15, stick 0.35
// deadzone. Some Android Bluetooth manifests report 8bitdo-style pads
// with A<->B and X<->Y exchanged; opts.swapAB / opts.swapXY un-swap the
// raw indices before the default mapping (both default false = old path).
export function pollGamepad(nav, opts) {
  const swapAB = !!(opts && opts.swapAB);
  const swapXY = !!(opts && opts.swapXY);
  let gps = null;
  try { gps = nav && nav.getGamepads ? nav.getGamepads() : null; }
  catch (e) { return 0; }
  if (!gps) return 0;
  let m = 0;
  for (const g of gps) {
    if (!g || g.connected === false) continue;
    const B = (i) => !!(g.buttons && g.buttons[i] && g.buttons[i].pressed);
    let i0 = B(0), i1 = B(1), i2 = B(2), i3 = B(3);
    if (swapAB) { const t = i0; i0 = i1; i1 = t; }
    if (swapXY) { const t = i2; i2 = i3; i3 = t; }
    if (i0 || i2) m |= 0x01;
    if (i1 || i3) m |= 0x02;
    if (B(8)) m |= 0x04;
    if (B(9)) m |= 0x08;
    if (B(12)) m |= 0x10;
    if (B(13)) m |= 0x20;
    if (B(14)) m |= 0x40;
    if (B(15)) m |= 0x80;
    const ax = (i) => (g.axes && g.axes.length > i) ? g.axes[i] : 0;
    if (ax(0) < -0.35) m |= 0x40;
    if (ax(0) > 0.35) m |= 0x80;
    if (ax(1) < -0.35) m |= 0x10;
    if (ax(1) > 0.35) m |= 0x20;
  }
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
