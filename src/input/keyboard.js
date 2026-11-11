// src/input/keyboard.js -- desktop dev keys onto the bus (SPEC: keyboard
// is dev convenience; touch/Bluetooth are first-class). Arrows + WASD for
// the d-pad, X = A, Z = B, Enter = Start, either Shift = Select. Repeat
// events are ignored; blur clears (no stuck keys); game keys never scroll.
const KEYMAP = {
  ArrowUp: 0x10, ArrowDown: 0x20, ArrowLeft: 0x40, ArrowRight: 0x80,
  KeyW: 0x10, KeyS: 0x20, KeyA: 0x40, KeyD: 0x80,
  KeyX: 0x01, KeyZ: 0x02, Enter: 0x08, ShiftLeft: 0x04, ShiftRight: 0x04
};
export function attachKeyboard(bus) {
  const down = new Set();
  const recompute = () => {
    let m = 0;
    down.forEach((c) => { m |= KEYMAP[c] || 0; });
    bus.setSource("keyboard", m);
  };
  const kd = (e) => {
    if (KEYMAP[e.code] === undefined) return;
    if (!e.repeat) { down.add(e.code); recompute(); }
    e.preventDefault();
  };
  const ku = (e) => { if (down.delete(e.code)) recompute(); };
  const blur = () => { if (down.size > 0) { down.clear(); recompute(); } };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    window.removeEventListener("blur", blur);
    bus.clearSource("keyboard");
  };
}
