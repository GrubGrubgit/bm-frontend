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

// ---- S4: song pointer-table remap (swap what an id plays) ----
// Each id owns one word @SONG_PTR.OFFSET+id*2 (bank5). A remap copies the
// target id's word over the id's word: exact 2-byte replace, data untouched.
export function remapSongs(base5, edited) {
  const errors = [];
  if (!(base5 instanceof Uint8Array) || base5.length !== STREAM.BANK_LEN) return { ok: false, errors: ['bad-bank5'] };
  const out = base5.slice();
  const keys = Object.keys(edited || {});
  for (let i = 0; i < keys.length; i++) {
    const idx = +keys[i];
    if (!(idx >= 0 && idx < SONG_PTR.COUNT && (idx | 0) === idx)) { errors.push(keys[i] + ':bad-idx'); continue; }
    const t = edited[keys[i]];
    if (!Number.isInteger(t) || t < 0 || t >= SONG_PTR.COUNT) { errors.push(keys[i] + ':range'); continue; }
    const so = SONG_PTR.OFFSET + idx * 2, to = SONG_PTR.OFFSET + t * 2;
    out[so] = base5[to]; out[so + 1] = base5[to + 1];
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], bytes: out };
}
export function ptrOf(bank5, id) { const p = songPtr(bank5, id); return p < 0 ? null : p; }

// ---- S5: request-site editing (exact 1-byte LDA-immediate swaps) ----
// Shape I (106 rows): LDA #id directly before JSR (bank6 DECC / bank7 DECC /
// bank4 C216 tailcall): id byte at fileoff cpu-0x8000-1, guarded by A9 before + 20 after.
// Shape L (3 rows: 1F/21/22 bomb conduct): cpu IS the LDA addr (shared JSR tail at
// 0x9769): id byte at fileoff cpu-0x8000+1, guarded by A9 at cpu-0x8000.
// Shape T (1 row: 2A tank area-BGM): table-driven via LA124 (see TANK_SONGS).
import { SITES } from "./sound.js";
export const TANK_SONGS = { BANK: 4, COUNT: 8 };
export function tankTableOffset(bank4) {
  if (!(bank4 instanceof Uint8Array)) return -1;
  const seq = [0x2A, 0x09, 0x09, 0x2A, 0x09, 0x09, 0x2A, 0x09];
  let hit = -1;
  for (let i = 0; i + 8 <= bank4.length; i++) {
    let m = true;
    for (let k = 0; k < 8; k++) if (bank4[i + k] !== seq[k]) { m = false; break; }
    if (m) { if (hit >= 0) return -2; hit = i; }
  }
  return hit;
}
export function getTankSongs(bank4) {
  const o = tankTableOffset(bank4);
  if (o < 0) return null;
  const out = [];
  for (let i = 0; i < TANK_SONGS.COUNT; i++) out.push(bank4[o + i]);
  return out;
}
export function serializeTankSongs(base4, edited) {
  const errors = [];
  const o = tankTableOffset(base4);
  if (o < 0) return { ok: false, errors: ['no-table'] };
  const out = base4.slice();
  const keys = Object.keys(edited || {});
  for (let i = 0; i < keys.length; i++) {
    const idx = +keys[i];
    if (!(idx >= 0 && idx < TANK_SONGS.COUNT && (idx | 0) === idx)) { errors.push(keys[i] + ':bad-idx'); continue; }
    const v = edited[keys[i]];
    if (!Number.isInteger(v) || v < 0 || v > 84) { errors.push(keys[i] + ':range'); continue; }
    out[o + idx] = v;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], bytes: out };
}
export function siteKey(bank, cpu) { return bank + ':' + cpu.toString(16); }
export function sitePatchInfo(banks, bank, cpu) {
  const B = banks ? banks[bank] : null;
  if (!(B instanceof Uint8Array)) return null;
  let off = -1, shape = '';
  const io = cpu - 0x8000 - 1;
  if (io >= 1 && io + 1 < B.length && B[io - 1] === 0xA9 && B[io + 1] === 0x20) { off = io; shape = 'I'; }
  else {
    const lo = cpu - 0x8000 + 1;
    if (lo >= 1 && lo < B.length && B[lo - 1] === 0xA9) { off = lo; shape = 'L'; }
  }
  if (off < 0) return null;
  return { off: off, shape: shape, cur: B[off] };
}
export function allSiteInfos(banks) {
  const out = [];
  for (const k of Object.keys(SITES)) {
    const id = parseInt(k, 16);
    for (const r of SITES[k]) {
      if (r.b === 4 && r.cpu === 0xA120) { out.push({ key: 'T:' + k, song: k, id: id, bank: 4, cpu: r.cpu, shape: 'T', note: r.n }); continue; }
      const p = sitePatchInfo(banks, r.b, r.cpu);
      if (!p) { out.push({ key: siteKey(r.b, r.cpu), song: k, id: id, bank: r.b, cpu: r.cpu, shape: '?', note: r.n }); continue; }
      out.push({ key: siteKey(r.b, r.cpu), song: k, id: id, bank: r.b, cpu: r.cpu, shape: p.shape, off: p.off, cur: p.cur, note: r.n });
    }
  }
  return out;
}
export function serializeSites(banks, edited) {
  const errors = []; const touched = new Set();
  if (!banks || !banks.length) return { ok: false, errors: ['bad-banks'] };
  const out = banks.map((B) => (B instanceof Uint8Array) ? B.slice() : null);
  const keys = Object.keys(edited || {});
  for (let i = 0; i < keys.length; i++) {
    const parts = keys[i].split(':');
    if (parts.length !== 2) { errors.push(keys[i] + ':bad-key'); continue; }
    const bank = +parts[0], cpu = parseInt(parts[1], 16);
    const p = sitePatchInfo(banks, bank, cpu);
    if (!p) { errors.push(keys[i] + ':no-site'); continue; }
    const v = edited[keys[i]];
    if (!Number.isInteger(v) || v < 0 || v > 84) { errors.push(keys[i] + ':range'); continue; }
    out[bank][p.off] = v; touched.add(bank);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], bytes: out, banks: Array.from(touched).sort() };
}

// ---- S6: per-site override plumbing ----
// Hook-7 coverage is build-synthesized; these 6 SITES rows have no lifted
// LDA in the current lift (real ROM LDA+JSR, never lifted, never observed;
// reaching them would trap, so no override could take effect). The editor
// renders them read-only and refuses commits; verify-sound-s6.mjs pins this
// list. If a future lift covers them, hook 7 picks them up automatically and
// this list + the suite get updated together.
export const SITE_HOOK7_UNHOOKED = ['6:a33b', '6:b66c', '6:9f56', '4:ac80', '4:b879', '4:aec1'];
export function sitesMapOf(edited) {
  const errors = []; const map = {};
  const keys = Object.keys(edited || {});
  for (let i = 0; i < keys.length; i++) {
    const raw = String(keys[i]);
    const parts = raw.split(':');
    if (parts.length !== 2) { errors.push(raw + ':bad-key'); continue; }
    const bank = +parts[0], cpu = parseInt(parts[1], 16);
    const v = edited[keys[i]];
    if (!(bank === 4 || bank === 6 || bank === 7) || !(cpu >= 0 && cpu <= 0xFFFF && (cpu | 0) === cpu)) { errors.push(raw + ':bad-key'); continue; }
    if (bank === 4 && cpu === 0xA120) { errors.push(raw + ':t-is-data'); continue; }
    if (SITE_HOOK7_UNHOOKED.indexOf(bank + ':' + cpu.toString(16)) >= 0) { errors.push(raw + ':unhooked'); continue; }
    if (!Number.isInteger(v) || v < 0 || v > 84) { errors.push(raw + ':range'); continue; }
    map[bank + ':' + cpu.toString(16)] = v;
  }
  if (errors.length) return { ok: false, errors: errors, map: null };
  return { ok: true, errors: [], map: map };
}
