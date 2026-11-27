# bm-frontend — Blaster Master web frontend (native port shell)

Plays the statically recompiled Blaster Master engine ([bm-recomp](https://github.com/GrubGrubgit/bm-recomp),
`recomp/gen/combined_enf.c` + `runtime.h`, pinned in `ENGINE_PIN`) in any
modern browser. Native port, NOT an emulator: there is no 6502 CPU and no
PPU/APU emulation — the lifted C IS the game logic; this repo is its
platform layer (frame timing in, WebGL video out, WebAudio audio out,
keyboard/touch/gamepad input in) plus a ROM-supplied asset pack the engine
runs off.

- You supply your own Blaster Master (USA) NES ROM locally (file picker /
  drag-drop). Nothing copyrighted ships in this repo or the pack cache
  except what your ROM provided at extract time in your own browser.
  Known-good dump: CRC32 `bc300047`. Headered or headerless both accepted.
- The same build runs on desktop and mobile browsers, as an installable
  PWA, and inside the Android WebView APK.
- Live site: https://grubgrubgit.github.io/bm-frontend/
- Releases (APK attached): https://github.com/GrubGrubgit/bm-frontend/releases

## Features

### Play

- Full game: overhead tank areas + side-view dungeon areas, doors, bosses,
  powerups, pause, game-over/continue flow — all executing as compiled
  game code in WebAssembly.
- Video: WebGL renderer, 256x240 guest framebuffer, CRT overscan view,
  scale modes (integer / fit / fill / stretch), nearest/bilinear filter,
  fullscreen. Includes the hardware-faithful 8-sprites-per-scanline limit.
- Audio: live NES APU event stream rendered to WebAudio (no samples).
- Input: keyboard, touch controls, and Bluetooth controllers (first-class).
- Replays: pad-log recordings with fast-forward, save/load slots that
  survive reload (IndexedDB), screenshots, headless self-test.
- `window.BM` shell for scripting/debugging: start/stop/reset/pause,
  frame-step, pad injection, stats, save/load, PWA helpers.

### Enhancements mode (optional, default off)

An opt-in menu for quality-of-life features. The stock game is untouched
when it is off.

- Entrance saves: save at area/dungeon doorways, reload any time.
- No lives pressure: lives/continues counters frozen while saving is on.
- In-game pause menu: Continue, Load, Settings, Quit-to-title.
- HUD minimap + full-level map with fog-of-war, door ticks, breakable
  markers, and legend.
- Live settings sync (scale/filter/volume/mute) between shell and engine.
- Entrance-save slots stored per pack, plus export/import.

### Level and asset editor (hash route `#/editor`)

A full pack editor that rebuilds the game's data tables from your ROM:

- Map: Pan/Brush/Eraser/Picker/Inspect tools, zoom to 64px per block,
  undo/redo, live block/combo previews, hierarchy explainer.
- Enemies: WYSIWYG sprite markers on the map (observed OAM pictures, not
  guesses), drag-to-move, add/delete with budget + trap validation, AI
  behavior labels, per-area stat tables (HP/damage).
- CHR: sprite/background bank picker per level, tile pixels, palettes.
- Sound: area-music table, song browser, song-slot remapping, per-site
  jingle/request overrides (read-only where the engine bakes immediates).
- Packs save as overlay patch sets; export any pack as a hardware- and
  emulator-compatible `.ips` file for use outside the browser.

### PWA + Android APK

- `manifest.webmanifest` + `sw.js` (versioned app shell, ROM bytes never
  cached) make the page installable from any static HTTPS host.
- `sh android/apk_build.sh` builds `android/release/BM-Web.apk`
  (debug-signed, installable): a WebView wrapper (`dev.bmweb.frontend`)
  serving the staged game out of the APK with the same COOP/COEP headers
  as the dev server. No permissions, no network, no storage permission —
  supply the ROM once in-app and the pack persists there.

## Sibling repos

- Engine: [bm-recomp](https://github.com/GrubGrubgit/bm-recomp) - lifted game C, pinned by ENGINE_PIN, compiled unmodified.
- Reference: [bm-disasm](https://github.com/GrubGrubgit/bm-disasm) - disassembly the RE table and routine pins are verified against.

## Build from source

Prerequisites: `clang` with `wasm32-unknown-unknown` target, `wasm-ld`
(or `lld`), `node` 20+, `python3`. APK only: Android SDK with platform
`android-36` (default `work/android-sdk`, gitignored).

    # 1. Pin the engine (must match ENGINE_PIN exactly)
    git -C ../recomp checkout "$(cat ENGINE_PIN)"

    # 2. Build the wasm engine (default -O3; ship profile uses O_LEVEL=-O0 + wasm-opt)
    sh tools/build_game.sh
    # needs: build/game.wasm

    # 3. Serve locally (COOP/COEP kept so SharedArrayBuffer works)
    node tools/serve.js
    # open http://127.0.0.1:8901/index.html — supply your ROM in-page

Useful variants:

- `O_LEVEL=-O0 sh tools/build_game.sh` — fast debug build.
- `sh android/apk_build.sh` — APK into `android/release/BM-Web.apk`.
- Pushing `master` triggers `.github/workflows/pages.yml`: rebuilds the
  wasm in the cloud and deploys the playable page to GitHub Pages.

## Tests

Headless suites live in `tools/verify-*.mjs` (38 files: pack tables,
spawns, stats, doors, physics, behavior, maps, menus, saves, sound).
Most need only node; gameplay suites need the reference ROM via the local
dev server alias (see `tools/serve.js`, device-only path, never shipped):

    node tools/verify-pack-p3.mjs        # one suite
    node tools/test_game.mjs <rom> [K]   # engine determinism + replay roundtrip
    sh work/battery.sh                   # full browser battery (device)

A layer/suite is DONE only when its checks pass green; see `PLAN.md` and
`PLAN-EDITOR.md` section 6.4 for the full acceptance record.

## Repo layout

- `index.html`, `sw.js`, `manifest.webmanifest` — player shell + PWA.
- `src/core/bm_api.c` — the ONE engine adapter (owned here; the vendored
  engine compiles unmodified behind it). `src/core/host.js` — browser host.
- `src/rom/` — loader + header/CRC. `src/pack/` — pure data-table libs
  (one concern per file: enemies, stats, physics, doors, behavior, sound,
  songs, tiles, world, minimap, overlay, ips, store…).
- `src/ui/` — shell, editor, enhancements panel, prefs, tweaks, PWA.
- `src/video/`, `src/audio/`, `src/input/` — renderer, APU player, pad bus.
- `tools/` — build (`build_game.sh`, `patch_vendor.py`, `patch_hook7.py`,
  `patch_tailcalls.py`), dev server (`serve.js`), all verify suites.
- `android/` — APK wrapper + build script. `.github/workflows/pages.yml`
  — cloud build + Pages deploy.
- `ENGINE_PIN` — pinned `bm-recomp` commit (frontend + engine tested as a
  pair; never bump without a green battery).
- `SPEC.md` — interface + non-negotiables. `PLAN.md` — bottom-up build
  plan L0–L7. `PLAN-EDITOR.md` — editor/RE research log (canonical record).
- `work/` — local only (SDK, logs, profiles), gitignored. No ROMs, packs,
  or build outputs are ever committed (except the release APK, which is
  tracked so releases can attach it).
