// src/input/gamepad.js -- Bluetooth/USB pads onto the bus (standard
// mapping + left-stick d-pad with deadzone + hotplug). pollGamepad(nav)
// is pure (takes a navigator-like) so the headless test proves the mapping
// with a fake Gamepad; the rAF loop is just plumbing. A(0)/X(2) = NES A,
// B(1)/Y(3) = NES B, Select(8), Start(9), d-pad 12-15, stick 0.35 deadzone.
const DZ = 0.35;
export function pollGamepad(nav) {
  let gps = null;
  try { gps = nav && nav.getGamepads ? nav.getGamepads() : null; }
  catch (e) { return 0; }
  if (!gps) return 0;
  let m = 0;
  for (const g of gps) {
    if (!g || g.connected === false) continue;
    const B = (i) => !!(g.buttons && g.buttons[i] && g.buttons[i].pressed);
    if (B(0) || B(2)) m |= 0x01;
    if (B(1) || B(3)) m |= 0x02;
    if (B(8)) m |= 0x04;
    if (B(9)) m |= 0x08;
    if (B(12)) m |= 0x10;
    if (B(13)) m |= 0x20;
    if (B(14)) m |= 0x40;
    if (B(15)) m |= 0x80;
    const ax = (i) => (g.axes && g.axes.length > i) ? g.axes[i] : 0;
    if (ax(0) < -DZ) m |= 0x40;
    if (ax(0) > DZ) m |= 0x80;
    if (ax(1) < -DZ) m |= 0x10;
    if (ax(1) > DZ) m |= 0x20;
  }
  return m;
}
export function attachGamepad(bus, opts) {
  opts = opts || {};
  const nav = opts.nav || navigator;
  let running = false, raf = 0;
  const tick = () => {
    if (!running) return;
    bus.setSource("gamepad", pollGamepad(nav));
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
