# Packaging - BM-Web (Cordova APK)

One shared offline web bundle feeds the installable APK.

Frontend (index.html, src/, build/game.wasm, manifest, sw.js)
  -> make-www.py -> dist/www/ (offline, Cordova WebView-safe)
    -> cordova-build.sh -> dist/cordova/.../app-debug.apk

make-www.py patches one anchor and fails loudly if it vanishes:
- index.html INAPP detection also true under Cordova (window.cordova,
  file: protocol, localhost host) so the APK never registers the browser
  PWA service worker.
- sw.js VERSION stamped to --version (browser PWA only).
- Refuses to build if any https:// URL survives in shipped HTML/JS.

Pinned: SDK platforms;android-36 + build-tools;36.0.0,
  cordova-android 15.1.0, JDK 17, minSdk 29, targetSdk 36.
Widget id dev.bmweb.frontend (same as old hand-built APK).
NOTE: debug signatures differ (old APK used repo-local debug.keystore,
Cordova uses ~/.android/debug.keystore), so first Cordova install needs
the old BM-Web uninstalled first.

Build:
  python3 tools/packaging/make-www.py --version 0.2.0
  nohup sh tools/packaging/cordova-build.sh > ~/.packaging-logs/bm-cordova-build.log 2>&1 &
  poll with: tail ~/.packaging-logs/bm-cordova-build.log

Output lands in Downloads as BM-Web-cordova-debug.apk (tap to install).

Why Cordova (user order 2026-11-13): the hand-built android/apk_build.sh
(raw aapt2/d8/apksigner + custom MainActivity/LocalServer/AssetRoute)
was the source of the APK wrapping pain. Cordova owns the WebView, asset
serving, and file chooser, as in the user other project that built clean.
android/ stays intact as fallback; Cordova is now the primary APK path.
