#!/bin/sh
# L2 game build: pinned OFF engine + adapter -> plain game.wasm.
# Plain single-entry model: ONE bm_boot() call runs the game; the host
# drives stepping through the host_frame() import (throw-to-stop in node,
# Atomics.wait park in the worker). No asyncify: it breaks the engine's
# tail-call chains and overflows by frame ~57 (verified 2026-11-11).
set -e
cd "$(dirname "$0")/.."
PIN=$(cat ENGINE_PIN)
HEAD=$(git -C ../recomp rev-parse HEAD)
if [ "$PIN" != "$HEAD" ]; then echo "ENGINE_PIN $PIN != recomp HEAD $HEAD"; exit 1; fi
python3 tools/patch_vendor.py
python3 tools/patch_tailcalls.py
clang --target=wasm32-unknown-unknown -O3 -mtail-call -ffreestanding -nostdlib -c -Itools/wasm-shim -Ibuild/vendor src/core/bm_api.c -o build/game.o
wasm-ld --no-entry --export-all --no-gc-sections --build-id=none --allow-undefined build/game.o -o build/game.wasm
ls -la build/game.wasm
