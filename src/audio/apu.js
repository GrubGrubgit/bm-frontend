// src/audio/apu.js -- live NES APU: native voice synthesis from the engine
// register stream (SPEC section 5 bm_audio_read path). No samples, no PCM
// assets, no invented tunes: pulse1/pulse2/triangle/noise/DMC + frame
// sequencer driven by real $4000-$4017 writes with CPU-cycle timestamps.
// Cycle-exact inter-event timing; timers advanced in bulk per sample with
// fractional carry (exact for linear counters; sub-sample write ordering
// preserved). Deterministic: integer state, one Math.exp at construction.
//
// Engine facts this relies on (measured on device, all asserted in L4):
// - CPU clock 1789773 Hz; engine NMI cadence FRAME_CYCLES = 29778.
// - Frame 0 runs long (reset waits vblank, ~43k cycles); ApuStream absorbs
//   the overrun once via carry (inaudible: boot silence + init writes).
// - The game never writes $4017 (power-on 4-step sequencer), never enables
//   DMC ($4015 bit 4 never set), never touches $4011/$4012/$4013, and its
//   $4016 joy-strobe path bypasses the WR hook (zero $4016 writes logged).
//   The audit below fails loudly if any of that ever stops being true.
export const CPU_HZ = 1789773;
export const FRAME_CYCLES = 29778;
const NOISE_PERIOD = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DMC_RATE = [428, 380, 340, 320, 286, 254, 236, 214, 190, 160, 142, 128, 106, 84, 72, 54];
const LENGTH_TABLE = [10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14, 12, 16, 24, 18, 28, 20, 30, 22, 32, 24, 34, 26, 36, 28, 38, 30];
const DUTY_SEQ = [[0, 1, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 0, 0, 0], [1, 0, 0, 1, 1, 1, 1, 1]];
const TRI_SEQ = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
function mkPulse() {
  return { vol: 0, con: false, loop: false, duty: 0, len: 0, period: 0, step: 0, tc: 0,
    swEn: false, swPer: 0, swNeg: false, swShift: 0, swDiv: 0, envVol: 0, envDiv: 0, envStart: false, en: false, peak: 0 };
}
function mkTri() {
  return { halt: false, lin: 0, linRel: 0, linStart: false, len: 0, period: 0, step: 0, tc: 0, en: false, peak: 0 };
}
function mkNoise() {
  return { vol: 0, con: false, loop: false, len: 0, mode: false, period: 0, lfsr: 1, tc: 0,
    envVol: 0, envDiv: 0, envStart: false, en: false, peak: 0 };
}
function mkDmc() {
  return { irq: false, loop: false, rate: 0, tc: 0, direct: 0, addr: 0, len: 0, cur: 0, bits: 0,
    delta: 0, en: false, out: 0, peak: 0 };
}
export class NesApu {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.cps = CPU_HZ / sampleRate;
    this.dcK = 1 - Math.exp(-2 * Math.PI * 90 / sampleRate);
    this.reset();
  }
  reset() {
    this.p1 = mkPulse(); this.p2 = mkPulse(); this.tri = mkTri(); this.noi = mkNoise(); this.dmc = mkDmc();
    this.seqMode = 0; this.seqStep = 0; this.seqNext = 7457.5;
    this.cy = 0; this.k = 0; this.dc = 0; this.pending = [];
    this.audit = { writes: 0, byAddr: {}, unhandled: [], dmcEnabled: false, wrote4017: false, wroteDmcSample: false, wrote4016: 0, triHiRate: false };
  }
  clockEnv(ch) {
    if (ch.envStart) { ch.envVol = 15; ch.envDiv = ch.vol; ch.envStart = false; }
    else {
      if (ch.envDiv === 0) {
        ch.envDiv = ch.vol;
        if (ch.envVol > 0) ch.envVol--;
        else if (ch.loop) ch.envVol = 15;
      } else ch.envDiv--;
    }
  }
  clockLen(ch) { if (!ch.loop && ch.len > 0) ch.len--; }
  clockSweep(ch, isP1) {
    if (ch.swDiv === 0) {
      ch.swDiv = ch.swPer;
      if (ch.swEn && ch.swShift > 0 && ch.period >= 8) {
        const d = ch.period >> ch.swShift;
        const t = ch.swNeg ? (isP1 ? ch.period - d - 1 : ch.period - d) : ch.period + d;
        if (t <= 0x7FF) ch.period = t;
      }
    } else ch.swDiv--;
  }
  clockLin() {
    const t = this.tri;
    if (t.linStart) t.lin = t.linRel;
    else if (t.lin > 0) t.lin--;
    if (!t.halt) t.linStart = false;
  }
  clockSeq() {
    const s = this.seqStep;
    if (this.seqMode === 0) {
      this.clockEnv(this.p1); this.clockEnv(this.p2); this.clockEnv(this.noi); this.clockLin();
      if (s === 1 || s === 3) {
        this.clockLen(this.p1); this.clockLen(this.p2); this.clockLen(this.tri); this.clockLen(this.noi);
        this.clockSweep(this.p1, true); this.clockSweep(this.p2, false);
      }
      this.seqStep = (s + 1) & 3;
      this.seqNext += 7457.5;
    } else {
      if (s < 4) {
        this.clockEnv(this.p1); this.clockEnv(this.p2); this.clockEnv(this.noi); this.clockLin();
        if (s === 1 || s === 3) {
          this.clockLen(this.p1); this.clockLen(this.p2); this.clockLen(this.tri); this.clockLen(this.noi);
          this.clockSweep(this.p1, true); this.clockSweep(this.p2, false);
        }
      }
      this.seqStep = (s + 1) % 5;
      this.seqNext += 7456.4;
    }
  }
  stepTimers(d) {
    let ch = this.p1;
    ch.tc -= d;
    if (ch.tc <= 0) { const p = (ch.period + 1) * 2; do { ch.tc += p; ch.step = (ch.step + 1) & 7; } while (ch.tc <= 0); }
    ch = this.p2;
    ch.tc -= d;
    if (ch.tc <= 0) { const p = (ch.period + 1) * 2; do { ch.tc += p; ch.step = (ch.step + 1) & 7; } while (ch.tc <= 0); }
    const t = this.tri;
    t.tc -= d;
    if (t.tc <= 0) { const p = t.period + 1; do { t.tc += p; t.step = (t.step + 1) & 31; } while (t.tc <= 0); }
    const n = this.noi;
    n.tc -= d;
    if (n.tc <= 0) {
      const p = NOISE_PERIOD[n.period];
      do {
        n.tc += p;
        const fb = (n.lfsr & 1) ^ (n.mode ? ((n.lfsr >> 6) & 1) : ((n.lfsr >> 1) & 1));
        n.lfsr = (n.lfsr >> 1) | (fb << 14);
      } while (n.tc <= 0);
    }
    const m = this.dmc;
    if (m.en && m.len > 0) {
      m.tc -= d;
      if (m.tc <= 0) {
        const p = DMC_RATE[m.rate];
        do {
          m.tc += p;
          if (m.bits === 0) m.bits = 8;
          if (m.cur & 1) { if (m.delta <= 125) m.delta += 2; }
          else { if (m.delta >= 2) m.delta -= 2; }
          m.cur >>= 1; m.bits--;
        } while (m.tc <= 0);
      }
      m.out = m.delta;
    } else m.out = 0;
  }
  pulseOut(ch) {
    if (!ch.en || ch.len === 0 || ch.period < 8) return 0;
    let t = ch.period;
    if (ch.swEn && ch.swShift > 0) {
      const d = t >> ch.swShift;
      t = ch.swNeg ? t - d : t + d;
      if (t > 0x7FF) return 0;
    }
    const v = ch.con ? ch.vol : ch.envVol;
    const o = DUTY_SEQ[ch.duty][ch.step] ? v : 0;
    if (o > ch.peak) ch.peak = o;
    return o;
  }
  triOut() {
    const t = this.tri;
    if (!t.en || t.len === 0 || t.lin === 0) return 0;
    if (t.period < 2) { this.audit.triHiRate = true; return 7; }
    const o = TRI_SEQ[t.step];
    if (o > t.peak) t.peak = o;
    return o;
  }
  noiseOut() {
    const n = this.noi;
    if (!n.en || n.len === 0) return 0;
    const v = n.con ? n.vol : n.envVol;
    const o = (n.lfsr & 1) ? 0 : v;
    if (o > n.peak) n.peak = o;
    return o;
  }
  emit() {
    const p = this.pulseOut(this.p1) + this.pulseOut(this.p2);
    const t = 3 * this.triOut() + 2 * this.noiseOut() + this.dmc.out;
    if (this.dmc.out > this.dmc.peak) this.dmc.peak = this.dmc.out;
    const po = p > 0 ? 95.52 / (8128 / p + 100) : 0;
    const to = t > 0 ? 163.67 / (24329 / t + 100) : 0;
    const x = po + to;
    this.dc += (x - this.dc) * this.dcK;
    this.pending.push(x - this.dc);
  }
  advance(n) {
    if (!(n > 0)) return;
    const t = this.cy + n, cps = this.cps;
    for (;;) {
      const nb = (this.k + 1) * cps;
      if (nb > t) break;
      this.stepTimers(nb - this.cy); this.cy = nb;
      while (this.seqNext <= this.cy) this.clockSeq();
      this.emit(); this.k++;
    }
    if (t > this.cy) { this.stepTimers(t - this.cy); this.cy = t; while (this.seqNext <= this.cy) this.clockSeq(); }
  }
  write(addr, val) {
    const A = this.audit;
    A.writes++;
    const k = addr.toString(16);
    A.byAddr[k] = (A.byAddr[k] || 0) + 1;
    val &= 255;
    switch (addr) {
      case 0x4000: {
        const c = this.p1;
        c.duty = (val >> 6) & 3; c.loop = !!(val & 32); c.con = !!(val & 16); c.vol = val & 15;
        break;
      }
      case 0x4001: {
        const c = this.p1;
        c.swEn = !!(val & 128); c.swPer = (val >> 4) & 7; c.swNeg = !!(val & 8); c.swShift = val & 7; c.swDiv = 0;
        break;
      }
      case 0x4002: this.p1.period = (this.p1.period & 0x700) | val; break;
      case 0x4003: {
        const c = this.p1;
        c.period = (c.period & 0xFF) | ((val & 7) << 8);
        c.step = 0; c.envStart = true;
        c.len = c.en ? LENGTH_TABLE[(val >> 3) & 31] : 0;
        break;
      }
      case 0x4004: {
        const c = this.p2;
        c.duty = (val >> 6) & 3; c.loop = !!(val & 32); c.con = !!(val & 16); c.vol = val & 15;
        break;
      }
      case 0x4005: {
        const c = this.p2;
        c.swEn = !!(val & 128); c.swPer = (val >> 4) & 7; c.swNeg = !!(val & 8); c.swShift = val & 7; c.swDiv = 0;
        break;
      }
      case 0x4006: this.p2.period = (this.p2.period & 0x700) | val; break;
      case 0x4007: {
        const c = this.p2;
        c.period = (c.period & 0xFF) | ((val & 7) << 8);
        c.step = 0; c.envStart = true;
        c.len = c.en ? LENGTH_TABLE[(val >> 3) & 31] : 0;
        break;
      }
      case 0x4008: {
        const t = this.tri;
        t.halt = !!(val & 128); t.linRel = val & 127; t.linStart = true;
        break;
      }
      case 0x4009: break;
      case 0x400A: this.tri.period = (this.tri.period & 0x700) | val; break;
      case 0x400B: {
        const t = this.tri;
        t.period = (t.period & 0xFF) | ((val & 7) << 8);
        t.len = t.en ? LENGTH_TABLE[(val >> 3) & 31] : 0;
        t.linStart = true;
        break;
      }
      case 0x400C: {
        const c = this.noi;
        c.loop = !!(val & 32); c.con = !!(val & 16); c.vol = val & 15;
        break;
      }
      case 0x400D: break;
      case 0x400E: {
        const c = this.noi;
        c.mode = !!(val & 128); c.period = val & 15;
        break;
      }
      case 0x400F: {
        const c = this.noi;
        c.envStart = true;
        c.len = c.en ? LENGTH_TABLE[(val >> 3) & 31] : 0;
        break;
      }
      case 0x4010: {
        const m = this.dmc;
        m.irq = !!(val & 128); m.loop = !!(val & 64); m.rate = val & 15;
        break;
      }
      case 0x4011: this.dmc.direct = val & 127; this.dmc.delta = val & 127; A.wroteDmcSample = true; break;
      case 0x4012: this.dmc.addr = val; A.wroteDmcSample = true; break;
      case 0x4013: this.dmc.len = val; A.wroteDmcSample = true; break;
      case 0x4014: break;
      case 0x4015: {
        const p1 = this.p1, p2 = this.p2, t = this.tri, n = this.noi, m = this.dmc;
        p1.en = !!(val & 1); if (!p1.en) p1.len = 0;
        p2.en = !!(val & 2); if (!p2.en) p2.len = 0;
        t.en = !!(val & 4); if (!t.en) t.len = 0;
        n.en = !!(val & 8); if (!n.en) n.len = 0;
        if (val & 16) { A.dmcEnabled = true; m.en = true; }
        else { m.en = false; m.out = 0; if (m.len === 0) m.bits = 0; }
        break;
      }
      case 0x4016: A.wrote4016++; break;
      case 0x4017: {
        A.wrote4017 = true;
        this.seqMode = (val & 128) ? 1 : 0;
        this.seqStep = 0;
        if (this.seqMode === 1) {
          this.clockEnv(this.p1); this.clockEnv(this.p2); this.clockEnv(this.noi); this.clockLin();
          this.seqNext = this.cy + 7456.4;
        } else this.seqNext = this.cy + 7457.5;
        break;
      }
      default: A.unhandled.push(addr); break;
    }
  }
  takeBlock() {
    const b = new Float32Array(this.pending);
    this.pending = [];
    return b;
  }
}
// ApuStream: frame-level driver. pushFrame(f, events) consumes one engine
// frame (events = [[addr, val, cycleUint32]...] in drain order), advances
// exact inter-event deltas, pads silence to the nominal frame end, and
// returns the new samples as a Float32Array block (~800 @48k). Frame 0
// overrun (reset waits vblank) is absorbed once via carry.
export class ApuStream {
  constructor(sampleRate) {
    this.apu = new NesApu(sampleRate);
    this.c0 = -1; this.cursor = 0; this.carry = 0;
  }
  pushFrame(f, events) {
    const apu = this.apu;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const c = e[2] >>> 0;
      if (this.c0 < 0) { this.c0 = c; this.cursor = c; }
      let d = (c - this.cursor) >>> 0;
      if (d > 0x40000000) d = 0;
      if (d > 0) { apu.advance(d); this.cursor = (this.cursor + d) >>> 0; }
      apu.write(e[0], e[1]);
    }
    if (this.c0 < 0) { this.c0 = 9; this.cursor = 9; }
    const target = (this.c0 + (f + 1) * FRAME_CYCLES + this.carry) >>> 0;
    if (target > this.cursor) {
      const dd = (target - this.cursor) >>> 0;
      if (dd > 0 && dd < 0x40000000) { apu.advance(dd); this.cursor = target; }
    } else if (this.cursor > target) this.carry += this.cursor - target;
    return apu.takeBlock();
  }
  audit() { return this.apu.audit; }
}
