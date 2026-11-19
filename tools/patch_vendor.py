# Build-time vendor patch (adapter-owned, audited). Copies the pinned engine
# into build/vendor/ and applies THREE mechanical hooks, anchors asserted:
#  1. runtime.h globals: APU event ring (apu_ring/apu_head).
#  2. runtime.h WR(): log $4000-$4017 writes into the ring.
# Canonical gen/ files are never modified. Fails loudly on anchor drift.
#  3. LE351 story-skip unwind resumes at C2AC (single static caller chain, G2 target-resume).
import sys, pathlib
RECOMP = pathlib.Path(__file__).resolve().parent.parent.parent / "recomp"
OUT = pathlib.Path(__file__).resolve().parent.parent / "build" / "vendor"
A1 = "uint8_t chr0, chr1;"
R1 = ("uint8_t chr0, chr1;\n"
      "typedef struct { uint16_t a; uint8_t v; uint8_t _r; uint32_t c; } ApuEv;\n"
      "ApuEv apu_ring[256];\n"
      "int apu_head;")
A2 = "    if (a < 0x4020) return;"
R2 = ("    if (a >= 0x4000 && a < 0x4018) {\n"
      "        int _ah = apu_head & 255;\n"
      "        apu_ring[_ah].a = a; apu_ring[_ah].v = v;\n"
      "        apu_ring[_ah].c = (uint32_t)(cycles & 0xFFFFFFFFu);\n"
      "        apu_head++;\n"
      "    }\n"
      "    if (a < 0x4020) return;")
def main():
    rt = (RECOMP / "tools" / "lift" / "runtime.h").read_text()
    assert rt.count(A1) == 1, "anchor1 drift"
    assert rt.count(A2) == 1, "anchor2 drift"
    rt = rt.replace(A1, R1).replace(A2, R2)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "runtime.h").write_text(rt)
    co = (RECOMP / "gen" / "combined_off.c").read_text()
    assert co.count(A1) == 1, "combined anchor1 drift"
    assert co.count(A2) == 1, "combined anchor2 drift"
    co = co.replace(A1, R1).replace(A2, R2)
    nstub = co.count("(void) { __builtin_trap(); }")
    assert nstub == 7, nstub
    lines = co.split(chr(10))
    defidx = [i for i, ln in enumerate(lines) if ln.strip() == "default: __builtin_trap();"]
    assert len(defidx) == 1, defidx
    enc = next(lines[i] for i in range(defidx[0], -1, -1) if lines[i].startswith("static void "))
    assert "b7_vec_007A" in enc, enc
    tls = []
    for ln in lines:
        if "(void) { __builtin_trap(); }" in ln:
            nm = ln.split("static void ")[1].split("(void)")[0]
            ln = "static void " + nm + "(void) { bm_trap(0, " + chr(34) + nm + chr(34) + "); }"
        if ln.strip() == "default: __builtin_trap();":
            # ($007A) dispatcher: the unmapped runtime vector IS the news.
            # Name it so the app can display/log it (was anonymous NULL).
            ln = ln.replace("__builtin_trap();", "bm_trap(_v, " + chr(34) + "vec007A-unmapped" + chr(34) + ");")
        tls.append(ln)
    co = chr(10).join(tls)
    li = co.split(chr(10))
    k = -1
    n = len(li)
    i = 0
    while i < n:
        if li[i] == 'static void __attribute__((used)) b7_LE351(void) {':
            k = i
        i = i + 1
    assert k >= 0, 'LE351 anchor missing'
    assert li[k+1].strip().startswith('nmi_poll(')
    assert li[k+2].strip() == 'X = RD(0x01); setZN(X);'
    assert li[k+5].strip() == 'S = X;'
    assert li[k+7].strip().startswith('nmi_poll(')
    assert li[k+9].strip() == 'return;'
    li[k+9] = li[k+9].replace('return;', '__attribute__((musttail)) return b7_entry_C2AC();')
    co = chr(10).join(li)
    (OUT / "combined_off.c").write_text(co)
    print("vendor patched: runtime.h APU ring + combined_off.c + LE351resume")
main()
