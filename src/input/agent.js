// src/input/agent.js -- headless scripts drive the SAME bus (SPEC section 7
// setPad/press). setPad latches the agent source; press(frames, mask)
// holds it while stepping the host one frame at a time reading the LIVE
// bus mask, so thumb/keys/pad sources combine with the script instead of
// being bypassed. Returns the engine frame after the press.
export class AgentPad {
  constructor(bus, host) {
    this.bus = bus;
    this.host = host;
  }
  setPad(m) { return this.bus.setSource("agent", m & 255); }
  async press(frames, mask) {
    this.setPad(mask);
    for (let i = 0; i < frames; i++) await this.host.go(1, this.bus.getMask());
    this.setPad(0);
    return this.host.frame();
  }
}
