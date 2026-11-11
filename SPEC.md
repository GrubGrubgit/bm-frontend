# SPEC — Blaster Master web frontend (native port shell)

## 1. Goal
Play the statically recompiled Blaster Master C engine (GrubGrubgit/bm-recomp,
`recomp/gen/combined_enf.c` + `runtime.h`) in any modern browser through a
custom web frontend. This is a native port, NOT an emulator: no 6502 CPU,
no PPU/APU emulation. The lifted C IS the game logic; the frontend is its
platform layer (frame timing in, video out, audio out, input in), plus a
ROM-supplied asset pack the engine runs off. Crossplatform by construction:
the same build runs on the Bridge Console WebView (primary), desktop and
mobile browsers (secondary).

## 2. Non-negotiables
- No ROM, no PRG/CHR bytes, no extracted art/music/text, no Nintendo bytes
  in this repo. Ever. The user supplies their own dumped Blaster Master
  (USA) NES ROM locally via file picker / drag-drop. Headered or headerless
  both accepted. Identity by CRC32/MD5 recorded at extract; unknown dumps
  warn but may attempt extraction.
- All extraction happens in-page (no server). Pack caches in browser
  IndexedDB (`bm-frontend` DB: `rom`, `packs`, `saves` stores; packs
  version-keyed). User can wipe it. Nothing uploads anywhere.
- **Not an emulator.** The wasm module is the lifted game logic compiled
  from `bm-recomp` at a pinned commit — never a CPU core running ROM bytes.
  The ROM is a data source only (PRG/CHR/palette/layout source for the pack).
- Graphics via WebGL (`256x240` guest, integer-fit upscale, `UNPACK` pixel
  path, portrait + landscape). Audio via WebAudio (unlocked by user gesture).
- Responsive: desktop widescreen + mobile portrait/landscape. Touch controls
  and Bluetooth controllers are first-class, keyboard is dev convenience.
- Modular code: one concern per file under `src/`, mirroring the FFV port
  layout (`ffvport/src/ff5/` as the structural example: `rom.js`, `pack.js`,
  `packreader.js`, `host.js`/`frontend.js`, `ppu.js`/`gfx.js`, `audio.js`/
  `sound.js`, `input.js`, `save.js`). No engine logic in shells.
- No demo slices, no toy renderers, no placeholder systems. Every layer
  below is finished whole with its acceptance green before the layer above
  begins (PLAN.md).

## 3. Engine source (how the C gets here)
- Engine lives in `GrubGrubgit/bm-recomp`, file `recomp/gen/combined_enf.c`
  (+ `recomp/tools/lift/runtime.h`), canonical enforce TU, pinned by commit
  hash in `ENGINE_PIN` at repo root. The frontend build script fetches that
  commit into `build/vendor/` (gitignored) and compiles from there.
- Engine sources are wrapped, never forked: one thin NEW C adapter file
  (`src/core/bm_api.c`, owned here) exposes the section-6 interface; the
  vendored engine files are compiled unmodified. No hand-copies of engine
  code anywhere else in this repo.
- Wasm is the only shipped artifact path (emscripten or equivalent, decided
  in P0). A native-test backend behind the SAME section-6 interface may
  exist for headless parity checks but never ships.

## 4. ROM loader + pack (user data path)
- Loader UI: file picker + drag-drop, header parse (16-byte iNES/NES2.0:
  PRG `8x16KB`, CHR `8x8KB`, mapper 1/MMC1, mirror), size + checksum display,
  CRC32/MD5 verify against the disassembly README values, unknown-dump
  warning with proceed-at-own-risk.
- Pack builder (in-page): splits PRG/CHR, validates lengths against the
  header, records meta (`packVersion`, crc/md5, mapper, PRG/CHR sizes,
  provenance, builtAt), and writes sections the engine + renderers run off:
  `prg` (8 banks), `chr` (8KB banks for the WebGL decoder), plus derived
  tables the C adapter needs (exact set frozen in P1; nothing copyrighted
  beyond what the user supplied).
- Pack reader: version-checked load, section accessors, gap list (every
  unexplained gap fails the build loudly — same rule as the FFV pack).
- Cache: IndexedDB, pack version-keyed, ROM never stored (re-extract on
  demand). Wipe button clears `rom`/`packs`/`saves`.

## 5. C/JS platform contract (section-6 interface, frozen in P2)
- `bm_init(pack)` / `bm_reset()` — cold start, deterministic from power-on
  given the same pack. No wall-clock, no randomness outside the pack.
- `bm_set_pad(mask)` — NES pad bits `01=A 02=B 04=Select 08=Start 10=Up
  20=Down 40=Left 80=Right`, latched per frame from the unified input bus.
- `bm_run_frame()` — advance exactly one 1/60s frame (cycle-timed NMI
  model from the lifter is inside the engine; the frontend never steps
  sub-frame).
- `bm_video()` — 256x240 framebuffer after the frame (exact pixel format
  frozen in P2: RGBA vs indexed+palette, owned by the WebGL uploader).
- `bm_audio_read(buf, n)` / `bm_audio_rate()` — pull up to n PCM samples;
  underrun counter owned here.
- `bm_save(id)` / `bm_load(id)` — opaque state blobs for UI save slots
  (survive page reload via IndexedDB `saves` store).
- Everything else (game internals) stays behind this wall. Only `src/core/`
  touches wasm memory.

## 6. Subsystems (all under `src/`, vanilla ES modules, no framework)
- `src/core/` — wasm host + frame loop: instantiate, rAF pacing with
  fixed-timestep + frame-skip policy, `reset()`, `stepFrame(pad)`,
  framebuffer hand-off, audio pump, state save/load. ONLY module touching
  compiled game code.
- `src/rom/` — loader + CRC + header (FFV `rom.js` pattern).
- `src/pack/` — builder + reader + schema version (FFV `pack.js` +
  `packreader.js` pattern).
- `src/video/` — WebGL renderer replacing the PPU: CHR decode, palette,
  nametable/attribute fetch, scroll, OAM sprites, vblank/NMI presentation,
  integer + fill scale modes, FPS meter. No game code.
- `src/audio/` — WebAudio pipeline: worklet/graph fed from the engine PCM
  (or APU voice params once frozen), device-rate handling, mute/volume,
  underrun counter. No game code.
- `src/input/` — ONE virtual-pad bus (FFV `input.js` pattern): `keyboard.js`
  (desktop), `touch.js` (d-pad + diagonals + A/B/Start/Select, multitouch,
  both orientations), `gamepad.js` (standard mapping incl. Bluetooth,
  hotplug + reconnect), `agent.js` (programmatic writes for headless).
- `src/ui/` — shell: loader, pack status, start/stop/reset/pause, state
  slots, volume, scale mode, status line, log view. Thumb-usable.
- `src/app.js` — wiring only + `window.BM` (section 7). No logic beyond
  composition.

## 7. Shell + agent surface (`window.BM`, for users and headless)
`start()`, `stop()`, `reset()`, `pause(bool)`, `setPad(mask)`,
`press(frames, mask)`, `frame()` (one frame, returns summary),
`screenshot()` (canvas data URL), `save(slot)`, `load(slot)`, `stats()`
(fps, audio underruns, frames run). Every call safe from the bridge eval
channel. Documented in `README.md`.

## 8. Verification (headless, on device)
- Zero console errors on desktop + mobile viewports, every layer.
- Headless Chromium runner (`tools/headless.sh`): loads the build, runs
  the layer self-tests, captures screenshots to `work/` (gitignored),
  diffs against oracle captures (tracer `snap2png.py` room renders + FFV
  pack-reader pattern). No layer DONE until its checks pass on the phone.
- Budgets: full speed (60fps NTSC) on the phone with headroom;
  input-to-photon latency under 100ms on touch. `work/` stays small;
  `sh tools/guard.sh` before heavy sessions (6GB minimum); user approval
  for any single write over 100MB; no silent background jobs.
