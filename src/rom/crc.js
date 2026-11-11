// CRC32 (zlib polynomial) + MD5 (RFC 1321). Pure sync. Own code.
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32Hex(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0");
}
function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
export function md5Hex(bytes) {
  const S = [7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
             5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
             4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
             6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const msgLen = bytes.length;
  const total = (((msgLen + 9 + 63) >> 6) << 6);
  const M = new Uint8Array(total);
  M.set(bytes);
  M[msgLen] = 0x80;
  const bitLenHi = Math.floor(msgLen / 536870912);
  const bitLenLo = (msgLen << 3) >>> 0;
  const dv = new DataView(M.buffer);
  dv.setUint32(total - 8, bitLenLo, true);
  dv.setUint32(total - 4, bitLenHi, true);
  let a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;
  const X = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + X[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const h = n => (n >>> 0).toString(16).padStart(8, "0");
  const le = n => h(((n & 0xFF) << 24) | ((n & 0xFF00) << 8) | ((n >>> 8) & 0xFF00) | ((n >>> 24) & 0xFF));
  return le(a0) + le(b0) + le(c0) + le(d0);
}
