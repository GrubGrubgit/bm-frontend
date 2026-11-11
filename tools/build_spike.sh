#!/bin/sh
# L0 spike build (deterministic): Termux clang freestanding wasm32.
# No emscripten, no WASI, no network. Same output path => identical bytes.
set -e
cd "$(dirname "$0")/.."
PIN=$(cat ENGINE_PIN)
HEAD=$(git -C ../recomp rev-parse HEAD)
if [ "$PIN" != "$HEAD" ]; then echo "ENGINE_PIN $PIN != recomp HEAD $HEAD"; exit 1; fi
cp ../recomp/gen/combined_enf.c build/vendor/
cp ../recomp/tools/lift/runtime.h build/vendor/
clang --target=wasm32-unknown-unknown -O2 -ffreestanding -nostdlib -c -Itools/wasm-shim -Ibuild/vendor src/core/bm_spike.c -o work/spike.o
wasm-ld --no-entry --export-all --build-id=none work/spike.o -o build/bm_spike.wasm
node tools/smoke_spike.js build/bm_spike.wasm
