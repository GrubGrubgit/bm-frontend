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
- Graphics via WebGL (`256x240` guest framebuffer, `240x224` CRT overscan
  view: 8px hidden on every side like a real TV, `UNPACK` pixel path, portrait +
  landscape). Scaling: Integer (pixel-perfect) / Fit (aspect-correct
  letterbox) / Fill / Stretch, filter Nearest (default) / Bilinear, plus
  Fullscreen API on the play container. High-res displays render the same
  guest pixels upscaled — never re-authored assets. Audio via WebAudio
  (unlocked by user gesture).
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
  (+ `recomp/tools/lift/runtime.h`), canonical OFF-mode TU (`combined_off.c` + `runtime.h`), pinned by commit
  hash in `ENGINE_PIN` at repo root. The frontend build script fetches that
  commit into `build/vendor/` (gitignored) and compiles from there.
- Engine sources are wrapped, never forked (`tools/patch_vendor.py` copies the pinned TU into `build/vendor/` and applies the adapter-owned APU-ring hook at two asserted anchors; canonical gen/ never modified): one thin NEW C adapter file
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

## 5. C/JS platform contract (section-6 interface, FROZEN in L2)
- Model: PLAIN single-entry. The host calls `bm_boot()` EXACTLY ONCE per instance lifetime (reset vector F23B; power-on state zeroed in C). Boot never returns; each vblank edge runs the real NMI tail, renders a frame, then calls the `host_frame(f)` import. The host drives everything from inside that import (node harness: throw-to-stop; browser: `host_frame` is a `WebAssembly.Suspending` import that latches video/audio/hash and suspends the exact wasm continuation, resumed by `go()` - no worker, no SharedArrayBuffer, no unwind tricks. A spin-yield attempt (throw-to-resume) was built and REJECTED: any C-stack unwind diverges (lost NMI epilogue, consumed spin releases, caller frames); suspension is bit-exact with the classic park model, same goldens). Re-calling bm_boot mid-run re-enters the game and is forbidden. No asyncify: it breaks the engine tail-call chains and overflows the stack by frame ~57 (verified 2026-11-11, binaryen 133 removed from the pipeline).
- Exports: `bm_stage_ptr` (131072B scratch: PRG/CHR load area, audio-drain dst, bm_snap out), `bm_load_prg`, `bm_load_chr`, `bm_video_ptr` (256x240x4 RGBA8 framebuffer; NESPAL table incl. the 8K-mode `b1=(chr0&0xFE)` quirk; pixel-identical to tracer `snap2png.py`, verified by `cmp`), `bm_frame_no`, `bm_set_pad(mask)` (bits `01=A 02=B 04=Select 08=Start 10=Up 20=Down 40=Left 80=Right`, latched per frame), `bm_audio_read(dst,max)` (drains the APU ring: 8B/event addr-lo,addr-hi,val,0,cycle32le for $4000-$4017 writes incl. frame counter; 256-entry ring), `bm_hash` (FNV-1a over cycles/ram/vram/pal/oam/regs/scroll/mapper), `bm_snap` (4160B tracer layout ram[2048]+vram[2048]+footer[64]), `bm_mem_size`. Sole import: `host_frame(int)`. Freestanding wasm32, no OS/threads/FS in C.
- Stepping (browser): `src/core/host.js` (`GameHost`) owns the wasm instance and is the ONLY module touching compiled game code besides the adapter (`src/core/worker.js` deleted with the SAB model). `go(n,pad)` consumes exactly n suspended edges (pad installed before each resume - classic timing: the frame after the edge plays the pad); `step(pad)` = `go(1,pad)`; pause = stop commanding (engine stays suspended, free); fast-forward replays exact. Frame accounting is consumption-based: every latched edge is consumed exactly once, in order. The visible state (video/hash/audio accessors) is the last CONSUMED edge - a latched-but-in-flight edge stays invisible until consumed. The pad log records consumption pads (latch pads lag one edge at chunk boundaries and break replay). 60fps pacing lives in L6, not here.
- Save/load = REPLAY, exact by determinism: `saveSlot` stores `{v,frame,pads[]}` in the IDB `saves` store; `load` = fresh instance (abandoned predecessors are quiesced first: a resumed-but-unsuspended instance would otherwise pollute the shared host) + fast-forward the pad log (constant-pad runs grouped), then continue. Whole-memory restore is NOT used (proven to diverge: stale wasm locals outside linear memory, LDEED/LDEF7 loop to stack overflow). `reset` = fresh instance (edge 0 consumed as boot: not counted, not replayed, but visible as the post-spawn frame and audio-live proof; `go(n)` advances n frames).
- Determinism (acceptance): node `tools/test_game.mjs` — two boots, identical per-frame hashes (K=40 and K=600 PASS), save-image stable, replay-continue PASS, audio 5 boot events at frame 0 (~510 over 600 frames), C render == oracle `cmp`-identical. Browser `?headless=1&test=l2` — 40-frame determinism x3 boots, save/diverge/load/continue equality, audio>0, video non-blank, zero console errors (WD SEVERE gate), green twice.
- Error model: engine traps / `unreachable` are fatal (boot promise rejects into `_fatal`, surfaced on the next edge; e.g. the no-input title-timeout demo-path trap at frame ~3532 is L7 content, not a defect). Host import timeouts (20s boot / 30s run) fail loudly. No wall-clock, no randomness in the engine.

## 6. Subsystems (all under `src/`, vanilla ES modules, no framework)
- `src/core/` — game worker + host (suspension stepping: `host.js` GameHost owns the instance - go/step/reset/replay save/load, ONLY module touching compiled game code besides the adapter) + frame loop: instantiate, rAF pacing with
  fixed-timestep + frame-skip policy, `reset()`, `stepFrame(pad)`,
  framebuffer hand-off, audio pump, state save/load. ONLY module touching
  compiled game code.
- `src/rom/` — loader + CRC + header (FFV `rom.js` pattern).
- `src/pack/` — builder + reader + schema version (FFV `pack.js` +
  `packreader.js` pattern).
- `src/video/` — WebGL uploader + present of the SPEC section 5 framebuffer
  (CHR/palette/scroll/OAM compositing lives in the C adapter; OAM from oam[], scroll includes reg2000 base bits with MMC1 mirroring, sprite priority behind opaque bg, 8x16 bank fix; title oracle still matches):
  scaling (Integer/Fit/Fill/Stretch) + filter (Nearest default/Bilinear) +
  fullscreen viewport handling, FPS meter. No game code. Display proof is
  upload-digest equality plus a toDataURL blank-to-drawn bitmap change with
  per-step GL errors 0 (in-page GL readback is impossible in device headless
  SwiftShader — any drawArrays loses the context ~1s later — so readPixels/
  drawImage asserts are excluded by environment; renderer byte-exactness was
  additionally proven on conformant real GL).
- `src/audio/` — live NES APU (FFV `spc.js` pattern: native voice
  synthesis from the engine register stream, not PCM playback):
  pulse/triangle/noise/DMC + frame counter per the game driver (bank5 TU),
  worklet/graph at device rate, mute/volume, gap counter. Shell reset/stop/load resets the worklet voice; ApuStream rebases on frame jumps so load does not render thousands of silent frames. No game code.
- `src/input/` — ONE virtual-pad bus (FFV `input.js` pattern): `keyboard.js`
  (desktop), `touch.js` (d-pad + diagonals + A/B/Start/Select, multitouch,
  both orientations), `gamepad.js` (standard mapping incl. Bluetooth,
  hotplug + reconnect), `agent.js` (programmatic writes for headless).
- `src/ui/` — shell: loader, pack status, start/stop/reset/pause, state
  slots, volume, scale + filter + fullscreen controls (persisted), status
  line, log view. Thumb-usable.
- `src/app.js` — wiring only + `window.BM` (section 7). No logic beyond
  composition.

## 7. Shell + agent surface (`window.BM`, for users and headless)
`start()`, `stop()`, `reset()`, `pause(bool)`, `setPad(mask)`,
`press(frames, mask)`, `frame()` (one frame, returns summary),
`screenshot()` (canvas data URL), `save(slot)`, `load(slot)`, `stats()`, L2: `bootL2()`, `runL2(n,pad)`, `stepL2(pad)`, `resetL2()`, `saveL2(slot)`, `loadL2(slot)`, `l2info()`
(fps, audio render gaps, frames run). Every call safe from the bridge eval
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

## 9. Build record (L0 toolchain, frozen 2026-11-11)
- Engine: `build/vendor/` refreshed from `../recomp` at `ENGINE_PIN` on
every build (`tools/build_spike.sh` aborts on pin/HEAD mismatch); vendored
bytes compiled unmodified (amalgamation include).
- Wasm: Termux clang 21.1.8 `--target=wasm32-unknown-unknown -O3 -mtail-call -ffreestanding -nostdlib` + patch_tailcalls (3839 musttail sites to return_call; plain -O2 overflows the engine stack by frame 57)
-ffreestanding -nostdlib`, two-step via fixed `work/spike.o`, wasm-ld LLD
21.1.8 `--no-entry --export-all --build-id=none`. Same output path gives
identical sha256 (`b903ff34…`, verified twice in a row). No emscripten, no
WASI sysroot (none exists on device), no network access at build time.
- Full-engine link proven with the same object file plus
`--no-gc-sections`: 3.0MB wasm, instantiates with zero imports in node
v26, NMI restore + IRQ tails execute. Default link GC-drops unreferenced
statics (why the L0 spike is 3.4KB); L2 uses the `--no-gc-sections` form.
- Libc shims, owned here (`tools/wasm-shim/stdio.h`, `string.h`):
`FILE`/`stderr`/`fprintf` (drops to 0), `memset`/`memcpy`/`memmove`. The
engine calls `fprintf` only (1583 UNWIND-ESCAPE log sites, enforce mode).
- Headless loop (`tools/headless.sh` + `tools/serve.js` on :8901):
Chromium 156 `--headless=new`, console-error gate, `work/shot.png`,
`BM-HEADLESS-READY` marker, nonzero exit on any failure; [timeoutMs] 4th arg (default 25000, L6 needs 150000); TAP_MARKER/CLICK_SEL env drives the L3 fullscreen tap gate. Green twice.
- `bm_spike_*` is spike-only scaffolding. The section-5 C/JS contract
freezes in L2; L3+ build against it.
