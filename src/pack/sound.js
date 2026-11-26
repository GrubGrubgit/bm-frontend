// 6.4e sound engine v1: bank-5 driver map + song/sfx table layout (pure model).
// RE ground truth: device disasm/asm/prg5.s (driver) + asm/prg7.s (request
// sites, scheduler, area table); ROM bytes pinned by tools/verify-pack-6.4e.mjs.
// No engine change: the shipped build already exposes every song start through
// the APU register ring (drained headless via bm_audio_read) and the current
// song id lives at zero-page $E9 (written once per start by entry_8013).
//
// Driver (PRG bank 5, mapped $8000-$BFFF):
//   entry_8000 init   = silence ($4015 = 0, channel state cleared)
//   entry_8013 start  = A = song id -> L84B0 word table -> parse up to 8
//                       channel records into $0700+$0709+$0712+$071B+$0724
//                       (stride pages per channel X = 8..1), $4015 = $0F
//   entry_8077 tick   = per-frame channel fetch/decode; pulse channels write
//                       $4000/$4001/$4002 with $4003 gated, DMC $4010-$4013
// Fixed-bank ($BFE5/$BFE8/$BFF1 jmp vectors) scheduler in prg7:
//   DEC2 request-silence+init, DECC queue id into 8 slots at $0370 (dedup),
//   DEEB pump (start every queued id, clear slots, then tick). NMI EC44 maps
//   bank 5, runs the DEEB pump, restores the bank.
export const SOUND_BANK = 5;
export const DRIVER = {
  INIT: 0x8000, START: 0x8013, TICK: 0x8077,
  VEC_INIT: 0xBFE5, VEC_START: 0xBFE8, VEC_TICK: 0xBFF1,
};
export const QUEUE = { BASE: 0x0370, SLOTS: 8 };
export const CUR_SONG = 0xE9;
// Period table: 97 little-endian words, strictly descending pitch periods.
export const PERIOD_TABLE = { OFFSET: 1006, WORDS: 97, FIRST: 0x06AE, LAST: 0x0000 };
// Song pointer table: 85 entries (ids $00-$54), bank-relative $8000-$BFFF.
// ids 0 and 6 alias the same data ($983A).
export const SONG_TABLE = { OFFSET: 1200, COUNT: 85, MAX_ID: 0x54, ALIAS_0_6: 0x983A };
// Area entry music (LCDC8, fixed bank): indexed by area & 7, requested by CDBA.
export const AREA_SONGS = [6, 4, 2, 19, 7, 5, 55, 43];
// Immediate-id request sites (static context proven; full trigger mapping v2).
export const REQ = {
  TITLE: 0x54,        // E309 title init
  INTRO: 0x4E,        // F5D9 intro-cinematic loop end (post-Start)
  DOOR_SAME: 0x39,    // same-area door transition
  DOOR_DUNGEON: 0x01, // dungeon <-> dungeon area change
  DOOR_OVERHEAD: 0x38, // overhead transitions
  DEATH: 0x3D,        // C52A player death
  BOSS_LOW: 0x36,     // D6AB boss-HP threshold fallthrough
  BOSS_CRIT: 0x1D,    // D6AB boss-HP threshold under
  ENEMY_A: 0x0C,      // D763 gated enemy cue
  ENEMY_B: 0x0D,      // D770 gated enemy cue
  ADJUST: 0x19,       // F88C nibble-adjust jingle
  SEQ_END: 0x17,      // LF2BE cutscene loop end
  CUT_PULSE: 0x03,    // LF29F periodic cutscene pulse
  CUT_B: 0x18,        // cutscene/continue path (two sites, exact UI TBD)
};
// Observed headless in gameplay (requesting routine TBD, v2): dungeon main
// BGM $2D; overhead-area cues $1E/$51; area-9 rotation $42/$3C/$29.
export const OBSERVED = { BGM_DUNGEON: 0x2D, OVER_A: 0x1E, OVER_B: 0x51, DUN9_A: 0x42, DUN9_B: 0x3C, DUN9_C: 0x29 };
export function songForArea(area) { return AREA_SONGS[area & 7]; }
export function isSongId(id) { return Number.isInteger(id) && id >= 0 && id < SONG_TABLE.COUNT; }

// ---- 6.4e v2: music-state machine (requester logic) ----
// Request paths (ROM-byte-pinned by tools/verify-pack-6.4e.mjs):
//   bank 6 (dungeon, mapped $8000): 50x JSR DECC (LDECC alias)
//     = 49 immediate (LDA id directly before JSR) + 1 shared tail
//     (STX $B9 + JSR, served by 3 upstream LDAs: $1F/$21/$22 conduct).
//   bank 4 (tank, mapped $8000): 43x JSR C216 (LC216 = JMP DECC tailcall)
//     = 42 immediate + 1 shared tail (LDA LA124,x = area-BGM select).
//   bank 7 (fixed): 15 immediate JSR DECC (title/intro/door/death/boss).
//   No other bank holds either pattern; the driver never requests.
export const REQ_PATHS = { BANK6: 50, BANK6_IMM: 49, BANK4: 43, BANK4_IMM: 42, BANK7: 15 };
// Song ids owned by the state machine (v1 OBSERVED now attributed).
export const MUSIC = {
  BGM_DUNGEON: 0x2D, HIT_DUNGEON: 0x3C, SECOND_HURT: 0x33,
  HIT_TANK: 0x1E, EXPLOSION: 0x51,
  VOCALIZE: 0x42, VOCALIZE_RANDOM: 0x29, VOCALIZE_8F: 0x45, VOCALIZE_32F: 0x47,
  CONDUCT_1F: 0x1F, CONDUCT_21: 0x21, CONDUCT_22: 0x22,
  BOMB_SONG: 0x34, BOMB_ACTOR: 0x2A, SPAWN: 0x28, SPAWN_RARE: 0x52,
  POWERUP_BEEP: 0x30, DOOR_FANFARE: 0x2E,
  DEATH_CHAIN: [0x2C, 0x3F, 0x40],
  GRID_16: 0x10, GRID_POSTFRAME: 0x01, INVULN: 0x20, RESTORE_LAG: 2,
  BOMB_PAD: 0x02, BOMB_GAMEBIT: 0x40, UP_GAMEBIT: 0x80,
};
// Jason slot machine (dungeon; slot byte offsets from $0400, stride $0E):
// byte10 ($50 shadow): 0 idle (Up -> $2E fanfare), 1 second-hurt ($33,
// no restore), 2 hit ($3C + $4F=$20 invuln -> $2D restore +2f),
// 3 intro staging ($8F=4 reload, counts down, clears at 0).
export const JASON_SLOT = { IDLE: 0, SECOND_HURT: 1, HIT: 2, STAGING: 3 };
// Tank mode is fire-and-forget: hits request $1E with no restore path;
// destruction requests $51 (slot0 actor->4, $C5 bit3 set), then CDBA
// reloads AREA_SONGS[0] and the tank respawns at full HP (629f idle cycle).
export const TANK_DESTRUCTION = { SONG: 0x51, SLOT0_ACTOR: 4, C5_BIT: 0x08, CYCLE_IDLE: 629 };
// SITES: song id (hex) -> [{b: bank, cpu: addr, n: note}]. "trigger TBD"
// = ROM-byte-pinned but not yet dynamically attributed.
export const SITES = {
  '1F': [{ b: 6, cpu: 0x9757, n: 'bomb conduct (L9738 $03FC bits; tail JSR 0x9769)' }],
  '21': [{ b: 6, cpu: 0x975D, n: 'bomb conduct (shared tail JSR 0x9769)' }],
  '22': [{ b: 6, cpu: 0x9763, n: 'bomb conduct (shared tail JSR 0x9769)' }],
  '1D': [{ b: 6, cpu: 0xA31E, n: 'trigger TBD' }, { b: 6, cpu: 0xA33B, n: 'trigger TBD' }, { b: 7, cpu: 0x96B9, n: 'boss-crit (D6AB fallthrough)' }],
  '20': [{ b: 6, cpu: 0xAA4D, n: 'trigger TBD' }],
  '23': [{ b: 6, cpu: 0x9EA0, n: 'trigger TBD' }],
  '24': [{ b: 6, cpu: 0xB23C, n: 'spawner/slot-row writes' }, { b: 6, cpu: 0xB2D8, n: 'spawner/slot-row writes' }, { b: 6, cpu: 0xB66C, n: 'slot rows ($87) + spawn' }, { b: 4, cpu: 0xB54C, n: 'slot-row bump + coord + spawn' }],
  '25': [{ b: 6, cpu: 0x9EDC, n: 'trigger TBD' }, { b: 6, cpu: 0x9F56, n: 'trigger TBD' }],
  '27': [{ b: 6, cpu: 0x9F33, n: 'trigger TBD' }, { b: 6, cpu: 0x9FAD, n: 'trigger TBD' }, { b: 6, cpu: 0xA164, n: 'trigger TBD' }],
  '28': [{ b: 6, cpu: 0x9B83, n: 'spawner family (LD7xx gates)' }, { b: 6, cpu: 0x9B8D, n: 'spawner family' }, { b: 6, cpu: 0x9BA6, n: 'spawner family' }, { b: 6, cpu: 0x9BE9, n: 'spawner family tail' }, { b: 4, cpu: 0x932B, n: 'spawner pair (row table L9324)' }, { b: 4, cpu: 0x9335, n: 'spawner pair' }],
  '29': [{ b: 6, cpu: 0xA479, n: 'RNG vocalize (LEB71&15==0, A477 path)' }, { b: 6, cpu: 0xA823, n: 'RNG vocalize' }, { b: 6, cpu: 0xA89A, n: 'RNG vocalize' }, { b: 6, cpu: 0xA969, n: 'RNG vocalize' }],
  '2C': [{ b: 6, cpu: 0x9CF6, n: 'death chain (byte10<6 even; ->$9D09)' }, { b: 4, cpu: 0x96AC, n: 'death chain twin (byte10<6 even; ->$96BF)' }],
  '2D': [{ b: 6, cpu: 0x9499, n: 'dungeon BGM restore (byte10==2, L9497)' }],
  '2E': [{ b: 6, cpu: 0x9491, n: 'Up-press door fanfare ($F3 game $80, L948B)' }],
  '2F': [{ b: 6, cpu: 0x989F, n: 'spawn helper LD790 tail + pos tables' }, { b: 6, cpu: 0x9AF3, n: 'spawn helper LD790 tail (2nd)' }],
  '30': [{ b: 6, cpu: 0x9325, n: 'powerup beep ($90=2, $10&7==3)' }],
  '31': [{ b: 6, cpu: 0xBB0D, n: 'trigger TBD' }],
  '32': [{ b: 6, cpu: 0xBB68, n: 'trigger TBD' }],
  '3B': [{ b: 6, cpu: 0x8207, n: 'Jason state init ($50/$F3 gate, byte10=1, L81F4)' }],
  '33': [{ b: 6, cpu: 0x861D, n: 'second hurt (byte10=1, $4F=$20; no restore)' }],
  '34': [{ b: 6, cpu: 0x8826, n: 'bomb press ($F3 game $40) + slot-14 gate + spawn actor $2A' }],
  '3C': [{ b: 6, cpu: 0x89B7, n: 'dungeon player hit (byte10=2, $4F=$20)' }],
  '3E': [{ b: 6, cpu: 0x8673, n: 'actor morph ($46=$1D + pos, $4D=$E4)' }, { b: 6, cpu: 0x88CD, n: 'slot backup to $03D0 + byte10=0' }],
  '3F': [{ b: 6, cpu: 0x9CFE, n: 'death chain alternate (byte10<6 odd)' }, { b: 4, cpu: 0x96B4, n: 'death chain alternate twin' }],
  '40': [{ b: 6, cpu: 0x9D06, n: 'death chain (byte10>=6)' }, { b: 4, cpu: 0x96BC, n: 'death chain twin (byte10>=6)' }],
  '41': [{ b: 6, cpu: 0x9E10, n: 'indirect vector via $7A/$7B (L9E21)' }, { b: 6, cpu: 0x9E4F, n: 'trigger TBD' }],
  '42': [{ b: 6, cpu: 0xA42B, n: '$55 vocalize grid (A40E: byte10==0,$52==0,$11&15==0)' }, { b: 6, cpu: 0xA91B, n: 'boss vocalize grid (A8FE, actor 99)' }],
  '43': [{ b: 6, cpu: 0xA5D3, n: 'bit-effect twin ($51!=0-gated)' }, { b: 6, cpu: 0xBA11, n: 'bit-effect twin ($51!=0-gated)' }],
  '44': [{ b: 6, cpu: 0x9E79, n: 'trigger TBD' }],
  '45': [{ b: 6, cpu: 0xAE16, n: '$11&7 grid vocalize (byte10!=0 skip)' }],
  '46': [{ b: 6, cpu: 0xB426, n: '$51-decay expiry ($51 hits 0)' }],
  '4A': [{ b: 6, cpu: 0x8C79, n: 'spawner (D851 family)' }],
  '4C': [{ b: 6, cpu: 0xB8D0, n: 'trigger TBD' }],
  '4D': [{ b: 6, cpu: 0x99E9, n: '$10&3 phase table L99ED -> $47 + actor init' }],
  '51': [{ b: 6, cpu: 0x857D, n: 'dungeon explosion (D4=6, C5 bit3)' }, { b: 4, cpu: 0x8C61, n: 'tank destruction (slot0->4, C5 bit3)' }],
  '2A': [{ b: 4, cpu: 0xA120, n: 'tank area-BGM select tail (LDA LA124,x at 0xA11D upstream)' }],
  '08': [{ b: 4, cpu: 0x9F8A, n: 'bit/$03FB-gated ($51=$C0)' }],
  '0A': [{ b: 4, cpu: 0xA09B, n: '$FD03 countdown + $10-BCS gate (chains $0B)' }],
  '0B': [{ b: 4, cpu: 0xA0A0, n: 'chained after $0A' }],
  '0C': [{ b: 4, cpu: 0xA892, n: 'LC144-gated spawn' }, { b: 7, cpu: 0x976A, n: 'enemy cue (D763)' }],
  '0D': [{ b: 4, cpu: 0xA835, n: 'LC141-gated spawn' }, { b: 7, cpu: 0x9777, n: 'enemy cue (D770)' }],
  '0E': [{ b: 4, cpu: 0x9B91, n: '$11&$4F-grid-gated + spawn' }],
  '10': [{ b: 4, cpu: 0x9941, n: 'LC141-gated branch' }],
  '11': [{ b: 4, cpu: 0xA61D, n: 'LC144-gated' }],
  '12': [{ b: 4, cpu: 0x978F, n: 'alternate entry ($51==0)' }],
  '14': [{ b: 4, cpu: 0x992A, n: 'LC144-gated' }],
  '15': [{ b: 4, cpu: 0x981B, n: '$51 countdown (==10) + spawn $71' }, { b: 4, cpu: 0x9842, n: '$51 countdown (==5) + 3x spawn $6B' }],
  '16': [{ b: 4, cpu: 0x986B, n: '$51 countdown (==$32) + spawn $6F' }, { b: 4, cpu: 0x988A, n: '$51 countdown (==$30) + spawn $6D' }],
  '1A': [{ b: 4, cpu: 0x8F93, n: 'spawn/init ($51=3 + pos table L8F9A)' }, { b: 4, cpu: 0xB12E, n: 'coord snap + spawn' }, { b: 4, cpu: 0xBBBE, n: 'spawn helpers' }],
  '1B': [{ b: 4, cpu: 0x9037, n: 'spawn/init ($51=3, zero pos)' }, { b: 4, cpu: 0xAF63, n: 'actor spawn ($50 shift->$52 hush set)' }, { b: 4, cpu: 0xAFF2, n: 'actor spawn' }, { b: 4, cpu: 0xB087, n: 'actor spawn' }, { b: 4, cpu: 0xBD05, n: 'coord snap + spawn' }],
  '1C': [{ b: 4, cpu: 0x910B, n: 'spawn/init ($C3==7 skip)' }],
  '1E': [{ b: 4, cpu: 0x8C91, n: 'tank hit ($4F=$20; fire-and-forget)' }, { b: 4, cpu: 0x8DE2, n: 'tank hurt path (2nd)' }],
  '35': [{ b: 4, cpu: 0x9233, n: 'spawn/init (byte10=8, $51=3)' }],
  '37': [{ b: 4, cpu: 0xAC80, n: 'actor init + spawn' }],
  '3A': [{ b: 4, cpu: 0xA024, n: 'RNG-gated (LC147)' }],
  '47': [{ b: 4, cpu: 0xB879, n: '$11&$1F grid (32f tank vocalize)' }],
  '48': [{ b: 4, cpu: 0xBA14, n: '$51-decay + actor init' }],
  '49': [{ b: 4, cpu: 0x8C82, n: 'txa==0 path (slot actor->5)' }],
  '4B': [{ b: 4, cpu: 0xADCC, n: '$FD03/$4F-gated' }],
  '4F': [{ b: 4, cpu: 0x9111, n: 'standalone post-RTS routine' }],
  '50': [{ b: 4, cpu: 0xAEC1, n: 'range-gated ($3F vs $18/$E8)' }],
  '52': [{ b: 4, cpu: 0xB03D, n: 'spawn actor $4E (hush-timer set path)' }],
  '01': [{ b: 7, cpu: 0x8516, n: 'dungeon<->dungeon door' }],
  '03': [{ b: 7, cpu: 0xB2AD, n: 'cutscene pulse (LF29F)' }],
  '17': [{ b: 7, cpu: 0xB2CA, n: 'cutscene loop end (LF2BE)' }],
  '36': [{ b: 7, cpu: 0x96B1, n: 'boss-HP threshold' }],
  '38': [{ b: 7, cpu: 0x8524, n: 'overhead transitions' }],
  '39': [{ b: 7, cpu: 0x84FC, n: 'same-area door' }],
  '3D': [{ b: 7, cpu: 0x8534, n: 'player death (C52A)' }],
  '4E': [{ b: 7, cpu: 0xB60A, n: 'intro cinematic (F5D9 loop end)' }],
  '54': [{ b: 7, cpu: 0xA30B, n: 'title (E309 init)' }],
  '18': [{ b: 7, cpu: 0x841D, n: 'cutscene/continue path' }, { b: 7, cpu: 0x8567, n: 'cutscene/continue path (2nd)' }],
  '19': [{ b: 7, cpu: 0xB8A3, n: 'nibble-adjust jingle (F88C)' }],
};
export function sitesFor(id) { const k = Number(id).toString(16).toUpperCase(); return SITES[k] || []; }
export function siteCount() { let n = 0; for (const k in SITES) n += SITES[k].length; return n; }

// ---- S2: area entry-music table (LCDC8, fixed bank 7) ----
// CDBA: DEC2 silence, A = $14 & 7, song = table[A], DECC queue. The 8 bytes
// sit code-tight between JMP DECC and entry_CDD0 (zero slack, exact replace).
export const AREA_TABLE = { BANK: 7, OFFSET: 3528, COUNT: 8 };
export function getAreaSongs(prg7) {
  if (!(prg7 instanceof Uint8Array) || prg7.length < AREA_TABLE.OFFSET + AREA_TABLE.COUNT) return null;
  const out = [];
  for (let i = 0; i < AREA_TABLE.COUNT; i++) out.push(prg7[AREA_TABLE.OFFSET + i]);
  return out;
}
export function serializeAreaSongs(base7, edited) {
  const errors = [];
  if (!(base7 instanceof Uint8Array) || base7.length < AREA_TABLE.OFFSET + AREA_TABLE.COUNT) return { ok: false, errors: ["bad-bank7"] };
  const out = base7.slice();
  const keys = Object.keys(edited || {});
  for (let i = 0; i < keys.length; i++) {
    const idx = +keys[i];
    if (!(idx >= 0 && idx < AREA_TABLE.COUNT && (idx | 0) === idx)) { errors.push(keys[i] + ':bad-idx'); continue; }
    const v = edited[keys[i]];
    if (!Number.isInteger(v) || v < 0 || v > SONG_TABLE.MAX_ID) { errors.push(keys[i] + ':range'); continue; }
    out[AREA_TABLE.OFFSET + idx] = v;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], bytes: out };
}
