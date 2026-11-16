// Dump Mesen frames as PNG (normal XRGB8888 decode) for visual check.
// Usage: node tools/mesen_shot.mjs <out.png> <frames> [startframe=600]
import { readFileSync, writeFileSync } from "fs";
import { deflateSync } from "zlib";
const OUT = process.argv[2], NF = +(process.argv[3] || 700), SF = +(process.argv[4] || 600);
function pngRGB(w, h, rgba) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3); row[0] = 0;
    for (let x = 0; x < w; x++) { row[1+x*3] = rgba[(y*w+x)*4]; row[1+x*3+1] = rgba[(y*w+x)*4+1]; row[1+x*3+2] = rgba[(y*w+x)*4+2]; }
    rows.push(row);
  }
  const { crc32 } = require("zlib");
  const c = deflateSync(Buffer.concat(rows), { level: 6 });
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), c]);
}
