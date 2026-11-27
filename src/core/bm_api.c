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
// ---- S6 per-site song override (engine+recomp hook; hook 7 in tools/patch_hook7.py) ----
// The static recomp bakes LDA-immediate song ids into wasm, so staged prg
// patches cannot change code request sites. Hook 7 rewrites each lifted site
// LDA into A = song_site_ovr(bank, cpu, stock): a pack-driven sparse table
// with stock fallback, so stock behavior is bit-identical with no overrides.
// Sticky config (like saving_on/enhanced_mode): re-applied at spawn from the
// pack sites map, excluded from freeze/thaw blobs.
#define SITEOVR_MAX 128
static uint8_t siteovr_bank[SITEOVR_MAX];
static uint16_t siteovr_cpu[SITEOVR_MAX];
static uint8_t siteovr_id[SITEOVR_MAX];
static int siteovr_n = 0;
static uint8_t song_site_ovr(int bank, int cpu, uint8_t stock) {
  int i;
  for (i = 0; i < siteovr_n; i++) {
    if (siteovr_bank[i] == bank && siteovr_cpu[i] == cpu) return siteovr_id[i];
  }
  return stock;
}
void bm_siteovr_reset(void) { siteovr_n = 0; }
void bm_siteovr_set(int bank, int cpu, int id) {
  int i;
  if (bank != 4 && bank != 6 && bank != 7) return;
  if (cpu < 0 || cpu > 0xFFFF) return;
  for (i = 0; i < siteovr_n; i++) {
    if (siteovr_bank[i] == bank && siteovr_cpu[i] == cpu) {
      if (id < 0 || id > 84) {
        siteovr_n = siteovr_n - 1;
        siteovr_bank[i] = siteovr_bank[siteovr_n];
        siteovr_cpu[i] = siteovr_cpu[siteovr_n];
        siteovr_id[i] = siteovr_id[siteovr_n];
      } else {
        siteovr_id[i] = (uint8_t)id;
      }
      return;
    }
  }
  if (id < 0 || id > 84 || siteovr_n >= SITEOVR_MAX) return;
  siteovr_bank[siteovr_n] = (uint8_t)bank;
  siteovr_cpu[siteovr_n] = (uint16_t)cpu;
  siteovr_id[siteovr_n] = (uint8_t)id;
  siteovr_n = siteovr_n + 1;
}
// ---- E2 main menu session state (early: pad_fn + forward decls) ----
// Menu lives in the engine (no shell dependence). Opens on the title-screen
// Start edge and the intro skip button while enhanced (stock path untouched
// when off). Session state resets on bm_boot; the E4-core settings below are
// sticky config (persisted + shell-synced in E4).
static int menu_phase = 0;    // 0=off 1=main 2=load 3=settings
static int menu_cursor = 0;
static int menu_cooldown = 0; // set on START/LOAD/CONTINUE dismiss; clears at init
static int menu_swallow = 0;  // pad filter: game sees 0 while menu is modal
static int menu_prevpad = 0;
static int setting_volume = 8; // 0-10 (shell divides by 10 in E4)
static int setting_mute = 0;   // 0-1
static int setting_scale = 0;  // 0 INTEGER 1 FIT 2 FILL 3 STRETCH
static int setting_filter = 0; // 0 NEAREST 1 BILINEAR
void menu_tick(void);
void menu_draw(void);
static void map_blit(void);
static void map_blit_full(void);

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
static uint8_t pad_fn(uint64_t f);
static uint8_t bg_opaque[256*240];
static int pmenu_phase, ev5_phase, ev5_snap_taken; /* tentative decls (defined below); render reads them for the modal font switch */
static void render(void) {
  int mode8k = !(mmc_ctrl & 0x10);
  int b0 = mode8k ? (chr0 & 0xFE) : chr0;
  int b1 = mode8k ? (chr0 & 0xFE) : chr1;
  int bb = (reg2000 & 0x10) ? b1 : b0;
  if (menu_phase || pmenu_phase || (ev5_phase && ev5_snap_taken)) bb = 7; /* modal NT is cleared+text-only: force the E0 font page */
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
  /* NES 8-sprites-per-scanline limit (HW-faithful, 2026-11-28): on each
     scanline only the first 8 sprites in OAM order with Y in range are
     drawn; later ones drop. The game never reads $2002 sprite bits, so
     only the draw cutoff is emulated (no flag effects). */
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
        {
          int t, cnt8 = 0;
          for (t = 0; t < s; t++) {
            int oy2 = oam[t * 4];
            if (oy2 >= 0xEF) continue;
            if (yy >= oy2 + 1 && yy < oy2 + 1 + hh && ++cnt8 >= 8) break;
          }
          if (cnt8 >= 8) continue;
        }
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
  menu_draw();
  render();
  map_blit();
  map_blit_full();
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
// ---- E8-M5 minimap HUD toggle (shell Enhancements menu) ----
// Engine config like enhanced_mode: excluded from blobs, sticky across
// bm_boot, default on. Gates only the HUD blit; the pause full-map stays
// available. Default-on keeps every existing video golden bit-identical.
static int map_show = 1;
void bm_map_show_set(int v) { map_show = v ? 1 : 0; }
int bm_map_show_get(void) { return map_show; }

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
  menu_tick();
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
// ---- E3 in-game pause menu (engine-side, no shell dependence) ----
// Opens on a Select edge while the game is Start-paused (enhanced only).
// RE (headless probes, proven in tools/verify-pause-e3.mjs):
// - Start toggles a Start-pause screen; Select toggles a Select-pause screen.
//   Resume is same-button-only (Start resumes Start-pause, Select resumes
//   Select-pause); cross buttons switch screens / transient-only, never resume.
// - $BE sampled main-slice (presnap) is 1 while gameplay logic runs, 0 while
//   idle (title/intro/pause). Live ram reads 0 at NMI time (the NMI prologue
//   clears it; the main slice sets it iff running), so the gate MUST use
//   presnap_ram[0xBE], never live ram.
// - $B7 bit2 ($04) latches on any Start press (cleared at gameplay init, never
//   on resume); door transit holds $B7==1. The gate requires ($B7&~4)==0.
// - Pause-entry cause is attributed headlessly, not by $B7: menu_tick tracks
//   the last Start/Select edges; a presnap-$BE 1->0 flip takes the nearest
//   edge within 100 ticks (tie/no-edge -> SELECT/unknown -> gate closed).
//   Immune to the stale $B7 latch (pause/resume/other-pause flows).
// - Pause settles ~40f (video freeze), resume ~10-20f. All six other buttons
//   are alive while paused, so Select hijacks a live button when enhanced
//   (E2-analog tradeoff); stock is untouched when enhanced is off.
// CONTINUE resumes via the STOCK path: a Start edge is injected (pad_fn ORs
// bit3 for 8 frames (exactly one stock tap: same polls, same duration) so the game's
// own toggle code runs the resume. LOAD stages an sram thaw. QUIT is the
// in-engine equivalent of pressing reset (engine_reset_to_title preserves
// enhanced/saving/settings/SRAM). Render state is snapshotted on open and
// restored on CONTINUE/toggle-close so closing untouched reconverges EXACTLY
// with never-pressed (LOAD/QUIT skip restore: thaw/reset replace it all).
static void menu_text(int row, int col, const char *s);
static void menu_num2(int row, int col, int v);
static void menu_boot_reset(void);
static int pmenu_phase = 0;    // 0=off 1=main 2=load 3=settings 4=map
static int pmenu_cursor = 0;
static int pmenu_map_lv = 1;   // E8-M4 full-map viewed level (1-16; set to current on open)
static int pmenu_cooldown = 0; // set on LOAD/QUIT dismiss; clears when unpaused
static int pmenu_swallow = 0;  // pad filter: game sees 0 while menu is modal
static int pmenu_prevpad = 0;
static int pmenu_inject = 0;   // pending injected-Start pad_fn FRAMES (resume mimicry: one stock tap)
static int pmenu_pending_load = -1; // LOAD slot awaiting resume-then-thaw (pause-dest thaw wedges, so resume first)
static int pmenu_swallow_cd = 0;  // post-dismiss echo swallow (covers the dismissing tap tail so the game never sees it)
static int pmenu_clock = 0;    // menu_tick counter for edge attribution
static int pmenu_last_start = -1000000;  // last live-pad Start edge tick
static int pmenu_last_select = -1000000; // last live-pad Select edge tick
static int pmenu_cause = 0;    // pause-entry cause: 0 none 1 start 2 select/unknown
static int pmenu_prev_be = 0;  // presnap $BE last tick
static uint8_t pmenu_vram[1024], pmenu_pal[32], pmenu_oam[256];
static int pmenu_scx, pmenu_scy, pmenu_r2000, pmenu_r2001, pmenu_chr0, pmenu_chr1, pmenu_mmc;
static int pmenu_gameplay(void) { return !(ram[0xDD] == 0 && ram[0x37E] == 0); }
static void pmenu_snap_render(void) {
  int i;
  for (i = 0; i < 1024; i++) pmenu_vram[i] = vram[i];
  for (i = 0; i < 32; i++) pmenu_pal[i] = pal[i];
  for (i = 0; i < 256; i++) pmenu_oam[i] = oam[i];
  pmenu_scx = scx; pmenu_scy = scy; pmenu_r2000 = reg2000; pmenu_r2001 = reg2001;
  pmenu_chr0 = chr0; pmenu_chr1 = chr1; pmenu_mmc = mmc_ctrl;
}
static void pmenu_restore_render(void) {
  int i;
  for (i = 0; i < 1024; i++) vram[i] = pmenu_vram[i];
  for (i = 0; i < 32; i++) pal[i] = pmenu_pal[i];
  for (i = 0; i < 256; i++) oam[i] = pmenu_oam[i];
  scx = (uint8_t)pmenu_scx; scy = (uint8_t)pmenu_scy;
  reg2000 = (uint8_t)pmenu_r2000; reg2001 = (uint8_t)pmenu_r2001;
  chr0 = (uint8_t)pmenu_chr0; chr1 = (uint8_t)pmenu_chr1; mmc_ctrl = (uint8_t)pmenu_mmc;
}
// ---- E5 entrance-save prompt (engine-side, supersedes P4 shell detector) ----
// Up at a doorway files an exact-state save. Door table is fixed-bank PRG
// bank 7 [$DD7E areas/$DDEA xhi/$DE56 yhi, 108 rows, EOR-1 pairs]; the b7
// scan teleports on EXACT ($14,$49,$4B) match.
// Detector (menu_tick, engine-side presnap like the P4 shell used): the
// 6-frame stability run on the table predicate filters post-frame $49/$4B
// flicker, and presnap $B7 bit0 (set at landing, clear during warp-init)
// tells door stands apart from area-load transients. $B7 stays 1 forever
// after the first transit, and there is no BE gate: running flicker
// stands, transition stands and stock-paused stands all qualify uniformly.
// A fresh Up edge OR held-Up (walk-in parity) with a new side key opens
// the prompt once per side. Pause-while-prompt rides a LEVEL Start inject
// (refreshed while prompt-open and BE==1, capped 240f): transition opens
// engage pause on the BE 0->1 edge, running opens pause at once.
// SAVE captures via bm_sram_save into the shared E1 slots (crc 0 = no
// pack claim; the shell pack-gates its IDB layer as P4 did; E2 LOAD
// browses/loads these slots via self-crc).
// Choices are race-free in pad_fn (E3-F lesson: game-visible edges must
// ride the live pad): A/Start = save + stock resume, B/Select = leave +
// resume, Down = leave + resume + injected Down (fires on BE==1 or
// transit-B7, mirrors the resume-then-thaw pattern), Left/Right = slot
// cursor. Modal swallows all other input. Interlocks: E3 gate requires
// ev5_phase==0 and vice versa.
#define EV5_NEED 6
// ---- E8-M2 exploration tracking (visited screens per game level) ----
// Monotonic live cache; shell IDB is the per-pack truth (union-merged).
// Screens are 8x8 per level max (screensX=8 always); bit (sy*8+sx).
static uint8_t visit_bits[16][8];
static const uint8_t visit_rows[16] = { 32, 32, 32, 32, 32, 32, 32, 32, 25, 32, 32, 32, 29, 32, 32, 32 };
static void visit_mark(void) {
  int area = ram[0x14] & 15;
  int lv = area < 8 ? area + 9 : area - 7;
  int sx = (scx + 128) >> 8; if (sx < 0) sx = 0; if (sx > 7) sx = 7;
  int sy = (scy + 120) >> 8; if (sy < 0) sy = 0;
  int maxsy = (visit_rows[lv - 1] + 3) >> 2;
  if (sy >= maxsy) sy = maxsy - 1;
  visit_bits[lv - 1][((sy * 8 + sx) >> 3)] |= (uint8_t)(1 << ((sy * 8 + sx) & 7));
}
int bm_visit_ptr(void) { return (int)(intptr_t)visit_bits; }
int bm_visit_get(int lv, int sx, int sy) {
  if (lv < 1 || lv > 16 || sx < 0 || sx > 7 || sy < 0 || sy > 7) return -1;
  return (visit_bits[lv - 1][((sy * 8 + sx) >> 3)] >> ((sy * 8 + sx) & 7)) & 1;
}
void bm_visit_set(int lv, int sx, int sy, int v) {
  uint8_t m;
  if (lv < 1 || lv > 16 || sx < 0 || sx > 7 || sy < 0 || sy > 7) return;
  m = (uint8_t)(1 << ((sy * 8 + sx) & 7));
  if (v) visit_bits[lv - 1][((sy * 8 + sx) >> 3)] |= m;
  else visit_bits[lv - 1][((sy * 8 + sx) >> 3)] &= (uint8_t)~m;
}
int bm_visit_cur(void) {
  int area, lv, sx, sy, maxsy;
  if (ram[0xDD] == 0 && ram[0x37E] == 0) return -1;
  area = ram[0x14] & 15;
  lv = area < 8 ? area + 9 : area - 7;
  sx = (scx + 128) >> 8; if (sx < 0) sx = 0; if (sx > 7) sx = 7;
  sy = (scy + 120) >> 8; if (sy < 0) sy = 0;
  maxsy = (visit_rows[lv - 1] + 3) >> 2;
  if (sy >= maxsy) sy = maxsy - 1;
  return (lv - 1) * 64 + sy * 8 + sx;
}
void bm_visit_reset(void) { memset(visit_bits, 0, sizeof visit_bits); }
static int ev5_phase = 0;
static int ev5_run = 0;
static int ev5_lastkey = -1;
static int ev5_cursor = 0;
static int ev5_cool = 0;
static int ev5_curside = -1;
static int ev5_pending_save = -1;
static int ev5_pending_down = 0;
static int ev5_wait = 0;
static int ev5_snap_taken = 0;
static int ev5_saw_one = 0;
static int ev5_be0run = 0;
static int ev5_down_inj = 0;
static uint8_t ev5_vram[1024], ev5_pal[32], ev5_oam[256];
static int ev5_scx, ev5_scy, ev5_r2000, ev5_r2001, ev5_chr0, ev5_chr1, ev5_mmc;
// ---- E8-M3 engine-side HUD minimap: abstract room grid (Metroid-style) ----
// Blits into framebuf AFTER render() in nmi_frame (never vram/ram/pal).
// Fixed 48x32 box top-right: one 6x4 cell per screen (8 cols x up to 8
// rows), 5x3 room fill for visited screens, dark unvisited (unexplored
// screens stay hidden, never dimmed thumbnails), gold door notches on
// cell borders for exits of visited rooms, 2x2 player dot blinking
// white/red at ~4Hz (frame_no bit 4: deterministic, in every video hash;
// frozen solid-red while stock-paused (BE==0) so pause-freeze proofs hold).
// Doors come from the level door tables via map_build (shared with the
// E8-M4 pause full-map, which keeps its thumbnail style). Gate: enhanced
// && gameplay && no modal (E2/E3/E5); map_show toggle (E8-M5).
#define MAP_X0 196
#define MAP_Y0 10
#define MAP_CW 6
#define MAP_CH 4
#define MAP_FW 5
#define MAP_FH 3
#define MAP_BG_R 5
#define MAP_BG_G 5
#define MAP_BG_B 18
#define MAP_RM_R 64
#define MAP_RM_G 128
#define MAP_RM_B 232
static uint8_t map_px[16][4096];
static uint8_t map_rows[16];
static uint8_t map_valid[16];
static uint8_t map_door_n[16];
static uint8_t map_door_bx[16][28];
static uint8_t map_door_by[16][28];
static uint8_t map_brk[16][128];      // E8-M4 breakable-block bits (tank lv<=8, attr bit7+bit6)
static uint8_t map_door_ent[16][28];  // E8-M4 cross-area entrance flags per door slot
static const uint8_t map_chrbank[17] = { 0, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 18, 20, 18, 19, 20, 17 };
static const uint8_t map_banklv[3][6] = { { 1, 2, 3, 4, 5 }, { 6, 7, 8, 9, 11 }, { 13, 10, 14, 16, 12, 15 } };
static const uint8_t map_bankn[3] = { 5, 5, 6 };
static const int map_free[3] = { 0x3D8C, 0x382B, 0x3A63 };
static int map_bank_of(int lv) {
  if (lv >= 1 && lv <= 5) return 0;
  if (lv == 6 || lv == 7 || lv == 8 || lv == 9 || lv == 11) return 1;
  return 2;
}
static int map_span_end(int *starts, int nst, int b, int off) {
  int i, end = -1;
  for (i = 0; i < nst; i++) if (starts[i] > off && (end < 0 || starts[i] < end)) end = starts[i];
  if (end < 0) end = off < map_free[b] ? map_free[b] : 16384;
  return end;
}
static int map_build(int lv) {
  int b, s, ns, s0 = -1, i, n;
  uint8_t *B;
  int tableRel[6], scrollRel[6], P[6][6];
  int starts[48], nst = 0;
  int palP, attrP, comboP, structP, blockP, mapP;
  int attrLen, structLen, blockLen, mapLen, rows;
  int cb;
  uint8_t P16[16];
  if (lv < 1 || lv > 16) return 0;
  if (map_valid[lv - 1]) return 1;
  b = map_bank_of(lv);
  B = prg[b];
  ns = map_bankn[b];
  for (s = 0; s < ns; s++) {
    int lvl = map_banklv[b][s];
    int ho = s * 4;
    int tr = (B[ho] | (B[ho + 1] << 8)) - 0x8000;
    int sr = (B[ho + 2] | (B[ho + 3] << 8)) - 0x8000;
    if (lvl == lv) s0 = s;
    if (tr < ns * 4 || tr + 12 > 16384) return 0;
    if (sr < 0 || sr + 16 > 16384) return 0;
    tableRel[s] = tr; scrollRel[s] = sr;
    for (i = 0; i < 6; i++) {
      int rel = (B[tr + i * 2] | (B[tr + i * 2 + 1] << 8)) - 0x8000;
      if (rel < ns * 4 || rel > 16384) return 0;
      P[s][i] = rel;
    }
  }
  if (s0 < 0) return 0;
  for (s = 0; s < ns; s++) {
    starts[nst++] = tableRel[s]; starts[nst++] = P[s][0]; starts[nst++] = P[s][5]; starts[nst++] = scrollRel[s];
    starts[nst++] = P[s][2]; starts[nst++] = P[s][3]; starts[nst++] = P[s][4]; starts[nst++] = P[s][1];
  }
  palP = P[s0][0]; attrP = P[s0][1]; comboP = P[s0][2]; structP = P[s0][3]; blockP = P[s0][4]; mapP = P[s0][5];
  attrLen = map_span_end(starts, nst, b, attrP) - attrP;
  structLen = map_span_end(starts, nst, b, structP) - structP;
  blockLen = map_span_end(starts, nst, b, blockP) - blockP;
  mapLen = lv == 9 ? 800 : (lv == 13 ? 928 : 1024);
  if (attrLen <= 0 || attrLen * 4 > map_span_end(starts, nst, b, comboP) - comboP) return 0;
  if (structLen <= 0 || (structLen & 3)) return 0;
  if (blockLen <= 0 || (blockLen & 3)) return 0;
  if (mapP + mapLen > map_span_end(starts, nst, b, mapP)) return 0;
  rows = mapLen / 32;
  map_rows[lv - 1] = (uint8_t)rows;
  for (i = 0; i < 128; i++) map_brk[lv - 1][i] = 0;
  for (i = 0; i < 16; i++) P16[i] = B[palP + i];
  cb = map_chrbank[lv];
  for (i = 0; i < rows * 32; i++) {
    int bx = i % 32;
    int brk = 0;
    int q, bi = i;
    int blk = B[mapP + bi];
    if (blk < 0 || blk * 4 + 3 >= blockLen) blk = 0;
    for (q = 0; q < 4; q++) {
      int si = B[blockP + blk * 4 + q];
      int sr = 0, sg = 0, sb2 = 0, k2, p2, c, best = 0, bestd = 1 << 30;
      int ar, ag, ab;
      for (k2 = 0; k2 < 4; k2++) {
        int ci = B[structP + si * 4 + k2];
        if (lv <= 8 && ((B[attrP + ci] & 0xC0) == 0xC0)) brk = 1;
        int sub = B[attrP + ci] & 3;
        for (p2 = 0; p2 < 4; p2++) {
          int ti = B[comboP + ci * 4 + p2];
          int off = cb * 0x1000 + ti * 16;
          int lo = chr[off], hi = chr[off + 8];
          int v = ((lo >> 7) & 1) | (((hi >> 7) & 1) << 1);
          int pi = (v == 0 ? P16[0] : P16[sub * 4 + v]) & 63;
          sr += NESPAL[pi][0]; sg += NESPAL[pi][1]; sb2 += NESPAL[pi][2];
        }
      }
      ar = sr / 16; ag = sg / 16; ab = sb2 / 16;
      for (c = 0; c < 64; c++) {
        int dr = ar - NESPAL[c][0], dg = ag - NESPAL[c][1], db = ab - NESPAL[c][2];
        int d = dr * dr + dg * dg + db * db;
        if (d < bestd) { bestd = d; best = c; }
      }
      map_px[lv - 1][(((i / 32) * 2 + (q >> 1)) * 64) + (bx * 2 + (q & 1))] = (uint8_t)best;
    }
    if (brk) map_brk[lv - 1][i >> 3] |= (uint8_t)(1 << (i & 7));
  }
  n = 0;
  for (i = 0; i < 108; i++) {
    int a = prg[7][0x1D7E + i];
    int alv, dx, dy;
    if (a >= 16) continue;
    a &= 15;
    alv = a < 8 ? a + 9 : a - 7;
    if (alv != lv) continue;
    dx = prg[7][0x1D7E + 108 + i] >> 2;
    dy = prg[7][0x1D7E + 216 + i] >> 2;
    if (dx < 0 || dx >= 32 || dy < 0 || dy >= rows || n >= 28) continue;
    map_door_bx[lv - 1][n] = (uint8_t)dx;
    map_door_by[lv - 1][n] = (uint8_t)dy;
    { int jj = i ^ 1; int aj = prg[7][0x1D7E + jj] & 15; int alvj = aj < 8 ? aj + 9 : aj - 7;
      map_door_ent[lv - 1][n] = (uint8_t)(((alv <= 8) != (alvj <= 8)) ? 1 : 0); }
    n++;
  }
  map_door_n[lv - 1] = (uint8_t)n;
  map_valid[lv - 1] = 1;
  return 1;
}
static int map_gate(void) {
  if (!enhanced_mode) return 0;
  if (ram[0xDD] == 0 && ram[0x37E] == 0) return 0;
  if (menu_phase || pmenu_phase || ev5_phase) return 0;
  return 1;
}
static void map_put(int x, int y, uint8_t r, uint8_t g, uint8_t b) {
  uint8_t *px;
  if (x < 0 || x > 255 || y < 0 || y > 239) return;
  px = &framebuf[(y * 256 + x) * 4];
  px[0] = r; px[1] = g; px[2] = b; px[3] = 255;
}
static void map_blit(void) {
  int area, lv, sx, sy, maxsy, rows, x, y, i;
  int blink;
  if (!map_gate()) return;
  if (!map_show) return;
  area = ram[0x14] & 15;
  lv = area < 8 ? area + 9 : area - 7;
  if (lv < 1 || lv > 16) return;
  if (!map_valid[lv - 1] && !map_build(lv)) return;
  rows = map_rows[lv - 1];
  sx = (scx + 128) >> 8; if (sx < 0) sx = 0; if (sx > 7) sx = 7;
  sy = (scy + 120) >> 8; if (sy < 0) sy = 0;
  maxsy = (rows + 3) >> 2; if (sy >= maxsy) sy = maxsy - 1;
  for (x = MAP_X0 - 1; x <= MAP_X0 + 48; x++) {
    map_put(x, MAP_Y0 - 1, 117, 117, 117);
    map_put(x, MAP_Y0 + 32, 117, 117, 117);
  }
  for (y = MAP_Y0 - 1; y <= MAP_Y0 + 32; y++) {
    map_put(MAP_X0 - 1, y, 117, 117, 117);
    map_put(MAP_X0 + 48, y, 117, 117, 117);
  }
  for (y = 0; y < 32; y++) for (x = 0; x < 48; x++)
    map_put(MAP_X0 + x, MAP_Y0 + y, MAP_BG_R, MAP_BG_G, MAP_BG_B);
  for (y = 0; y < maxsy; y++) for (x = 0; x < 8; x++) {
    int bit, cx0, cy0, dx, dy;
    bit = (visit_bits[lv - 1][((y * 8 + x) >> 3)] >> ((y * 8 + x) & 7)) & 1;
    if (!bit) continue;
    cx0 = MAP_X0 + x * MAP_CW; cy0 = MAP_Y0 + y * MAP_CH;
    for (dy = 0; dy < MAP_FH; dy++) for (dx = 0; dx < MAP_FW; dx++)
      map_put(cx0 + dx, cy0 + dy, MAP_RM_R, MAP_RM_G, MAP_RM_B);
  }
  for (i = 0; i < map_door_n[lv - 1]; i++) {
    int bx = map_door_bx[lv - 1][i], by = map_door_by[lv - 1][i];
    int osx = bx >> 2, osy = by >> 2, ox = bx & 3, oy = by & 3;
    int edge = 0, m, dn, ds, dw, de, k, nx, ny;
    if (osx < 0 || osx > 7 || osy < 0 || osy >= maxsy) continue;
    if (!(((visit_bits[lv - 1][((osy * 8 + osx) >> 3)] >> ((osy * 8 + osx) & 7)) & 1))) continue;
    dn = oy; ds = 3 - oy; dw = ox; de = 3 - ox; m = dn;
    if (ds < m) { m = ds; edge = 1; }
    if (dw < m) { m = dw; edge = 2; }
    if (de < m) { m = de; edge = 3; }
    nx = MAP_X0 + osx * MAP_CW; ny = MAP_Y0 + osy * MAP_CH;
    if (edge == 0) { for (k = 1; k <= 3; k++) map_put(nx + k, ny - 1, 248, 184, 0); }
    else if (edge == 1) { for (k = 1; k <= 3; k++) map_put(nx + k, ny + 3, 248, 184, 0); }
    else if (edge == 2) { for (k = 0; k <= 2; k++) map_put(nx - 1, ny + k, 248, 184, 0); }
    else { for (k = 0; k <= 2; k++) map_put(nx + 5, ny + k, 248, 184, 0); }
  }
  blink = (ram[0xBE] == 0) ? 0 : ((frame_no >> 4) & 1);
  {
    int cx0 = MAP_X0 + sx * MAP_CW + 2, cy0 = MAP_Y0 + sy * MAP_CH + 1;
    uint8_t dr = blink ? 252 : 248, dg = blink ? 252 : 56, db = blink ? 252 : 56;
    map_put(cx0, cy0, dr, dg, db); map_put(cx0 + 1, cy0, dr, dg, db);
    map_put(cx0, cy0 + 1, dr, dg, db); map_put(cx0 + 1, cy0 + 1, dr, dg, db);
  }
}

// ---- E8-M4 pause full-map: abstract room grid (matches the E8-M3 HUD minimap) ----
// Fixed centered 8-col grid, 12x8 cells (2x minimap), visited fills (64,128,232),
// dark unvisited (5,5,18) never pre-revealed, gold intra-level door notches /
// white cross-area entrance notches on visited-room borders (nearest-edge rule,
// same as the HUD), cyan breakable-cell borders (tank lv<=8 combo attr bit7+bit6),
// 4x4 player dot (frozen red while stock-paused, BE==0, so pause-freeze proofs hold).
// Level cycling skips unentered levels (zero visit bits); current level always
// selectable. Grid is vertically centered above the vram legend (rows 18+, y>=144)
// and horizontally centered (X0=80): fully inside the visible frame.
#define FM_X0 80
#define FM_CW 12
#define FM_CH 8
static int map_level_seen(int lv) {
  int i;
  if (lv < 1 || lv > 16) return 0;
  for (i = 0; i < 8; i++) if (visit_bits[lv - 1][i]) return 1;
  return 0;
}
static void pmenu_map_step(int d) {
  int area = ram[0x14] & 15;
  int clv = area < 8 ? area + 9 : area - 7;
  int lv = pmenu_map_lv, guard;
  for (guard = 0; guard < 16; guard++) {
    lv += d;
    if (lv < 1) lv = 16;
    if (lv > 16) lv = 1;
    if (lv == clv || map_level_seen(lv)) { pmenu_map_lv = lv; return; }
  }
}
static void map_blit_full(void) {
  int Y0, maxsy, lv, rows, x, y, i;
  int area, clv, sx, sy;
  if (!enhanced_mode) return;
  if (pmenu_phase != 4) return;
  if (!pmenu_gameplay()) return;
  lv = pmenu_map_lv;
  if (lv < 1 || lv > 16) return;
  if (!map_valid[lv - 1] && !map_build(lv)) return;
  rows = map_rows[lv - 1];
  maxsy = (rows + 3) >> 2;
  Y0 = (140 - maxsy * FM_CH) / 2;
  for (x = FM_X0 - 1; x <= FM_X0 + 96; x++) {
    map_put(x, Y0 - 1, 117, 117, 117);
    map_put(x, Y0 + maxsy * FM_CH, 117, 117, 117);
  }
  for (y = Y0 - 1; y <= Y0 + maxsy * FM_CH; y++) {
    map_put(FM_X0 - 1, y, 117, 117, 117);
    map_put(FM_X0 + 96, y, 117, 117, 117);
  }
  for (y = 0; y < maxsy * FM_CH; y++) for (x = 0; x < 96; x++)
    map_put(FM_X0 + x, Y0 + y, MAP_BG_R, MAP_BG_G, MAP_BG_B);
  for (y = 0; y < maxsy; y++) for (x = 0; x < 8; x++) {
    int bit, cx0, cy0, dx, dy;
    bit = (visit_bits[lv - 1][((y * 8 + x) >> 3)] >> ((y * 8 + x) & 7)) & 1;
    if (!bit) continue;
    cx0 = FM_X0 + x * FM_CW; cy0 = Y0 + y * FM_CH;
    for (dy = 0; dy < 6; dy++) for (dx = 0; dx < 10; dx++)
      map_put(cx0 + 1 + dx, cy0 + 1 + dy, MAP_RM_R, MAP_RM_G, MAP_RM_B);
  }
  for (i = 0; i < map_door_n[lv - 1]; i++) {
    int bx = map_door_bx[lv - 1][i], by = map_door_by[lv - 1][i];
    int osx = bx >> 2, osy = by >> 2, ox = bx & 3, oy = by & 3;
    int edge = 0, m, dn, ds, dw, de, k, nx, ny;
    uint8_t cr, cg, cb;
    if (osx < 0 || osx > 7 || osy < 0 || osy >= maxsy) continue;
    if (!(((visit_bits[lv - 1][((osy * 8 + osx) >> 3)] >> ((osy * 8 + osx) & 7)) & 1))) continue;
    dn = oy; ds = 3 - oy; dw = ox; de = 3 - ox; m = dn;
    if (ds < m) { m = ds; edge = 1; }
    if (dw < m) { m = dw; edge = 2; }
    if (de < m) { m = de; edge = 3; }
    if (map_door_ent[lv - 1][i]) { cr = 252; cg = 252; cb = 252; }
    else { cr = 248; cg = 184; cb = 0; }
    nx = FM_X0 + osx * FM_CW; ny = Y0 + osy * FM_CH;
    if (edge == 0) { for (k = 3; k <= 8; k++) map_put(nx + k, ny - 1, cr, cg, cb); }
    else if (edge == 1) { for (k = 3; k <= 8; k++) map_put(nx + k, ny + FM_CH - 1, cr, cg, cb); }
    else if (edge == 2) { for (k = 2; k <= 5; k++) map_put(nx - 1, ny + k, cr, cg, cb); }
    else { for (k = 2; k <= 5; k++) map_put(nx + FM_CW, ny + k, cr, cg, cb); }
  }
  for (y = 0; y < maxsy; y++) for (x = 0; x < 8; x++) {
    int any = 0, bxx, byy, cx0, cy0, k;
    for (byy = 0; byy < 4 && !any; byy++) for (bxx = 0; bxx < 4; bxx++) {
      int bi = (y * 4 + byy) * 32 + x * 4 + bxx;
      if (bi < rows * 32 && ((map_brk[lv - 1][bi >> 3] >> (bi & 7)) & 1)) { any = 1; break; }
    }
    if (!any) continue;
    cx0 = FM_X0 + x * FM_CW; cy0 = Y0 + y * FM_CH;
    for (k = 0; k < FM_CW; k++) { map_put(cx0 + k, cy0, 0, 232, 216); map_put(cx0 + k, cy0 + FM_CH - 1, 0, 232, 216); }
    for (k = 0; k < FM_CH; k++) { map_put(cx0, cy0 + k, 0, 232, 216); map_put(cx0 + FM_CW - 1, cy0 + k, 0, 232, 216); }
  }
  area = ram[0x14] & 15;
  clv = area < 8 ? area + 9 : area - 7;
  if (clv == lv) {
    int cx0, cy0, dx, dy;
    int blink = (ram[0xBE] == 0) ? 0 : ((frame_no >> 4) & 1);
    uint8_t dr = blink ? 252 : 248, dg = blink ? 252 : 56, db = blink ? 252 : 56;
    sx = (scx + 128) >> 8; if (sx < 0) sx = 0; if (sx > 7) sx = 7;
    sy = (scy + 120) >> 8; if (sy < 0) sy = 0;
    if (sy >= maxsy) sy = maxsy - 1;
    cx0 = FM_X0 + sx * FM_CW + 4; cy0 = Y0 + sy * FM_CH + 2;
    for (dy = 0; dy < 4; dy++) for (dx = 0; dx < 4; dx++) map_put(cx0 + dx, cy0 + dy, dr, dg, db);
  }
}

void bm_map_invalidate(void) { int i; for (i = 0; i < 16; i++) map_valid[i] = 0; }
int bm_map_thumb_hash(int lv) {
  uint32_t h = 2166136261u;
  int i;
  if (lv < 1 || lv > 16) return -1;
  if (!map_valid[lv - 1] && !map_build(lv)) return -1;
  for (i = 0; i < 4096; i++) { h ^= map_px[lv - 1][i]; h *= 16777219u; }
  h ^= map_rows[lv - 1]; h *= 16777219u;
  return (int)(h & 0x7FFFFFFF);
}
int bm_map_doors(int lv) {
  int i, n = 0;
  if (lv < 1 || lv > 16) return -1;
  for (i = 0; i < 108; i++) {
    int a = prg[7][0x1D7E + i];
    int alv;
    if (a >= 16) continue;
    a &= 15;
    alv = a < 8 ? a + 9 : a - 7;
    if (alv == lv) n++;
  }
  return n;
}
int bm_map_brkcnt(int lv) {
  int i, n = 0;
  uint8_t v;
  if (lv < 1 || lv > 16) return -1;
  if (!map_valid[lv - 1] && !map_build(lv)) return -1;
  for (i = 0; i < 128; i++) { v = map_brk[lv - 1][i]; while (v) { n += v & 1; v >>= 1; } }
  return n;
}
int bm_map_brkhash(int lv) {
  uint32_t h = 2166136261u;
  int i;
  if (lv < 1 || lv > 16) return -1;
  if (!map_valid[lv - 1] && !map_build(lv)) return -1;
  for (i = 0; i < 128; i++) { h ^= map_brk[lv - 1][i]; h *= 16777219u; }
  h ^= map_rows[lv - 1]; h *= 16777219u;
  return (int)(h & 0x7FFFFFFF);
}
int bm_map_entcnt(int lv) {
  int i, n = 0;
  if (lv < 1 || lv > 16) return -1;
  if (!map_valid[lv - 1] && !map_build(lv)) return -1;
  for (i = 0; i < map_door_n[lv - 1]; i++) n += map_door_ent[lv - 1][i] ? 1 : 0;
  return n;
}
int bm_map_mylv(void) { return pmenu_map_lv; }
int bm_map_visible(void) { return map_gate(); }
static int ev5_door_side(int area, int x, int y) {
  int i;
  for (i = 0; i < 108; i++) {
    int a = prg[7][0x1D7E + i];
    if (a >= 16) continue;
    if ((a & 15) == area && prg[7][0x1D7E + 108 + i] == x && prg[7][0x1D7E + 216 + i] == y) return i;
  }
  return -1;
}
static int ev5_first_free(void) { int q; for (q = 0; q < 8; q++) if (!sram_occ[q]) return q; return 0; }
static void ev5_snap_render(void) {
  int i;
  for (i = 0; i < 1024; i++) ev5_vram[i] = vram[i];
  for (i = 0; i < 32; i++) ev5_pal[i] = pal[i];
  for (i = 0; i < 256; i++) ev5_oam[i] = oam[i];
  ev5_scx = scx; ev5_scy = scy; ev5_r2000 = reg2000; ev5_r2001 = reg2001;
  ev5_chr0 = chr0; ev5_chr1 = chr1; ev5_mmc = mmc_ctrl;
}
static void ev5_restore_render(void) {
  int i;
  for (i = 0; i < 1024; i++) vram[i] = ev5_vram[i];
  for (i = 0; i < 32; i++) pal[i] = ev5_pal[i];
  for (i = 0; i < 256; i++) oam[i] = ev5_oam[i];
  scx = (uint8_t)ev5_scx; scy = (uint8_t)ev5_scy;
  reg2000 = (uint8_t)ev5_r2000; reg2001 = (uint8_t)ev5_r2001;
  chr0 = (uint8_t)ev5_chr0; chr1 = (uint8_t)ev5_chr1; mmc_ctrl = (uint8_t)ev5_mmc;
}
static void ev5_open(int key) {
  ev5_lastkey = key;
  ev5_phase = 1; ev5_cursor = ev5_first_free(); ev5_wait = 240;
  ev5_snap_taken = 0; ev5_saw_one = 0; ev5_be0run = 0;
}
static void ev5_close_resume(void) {
  if (!ev5_snap_taken) ev5_snap_render();
  ev5_restore_render();
  ev5_phase = 0; ev5_run = 0; ev5_cool = 1;
  pmenu_inject = 8; pmenu_swallow_cd = 12;
}
static void ev5_draw_main(void) {
  menu_text(4, 11, "SAVE HERE");
  vram[8 * 32 + 8] = 1;
  menu_text(8, 10, "SLOT "); menu_num2(8, 15, ev5_cursor + 1);
  if (sram_occ[ev5_cursor]) { menu_text(10, 10, "AREA "); menu_num2(10, 15, sram_area[ev5_cursor]); }
  else menu_text(10, 10, "EMPTY");
  menu_text(12, 9, "A SAVE B LEAVE");
  menu_text(14, 9, "DOWN ENTER");
}

// main-list actions: 0=CONTINUE 1=LOAD 2=SETTINGS 3=QUIT 4=MAP
static int pmenu_main_count(void) {
  int n = 4;
  if (saving_on) n++;
  return n;
}
static int pmenu_main_action(int idx) {
  if (idx == 0) return 0;
  if (idx == 1) return 4;
  if (saving_on) {
    if (idx == 2) return 1;
    if (idx == 3) return 2;
    return 3;
  }
  if (idx == 2) return 2;
  return 3;
}
static const char *pmenu_main_label(int a) {
  if (a == 0) return "CONTINUE";
  if (a == 1) return "LOAD";
  if (a == 2) return "SETTINGS";
  if (a == 4) return "MAP";
  return "QUIT";
}
static void pmenu_draw_main(void) {
  int idx, row;
  int n = pmenu_main_count();
  menu_text(4, 13, "PAUSED");
  row = 8;
  for (idx = 0; idx < n; idx++) {
    vram[row * 32 + 9] = (uint8_t)(idx == pmenu_cursor ? 1 : 0);
    menu_text(row, 11, pmenu_main_label(pmenu_main_action(idx)));
    row += 2;
  }
}
// E8-M4 full-map legend (vram text under the framebuf map; proven glyphs only).
static void pmenu_draw_map(void) {
  int lv = pmenu_map_lv;
  if (lv < 1) lv = 1;
  if (lv > 16) lv = 16;
  menu_text(18, 8, "MAP L");
  menu_num2(18, 13, lv);
  menu_text(18, 16, lv <= 8 ? "DUNGEON" : "OVERHEAD");
  menu_text(19, 8, "GOLD DOOR");
  menu_text(20, 8, "WHITE ENTRANCE");
  menu_text(21, 8, "CYAN BREAKABLE");
  menu_text(22, 8, "DARK UNSEEN");
  menu_text(23, 8, "DOT YOU");
  menu_text(24, 8, "LEFT RIGHT LEVEL");
  menu_text(25, 8, "B BACK");
}
// In-engine reset (QUIT TO TITLE): the bm_boot body, factored so the pause
// menu can reset without the host. Preserves engine config (enhanced_mode,
// saving_on, E4 settings, SRAM slots); establishes the fresh-process inits
// bm_boot relies on (pending_warp/raw, oracle_align_done) explicitly.
static void engine_reset_to_title(void) {
  menu_boot_reset();
  memset(ram, 0x00, sizeof ram);
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
  pending_warp = -1; pending_warp_raw = -1; oracle_align_done = 0;
  bm_trap_seen = 0; bm_trap_val = 0; bm_trap_name[0] = 0; apu_head = 0; apu_tail = 0;
  memset(visit_bits, 0, sizeof visit_bits);
  memset(map_valid, 0, sizeof map_valid);
  pad_sample_fn = pad_fn;
  nmi_fire_fn = nmi_frame;
  b7_entry_F23B();
}
// ---- E2 main menu (engine-side, no shell dependence) ----
// Opens on title/intro Start edge while enhanced_mode is on. Full-NT0
// takeover drawn post-game-logic (menu_draw, from nmi_frame) so the menu
// always wins regardless of background phase. Pad filtered via menu_swallow
// in pad_fn. Dismissals: START (stock new game, cooldown through init),
// CONTINUE/LOAD (stage sram thaw, cooldown through apply), submenu BACK
// (back to main list, no cooldown). Pregame gate (lives==0 && cont==0) keeps
// the menu out of gameplay (incl. the transient lives==0 mid-game case, where
// continues are nonzero), attract demo (lives==2), and game-over flow.
int bm_setting_get(int id) {
  if (id == 0) return setting_volume;
  if (id == 1) return setting_mute;
  if (id == 2) return setting_scale;
  if (id == 3) return setting_filter;
  return -1;
}
void bm_setting_set(int id, int v) {
  if (id == 0) { if (v < 0) v = 0; if (v > 10) v = 10; setting_volume = v; }
  else if (id == 1) setting_mute = v ? 1 : 0;
  else if (id == 2) { if (v < 0) v = 0; if (v > 3) v = 3; setting_scale = v; }
  else if (id == 3) setting_filter = v ? 1 : 0;
}
static void menu_text(int row, int col, const char *s) {
  int i = 0;
  while (s[i] && col < 32) { vram[row * 32 + col] = (uint8_t)s[i]; col++; i++; }
}
static void menu_num2(int row, int col, int v) {
  if (v >= 10) { vram[row * 32 + col] = (uint8_t)((v / 10) + 48); vram[row * 32 + col + 1] = (uint8_t)((v % 10) + 48); }
  else vram[row * 32 + col] = (uint8_t)(v + 48);
}
// main-list actions: 0=START 1=CONTINUE 2=LOAD 3=SETTINGS
static int menu_main_count(void) {
  int n = 2;
  if (saving_on) {
    n++;
    if (sram_last >= 0 && sram_last < 8 && sram_occ[sram_last]) n++;
  }
  return n;
}
static int menu_main_action(int idx) {
  int i;
  if (idx == 0) return 0;
  i = 1;
  if (saving_on && sram_last >= 0 && sram_last < 8 && sram_occ[sram_last]) { if (idx == i) return 1; i++; }
  if (saving_on) { if (idx == i) return 2; }
  return 3;
}
static const char *menu_main_label(int a) {
  if (a == 0) return "START";
  if (a == 1) return "CONTINUE";
  if (a == 2) return "LOAD";
  return "SETTINGS";
}
static void menu_adjust_at(int cur, int dir) {
  if (cur == 0) bm_setting_set(0, setting_volume + dir);
  else if (cur == 1) bm_setting_set(1, setting_mute ? 0 : 1);
  else if (cur == 2) { int v = setting_scale + dir; if (v < 0) v = 3; if (v > 3) v = 0; bm_setting_set(2, v); }
  else if (cur == 3) bm_setting_set(3, setting_filter ? 0 : 1);
  else if (cur == 4) bm_map_show_set(map_show ? 0 : 1);
}
// F1: race-free open inside pad_fn. The game polls the pad in the main slice
// BEFORE NMI entry, while menu_tick runs at NMI entry AFTER the host sets the
// pad -- so a tick-side open always loses the race (game starts AND menu opens).
// pad_fn is sampled at scan-241 (main slice, before the game strobes $4016) and
// at NMI entry, so the first sighting of the Start edge opens the menu and
// returns 0 synchronously: the game never sees the opening press. The edge is
// consumed (menu_prevpad = game_pad) so the held Start does not instantly
// confirm START on the next tick. In-menu navigation stays in menu_tick.
// E3 open rides the same race-free pad_fn path as E2: the first sighting of
// the Select edge while Start-paused opens the menu and returns 0 synchronously,
// so the game never sees the opening press (the dismiss-press tail is likewise
// swallowed by pmenu_swallow_cd, so menu chrome input never reaches the game).
static uint8_t pad_fn(uint64_t f) {
  (void)f;
  if (!enhanced_mode) { menu_prevpad = game_pad; pmenu_prevpad = game_pad; return game_pad; }
  if (pmenu_inject > 0 || ev5_down_inj > 0) {
    uint8_t r = game_pad;
    if (pmenu_inject > 0) r = (uint8_t)(r | 8);
    if (ev5_down_inj > 0) r = (uint8_t)(r | 32);
    menu_prevpad = r;
    pmenu_prevpad = r;
    return r;
  }
  if (!menu_phase && !menu_cooldown && ram[0xDD] == 0 && ram[0x37E] == 0) {
    if ((game_pad & 8) && !(menu_prevpad & 8)) {
      menu_phase = 1; menu_cursor = 0; menu_swallow = 1;
      menu_prevpad = game_pad;
      pmenu_prevpad = game_pad;
      return 0;
    }
  }
  if (!menu_phase && !pmenu_phase && !pmenu_cooldown && ev5_phase == 0 && pmenu_gameplay() &&
      presnap_ram[0xBE] == 0 && pmenu_cause == 1 && ((presnap_ram[0xB7] & ~4) == 0)) {
    if ((game_pad & 4) && !(pmenu_prevpad & 4)) {
      pmenu_snap_render();
      pmenu_phase = 1; pmenu_cursor = 0; pmenu_swallow = 1;
      menu_prevpad = game_pad;
      pmenu_prevpad = game_pad;
      return 0;
    }
  }
  // E5 race-free open: first sighting of the Up edge on a stable doorway opens
  // the prompt and swallows the press (game-visible silence: the opening tap
  // must not perturb the transition/game, E5-F lesson). Pause engages via the
  // tick-side level inject (transition opens engage on the BE 0->1 edge).
  if (!menu_phase && !pmenu_phase && !pmenu_cooldown && ev5_phase == 0 && !ev5_cool && enhanced_mode && saving_on && pmenu_gameplay() && ((ram[0xB7] & 1) == 1) && ev5_run >= 6 && ev5_curside >= 0 && ev5_curside != ev5_lastkey) {
    if ((game_pad & 16) && !(pmenu_prevpad & 16)) {
      ev5_open(ev5_curside);
      menu_prevpad = game_pad; pmenu_prevpad = game_pad;
      return 0;
    }
  }
  // E3 race-free CONTINUE confirm.
  if (pmenu_phase == 1 && pmenu_cursor == 0) {
    int ce = (game_pad ^ pmenu_prevpad) & game_pad;
    if (ce & (8 | 1)) {
      pmenu_restore_render();
      uint8_t cr = (uint8_t)(game_pad | 8);
      pmenu_phase = 0; pmenu_cursor = 0; pmenu_swallow = 0;
      pmenu_cooldown = 1; pmenu_swallow_cd = 12; pmenu_inject = 8;
      menu_prevpad = cr; pmenu_prevpad = cr;
      return cr;
    }
  }
  if (ev5_phase != 0) {
    int ce = (game_pad ^ pmenu_prevpad) & game_pad;
    uint8_t cr = (uint8_t)(game_pad | 8);
    if (ce & (8 | 1)) { ev5_pending_save = ev5_cursor; ev5_close_resume(); menu_prevpad = cr; pmenu_prevpad = cr; return cr; }
    if (ce & (2 | 4)) { ev5_close_resume(); menu_prevpad = cr; pmenu_prevpad = cr; return cr; }
    if (ce & 32) { ev5_pending_down = 1; ev5_close_resume(); menu_prevpad = cr; pmenu_prevpad = cr; return cr; }
    if (ce & 64) { ev5_cursor = (ev5_cursor + 7) % 8; menu_prevpad = game_pad; pmenu_prevpad = game_pad; return 0; }
    if (ce & 128) { ev5_cursor = (ev5_cursor + 1) % 8; menu_prevpad = game_pad; pmenu_prevpad = game_pad; return 0; }
    return 0;
  }
  if (menu_swallow || pmenu_swallow || pmenu_swallow_cd > 0) return 0;
  return game_pad;
}
void menu_tick(void) {
  int gp = game_pad;
  int e = (gp ^ menu_prevpad) & gp;
  int pregame = (ram[0xDD] == 0 && ram[0x37E] == 0);
  int gameplay = !pregame;
  int be = presnap_ram[0xBE];
  if (!enhanced_mode) {
    menu_phase = 0; menu_cursor = 0; menu_cooldown = 0; menu_swallow = 0;
    menu_prevpad = gp;
    pmenu_phase = 0; pmenu_cursor = 0; pmenu_cooldown = 0; pmenu_swallow = 0;
    pmenu_prevpad = gp; pmenu_inject = 0; pmenu_cause = 0; pmenu_prev_be = be; pmenu_pending_load = -1; pmenu_swallow_cd = 0; pmenu_map_lv = 1;
    ev5_phase = 0; ev5_run = 0; ev5_lastkey = -1; ev5_cursor = 0; ev5_cool = 0; ev5_pending_save = -1; ev5_pending_down = 0; ev5_down_inj = 0; ev5_snap_taken = 0; ev5_saw_one = 0; ev5_be0run = 0; ev5_curside = -1; ev5_curside = -1;
    return;
  }
  if (gameplay) visit_mark();
  if (pmenu_swallow_cd > 0) pmenu_swallow_cd--;
  if (pmenu_inject > 0) pmenu_inject--;
  if (ev5_down_inj > 0) ev5_down_inj--;  // frame-counted: one NMI tick per poll-visible frame, exactly like a stock 8f tap
  pmenu_clock++;
  if (e & 8) pmenu_last_start = pmenu_clock;
  if (e & 4) pmenu_last_select = pmenu_clock;
  if (pmenu_prev_be == 1 && be == 0) {
    int ds = pmenu_clock - pmenu_last_start;
    int dl = pmenu_clock - pmenu_last_select;
    if (ds <= 100 && ds <= dl) pmenu_cause = 1;
    else pmenu_cause = 2;
  } else if (be == 1) {
    pmenu_cause = 0;
  }
  pmenu_prev_be = be;
  if (pmenu_pending_load >= 0 && be == 1 && gameplay) {
    int psl = pmenu_pending_load;
    pmenu_pending_load = -1;
    if (psl >= 0 && psl < 8 && sram_occ[psl]) bm_sram_load(psl, sram_crc[psl]);
    pmenu_cooldown = 1;
  }
  if (menu_phase && !pregame) {
    menu_phase = 0; menu_cursor = 0; menu_cooldown = 1; menu_swallow = 0;
    menu_prevpad = gp; pmenu_prevpad = gp; return;
  }
  if (!menu_phase) {
    menu_swallow = 0;
    if (!menu_cooldown && pregame && (e & 8)) { menu_phase = 1; menu_cursor = 0; menu_swallow = 1; }
    else if (!pregame) menu_cooldown = 0;
    if (!pmenu_phase) {
      pmenu_swallow = 0;
      if (!pmenu_cooldown && gameplay && be == 0 && pmenu_cause == 1 && ev5_phase == 0 &&
          ((presnap_ram[0xB7] & ~4) == 0) && (e & 4)) {
        pmenu_snap_render();
        pmenu_phase = 1; pmenu_cursor = 0; pmenu_swallow = 1;
      } else if (be == 1) {
        pmenu_cooldown = 0;
      }
    } else if (!gameplay || be == 1) {
      pmenu_phase = 0; pmenu_cursor = 0; pmenu_swallow = 0;
    } else {
      pmenu_swallow = 1;
      if (pmenu_phase == 1) {
        int n = pmenu_main_count();
        if (pmenu_cursor >= n) pmenu_cursor = n - 1;
        if (e & 32) pmenu_cursor = (pmenu_cursor + 1) % n;
        if (e & 16) pmenu_cursor = (pmenu_cursor + n - 1) % n;
        if (e & (2 | 4)) { pmenu_restore_render(); pmenu_phase = 0; pmenu_cursor = 0; pmenu_swallow = 0; pmenu_swallow_cd = 12; }
        else if (e & (8 | 1)) {
          int a = pmenu_main_action(pmenu_cursor);
          if (a == 0) { pmenu_restore_render(); pmenu_inject = 8; pmenu_phase = 0; pmenu_cursor = 0; pmenu_swallow = 0; pmenu_swallow_cd = 12; }
          else if (a == 4) { int ea2 = ram[0x14] & 15; pmenu_map_lv = ea2 < 8 ? ea2 + 9 : ea2 - 7; if (pmenu_map_lv < 1) pmenu_map_lv = 1; if (pmenu_map_lv > 16) pmenu_map_lv = 16; pmenu_phase = 4; pmenu_cursor = 0; }
          else if (a == 1) { pmenu_phase = 2; pmenu_cursor = 0; }
          else if (a == 2) { pmenu_phase = 3; pmenu_cursor = 0; }
          else { engine_reset_to_title(); }
        }
      } else if (pmenu_phase == 2) {
        if (e & 32) pmenu_cursor = (pmenu_cursor + 1) % 9;
        if (e & 16) pmenu_cursor = (pmenu_cursor + 8) % 9;
        if (e & 2) { pmenu_phase = 1; pmenu_cursor = 0; }
        else if (e & (8 | 1)) {
          if (pmenu_cursor == 8) { pmenu_phase = 1; pmenu_cursor = 0; }
          else if (pmenu_cursor >= 0 && pmenu_cursor < 8 && sram_occ[pmenu_cursor]) {
            pmenu_pending_load = pmenu_cursor;
            pmenu_phase = 0; pmenu_cursor = 0; pmenu_swallow = 0; pmenu_cooldown = 1;
            if (be == 1 && gameplay) {
              int psl2 = pmenu_pending_load; pmenu_pending_load = -1;
              bm_sram_load(psl2, sram_crc[psl2]);
            } else {
              pmenu_inject = 8;
              pmenu_swallow_cd = 12;
            }
          }
        }
      } else if (pmenu_phase == 3) {
        if (e & 32) pmenu_cursor = (pmenu_cursor + 1) % 6;
        if (e & 16) pmenu_cursor = (pmenu_cursor + 5) % 6;
        if (e & 64) menu_adjust_at(pmenu_cursor, -1);
        if (e & 128) menu_adjust_at(pmenu_cursor, 1);
        if (e & 2) { pmenu_phase = 1; pmenu_cursor = 0; }
        else if (e & (8 | 1)) { if (pmenu_cursor == 5) { pmenu_phase = 1; pmenu_cursor = 0; } }
      } else if (pmenu_phase == 4) {
        if (e & (64 | 16)) pmenu_map_step(-1);
        if (e & (128 | 32)) pmenu_map_step(1);
        if (e & 2) { pmenu_phase = 1; pmenu_cursor = 1; }
        else if (e & (8 | 1)) { pmenu_phase = 1; pmenu_cursor = 1; }
      }
    }
    if (!pmenu_phase && saving_on) {
      if (ev5_pending_save >= 0) { bm_sram_save(ev5_pending_save, 0); ev5_pending_save = -1; }
      if (ev5_pending_down && gameplay && (be == 1 || ((presnap_ram[0xB7] & 1) == 1))) { ev5_pending_down = 0; ev5_down_inj = 8; }
      if (be == 1) ev5_cool = 0;
      if (ev5_phase == 1 && !ev5_snap_taken) { if (be == 1) { ev5_saw_one = 1; ev5_be0run = 0; } else if (ev5_saw_one || ((presnap_ram[0xB7] & 4) == 4) || ++ev5_be0run >= 240) { ev5_snap_render(); ev5_snap_taken = 1; } }
      if (ev5_phase == 1 && be == 1) { pmenu_inject = 8; if (--ev5_wait <= 0) { if (!ev5_snap_taken) ev5_snap_render(); ev5_restore_render(); ev5_phase = 0; ev5_run = 0; } }
      if (ev5_phase == 0 && !ev5_cool && ((presnap_ram[0xB7] & 1) == 1)) {
        int ea = presnap_ram[0x14] & 15, exx = presnap_ram[0x49], eyy = presnap_ram[0x4B];
        int evside = ev5_door_side(ea, exx, eyy);
        if (evside < 0) { ev5_run = 0; ev5_curside = -1; }
        else { ev5_curside = evside; ev5_run++; if (ev5_run >= EV5_NEED && evside != ev5_lastkey && ((e & 16) || (gp & 16))) ev5_open(evside); }
      }
    } else if (!pmenu_phase) {
      if (ev5_phase != 0) { if (!ev5_snap_taken) ev5_snap_render(); ev5_restore_render(); ev5_phase = 0; }
      ev5_run = 0; ev5_pending_save = -1; ev5_pending_down = 0;
    }
    menu_prevpad = gp; pmenu_prevpad = gp; return;
  }
  menu_swallow = 1;
  if (menu_phase == 1) {
    int n = menu_main_count();
    if (menu_cursor >= n) menu_cursor = n - 1;
    if (e & 32) menu_cursor = (menu_cursor + 1) % n;
    if (e & 16) menu_cursor = (menu_cursor + n - 1) % n;
    if (e & (8 | 1)) {
      int a = menu_main_action(menu_cursor);
      if (a == 0) { menu_phase = 0; menu_cooldown = 1; menu_swallow = 0; }
      else if (a == 1) { bm_sram_load(sram_last, sram_crc[sram_last]); menu_phase = 0; menu_cooldown = 1; menu_swallow = 0; }
      else if (a == 2) { menu_phase = 2; menu_cursor = 0; }
      else { menu_phase = 3; menu_cursor = 0; }
    }
  } else if (menu_phase == 2) {
    if (e & 32) menu_cursor = (menu_cursor + 1) % 9;
    if (e & 16) menu_cursor = (menu_cursor + 8) % 9;
    if (e & 2) { menu_phase = 1; menu_cursor = 0; }
    else if (e & (8 | 1)) {
      if (menu_cursor == 8) { menu_phase = 1; menu_cursor = 0; }
      else if (menu_cursor >= 0 && menu_cursor < 8 && sram_occ[menu_cursor]) {
        bm_sram_load(menu_cursor, sram_crc[menu_cursor]);
        menu_phase = 0; menu_cooldown = 1; menu_swallow = 0;
      }
    }
  } else if (menu_phase == 3) {
    if (e & 32) menu_cursor = (menu_cursor + 1) % 6;
    if (e & 16) menu_cursor = (menu_cursor + 5) % 6;
    if (e & 64) menu_adjust_at(menu_cursor, -1);
    if (e & 128) menu_adjust_at(menu_cursor, 1);
    if (e & 2) { menu_phase = 1; menu_cursor = 0; }
    else if (e & (8 | 1)) { if (menu_cursor == 5) { menu_phase = 1; menu_cursor = 0; } }
  }
  menu_prevpad = gp; pmenu_prevpad = gp;
}
static void menu_draw_main(void) {
  int idx, row;
  int n = menu_main_count();
  menu_text(4, 9, "BLASTER MASTER");
  row = 8;
  for (idx = 0; idx < n; idx++) {
    vram[row * 32 + 9] = (uint8_t)(idx == menu_cursor ? 1 : 0);
    menu_text(row, 11, menu_main_label(menu_main_action(idx)));
    row += 2;
  }
}
static void menu_draw_load_at(int cur) {
  int s, row;
  menu_text(4, 14, "LOAD");
  row = 7;
  for (s = 0; s < 8; s++) {
    vram[row * 32 + 8] = (uint8_t)(s == cur ? 1 : 0);
    menu_text(row, 10, "SLOT ");
    menu_num2(row, 15, s + 1);
    if (sram_occ[s]) { menu_text(row, 17, "AREA "); menu_num2(row, 22, sram_area[s]); }
    else menu_text(row, 17, "EMPTY");
    row++;
  }
  vram[16 * 32 + 8] = (uint8_t)(cur == 8 ? 1 : 0);
  menu_text(16, 10, "BACK");
}
static void menu_draw_settings_at(int cur) {
  menu_text(4, 12, "SETTINGS");
  vram[8 * 32 + 8] = (uint8_t)(cur == 0 ? 1 : 0);
  menu_text(8, 10, "VOLUME "); menu_num2(8, 17, setting_volume);
  vram[10 * 32 + 8] = (uint8_t)(cur == 1 ? 1 : 0);
  menu_text(10, 10, "MUTE ");
  menu_text(10, 15, setting_mute ? "ON" : "OFF");
  vram[12 * 32 + 8] = (uint8_t)(cur == 2 ? 1 : 0);
  menu_text(12, 10, "SCALE ");
  menu_text(12, 16, setting_scale == 0 ? "INTEGER" : (setting_scale == 1 ? "FIT" : (setting_scale == 2 ? "FILL" : "STRETCH")));
  vram[14 * 32 + 8] = (uint8_t)(cur == 3 ? 1 : 0);
  menu_text(14, 10, "FILTER ");
  menu_text(14, 17, setting_filter ? "BILINEAR" : "NEAREST");
  vram[16 * 32 + 8] = (uint8_t)(cur == 4 ? 1 : 0);
  menu_text(16, 10, "MAP ");
  menu_text(16, 14, map_show ? "ON" : "OFF");
  vram[18 * 32 + 8] = (uint8_t)(cur == 5 ? 1 : 0);
  menu_text(18, 10, "BACK");
}
void menu_draw(void) {
  int i;
  if (!menu_phase && !pmenu_phase && !(ev5_phase && ev5_snap_taken)) return;
  for (i = 0; i < 1024; i++) vram[i] = 0;
  for (i = 0; i < 64; i++) vram[960 + i] = 0;
  pal[0] = 0x0F; pal[1] = 0x30; pal[2] = 0x30; pal[3] = 0x30;
  scx = 0; scy = 0;
  reg2000 = (uint8_t)(reg2000 & 0xFC);
  for (i = 0; i < 256; i += 4) oam[i] = 0xFF;
  for (i = 4; i <= 27; i++) { vram[2 * 32 + i] = 1; vram[27 * 32 + i] = 1; }
  for (i = 3; i <= 26; i++) { vram[i * 32 + 4] = 1; vram[i * 32 + 27] = 1; }
  if (menu_phase == 1) menu_draw_main();
  else if (menu_phase == 2) menu_draw_load_at(menu_cursor);
  else if (menu_phase == 3) menu_draw_settings_at(menu_cursor);
  else if (pmenu_phase == 1) pmenu_draw_main();
  else if (pmenu_phase == 2) menu_draw_load_at(pmenu_cursor);
  else if (pmenu_phase == 3) menu_draw_settings_at(pmenu_cursor);
  else if (pmenu_phase == 4) pmenu_draw_map();
  else if (ev5_snap_taken) ev5_draw_main();
}


// Headless observability for menu tests (phase/cursor/prevpad/cooldown, pad+swallow).
// Kept in shipped code: 2 lines, no secrets, lets future suites assert menu state.
int bm_menu_dbg(void) { return (menu_phase & 255) | ((menu_cursor & 255) << 8) | ((menu_prevpad & 255) << 16) | ((menu_cooldown & 255) << 24); }
int bm_menu_dbg2(void) { return ((int)game_pad & 255) | ((menu_swallow & 255) << 8); }
int bm_pmenu_dbg(void) { return (pmenu_phase & 255) | ((pmenu_cursor & 255) << 8) | ((pmenu_prevpad & 255) << 16) | ((pmenu_cooldown & 255) << 24); }
int bm_pmenu_dbg2(void) { return ((int)game_pad & 255) | ((pmenu_swallow & 255) << 8) | ((pmenu_cause & 255) << 16) | ((pmenu_inject & 255) << 24); }
int bm_ev5_dbg(void) { return (ev5_phase & 255) | ((ev5_cursor & 255) << 8) | ((ev5_run & 255) << 16) | ((ev5_cool & 255) << 24); }
void bm_ev5_testreset(void) { ev5_run = 0; ev5_lastkey = -1; ev5_cool = 0; ev5_wait = 0; ev5_snap_taken = 0; ev5_saw_one = 0; ev5_be0run = 0; ev5_curside = -1; }
static void menu_boot_reset(void) {
  menu_phase = 0; menu_cursor = 0;
  menu_cooldown = 0; menu_swallow = 0; menu_prevpad = 0;
  pmenu_phase = 0; pmenu_cursor = 0;
  pmenu_map_lv = 1;
  pmenu_cooldown = 0; pmenu_swallow = 0; pmenu_prevpad = 0;
  pmenu_inject = 0; pmenu_cause = 0; pmenu_prev_be = 0; pmenu_pending_load = -1; pmenu_swallow_cd = 0;
  ev5_phase = 0; ev5_run = 0; ev5_lastkey = -1; ev5_cursor = 0; ev5_cool = 0; ev5_pending_save = -1; ev5_pending_down = 0; ev5_down_inj = 0; ev5_snap_taken = 0; ev5_saw_one = 0; ev5_be0run = 0;
}
// S6 hook-7 report: high 16 = hooked sites, low 16 = rewritten LDA copies.
int bm_siteovr_info(void) { return (HOOK7_SITES << 16) | HOOK7_REWRITES; }
void bm_boot(void) {
  engine_reset_to_title();
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
