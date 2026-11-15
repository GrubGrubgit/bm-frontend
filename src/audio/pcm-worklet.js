// src/audio/pcm-worklet.js -- dumb PCM FIFO renderer for the Mesen accurate
// engine. The ApuPlayer/worklet path stays untouched (wasm port voices
// real APU registers); this worklet just plays raw mono float samples
// pushed from the Mesen host. Starvation emits silence (unlike the
// APU voice it is NOT gap-counted: debug audio only).
class PcmVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fifo = [];
    this.head = 0;
    this.fifoLen = 0;
    this.fed = -1;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.t === "samples") {
        const b = m.b;
        if (b && b.length > 0) { this.fifo.push({ b: b, o: 0 }); this.fifoLen += b.length; }
        this.fed = m.f;
      } else if (m.t === "reset") {
        this.fifo = []; this.head = 0; this.fifoLen = 0; this.fed = -1;
      } else if (m.t === "stats") {
        this.port.postMessage({ t: "stats", fed: this.fed, fifo: this.fifoLen, gaps: 0 });
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    let off = 0, need = out.length;
    while (need > 0 && this.fifo.length > 0) {
      const h = this.fifo[0];
      const n = Math.min(need, h.b.length - h.o);
      out.set(h.b.subarray(h.o, h.o + n), off);
      h.o += n; off += n; need -= n; this.fifoLen -= n;
      if (h.o >= h.b.length) { this.fifo.shift(); }
    }
    if (need > 0) out.fill(0, off);
    return true;
  }
}
registerProcessor("bm-pcm-voice", PcmVoice);
