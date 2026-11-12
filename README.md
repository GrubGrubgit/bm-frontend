# bm-frontend — Blaster Master web frontend (native port shell)

Plays the statically recompiled Blaster Master engine (`bm-recomp`,
`recomp/gen/combined_enf.c` + `runtime.h`, pinned in `ENGINE_PIN`) in any
modern browser. Native port, NOT an emulator: the lifted C is the game;
this repo is its platform layer (WebGL video, WebAudio audio, unified
keyboard/touch/Bluetooth input, frame timing) plus a ROM-supplied asset pack.

- You supply your own Blaster Master (USA) NES ROM locally (picker /
  drag-drop). Nothing copyrighted ships in this repo or the pack cache
  except what your ROM provided at extract time in your own browser.
- Engine sources are fetched at build from `bm-recomp` at `ENGINE_PIN`
  into `build/vendor/` (gitignored) and compiled unmodified behind one thin
  adapter (`src/core/bm_api.c`). See `SPEC.md` §3.
- Structure mirrors the FFV web port (`ffvport/src/ff5/`): `src/rom/`,
  `src/pack/`, `src/core/`, `src/video/` (WebGL), `src/audio/`,
  `src/input/`, `src/ui/`, `src/app.js` + `window.BM`.
- Plan: `PLAN.md` (bottom-up L0–L7, no demos). Spec: `SPEC.md`.
  A layer is DONE only when all its acceptance checks pass on the phone.
- Budgets: `work/` stays small and gitignored; guard before heavy sessions;
  user approval for any single write over 100MB; no silent background jobs.

## window.BM shell + agent surface (SPEC section 7, finished in L6)

Shell (player + headless): all safe to call from the bridge eval channel.
Touch-first: every control is a real button/select/input (44px targets).

- start() - boot the cached pack (or test ROM headless), start the 60fps
  rAF loop, unlock audio. Returns the engine frame.
- stop() - halt the loop and free the worker. Returns -1.
- reset() - fresh spawn (frame 0), presented. Keeps loop state.
- pause(bool?) - suspend/resume stepping (worker parks, free).
  No arg toggles. Returns the paused flag.
- setPad(mask) / press(frames, mask) - agent writes on the same
  virtual-pad bus the thumbs use (L5); press holds the mask while
  stepping and returns the engine frame.
- frame() - advance exactly one frame with the live bus mask (pause first).
  Returns {frame, hash}.
- screenshot() - present the latest engine frame, return canvas PNG data URL.
- save(slot?) / load(slot?) - replay save/load in the IDB saves store
  (L2: pad-log fast-forward, exact by determinism). Default slot is the
  persisted shell pref. Slots survive page reload.
- stats() - {ok, frames, errors, upMs, audio, running, paused,
  engineFrame, fps, scale, filter, volume, muted, slot}.
- L2/L3/L4/L5 debug surface (kept for regression): bootL2/runL2/stepL2/
  resetL2/saveL2/loadL2/l2info, videoPresent/videoMode/videoResize/
  videoFps/videoDigest/videoFullscreen, audioUnlock/audioVolume/
  audioMute/audioStats/audioPush, setPad/press/busMask.

Prefs (localStorage bm-prefs-v1, survive reload): scale
(integer/fit/fill/stretch), filter (nearest/bilinear), volume, muted,
slot. Shell status line shows fps | frame | audio | scale/filter | vol |
slot | RUNNING/PAUSED/stopped. Log view keeps the last 200 lines.
