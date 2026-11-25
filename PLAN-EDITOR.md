# PLAN-EDITOR — in-app level/game editor + custom packs (device canonical)

Status: APPROVED order (user 2026-11-23). Phases run in order: P0 pack
plumbing -> P1 map editor -> P2 CHR/palette -> P3 enemies (after bank-3 RE).
A phase is DONE only when ALL its acceptance checks pass, then rebundle +
workspace sync per the release checklist. SPEC.md stays authority on
conflict; this doc is the editor work order. Workspace mirror pointer:
perchance workspace scratch/CURRENT_TASK.md ("NEW: in-app level/game
editor") — the workspace src/bm/ tree is a GENERATED BUNDLE, never hand-edit.

## 1. Goal / non-goals
- Goal: users open an Editor from the app shell, edit tile-map layouts
  (dungeon levels 1-8 AND overhead levels 9-16), enemy/object placement,
  doors/entrances, scroll regions ("rooms"), palettes, CHR patterns, and
  enemy attributes; save the result as a custom pack; the Game section can
  import and boot custom packs (patched bytes replace the extracted pack at
  spawn on BOTH engines).
- Non-goals (explicit): brand-new levels (level count/flow hardcoded in
  engine code), resizing the 32x32 block grid (engine-indexed), CHR bank
  count/layout changes. New rooms only via unused map regions + scroll
  borders (see 2.3). No engine-code changes in any phase.

## 2. Verified facts (do not re-derive; re-verify only if ROM changes)
- 2.1 ROM layout (Data Crystal ROM map + Data Structures, VERIFIED byte-exact
  against work/roms-dev/blaster-master-usa.nes 2026-11-23: bank0 L1 pointer
  chain pal 0x20 / combo 0x30 / struct 0x298 / block 0x668 / map 0x994 /
  attr 0xD94 / scroll 0xE2E; palette bytes match 1t palette; map length math
  0x994+1024=0xD94). PRG = 8x16KB. Banks 0-2 hold level data:
  bank0: levels 1-5; bank1: 6,7,8,9,11; bank2: 13,10,14,16,12,15
  (levels 9-16 = overhead). Bank3 (file 0xC000-0xFFFF): enemy/powerup data
  (offsets UNRESEARCHED — see 6.1). Banks 4-7: engine code (hands off).
- 2.2 Level record (per level, all pointers same-bank, level paged at 0x8000;
  file offset = ptr - 0x8000 + bank*16384): bank head has per-level
  (tablePtr, scrollPtr); table = 6 pointers in FIXED order [pal, attr,
  combo, struct, block, map]: bg palette (16B), combo attrs (N x 1B),
  combos (N x 4B: 4 pattern indices), structures (M x 4B: 4 combo
  indices), blocks (K x 4B: 4 struct indices), map (32 cols x rows =
  1024B tank rows=32; overhead L9 = 800B rows=25, L13 = 928B rows=29).
  Lengths derive exactly: attr runs to the next span (attr count ==
  combo count), combo = 4x attr, struct/block run to the next span
  (multiples of 4), map fixed per level, pal/scroll/table fixed.
  Inter-table gaps exist (L10/L12/L14/L16: 4-12B after combos) and are
  preserved; bank-tail free starts (bank-relative): bank0 0x3D8C,
  bank1 0x382B, bank2 0x3A63. Geometry (measured headless: 2-block
  stripe period 128px, 8px grid): pattern 8x8, combo 16x16, struct
  32x32, block 64x64, row-major [TL,TR,BL,BR] PROVEN exact (2026-11-23: full 32x30 L1 spawn vicinity reproduced the live PPU nametable + attrs 960/960 under the unique surviving arrangement of 8 hypotheses; tile pixels mean-ham 0.12/64 vs live frame; settled PPU palette RAM byte-identical to the level pal). Screen = 4x4 blocks.
  Scroll = 16B (8B vertical + 8B horizontal flags over 8x8 screen grid
  (V byte i = screen ROW i, bit j = column j (column-hypothesis refuted
  headless); H byte i = screen row i, bit6 = +32px camera-origin row
  flag; V bit6 = NO shift, confirmed 2x), grid offset +32/+32px). Combo
  attr bits, tank: 0-1 palette, 2-3 door/overhead entrance, 4 damage,
  5 ladder, 6 water (solid+water = breakable), 7 solid (solid+door =
  scrolling-region doorway). Overhead (6.2 PROVEN headless 2026-11-23):
  0-1 palette, 2-3 door/entrance (all 15 overhead transit-door table
  entries sit on door-bit combos), 4 NO damage effect on Jason, 5 UNUSED
  (absent from every overhead level), 6 solid-only (0xC1-0xC3; walkable
  0x42 probe at full speed), 7 solid. Transit-door table: fixed bank
  $DD7E (areas) / $DDEA (xhi) / $DE56 (yhi), entries (area, xhi, yhi) in
  X_raw>>8 units, EOR-1 paired two-sided.
- 2.3 Free space (growth headroom, same-bank only): bank0 624B, bank1 2003B,
  bank2 1471B (TRUE compact capacity = 16384 - head/slack - all table spans,
  proven by grow-until-overflow: 620/2000/1468 usable at 4-alignment; the ROM
  map's 628/2005/1437 counts a few unusable head-slack/hole bytes).
  Tables may be intermixed/relocated within the bank; pointers make it
  explicit ("data ... could be intermixed").
- 2.4 CHR: pack stores 16x8KB chr banks (= 32x4KB physical). Per-level
  sprite/bg bank assignments documented in ROM map CHR section. Patterns are
  standard NES 2bpp 8x8 tiles. Level bg palettes listed in ROM map Misc.
- 2.5 Pack architecture (device frontend/src): pack = {meta, prg[8x16KB],
  chr[16x8KB]} in IDB (pack/store.js, key "v1"). wasm host stages banks via
  bm_stage_ptr/bm_load_prg/bm_load_chr (core/host.js spawn). Mesen host
  rebuilds the full ROM from the pack (_buildRomBytes, core/mesen_host.js).
  => A patch overlay applies cleanly to BOTH engines at spawn. Movies stay
  deterministic (record pack crc in movie at record time; refuse/warn on
  mismatch at replay — see 3.4).
- 2.6 Shell (workspace index.html is the GENERATED copy; source is device
  frontend/www or equivalent shell markup + frontend/src/app.js L6 shell):
  Game section (start/reset/pause/stop/slots), ROM loader L1, engine
  picker (wasm/mesen). Editor gets a shell button + its own view; Game
  section gets a pack selector (stock vs custom).

## 3. Architecture decisions (locked)
- 3.1 Custom pack = {baseCrc (stock ROM crc32), patches: [{bank:
  "prg"|"chr", bankIndex, offset, bytes(base64)}], meta:{name, builtAt,
  editorVersion}}. Full-bank replacement allowed but patch list preferred
  (small, diffable, shareable). PACK_VERSION bump (schema.js) -> v2 with
  reader accepting v1 (stock) and v2 (custom); validatePack extended.
- 3.2 Application order at spawn (both hosts): load stock pack -> apply
  custom patches in order -> stage/rebuild. One shared pure module
  (pack/overlay.js, no DOM): applyOverlay(stockPack, customPack) ->
  {pack|errors}. Bounds-checked: every patch must land inside its bank;
  baseCrc must match the loaded stock pack or spawn refuses with a message.
- 3.3 Storage: IDB packs store gains key "custom-<id>"; store.js gains
  saveCustomPack/listCustomPacks/deleteCustomPack (same DB, same patterns).
  Export = download JSON file; import = file picker + validate + save.
- 3.4 Determinism rule: movies record activePackCrc ("stock" or custom id);
  replay with a different pack shows mismatch warning and refuses (or
  explicit override). Savestates are pack-scoped (slot key includes pack id).
- 3.5 Editor reads the LOADED pack (stock or custom) and writes a NEW custom
  pack (never mutates stock in place; "Save as" naming). All editor parsing
  lives in pure modules (pack/levels.js: pointer-chain parser + serializer;
  pack/chr.js: 2bpp codec; pack/enemies.js in P3) with headless tests.
- 3.6 No hand-edits to workspace src/bm/ ever. EXCEPTION that is not an
exception: the workspace root index.html (generator page shell markup)
mirrors the device index.html shell section by hand on every sync that
changes shell DOM (the bundle only carries src/bm/index.html, the
standalone copy). Verify the row placement matches in both files. Editor ships via the normal
  release path: device build -> make-www --version X -> mk-page-zip ->
  PRIVATE transfer only (chunked base64 over the bridge exec channel or
  another user-approved private path — NEVER a public file host; catbox
  and equivalents are BANNED, user order 2026-11-24) -> reassemble +
  sha-check vs the device PAGEZIP line -> extract over src/bm/ ->
  PACKAGING/MANIFEST/README -> page_refresh boot-verify.

## P0-COMPLETE (2026-11-23, frontend e8ccd45, bundle 0.2.50).
All acceptance checks that can run without a user-supplied ROM pass: node overlay suite 15/15, node wasm/mesen byte-equality 5/5, browser end-to-end 19/19 (resolve/patch/gates/UI), movie fields 3/3, boot log clean (shell ready, zero errors). Closed on device 2026-11-23 with the reference ROM (work/roms-dev/blaster-master-usa.nes, crc bc300047): ~/verify-pack-p0.mjs 32/32. CHR-modded pack boots trap-free and renders changed video (stock vs mod fnv differ); wasm loaded-PRG/CHR readback is byte-equal to the overlaid banks through the exact spawn load sequence; real GameHost.packGate throws pack-mismatch on cross-pack load and passes on match/legacy; real MesenHost._buildRomBytes rebuilt ROM carries the overlay bytes; replay gate (app.js condition) fires on real parsed movies for custom-vs-stock and passes on match/legacy-v1, as does the mesen save-gate condition. No user-supplied ROM was ever needed; the device reference ROM covers it.

## 4. Phases
### P0 — Custom-pack plumbing (no editor UI beyond shell hooks)
Steps: schema v2 + validate; overlay.js + bounds checks; store custom CRUD;
host.js + mesen_host.js apply path; shell pack selector (stock/custom list,
import/export buttons, delete); movie pack-crc record + mismatch guard;
headless tests (overlay apply, bounds reject, baseCrc reject, both-host
byte-equality: patched staged bytes identical for wasm-stage and
mesen-rebuild paths).
Acceptance: stock boot unchanged (zero diff); a hand-made 1-byte patch pack
boots on BOTH engines with the byte visible in staged bytes; export/import
round-trips; wrong-base pack refused with message; movie mismatch refused.

### P1 — Tile-map editor (dungeon + overhead)
Steps: levels.js parser/serializer (pointer walk, table length by next-diff
with pointer-table order fallback, free-space accounting per bank);
map canvas (block grid paint, region/scroll overlay, door-combo highlight);
combo/structure/block browsers + attribute bit editor (per-mode bit
meanings); scroll-boundary editor (8x8 toggles + legality hints: rectangular
regions, doorway connections); palette viewer (edit in P2); write-back
(relocate grown tables into free space, update pointers, fail loudly if
overflow); headless round-trip tests (parse->serialize = identical bytes
for all 16 levels; grow-table relocation test).
Acceptance: all-16-level byte-identical round-trip; edited map boots and
plays on both engines (warp + walk a scroll region on wasm); overflow
produces an error, never a corrupt pack.

### P2 — CHR + palette editors (CLOSED 2026-11-24, frontend commit P2, tools/verify-pack-p2.mjs 20/20)
Done: src/pack/chr.js 2bpp codec (decodeTile/encodeTile/bank helpers, copy-on-write setTile);
8x8 pixel editor bound to (4KB bank, tile) with bank picker defaulting to the level bg bank
(BG_CHR_BANK labels), 256-tile grid, 4 inks + subpalette select, tile preview in all 4
subpalettes, live map repaint via chrBankView overlays; per-level 16B palette editor
(16 slot buttons + full 64-color picker, same-size edit = serialize fast path, in-place);
write-back via overlay patches (chr area, base = active pack, diff vs stock; prg path
unchanged). editorVersion p2.
Acceptance (all headless): codec round-trips all 16 stock chr banks (8192 tiles) +
rejects bad input; pal edit = one run inside the pal span, reparse ok; most-used L1 tile
solid + sky/accent pal shift boots trap-free on wasm with identical gameplay state
(warp(0) tank, same px) but different video at f3000; mesen stock-vs-edited SAD 400k /
14.6k px fullscreen. (Calibrations learned: title-screen video is edit-invariant —
compare gameplay frames; wasm f4300 converges because the tank walks out of edited L1;
mesen needs Start+Right drive script, no warp available.)
Acceptance: pixel round-trip; edited tile visible in-game on both engines.

### P3 — Enemies (gated on 6.1 bank-3 RE)
Steps: enemies.js tables (attributes + placement/spawn lists + boss rooms);
attribute editor (HP/damage/speed/sprite fields per RE); placement editor
(add/move/remove spawns, room bounds checking); boss-room safeguards.
Acceptance: per RE doc + in-game verification (warp to edited room, observe).
  STATUS 2026-11-24: placement core DONE (not yet committed as P3-acceptance).
  src/pack/enemies.js: parse/serialize all 16 sublists (triplet + t[n+1]/x[n]/y[n],
  t[n]=$FF terminator enforced immutable, types <0x80, B7 y-tail past xlen
  excluded incl. $BF53 stub; add/remove fail loudly, P3b) + engine sprite
  tables SPR_A/SPR_B ($B51/$B7C) + spriteFor. Editor enemies tab: per-area
  record table (type/x/y edit, sprite preview, boss-record warning names the
  $20 record per tank area, 6.3 CLOSED 34/34); save path via overlay
  prg-bank-3 patches (editorVersion p3).
  P3c CLOSED 2026-11-24: per-type HP/damage editing (bank-6 table, byte0=HP byte1=damage; lib getStatEntry/serializeStats; editor stat table per overhead area, GLOBAL-per-type, traps locked, tank areas 6.1c-gated). tools/verify-pack-p3c.mjs 25/25 green (static guards + boot: slot byte13==HP, first-drop==damage, tank unaffected). Editor save writes bank-6 patches via overlay diff. P3 placement now add/remove + attribute capable; REMAINING for P3 acceptance: in-page editor smoke post-mirror.
  P3b CLOSED 2026-11-24: zero-sum compacting rebuild (region [0x219B,0x3CA5)
 exactly full, 0 slack: every add funded by removals, over-budget rejected).
 tools/verify-pack-p3b.mjs 27/27 green (no-op byte-identical, remove/add/move,
 boss-delete/retype rejected, boot: spawn gone/added, cross-area isolation,
 early-list edit moves every later triplet transparently).
 Editor: per-row delete (boss blocked), add form, budget readout, save picks
 rebuild when lengths differ else serialize. P3 placement now add/remove-capable;
 REMAINING for P3 acceptance: per-type attribute editing in UI (lib has 6.1b stat API),
 boss-room safeguards (6.3 CLOSED), editor smoke test post-mirror.
  tools/verify-pack-p3.mjs 17/17 green (round-trip identical, rejects bad
  input, overlay write path boots: type edit 00->05 gives actor 0x60, x edit
  moves spawn; warp(9) observed). REMAINING for P3 acceptance: add/remove
  records (needs bank-3 free-space map, P3b); per-type attributes HP/damage
  (6.1b CLOSED dcbc204, lib has stat API); boss-room safeguards (6.3 CLOSED:
  BOSS_REC/isBossRecord in enemies.js, editor names the boss record); editor smoke
  test post-mirror (UI wiring syntax-checked only).

## 5. Shell UI plan
- Editor button in shell grid (opens editor view; game view untouched).
- Editor views: level picker (1-16, tank/overhead badge) -> map canvas +
  inspector (selected block/combo/structure + attrs) -> scroll overlay
  toggle -> palette strip -> (P2) CHR tab -> (P3) enemies tab.
- Game section: pack selector (Stock + custom names), Import/Export/Delete
  custom pack buttons, active-pack shown in status + bug reports.

## 6. Research items (do BEFORE the phase that needs them)
- 6.1 Bank-3 enemy/powerup layout (REQUIRED for P3): identify tables via
  disasm cross-refs from the lifted actor-init/spawn path (vec007A family
  + B4xx/B5xx/B9xx init functions read spawn tables — trace addresses back
  to bank-3 ROM offsets), document record format, verify by patching one
  byte (e.g. enemy HP) and observing in-game. Estimate: small (days, not
  weeks) — spawn path is already lifted and understood.
  CLOSED 2026-11-24 (tools/verify-pack-6.1.mjs, 23/23 green: 8 static + 15 headless).
  Pointer chain (all bank-3 CPU-mapped addrs): EA3A(0x31) reads R1[1]=$A174
  (R1 = 16x16-bit LE table at bank-rel 0); EB51(area) indexes the 16-entry
  area list (8 A-subpointers tank + 8 B-subpointers overhead; area-1 = index
  9 = B1 = $B2A2); B-subpointer aims at a 3-pointer triplet
  [type[]][x[]][y[]] (B1 = [$B2A8][$B320][$B397]); CA89 (fixed bank) copies
  the triplet to ZP $00-$05 and round-robin-scans ($8E) entries whose
  ($00),y must be <0x80 (negative = wrap/end marker).
  Record format (parallel arrays): type[i] -> sprite base via LCB51/LCB7C
  ($0150) AND actor id via bank6 vector[0] init (bank6 $8000-table base
  $8002, entry (id-1), indirect jmp; actor-0x55 init at $A40B->$A4A4);
  x[i]/y[i] -> slot $0403/$0405 (pixel-hi; lo init $80); slot byte0 = 1
  (dormant) at spawn, $040D=$20; dedupe vs $0100 table, spawn idx -> $F8.
  Area-1 proven spawns: entries 0,2,0x0e,0x26 -> slots 8,9,10,11
  (x = $4B,$4F,$54,$52 matches array; slots 8/9 -> actor 0x55).
  One-byte proofs (deterministic x2, no trap, all controls identical):
  type[0] 00->05 changes slot8 actor 0x55->0x60 AND sprite $54->$5F
  (=LCB7C[5]) with changed rendered pixels (video SAD>0); x[0] $4B->$51
  moves slot8 spawn px-hi $4B->$51. Activation gate (documented, gated
  the x-run): byte0=1 dormant slots convert only in a ~32px camera band
  (fixed-bank vec $8124->$815B->$813C tests |pos-cam+8|&$7F<$20); patched
  entry stayed dormant to +600 (still proves x mapping), converts on
  approach (drive-run: slot8 cycled dormant->02->despawn->respawn).
  6.1b CLOSED 2026-11-24 (tools/verify-pack-6.1b.mjs, 25/25 green).
  Stat table (bank6, CPU $A36A, 30x4B entries e0-e29, ends $A3E1, code resumes
  JMP $A40A): byte0 = max HP, byte1 = contact/attack damage ($44 published to
  $7E grid, D697 subtracts $45&$7F from victim $53; $40 = L898D fallback
  constant). statidx = record type for types 0-29 EXCEPT type1->e2 (shares
  actor $59 with type2); types 30+ have no entry (HP stays $20 default).
  Proofs (deterministic x2): e5.byte0->02 type5 HP=02; e3.byte0->07 type3
  HP=07; e0.byte1 08->30 moves first-hit damage 08->30 (walk-right contact
  run, fine snaps); stock control first-hit=08.
  Type->actor empirical map (area-9 overhead, 64 values swept, determinism
  x2): 0:55 1:59 2:59 3:5c 4:5e 5:60 6:63 7:65 8:67 10:6b 11:6d 12:6f
  13:71 14:73 16:77 17:79 18:7b 19:4f 20:51 22:81 23:83 24:86 26:89 27:8b
  28:8e 32:32 33-41:35(subtype=type-33 in slot byte10) 42:25 43:27 44:29
  53:10 55:60 57:03(Sophia!) 58:86 62:86; no-actor outcomes: 30/31/46/50/59
  ->byte0 00, 51/63->dormant 01; TRAP set (area-9 init/behavior, x2 determin:
  9 15 21 25 29 45 47 48 49 52 54 56 60 61. Trap is activation-time (type9
  dormant to f80, traps by f150). Validity beyond area 9 NOT proven (area-12
  probe hit an unpatched out-of-band entry, inconclusive) -- editor must
  validate types per area before packing (P3 follow-up).
  Type->actor conversion CODE location still open (micro-item): actor id
  reaches slot byte0 between spawn and activation; writers audited (CA89=01,
  LC928/DF29 full-copy, D851/DF46 script-spawn) but the dormant->actor step
  for table spawns is unidentified.
  A-group consumer CLOSED: warp_raw(0..5,7) -> $14=area, ZP parks A-group
  triplet tail (area0: a1 27 a2 ac a2 = A0), slot8 spawns (area0 entry92
  type14 -> actor 45, same CA89 path, ZP quirk: $00 reads 00, copy lands
  $01-$05). R1 others documented: R1[0]=$8004 variant table (EA3A $30
  callers, incl. C742 area-variant select via LC76A), R1[14]=$0042 ZP/SRAM
  stub path (dead, $D8 never written), R1[2..13,15] bank3 data (map/attr,
  exact decode future work). STOCK warp_raw(6) traps (area-6 entry itself
  broken pre-existing, not spawn-list-caused; A6 edits still valid data).
  6.1c CLOSED 2026-11-24 (tools/verify-pack-6.1c.mjs, 21/21 green).
  Tank stat table (bank4, CPU $B326, 16x4B entries e0-e15, ends $B366, code
  resumes JMP $B392): byte0 = max HP, byte1 = shot/ranged damage; bytes 2-3
  UNIDENTIFIED (never written). Stock rows: e0 04101a90 e1 01101a80 e2
  02101e70 e3 01101c50 e4 02102040 e5 01101a60 e6 08101a80 e7 012021ff e8
  18201cff e9 08201ca0 e10 08181a80 e11 08181a80 e12 06201c50 e13 083020ff
  e14 203022ff e15 04201aa0. HP row matches alone-method sweep 16/16.
  Proofs (deterministic x2): e1.byte0->07 type1 spawn HP=07; e1.byte1
  16->48 moves walk-right hits 16/16/16 -> 16/48/16 at identical frames
  (f310/405/535; first hit is CONTACT on a separate fixed path, T1 = 16
  regardless of byte1). Dispatch: EA3A($40) = bank4 R1[0]=$8006 vector
  base; EB51(actor-1)->init; vent spots 0x45->$BE61 0x5B->$9FB7
  0x63->$A589; filler sets dormant=01/HP=$20 (bank7 LCB), converter
  overwrites actor+HP from the table (converter type-read: single bank4
  LDA ($00),Y at rel $76B, routine boundaries open micro-item).
  Tank type->actor map (area-0 alone-method sweep, all 64 types, x2):
  1:27 2:2a 5:31 6:33 8:38(+4x 0x4F spawner children) 9:3a 10:02 11:3e
  12:40 13:42 14:45 15:47 16-31:empty(01) 32:5b egg 33-41:23 powerup
  (subtype=type-33 in slot byte10) 43/45/63:dormant(00) 46:5b 47:5d
  48:0x74 PAIR (splitter, two spawns one record) 49:63 boss HP $80
  (source unknown, NOT table -- e49 unmapped, masking ruled out by
  e1-byte0->7 test leaving T49 at $80) 53:6a 54:6c 56:70 57:72 58:74
  62:4f; TRAP set (activation-time, x2): 0 3 4 7 42 44 50 51 52 55 59 60
  61. Lib: TANK_STAT_* + tankStatIdxFor/tankStatByteRel/getTankStatEntry/
  serializeTankStats + TANK_TYPE_ACTOR/TRAP/DORMANT/tankEmptyType in
  src/pack/enemies.js. Open micro-items: boss-HP-128 source, T48 splitter
  mechanics, T63 phantom player damage (HP df w/ no visible spawn),
  T46/47 byte11=8b vs T32 4c, converter routine boundaries. Tank
  attribute editing in UI CLOSED as P3d 2026-11-24 (see tail).
- 6.2 Overhead physics bit meanings (CLOSED 2026-11-23, headless proofs):
  door bits 2-3 shared (all 15 overhead door-table entries sit on 0x8/0x9/
  0xB combos); bit7 solid (boundary-exact stops; cleared cells entered);
  bit4 harmless to Jason (hurt-rate 17% on 0x10 vs 43% open-floor control);
  bit5 unused (absent overhead-wide); bit6 solid-only (0xC1-0xC3; walkable
  0x42 at full speed). Control method: dismount via game-Select hold
  (pad 4 = game bit $20), then warp_raw(k) as Jason; 4-way top-down
  movement confirmed. (Pad map is bit-reversed in this build: game button
  bit i = pad bit 7-i.) Live door transit remains un-triggered (Down-edge
  gate decoded at bank6 $82E4 -> $D238/$D1EF(1) -> $B7=1 -> dispatcher
  $C465 -> $C4C8 -> table scan $C7A8; observed $B7=2 events were
  enemy-damage state, not doors); not required for P1 since the table
  data is ground truth for the highlight.
- 6.4 Full-game RE backlog (user order 2026-11-24: record now, pursue after P3; long-term goal is a complete reverse-engineering of the game). Not gated on anything; pick items as editor phases demand them:
  a. Per-level sprite palettes (would let the P2 CHR tab preview sprite banks exactly; currently bg-palette approximation, recorded as known limitation).
  b. Bank-3 enemy/powerup record formats (this is 6.1, active now as P3 groundwork).
  c. Boss-room linkage (CLOSED as 6.3 below; was required for P3 placement safeguards).
  d. Sprite-bank assignments per level (which 4KB CHR banks the PPU maps for sprites per area; Data Crystal CHR-ROM table covers bg only).
  e. Sound engine (song/sfx table layout; future music editor).
  f. Tank/Jason physics constants (accel/friction/jump arcs; would ground a future physics-accurate preview).
  g. Enemy AI state machines per type (behavior tables beyond spawn placement).
  h. STRUCK 2026-11-24 (not applicable to this game): header battery bit is clear (no SRAM), no PASSWORD/SAVE strings anywhere in PRG; the sole CONTINUE hit is the game-over menu text (CONTINUE/END at PRG 0x1F7C4). There is no password or save encoding to reverse-engineer.
  i. Text/dialog encoding (font + message tables; future script editor).
  Rule: every item closes with a headless proof (byte-equality or observed in-engine effect), same bar as 6.2.
- 6.3 Boss-room linkage (P3 safeguards) CLOSED 2026-11-24
  (tools/verify-pack-6.3.mjs, 34/34 green: 20 static + 14 dynamic, all x2).
  One type-$20 record per tank area (static census A0-A7 at idx
  29/125/164/3/186/19/42/122). In-band it spawns actor $5B (boss egg),
  proven headless in A0/A1/A2/A3/A4/A5/A7 (A6 honest-open: warp_raw(6)
  traps on stock and the cooked-warp spawn trajectory never covers its egg;
  A6 rests on the static unique-type fact + the 7-area pattern).
  Chain (bank4): $5B egg, $51=$C0 countdown ~192f -> area boss (observed
  A0->0x63, A5->0x5F; L9FE6 table reads 62 5E 60 5C 64 5E 5C 66, so observed
  = table+1 -- which routine adds +1 is an open micro-item). Kill: boss
  HP->0 -> A07B, $03FD counts to $80 -> LA100 sets the $03FB area bit
  (LBF8A masks 01..80) + actor $5A; re-entering then spawns $68/$6A (area 7
  gets $68), or jumps LC14A/D804 when the $03FC area bit is set. $03FC is
  normally $00 (sole direct writer is new-game clear; gameplay sets bits via
  the hidden jsr-A072/ora/sta $03FC setter in data after L9FE6; readers in
  prg4/6/7 gate upgrades/variants). C742/LC76A area-7/15 variant is
  static-proven (boss bit7: level $0A else table 05 03 06 04 07 03 04 09;
  door path only -- no headless door driver exists, dynamic open).
  Spawn mechanics mapped en route (CA89 28/27px registration gate, $0100
  dedupe holds record indices via sta $F8,y, CBA9 $FF-clear, $8E cursor is
  scratch reuse and raw warps do not reset it: future spawn tests must place
  records in the SETTLED camera band and mind cursor history; A5 boss
  behavior traps the recomp engine ~f2000, a pre-existing area-5+ vector gap
  -- keep boss-active windows short). Editor rule: NEVER delete/retype/move
  the boss record far (kill sets $03FB; the egg needs its camera band).

## P4 Enhancements menu + entrance save system CLOSED 2026-11-24 (user order 2026-11-24)
- Decisions: saving OPTIONAL, default off (original experience preserved);
  new Enhancements panel modeled on cheats/tweaks (future home of widescreen;
  earlier widescreen research not found in repo -- re-research when ordered);
  save points at area/dungeon entrances: Up on entrance -> save prompt (Down
  still enters, unchanged); NO passwords ever (exact-state saves).
- Door/entrance RE (headless-proven, see 6.4i probes): dispatcher b7
  C78F/C79D/C7A8 -- 6-byte column pointers from [($7A)] ($DD76/77); scan
  INY/BNE over Y: areas[Y]==$14 AND xcol[Y]==$49 AND ycol[Y]==$4B (EXACT byte
  equality, no tolerance); FOUND: Y^=1 (EOR-1 pair), $14/$49/$4B = pair row
  (teleport). Player X=$49, Y=$4B (dispatcher WR(0x49)/WR(0x4B) post-Down-gate).
  Down gate b6 $82E4: $F3&$04 (Down) + X=$4E slot state ($0500+X>=$C0, bit $08)
  via b7 D238, then $B7=1. Up game-bit = $08 (bit-reversed pad map).
  Up-save mirrors the same qualify + overlap test in JS.
- Engine: bm_freeze/bm_thaw in bm_api.c (full live state at host_frame edge;
  tailcall model resumes exactly); proof = freeze@F, run, thaw, hash-equality.
  Rebuild via tools/build_game.sh; full battery re-green (engine change).
- UI: Enhancements <details> (enable checkbox default off, slots, widescreen
  placeholder), Up-edge detect in per-frame hook, pause + confirm menu, kv
  slots keyed by pack id, load into live instance at frame edge.
- Suite: tools/verify-pack-p4.mjs (overlap unit tests, freeze/thaw hash
  equality x2, kv round-trip, disabled-by-default untouched, prompt fires on
  poked-door + Up). Mirror game.wasm + UI files, MANIFEST hashes.

## 7. Risks
- Pointer-relocation bugs corrupting packs -> mitigated by byte-identical
  round-trip tests + validator + never touching stock.
- Overhead attr semantics wrong -> gate overhead attr editing on 6.2.
- Scope creep into new levels/engine flow -> explicitly out; say no.
- Bundle size: editor is dev-time UI; keep it lazy (dynamic import) so the
  game path loads nothing extra.

## 8. Decisions log
- 2026-11-23 user: phase order P0->P1->P2->P3 approved; plan doc first.
- 2026-11-23: pack overlay (not forked packs) so stock stays pristine and
  both engines share one apply path.
- 2026-11-23 P1 acceptance closed: all-16-level byte-identical round-trip (verify-pack-p1 57/57) + edited map boots and plays on BOTH engines (verify-pack-p1-play 15/15: wasm warp(0)+walk dx=9792 trap-free, mesen stock-vs-edited divergence + scroll motion).
- 2026-11-24 P2 debt closure (verify-pack-p2 26/26): save path covered by pure chr.js helper chrPatchDescs (saveAsPack uses it verbatim; diffRuns moved to overlay.js with editor re-export so old imports keep working); dead edChrPix container removed from shell; 5695c78 repaint-after-save recorded. Known limitation (NOT debt): CHR tab previews every bank with the level bg palette, so sprite banks preview approximately (per-level sprite palettes are un-RE'd; codec + write-back are bank-agnostic and covered). Next: rebundle 0.2.57 + private bridge sync.
- 2026-11-24 P2 closed (verify-pack-p2 20/20; P0 32/32, P1 57/57, P1-play 15/15, debt 45/45, 6.2 18/18 re-green = 187 checks): chr.js codec, CHR tab + palette editor in the editor view (shell gains palette-picker + CHR-tab DOM, mirrored to workspace root index.html), editorVersion p2. Next: rebundle 0.2.55 + private bridge sync. P3 (enemies, gated on 6.1 bank-3 RE) not started.
- 2026-11-23 P1 completion: H row-flag mapping + V row-indexed mapping proven
  headless (column-hypothesis refuted dynamically; V bit6 no-shift confirmed
  twice); door-combo highlight + H +32 row markers shipped; 6.2 closed
  (overhead attrs editable with honest per-bit labels; bit5 hidden as
  unused); framebuffer-vs-mesen scare closed as non-issue (matcher
  mirroring bug + idle spawn colors; NT d=0 at (288,800), NAT boot
  identical to warp(0)).
- 2026-11-23 P0/P1 debt closure (verify-pack-debt 43/43; P0 32/32, P1 57/57, P1-play 15/15 re-green): save slots are now pack-scoped keys (slot-N::packId, legacy slot-N fallback; store.slotKeyFor) so stock/custom saves coexist; bug reports + status line carry the active pack (report uses v2 movies); editor saves auto-activate the new pack + use newCustomId; brush max refreshes live; tiles.js arrangement comment corrected to PROVEN; levels.js exports bankFreeBytes with live per-bank free readout in the scroll-hint line; doorway hint is informational counts only (measured: stock maps legitimately contain doorless screens AND doorless regions, e.g. L1 V 2 doorless regions, so absence is never flagged — auto-checks stay stock-green; true door semantics wait on 6.2). No engine/recomp/disasm changes.
- 2026-11-24 P3e CLOSED (verify-pack-p3 43/43; battery p3b/p3c/6.1/6.1b/6.1c/6.3 re-green = 198 checks; 77728e3 pushed, mirrored): 16-warp palette survey proved warp_raw(k) loads level k<8?k+9:k-7 ($14 6 stock init trap excluded); shipped enemies-tab mapping was A/B-swapped every level. Fix: subLevel/subMode swapped, pure keyForLevel/levelForKey in enemies.js (editor delegates), stat gate on tank mode. Side finding: bank4 actor conversion lands ~250f (use span>=250 for bank4 actor asserts).
- 2026-11-24 P4 engine CLOSED (tools/verify-pack-p4.mjs 32/32; battery p3/p3b/p3c/6.1/6.1b/6.1c/6.3/p0 re-green): freeze+thaw BOTH at NMI-entry top (thaw_maybe, patch_vendor.py hook 5). First draft froze at end-of-nmi_frame: skipped the main-slice wait (wall+1/cycles-28k divergence). Fix: entry-freeze, byte-exact re-runs (K=1/10 ndiff=0). Wait-poll labels int_pc/nmi_pc (E93A/E93C) may swap rarely with identical gameplay (RTI discards; proof masks 8B). Door table: bank7 0x1D7E 108 rows, (9,69,75)r1<->(8,9,125)r0 (Down-drive proven), (10,85,7)r5<->(9,22,93)r4. New lib src/pack/doors.js. UI phase (Enhancements panel + entrance saves) next.
- 2026-11-24 P4 UI: Enhancements panel (opt-in, default off) + entrance saves. Up on a doorway captures the exact-state freeze and offers Save-to-slot; Down entry unchanged. Slots in IDB entrance-<n>::<pack> (apart from replay slots); loads stage thaw bytes and rewind live. Widescreen placeholder (disabled). New: src/ui/enhance.js, src/pack/entrance.js (pure detector: 6-frame stability, one prompt per side); hook entranceApply in host.js onFrame (suspended, read-only). Suite p4 now 44 checks (detector units + headless presnap/Up/capture/load flow).
- 2026-11-24 P3d CLOSED (tools/verify-pack-p3d.mjs 27/27 green: 21 static + 6 dynamic headless x2): tank-side per-type HP/damage editing via bank-4 table ($B326, 16x4B; lib getTankStatEntry/serializeTankStats pre-existing from 6.1c). Editor stat table now covers A-list areas (levels 9-16, $14 0-7), GLOBAL-per-type, trap types locked, boss egg ($20) noted HP-$80-not-table-driven, no-entry types listed (16-31 empty, 32+ special). Save writes bank-4 patches via overlay diff (base = active pack). Boot proofs: alone-method area-0 span-250 (byte13==HP for e1->07 and e14->09), walk-damage 16/16/16 control vs 16/48/16 patched at identical frames, B-area boot unaffected by tank edit. No engine/recomp/disasm changes.
- 2026-11-24 Text survey (6.4i groundwork, user-prompted): game text is plain ASCII in FIXED bank7 ($8000-mapped): SELECT START AREA AND PRESS START @rel 3525, CREDIT @35C8, ENTERING INTO AREA @3709, CONTINUE/END @37C4/37CD, LEFT @3814, full staff roll @3B40+ (VERY THANKS !! PRESENTED BY / DIRECTOR H.HIGASIYA / K.KITAZUMI / MANAGER K.YOSHIDA / GAME DESIGN FANKY. / CHARACTER DESIGN FANKY. / ART DESIGN / PGM-F1 / MUSIC COMPOSER NAOKI KODAKA / SOUND PROGRAM MARUMO ...). Separators observed: / and . (engine mapping TBD). Text-draw routine NOT yet identified (auto-disasm has no labels at these addrs); next step is xrefing loads from $B525-$BE00 to find it + the font tile/CHR bank. No dialog-box UI exists in-game (title/pause/game-over/credits only).
- 2026-11-24 Recommended working order (SUPERSEDED by P5 Enhanced-mode program below): 1) 6.4i font-map + text routine (small, unblocks 2); 2) save-prompt game-feel pass -- canvas overlay in the game typeface + pause-while-prompting, NO ROM patch (small, immediate P4 payoff); 3) 6.4d sprite-bank assignments then 6.4a sprite palettes (pair, exact CHR-tab sprite preview); 4) 6.4f physics constants (preview accuracy); 5) widescreen SPIKE first (likely infeasible on NES mirroring -- decide drop vs margins/HUD use -- before any implementation); 6) 6.4g enemy AI incl. 6.1c micro-items (big, only when behavior editing demands); 7) 6.4e sound engine (big, fully independent, anytime/parallel). Rationale: dependencies first, value/effort next, spikes before commitments, independent-big-items last.
- 2026-11-24 ARCHITECTURE RULE (user order): enhancements must live in the ENGINE (wasm core) behind a stable API, never in the shell -- they must work if the core moves to a different frontend. Current P4 save system violates this (DOM panel + shell log/IDB in enhance.js/store.js, JS detector on presnap). Required redesign (after 6.4i): engine owns doorway match (live RAM + bank7 table, no presnap), Up detector on pad bits, capture into static slot buffers, prompt state machine, pause (hold core, keep emitting frames), in-canvas prompt drawn into framebuf post-render in the game typeface, pad-driven choice, blob export/import + slot metadata exports. Frontend (any) only renders the canvas and persists opaque blobs. Proof bar: headless suite driving stable exports only (pad in, frames/blobs out -- no DOM), which itself proves frontend-independence. Wasm-core-only constraint unchanged (mesen has no exports).

## P5 Enhanced mode: engine enhancement platform (user order 2026-11-24)
- Vision: the stock game has no main menu and almost no menus at all (only the
  graphical pause display and the game-over CONTINUE/END cursor list at bank7
  rel 37C4/37CD). Enhanced mode adds: a master toggle, an injected main menu,
  an in-game pause menu, in-engine SRAM saves, and future enhancements
  (widescreen, map). All of it lives in the ENGINE (wasm core) behind stable
  additive exports per the 2026-11-24 architecture rule -- no shell dependence.
- Global bars (every phase): enhanced mode defaults OFF with stock behavior
  bit-identical (full battery re-green); headless proofs, same bar as 6.2;
  engine suites drive stable exports only, no DOM (proves frontend-portability).
- E0 6.4i text/font (PREREQUISITE for every menu below). Deliverables: ASCII
  byte->tile-index map, the text-draw routine entry + calling convention, the
  font CHR bank(s), control-code meanings (/ and . separators observed).
  Anchors: fixed-bank7 strings at rel 3525/35C8/3709/37C4/37CD/3814/3B40+.
  Menu precedent: game-over cursor list (reuses existing game structure;
  basic text-only menus are the target style, no wheel reinvention).
- E1 SRAM in-engine. The cart never shipped SRAM (header battery bit clear);
  we add NVRAM to the core (ROM-hack precedent exists for real hardware, so
  this is legitimate). Scope: in-core save storage, exact-state freeze/thaw
  slots (NO passwords, per P4 decisions), last-save tracking for Continue,
  blob export/import for frontend persistence, per-pack namespacing kept.
- E6 Enhanced-mode master toggle (build FIRST after E0 -- everything gates
  on it). Engine flag, persisted in the settings blob, default off. Shell
  checkbox binds it. Unlocks: main-menu injection, in-game settings changes,
  entrance saves, and all future enhancements.
- E2 Main menu (needs E0+E1+E6). Injection point: the title-screen Start edge
  and the intro-cutscene skip button -- instead of starting the game, enter
  the menu when enhanced mode is on (stock path untouched when off). Options:
  START (new game), CONTINUE (last save; hidden unless saving enabled and a
  save exists), LOAD (save-slot menu; same visibility rule), SETTINGS.
  Cursor-list style per the game-over precedent, game typeface via E0.
- E4 Settings core (needs E6; wanted by E2/E3 menus). Canonical store moves
  into the core: volume, mute, scale, filter, with get/set exports; shell
  prefs.js becomes a sync wrapper. Shell controls ALWAYS work (not locked
  behind enhancements); the in-game settings menu requires enhancements on.
  Engine/slot/pad-swap/pack/touch stay frontend-owned (not game settings).
- E3 In-game pause menu (needs E0+E1+E4+E6). Confirm headless FIRST that
  Select-during-pause is currently a no-op (pad injection + state hash),
  then bind it: CONTINUE (resume), LOAD (slot menu, saving-enabled only),
  SETTINGS (E4 store), QUIT TO TITLE (engine reset into the E2 main menu --
  the in-engine equivalent of pressing reset).
  2026-11-24 E3 findings (engine done, suite v3 tools/verify-pause-e3.mjs running on -O0):
  stock Start-pause video BLINKS (2-cycle, b7 latches $04), stock Select-pause video FREEZES (b7 untouched); resume is same-button-only.
  THAW CONSTRAINT (pre-existing, not E3): thaw of running-gameplay into a non-running destination wedges (idle message screen / freeze); destination must be booted+running (P4 only thawed title/transition/same-run).
  Hence LOAD uses resume-then-thaw (pmenu_pending_load: confirm closes menu + injects stock Start, sram_load fires when presnap $BE==1); suite is single-run throughout (no cross-boot thaw).
- 2026-11-24 E3 in-game pause menu CLOSED (tools/verify-pause-e3.mjs 49/49 green, full battery re-greened on ship build): engine-side menu in src/core/bm_api.c (E3 section). Opens on Select edge while Start-paused when enhanced (stock untouched when off). CONTINUE (stock resume via injected Start edge), LOAD (slot menu, saving-enabled only, resume-then-thaw via pmenu_pending_load), SETTINGS (E4 store), QUIT TO TITLE (in-engine reset into E2 main menu). Race-free pad_fn open (scan-241, returns 0 synchronously) + race-free CONTINUE confirm (same-frame Start so post-menu ram/full-state reconverges bit-identical with stock resume, probe30/31); post-dismiss echo swallowed by pmenu_swallow_cd=12; inject frame-counted in menu_tick. Stock models proven headless: Start-pause blinks + same-button resume, Select-pause freezes + same-button resume. Ship profile 2026-11-24 eve: -O0 + wasm-opt -O3 (1.32MB; bit-identical behavior, full battery green on the shipped bytes). clang -O1/-O2 builds were OOM/reap-killed all evening (device 387MB free + 3GB/4GB swap used by a sibling session; memguard STOPs + relay reaps session trees), so the C-level ship (-O2/-O3) is deferred to a quiet window (re-ship = rebuild + battery + mirror, no engine change).
NEXT: E5 (entrance-save engine port).
- E5 Entrance-save engine port (needs E0+E1+E6; SUPERSEDES the P4 shell
  implementation). Per the architecture rule: detector (live RAM + bank7
  door table, no presnap), capture, prompt state machine, pause-while-prompt,
  in-canvas prompt in the game typeface, pad-driven choice, core slot buffers.
  Shell enhance.js shrinks to blob persistence + optional slot list; the JS
  detector retires (keep for cross-check). Suite must be DOM-free.
- 2026-11-25 E5 entrance-save engine port CLOSED (tools/verify-entrance-e5.mjs 22/22 green, full battery re-greened on ship build 86b86abf): detector in menu_tick engine-side in src/core/bm_api.c (E5 section): presnap door-table overlap 6 frames + presnap $B7 bit0 transit marker (warp-init transients excluded, no BE gate), Up edge-or-held + once-per-side, race-free pad_fn open, prompt phase + slot cursor + level Start-inject pause with lazy render snap (BE 1->0 edge / b7&4 evidence / 240f backup), choices in pad_fn (A/Start save+resume via bm_sram_save crc 0, B/Select leave+resume, Down leave+resume+injected Down, Left/Right cursor), modal swallow, E3 interlock ev5_phase==0. F-suite lesson: save+resume reconvergence uses a prompt+B-leave control, never a never-paused control. Shell src/ui/enhance.js shrunk to toggles + engine-slot list + Mem<->browser shuttle (bm_sram_info/blob_ptr/len export, thaw-stage + bm_sram_store import with packCrc-hash crc, bm_sram_load direct Load) + per-frame enhanced/saving pushes (fixes the P4 gap where the shell never pushed saving_on); the JS detector module is retired but kept on disk. Ship profile: -O0 + wasm-opt -O3 (1.32MB). clang -O1/-O2 still OOM/reap-killed on device; C-level re-ship deferred to a quiet window (rebuild + battery + mirror, no engine change). NEXT: E7 spike, then E8.
- Build order: E0 -> E6 -> E1 -> E2 -> E4 -> E3 -> E5, then E7 spike, then E8.
- E7 True widescreen (needs PPU/scroll/mirroring RE). NOTE: a previous
  session judged feasibility promising but it was NEVER recorded (confirmed
  missing 2026-11-24) -- so this starts as fresh research, and this time the
  findings land in the plan either way. Spike first (record!): can the engine
  draw beyond the stock viewport (nametable/attribute/sprite-edge limits)?
  Implement or drop on the spike result.
- 2026-11-25 E7 SPIKE RESULT: DROP true widescreen (reversible render_wide probe at W=384 in bm_api.c, reverted after; render() untouched throughout, zero shipped-code change). Findings (dungeon area 9 driven + overhead areas 0-5,7 static, all mir==2 vertical mirroring): (1) static camera: extra strip 94-97% single color, 3-7 distinct colors vs 10-14 in main -- the offscreen NT holds no ahead-data; seam crop shows valid tiles to x=255 then void. (2) scrolled to scx=235: strip = ~21px genuine draw-ahead tail + wraparound duplicate of the room start (1.8% pixel diff at the correct +3 scroll alignment vs the scx=0 frame of the same run; 36-41% at wrong alignments -- decisive). (3) scroll-invariance: ahead-strip vs later-main pixels at the same world coords 0/24 columns match, 33-42% bad pixels -- the game draws columns on arrival and keeps no ahead buffer. (4) sliding-window argument: the strip is always ahead-of-camera, hence always undrawn by construction; vertical has zero headroom (240 = full NT height). True widescreen would require patching the game column-draw routines to maintain a wider live window (deep Sunsoft scrolling-engine surgery, high regression risk across all 16 areas) for an aspect gain the engine cannot source -- not worth it. Even a 272px widening would lean on undocumented draw-ahead margin. The widescreen checkbox in the Enhance panel stays a disabled placeholder.
- E8 Map system (own sub-plan; big). Minimap HUD filled in as you explore +
  full map on the pause screen (option or button press, TBD in sub-plan).
  Symbols for dungeon entrances, gates/doors, and upgrade-gated blocks
  (hyper/crusher). Metroid-style, plain, built from repurposed game assets.
  Sub-plan phases: M1 world/room-topology RE, M2 exploration tracking
- E8 SUB-PLAN (map system; static-first, engine/shell later):
  M1 world-topology RE CLOSED 2026-11-25 (src/pack/world.js + tools/verify-world-e8m1.mjs 12/12 green, no engine/shell changes): AREA_LEVEL rule a<8?a+9:a-7 PROVEN -- all 108 door sides land in-bounds on door-combo blocks of exactly that level (extends 6.2 overhead-only to all 16); 54 pair edges (involution, no self-pairs); per-level counts incl. L7 hub (26 sides, several intra-level pairs); walkable-border edges (tile-level, bit7=solid) + door edges = ONE traversable world (all 108 door screens mutually reachable; main component 763 screens); 64 isolated walkable pockets hold no doors (map margins or upgrade-sealed -- M3 fog-of-war + M4 symbols handle them; exact D counts pin the border rule). Screens are 4x4 blocks, 8 per row; rows 32 (25 L9, 29 L13).
  M2 exploration tracking CLOSED 2026-11-25 (engine visited bitmask 16 levels x 64 screens = 128B in bm_api.c + tools/verify-visits-e8m2.mjs 10/10 green; shell IDB persistence + union sync in store.js/enhance.js, harness check deferred to M3): mark in menu_tick when enhanced+gameplay (pregame gate built in), current screen from area+scroll center ((scx+128)>>8, (scy+120)>>8, clamped to level rows); zeroed in engine_reset_to_title (fresh boot + quit-to-title); E2 START/LOAD/CONTINUE leave bits alone; shell per-pack visits record (v1, 128 bytes) union-merged bitwise-OR both ways on pack switches, pregame edges and every 240 dirty frames, so quit/load ordering cannot clobber; exploration is per-pack monotonic, never auto-cleared (documented rule; M4 may add per-slot scoping). Shell sync has no headless harness yet (needs IDB/DOM) -- M3 covers it with a static-data harness (no game boot).
  M2 exploration tracking in-engine: visited bitmask (16 levels x 64 screens = 128B) + current-screen derivation (area+scroll) + exports (get/set/reset/ptr) + shell IDB persistence per pack; suite drives across screens incl. door transit + determinism.
  M3 HUD minimap CLOSED 2026-11-25, PORTED IN-ENGINE 2026-11-25 (user spec: all enhancements live in the engine, no shell overlay): framebuf post-process in nmi_frame after render() in src/core/bm_api.c (E8-M3 section): 2px/block thumbnails parsed from prg level tables in C (same layout as levels.js; map->block indirection included -- first draft dropped it and read past the block table, caught by the C-vs-JS thumb cross-check), 16-sample struct average quantized to nearest NES color (integer math, bit-exact JS twin in the suite), fog-of-war from visit_bits (unvisited dim 1/4, sub-map rows void black), gold door ticks at block precision, white/red player dot at screen center, 1px border; gate enhanced+gameplay+no modal (E2/E3/E5); framebuf-only (vram/ram/saves untouched, determinism preserved); thumbs cached per level, cleared on engine_reset_to_title + bm_map_invalidate (shell pack switches); exports bm_map_invalidate/thumb_hash/doors/visible (test observability). Shell enhance.js stripped to sync/persistence only (IDB union + invalidate hook). tools/verify-map-e8m3.mjs 14/14 green (16/16 thumb-hash C-vs-JS match, 16/16 door counts, pregame/gameplay/enh-off/modal gates, A/B confinement to rect, byte-exact expected rect incl fog+dot+ticks, determinism, shell statics); full battery re-greened on ship build. Pocket semantics unchanged (M3 plain fog; M4 symbols+legend). Ship profile: -O0 + wasm-opt -O3.
  M4 pause full-map CLOSED 2026-11-25 (engine-side E3 MAP row -> pmenu_phase 4, no shell changes): 2x full-level map (X0=64 Y0=8, fog 1/4, M3 thumb cache) with symbols: gold intra-level doors, white cross-area entrances (74 EOR-1 cross sides), cyan breakable borders (tank lv<=8 combo attr bit7+bit6, pinned 3/9/4/0/6/44/113/20), red/white player dot on current level; vram legend rows (MAP L/DUNGEON/GOLD DOOR/WHITE ENTRANCE/CYAN BREAKABLE/DARK UNSEEN/DOT YOU/LEFT RIGHT LEVEL/B BACK); Left/Right/Up/Down cycle 1-16 with wrap, B/A back (cursor MAP). New exports bm_map_brkcnt/brkhash/entcnt/mylv. tools/verify-map-e8m4.mjs 23/23 green; E3 suite updated for MAP row (runs A/H2/I re-timed) 49/49. Full battery green on ship build. Ship profile: -O0 + wasm-opt -O3.
  Open Q: pocket semantics (margins vs breakable-sealed -- decide display in M3); area-6 warp trap is pre-existing stock-init behavior (L15 top-row pockets nearby, possible link, not E8 business).
  in-engine, M3 HUD minimap rendering, M4 pause full-map + symbols/legend.
- 2026-11-24 E0 font-map CLOSED (tools/verify-text-font.mjs 16/16 green: 12 static + 4 dynamic headless x1): text bytes are ASCII with tile index == byte ($00 = blank/space separator; proven on the title screen: NT0 rows spell SUN CORPORATION OF AMERICA / LICENSED BY NINTENDO OF / (c)1988 with identity indices). Font glyphs live in CHR bank 3 $1000-half (4KB page 7 of concatenated stock.chr, offset 0x7000): digits + uppercase complete, $00 blank, $01-$03 present (possible cursor tiles for E2/E3 menus). Open micro-items: text-draw routine entry unidentified (NOT needed for engine overlay -- overlay blits harvested glyph pixels directly); literal $2E periods exist in the staff roll but tile $2E is blank on the title page (credits font page or routine translation TBD in E2).
- 2026-11-24 E2 main menu CLOSED (tools/verify-menu.mjs 15/15 green): engine-side menu in src/core/bm_api.c (E2 section, no shell dependence, suite DOM-free via stable exports + vram/RAM observation). Opens on the title-screen Start edge and the intro skip button when enhanced mode is on (stock path untouched when off). START (new game), CONTINUE (last save; hidden unless saving enabled and a save exists), LOAD (save-slot menu; same visibility rule), SETTINGS (E4-core store folded in: volume 0-10, mute, scale INTEGER/FIT/FILL/STRETCH, filter NEAREST/BILINEAR, with bm_setting_get/set exports; stored engine-side, shell sync deferred to E4 with the order adjustment recorded). Cursor-list + game typeface; menu text uses proven glyphs only (A-Z 0-9 space + $01 solid block for cursor/border; $3E/E25E, -, :, . are BLANK on the title page). Full-NT0 takeover drawn in nmi_frame, pad filtered while modal. Pregame gate (ram $DD==0 && $37E==0) keeps the menu out of gameplay/demo/game-over; dismissals repaint via transitions (START=new-game init, CONTINUE/LOAD=thaw restore, submenu BACK returns to main list); cooldown lasts until the game leaves pregame. RE findings: (a) the stock interactive CONTINUE/END menu is unreachable headless in 6000f soaks (post-death auto-continues, unattended title runs the attract demo) -- E2 defines its own cursor-list standard instead of chasing the precedent; (b) pad race: the game polls the pad in the main slice BEFORE NMI entry while the host sets the pad after menu_tick, so a tick-side open always loses (game starts AND menu opens) -- the Start-edge open moved into pad_fn itself (scan-241 sample, returns 0 synchronously, race-free by construction) with the edge consumed so the held Start cannot instant-confirm; tick-side open stays as idempotent backup; (c) new-game init writes DD=2/cont=5 ~600f AFTER the area-8 transition (not at it) -- tests must wait for real gameplay before forcing lives 0; (d) frame_no rewinds on thaw (E1 lesson reused; LOAD spans sized accordingly; mid-drive bm_boot NESTS the game loop, so the sticky-across-boot check uses a single-shot guarded boot); (e) bm_menu_dbg/bm_menu_dbg2 headless observability exports kept in shipped code (phase/cursor/prevpad/cooldown, pad+swallow). Battery on E2 build fully re-green: P3 43 + P3b 27 + P3c 25 + P3d 27 + 6.1 23 + 6.1b 25 + 6.1c 21 + 6.3 34 + P0 32 + P4 44 + E0 16 + E6 8 + E1 16 + E1b 15 + E2 15. NEXT: E4 (shell sync: prefs.js becomes a sync wrapper over the E2 store; shell controls always work, in-game menu requires enhancements).
- 2026-11-24 Lives/continues rule (user order): when saving is enabled, lives and continues are DISABLED (they make no sense with saves). Implemented in E1b (device 8a41630): infinite lives while enhanced+saving (life-loss respawn path unchanged, counter never decrements, game-over/continue-end unreachable). RE resolved in E1b: lives counter ram $DD (sole DECs C52A/C537), continues ram $37E (sole DEC C53B); game-over trigger C530 goes cold under the gate (C52A always takes the LC551 respawn path). Exact respawn semantics confirmed headless in E1.
- 2026-11-24 E1a SRAM core CLOSED (tools/verify-sram.mjs 16/16 green): 8x7836B in-core slots + metadata (area/x/y/frame/packCrc) + last-save + blob export/import/store + bm_saving_set/get flag. Rewind proof: masked-identical blob (poll labels 32-35/64-67 + ONE dead stack byte ram+0xF8/offset 884 -- S=249 in both runs, slot unreachable by pop, single diff of 7836, same P4 stale-stack phenomenon). Harness lessons: stage-once flags (frame_no rewinds on thaw); end-frame comparisons must use equal spans (frame_no-based G was off by one). Battery on SRAM build: P4 44 + E6 8 + E0 16 + E1 16 green. E1b CLOSED 2026-11-24 (device 8a41630, pushed, trees clean; tools/verify-lives.mjs 15/15 green): vendor hook 6 in tools/patch_vendor.py gates the sole lives-DEC (C52A/C537, ram $DD) + sole continues-DEC (C53B, $037E) on saving_on (anchor-asserted count==1 each; arithmetic restore, single RD, cycles/PPU untouched; flags reflect the un-decremented value so C52A always takes the LC551 respawn path and the LC55A->C29E game-over branch goes unreachable; new-game init WRs lives=2 at C301 / cont=5 at C2BC untouched). saving_on moved above the engine include in src/core/bm_api.c for hook visibility. Death driver: warp(9) dungeon B0 Jason, walk right, ram $40D HP 255->0; deaths at exact frames 1487/2095/2703 (x2). Saving-off control: lives 2->1->0->underflow $FF, cont 5->4, then STUCK (continue/game-over flow). Saving-on: 8 deaths all respawn (~243f, hp 255), lives=2/cont=5 frozen, death frames identical to control, $6F3==0 at every death (C530 direct-game-over branch cold). Boundary lives=0 forced stays 0 (never underflows). Mid-run saving-off resumes decrements (gate is dynamic). Mode-independence by construction: the two gated DECs are the only lives/continues decrements in the whole engine. Battery on E1b build fully re-green. NEXT: E4 (E2 closed below).
- 2026-11-24 E4 settings sync CLOSED (tools/verify-settings-e4.mjs 18/18 green): prefs.js is now a sync wrapper over the E2 core store (SCALE_ORDER/FILTER_ORDER, prefsToSettings/settingsToPrefs with documented 10%-step quantization, pushPrefsToEngine/pullEngineToPrefs no-ops without engine exports). app.js syncSettingsTick runs per-frame in presentFrame: first frame after any (re)spawn pushes shell prefs into the fresh engine (one hook covers shellStart/shellReset/replay spawns), later frames pull in-game menu edits into shell controls + video/audio + localStorage. All four shell controls (scale/filter/volume/mute) push live and are NEVER gated on enhanced mode; frontend-owned prefs (slot/engine/pack/touch/swap) never touch the core (static proof). In-game SETTINGS still requires enhancements on (engine pad_fn/menu_tick gates, only menu_adjust writes). Settings sticky across bm_boot (guarded single-shot proof). No engine/wasm change. Battery on final tree fully green: P3 43 + P3b 27 + P3c 25 + P3d 27 + 6.1 23 + 6.1b 25 + 6.1c 21 + 6.3 34 + P0 32 + P4 44 + E0 16 + E6 8 + E1 16 + E1b 15 + E2 15 + E4 18. NEXT: E3 (in-game pause menu).
