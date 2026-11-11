#!/bin/sh
# L0 headless loop: serve, load in headless Chromium, gate console errors,
# screenshot to work/, exit nonzero on any failure. No silent jobs: the
# server started below is killed explicitly before exit.
set -e
cd "$(dirname "$0")/.."
node tools/serve.js &
SRV=$!
cleanup() { kill $SRV 2>/dev/null || true; }
trap cleanup EXIT
sleep 1
chromium-browser --headless=new --no-sandbox --disable-dev-shm-usage --window-size=800,600 --screenshot=work/shot.png --enable-logging=stderr "http://127.0.0.1:8901/index.html?headless=1" 2>work/console.log || { echo "CHROMIUM-FAIL"; exit 1; }
if grep -q "CONSOLE.*ERROR\|Uncaught" work/console.log; then echo "CONSOLE-ERRORS:"; grep "CONSOLE.*ERROR\|Uncaught" work/console.log; exit 1; fi
[ -f work/shot.png ] || { echo "NO-SCREENSHOT"; exit 1; }
TITLE=$(chromium-browser --headless=new --no-sandbox --disable-dev-shm-usage --dump-dom "http://127.0.0.1:8901/index.html?headless=1" 2>/dev/null | grep -o "BM-HEADLESS-READY" | head -n 1)
[ "$TITLE" = "BM-HEADLESS-READY" ] || { echo "NO-READY-MARKER"; exit 1; }
echo "HEADLESS-OK shot=$(wc -c < work/shot.png)B"
