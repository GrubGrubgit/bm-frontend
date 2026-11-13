#!/usr/bin/env python3
"""Assemble dist/www -- the offline Cordova WebView bundle for BM-Web.

Reads the frontend root (index.html + src/ + build/game.wasm +
manifest.webmanifest + sw.js), writes dist/www/ with:
  - index.html patched so the Cordova WebView is treated as in-app
    (service worker disabled inside the APK, like ?inapp=1):
    INAPP also true when window.cordova exists, protocol is file:,
    or hostname is localhost.
  - sw.js VERSION stamped to the requested --version (browser PWA only).
  - www/PACKAGING.json provenance.

Fails loudly if any expected anchor is missing or any https:// URL
survives in the shipped HTML/JS (all game code + art must be local).

Usage: python3 tools/packaging/make-www.py [--version 0.2.0]
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WWW = REPO / "dist" / "www"

INAPP_ANCHOR = "var INAPP = /[?&]inapp=1/.test(location.search);"
INAPP_REPLACEMENT = (
    "var INAPP = /[?&]inapp=1/.test(location.search) "
    "|| !!window.cordova "
    "|| location.protocol === 'file:' "
    "|| location.hostname === 'localhost';"
)
SW_ANCHOR = 'const VERSION = "bm-v1";'


def git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(REPO), text=True,
        ).strip()
    except Exception:
        return "unknown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="0.2.0")
    args = ap.parse_args()
    ver = args.version

    for name in ("index.html", "src", "manifest.webmanifest", "sw.js"):
        if not (REPO / name).exists():
            sys.exit(f"missing frontend input: {name}")
    wasm = REPO / "build" / "game.wasm"
    if not wasm.is_file() or wasm.stat().st_size == 0:
        sys.exit("missing frontend input: build/game.wasm")

    html = (REPO / "index.html").read_text(encoding="utf-8")
    if INAPP_ANCHOR not in html:
        sys.exit("anchor missing, refusing to guess: INAPP detection")
    html = html.replace(INAPP_ANCHOR, INAPP_REPLACEMENT)

    sw = (REPO / "sw.js").read_text(encoding="utf-8")
    if SW_ANCHOR not in sw:
        sys.exit("anchor missing, refusing to guess: sw VERSION")
    sw = sw.replace(SW_ANCHOR, f'const VERSION = "bm-{ver}";')

    for _i in range(15):
        shutil.rmtree(WWW, ignore_errors=True)
        time.sleep(1)
        if not WWW.exists() and not WWW.is_symlink():
            break
    (WWW / "src").mkdir(parents=True, exist_ok=True)
    (WWW / "build").mkdir(parents=True, exist_ok=True)
    (WWW / "index.html").write_text(html, encoding="utf-8")
    (WWW / "sw.js").write_text(sw, encoding="utf-8")
    shutil.copy2(REPO / "manifest.webmanifest", WWW / "manifest.webmanifest")
    SKIP_SUFFIXES = {".c", ".h", ".o", ".obj", ".a", ".lib", ".pyc"}
    for src_dir in sorted((REPO / "src").rglob("*")):
        if src_dir.is_dir():
            (WWW / src_dir.relative_to(REPO)).mkdir(parents=True, exist_ok=True)
        elif src_dir.is_file():
            if src_dir.suffix in SKIP_SUFFIXES:
                continue
            shutil.copy2(src_dir, WWW / src_dir.relative_to(REPO))
    shutil.copy2(wasm, WWW / "build" / "game.wasm")

    (WWW / "PACKAGING.json").write_text(json.dumps({
        "version": ver, "git": git_sha(), "built": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "note": "offline Cordova WebView bundle; SW disabled in-app; all code local",
    }, indent=2) + "\n", encoding="utf-8")

    bad = []
    for path in [WWW / "index.html"] + sorted((WWW / "src").rglob("*.js")):
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "https://" in line:
                bad.append(f"{path.relative_to(WWW)}:{i}")
    if bad:
        sys.exit("remote URLs survive in shipped bundle: " + ", ".join(bad[:10]))

    n = sum(1 for _ in WWW.rglob("*"))
    total = sum(p.stat().st_size for p in WWW.rglob("*") if p.is_file())
    print(f"www: {n} entries, {total} bytes -> {WWW}")
    print("MAKE_WWW_OK")


if __name__ == "__main__":
    main()
