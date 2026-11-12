package dev.bmweb.frontend;

public class AssetRoute {
  public final String mime;
  public final String asset;
  public final boolean text;

  private AssetRoute(String mime, String asset, boolean text) {
    this.mime = mime;
    this.asset = asset;
    this.text = text;
  }

  public static String mimeFor(String ext) {
    if (ext.equals("html")) return "text/html";
    if (ext.equals("js")) return "text/javascript";
    if (ext.equals("wasm")) return "application/wasm";
    if (ext.equals("json")) return "application/json";
    if (ext.equals("webmanifest")) return "application/manifest+json";
    if (ext.equals("png")) return "image/png";
    if (ext.equals("css")) return "text/css";
    if (ext.equals("ico")) return "image/x-icon";
    if (ext.equals("svg")) return "image/svg+xml";
    return null;
  }

  public static AssetRoute resolve(String rawPath) {
    if (rawPath == null) return null;
    String p = rawPath;
    int q = p.indexOf("?");
    if (q >= 0) p = p.substring(0, q);
    if (p.endsWith("/")) p = p + "index.html";
    if (p.startsWith("/")) p = p.substring(1);
    if (p.length() == 0) p = "index.html";
    if (p.contains("..") || p.contains("\\")) return null;
    String ext = "";
    int dot = p.lastIndexOf(".");
    if (dot >= 0) ext = p.substring(dot + 1).toLowerCase();
    String mime = mimeFor(ext);
    if (mime == null) return null;
    boolean text = mime.startsWith("text/") || mime.equals("application/javascript") || mime.equals("application/json") || mime.equals("application/manifest+json");
    return new AssetRoute(mime, "www/" + p, text);
  }
}
