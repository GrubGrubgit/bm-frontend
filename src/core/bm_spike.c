// bm_spike.c -- L0 toolchain spike adapter (freestanding wasm32).
// Amalgamation wrap of the vendored engine: combined_enf.c is included
// unmodified (on-disk bytes frozen at ENGINE_PIN); this file only adds
// libc stubs (no libc on the wasm target) plus a minimal spike API that
// proves the engine executes in-page. NOT the L2 platform adapter.
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

#include "combined_enf.c"

int bm_spike_add(int a, int b) { return a + b; }

void bm_spike_init(void) {
  memset(ram, 0, sizeof ram);
  A = 0; X = 0; Y = 0; S = 0xFD; P = 0x24;
  pad_bits = 0; pad_pos1 = 0; pad_pos2 = 0; strobe = 0;
  cycles = 0;
}

int bm_spike_nmi_tail(void) {
  S = 0xF9;
  stk[0xFA] = 0x11; stk[0xFB] = 0x22; stk[0xFC] = 0x33;
  b7_LEB91();
  if (S == 0xFC && Y == 0x11 && X == 0x22 && A == 0x33) return 1;
  return 0;
}

int bm_spike_irq(void) {
  S = 0xFD;
  b7_entry_EB97();
  return S == 0xFD ? 1 : 0;
}

int bm_spike_ram(int i) { return ram[i & 0x7FF]; }
