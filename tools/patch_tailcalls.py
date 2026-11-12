# Build-time musttail patch (mechanical, audited).
# The lifter emits every 6502 branch/jump target as its own C function and
# every branch as a call immediately followed by return. Those nests are
# thousands deep per frame (e.g. the b7_LCACA/b7_LCAD2 scan ping-pong);
# native gcc collapses them via sibling-call optimization, but wasm32 needs
# real tail calls or the stack blows (~2MB peak vs ~1MB browser budget).
# This rewrites every tail-shaped lifted call into a musttail return-call,
# which lowers to wasm return_call. Shapes handled (all void(void) bN_*):
#  A. standalone call line immediately followed by a return line
#  B. same-line call + return:  { ...; bN_foo(); return; }
# musttail is strictly semantics-preserving (same entries/exits, same order);
# any site the compiler cannot tail-call FAILS THE BUILD instead of silently
# nesting. Real 6502 JSRs (call + S+=2 restore after) are untouched.
# Idempotent: re-running skips already-attributed returns.
import pathlib, sys
p = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'build/vendor/combined_off.c')
NL = chr(10)
DIGITS = '01234567'
ATTR = '__attribute__((musttail)) return '
def is_lifted(name):
    if len(name) < 4:
        return False
    if name[0] != 'b' or name[1] not in DIGITS or name[2] != '_':
        return False
    for ch in name:
        ok = ('a' <= ch <= 'z') or ('A' <= ch <= 'Z') or ('0' <= ch <= '9') or ch == '_'
        if not ok:
            return False
    if ' ' in name or '(' in name:
        return False
    return True
def boundary(ch):
    return ch == ';' or ch == '{' or ch == '}' or ch == ' ' or ch == '('
lines = p.read_text().split(NL)
out = []
nA = 0
nB = 0
i = 0
while i < len(lines):
    s = lines[i].strip()
    if (is_lifted(s[:-4]) and s.endswith('();') and ATTR not in lines[i]
            and i + 1 < len(lines) and lines[i+1].strip() == 'return;'):
        indent = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
        out.append(indent + ATTR + s)
        nA += 1
        i += 2
        continue
    ln = lines[i]
    start = 0
    changed = False
    while True:
        k = ln.find('(); return;', start)
        if k < 0:
            break
        j = k - 1
        while j >= 0 and (('a' <= ln[j] <= 'z') or ('A' <= ln[j] <= 'Z') or ('0' <= ln[j] <= '9') or ln[j] == '_'):
            j -= 1
        name = ln[j+1:k]
        rest = ln[k+len('(); return;'):].strip()
        if is_lifted(name) and (j < 0 or boundary(ln[j])) and (rest == '' or rest == '}'):
            if ATTR in ln and ln.find(ATTR) < k and ln.find(ATTR) + len(ATTR) + len(name) + 3 >= k:
                start = k + 1
                continue
            ln = ln[:j+1] + ATTR + name + '();' + ln[k+len('(); return;'):]
            nB += 1
            changed = True
            start = j + 1
        else:
            start = k + 1
    out.append(ln)
    i += 1
p.write_text(NL.join(out))
print('musttail shape A (split lines): ' + str(nA))
print('musttail shape B (same line): ' + str(nB))
leftover = 0
for j in range(len(out) - 1):
    a = out[j].strip()
    if is_lifted(a[:-4]) and a.endswith('();') and ATTR not in out[j] and out[j+1].strip() == 'return;':
        leftover += 1
        if leftover < 6:
            print('LEFTOVER A: ' + a)
for ln in out:
    start = 0
    while True:
        k = ln.find('(); return;', start)
        if k < 0:
            break
        if ATTR not in ln[:k+1]:
            j = k - 1
            while j >= 0 and (('a' <= ln[j] <= 'z') or ('A' <= ln[j] <= 'Z') or ('0' <= ln[j] <= '9') or ln[j] == '_'):
                j -= 1
            nm = ln[j+1:k]
            if is_lifted(nm):
                leftover += 1
                if leftover < 6:
                    print('LEFTOVER B: ' + ln.strip()[:90])
                break
        start = k + 1
print('leftover unattributed tail sites: ' + str(leftover))
assert leftover == 0, 'unattributed tail sites remain'
