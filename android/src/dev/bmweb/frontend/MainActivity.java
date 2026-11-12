package dev.bmweb.frontend;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends Activity {
  private WebView web;
  private LocalServer server;
  private ValueCallback<Uri[]> fileCb;
  private static final int FILE_REQ = 1001;

  protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    immersive();
    final AssetManager assets = getAssets();
    server = new LocalServer(new LocalServer.Opener() {
      public InputStream open(String path) throws IOException {
        return assets.open("www/" + path);
      }
    });
    int port;
    try {
      port = server.start();
    } catch (IOException e) {
      throw new RuntimeException(e);
    }
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient() {
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
        if (fileCb != null) fileCb.onReceiveValue(null);
        fileCb = cb;
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        try {
          startActivityForResult(Intent.createChooser(i, "Select ROM"), FILE_REQ);
        } catch (ActivityNotFoundException e) {
          fileCb = null;
          cb.onReceiveValue(null);
          return false;
        }
        return true;
      }
    });
    setContentView(web);
    web.loadUrl("http://127.0.0.1:" + port + "/index.html");
  }

  protected void onActivityResult(int req, int res, Intent data) {
    super.onActivityResult(req, res, data);
    if (req != FILE_REQ || fileCb == null) return;
    Uri[] uris = null;
    if (res == RESULT_OK && data != null) {
      if (data.getClipData() != null) {
        int n = data.getClipData().getItemCount();
        uris = new Uri[n];
        for (int k = 0; k < n; k++) uris[k] = data.getClipData().getItemAt(k).getUri();
      } else if (data.getData() != null) {
        uris = new Uri[] { data.getData() };
      }
    }
    fileCb.onReceiveValue(uris);
    fileCb = null;
  }

  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) immersive();
  }

  protected void onDestroy() {
    if (server != null) server.stop();
    if (web != null) web.destroy();
    super.onDestroy();
  }

  private void immersive() {
    View d = getWindow().getDecorView();
    int f = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
      | View.SYSTEM_UI_FLAG_FULLSCREEN
      | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
      | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
      | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
    d.setSystemUiVisibility(f);
  }
}
