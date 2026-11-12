#!/bin/sh
# One-window play: serves the game on the phone, open the URL in Chrome.
# Usage: sh tools/play.sh   (Ctrl-C to stop). Pick the ROM in Downloads
# on first run; Add to Home screen any time for the fullscreen PWA.
cd "$(dirname "$0")/.."
echo "open in Chrome: http://127.0.0.1:8901/"
node tools/serve.js
