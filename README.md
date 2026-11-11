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
