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
