// src/ui/enhance.js -- Enhancements panel (P4 entrance saves).
// Built dynamically by app.js L6 wiring (no index.html change), modeled
// on tweaks.js. Saving is OPTIONAL (default off): with it enabled,
// standing on a dungeon/area doorway and pressing Up captures an
// exact-state snapshot and offers to file it in an entrance slot.
// Down still enters doors exactly as before. No passwords, ever:
// slots hold full frozen states (engine freeze/thaw proof in
// tools/verify-pack-p4.mjs). Wasm engine only (Mesen has no exports).
import { parseDoors, matchDoor } from '../pack/doors.js';
import { UP_MASK, createDetector, stepDetector, resetDetector } from '../pack/entrance.js';
import { saveEntrance, loadEntrance } from '../pack/store.js';
const LS_KEY = 'bm-enhance-v1';
const SAVE_MAGIC = 0x424D5356;
function loadFlag() {
  try { return !!JSON.parse(localStorage.getItem(LS_KEY) || '{}').enabled; }
  catch (e) { return false; }
}
function storeFlag(v) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ enabled: !!v })); } catch (e) {}
}
function row(parent, cls) {
  const d = document.createElement('div');
  d.className = cls || 'shellRow';
  parent.appendChild(d);
  return d;
}
function btn(parent, label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { try { onClick(); } catch (e) {} });
  parent.appendChild(b);
  return b;
}
function checkBox(parent, label, value, onSet) {
  const lab = document.createElement('label');
  const inp = document.createElement('input');
  inp.type = 'checkbox'; inp.checked = !!value;
  inp.addEventListener('change', () => onSet(!!inp.checked));
  lab.appendChild(inp);
  lab.appendChild(document.createTextNode(' ' + label));
  parent.appendChild(lab);
  return inp;
}
function packIdOf(pack) {
  try {
    if (pack && pack.custom && pack.custom.id) return String(pack.custom.id);
  } catch (e) {}
  return 'stock';
}
export function buildEnhancePanel(env) {
  const log = env.log || (() => {});
  const anchor = document.getElementById('logEl');
  if (!anchor) { log('enhance: logEl missing'); return () => {}; }
  const st = {
    enabled: loadFlag(), rows: null, packId: null,
    det: createDetector(6), pending: null, lastFrame: -1,
    atText: '', listEl: null, promptEl: null,
  };
  const det = document.createElement('details');
  det.id = 'enhanceCtn';
  const sum = document.createElement('summary');
  sum.textContent = 'Enhancements (entrance saves, wasm engine only)';
  sum.style.cssText = 'cursor:pointer;padding:8px;background:#223;font-size:16px';
  det.appendChild(sum);
  let r = row(det);
  checkBox(r, 'enable entrance saves (Up at doorways)', st.enabled, (v) => {
    st.enabled = v; storeFlag(v);
    log('enhance: entrance saves ' + (v ? 'on' : 'off'));
    if (!v) { st.pending = null; resetDetector(st.det); renderPrompt(); }
  });
  r = row(det);
  const wlab = document.createElement('span');
  wlab.textContent = 'widescreen mode (later): ';
  r.appendChild(wlab);
  const wchk = document.createElement('input');
  wchk.type = 'checkbox'; wchk.disabled = true; wchk.title = 'not yet implemented';
  r.appendChild(wchk);
  const atEl = document.createElement('div');
  atEl.id = 'enhanceAt';
  atEl.style.cssText = 'font-size:12px;color:#9c9';
  atEl.textContent = 'door: —';
  det.appendChild(atEl);
  st.promptEl = row(det);
  st.promptEl.id = 'enhancePrompt';
  renderPrompt();
  const listHead = document.createElement('div');
  listHead.style.cssText = 'font-size:12px;color:#9c9';
  listHead.textContent = 'entrance slots (per pack):';
  det.appendChild(listHead);
  st.listEl = document.createElement('div');
  st.listEl.id = 'enhanceSlots';
  det.appendChild(st.listEl);
  anchor.before(det);
  function setAt(t) { if (t !== st.atText) { st.atText = t; atEl.textContent = t; } }
  function renderPrompt() {
    const el = st.promptEl;
    while (el.firstChild) el.removeChild(el.firstChild);
    const p = st.pending;
    if (!p) {
      const s = document.createElement('span');
      s.style.cssText = 'font-size:12px;color:#888';
      s.textContent = st.enabled ? 'stand on a doorway and press Up to file a save' : 'enable above, then stand on a doorway and press Up';
      el.appendChild(s);
      return;
    }
    const s = document.createElement('span');
    s.textContent = 'Entrance: Area ' + p.area + ' (' + p.x + ',' + p.y + ') f=' + p.frame + ' ';
    el.appendChild(s);
    btn(el, 'Save to slot ' + p.slot, () => { doSave(p).catch((e) => log('enhance save err ' + String((e && e.message) || e).slice(0, 80))); });
    btn(el, 'Discard', () => { st.pending = null; renderPrompt(); log('enhance: discarded entrance capture'); });
  }
  async function doSave(p) {
    const tag = env.packTag();
    await saveEntrance(p.slot, {
      v: 3, kind: 'entrance', engine: 'wasm',
      pack: tag.pack, packCrc: tag.packCrc,
      frame: p.frame, hash: p.hash, area: p.area, x: p.x, y: p.y,
      savedAt: new Date().toISOString(), bytes: Array.from(p.bytes),
    });
    log('enhance: saved entrance slot ' + p.slot + ' (Area ' + p.area + ' ' + p.x + ',' + p.y + ')');
    st.pending = null; renderPrompt(); refreshList().catch(() => {});
  }
  async function doLoad(n) {
    const h = env.host();
    if (!h || !h.inst) { log('enhance: start the game first (wasm)'); return; }
    if (env.engine() !== 'wasm') { log('enhance: loads need the wasm engine'); return; }
    const ex = h.inst.exports;
    if (!ex.bm_thaw_staging_ptr || !ex.bm_savestate_len) { log('enhance: engine too old for entrance loads'); return; }
    const tag = env.packTag();
    const d = await loadEntrance(n, tag.pack);
    if (!d || d.v !== 3 || d.kind !== 'entrance') { log('enhance: slot ' + n + ' empty'); return; }
    if (d.engine && d.engine !== 'wasm') { log('enhance: slot engine ' + d.engine); return; }
    if (d.pack != null && d.pack !== 'unknown' && String(d.pack) !== tag.pack) { log('enhance: pack mismatch (save=' + d.pack + ' active=' + tag.pack + ')'); return; }
    if (d.packCrc && d.packCrc !== 'unknown' && String(d.packCrc) !== tag.packCrc) { log('enhance: pack rev mismatch'); return; }
    const bytes = Uint8Array.from(d.bytes || []);
    if (bytes.length < 64 || bytes.length > 8192) { log('enhance: bad save length'); return; }
    const mg = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
    if ((mg >>> 0) !== SAVE_MAGIC) { log('enhance: bad save magic'); return; }
    const mem = new Uint8Array(ex.memory.buffer);
    const tp = ex.bm_thaw_staging_ptr();
    mem.set(bytes, tp + 12);
    mem[tp + 8] = bytes.length & 255; mem[tp + 9] = (bytes.length >> 8) & 255;
    mem[tp + 10] = (bytes.length >> 16) & 255; mem[tp + 11] = (bytes.length >> 24) & 255;
    mem[tp] = 1;
    st.pending = null; resetDetector(st.det); renderPrompt();
    log('enhance: loading entrance slot ' + n + ' (Area ' + d.area + ' ' + d.x + ',' + d.y + ')...');
  }
  async function refreshList() {
    const el = st.listEl;
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    let tag = { pack: 'stock', packCrc: 'unknown' };
    try { tag = env.packTag(); } catch (e) {}
    for (let n = 1; n <= 8; n++) {
      const rr = row(el);
      let d = null;
      try { d = await loadEntrance(n, tag.pack); } catch (e) { d = null; }
      const lab = document.createElement('span');
      lab.style.cssText = 'font-size:12px';
      if (d && d.v === 3) lab.textContent = 'slot ' + n + ': Area ' + d.area + ' (' + d.x + ',' + d.y + ') f=' + d.frame + ' ';
      else lab.textContent = 'slot ' + n + ': empty ';
      rr.appendChild(lab);
      if (d && d.v === 3) {
        const nn = n;
        btn(rr, 'Load', () => { doLoad(nn).catch((e) => log('enhance load err ' + String((e && e.message) || e).slice(0, 80))); });
      }
    }
  }
  function ensureRows() {
    let pack = null;
    try { pack = env.pack(); } catch (e) { pack = null; }
    const pid = pack ? packIdOf(pack) : null;
    if (pid === st.packId) return;
    st.packId = pid; st.pending = null; resetDetector(st.det); renderPrompt();
    st.rows = null;
    try {
      if (pack && pack.prg && pack.prg[7]) {
        const pd = parseDoors(pack.prg[7]);
        if (pd.ok) st.rows = pd.rows;
      }
    } catch (e) { st.rows = null; }
    refreshList().catch(() => {});
  }
  function apply(ex) {
    try {
      let f = -1;
      try { f = env.frame(); } catch (e) { f = -1; }
      if (f >= 0 && f < st.lastFrame) {
        st.pending = null; resetDetector(st.det); st.lastFrame = f; renderPrompt();
      } else if (f >= 0) st.lastFrame = f;
      ensureRows();
      if (!st.enabled || !st.rows) { setAt('door: —'); return; }
      if (env.engine() !== 'wasm') { setAt('door: — (wasm only)'); return; }
      if (!ex.bm_pre_ptr || !ex.bm_savestate_ptr || !ex.bm_savestate_len) { setAt('door: — (engine too old)'); return; }
      const mem = new Uint8Array(ex.memory.buffer);
      const pp = ex.bm_pre_ptr();
      const area = mem[pp + 0x14] & 15, x = mem[pp + 0x49], y = mem[pp + 0x4B];
      const m = matchDoor(st.rows, area, x, y);
      let mask = 0;
      try { mask = env.pad() & 255; } catch (e) { mask = 0; }
      const up = (mask & UP_MASK) !== 0;
      const r = stepDetector(st.det, !!m, area, x, y, up);
      setAt(m ? ('door: Area ' + area + ' (' + x + ',' + y + ')' + (r.stable ? ' stable' : '')) : 'door: —');
      if (!r.prompt || !m) return;
      const sp = ex.bm_savestate_ptr(), sl = ex.bm_savestate_len();
      if (sl < 64 || sl > 8192) { log('enhance: bad freeze length'); return; }
      const snap = mem.slice(sp, sp + sl);
      const mg = snap[0] | (snap[1] << 8) | (snap[2] << 16) | (snap[3] << 24);
      if ((mg >>> 0) !== SAVE_MAGIC) { log('enhance: bad freeze magic'); return; }
      let h = 0;
      try { h = ex.bm_hash() >>> 0; } catch (e) { h = 0; }
      st.pending = { bytes: snap, area, x, y, frame: f, hash: h.toString(16), slot: env.slot() };
      renderPrompt();
      log('enhance: entrance captured (Area ' + area + ' ' + x + ',' + y + ') - Save or Discard above');
    } catch (e) { /* never break the frame */ }
  }
  refreshList().catch(() => {});
  return apply;
}

