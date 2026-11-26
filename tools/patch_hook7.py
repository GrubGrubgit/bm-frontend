# tools/patch_hook7.py -- S6 per-site song override (build-time C rewrite).
# Runs after patch_vendor.py, before patch_tailcalls.py (see build_game.sh).
# The static recomp bakes LDA-immediate song ids into wasm, so staged prg
# patches cannot change code request sites. This rewrite turns each lifted
# site LDA into A = song_site_ovr(bank, 0xcpu, 0xstock), defined in
# src/core/bm_api.c before the engine include: a pack-driven sparse table
# with stock fallback, so stock behavior is bit-identical with no overrides.
# Sites come from src/pack/sound.js SITES (single source of truth). The T
# entry (bank4 cpu 0xA120, LA124 area-BGM table data) is excluded: it is a
# data read, already pack-editable. Candidate LDA addrs per site: cpu-2
# (I-shape: LDA directly before JSR) and cpu (L-shape: conduct pins whose
# cpu IS the LDA addr); bank7 nominal addrs live +0x4000 in the fixed bank.
# A rewrite applies only inside a same-bank function (b4_ / b6_ / b7_
# prefix): numeric 8000-window addresses collide across banks. Sites with
# no lifted LDA (unlifted conditional paths, currently 6) are reported, not
# failed: tools/verify-sound-s6.mjs pins the exact hooked set, so any lift
# coverage change surfaces there instead of breaking the build.
# Also bakes HOOK7_SITES / HOOK7_REWRITES (read by bm_siteovr_info).
import pathlib
FE = pathlib.Path(__file__).resolve().parent.parent
def main():
    snd = (FE / "src" / "pack" / "sound.js").read_text()
    i0 = snd.index("export const SITES = {")
    blk = snd[i0:i0+20000]
    entries = []
    cur = -1
    DIG = "0123456789"
    HEXD = "0123456789abcdefABCDEFxX"
    SPC = " "
    NL = chr(10)
    QU = chr(39)
    for raw in blk.split(NL):
        line = raw.strip()
        if line.startswith(QU):
            q2 = line.find(QU, 1)
            try:
                cur = int(line[1:q2], 16)
            except:
                pass
        k = 0
        while True:
            o = line.find("{", k)
            if o < 0:
                break
            j = o + 1
            while j < len(line) and line[j] == SPC:
                j = j + 1
            if not line.startswith("b:", j):
                k = o + 1
                continue
            j = j + 2
            while j < len(line) and line[j] == SPC:
                j = j + 1
            k2 = j
            while k2 < len(line) and line[k2] in DIG:
                k2 = k2 + 1
            bank = int(line[j:k2])
            c = line.find("cpu:", k2)
            j = c + 4
            while j < len(line) and line[j] == SPC:
                j = j + 1
            k3 = j
            while k3 < len(line) and line[k3] in HEXD:
                k3 = k3 + 1
            cpu = int(line[j:k3], 16)
            entries.append((cur, bank, cpu))
            k = k3
    sites = []
    for (song, bank, cpu) in entries:
        if bank == 4 and cpu == 0xA120:
            continue
        cands = [cpu - 2, cpu]
        if bank == 7:
            c2 = []
            for a in cands:
                c2.append(a + 0x4000 if a < 0xC000 else a)
            cands = c2
        sites.append((song, bank, cpu, cands))
    vp = FE / "build" / "vendor" / "combined_off.c"
    co = vp.read_text()
    li = co.split(NL)
    fb = None
    FB = ("b4", "b6", "b7")
    hits = {}
    i = 0
    n = len(li)
    while i < n:
        s = li[i].strip()
        if s.startswith("static void ") and "(void)" in s:
            rest = s[len("static void "):]
            if rest.startswith("__attribute__"):
                kk = rest.find(")) ")
                rest = rest[kk+3:]
            nm = rest.split("(")[0]
            pp = nm.split("_")[0]
            fb = pp if pp in FB else None
        elif s.startswith("A = 0x") and s.endswith("; setZN(A);"):
            val = int(s.split("0x")[1].split(";")[0], 16)
            addr = -1
            j = i - 1
            while j >= 0 and j >= i - 6:
                t = li[j].strip()
                if t.startswith("nmi_pc = 0x"):
                    addr = int(t.split("0x")[1].split(";")[0], 16)
                    break
                if t.startswith("nmi_poll("):
                    j = j - 1
                    continue
                break
            if addr >= 0:
                for (song, bank, cpu, cands) in sites:
                    if val == song and addr in cands and fb == ("b" + str(bank)):
                        pre = li[i][:len(li[i])-len(s)]
                        li[i] = pre + "A = song_site_ovr(" + str(bank) + ", 0x" + ("%04x" % cpu) + ", 0x" + ("%02X" % song) + "); setZN(A);"
                        key = (song, bank, cpu)
                        hits[key] = hits.get(key, 0) + 1
                        break
        i = i + 1
    co = NL.join(li)
    nrew = 0
    for k7 in hits:
        nrew = nrew + hits[k7]
    d7 = "#define HOOK7_SITES " + str(len(hits)) + NL + "#define HOOK7_REWRITES " + str(nrew) + NL
    anc = "#define LIFT_RUNTIME_H" + NL
    assert co.count(anc) == 1, "hook7 runtime anchor drift"
    co = co.replace(anc, anc + d7)
    vp.write_text(co)
    print("hook7: sites=" + str(len(sites)) + " hooked=" + str(len(hits)) + " rewrites=" + str(nrew))
    uh = []
    for (song, bank, cpu, cands) in sites:
        if (song, bank, cpu) not in hits:
            uh.append(str(bank) + ":" + ("%04x" % cpu))
    print("hook7 unhooked: " + ",".join(uh))
main()
