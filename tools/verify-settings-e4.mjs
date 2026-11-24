// E4: shell<->engine settings sync (prefs.js wrapper over the E2 core store).
// Run: node tools/verify-settings-e4.mjs  (from frontend/)
// Canonical store lives in the engine (bm_setting_get/set: 0 volume 0-10,
// 1 mute, 2 scale 0-3 INTEGER/FIT/FILL/STRETCH, 3 filter 0-1 NEAREST/BILINEAR).
// prefs.js persists to localStorage and pushes on spawn; the per-frame shell
// tick (syncSettingsTick in app.js) pulls in-game menu edits back out.
// Shell controls ALWAYS work (never enhanced-gated); the in-game SETTINGS
// menu requires enhancements on (engine gate in pad_fn/menu_tick).
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
globalThis.localStorage = { _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); } };
import { PREF_DEFAULTS, loadPrefs, savePrefs, SCALE_ORDER, FILTER_ORDER,
  prefsToSettings, settingsToPrefs, pushPrefsToEngine, pullEngineToPrefs } from '../src/ui/prefs.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
const rom = new Uint8Array(readFileSync('/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
ok('stock pack builds', sb.ok);
const stock = sb.pack;
const WASMB = readFileSync('/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/frontend/build/game.wasm');
async function drive(o) {
  const inst = (await WebAssembly.instantiate(WASMB, { env: { host_frame: (f) => {
    const ex = win.exports;
    let pad = 0;
    for (const t of (o.taps || [])) if (f >= t.at && f < t.at + 8) pad = t.pad;
    ex.bm_set_pad(pad);
    if (o.onFrame) o.onFrame(ex, f);
    if (f + 1 >= o.span + 1) throw new Error('STOP');
  } } })).instance;
  const win = { exports: inst.exports };
  let trap = null;
  try {
    const mm = () => new Uint8Array(inst.exports.memory.buffer);
    const cat = (banks) => { const q = new Uint8Array(banks[0].length * banks.length); banks.forEach((bb, i) => q.set(bb, i * banks[0].length)); return q; };
    mm().set(cat(stock.prg), inst.exports.bm_stage_ptr()); inst.exports.bm_load_prg();
    mm().set(cat(stock.chr), inst.exports.bm_stage_ptr()); inst.exports.bm_load_chr();
    if (o.pre) o.pre(inst.exports);
    inst.exports.bm_boot();
  } catch (e) { if (e.message !== 'STOP') trap = String(e.message).slice(0, 80); }
  return { ex: inst.exports, trap: trap };
}
const blobOf = (ex) => {
  const mem = new Uint8Array(ex.memory.buffer);
  return Array.from(mem.slice(ex.bm_savestate_ptr(), ex.bm_savestate_ptr() + ex.bm_savestate_len()));
};
const rowText = (blob, r) => {
  let s = '';
  for (let c = 0; c < 32; c++) { const b = blob[2428 + r * 32 + c]; s += (b === 0 ? ' ' : String.fromCharCode(b)); }
  return s;
};
const findRow = (blob, t) => { for (let r = 0; r < 30; r++) if (rowText(blob, r).indexOf(t) >= 0) return r; return -1; };
ok('orders match E2 contract (scale INTEGER/FIT/FILL/STRETCH, filter NEAREST/BILINEAR)',
  JSON.stringify(SCALE_ORDER) === JSON.stringify(['integer','fit','fill','stretch']) &&
  JSON.stringify(FILTER_ORDER) === JSON.stringify(['nearest','bilinear']));
ok('engine->prefs->engine exact for all 176 combos', (() => {
  for (let v = 0; v <= 10; v++) for (let m = 0; m <= 1; m++)
    for (let s = 0; s <= 3; s++) for (let f = 0; f <= 1; f++) {
      const q = settingsToPrefs(v, m, s, f);
      const back = prefsToSettings({ volume: q.volume, muted: q.muted, scale: q.scale, filter: q.filter });
      if (back.volume !== v || back.mute !== m || back.scale !== s || back.filter !== f) return false;
    }
  return true;
})());
ok('prefs->engine quantization documented (0.8 exact, 0.05 rounds to 1, edges clamp)', (() => {
  const t = (vol) => prefsToSettings({ volume: vol, muted: false, scale: 'integer', filter: 'nearest' }).volume;
  return t(0.8) === 8 && t(0.05) === 1 && t(0) === 0 && t(1) === 10 && t(2) === 10 && t(-1) === 0 &&
    settingsToPrefs(1, 0, 0, 0).volume === 0.1;
})());
ok('invalid prefs sanitize (NaN volume->8, truthy mute, bogus scale/filter->0)', (() => {
  const s = prefsToSettings({ volume: NaN, muted: 1, scale: 'xx', filter: 'zz' });
  return s.volume === 8 && s.mute === 1 && s.scale === 0 && s.filter === 0;
})());
{
  const R = await drive({ span: 12 });
  const dflt = R.ex.bm_setting_get(0) === 8 && R.ex.bm_setting_get(1) === 0 &&
    R.ex.bm_setting_get(2) === 0 && R.ex.bm_setting_get(3) === 0;
  globalThis.localStorage._m.clear();
  const ps = prefsToSettings(loadPrefs());
  ok('defaults equal fresh engine defaults (8,0,0,0)', !R.trap && dflt &&
    ps.volume === 8 && ps.mute === 0 && ps.scale === 0 && ps.filter === 0, R.trap);
}
ok('push/pull no-op without engine exports (prefs untouched)', (() => {
  const q = { volume: 0.8, muted: false, scale: 'integer', filter: 'nearest' };
  const before = JSON.stringify(q);
  const r1 = pushPrefsToEngine({}, q);
  const r2 = pullEngineToPrefs({}, q);
  const r3 = pullEngineToPrefs({ bm_setting_get: () => undefined }, q);
  return r1 === false && r2 === false && r3 === false && JSON.stringify(q) === before;
})());
{
  const log = [];
  const R = await drive({ span: 40,
    onFrame: (ex, f) => {
      if (f === 10) {
        const okPush = pushPrefsToEngine(ex, { volume: 0.3, muted: true, scale: 'fill', filter: 'bilinear' });
        log.push('pushed=' + okPush);
      }
      if (f === 12) log.push('eng=' + ex.bm_setting_get(0) + ',' + ex.bm_setting_get(1) + ',' + ex.bm_setting_get(2) + ',' + ex.bm_setting_get(3));
      if (f === 20) { ex.bm_setting_set(0, 5); ex.bm_setting_set(2, 3); }
      if (f === 22) {
        const q = { volume: 0.3, muted: true, scale: 'fill', filter: 'bilinear' };
        const ch1 = pullEngineToPrefs(ex, q);
        const ch2 = pullEngineToPrefs(ex, q);
        log.push('pull=' + ch1 + ',' + ch2 + ' q=' + q.volume + ',' + q.muted + ',' + q.scale + ',' + q.filter);
      }
    } });
  ok('push writes all four into live engine', !R.trap && log.indexOf('pushed=true') >= 0 && log.indexOf('eng=3,1,2,1') >= 0, R.trap || log.join('|'));
  ok('engine-side edit pulls into shell prefs once (5/stretch, then stable)', !R.trap && log.some((x) => x === 'pull=true,false q=0.5,true,stretch,bilinear'), R.trap || log.join('|'));
}
{
  let booted = false;
  const log = [];
  const R = await drive({ span: 700,
    onFrame: (ex, f) => {
      if (booted) {
        if (f === 11) log.push('sticky=' + ex.bm_setting_get(0) + ',' + ex.bm_setting_get(1) + ',' + ex.bm_setting_get(2) + ',' + ex.bm_setting_get(3));
        return;
      }
      if (f === 10) { ex.bm_setting_set(0, 9); ex.bm_setting_set(1, 1); ex.bm_setting_set(2, 1); ex.bm_setting_set(3, 1); }
      if (f === 500) { booted = true; ex.bm_boot(); }
    } });
  ok('settings sticky across boot (guarded single-shot)', log.indexOf('sticky=9,1,1,1') >= 0, R.trap || log.join('|'));
}
{
  const app = readFileSync('/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/frontend/src/app.js', 'utf8');
  const handlers = ['prefs.scale = scaleSel.value', 'prefs.filter = filterSel.value',
    'ensureAudio().setVolume(prefs.volume)', 'prefs.muted = !prefs.muted'];
  const ungated = handlers.every((h) => {
    const i = app.indexOf(h); if (i < 0) return false;
    const region = app.slice(Math.max(0, i - 400), i + 200);
    return region.indexOf('enhanced') < 0 && region.indexOf('saving_on') < 0 && region.indexOf('bm_enhanced') < 0;
  });
  const pushes = handlers.every((h) => {
    const i = app.indexOf(h); if (i < 0) return false;
    return app.slice(i, i + 220).indexOf('pushSettingsToEngine') >= 0;
  });
  ok('shell controls always work (4 handlers ungated, all push live)', ungated && pushes);
  const owned = ['slotSel.addEventListener', 'engineSel.addEventListener', 'packSel.addEventListener',
    'touchInput.addEventListener', 'swapABInput.addEventListener', 'swapXYInput.addEventListener'];
  ok('frontend-owned prefs never enter the core (slot/engine/pack/touch/swap never push)', owned.every((h) => {
    const i = app.indexOf(h); if (i < 0) return false;
    let j = app.indexOf('.addEventListener', i + 25); if (j < 0) j = i + 900;
    const region = app.slice(i, j);
    return region.indexOf('pushSettingsToEngine') < 0 && region.indexOf('pullEngineToPrefs') < 0;
  }));
  const ticked = app.indexOf('syncSettingsTick()') >= 0 && app.indexOf('__settingsInst = l2host.inst; pushSettingsToEngine()') >= 0;
  ok('per-frame tick pushes on fresh spawn then pulls (one hook covers all spawns)', ticked);
}
{
  const c = readFileSync('/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe/frontend/src/core/bm_api.c', 'utf8');
  const padGate = c.indexOf('if (!enhanced_mode) { menu_prevpad') >= 0;
  const tickGate = c.indexOf('if (!enhanced_mode) {') >= 0;
  const writers = c.split('bm_setting_set(').length - 1;
  ok('in-game settings require enhancements (pad+tick gates, only menu_adjust writes)', padGate && tickGate && writers === 5, 'writers=' + writers);
}
{
  const R = await drive({ span: 800, taps: [{ at: 120, pad: 8 }],
    onFrame: (ex, f) => { if (f === 120) ex.bm_enhanced_set(0); } });
  const b = blobOf(R.ex);
  ok('enhanced off: no menu on title Start, stock new game', !R.trap && findRow(b, 'BLASTER MASTER') < 0 &&
    R.ex.bm_ram_rd(0xDD) === 2 && R.ex.bm_ram_rd(0x37E) === 5, R.trap || ('DD=' + R.ex.bm_ram_rd(0xDD)));
}
{
  const log = [];
  const R = await drive({ span: 400, taps: [{ at: 120, pad: 8 }, { at: 200, pad: 32 }, { at: 240, pad: 1 }, { at: 280, pad: 128 }],
    onFrame: (ex, f) => {
      if (f === 10) { ex.bm_enhanced_set(1); ex.bm_saving_set(0); }
      if (f === 260) log.push('sub=' + findRow(blobOf(ex), 'SETTINGS'));
      if (f === 300) {
        const v = ex.bm_setting_get(0);
        const q = { volume: 0.8, muted: false, scale: 'integer', filter: 'nearest' };
        const ch = pullEngineToPrefs(ex, q);
        log.push('vol=' + v + ' pull=' + ch + ',' + q.volume);
      }
    } });
  ok('enhanced on: SETTINGS opens, Right adjusts volume, shell pull sees 0.9', !R.trap &&
    log.indexOf('sub=4') >= 0 && log.indexOf('vol=9 pull=true,0.9') >= 0, R.trap || log.join('|'));
}
{
  globalThis.localStorage._m.clear();
  const src = { scale: 'fill', filter: 'bilinear', volume: 0.3, muted: true, slot: 3,
    engine: 'wasm', swapAB: true, swapXY: false, touch: true, pack: 'stock' };
  savePrefs(src);
  const back = loadPrefs();
  ok('savePrefs/loadPrefs round-trip preserves E4 fields', back.scale === 'fill' && back.filter === 'bilinear' &&
    back.volume === 0.3 && back.muted === true && back.slot === 3 && back.swapAB === true);
  globalThis.localStorage.setItem('bm-prefs-v1', '{{{corrupt');
  const dflt = loadPrefs();
  const clean = savePrefs({ scale: 'bogus', filter: 'bogus', volume: 5, muted: 0, slot: 99, engine: 'zz', pack: 'BAD!' });
  ok('corrupt storage + invalid values fall back to defaults', dflt.scale === 'integer' && dflt.volume === 0.8 &&
    clean.scale === 'integer' && clean.filter === 'nearest' && clean.slot === 8 && clean.pack === 'stock');
}
console.log('----');
console.log((fail === 0 ? 'E4 ALL ' + pass + ' CHECKS GREEN' : 'E4 FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
