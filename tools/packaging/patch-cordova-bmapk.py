# Patch the generated Cordova MainActivity to expose the BMApk.saveMovie
# JavascriptInterface (MediaStore -> Downloads), mirroring the hand-built
# android MainActivity.java. Without it, Movie download in the Cordova APK
# falls through to an anchor download that a WebView silently drops.
# Run after cordova platform add, before build. Idempotent.
#
# The bridge is a named top-level class (BMApkBridge) with a public String
# saveMovie method: anonymous-class bridges are a known reflection risk on
# some WebView versions, and the String return lets JS log the truth
# (saved ... vs FAILED: ...) instead of guessing.
import sys

p = sys.argv[1]
src = open(p).read()
if 'BMApkBridge' in src:
    print('already patched')
    sys.exit(0)

imports = 'import android.os.Bundle;'
imports += chr(10) + 'import android.os.Build;'
imports += chr(10) + 'import android.os.Environment;'
imports += chr(10) + 'import android.net.Uri;'
imports += chr(10) + 'import android.provider.MediaStore;'
imports += chr(10) + 'import android.webkit.JavascriptInterface;'
imports += chr(10) + 'import android.widget.Toast;'
imports += chr(10) + 'import android.content.ContentValues;'
imports += chr(10) + 'import java.io.IOException;'
imports += chr(10) + 'import java.io.OutputStream;'
assert 'import android.os.Bundle;' in src
src = src.replace('import android.os.Bundle;', imports, 1)

anchor = '        loadUrl(launchUrl);'
assert anchor in src
call = '        try {' + chr(10)
call += '            ((android.webkit.WebView) appView.getView()).addJavascriptInterface(new BMApkBridge(this), "BMApk");' + chr(10)
call += '        } catch (Throwable t) { android.util.Log.w("BMApk", "bridge failed: " + t); }' + chr(10)
src = src.replace(anchor, call + anchor, 1)

L = []
L.append('class BMApkBridge {')
L.append('    private final android.app.Activity act;')
L.append('    BMApkBridge(android.app.Activity act) { this.act = act; }')
L.append('    @JavascriptInterface')
L.append('    public String saveMovie(String name, String dataUrl) {')
L.append('        String safe = String.valueOf(name).replaceAll("[^A-Za-z0-9._-]", "_");')
L.append('        if (safe.length() == 0) safe = "bmmovie.json";')
L.append('        if (safe.length() > 64) safe = safe.substring(safe.length() - 64);')
L.append('        try {')
L.append('            int comma = dataUrl.indexOf(44);')
L.append('            byte[] raw = android.util.Base64.decode(dataUrl.substring(comma + 1), android.util.Base64.DEFAULT);')
L.append('            if (Build.VERSION.SDK_INT >= 29) {')
L.append('                ContentValues cv = new ContentValues();')
L.append('                cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);')
L.append('                cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");')
L.append('                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);')
L.append('                Uri uri = act.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);')
L.append('                if (uri == null) throw new IOException("mediastore-insert-null");')
L.append('                OutputStream os = act.getContentResolver().openOutputStream(uri);')
L.append('                os.write(raw);')
L.append('                os.close();')
L.append('            } else {')
L.append('                java.io.File d = new java.io.File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), safe);')
L.append('                java.io.FileOutputStream fos = new java.io.FileOutputStream(d);')
L.append('                fos.write(raw);')
L.append('                fos.close();')
L.append('            }')
L.append('            String msg = "saved Downloads/" + safe;')
L.append('            toast(msg);')
L.append('            return msg;')
L.append('        } catch (Throwable t) {')
L.append('            toast("movie save failed");')
L.append('            return "FAILED: " + String.valueOf(t.getMessage());')
L.append('        }')
L.append('    }')
L.append('    private void toast(final String msg) {')
L.append('        final android.app.Activity a = this.act;')
L.append('        a.runOnUiThread(new Runnable() { public void run() { Toast.makeText(a, msg, Toast.LENGTH_LONG).show(); } });')
L.append('    }')
L.append('}')
cls = chr(10).join(L) + chr(10)
stripped = src.rstrip()
assert stripped.endswith('}')
src = stripped + chr(10) + cls
open(p, 'w').write(src)
print('patched ' + p)
