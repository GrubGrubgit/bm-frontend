// tiny static server for the headless loop (no deps). Serves repo root.
// TEST-ONLY alias /testrom.nes -> the device-local reference ROM (project
// work/, gitignored, never shipped): lets the headless L2 self-test boot
// the real engine without a file picker. Localhost only, never deployed.
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const TESTROM = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/work/roms-dev/blaster-master-usa.nes";
const mime = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".css": "text/css", ".webmanifest": "application/manifest+json", ".nes": "application/octet-stream" };
function sendFile(res, f, type) {
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": type, "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    res.end(data);
  });
}
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/testrom.nes") { sendFile(res, TESTROM, "application/octet-stream"); return; }
  if (p.endsWith("/")) p += "index.html";
  const norm = path.normalize(p);
  if (norm === ".." || norm.startsWith("../") || norm.startsWith("..")) { res.writeHead(400); res.end("bad"); return; }
  const f = path.join(root, norm);
  sendFile(res, f, mime[path.extname(f)] || "application/octet-stream");
}).listen(8901, "127.0.0.1", () => console.log("serve 8901"));
