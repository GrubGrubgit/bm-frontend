package dev.bmweb.frontend;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
  private WebView web;
  private ValueCallback<Uri[]> fileCb;
  private static final int FILE_REQ = 1001;
  private static final String HOST = "bmweb.local";
  private static final String LOG = "report.log";

  protected void onCreate(Bundle b) {
    super.onCreate(b);
    final MainActivity self = this;
    Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
      public void uncaughtException(Thread t, Throwable e) {
        try { self.writeCrash(traceOf(e), false); } catch (Throwable ignored4) {}
        try { Thread.sleep(500); } catch (InterruptedException ignored5) {}
        System.exit(2);
      }
    });
    String last = readCrash();
    if (last != null && last.length() > 0) {
      showCrash("LAST REPORT:\n" + last, true);
      return;
    }
    try {
      startApp();
    } catch (Throwable e) {
      try { writeCrash(traceOf(e), false); } catch (Throwable ignored6) {}
      showCrash("STARTUP CRASH:\n" + traceOf(e), false);
    }
  }

  private void startApp() {
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    immersive();
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setAllowFileAccess(false);
    web.setWebViewClient(new WebViewClient() {
      public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
        try {
          if (!"GET".equals(req.getMethod())) return null;
          if (!HOST.equals(req.getUrl().getHost())) return null;
          AssetRoute r = AssetRoute.resolve(req.getUrl().getPath());
          if (r == null) { miss(req.getUrl().getPath()); return null; }
          InputStream in;
          try {
            in = getAssets().open(r.asset);
          } catch (IOException e) {
            miss(r.asset);
            return null;
          }
          WebResourceResponse resp = new WebResourceResponse(r.mime, r.text ? "UTF-8" : null, in);
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Map<String, String> h = new HashMap<String, String>();
            h.put("Cross-Origin-Opener-Policy", "same-origin");
            h.put("Cross-Origin-Embedder-Policy", "require-corp");
            h.put("Cache-Control", "no-store");
            resp.setResponseHeaders(h);
          }
          return resp;
        } catch (Throwable t) { return null; }
      }
    });
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
      public boolean onConsoleMessage(ConsoleMessage m) {
        try {
          if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR && m.message() != null && m.message().contains("SharedArrayBuffer")) {
            String line = "JS: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")\n";
            FileOutputStream f = new FileOutputStream(new File(getFilesDir(), LOG), true);
            f.write(line.getBytes("UTF-8"));
            f.close();
          }
        } catch (Throwable ignored7) {}
        return false;
      }
    });
    setContentView(web);
    web.loadUrl("https://" + HOST + "/index.html");
  }

  private static String traceOf(Throwable e) {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    e.printStackTrace(new PrintStream(bos));
    try { return bos.toString("UTF-8"); } catch (Exception x) { return bos.toString(); }
  }

  private File crashFile() { return new File(getFilesDir(), LOG); }

  private void miss(String what) {
    try {
      FileOutputStream f = new FileOutputStream(new File(getFilesDir(), LOG), true);
      String line = "MISS " + what + "\n";
      f.write(line.getBytes("UTF-8"));
      f.close();
    } catch (Throwable ignored8) {}
  }

  private void writeCrash(String trace, boolean append) {
    try {
      FileOutputStream f = new FileOutputStream(crashFile(), append);
      f.write(trace.getBytes("UTF-8"));
      f.close();
    } catch (Exception ignored3) {}
  }

  private String readCrash() {
    try {
      FileInputStream f = new FileInputStream(crashFile());
      ByteArrayOutputStream bos = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int r;
      while ((r = f.read(buf)) >= 0) bos.write(buf, 0, r);
      f.close();
      return bos.toString("UTF-8");
    } catch (Exception e) { return null; }
  }

  private void showCrash(String trace, final boolean offerContinue) {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    TextView tv = new TextView(this);
    tv.setText(trace);
    tv.setTextSize(12);
    ScrollView sv = new ScrollView(this);
    sv.addView(tv);
    root.addView(sv, new LinearLayout.LayoutParams(-1, 0, 1.0f));
    if (offerContinue) {
      Button b = new Button(this);
      b.setText("Clear and start app");
      b.setOnClickListener(new View.OnClickListener() {
        public void onClick(View v) { crashFile().delete(); startApp(); }
      });
      root.addView(b);
    }
    setContentView(root);
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
