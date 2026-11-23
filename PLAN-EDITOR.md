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
  (mapPtr, scrollPtr); mapPtr table = 6 pointers: bg palette (16B),
  combo attrs (N x 1B), combos (N x 4B: 4 pattern indices), structures
  (M x 4B: 4 combo indices), blocks (K x 4B: 4 structure indices), map
  (32x32 block indices = 1024B; overhead L9 = 800B, L13 = 928B).
  Scroll = 16B (8B vertical + 8B horizontal flags over 8x8 screen grid,
  grid offset +32/+32px). Combo attr bits: 0-1 palette, 2-3 door/overhead
  entrance, 4 damage, 5 ladder, 6 water (solid+water = breakable), 7 solid
  (solid+door = scrolling-region doorway). Overhead physics bits DIFFER —
  do not assume tank meanings when editing overhead combos.
- 2.3 Free space (growth headroom, same-bank only): bank0 628B, bank1 2005B,
  bank2 1437B (per ROM map). Tables may be intermixed/relocated within the
  bank; pointers make it explicit ("data ... could be intermixed").
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
  catbox -> fetch_url scratch/page-X.zip -> extract over src/bm/ ->
  PACKAGING/MANIFEST/README -> page_refresh boot-verify.

## P0-COMPLETE (2026-11-23, frontend e8ccd45, bundle 0.2.50).
All acceptance checks that can run without a user-supplied ROM pass: node overlay suite 15/15, node wasm/mesen byte-equality 5/5, browser end-to-end 19/19 (resolve/patch/gates/UI), movie fields 3/3, boot log clean (shell ready, zero errors). Residual (needs ROM): live boot of a modded pack + replay pack-mismatch refusal on a spawned engine; save/load pack-gate code is in place and syntax-checked on both hosts.

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

### P2 — CHR + palette editors
Steps: chr.js 2bpp codec; 8x8 pixel editor bound to (bank,tile), live
preview with level palette; per-level palette editor (16B); write-back via
overlay patches.
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
- 6.2 Overhead physics bit meanings (needed for P1 overhead attr editing):
  Data Crystal flags they differ; find door/entrance semantics for
  overhead combos (door bits 2-3 are shared; solid/damage/ladder may differ).
  Verify by in-game observation.
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
