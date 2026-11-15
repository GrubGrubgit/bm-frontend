# Patch the generated Cordova MainActivity to expose the BMApk.saveMovie
# JavascriptInterface (MediaStore -> Downloads), mirroring the hand-built
# android/src/.../MainActivity.java. Without it, Movie download in the
# Cordova APK falls through to an anchor download that a WebView silently
# drops. Run after `cordova platform add`, before build. Idempotent.
import sys

p = sys.argv[1]
src = open(p).read()
if '"BMApk"' in src:
    print('already patched')
    sys.exit(0)

imports = '''import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import android.content.ContentValues;
import java.io.IOException;
import java.io.OutputStream;'''
assert 'import android.os.Bundle;' in src
src = src.replace('import android.os.Bundle;', imports, 1)

anchor = '        loadUrl(launchUrl);'
assert anchor in src
bridge = '''        try {
            ((android.webkit.WebView) appView.getView()).addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void saveMovie(String name, String dataUrl) {
                    String safe = String.valueOf(name).replaceAll("[^A-Za-z0-9._-]", "_");
                    if (safe.length() == 0) safe = "bmmovie.json";
                    if (safe.length() > 64) safe = safe.substring(safe.length() - 64);
                    try {
                        int comma = dataUrl.indexOf(',');
                        byte[] raw = android.util.Base64.decode(dataUrl.substring(comma + 1), android.util.Base64.DEFAULT);
                        if (Build.VERSION.SDK_INT >= 29) {
                            ContentValues cv = new ContentValues();
                            cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                            cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                            cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                            if (uri == null) throw new IOException("mediastore-insert-null");
                            OutputStream os = getContentResolver().openOutputStream(uri);
                            os.write(raw);
                            os.close();
                        } else {
                            java.io.File d = new java.io.File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), safe);
                            java.io.FileOutputStream fos = new java.io.FileOutputStream(d);
                            fos.write(raw);
                            fos.close();
                        }
                        final String msg = "saved Downloads/" + safe;
                        MainActivity.this.runOnUiThread(new Runnable() { public void run() { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show(); } });
                    } catch (Throwable t) {
                        MainActivity.this.runOnUiThread(new Runnable() { public void run() { Toast.makeText(MainActivity.this, "movie save failed", Toast.LENGTH_LONG).show(); } });
                    }
                }
            }, "BMApk");
        } catch (Throwable t) { android.util.Log.w("BMApk", "bridge failed: " + t); }
'''
src = src.replace(anchor, bridge + anchor, 1)
open(p, 'w').write(src)
print('patched ' + p)
