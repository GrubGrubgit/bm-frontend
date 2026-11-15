// src/audio/pcm.js -- realtime raw-PCM lifecycle for the Mesen accurate
// engine (mirrors player.js shape: unlock/pushSamples/reset/volume/mute).
// Mesen emits 44100Hz mono; this resamples (linear) to the device rate.
const SRC_RATE = 44100;
export class PcmPlayer {
  constructor() {
    this.ctx = null; this.node = null; this.gain = null;
    this.volume = 0.8; this.muted = false;
    this.pushed = 0; this.lastFed = -1;
    this._carry = 0;
  }
  async unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") await this.ctx.resume(); return this.ctx.sampleRate; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("no-webaudio");
    this.ctx = new AC();
    await this.ctx.audioWorklet.addModule(new URL("./pcm-worklet.js", import.meta.url));
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.volume;
    this.node = new AudioWorkletNode(this.ctx, "bm-pcm-voice");
    this.node.port.onmessage = (e) => { if (e.data && e.data.t === "fed") this.lastFed = e.data.f; };
    this.node.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx.sampleRate;
  }
  pushSamples(f, mono44100) {
    if (!this.node) throw new Error("audio-locked");
    const dst = this.ctx.sampleRate;
    let out;
    if (dst === SRC_RATE) {
      out = mono44100;
    } else {
      const ratio = dst / SRC_RATE;
      const n = Math.max(1, Math.round(mono44100.length * ratio));
      out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const pos = i / ratio + this._carry;
        const i0 = Math.floor(pos), fr = pos - i0;
        const a = mono44100[i0] || 0, b = mono44100[i0 + 1] || 0;
        out[i] = a + (b - a) * fr;
      }
      this._carry = 0;
    }
    this.node.port.postMessage({ t: "samples", f: f, b: out });
    this.pushed = f;
  }
  reset() {
    this.pushed = 0; this.lastFed = -1; this._carry = 0;
    if (this.node) { try { this.node.port.postMessage({ t: "reset" }); } catch (e) {} }
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
  stats() {
    return { ready: !!this.ctx, sampleRate: this.ctx ? this.ctx.sampleRate : 0, pushed: this.pushed, lastFed: this.lastFed, volume: this.volume, muted: this.muted, time: this.ctx ? this.ctx.currentTime : 0 };
  }
}
