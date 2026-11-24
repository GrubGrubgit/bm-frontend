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
  c. Boss-room linkage (this is 6.3, required for P3 placement safeguards).
  d. Sprite-bank assignments per level (which 4KB CHR banks the PPU maps for sprites per area; Data Crystal CHR-ROM table covers bg only).
  e. Sound engine (song/sfx table layout; future music editor).
  f. Tank/Jason physics constants (accel/friction/jump arcs; would ground a future physics-accurate preview).
  g. Enemy AI state machines per type (behavior tables beyond spawn placement).
  h. Password/save encoding (continue-system math).
  i. Text/dialog encoding (font + message tables; future script editor).
  Rule: every item closes with a headless proof (byte-equality or observed in-engine effect), same bar as 6.2.
- 6.3 Boss-room linkage (P3): how bosses bind to rooms/levels; death-warp
  and $03FB boss-bit interactions must keep working with edited spawns.

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
