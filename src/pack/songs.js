// S3: bank-5 song structure (tracker bytecode), read-only model.
// Header per song: [slot, i0, i1, i2, streamLo, streamHi] x N, end byte $80+.
// Stream opcodes (from prg5 tick): <$A0 note(2); $A0 duty(2); $B0 loop(4+jump);
// $C0/$C1/$C3 1-byte flags, $C2 vib(2/4); $D0 env(3, 2 if odd); $E0 gosub(3+jump,
// odd = return(1)); >=$F0 channel end(1). No engine change.
import { SONG_TABLE } from "./sound.js";
export const SONG_PTR = { BANK: 5, OFFSET: 1200, COUNT: 85 };
export const STREAM = { LO: 0x8000, HI: 0xC000, BANK_LEN: 16384 };
export function songPtr(bank5, id) {
  if (!(bank5 instanceof Uint8Array) || bank5.length !== STREAM.BANK_LEN) return -1;
  if (!(id >= 0 && id < SONG_PTR.COUNT && (id | 0) === id)) return -1;
  const o = SONG_PTR.OFFSET + id * 2;
  return bank5[o] | (bank5[o + 1] << 8);
}
export function songChannels(bank5, id) {
  const ptr = songPtr(bank5, id);
  if (ptr < STREAM.LO || ptr >= STREAM.HI) return null;
  let o = ptr - STREAM.LO;
  const out = [];
  for (let n = 0; n < 8; n++) {
    if (o >= bank5.length) return null;
    const slot = bank5[o];
    if (slot & 0x80) return out;
    if (o + 5 >= bank5.length) return null;
    out.push({ slot: slot, apu: (bank5[o + 1] & 3) << 2,
      init: [bank5[o + 1], bank5[o + 2], bank5[o + 3]],
      stream: bank5[o + 4] | (bank5[o + 5] << 8) });
    o += 6;
  }
  return out;
}
export function walkStream(bank5, start) {
  const rep = { notes: 0, ends: 0, loops: 0, gosubs: 0, returns: 0, nBytes: 0, infloops: 0, errors: [] };
  const bytes = new Set();
  if (start < STREAM.LO || start >= STREAM.HI) { rep.errors.push('start-range'); return rep; }
  const rd = (a) => (a >= STREAM.LO && a < STREAM.HI) ? bank5[a - STREAM.LO] : -1;
  const mark = (a) => { bytes.add(a); };
  const work = [start];
  const seen = new Set();
  let steps = 0;
  while (work.length) {
    let pc = work.pop();
    while (true) {
      if (++steps > 100000) { rep.errors.push('steps'); return rep; }
      if (pc < STREAM.LO || pc >= STREAM.HI) { rep.errors.push('range@' + pc.toString(16)); break; }
      if (seen.has(pc)) break;
      seen.add(pc); mark(pc);
      const op = rd(pc);
      if (op < 0xA0) { rep.notes++; mark(pc + 1); seen.add(pc + 1); pc += 2; continue; }
      if (op < 0xB0) { mark(pc + 1); seen.add(pc + 1); pc += 2; continue; }
      if (op < 0xC0) { const cnt0 = rd(pc + 1) === 0;
        rep.loops++; mark(pc + 1); mark(pc + 2); mark(pc + 3);
        seen.add(pc + 1); seen.add(pc + 2); seen.add(pc + 3);
        const t = rd(pc + 2) | (rd(pc + 3) << 8);
        if (t < STREAM.LO || t >= STREAM.HI) { rep.errors.push('loop-target@' + pc.toString(16)); pc += 4; continue; }
        if (!seen.has(t)) work.push(t);
        if (cnt0) { rep.infloops++; break; }
        pc += 4; continue;
      }
      if (op < 0xD0) {
        if (op === 0xC2) {
          const f = rd(pc + 1); mark(pc + 1); seen.add(pc + 1); pc += 2;
          if (!(f & 0x80) && !(f & 0x10)) { mark(pc); mark(pc + 1); seen.add(pc); seen.add(pc + 1); pc += 2; }
          continue;
        }
        pc += 1; continue;
      }
      if (op < 0xE0) { const len = (op & 1) ? 2 : 3; for (let k = 1; k < len; k++) { mark(pc + k); seen.add(pc + k); } pc += len; continue; }
      if (op < 0xF0) {
        if (op & 1) { rep.returns++; pc += 1; break; }
        rep.gosubs++; mark(pc + 1); mark(pc + 2); seen.add(pc + 1); seen.add(pc + 2);
        const t = rd(pc + 1) | (rd(pc + 2) << 8);
        if (t < STREAM.LO || t >= STREAM.HI) { rep.errors.push('gosub-target@' + pc.toString(16)); pc += 3; continue; }
        if (!seen.has(t)) work.push(t);
        pc += 3; continue;
      }
      rep.ends++; pc += 1; break;
    }
  }
  rep.nBytes = bytes.size;
  return rep;
}
export function parseSong(bank5, id) {
  const ch = songChannels(bank5, id);
  if (!ch || !ch.length) return { ok: false, errors: ['header'] };
  const errors = []; const channels = []; const union = new Set();
  let notes = 0, ends = 0, loops = 0, gosubs = 0;
  for (const c of ch) {
    if (!(c.slot >= 0 && c.slot <= 8)) errors.push('slot@' + c.slot.toString(16));
    if (c.stream < STREAM.LO || c.stream >= STREAM.HI) { errors.push('stream-range'); continue; }
    const w = walkStream(bank5, c.stream);
    for (const e of w.errors) errors.push(e);
    if (!w.ends && !w.infloops) errors.push('no-end@' + c.stream.toString(16));
    notes += w.notes; ends += w.ends; loops += w.loops; gosubs += w.gosubs;
    channels.push({ slot: c.slot, apu: c.apu, stream: c.stream,
      bytes: w.nBytes, notes: w.notes, ends: w.ends, loops: w.loops, gosubs: w.gosubs });
  }
  if (errors.length) return { ok: false, errors: errors };
  return { ok: true, id: id, ptr: songPtr(bank5, id), channels: channels,
    notes: notes, ends: ends, loops: loops, gosubs: gosubs };
}
export function songLine(r) {
  return 'song $' + r.id.toString(16) + ': ' + r.channels.length + 'ch ' + r.notes + 'n/' + r.loops + 'L/' + r.gosubs + 'G ends' + r.ends + ' [' + r.channels.map(function (c) { return 'ch' + c.slot + '@' + c.stream.toString(16) + '+' + c.bytes; }).join(' ') + ']';
}
