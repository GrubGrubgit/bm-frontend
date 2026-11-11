// src/audio/player.js -- realtime voice lifecycle + offline reference render.
// Realtime: AudioContext (created on user gesture) + AudioWorkletNode
// (worklet.js, same ApuStream DSP as the offline path) + GainNode for
// volume/mute. Offline: renderOffline() drives ApuStream directly on the
// calling thread through the identical pushFrame framing; the L4 headless
// test renders the full 60s run this way and analyzes the buffer.
import { ApuStream } from "./apu.js";
export class ApuPlayer {
  constructor() {
    this.ctx = null; this.node = null; this.gain = null;
    this.volume = 0.8; this.muted = false;
    this.pushed = 0; this.lastFed = -1;
  }
  async unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") await this.ctx.resume(); return this.ctx.sampleRate; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("no-webaudio");
    this.ctx = new AC();
    await this.ctx.audioWorklet.addModule(new URL("./worklet.js", import.meta.url));
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.volume;
    this.node = new AudioWorkletNode(this.ctx, "bm-apu-voice");
    this.node.port.onmessage = (e) => { if (e.data && e.data.t === "fed") this.lastFed = e.data.f; };
    this.node.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx.sampleRate;
  }
  pushFrame(f, ev) {
    if (!this.node) throw new Error("audio-locked");
    this.node.port.postMessage({ t: "frame", f: f, ev: ev });
    this.pushed = f;
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && !this.muted) this.gain.gain.value = this.volume;
    return this.volume;
  }
  setMuted(m) {
    this.muted = !!m;
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }
  async workletStats() {
    if (!this.node) return { fed: -1, fifo: 0, gaps: 0 };
    const got = await new Promise((res) => {
      const h = (e) => { if (e.data && e.data.t === "stats") { this.node.port.removeEventListener("message", h); res(e.data); } };
      this.node.port.addEventListener("message", h);
      this.node.port.start();
      this.node.port.postMessage({ t: "stats" });
    });
    return got;
  }
  stats() {
    return { ready: !!this.ctx, sampleRate: this.ctx ? this.ctx.sampleRate : 0, pushed: this.pushed, lastFed: this.lastFed, volume: this.volume, muted: this.muted, time: this.ctx ? this.ctx.currentTime : 0 };
  }
}
export function renderOffline(framesByIndex, frameCount, sampleRate) {
  const st = new ApuStream(sampleRate || 48000);
  const blocks = [];
  let total = 0;
  for (let f = 0; f < frameCount; f++) {
    const b = st.pushFrame(f, framesByIndex.get(f) || []);
    blocks.push(b); total += b.length;
  }
  const out = new Float32Array(total);
  let o = 0;
  for (const b of blocks) { out.set(b, o); o += b.length; }
  return { pcm: out, audit: st.audit() };
}
