import os, json, hashlib, shutil, zipfile, subprocess
P = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe'
SRC = os.path.join(P, 'frontend', 'dist', 'www')
STAGE = os.path.join(P, 'frontend', 'dist', 'page-stage')
OUTZIP = os.path.join(P, 'frontend', 'dist', 'page.zip')
EXCL_DIRS = ()
EXCL_FILES = {'sw.js', 'manifest.webmanifest'}
Q = chr(34)
N = chr(10)
def sha(b):
    return hashlib.sha256(b).hexdigest()
def rd(rel):
    f = open(os.path.join(SRC, rel), 'rb')
    d = f.read()
    f.close()
    return d
def wr(dst, data):
    d = os.path.dirname(dst)
    if not os.path.isdir(d):
        os.makedirs(d)
    f = open(dst, 'wb')
    f.write(data)
    f.close()
idx = rd('index.html').decode('utf-8')
MESEN_TAG = '<script src=' + Q + 'src/core/mesen/mesen.js' + Q + '></script>'
MESEN_OPT = '<option value=' + Q + 'mesen' + Q + '>Mesen (accurate)</option>'
MANIFEST_LINK = '<link rel=' + Q + 'manifest' + Q + ' href=' + Q + 'manifest.webmanifest' + Q + '>'
SW_MARK = '// In-app origins (WebView wrapper)'
assert MESEN_TAG in idx, 'mesen-tag-moved'
assert MESEN_OPT in idx, 'mesen-option-moved'
assert MANIFEST_LINK in idx, 'manifest-link-moved'
assert SW_MARK in idx, 'sw-block-moved'
si = idx.find(SW_MARK)
s0 = idx.rfind('<script>', 0, si)
e0 = idx.find('</script>', si) + len('</script>')
assert s0 >= 0 and e0 > si, 'sw-block-bounds'
app = rd('src/app.js').decode('utf-8')
WASM_Q = Q + 'build/game.wasm' + Q
STORE_LINE = 'import { savePack, loadPack, wipeAll, loadRomId } from ' + Q + './pack/store.js' + Q + ';'
assert WASM_Q in app, 'wasm-path-moved'
assert STORE_LINE in app, 'store-import-moved'
assert app.count(WASM_Q) == 15, 'wasm-count-changed'
prf = rd('src/ui/prefs.js').decode('utf-8')
ENG = 'const ENGINES = [' + Q + 'wasm' + Q + ', ' + Q + 'mesen' + Q + '];'
assert ENG in prf, 'engines-moved'
rep = rd('src/ui/report.js').decode('utf-8')
PKG = 'fetch(' + Q + 'PACKAGING.json' + Q + ')'
assert PKG in rep, 'packaging-fetch-moved'
NOSW = '<script>' + N + '// Generator-page build: no service worker, no manifest.' + N + '// Perchance serves src/ files itself; the app is fully local.' + N + 'window.__INAPP = false;' + N + '</script>'
idx2 = idx.replace(MANIFEST_LINK, '')
idx2 = idx2[:s0] + NOSW + idx2[e0:]
idx2 = idx2  # 0.2.41 keep mesen tag
idx2 = idx2  # 0.2.41 keep mesen option
assert MESEN_TAG in idx2, 'mesen-tag-lost'
assert 'manifest.webmanifest' not in idx2, 'manifest-left'
assert 'value=' + Q + 'wasm' + Q + '>WASM port' in idx2, 'wasm-option-lost'
BM_ADD = N + '// Generator-page base (set by the page wrapper via window.__BM_BASE).' + N + 'const BM_BASE = (typeof window !== ' + Q + 'undefined' + Q + ' && window.__BM_BASE) || ' + Q + Q + ';' + N
app2 = app.replace(STORE_LINE, STORE_LINE + BM_ADD, 1)
WASM_NEW = '(BM_BASE + ' + Q + 'build/game.wasm' + Q + ')'
app3 = app2.replace(WASM_Q, WASM_NEW)
assert app3.count(WASM_Q) == app3.count(WASM_NEW), 'wasm-wrap'
assert app3.count(WASM_NEW) == 15, 'wasm-new-count'
prf2 = prf  # 0.2.41 both engines on the page
PKG_NEW = 'fetch((typeof window !== ' + Q + 'undefined' + Q + ' && window.__BM_BASE || ' + Q + Q + ') + ' + Q + 'PACKAGING.json' + Q + ')'
rep2 = rep.replace(PKG, PKG_NEW)
assert PKG not in rep2, 'pkg-left'
if os.path.isdir(STAGE):
    shutil.rmtree(STAGE)
os.makedirs(STAGE)
names = []
for root, dirs, files in os.walk(SRC):
    for fn in sorted(files):
        full = os.path.join(root, fn)
        rel = os.path.relpath(full, SRC)
        if rel in EXCL_FILES:
            continue
        skip = False
        for d in EXCL_DIRS:
            if rel.startswith(d):
                skip = True
        if skip:
            continue
        names.append(rel)
names.sort()
OUT = {}
OUT['index.html'] = idx2.encode('utf-8')
OUT['src/app.js'] = app3.encode('utf-8')
OUT['src/ui/prefs.js'] = prf2.encode('utf-8')
OUT['src/ui/report.js'] = rep2.encode('utf-8')
for rel in names:
    if rel not in OUT:
        OUT[rel] = rd(rel)
manifest = {}
for rel in sorted(OUT.keys()):
    manifest[rel] = sha(OUT[rel])
    wr(os.path.join(STAGE, rel), OUT[rel])
rev = subprocess.check_output(['git', '-C', os.path.join(P, 'frontend'), 'rev-parse', '--short', 'HEAD']).decode('utf-8').strip()
meta = {'page_from_git': rev, 'files': manifest}
wr(os.path.join(STAGE, 'MANIFEST.json'), json.dumps(meta, indent=1).encode('utf-8'))
zf = zipfile.ZipFile(OUTZIP, 'w', zipfile.ZIP_DEFLATED)
for rel in sorted(OUT.keys()) + ['MANIFEST.json']:
    zi = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
    zi.compress_type = zipfile.ZIP_DEFLATED
    f = open(os.path.join(STAGE, rel), 'rb')
    zf.writestr(zi, f.read())
    f.close()
zf.close()
z = open(OUTZIP, 'rb').read()
print('PAGEZIP rev=' + rev + ' files=' + str(len(OUT)) + ' zip_bytes=' + str(len(z)) + ' zip_sha256=' + sha(z))
