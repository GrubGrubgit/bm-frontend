package dev.bmweb.frontend;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;

public class LocalServer {
  public interface Opener {
    InputStream open(String path) throws IOException;
  }

  private final Opener opener;
  private ServerSocket ss;
  private Thread th;
  private volatile boolean running;

  public LocalServer(Opener opener) {
    this.opener = opener;
  }

  public int start(int hint) throws IOException {
    IOException last = null;
    for (int p = hint; p < hint + 10; p++) {
      try {
        ss = new ServerSocket();
        ss.setReuseAddress(true);
        ss.bind(new InetSocketAddress("127.0.0.1", p));
        running = true;
        Thread t = new Thread(new Runnable() {
          public void run() { loop(); }
        });
        t.setDaemon(true);
        t.start();
        th = t;
        return p;
      } catch (IOException e) {
        last = e;
        try { if (ss != null) ss.close(); } catch (IOException ignored) {}
        ss = null;
      }
    }
    throw last;
  }

  public void stop() {
    running = false;
    try { if (ss != null) ss.close(); } catch (IOException ignored2) {}
  }

  private void loop() {
    while (running) {
      try {
        final Socket s = ss.accept();
        Thread h = new Thread(new Runnable() {
          public void run() { handle(s); }
        });
        h.setDaemon(true);
        h.start();
      } catch (IOException e) {
        if (running) { try { Thread.sleep(50); } catch (InterruptedException ignored3) {} }
      }
    }
  }

  private static String reason(int code) {
    if (code == 200) return "OK";
    if (code == 400) return "Bad Request";
    if (code == 404) return "Not Found";
    return "Error";
  }

  private void send(OutputStream out, int code, String type, byte[] body) throws IOException {
    StringBuilder h = new StringBuilder();
    h.append("HTTP/1.1 ").append(code).append(" ").append(reason(code)).append("\r\n");
    h.append("Content-Type: ").append(type).append("\r\n");
    h.append("Content-Length: ").append(body.length).append("\r\n");
    h.append("Cross-Origin-Opener-Policy: same-origin\r\n");
    h.append("Cross-Origin-Embedder-Policy: require-corp\r\n");
    h.append("Cache-Control: no-store\r\n");
    h.append("Connection: close\r\n\r\n");
    out.write(h.toString().getBytes("UTF-8"));
    out.write(body);
    out.flush();
  }

  private void handle(Socket s) {
    try {
      InputStream in = s.getInputStream();
      OutputStream out = s.getOutputStream();
      byte[] tmp = new byte[4096];
      int n = in.read(tmp);
      if (n <= 0) { s.close(); return; }
      String head = new String(tmp, 0, n, "UTF-8");
      int eol = head.indexOf("\r\n");
      if (eol < 0) { s.close(); return; }
      String[] parts = head.substring(0, eol).split(" ");
      if (parts.length < 2 || !parts[0].equals("GET")) {
        send(out, 400, "text/plain", "bad".getBytes("UTF-8"));
        s.close();
        return;
      }
      String path = parts[1];
      int q = path.indexOf("?");
      if (q >= 0) path = path.substring(0, q);
      if (path.endsWith("/")) path = path + "index.html";
      if (path.startsWith("/")) path = path.substring(1);
      if (path.length() == 0) path = "index.html";
      if (path.contains("..")) {
        send(out, 400, "text/plain", "bad".getBytes("UTF-8"));
        s.close();
        return;
      }
      AssetRoute r = AssetRoute.resolve(path);
      if (r == null) {
        send(out, 404, "text/plain", "nf".getBytes("UTF-8"));
        s.close();
        return;
      }
      byte[] body;
      try {
        InputStream f = opener.open(r.asset);
        if (f == null) throw new IOException("missing");
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int c;
        while ((c = f.read(buf)) >= 0) bos.write(buf, 0, c);
        f.close();
        body = bos.toByteArray();
      } catch (IOException e) {
        send(out, 404, "text/plain", "nf".getBytes("UTF-8"));
        s.close();
        return;
      }
      send(out, 200, r.mime, body);
      s.close();
    } catch (IOException ignored4) {
      try { s.close(); } catch (IOException ignored5) {}
    }
  }
}
