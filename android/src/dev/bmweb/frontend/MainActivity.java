package dev.bmweb.frontend;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.AssetManager;
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
  private LocalServer server;
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
    String curl = null;
    try {
      Intent svc = new Intent(this, ServerService.class);
      if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
      for (int i = 0; i < 20 && curl == null; i++) {
        curl = ServerService.baseUrl;
        if (curl == null) { try { Thread.sleep(100); } catch (InterruptedException ignored16) {} }
      }
    } catch (Throwable ignored17) {}
    if (curl != null && openInChrome(curl + "index.html")) {
      showStatus(curl);
    } else {
      try {
        startApp();
      } catch (Throwable e) {
        try { writeCrash(traceOf(e), false); } catch (Throwable ignored6) {}
        showCrash("STARTUP CRASH:\n" + traceOf(e), false);
      }
    }
  }

  private String startLocalServer() {
    try {
      final AssetManager assets = getAssets();
      LocalServer srv = new LocalServer(new LocalServer.Opener() {
        public InputStream open(String path) throws IOException { return assets.open(path); }
      });
      int[] ports = new int[] { 8901, 8902, 8903, 8904, 8905, 8906, 8907, 8908, 8909, 8910 };
      for (int i = 0; i < ports.length; i++) {
        try {
          int p = srv.start(ports[i]);
          server = srv;
          return "http://127.0.0.1:" + p + "/";
        } catch (IOException ignored13) {}
      }
      return null;
    } catch (Throwable t) { return null; }
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
          Map<String, String> h = new HashMap<String, String>();
          h.put("Cross-Origin-Opener-Policy", "same-origin");
          h.put("Cross-Origin-Embedder-Policy", "require-corp");
          h.put("Cross-Origin-Resource-Policy", "same-origin");
          h.put("Cache-Control", "no-store");
          WebResourceResponse resp = new WebResourceResponse(r.mime, r.text ? "UTF-8" : null, 200, "OK", h, in);
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resp.setResponseHeaders(h);
          }
          return resp;
        } catch (Throwable t) { return null; }
      }
      public void onPageFinished(WebView v, String url) {
        try {
          final WebView vv = v;
          vv.evaluateJavascript("window.__probeResult=\"pending\";(async()=>{let h={},j={};try{const r=await fetch(\"index.html\");h.coop=r.headers.get(\"cross-origin-opener-policy\");h.coep=r.headers.get(\"cross-origin-embedder-policy\");h.corp=r.headers.get(\"cross-origin-resource-policy\");}catch(e){h.err=String(e).slice(0,120);}try{const r2=await fetch(\"src/app.js\");j.corp=r2.headers.get(\"cross-origin-resource-policy\");j.ct=r2.headers.get(\"content-type\");}catch(e){j.err=String(e).slice(0,120);}window.__probeResult=JSON.stringify({coi:window.crossOriginIsolated,secure:window.isSecureContext,sab:typeof SharedArrayBuffer,origin:location.origin,ua:navigator.userAgent,h:h,js:j});})()", null);
          Thread t = new Thread(new Runnable() {
            public void run() {
              try { Thread.sleep(4000); } catch (InterruptedException ignored11) {}
              vv.post(new Runnable() {
                public void run() {
                  try {
                    vv.evaluateJavascript("JSON.stringify(window.__probeResult)", new ValueCallback<String>() {
                      public void onReceiveValue(String val) {
                        try {
                          FileOutputStream f = new FileOutputStream(new File(getFilesDir(), LOG), true);
                          String line = "PROBE " + val + "\n";
                            injectReport(vv);
                          f.write(line.getBytes("UTF-8"));
                          f.close();
                        } catch (Throwable ignored9) {}
                      }
                    });
                  } catch (Throwable ignored10) {}
                }
              });
            }
          });
          t.setDaemon(true);
          t.start();
        } catch (Throwable ignored12) {}
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
    String base = startLocalServer();
    if (base != null) web.loadUrl(base + "index.html?inapp=1");
    else web.loadUrl("https://" + HOST + "/index.html?inapp=1");
  }

  private boolean openInChrome(String url) {
    try {
      Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
      i.setPackage("com.android.chrome");
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      startActivity(i);
      return true;
    } catch (Throwable t1) {
      try {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
        return true;
      } catch (Throwable t2) { return false; }
    }
  }

  private void showStatus(final String curl) {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) (16 * getResources().getDisplayMetrics().density);
    root.setPadding(pad, pad, pad, pad);
    TextView tv = new TextView(this);
    tv.setText("BM Web server running at\n" + curl + "\n\nGame opened in Chrome. Keep this app in background (do not swipe it away) while playing.\nROM and saves live in Chrome and persist there.");
    tv.setTextSize(14);
    root.addView(tv);
    Button again = new Button(this);
    again.setText("Reopen in Chrome");
    again.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { openInChrome(curl + "index.html"); } });
    root.addView(again);
    Button stop = new Button(this);
    stop.setText("Stop server and exit");
    stop.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { try { stopService(new Intent(MainActivity.this, ServerService.class)); } catch (Throwable ignored18) {} finish(); } });
    root.addView(stop);
    setContentView(root);
  }

  private static String traceOf(Throwable e) {
    ByteArrayOutputStream bos = new ByteArrayOutputStream();
    e.printStackTrace(new PrintStream(bos));
    try { return bos.toString("UTF-8"); } catch (Exception x) { return bos.toString(); }
  }

  private File crashFile() { return new File(getFilesDir(), LOG); }

  private void injectReport(final WebView vv) {
    try {
      String all = readCrash();
      if (all == null || all.length() == 0) return;
      if (all.length() > 4000) all = all.substring(all.length() - 4000);
      String q = all.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
      final String js = "window.__bmLastReport=\"" + q + "\";";
      vv.post(new Runnable() { public void run() { try { vv.evaluateJavascript(js, null); } catch (Throwable ignored14) {} } });
    } catch (Throwable ignored15) {}
  }
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
