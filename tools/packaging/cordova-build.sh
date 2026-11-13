#!/bin/sh
# Cordova Android debug build for BM-Web, fully on-device (Termux, aarch64).
# Proven pattern from dungeon-of-the-ancients/tools/packaging/cordova-build.sh:
# cordova create + copy dist/www + config.xml + android platform + build.
# Long pole (Gradle deps, dex takes minutes): run in background, poll log.
#   nohup sh tools/packaging/cordova-build.sh > /data/data/com.termux/files/home/.packaging-logs/bm-cordova-build.log 2>&1 &
set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WWW="$REPO/dist/www"
CFG="$REPO/tools/packaging/cordova-config.xml"
test -d "$WWW" || { echo "run make-www.py first (missing $WWW)"; exit 1; }
test -f "$CFG" || { echo "missing $CFG"; exit 1; }

# Use the REAL Termux home so SDK/Gradle/npm caches + debug key are shared
# (the bridge session HOME is an isolated session-home with empty caches).
REALHOME=/data/data/com.termux/files/home
export HOME="$REALHOME"
if [ -d /data/data/com.termux/files/usr/lib/jvm/java-17-openjdk ]; then
  export JAVA_HOME=/data/data/com.termux/files/usr/lib/jvm/java-17-openjdk
fi
export PATH="$JAVA_HOME/bin:$PATH"
echo "JAVA_HOME=$JAVA_HOME"
java -version 2>&1 | head -2

export ANDROID_SDK_ROOT="$REALHOME/android-sdk"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:/data/data/com.termux/files/usr/bin:$PATH"

echo "--- sdkmanager ---"
sdkmanager --version
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"

echo "--- cordova ---"
command -v cordova >/dev/null 2>&1 || npm install -g cordova
cordova --version

WORK="$REPO/dist/cordova"
rm -rf "$WORK"
cordova create "$WORK" dev.bmweb.frontend "BM-Web" --no-telemetry
rm -rf "$WORK/www"
cp -r "$WWW" "$WORK/www"
cp "$CFG" "$WORK/config.xml"
cd "$WORK"
cordova platform add android@15.1.0

# ARM Termux: AGP downloads an x86_64-only aapt2 that cannot execute here
# ("AAPT2 ... Daemon startup failed" / Syntax error "(" unexpected).
# Fix: swap each cached copy with Termux's ARM aapt2 (packages: aapt2,
# abseil-cpp). The cache is only populated by a first build attempt, so the
# flow is: build -> patch on the known error -> rebuild.
patch_aapt2_arm() {
  if ! command -v aapt2 >/dev/null 2>&1; then
    echo "installing ARM aapt2 ..."
    pkg install -y abseil-cpp aapt2 || return 1
  fi
  aapt2 version >/dev/null 2>&1 || { echo "system aapt2 broken"; return 1; }
  local patched=0
  for f in $(find "$HOME/.gradle" -path "*aapt2-*-linux/aapt2" -type f 2>/dev/null); do
    case "$f" in *.orig-x86_64) continue;; esac
    if "$f" version >/dev/null 2>&1; then continue; fi
    echo "patching $f"
    [ -f "$f.orig-x86_64" ] || cp "$f" "$f.orig-x86_64"
    cp "$(command -v aapt2)" "$f" && chmod +x "$f" && patched=1
  done
  [ "$patched" = 1 ]
}

echo "--- build ---"
if cordova build android --debug >"$WORK/build1.log" 2>&1; then
  tail -5 "$WORK/build1.log"
else
  if grep -q "Daemon startup failed" "$WORK/build1.log"; then
    echo "x86_64 aapt2 detected, patching ARM aapt2 ..."
    patch_aapt2_arm || { echo "aapt2 patch failed"; tail -20 "$WORK/build1.log"; exit 1; }
    echo "rebuilding ..."
    cordova build android --debug
  else
    tail -30 "$WORK/build1.log"; exit 1
  fi
fi

echo "=== artifacts ==="
ls -la "$WORK/platforms/android/app/build/outputs/apk/debug/"*.apk
(cd "$WORK/platforms/android/app/build/outputs/apk/debug" && sha256sum *.apk)
cp "$WORK/platforms/android/app/build/outputs/apk/debug/app-debug.apk" "$REALHOME/storage/downloads/BM-Web-cordova-debug.apk"
ls -la "$REALHOME/storage/downloads/BM-Web-cordova-debug.apk"
echo CORDOVA_BUILD_OK
