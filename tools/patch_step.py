# Build-time step patch (spin-yield stepping, no SAB/Atomics needed).
# Lifted vblank waits are self-goto spins whose bodies start AT the label
# (empty prologues, enforced by census). nmi_fire_now(frame, site) receives
# the crossing caller; the site is recorded into a GLOBAL (survives the JS
# YIELD unwind; handler-internal polls must NOT overwrite it). Appends
# bm_is_spin() + bm_resume() (in_nmi=0, re-enter the recorded spin top).
# Classic boot+return path untouched (node harness passes unchanged).
import re, pathlib
VENDOR = pathlib.Path(__file__).resolve().parent.parent / "build" / "vendor"
A_DECL = "int in_nmi;"
A_FIRE = "static void nmi_fire_now(uint64_t frame, const char *site) {"
COPY = "\n    { int _i = 0; while (_i < 63 && site[_i]) { step_site_buf[_i] = site[_i]; _i++; } step_site_buf[_i] = 0; }"
def patch_rt(p):
    t = p.read_text()
    assert t.count(A_DECL) == 1, "decl anchor drift in %s" % p
    assert t.count(A_FIRE) == 1, "fire anchor drift in %s" % p
    assert "step_site_buf" not in t, "already patched: %s" % p
    t = t.replace(A_DECL, A_DECL + "\nchar step_site_buf[64];", 1)
    t = t.replace(A_FIRE, A_FIRE + COPY, 1)
    p.write_text(t)
def main():
    patch_rt(VENDOR / "runtime.h")
    co_p = VENDOR / "combined_off.c"
    patch_rt(co_p)
    co = co_p.read_text()
    assert "bm_resume" not in co, "combined already patched"
    spins = []
    for m in re.finditer(r"^static void (?:__attribute__\(\(used\)\) )?(\w+)\(void\) \{$", co, re.M):
        fname = m.group(1)
        start = m.end()
        nxt = co.find("\nstatic void ", start)
        body = co[start:nxt if nxt > 0 else len(co)]
        labs = set(re.findall(r"\b(\w+)_top:;", body))
        gotos = set(re.findall(r"goto (\w+)_top;", body))
        if fname in labs and fname in gotos:
            pro = body.split(fname + "_top:;")[0]
            stmts = [x.strip() for x in pro.strip().split(";") if x.strip()]
            assert not stmts, "non-empty prologue in " + fname
            spins.append(fname)
    assert len(spins) > 50, "spin census collapsed"
    for fname in spins:
        assert re.search(r"^static void " + fname + r"\(void\);", co, re.M), "no proto " + fname
    L = []
    L.append("static int streq_step(const char *a, const char *b) {")
    L.append("  int i = 0; while (a[i] && a[i] == b[i]) i++;")
    L.append("  return a[i] == b[i];")
    L.append("}")
    L.append("int bm_is_spin(void) {")
    for f in spins:
        L.append("  if (streq_step(step_site_buf, \"" + f + "\")) return 1;")
    L.append("  return 0;")
    L.append("}")
    L.append("void bm_resume(void) {")
    L.append("  in_nmi = 0;")
    for f in spins:
        L.append("  if (streq_step(step_site_buf, \"" + f + "\")) { " + f + "(); return; }")
    L.append("  __builtin_trap();")
    L.append("}")
    co_p.write_text(co + "\n" + "\n".join(L) + "\n")
    print("step patched: %d spins" % len(spins))
main()
