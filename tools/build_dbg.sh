#!/bin/sh
# Debug game build: pinned OFF engine + trace hooks + musttail -> game-dbg.wasm.
# vendor-dbg/combined_off.c is regenerated from build/vendor/ every time.
set -e
cd "$(dirname "$0")/.."
cp build/vendor/combined_off.c build/vendor-dbg/combined_off.c
python3 tools/patch_trace.py build/vendor-dbg/combined_off.c
python3 tools/patch_tailcalls.py build/vendor-dbg/combined_off.c
clang --target=wasm32-unknown-unknown -O2 -mtail-call -ffreestanding -nostdlib -c -Itools/wasm-shim -Ibuild/vendor-dbg build/dbg_api.c -o build/game-dbg.o
wasm-ld --no-entry --export-all --no-gc-sections --build-id=none --allow-undefined build/game-dbg.o -o build/game-dbg.wasm
ls -la build/game-dbg.wasm
