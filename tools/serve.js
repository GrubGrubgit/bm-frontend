// tiny static server for the headless loop (no deps). Serves repo root.
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".css": "text/css" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, path.normalize(p).replace(/^(\.\.[\\/])+/, ""));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(8901, "127.0.0.1", () => console.log("serve 8901"));
