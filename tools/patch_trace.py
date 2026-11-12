# Debug-build trace hooks (mechanical, audited). Applies THREE additions to
# a pristine vendor combined_off.c copy for build/vendor-dbg/:
#  1. trace ring decls after the APU ring (tr_buf/trw_buf/tr_ev/trw_ev/tr_vec_calls)
#  2. WR() hook logging zp 0x7A/0x7B writes (vec007A vector bytes)
#  3. b7_vec_007A hook logging the dispatched vector + raw bytes
# Read by node harnesses via bm_trace_ptr/bm_trace_drain/bm_vec_calls.
# Fails loudly on anchor drift. Idempotent only via re-copy (asserts count==1).
import pathlib, sys
p = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'build/vendor-dbg/combined_off.c')
NL = chr(10)
src = p.read_text()
a1 = 'ApuEv apu_ring[256];' + NL + 'int apu_head;'
decls = NL.join([
'uint16_t tr_buf[8192]; int tr_head;',
'uint16_t trw_buf[512]; int trw_head;',
'static void trw_ev(uint16_t a, uint16_t v, uint64_t f) { int i = trw_head & 511; trw_buf[i] = a; trw_buf[(i+1)&511] = v; trw_buf[(i+2)&511] = (uint16_t)(f & 0xFFFF); trw_buf[(i+3)&511] = (uint16_t)((f>>16) & 0xFFFF); trw_head += 4; }',
'unsigned long long tr_vec_calls;',
'static void tr_ev(uint16_t tag, uint16_t val) { int i = tr_head & 8191; tr_buf[i] = tag; tr_buf[(i + 1) & 8191] = val; tr_head += 2; }',
])
a2 = 'static void WR(uint16_t a, uint8_t v) {' + NL + '    if (a < 0x2000) { ram[a & 0x7FF] = v; return; }'
w = 'static void WR(uint16_t a, uint8_t v) {' + NL + '    if (a == 0x7A || a == 0x7B) { tr_ev(a, v); trw_ev(a, v, cycles / 29781ULL); }' + NL + '    if (a < 0x2000) { ram[a & 0x7FF] = v; return; }'
a3 = 'uint16_t _v = (uint16_t)(RD(0x007A) | ((uint16_t)RD(0x007B) << 8));' + NL + 'switch (_v) {'
v = 'uint16_t _v = (uint16_t)(RD(0x007A) | ((uint16_t)RD(0x007B) << 8));' + NL + 'tr_ev(0x8000, _v); tr_ev(0x8001, ram[0x7A]); tr_ev(0x8002, ram[0x7B]); tr_vec_calls++;' + NL + 'tr_ev(0x8003, (uint16_t)((swbank - &prg[0][0]) / 0x4000));' + NL + 'switch (_v) {'
for name, a in (('decls', a1), ('wr', a2), ('vec', a3)):
    c = src.count(a)
    print(name + ' anchor count: ' + str(c))
    assert c == 1, name + ' anchor drift'
out = src.replace(a1, a1 + NL + decls).replace(a2, w).replace(a3, v)
p.write_text(out)
print('trace hooks applied, bytes: ' + str(len(out)))
