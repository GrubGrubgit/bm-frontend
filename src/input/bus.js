// src/input/bus.js -- ONE virtual-pad bus (SPEC section 6 src/input).
// Four named sources (keyboard/touch/gamepad/agent) each hold an 8-bit
// NES mask ($01=A $02=B $04=Select $08=Start $10=Up $20=Down $40=Left
// $80=Right); the bus value is their OR. Every engine step reads
// getMask(), so thumb, pad, keys and headless scripts combine instead of
// fighting. Subscribers get the combined mask on change.
export class PadBus {
  constructor() {
    this.src = { keyboard: 0, touch: 0, gamepad: 0, agent: 0 };
    this.mask = 0;
    this.subs = [];
  }
  setSource(name, m) {
    if (!(name in this.src)) throw new Error("pad-source:" + name);
    m &= 255;
    if (this.src[name] === m) return this.mask;
    this.src[name] = m;
    const nm = this.src.keyboard | this.src.touch | this.src.gamepad | this.src.agent;
    if (nm !== this.mask) {
      this.mask = nm;
      const subs = this.subs.slice();
      for (let i = 0; i < subs.length; i++) subs[i](nm);
    }
    return this.mask;
  }
  getMask() { return this.mask; }
  clearSource(name) { return this.setSource(name, 0); }
  onChange(fn) {
    this.subs.push(fn);
    return () => { const i = this.subs.indexOf(fn); if (i >= 0) this.subs.splice(i, 1); };
  }
}
