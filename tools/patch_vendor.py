# Build-time vendor patch (adapter-owned, audited). Copies the pinned engine
# into build/vendor/ and applies TWO mechanical hooks, anchors asserted:
#  1. runtime.h globals: APU event ring (apu_ring/apu_head).
#  2. runtime.h WR(): log $4000-$4017 writes into the ring.
# Canonical gen/ files are never modified. Fails loudly on anchor drift.
import sys, pathlib
RECOMP = pathlib.Path("/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/recomp")
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
    (OUT / "combined_off.c").write_text(co)
    print("vendor patched: runtime.h APU ring + combined_off.c verbatim")
main()
