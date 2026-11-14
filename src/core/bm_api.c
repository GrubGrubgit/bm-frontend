// bm_api.c -- L2 thin C adapter (freestanding wasm32) over the pinned engine.
// Amalgamation wrap: build/vendor/combined_off.c is included unmodified
// (byte-identical to recomp/gen at ENGINE_PIN; runtime.h carries the
// adapter-owned APU ring, applied by tools/patch_vendor.py with anchors).
// Frame model: nmi_fire_fn hook runs the real NMI + render per vblank edge;
// the host drives stepping through the host_frame() import (worker SAB
// handshake or node harness). No engine control flow is altered.
#include <stdint.h>
#include <stdio.h>
#include <string.h>
FILE *stderr = 0;
int fprintf(FILE *s, const char *f, ...) { (void)s; (void)f; return 0; }
void *memset(void *d, int c, size_t n) {
  unsigned char *p = (unsigned char *)d;
  while (n--) *p++ = (unsigned char)c;
  return d;
}
void *memcpy(void *d, const void *s, size_t n) {
  unsigned char *p = (unsigned char *)d;
  const unsigned char *q = (const unsigned char *)s;
  while (n--) *p++ = *q++;
  return d;
}
void *memmove(void *d, const void *s, size_t n) { return memcpy(d, s, n); }
#include "combined_off.c"
__attribute__((import_module("env"))) __attribute__((import_name("host_frame"))) void host_frame(int frame);
static int frame_no;
static uint8_t game_pad;
static int apu_tail;
static uint8_t stage[131072];
uint8_t chr[131072];
uint8_t framebuf[256 * 240 * 4];
static const uint8_t NESPAL[64][3] = {
{0x75,0x75,0x75},{0x27,0x1B,0x8F},{0x00,0x00,0xAB},{0x47,0x00,0x9F},{0x8F,0x00,0x77},{0xAB,0x00,0x13},{0xA7,0x00,0x00},{0x7F,0x0B,0x00},{0x43,0x2B,0x00},{0x00,0x47,0x00},{0x00,0x51,0x00},{0x00,0x3A,0x6B},{0x00,0x00,0x00},{0x00,0x00,0x00},{0x00,0x00,0x00},{0x00,0x00,0x00},
{0xBC,0xBC,0xBC},{0x00,0x78,0xF8},{0x00,0x58,0xF8},{0x68,0x44,0xFC},{0xD8,0x00,0xCC},{0xE4,0x00,0x58},{0xF8,0x38,0x00},{0xE4,0x5C,0x10},{0xAC,0x7C,0x00},{0x00,0xB8,0x00},{0x00,0xA8,0x00},{0x00,0xA8,0x44},{0x00,0x88,0x88},{0x00,0x00,0x00},{0x00,0x00,0x00},{0x00,0x00,0x00},
{0xF8,0xF8,0xF8},{0x3C,0xBC,0xFC},{0x68,0x88,0xFC},{0x98,0x78,0xF8},{0xF8,0x78,0xF8},{0xF8,0x58,0x98},{0xF8,0x78,0x58},{0xFC,0xA0,0x44},{0xF8,0xB8,0x00},{0xB8,0xF8,0x18},{0x58,0xD8,0x54},{0x58,0xF8,0x98},{0x00,0xE8,0xD8},{0x78,0x78,0x78},{0x00,0x00,0x00},{0x00,0x00,0x00},
{0xFC,0xFC,0xFC},{0xA4,0xE4,0xFC},{0xB8,0xB8,0xF8},{0xD8,0xB8,0xF8},{0xF8,0xB8,0xF8},{0xF8,0xA8,0xC0},{0xF0,0xD0,0xB0},{0xFC,0xE0,0xA8},{0xF8,0xD8,0x78},{0xD8,0xF8,0x78},{0xB8,0xF8,0xB8},{0xB8,0xF8,0xD8},{0x00,0xFC,0xFC},{0xF8,0xD8,0xF8},{0x00,0x00,0x00},{0x00,0x00,0x00}};
static uint8_t pad_fn(uint64_t f) { (void)f; return game_pad; }
static uint8_t bg_opaque[256*240];
static void render(void) {
  int mode8k = !(mmc_ctrl & 0x10);
  int b0 = mode8k ? (chr0 & 0xFE) : chr0;
  int b1 = mode8k ? (chr0 & 0xFE) : chr1;
  int bb = (reg2000 & 0x10) ? b1 : b0;
  int sb = (reg2000 & 0x08) ? b1 : b0;
  int spr16 = (reg2000 & 0x20) ? 1 : 0;
  int bg_en = reg2001 & 0x08;
  int spr_en = reg2001 & 0x10;
  int bg_left = reg2001 & 0x02;
  int spr_left = reg2001 & 0x04;
  int back_idx = pal[0] & 0x3F;
  int mir = mmc_ctrl & 3;
  int base = reg2000 & 3;
  int base_x = base & 1;
  int x, y;
  for (y = 0; y < 240; y++) {
    for (x = 0; x < 256; x++) {
      int vx, vy, nt, tx, ty, base_vram;
      if (mir == 2) {
        vx = (base_x * 256 + scx + x) % 512;
        vy = (scy + y) % 240;
        nt = (vx >= 256) ? 1 : 0;
        tx = (vx & 255) >> 3; ty = vy >> 3;
        base_vram = nt ? 0x400 : 0x000;
      } else if (mir == 3) {
        int base_y = (base >> 1) & 1;
        vx = (scx + x) & 255;
        vy = (base_y * 240 + scy + y) % 480;
        nt = (vy >= 240) ? 1 : 0;
        tx = vx >> 3; ty = (nt ? (vy - 240) : vy) >> 3;
        base_vram = nt ? 0x400 : 0x000;
      } else if (mir == 1) {
        vx = (scx + x) & 255; vy = (scy + y) % 240;
        tx = vx >> 3; ty = vy >> 3; base_vram = 0x400;
      } else {
        vx = (scx + x) & 255; vy = (scy + y) % 240;
        tx = vx >> 3; ty = vy >> 3; base_vram = 0x000;
      }
      int t = vram[base_vram + ty * 32 + tx];
      int ax = vram[base_vram + 0x3C0 + (ty >> 2) * 8 + (tx >> 2)];
      int sh = ((ty & 2) ? 4 : 0) + ((tx & 2) ? 2 : 0);
      int palhi = (ax >> sh) & 3;
      int off = bb * 0x1000 + t * 16;
      int row = vy & 7;
      int col = vx & 7;
      int lo = chr[off + row], hi = chr[off + row + 8];
      int bit = ((lo >> (7 - col)) & 1) | (((hi >> (7 - col)) & 1) << 1);
      int pix_on = bg_en && (bit != 0) && (bg_left || x >= 8);
      int idx = pix_on ? (pal[palhi * 4 + bit] & 0x3F) : back_idx;
      uint8_t *px = &framebuf[(y * 256 + x) * 4];
      px[0] = NESPAL[idx][0]; px[1] = NESPAL[idx][1]; px[2] = NESPAL[idx][2]; px[3] = 255;
      bg_opaque[y * 256 + x] = pix_on ? 1 : 0;
    }
  }
  if (spr_en) {
    int s;
    for (s = 0; s < 64; s++) {
      int oy = oam[s * 4];
      int ti, at, ox;
      int hh, palb, fx, fy, r;
      if (oy >= 0xEF) continue;
      ti = oam[s * 4 + 1];
      at = oam[s * 4 + 2];
      ox = oam[s * 4 + 3];
      hh = spr16 ? 16 : 8;
      palb = at & 3; fx = at & 0x40; fy = at & 0x80;
      for (r = 0; r < hh; r++) {
        int rr = fy ? (hh - 1 - r) : r;
        int t2, off, lo, hi, yy, q;
        if (spr16) {
          int bank4k;
          if (mode8k) bank4k = (chr0 & 0xFE) + (ti & 1);
          else bank4k = (ti & 1) ? chr1 : chr0;
          t2 = (ti & 0xFE) + (rr >> 3);
          off = bank4k * 0x1000 + t2 * 16;
        } else {
          t2 = ti;
          off = sb * 0x1000 + t2 * 16;
        }
        lo = chr[off + (rr & 7)]; hi = chr[off + (rr & 7) + 8];
        yy = oy + 1 + r;
        if (yy < 0 || yy >= 240) continue;
        for (q = 0; q < 8; q++) {
          int cc = fx ? (7 - q) : q;
          int v = ((lo >> (7 - cc)) & 1) | ((((hi >> (7 - cc)) & 1) << 1));
          int xx = ox + q;
          if (v && xx >= 0 && xx < 256 && (spr_left || xx >= 8)) {
            if ((at & 0x20) && bg_opaque[yy * 256 + xx]) continue;
            {
              int idx2 = pal[16 + palb * 4 + v] & 0x3F;
              uint8_t *px2 = &framebuf[(yy * 256 + xx) * 4];
              px2[0] = NESPAL[idx2][0]; px2[1] = NESPAL[idx2][1]; px2[2] = NESPAL[idx2][2];
            }
          }
        }
      }
    }
  }
}

static void nmi_frame(void) {
  b7_entry_EB7E();
  render();
  host_frame(frame_no++);
}
int bm_stage_ptr(void) { return (int)(intptr_t)stage; }
void bm_load_prg(void) { memcpy(prg, stage, sizeof prg); }
void bm_load_chr(void) { memcpy(chr, stage, sizeof chr); }
int bm_video_ptr(void) { return (int)(intptr_t)framebuf; }
int bm_oam_ptr(void) { return (int)(intptr_t)oam; }
int bm_frame_no(void) { return frame_no; }
void bm_set_pad(int m) { game_pad = (uint8_t)(m & 0xFF); }
int bm_audio_read(int dst_ptr, int max) {
  uint8_t *dst = (uint8_t *)(intptr_t)dst_ptr;
  int n = 0;
  while (apu_tail < apu_head && n < max) {
    ApuEv *e = &apu_ring[(apu_tail++) & 255];
    dst[0] = (uint8_t)(e->a & 0xFF); dst[1] = (uint8_t)(e->a >> 8);
    dst[2] = e->v; dst[3] = 0;
    dst[4] = (uint8_t)(e->c & 0xFF); dst[5] = (uint8_t)((e->c >> 8) & 0xFF);
    dst[6] = (uint8_t)((e->c >> 16) & 0xFF); dst[7] = (uint8_t)(e->c >> 24);
    dst += 8; n++;
  }
  return n;
}
uint32_t bm_hash(void) {
  uint32_t h = 2166136261u;
  int i;
  h ^= (uint32_t)(cycles & 0xFFFFFFFFu); h *= 16777619u;
  h ^= (uint32_t)((cycles >> 32) & 0xFFFFFFFFu); h *= 16777619u;
  for (i = 0; i < 0x800; i++) { h ^= ram[i]; h *= 16777619u; }
  for (i = 0; i < 0x800; i++) { h ^= vram[i]; h *= 16777619u; }
  for (i = 0; i < 32; i++) { h ^= pal[i]; h *= 16777619u; }
  for (i = 0; i < 0x100; i++) { h ^= oam[i]; h *= 16777619u; }
  h ^= A; h *= 16777619u; h ^= X; h *= 16777619u; h ^= Y; h *= 16777619u;
  h ^= S; h *= 16777619u; h ^= P; h *= 16777619u;
  h ^= scx; h *= 16777619u; h ^= scy; h *= 16777619u; h ^= reg2000; h *= 16777619u; h ^= reg2001; h *= 16777619u;
  h ^= chr0; h *= 16777619u; h ^= chr1; h *= 16777619u; h ^= mmc_ctrl; h *= 16777619u;
  return h;
}
int bm_mem_size(void) {
  extern unsigned char __heap_base;
  return (int)(intptr_t)&__heap_base;
}
void bm_boot(void) {
  memset(ram, 0xFF, sizeof ram); // jsnes-parity power-on pattern
  memset(vram, 0, sizeof vram);
  memset(pal, 0, sizeof pal);
  memset(oam, 0, sizeof oam);
  A = 0; X = 0; Y = 0; S = 0xFD; P = 0x24;
  pad_bits = 0; pad_pos1 = 0; pad_pos2 = 0; strobe = 0; pad_latch1 = 0; pad_latch2 = 0;
  cycles = 9; scx = 0; scy = 0; sc_latch = 0; ppu_addr = 0; ppu_latch = 0;
  ppu_buf = 0; oam_addr = 0; reg2000 = 0; reg2001 = 0; chr0 = 0; chr1 = 0;
  mmc_shift = 0; mmc_count = 0; mmc_ctrl = 0x0C; swbank = prg[0];
  nmi_next_edge = 27517; nmi_armed = 1; in_nmi = 0;
  frame_no = 0; game_pad = 0; apu_head = 0; apu_tail = 0;
  pad_sample_fn = pad_fn;
  nmi_fire_fn = nmi_frame;
  b7_entry_F23B();
}
// 4160-byte tracer-layout snapshot: ram[2048] + vram[2048] + footer[64]
// (footer[0:32]=palette, [32]=scx, [33]=scy, [34]=reg2000, [35]=chr0,
// [36]=chr1, [37]=mmc_ctrl). Matches recomp/tools/trace snapshot files.
void bm_snap(void) {
  uint8_t *d = stage;
  memcpy(d, ram, 2048); d += 2048;
  memcpy(d, vram, 2048); d += 2048;
  memcpy(d, pal, 32);
  d[32] = scx; d[33] = scy; d[34] = reg2000; d[35] = chr0; d[36] = chr1; d[37] = mmc_ctrl; d[38] = reg2001;
}
// PLAIN single-entry model (no asyncify, by decision 2026-11-11): the host
// calls bm_boot() EXACTLY ONCE per run. Boot enters the game (reset vector
// F23B); each vblank edge runs nmi_frame() which renders then calls the
// host_frame() import. The host controls stepping from inside that import:
// node harnesses throw-to-stop, the browser suspends the exact continuation.
// Re-calling bm_boot() mid-run re-enters the game and MUST NOT be done.
