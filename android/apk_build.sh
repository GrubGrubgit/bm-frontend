#!/bin/sh
# Build the BM Web installable APK. No Gradle, no network past the SDK.
# usage: sh android/apk_build.sh   (outputs android/release/BM-Web.apk)
# env: ANDROID_SDK_ROOT (default: work/android-sdk, gitignored)
set -e
cd "$(dirname "$0")/.."
ANDROOT="$PWD/android"
SDK="${ANDROID_SDK_ROOT:-$PWD/work/android-sdk}"
AJAR="$SDK/platforms/android-36/android.jar"
if [ ! -f "$AJAR" ]; then echo "missing $AJAR"; exit 1; fi
if [ ! -f build/game.wasm ]; then echo "missing build/game.wasm"; exit 1; fi
VER="bm-apk-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
echo "sw version: $VER"
rm -rf android/build/www android/build/gen android/build/classes android/build/dex android/build/base.apk
mkdir -p android/build/www android/build/gen android/build/classes android/build/dex android/release
cp index.html manifest.webmanifest android/build/www/
cp -r src android/build/www/
mkdir -p android/build/www/build
cp build/game.wasm android/build/www/build/
sed "s/bm-v1/$VER/" sw.js > android/build/www/sw.js
aapt2 compile --dir "$ANDROOT/res" -o android/build/compiled.zip
aapt2 link -o android/build/base.apk -I "$AJAR" --manifest "$ANDROOT/AndroidManifest.xml" --java android/build/gen -A android/build/www --min-sdk-version 29 --target-sdk-version 36 android/build/compiled.zip
find "$ANDROOT/src" -name "*.java" > android/build/srcs.txt
RJAVA=$(find android/build/gen -name R.java)
javac --release 8 -classpath "$AJAR" -d android/build/classes @android/build/srcs.txt "$RJAVA"
d8 --lib "$AJAR" --release --output android/build/dex $(find android/build/classes -name "*.class")
python3 - "$PWD" <<'PYEOF'
import sys, zipfile, os
root = sys.argv[1]
apk = os.path.join(root, "android/build/base.apk")
dex = os.path.join(root, "android/build/dex/classes.dex")
z = zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED)
z.write(dex, "classes.dex")
z.close()
print("dex added")
PYEOF
KS=android/build/debug.keystore
if [ ! -f "$KS" ]; then keytool -genkeypair -keystore "$KS" -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10950 -storepass android -keypass android -dname "CN=Android Debug"; fi
apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out android/release/BM-Web.apk android/build/base.apk
apksigner verify --print-certs android/release/BM-Web.apk
ls -la android/release/BM-Web.apk
