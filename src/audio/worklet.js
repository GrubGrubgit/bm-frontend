// src/audio/worklet.js -- realtime voice renderer: owns an ApuStream at
// the device sample rate, consumes pushed engine frames, emits audio.
// Starvation (output quantum needing samples with an empty FIFO) is
// counted in `gaps` and reported on `stats` request; L4 accepts gaps == 0.
import { ApuStream } from "./apu.js";
class ApuVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stream = new ApuStream(sampleRate);
    this.fifo = [];
    this.head = 0;
    this.fifoLen = 0;
    this.gaps = 0;
    this.fed = -1;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.t === "frame") {
        const blk = this.stream.pushFrame(m.f, m.ev);
        if (blk.length > 0) { this.fifo.push({ b: blk, o: 0 }); this.fifoLen += blk.length; }
        this.fed = m.f;
      } else if (m.t === "reset") {
        this.stream = new ApuStream(sampleRate);
        this.fifo = [];
        this.fifoLen = 0;
        this.gaps = 0;
        this.fed = -1;
      } else if (m.t === "stats") {
        this.port.postMessage({ t: "stats", fed: this.fed, fifo: this.fifoLen, gaps: this.gaps });
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    let off = 0, need = out.length, starved = false;
    while (need > 0 && this.fifo.length > 0) {
      const h = this.fifo[0];
      const n = Math.min(need, h.b.length - h.o);
      out.set(h.b.subarray(h.o, h.o + n), off);
      h.o += n; off += n; need -= n; this.fifoLen -= n;
      if (h.o >= h.b.length) { this.fifo.shift(); }
    }
    if (need > 0) { out.fill(0, off); starved = true; }
    if (starved) this.gaps++;
    return true;
  }
}
registerProcessor("bm-apu-voice", ApuVoice);
