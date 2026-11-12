#!/bin/sh
# Headless loop: serve, drive headless Chromium via WebDriver (real waits),
# gate console errors, screenshot to work/, expect a marker in the title.
# No silent jobs: server and chromedriver lifecycles end before exit.
# usage: headless.sh [page] [shot] [marker] [timeoutMs]
set -e
cd "$(dirname "$0")/.."
PAGE=${1:-index.html?headless=1}
SHOT=${2:-work/shot.png}
MARK=${3:-BM-HEADLESS-READY}
node tools/serve.js &
SRV=$!
cleanup() { kill $SRV 2>/dev/null || true; }
trap cleanup EXIT
sleep 1
node tools/wd.js "http://127.0.0.1:8901/$PAGE" "$SHOT" "$MARK" "${4:-25000}"
