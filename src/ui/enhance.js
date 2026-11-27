// src/ui/enhance.js -- Enhancements panel (E5 engine-side entrance saves).
// Shell is persistence + toggles only: the Up-at-doorway detector, capture,
// prompt state machine and pause-while-prompt all live engine-side in
// src/core/bm_api.c (E5 section). This panel pushes the two gate flags
// (enhanced + saving), lists the 8 shared E1/E5 core slots from engine
// exports, and shuttles blobs between core memory and the IDB entrance
// store (per-pack namespace). No doorway matching here (the retired P4
// shell detector module is kept on disk for cross-check only). Slot map:
// shell 1..8 <-> engine 0..7. Wasm engine only.
import { saveEntrance, loadEntrance, saveVisits, loadVisits } from '../pack/store.js';
import { visitsHash } from '../pack/minimap.js';
const LS_KEY = 'bm-enhance-v1';
const MASTER_KEY = 'bm-enhance-master-v1';
const MAP_KEY = 'bm-enhance-map-v1';
function loadMapShow() {
  try { var o = JSON.parse(localStorage.getItem(MAP_KEY) || 'null'); if (o && ('show' in o)) return !!o.show; } catch (e) {}
  return true;
}
function storeMapShow(v) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify({ show: !!v })); } catch (e) {}
}
const SAVE_MAGIC = 0x424D5356;
function loadFlag() {
  try { return !!JSON.parse(localStorage.getItem(LS_KEY) || '{}').enabled; }
  catch (e) { return false; }
}
function storeFlag(v) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ enabled: !!v })); } catch (e) {}
}
function loadMaster() {
  try { return !!JSON.parse(localStorage.getItem(MASTER_KEY) || '{}').master; }
  catch (e) { return false; }
}
function storeMaster(v) {
  try { localStorage.setItem(MASTER_KEY, JSON.stringify({ master: !!v })); } catch (e) {}
}
function fnv1a32(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777219); }
  return h >>> 0;
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
export function buildEnhancePanel(env) {
  const log = env.log || (() => {});
  const anchor = document.getElementById('logEl');
  if (!anchor) { log('enhance: logEl missing'); return () => {}; }
  const st = {
    enabled: loadFlag(), master: loadMaster(), mapShow: loadMapShow(),
    pushedMaster: -1, pushedSaving: -1, pushedMap: -1, enableInp: null, mapInp: null, mapStat: null,
    listEl: null, packKey: null, refreshing: false,
    visitCache: null, visitCur: -2, visitTimer: 240, visitDirty: false, wasPregame: null, visitHash: null, syncSeq: 0,
  };
  const det = document.createElement('details');
  det.id = 'enhanceCtn';
  const sum = document.createElement('summary');
  sum.textContent = 'Enhancements (entrance saves, maps, wasm engine only)';
  sum.style.cssText = 'cursor:pointer;padding:8px;background:#223;font-size:16px';
  det.appendChild(sum);
  const mr = row(det);
  checkBox(mr, 'enhanced mode (master toggle for engine enhancements)', st.master, (v) => {
    st.master = v; storeMaster(v);
    log('enhance: enhanced mode ' + (v ? 'on' : 'off'));
    if (st.enableInp) st.enableInp.disabled = !v; if (st.mapInp) st.mapInp.disabled = !v;
    try { const h = env.host(); if (h && h.inst) { const ex = h.inst.exports; if (ex.bm_enhanced_set) { ex.bm_enhanced_set(v ? 1 : 0); st.pushedMaster = v ? 1 : 0; } } } catch (e) {}
  });
  const r = row(det);
  st.enableInp = checkBox(r, 'enable entrance saves (Up at doorways)', st.enabled, (v) => {
    st.enabled = v; storeFlag(v);
    log('enhance: entrance saves ' + (v ? 'on' : 'off'));
    try { const h = env.host(); if (h && h.inst) { const ex = h.inst.exports; if (ex.bm_saving_set) { ex.bm_saving_set(v ? 1 : 0); st.pushedSaving = v ? 1 : 0; } } } catch (e) {}
  });
  if (!st.master && st.enableInp) st.enableInp.disabled = true;
  const mapR = row(det);
  st.mapInp = checkBox(mapR, 'show minimap HUD while playing (full map: pause menu MAP row)', st.mapShow, (v) => {
    st.mapShow = v; storeMapShow(v);
    log('enhance: minimap ' + (v ? 'shown' : 'hidden'));
    try { const h = env.host(); if (h && h.inst) { const ex = h.inst.exports; if (ex.bm_map_show_set) { ex.bm_map_show_set(v ? 1 : 0); st.pushedMap = v ? 1 : 0; } } } catch (e) {}
  });
  if (!st.master && st.mapInp) st.mapInp.disabled = true;
  st.mapStat = document.createElement('div');
  st.mapStat.style.cssText = 'font-size:12px;color:#9c9';
  st.mapStat.id = 'mapStat';
  st.mapStat.textContent = 'map: start the game for live status';
  det.appendChild(st.mapStat);
  const wr = row(det);
  const wlab = document.createElement('span');
  wlab.textContent = 'widescreen mode (later): ';
  wr.appendChild(wlab);
  const wchk = document.createElement('input');
  wchk.type = 'checkbox'; wchk.disabled = true; wchk.title = 'not yet implemented';
  wr.appendChild(wchk);
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12px;color:#888';
  hint.textContent = 'in-game: stand on a doorway and press Up to file a save (A saves, Down enters, B leaves). slots below shuttle between memory and this browser.';
  det.appendChild(hint);
  const listHead = document.createElement('div');
  listHead.style.cssText = 'font-size:12px;color:#9c9';
  listHead.textContent = 'entrance slots (memory + this browser, per pack):';
  det.appendChild(listHead);
  st.listEl = document.createElement('div');
  st.listEl.id = 'enhanceSlots';
  det.appendChild(st.listEl);
  anchor.before(det);
  function exOf() {
    try {
      const h = env.host();
      if (h && h.inst && h.inst.exports) return h.inst.exports;
    } catch (e) {}
    return null;
  }
  function tagOf() {
    try { return env.packTag(); } catch (e) { return { pack: 'stock', packCrc: 'unknown' }; }
  }
  function memSlot(ex, s) {
    try {
      if (!ex || !ex.bm_sram_info) return null;
      if (ex.bm_sram_info(s, 0) !== 1) return null;
      return { area: ex.bm_sram_info(s, 1), x: ex.bm_sram_info(s, 2), y: ex.bm_sram_info(s, 3), frame: ex.bm_sram_info(s, 4) };
    } catch (e) { return null; }
  }
  async function doExport(n) {
    const ex = exOf();
    if (!ex) { log('enhance: start the game first (wasm)'); return; }
    const s = n - 1;
    let ptr = 0, len = 0;
    try { ptr = ex.bm_sram_blob_ptr(s); len = ex.bm_sram_blob_len(s); } catch (e) { ptr = 0; }
    if (!ptr || !len) { log('enhance: memory slot ' + n + ' empty'); return; }
    if (len < 64 || len > 8192) { log('enhance: bad memory blob length'); return; }
    const tag = tagOf();
    const mem = new Uint8Array(ex.memory.buffer);
    const bytes = Array.from(mem.slice(ptr, ptr + len));
    const mg = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
    if ((mg >>> 0) !== SAVE_MAGIC) { log('enhance: bad memory blob magic'); return; }
    const m = memSlot(ex, s) || { area: 0, x: 0, y: 0, frame: 0 };
    await saveEntrance(n, {
      v: 3, kind: 'entrance', engine: 'wasm',
      pack: tag.pack, packCrc: tag.packCrc,
      frame: m.frame, hash: '', area: m.area, x: m.x, y: m.y,
      savedAt: new Date().toISOString(), bytes,
    });
    log('enhance: exported memory slot ' + n + ' to browser (Area ' + m.area + ' ' + m.x + ',' + m.y + ')');
    refreshList().catch(() => {});
  }
  async function doImport(n) {
    const ex = exOf();
    if (!ex) { log('enhance: start the game first (wasm)'); return; }
    if (!ex.bm_thaw_staging_ptr || !ex.bm_sram_store) { log('enhance: engine too old for slot import'); return; }
    const tag = tagOf();
    const d = await loadEntrance(n, tag.pack);
    if (!d || d.v !== 3 || d.kind !== 'entrance') { log('enhance: browser slot ' + n + ' empty'); return; }
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
    const crc = fnv1a32(tag.packCrc && tag.packCrc !== 'unknown' ? tag.packCrc : tag.pack);
    const rc = ex.bm_sram_store(n - 1, crc);
    if (rc !== 0) { log('enhance: slot import rejected (' + rc + ')'); return; }
    log('enhance: imported browser slot ' + n + ' to memory (Area ' + d.area + ' ' + d.x + ',' + d.y + ')');
    refreshList().catch(() => {});
  }
  function readVisitBytes(ex) {
    try {
      if (!ex || !ex.bm_visit_ptr || !ex.memory) return null;
      var mem = new Uint8Array(ex.memory.buffer);
      return Array.from(mem.slice(ex.bm_visit_ptr(), ex.bm_visit_ptr() + 128));
    } catch (eR) { return null; }
  }
  function writeVisitBytes(ex, bytes) {
    try {
      if (!ex || !ex.bm_visit_reset || !ex.bm_visit_set) return false;
      ex.bm_visit_reset();
      for (var lv = 1; lv <= 16; lv++) for (var sc = 0; sc < 64; sc++) {
        if ((bytes[(lv - 1) * 8 + (sc >> 3)] >> (sc & 7)) & 1) {
          try { ex.bm_visit_set(lv, sc % 8, (sc / 8) | 0, 1); } catch (eS) {}
        }
      }
      return true;
    } catch (eW) { return false; }
  }
  async function syncVisits(reason) {
    var ex = exOf();
    if (!ex || !ex.bm_visit_ptr || !ex.bm_visit_set || !ex.bm_ram_rd) return;
    var seq = ++st.syncSeq;
    try {
      var tag = tagOf();
      var eng = readVisitBytes(ex);
      if (!eng) return;
      var rec = null;
      try { rec = await loadVisits(tag.pack); } catch (eL) { rec = null; }
      if (seq !== st.syncSeq) return;
      var idb = (rec && rec.v === 1 && rec.bytes && rec.bytes.length === 128) ? rec.bytes : null;
      var merged = new Array(128);
      var engDiff = false, idbDiff = false;
      for (var i = 0; i < 128; i++) {
        var m = eng[i] & 255;
        if (idb) m = m | (idb[i] & 255);
        merged[i] = m;
        if (m !== eng[i]) engDiff = true;
        if (!idb || m !== (idb[i] & 255)) idbDiff = true;
      }
      if (engDiff) writeVisitBytes(ex, merged);
      if (idbDiff || !idb) {
        try { await saveVisits(tag.pack, { v: 1, kind: 'visits', pack: tag.pack, packCrc: tag.packCrc, savedAt: new Date().toISOString(), bytes: merged }); } catch (eS2) {}
      }
      st.visitCache = merged;
      st.visitDirty = false;
    } catch (eG) {}
  }
  async function doLoad(n) {
    const ex = exOf();
    if (!ex || !ex.bm_sram_load || !ex.bm_sram_info) { log('enhance: engine too old for slot loads'); return; }
    let wasm = true;
    try { wasm = env.engine() === 'wasm'; } catch (e) { wasm = true; }
    if (!wasm) { log('enhance: loads need the wasm engine'); return; }
    const s = n - 1;
    if (ex.bm_sram_info(s, 0) !== 1) { log('enhance: memory slot ' + n + ' empty'); return; }
    const rc = ex.bm_sram_load(s, ex.bm_sram_info(s, 5));
    if (rc !== 1) { log('enhance: load rejected (' + rc + ')'); return; }
    log('enhance: loading memory slot ' + n + '...');
  }
  async function refreshList() {
    const el = st.listEl;
    if (!el || st.refreshing) return;
    st.refreshing = true;
    try {
      while (el.firstChild) el.removeChild(el.firstChild);
      const tag = tagOf();
      const ex = exOf();
      for (let n = 1; n <= 8; n++) {
        const rr = row(el);
        const m = ex ? memSlot(ex, n - 1) : null;
        let d = null;
        try { d = await loadEntrance(n, tag.pack); } catch (e) { d = null; }
        if (d && d.v !== 3) d = null;
        const lab = document.createElement('span');
        lab.style.cssText = 'font-size:12px';
        lab.textContent = 'slot ' + n + ': mem ' + (m ? ('Area ' + m.area + ' (' + m.x + ',' + m.y + ') f=' + m.frame) : 'empty') + ' / browser ' + (d ? ('Area ' + d.area + ' (' + d.x + ',' + d.y + ') f=' + d.frame) : 'empty') + ' ';
        rr.appendChild(lab);
        if (m) btn(rr, 'Load', () => { doLoad(n).catch((e) => log('enhance load err ' + String((e && e.message) || e).slice(0, 80))); });
        if (m) btn(rr, 'Mem->browser', () => { doExport(n).catch((e) => log('enhance export err ' + String((e && e.message) || e).slice(0, 80))); });
        if (d) btn(rr, 'Browser->mem', () => { doImport(n).catch((e) => log('enhance import err ' + String((e && e.message) || e).slice(0, 80))); });
      }
    } finally { st.refreshing = false; }
  }
  function updateMapStat(ex, bb) {
    if (!st.mapStat) return;
    try {
      var lv = 0, seen = 0;
      if (ex && ex.bm_ram_rd && bb) {
        var area = 0;
        try { area = ex.bm_ram_rd(20) & 15; } catch (eR3) {}
        lv = area < 8 ? area + 9 : area - 7;
        for (var i = 0; i < 8; i++) { var b = bb[(lv - 1) * 8 + i]; for (var k = 0; k < 8; k++) if (b & (1 << k)) seen++; }
      }
      var hud = 'n/a';
      try { if (ex && ex.bm_map_show_get) hud = ex.bm_map_show_get() ? 'on' : 'off'; } catch (eS) {}
      st.mapStat.textContent = 'map L' + lv + ': ' + seen + '/64 seen - HUD ' + hud + ' - full map: Start-pause, Select, MAP row';
    } catch (e) {}
  }
  function apply(ex) {
    try {
      try { if (ex.bm_enhanced_set && st.pushedMaster !== (st.master ? 1 : 0)) { ex.bm_enhanced_set(st.master ? 1 : 0); st.pushedMaster = st.master ? 1 : 0; } } catch (e) {}
      try { if (ex.bm_saving_set && st.pushedSaving !== (st.enabled ? 1 : 0)) { ex.bm_saving_set(st.enabled ? 1 : 0); st.pushedSaving = st.enabled ? 1 : 0; } } catch (e) {}
      try { if (ex.bm_map_show_set && st.pushedMap !== (st.mapShow ? 1 : 0)) { ex.bm_map_show_set(st.mapShow ? 1 : 0); st.pushedMap = st.mapShow ? 1 : 0; } } catch (e) {}
      let key = 'stock::unknown';
      try { const t = env.packTag(); key = String(t.pack) + '::' + String(t.packCrc); } catch (e) {}
      if (key !== st.packKey) { st.packKey = key; refreshList().catch(() => {}); syncVisits('pack'); try { if (ex && ex.bm_map_invalidate) ex.bm_map_invalidate(); } catch (eI) {} }
      try {
        if (ex && ex.bm_visit_cur && ex.bm_ram_rd) {
          var dd = 0, ce = 0;
          try { dd = ex.bm_ram_rd(221); ce = ex.bm_ram_rd(894); } catch (eR2) {}
          var pregame = (dd === 0 && ce === 0);
          if (st.wasPregame === true && !pregame) syncVisits('edge');
          st.wasPregame = pregame;
          if (pregame) { st.visitTimer = 240; updateMapStat(ex, null); }
          else {
            st.visitTimer--;
            if (st.visitTimer <= 0) {
              st.visitTimer = 240;
              var bb = readVisitBytes(ex);
              if (bb) {
                var hh = visitsHash(bb);
                if (hh !== st.visitHash) { st.visitHash = hh; st.visitCache = bb; syncVisits('timer'); }
              updateMapStat(ex, bb);
              }
            }
          }
        }
      } catch (eV) {}
    } catch (e) {}
  }
  refreshList().catch(() => {});
  return apply;
}
