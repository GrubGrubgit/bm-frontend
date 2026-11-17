import pathlib
BASE = "/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/frontend"
HOST = BASE + "/src/core/host.js"
APP = BASE + "/src/app.js"
NL = chr(10)
def rep(path, old, new, expect=1):
    s = pathlib.Path(path).read_text()
    c = s.count(old)
    assert c == expect, "anchor %d != %d in %s: %s" % (c, expect, path, old[:70])
    s = s.replace(old, new)
    pathlib.Path(path).write_text(s)
    print("ok %s" % old[:50])
# 1. host.js padWall accessor after frame()
rep(HOST,
    "GameHost.prototype.frame = function () { return this.consumed - this.f0; };",
    "GameHost.prototype.frame = function () { return this.consumed - this.f0; };" + NL + "GameHost.prototype.padWall = function () { try { if (this.inst && this.inst.exports.bm_pad_wall) return this.inst.exports.bm_pad_wall() >>> 0; } catch (e) {} return null; };")
# 2. app.js replayStepOnce live-W
old_step = "async function replayStepOnce() {" + NL + "  const m = replay.movie;" + NL + "  const base = m.version === 2 ? 0 : (replay.anchor.kind === \"save\" ? replay.anchor.frame : 0);" + NL + "  const idx = l2host.frame() - base;"
assert pathlib.Path(APP).read_text().count(old_step) == 1, "step anchor"
s = pathlib.Path(APP).read_text()
new_step = "async function replayStepOnce() {" + NL + "  const m = replay.movie;" + NL + "  const base = m.version === 2 ? 0 : (replay.anchor.kind === \"save\" ? replay.anchor.frame : 0);" + NL + "  const idx = l2host.frame() - base;" + NL + "  const useLiveW = (typeof l2host.padWall === \"function\" && m.engine !== \"wasm\");"
s = s.replace(old_step, new_step)
# replace the go line
old_go = "  const h = await Promise.race([l2host.go(1, m.pads[idx]), new Promise((rr, jj) => setTimeout(() => jj(new Error(\"go-stall\")), 2500))]);"
assert s.count(old_go) == 1, "go anchor"
new_go = "  let feedPad = m.pads[idx];" + NL + "  if (useLiveW) { const W = l2host.padWall(); if (W !== null && W !== undefined) { const fi = Math.min(W + 1, m.pads.length - 1); feedPad = m.pads[Math.max(0, fi)]; } }" + NL + "  const h = await Promise.race([l2host.go(1, feedPad), new Promise((rr, jj) => setTimeout(() => jj(new Error(\"go-stall\")), 2500))]);"
s = s.replace(old_go, new_go)
pathlib.Path(APP).write_text(s)
print("ok step")
# 3. app.js replayAdvanceTo live-W batching
old_adv = "async function replayAdvanceTo(targetFrame, anchorHash) {" + NL + "  const m = replay.movie;" + NL + "  const base = m.version === 2 ? 0 : (replay.anchor.kind === \"save\" ? replay.anchor.frame : 0);"
assert pathlib.Path(APP).read_text().count(old_adv) == 1, "adv anchor"
s = pathlib.Path(APP).read_text()
new_adv = old_adv + NL + "  const useLiveWAdv = (typeof l2host.padWall === \"function\" && m.engine !== \"wasm\");"
s = s.replace(old_adv, new_adv)
old_loop = "  while (l2host.frame() < targetFrame) {" + NL + "    const idx = l2host.frame() - base;" + NL + "    if (idx < 0 || idx >= m.pads.length) throw new Error(\"replay-range idx=\" + idx + \" f=\" + l2host.frame());" + NL + "    const q = m.pads[idx];" + NL + "    let j = idx + 1;" + NL + "    const want = targetFrame - l2host.frame();" + NL + "    while (j < m.pads.length && m.pads[j] === q && (j - idx) < want && (j - idx) < 600) j++;" + NL + "    await l2host.go(j - idx, q);"
assert s.count(old_loop) == 1, "loop anchor"
new_loop = "  while (l2host.frame() < targetFrame) {" + NL + "    const idx = l2host.frame() - base;" + NL + "    if (idx < 0 || idx >= m.pads.length) throw new Error(\"replay-range idx=\" + idx + \" f=\" + l2host.frame());" + NL + "    let q = m.pads[idx];" + NL + "    let advIdx = idx;" + NL + "    if (useLiveWAdv) { const W = l2host.padWall(); if (W !== null && W !== undefined) { advIdx = Math.max(0, Math.min(W + 1, m.pads.length - 1)); q = m.pads[advIdx]; } }" + NL + "    let j = advIdx + 1;" + NL + "    const want = targetFrame - l2host.frame();" + NL + "    while (j < m.pads.length && m.pads[j] === q && (j - advIdx) < want && (j - advIdx) < 600) j++;" + NL + "    await l2host.go(j - advIdx, q);"
s = s.replace(old_loop, new_loop)
pathlib.Path(APP).write_text(s)
print("ok adv")
print("liveW port ok")
