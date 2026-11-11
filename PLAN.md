# PLAN — bottom-up build order (SPEC is authority on conflict)

Rule: layers run in order; a layer is DONE only when ALL its acceptance
checks pass on the phone. No demos, no toy renderers, no placeholders —
each layer is the finished system its upper layers run on. Newest status in
the main repo CURRENT_TASK, newest CHANGELOG entry on top, commit per layer.

## L0 — Toolchain + headless harness (decides everything below)
Goal: prove the build + test loop on device before any game code.
- T0.1: wasm toolchain spike — compile `recomp/gen/combined_enf.c` +
  `runtime.h` + stub adapter to wasm on device (emscripten or equivalent;
  if no on-device wasm toolchain exists, freeze the fallback: prebuilt
  container-built wasm is forbidden — instead vendor a documented Termux
  clang/wasi-sdk path, or keep the native-test backend as the L2 host with
  the wasm decision recorded and the plan adapted; kill anything that cannot
  build reproducibly here).
- T0.2: headless runner — `tools/headless.sh` drives headless Chromium on
  the phone (page load, console-error gate, screenshot to `work/`, exit
  code). Proves the exact loop every later layer verifies with.
- T0.3: shell skeleton — blank `index.html` + `src/app.js` exposing
  `window.BM.stats()` through the runner with zero console errors.
Acceptance: wasm (or recorded fallback) builds reproducibly from the pinned
engine commit; runner loads the skeleton, reports stats, saves a screenshot,
zero console errors, twice in a row. Freeze the toolchain + interface in SPEC §5.

## L1 — ROM loader + pack (the only user-data path, finished whole)
Goal: user ROM in, versioned pack out, engine never sees raw ROM.
- `src/rom/`: picker + drag-drop, iNES/NES2.0 parse (PRG 8x16KB, CHR 8x8KB,
  mapper 1, mirror), CRC32/MD5 + disassembly-README values, unknown warning.
- `src/pack/`: builder (PRG/CHR split + length validation + `meta` +
  engine sections + gap list that fails loudly) and reader (version check,
  accessors), IndexedDB cache (`rom`, `packs`, `saves`), wipe.
- Canonical fixture: the device-local reference ROM builds pack v1 with zero
  unexplained gaps (hashes stay in the build log, never in the repo).
Acceptance: valid ROM → pack v1, zero gaps; bad header/size → loud error;
reload reads the cached pack without the ROM; wipe clears all three stores;
headless asserts all four; zero console errors. No game code runs yet.

## L2 — Wasm core + C/JS contract (the wall everything stands on)
Goal: the engine runs frames behind the frozen SPEC §5 interface.
- `src/core/bm_api.c`: thin adapter (init from pack sections, reset, pad
  latch, run-frame, video/audio/save-load) over unmodified vendored engine.
- `src/core/`: host (instantiate, rAF fixed-timestep + frame-skip,
  `reset()`, `stepFrame(pad)`, framebuffer hand-off, audio pump, save/load
  to IndexedDB) + self-tests (reset determinism: two resets → identical
  first frames; save→run→load→run reproduces post-load bytes).
Acceptance: headless boots the pack to the titleera frames deterministically;
reset is bit-identical twice; save/load round-trips exactly; zero console
errors. Interface frozen — L3+ build against it, never around it.

## L3 — Video (WebGL PPU replacement, finished whole)
Goal: the engine framebuffer on screen, correctly, at speed.
- `src/video/`: WebGL uploader + present (256x240 guest; scaling
  Integer/Fit/Fill/Stretch, filter Nearest default/Bilinear, fullscreen
  viewport handling; `pixelated` for Nearest, portrait/landscape CSS),
  CHR/palette/scroll/OAM path per the engine contract, FPS meter. Matches
  the `snap2png.py` oracle captures (background + all 64 sprites) on title
  + first rooms.
Acceptance: title screen matches the oracle capture at Integer 2x/Nearest;
scaling matrix green (Integer exact multiples, Fit aspect-correct
letterbox, Fill/Stretch without crashes, Bilinear only smooths); fullscreen
enters/exits cleanly on desktop + phone; steady 60fps for 60s on the phone;
reset returns to the identical boot pixels; zero console errors. No game
logic here.

## L4 — Audio (finished whole)
Goal: game sound out of the phone speaker, no crackle.
- `src/audio/`: live NES APU (FFV `spc.js` pattern) driven by the
  `bm_audio_events()` register stream, rendered in a worklet/graph at the
  device rate; mute/volume + render-gap counter in `BM.stats()`.
  Voice/sequence semantics are the game music driver itself (bank5 TU)
  writing real APU registers through the adapter — live synthesis, no PCM,
  no invented tunes, no placeholders (any byte-exact reference renders live
  in `work/` for comparison only).
Acceptance: title music plays clean for 60s; render gaps == 0; mute +
volume behave; voice audit (every register write from a 60s run hits an
implemented APU path, no silent drops); zero console errors.

## L5 — Input (one bus, finished whole)
Goal: every action playable with thumbs or a Bluetooth controller.
- `src/input/`: virtual-pad bus first; `keyboard.js` (desktop dev),
  `touch.js` (d-pad + diagonals + A/B/Start/Select, multitouch for
  run+jump+direction, both orientations, thumb-sized), `gamepad.js`
  (standard mapping, axes deadzone, hotplug/reconnect toasts + fallback
  note if the Bridge WebView hides a controller class), `agent.js`
  (`setPad`/`press` on the same bus for headless).
Acceptance: 60s of thumb play with simultaneous run+jump; Bluetooth pad
-drives the same 60s; agent `press()` script starts a new game to first
room entry; no keyboard touched during the touch/pad checks; zero console
errors.

## L6 — Shell (finished whole)
Goal: a player can operate everything blindfolded; headless can drive it.
- `src/ui/` + `src/app.js`: loader, pack status, start/stop/reset/pause,
  state slots (persist via IndexedDB, survive reload), volume, scale +
  filter + fullscreen (persisted, touch-accessible),
  status line (fps/audio/frames), log view, `window.BM` (SPEC §7) documented
  in `README.md`. Thin shell — no logic beyond composition.
Acceptance: every control works by touch alone; slots survive reload; a
fresh reader finds reset in under 10s; scripted headless session
(start → new game → first room → screenshot → save → reload) greens twice
in a row; zero console errors.

## L7 — Playthrough + polish (proof, not a phase for new systems)
Goal: prove it is a game frontend, not wiring.
- Human-thumb playthrough of the opening area to first dungeon entry;
  fix only input/audio/video/shell issues found; performance pass (sustained
  60fps, <100ms touch-to-photon); controls help in-app.
Acceptance: opening area completable by touch; full headless suite green;
`guard.sh` + full-check run green, committed. No new systems in L7.
