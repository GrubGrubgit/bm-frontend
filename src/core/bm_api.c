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
static char bm_trap_name[24];
static uint16_t bm_trap_val;
static int bm_trap_seen;
void bm_trap(uint16_t v, const char *name) {
  if (!bm_trap_seen) {
    int i;
    bm_trap_seen = 1;
    bm_trap_val = v;
    bm_trap_name[0] = 0;
    if (name) {
      i = 0;
      while (i < 23 && name[i]) { bm_trap_name[i] = name[i]; i++; }
      bm_trap_name[i] = 0;
    }
  }
  __builtin_trap();
}
int bm_trap_flag(void) { return bm_trap_seen; }
int bm_trap_code(void) { return (int)bm_trap_val; }
int bm_trap_namep(void) { return (int)(intptr_t)bm_trap_name; }
void dbg_ev(uint32_t x);
static int frame_no;
static uint8_t game_pad;
static int pending_warp = -1;
static int pending_warp_raw = -1;
static int apu_tail;
static void save_stage_freeze(void);
// E1 lives rule (E1b): infinite lives while saving is on. Config flag lives
// BEFORE the engine include so the vendored lives-gate (hook 6) can see it.
// Sticky across bm_boot, excluded from freeze/thaw blobs (like enhanced_mode).
static int saving_on = 0;
#include "combined_off.c"
__attribute__((import_module("env"))) __attribute__((import_name("host_frame"))) void host_frame(int frame);
static uint32_t dbgev[2097152]; static int dbgn;
void dbg_ev(uint32_t x) { if (dbgn < 2097152) dbgev[dbgn++] = x; }
int bm_dbgn(void) { return dbgn; }
uint32_t bm_dbg(int i) { return (i >= 0 && i < dbgn) ? dbgev[i] : 0; }
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
    for (s = 63; s >= 0; s--) {
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

// Pre-NMI RAM snapshot (trace/debug only, zero gameplay effect): the Mesen
// oracle snaps pre-NMI phase, so wall-indexed comparisons read presnap.
static uint8_t presnap_ram[2048];
static uint64_t presnap_cyc;
static uint32_t ppu_snap[20];
static void ppu_snap_take(void) {
  ppu_snap[0]=(uint32_t)ppu_scan; ppu_snap[1]=(uint32_t)ppu_dot; ppu_snap[2]=ppu_frame;
  ppu_snap[3]=vblank_on; ppu_snap[4]=cpu_nmi; ppu_snap[5]=cpu_nmi_prev; ppu_snap[6]=need_nmi; ppu_snap[7]=prevent_vbl;
  ppu_snap[8]=(uint32_t)(mcpu_clk&0xFFFFFFFFu); ppu_snap[9]=(uint32_t)((mcpu_clk>>32)&0xFFFFFFFFu);
  ppu_snap[10]=(uint32_t)(ppu_mclk&0xFFFFFFFFu); ppu_snap[11]=(uint32_t)((ppu_mclk>>32)&0xFFFFFFFFu);
  ppu_snap[12]=w2000_old; ppu_snap[13]=(uint32_t)w2000_has; ppu_snap[14]=(uint32_t)w2000_done;
  ppu_snap[15]=reg2000; ppu_snap[16]=reg2001; ppu_snap[17]=(uint32_t)(wall_no&0xFFFFFFFFu); ppu_snap[18]=(uint32_t)(pad_wall&0xFFFFFFFFu);
  ppu_snap[19]=(uint32_t)(synced_cyc&0xFFFFFFFFu);
}
int bm_ppu_ptr(void) { return (int)(intptr_t)ppu_snap; }
static uint32_t cpu_snap[6];
int bm_cpu_ptr(void) { return (int)(intptr_t)cpu_snap; }
int bm_ram_rd(int a) { return ram[a & 0x7FF]; }
void bm_ram_wr(int a, int v) { ram[a & 0x7FF] = (uint8_t)(v & 0xFF); }
void bm_warp(int area) { pending_warp = area & 7; }
void bm_warp_raw(int area) { pending_warp_raw = area & 15; }
static void nmi_frame(void) {
  { uint32_t i; for (i = 0; i < 2048u; i++) presnap_ram[i] = presnap2_ram[i]; }
  presnap_cyc = presnap2_cyc;
  cpu_snap[0]=presnap2_S; cpu_snap[1]=presnap2_P; cpu_snap[2]=presnap2_A; cpu_snap[3]=presnap2_X; cpu_snap[4]=presnap2_Y; cpu_snap[5]=presnap2_pc;
  ppu_snap_take();
  b7_entry_EB7E();
  render();
  host_frame(frame_no++);
  if (pending_warp >= 0) {
    int w = pending_warp;
    pending_warp = -1;
    ram[0x14] = (uint8_t)(w & 7);
    in_nmi = 0;
    __attribute__((musttail)) return b7_entry_C2FB();
  }
  if (pending_warp_raw >= 0) {
    int w = pending_warp_raw;
    pending_warp_raw = -1;
    ram[0x14] = (uint8_t)(w & 15);
    in_nmi = 0;
    __attribute__((musttail)) return b7_entry_C301();
  }
}
int bm_pre_ptr(void) { return (int)(intptr_t)presnap_ram; }
int bm_preh_lo(void) { return (int)(presnap_cyc & 0xFFFFFFFFu); }
int bm_preh_hi(void) { return (int)((presnap_cyc >> 32) & 0xFFFFFFFFu); }
int bm_stage_ptr(void) { return (int)(intptr_t)stage; }
void bm_load_prg(void) { memcpy(prg, stage, sizeof prg); }
void bm_load_chr(void) { memcpy(chr, stage, sizeof chr); }
int bm_video_ptr(void) { return (int)(intptr_t)framebuf; }
int bm_oam_ptr(void) { return (int)(intptr_t)oam; }
int bm_frame_no(void) { return frame_no; }
int bm_cycles_lo(void) { return (int)(cycles & 0xFFFFFFFFu); }
int bm_cycles_hi(void) { return (int)((cycles >> 32) & 0xFFFFFFFFu); }
// Live wall counter (walls crossed per crossed NMI edge, incl. NMI-off
// walls): replay feeds pads[wall+1] so the next handler strobe latches
// the same pad the oracle/probe latch (cycle-measured, STROBE-verified).
uint32_t bm_pad_wall(void) { return (uint32_t)(pad_wall & 0xFFFFFFFFu); }
void bm_set_pad(int m) { game_pad = (uint8_t)(m & 0xFF); }
// ---- E6 enhanced-mode master toggle ----
// Engine config (NOT game state): excluded from freeze/thaw blobs, sticky
// across bm_boot, default off. Gates all engine enhancements (E1+).
static int enhanced_mode = 0;
void bm_enhanced_set(int v) { enhanced_mode = v ? 1 : 0; }
int bm_enhanced_get(void) { return enhanced_mode; }

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
// ---- P4 entrance-save state (exact-state saves, no passwords) ----
// Snapshot of every live global (audit 2026-11-24). stk lives inside
// ram[0x100..]. Excluded (derived/refreshed/harmless): stage/chr/framebuf/
// NESPAL/bg_opaque (load/render scratch), presnap*/ppu_snap/cpu_snap
// (refreshed every frame), dbgev/dbgn (append-only debug log), const
// string pointers (uw_caller/max_gap_site). APU has no voice regs
// (RD(0x4015) returns constant 0; ring+head+tail fully determine audio).
#define SAVE_MAGIC 0x424D5356u
#define SAVE_VERSION 1u
#define SAVE_MAX 8192u
#define WAIT_PC0 0xE93Au
#define WAIT_PC1 0xE93Cu
static uint8_t save_stage[SAVE_MAX];
static uint8_t thaw_stage[SAVE_MAX + 12];
static int thaw_flag;
static int thaw_result;
static int last_int_pc;
static uint32_t save_len;
static void w32(uint8_t *d, uint32_t *o, uint32_t v) { d[(*o)++] = (uint8_t)v; d[(*o)++] = (uint8_t)(v >> 8); d[(*o)++] = (uint8_t)(v >> 16); d[(*o)++] = (uint8_t)(v >> 24); }
static void w64(uint8_t *d, uint32_t *o, uint64_t v) { w32(d, o, (uint32_t)v); w32(d, o, (uint32_t)(v >> 32)); }
static uint32_t r32(const uint8_t *d, uint32_t *o) { uint32_t v = d[*o] | ((uint32_t)d[*o+1] << 8) | ((uint32_t)d[*o+2] << 16) | ((uint32_t)d[*o+3] << 24); *o += 4; return v; }
static uint64_t r64(const uint8_t *d, uint32_t *o) { uint64_t lo = r32(d, o), hi = r32(d, o); return lo | (hi << 32); }
static int wait_ok(uint32_t pc) { return pc == WAIT_PC0 || pc == WAIT_PC1; }
// NOTE: int_pc/nmi_pc record which wait-loop poll (E93A vs E93C) caught the
// NMI. The poll phase can shift by one poll across a thaw (C resumes mid
// wait-iteration); the label may swap E93A<->E93C with identical cycles and
// gameplay state (RTI discards the pushed PC; resumption is via restored
// state + C stack). Proof harnesses mask bytes 32-35 and 64-67.
static uint32_t save_write(uint8_t *d, uint32_t int_pc) {
  uint32_t o = 0;
  uint32_t i;
  w32(d, &o, SAVE_MAGIC); w32(d, &o, SAVE_VERSION); w32(d, &o, 0);
  w32(d, &o, (uint32_t)frame_no); w32(d, &o, game_pad);
  w32(d, &o, (uint32_t)pending_warp); w32(d, &o, (uint32_t)pending_warp_raw);
  w32(d, &o, (uint32_t)oracle_align_done); w32(d, &o, int_pc);
  w64(d, &o, wall_no); w64(d, &o, pad_wall); w64(d, &o, cycles);
  w32(d, &o, _cycpp); w32(d, &o, nmi_pc); w64(d, &o, nmi_next_edge);
  w32(d, &o, (uint32_t)nmi_armed); w32(d, &o, (uint32_t)in_nmi);
  w32(d, &o, A); w32(d, &o, X); w32(d, &o, Y); w32(d, &o, S); w32(d, &o, P);
  w32(d, &o, pad_bits); w32(d, &o, (uint32_t)pad_pos1); w32(d, &o, (uint32_t)pad_pos2); w32(d, &o, (uint32_t)strobe);
  w32(d, &o, (uint32_t)mmc_shift); w32(d, &o, (uint32_t)mmc_count); w32(d, &o, mmc_ctrl);
  w32(d, &o, scx); w32(d, &o, scy); w32(d, &o, (uint32_t)sc_latch);
  w32(d, &o, ppu_addr); w32(d, &o, (uint32_t)ppu_latch); w32(d, &o, ppu_buf);
  w32(d, &o, oam_addr); w32(d, &o, reg2000); w32(d, &o, reg2001);
  w32(d, &o, chr0); w32(d, &o, chr1); w32(d, &o, ppu_openbus);
  w32(d, &o, pad_latch1); w32(d, &o, pad_latch2);
  w32(d, &o, (uint32_t)ppu_scan); w32(d, &o, (uint32_t)ppu_dot); w32(d, &o, ppu_frame);
  w32(d, &o, vblank_on); w32(d, &o, cpu_nmi); w32(d, &o, cpu_nmi_prev);
  w32(d, &o, need_nmi); w32(d, &o, prevent_vbl);
  w64(d, &o, vbl_ack_wall); w64(d, &o, ppu_mclk); w64(d, &o, mcpu_clk); w64(d, &o, synced_cyc);
  w64(d, &o, w2000_cyc); w32(d, &o, w2000_old); w32(d, &o, (uint32_t)w2000_has); w32(d, &o, (uint32_t)w2000_done);
  w32(d, &o, frame_pad); w32(d, &o, polled_pad); w64(d, &o, last_poll_cyc);
  w64(d, &o, max_poll_gap); w64(d, &o, max_gap_wall); w64(d, &o, max_gap_cyc);
  w32(d, &o, (uint32_t)trim_L6CD); w32(d, &o, (uint32_t)trim_8C00);
  w32(d, &o, (uint32_t)(swbank - prg[0]) / 0x4000u);
  w32(d, &o, (uint32_t)apu_head); w32(d, &o, (uint32_t)apu_tail);
  w32(d, &o, (uint32_t)uw_abort); w32(d, &o, (uint32_t)uw_888C); w32(d, &o, (uint32_t)uw_9488); w32(d, &o, (uint32_t)uw_9434);
  w32(d, &o, (uint32_t)uw_LA100); w32(d, &o, (uint32_t)uw_seq); w32(d, &o, (uint32_t)uw_sidd); w32(d, &o, (uint32_t)uw_9007);
  w32(d, &o, (uint32_t)uw_sid[0]); w32(d, &o, (uint32_t)uw_sid[1]); w32(d, &o, (uint32_t)uw_sid[2]); w32(d, &o, (uint32_t)uw_sid[3]);
  for (i = 0; i < 2048u; i++) d[o++] = ram[i];
  for (i = 0; i < 2048u; i++) d[o++] = vram[i];
  for (i = 0; i < 32u; i++) d[o++] = pal[i];
  for (i = 0; i < 256u; i++) d[o++] = oam[i];
  for (i = 0; i < 256u; i++) { w32(d, &o, apu_ring[i].a); w32(d, &o, apu_ring[i].v); w32(d, &o, apu_ring[i].c); }
  d[8] = (uint8_t)o; d[9] = (uint8_t)(o >> 8); d[10] = (uint8_t)(o >> 16); d[11] = (uint8_t)(o >> 24);
  return o;
}
static void save_read(const uint8_t *d) {
  uint32_t o = 12;
  uint32_t i;
  uint64_t w;
  frame_no = (int)r32(d, &o); game_pad = (uint8_t)r32(d, &o);
  pending_warp = (int)r32(d, &o); pending_warp_raw = (int)r32(d, &o);
  oracle_align_done = (int)r32(d, &o); o += 4;
  wall_no = r64(d, &o); pad_wall = r64(d, &o); cycles = r64(d, &o);
  _cycpp = (uint16_t)r32(d, &o); nmi_pc = (uint16_t)r32(d, &o); nmi_next_edge = r64(d, &o);
  nmi_armed = (int)r32(d, &o); in_nmi = (int)r32(d, &o);
  A = (uint8_t)r32(d, &o); X = (uint8_t)r32(d, &o); Y = (uint8_t)r32(d, &o); S = (uint8_t)r32(d, &o); P = (uint8_t)r32(d, &o);
  pad_bits = (uint8_t)r32(d, &o); pad_pos1 = (int)r32(d, &o); pad_pos2 = (int)r32(d, &o); strobe = (int)r32(d, &o);
  mmc_shift = (int)r32(d, &o); mmc_count = (int)r32(d, &o); mmc_ctrl = (uint8_t)r32(d, &o);
  scx = (uint8_t)r32(d, &o); scy = (uint8_t)r32(d, &o); sc_latch = (int)r32(d, &o);
  ppu_addr = (uint16_t)r32(d, &o); ppu_latch = (int)r32(d, &o); ppu_buf = (uint8_t)r32(d, &o);
  oam_addr = (uint8_t)r32(d, &o); reg2000 = (uint8_t)r32(d, &o); reg2001 = (uint8_t)r32(d, &o);
  chr0 = (uint8_t)r32(d, &o); chr1 = (uint8_t)r32(d, &o); ppu_openbus = (uint8_t)r32(d, &o);
  pad_latch1 = (uint8_t)r32(d, &o); pad_latch2 = (uint8_t)r32(d, &o);
  ppu_scan = (int)r32(d, &o); ppu_dot = (int)r32(d, &o); ppu_frame = r32(d, &o);
  vblank_on = (uint8_t)r32(d, &o); cpu_nmi = (uint8_t)r32(d, &o); cpu_nmi_prev = (uint8_t)r32(d, &o);
  need_nmi = (uint8_t)r32(d, &o); prevent_vbl = (uint8_t)r32(d, &o);
  vbl_ack_wall = r64(d, &o); ppu_mclk = r64(d, &o); mcpu_clk = r64(d, &o); synced_cyc = r64(d, &o);
  w2000_cyc = r64(d, &o); w2000_old = (uint8_t)r32(d, &o); w2000_has = (int)r32(d, &o); w2000_done = (int)r32(d, &o);
  frame_pad = (uint8_t)r32(d, &o); polled_pad = (uint8_t)r32(d, &o); last_poll_cyc = r64(d, &o);
  max_poll_gap = r64(d, &o); max_gap_wall = r64(d, &o); max_gap_cyc = r64(d, &o);
  trim_L6CD = (int)r32(d, &o); trim_8C00 = (int)r32(d, &o);
  w = r32(d, &o); swbank = prg[w & 7u];
  apu_head = (int)r32(d, &o); apu_tail = (int)r32(d, &o);
  uw_abort = (int)r32(d, &o); uw_888C = (int)r32(d, &o); uw_9488 = (int)r32(d, &o); uw_9434 = (int)r32(d, &o);
  uw_LA100 = (int)r32(d, &o); uw_seq = (int)r32(d, &o); uw_sidd = (int)r32(d, &o); uw_9007 = (int)r32(d, &o);
  uw_sid[0] = (int)r32(d, &o); uw_sid[1] = (int)r32(d, &o); uw_sid[2] = (int)r32(d, &o); uw_sid[3] = (int)r32(d, &o);
  for (i = 0; i < 2048u; i++) ram[i] = d[o++];
  for (i = 0; i < 2048u; i++) vram[i] = d[o++];
  for (i = 0; i < 32u; i++) pal[i] = d[o++];
  for (i = 0; i < 256u; i++) oam[i] = d[o++];
  for (i = 0; i < 256u; i++) { apu_ring[i].a = (uint16_t)r32(d, &o); apu_ring[i].v = (uint8_t)r32(d, &o); apu_ring[i].c = r32(d, &o); }
  for (i = 0; i < 2048u; i++) presnap2_ram[i] = ram[i];
  presnap2_cyc = cycles;
  presnap2_S = S; presnap2_P = P; presnap2_A = A; presnap2_X = X; presnap2_Y = Y; presnap2_pc = nmi_pc;
  presnap2_wall = wall_no;
}
static void save_stage_freeze(void) {
  save_len = save_write(save_stage, (uint32_t)last_int_pc);
}
void thaw_maybe(void) {
  uint32_t f0;
  last_int_pc = (int)nmi_pc;
  f0 = thaw_stage[0] | ((uint32_t)thaw_stage[1] << 8) | ((uint32_t)thaw_stage[2] << 16) | ((uint32_t)thaw_stage[3] << 24);
  if (f0) {
    const uint8_t *d = thaw_stage + 12;
    uint32_t o = 0, len;
    thaw_stage[0] = thaw_stage[1] = thaw_stage[2] = thaw_stage[3] = 0;
    thaw_flag = 0;
    thaw_result = -1;
    len = thaw_stage[8] | ((uint32_t)thaw_stage[9] << 8) | ((uint32_t)thaw_stage[10] << 16) | ((uint32_t)thaw_stage[11] << 24);
    if (len < 64 || len > SAVE_MAX) { thaw_result = -1; goto tw_done; }
    if (r32(d, &o) != SAVE_MAGIC) { thaw_result = -2; goto tw_done; }
    if (r32(d, &o) != SAVE_VERSION) { thaw_result = -3; goto tw_done; }
    if (r32(d, &o) != len) { thaw_result = -4; goto tw_done; }
    o += 4 * 5;
    { uint32_t frozen_pc = r32(d, &o);
      if (!wait_ok(frozen_pc)) { thaw_result = -5; goto tw_done; }
      if (!wait_ok((uint32_t)nmi_pc)) { thaw_result = -6; goto tw_done; } }
    save_read(d);
    thaw_result = 1;
  tw_done:
    thaw_stage[4] = (uint8_t)thaw_result; thaw_stage[5] = (uint8_t)((uint32_t)thaw_result >> 8); thaw_stage[6] = (uint8_t)((uint32_t)thaw_result >> 16); thaw_stage[7] = (uint8_t)((uint32_t)thaw_result >> 24);
  } else {
    save_stage_freeze();
  }
}
int bm_savestate_ptr(void) { return (int)(intptr_t)save_stage; }
int bm_savestate_len(void) { return (int)save_len; }
int bm_thaw_staging_ptr(void) { return (int)(intptr_t)thaw_stage; }
int bm_last_int_pc(void) { return last_int_pc; }
int bm_thaw_result(void) { return thaw_result; }
// ---- E1 in-engine SRAM (exact-state slots, no passwords) ----
// Battery-backed-style NVRAM for the core: 8 slots x SAVE_MAX bytes.
// Slots + flags are engine CONFIG (excluded from freeze/thaw blobs,
// sticky across bm_boot -- SRAM survives reset by definition). Shell
// persists blobs (export/import); engine owns capture/rewind/metadata.
// Blob layout recap: header 0..379, ram @380, vram @2428, pal/oam after.
#define SRAM_SLOTS 8
static uint8_t sram_blob[SRAM_SLOTS][SAVE_MAX];
static uint32_t sram_len[SRAM_SLOTS];
static int sram_occ[SRAM_SLOTS];
static int sram_area[SRAM_SLOTS], sram_x[SRAM_SLOTS], sram_y[SRAM_SLOTS];
static int sram_frame[SRAM_SLOTS];
static uint32_t sram_crc[SRAM_SLOTS];
static int sram_last = -1;
void bm_saving_set(int v) { saving_on = v ? 1 : 0; }
int bm_saving_get(void) { return saving_on; }
static int sram_valid_blob(const uint8_t *d, uint32_t len) {
  uint32_t o = 0;
  if (len < 64 || len > SAVE_MAX) return -1;
  if (r32(d, &o) != SAVE_MAGIC) return -2;
  if (r32(d, &o) != SAVE_VERSION) return -3;
  if (r32(d, &o) != len) return -4;
  return 0;
}
int bm_sram_save(int slot, uint32_t crc) {
  uint32_t i, o = 12;
  if (slot < 0 || slot >= SRAM_SLOTS) return -1;
  if (sram_valid_blob(save_stage, save_len) != 0) return -2;
  for (i = 0; i < save_len; i++) sram_blob[slot][i] = save_stage[i];
  sram_len[slot] = save_len;
  sram_frame[slot] = (int)r32(save_stage, &o);
  sram_area[slot] = (int)(save_stage[380 + 0x14] & 15);
  sram_x[slot] = (int)save_stage[380 + 0x49];
  sram_y[slot] = (int)save_stage[380 + 0x4B];
  sram_crc[slot] = crc; sram_occ[slot] = 1; sram_last = slot;
  return 0;
}
int bm_sram_store(int slot, uint32_t crc) {
  const uint8_t *d = thaw_stage + 12;
  uint32_t len = thaw_stage[8] | ((uint32_t)thaw_stage[9] << 8) | ((uint32_t)thaw_stage[10] << 16) | ((uint32_t)thaw_stage[11] << 24);
  uint32_t i, o = 12;
  if (slot < 0 || slot >= SRAM_SLOTS) return -1;
  if (sram_valid_blob(d, len) != 0) return -2;
  for (i = 0; i < len; i++) sram_blob[slot][i] = d[i];
  sram_len[slot] = len;
  sram_frame[slot] = (int)r32(d, &o);
  sram_area[slot] = (int)(d[380 + 0x14] & 15);
  sram_x[slot] = (int)d[380 + 0x49];
  sram_y[slot] = (int)d[380 + 0x4B];
  sram_crc[slot] = crc; sram_occ[slot] = 1; sram_last = slot;
  return 0;
}
int bm_sram_load(int slot, uint32_t crc) {
  uint32_t i;
  if (slot < 0 || slot >= SRAM_SLOTS) return -1;
  if (!sram_occ[slot]) return -2;
  if (sram_crc[slot] != crc) return -3;
  for (i = 0; i < sram_len[slot]; i++) thaw_stage[12 + i] = sram_blob[slot][i];
  thaw_stage[8] = (uint8_t)(sram_len[slot] & 255); thaw_stage[9] = (uint8_t)((sram_len[slot] >> 8) & 255);
  thaw_stage[10] = (uint8_t)((sram_len[slot] >> 16) & 255); thaw_stage[11] = (uint8_t)((sram_len[slot] >> 24) & 255);
  thaw_stage[0] = 1; thaw_stage[1] = thaw_stage[2] = thaw_stage[3] = 0;
  return 1;
}
int bm_sram_info(int slot, int field) {
  if (slot < 0 || slot >= SRAM_SLOTS) return -1;
  if (!sram_occ[slot] && field != 0) return -2;
  if (field == 0) return sram_occ[slot];
  if (field == 1) return sram_area[slot];
  if (field == 2) return sram_x[slot];
  if (field == 3) return sram_y[slot];
  if (field == 4) return sram_frame[slot];
  if (field == 5) return (int)sram_crc[slot];
  return -1;
}
int bm_sram_last(void) { return sram_last; }
int bm_sram_blob_ptr(int slot) {
  if (slot < 0 || slot >= SRAM_SLOTS || !sram_occ[slot]) return 0;
  return (int)(intptr_t)sram_blob[slot];
}
int bm_sram_blob_len(int slot) {
  if (slot < 0 || slot >= SRAM_SLOTS || !sram_occ[slot]) return 0;
  return (int)sram_len[slot];
}
void bm_boot(void) {
  memset(ram, 0x00, sizeof ram); // Mesen parity: power-on RAM reads 0 (probe-proven over 120568f; 0xFF diverges at f=144)
  memset(vram, 0, sizeof vram);
  memset(pal, 0, sizeof pal);
  memset(oam, 0, sizeof oam);
  A = 0; X = 0; Y = 0; S = 0xFD; P = 0x24;
  pad_bits = 0; pad_pos1 = 0; pad_pos2 = 0; strobe = 0; pad_latch1 = 0; pad_latch2 = 0;
  cycles = 9; scx = 0; scy = 0; sc_latch = 0; ppu_addr = 0; ppu_latch = 0;
  ppu_buf = 0; oam_addr = 0; reg2000 = 0; reg2001 = 0; ppu_openbus = 0; chr0 = 0; chr1 = 0;
  mmc_shift = 0; mmc_count = 0; mmc_ctrl = 0x0C; swbank = prg[0];
  nmi_next_edge = 27517; nmi_armed = 1; in_nmi = 0;
  frame_no = 0; game_pad = 0;
  bm_trap_seen = 0; bm_trap_val = 0; bm_trap_name[0] = 0; apu_head = 0; apu_tail = 0;
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
