// Debt-closure tests: pack-scoped slots, pack-tagged bug reports + status,
// export/import round-trip, free-space accounting, doorway hints.
// Run: node tools/verify-pack-debt.mjs (from frontend/)
import { readFileSync } from 'fs';
// ---- in-memory indexedDB fake (store.js only touches it at call time) ----
{
  const tables = new Map();
  const tbl = (n) => { if (!tables.has(n)) tables.set(n, new Map()); return tables.get(n); };
  const req = (result) => {
    const o = { result, onerror: null };
    let h = null;
    Object.defineProperty(o, 'onsuccess', { configurable: true,
      get() { return h; }, set(f) { h = f; if (f) queueMicrotask(() => f({ target: o })); } });
    return o;
  };
  const db = {
    close() {},
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: (sname) => ({ objectStore: (s2) => ({
      get: (k) => req(tbl(s2).has(k) ? tbl(s2).get(k) : undefined),
      put: (v, k) => { tbl(s2).set(k, v); return req(undefined); },
      delete: (k) => { tbl(s2).delete(k); return req(undefined); },
      clear: () => { tbl(s2).clear(); return req(undefined); },
      getAllKeys: () => req([...tbl(s2).keys()]),
    }) }),
  };
  globalThis.indexedDB = { open: () => {
    const o = { result: db };
    queueMicrotask(() => { try { o.onupgradeneeded && o.onupgradeneeded(); } catch (e) {} try { o.onsuccess && o.onsuccess(); } catch (e) {} });
    return o;
  } };
}
import { slotKeyFor, saveSlot, loadSlot } from '../src/pack/store.js';
import { parseBank, serializeBank, bankFreeBytes } from '../src/pack/levels.js';
import { buildPack } from '../src/pack/builder.js';
import * as OV from '../src/pack/overlay.js';
import { diffRuns, doorComboSet, screenHasDoor } from '../src/ui/editor.js';
import { buildBugReport } from '../src/ui/report.js';
import { fmtStatus } from '../src/ui/shell.js';
import { parseMovie } from '../src/input/movie.js';
import { GameHost } from '../src/core/host.js';
import { MesenHost } from '../src/core/mesen_host.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
// 1. key mapping (pure)
ok('key stock', slotKeyFor(3, 'stock') === 'slot-3::stock');
ok('key custom', slotKeyFor(1, 'c-abc123') === 'slot-1::c-abc123');
ok('key unknown->legacy', slotKeyFor(2, 'unknown') === 'slot-2');
ok('key missing->legacy', slotKeyFor(2) === 'slot-2');
ok('key unsafe->legacy', slotKeyFor(2, '../x') === 'slot-2');
// 2. scoped coexistence + isolation (fake IDB)
await saveSlot(1, { v: 2, engine: 'wasm', frame: 10, pack: 'stock', packCrc: 'AAA' });
await saveSlot(1, { v: 2, engine: 'wasm', frame: 20, pack: 'c-x', packCrc: 'BBB' });
const dStock = await loadSlot(1, 'stock'), dCustom = await loadSlot(1, 'c-x');
ok('scoped stock survives', dStock && dStock.frame === 10, JSON.stringify(dStock));
ok('scoped custom survives', dCustom && dCustom.frame === 20, JSON.stringify(dCustom));
ok('scoped other-pack miss', (await loadSlot(1, 'c-other')) === null);
// legacy fallback: pre-scope save (pack unknown -> legacy key) loads under any pack
await saveSlot(2, { v: 2, engine: 'wasm', frame: 30, pack: 'unknown', packCrc: 'unknown' });
ok('legacy fallback scoped', (await loadSlot(2, 'stock'))?.frame === 30);
ok('legacy fallback unscoped', (await loadSlot(2))?.frame === 30);
ok('slots isolated', (await loadSlot(3, 'stock')) === null);

// PART2 (appended): host wiring, gates, reports, status, pack round-trip, accounting, doors
// 3. host save writes scoped keys (stubbed hosts, fake IDB)
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'ref.nes');
const stock = sb.pack;
ok('stock pack builds', sb.ok);
const fakeWasm = Object.assign(Object.create(GameHost.prototype), { pack: stock, frame: () => 12, hash: () => 0xAB, audioTotal: 0, padLog: [0, 1, 2] });
const savedW = await GameHost.prototype.save.call(fakeWasm, 7);
ok('wasm save tags stock', savedW.pack === 'stock');
ok('wasm save reads back scoped', (await loadSlot(7, 'stock'))?.frame === 12);
ok('wasm save invisible to custom', (await loadSlot(7, 'c-x')) === null);
const customDoc = { customVersion: 1, id: 'c-debt', name: 'debt', baseCrc: stock.meta.crc32, patches: [], editorVersion: 't', builtAt: 't' };
const rr = OV.applyOverlay(stock, customDoc);
ok('empty overlay applies', rr.ok);
const fakeMes = { pack: rr.pack, mod: { _mesen_statesize: () => 4, _malloc: () => 0, _mesen_save: () => 1, HEAPU8: new Uint8Array(8), _free: () => {} }, frame: () => 9, hash: () => 0xCD, audioTotal: 0, padLog: [5, 6] };
const savedM = await MesenHost.prototype.save.call(fakeMes, 7);
ok('mesen save tags custom', savedM.pack === 'c-debt');
ok('mesen save reads back scoped', (await loadSlot(7, 'c-debt'))?.frame === 9);
ok('mesen save keeps stock slot', (await loadSlot(7, 'stock'))?.frame === 12);
// 4. pack gates still refuse cross-pack
let g1 = null;
try { GameHost.prototype.packGate.call(Object.assign(Object.create(GameHost.prototype), { pack: stock }), { pack: 'c-debt', packCrc: 'zzz' }); } catch (e) { g1 = e; }
ok('wasm gate refuses cross-pack', !!g1 && /pack-mismatch/.test(g1.message));
let g2 = 'no-call';
try { GameHost.prototype.packGate.call(Object.assign(Object.create(GameHost.prototype), { pack: rr.pack }), { pack: savedM.pack, packCrc: savedM.packCrc }); g2 = null; } catch (e) { g2 = e; }
ok('wasm gate passes same-pack', g2 === null);
// 5. bug reports carry pack (stock + custom)
const stubHost = { padLog: [0, 8, 128], frame: () => 3, inst: null, trapInfo: () => null };
const rep0 = await buildBugReport(stubHost, 'wasm', async () => ({ crc32: stock.meta.crc32 }), [], 'manual', { id: 'stock', crc: stock.meta.crc32 });
ok('report stock pack', rep0.pack === 'stock' && rep0.packCrc === stock.meta.crc32);
ok('report movie v2 pack', rep0.movie && rep0.movie.v === 2 && rep0.movie.pack === 'stock');
const rep1 = await buildBugReport(stubHost, 'mesen', async () => ({ crc32: stock.meta.crc32 }), [], 'manual', { id: 'c-debt', crc: OV.packCrcOf(rr.pack) });
ok('report custom pack', rep1.pack === 'c-debt' && rep1.packCrc === OV.packCrcOf(rr.pack));
ok('report movie parses', parseMovie(rep1.movie).pack === 'c-debt');
// 6. status line shows pack
const st = fmtStatus({ fps: 60, engineFrame: 3, audio: { ready: true, sampleRate: 44100 }, engine: 'wasm', scale: 'integer', filter: 'nearest', volume: 0.8, muted: false, slot: 1, running: true, paused: false, pack: 'c-debt' });
ok('status shows pack', st.includes('pack c-debt'), st);
// 7. export/import JSON round-trip on a real edited bank (P1 write path)
const p0 = parseBank(stock.prg[0], 0);
ok('parse bank0', p0.ok);
const L1 = p0.levels.find(l => l.level === 1);
const m = L1.map.slice(); m[100] = (m[100] + 1) % (L1.blocks.length / 4);
const es = serializeBank(p0, { 1: { map: m } });
ok('edited serializes', es.ok);
const runs = diffRuns(stock.prg[0], es.bytes);
ok('diff small', runs.length > 0 && runs.length < 20, 'runs=' + runs.length);
const patches = runs.map(r => OV.makePatch('prg', 0, r.off, r.bytes));
const doc = { customVersion: 1, id: 'c-roundtrip', name: 'rt', baseCrc: stock.meta.crc32, patches, editorVersion: 'debt-test', builtAt: 't' };
const json = JSON.stringify(doc); // export: file bytes
const back = JSON.parse(json);    // import: file picker text
ok('import validates', OV.validateCustomPack(back).ok);
const ap = OV.applyOverlay(stock, back);
ok('import applies', ap.ok);
const q = parseBank(ap.pack.prg[0], 0);
ok('import re-parse edit visible', q.ok && q.levels.find(l => l.level === 1).map[100] === m[100]);
ok('resolved crc moves', OV.packCrcOf(ap.pack) !== stock.meta.crc32);
const badBase = JSON.parse(JSON.stringify(doc)); badBase.baseCrc = 'deadbeef';
ok('wrong base refused', !OV.applyOverlay(stock, badBase).ok);
const badVer = JSON.parse(JSON.stringify(doc)); badVer.customVersion = 99;
ok('wrong version refused', !OV.validateCustomPack(badVer).ok);
// 8. free-space accounting
for (const b of [0, 1, 2]) {
  const pb = parseBank(stock.prg[b], b);
  ok('bank' + b + ' free>0', pb.ok && bankFreeBytes(pb) > 0, pb.ok ? String(bankFreeBytes(pb)) : 'parse-fail');
}
ok('free bank0=624', bankFreeBytes(parseBank(stock.prg[0], 0)) === 624);
ok('free bank1=2003', bankFreeBytes(parseBank(stock.prg[1], 1)) === 2003);
ok('free bank2=1471', bankFreeBytes(parseBank(stock.prg[2], 2)) === 1471);
// 9. doorway helpers on real levels
const doors1 = doorComboSet(L1);
ok('L1 has door combos', doors1.size > 0, 'n=' + doors1.size);
let doorScreens = 0, setScreens = 0;
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
  if (((L1.scroll[r] >> c) & 1) || ((L1.scroll[8 + r] >> c) & 1)) { setScreens++; if (screenHasDoor(L1, doors1, r, c)) doorScreens++; }
}
ok('L1 scroll screens seen', setScreens > 0, 'set=' + setScreens);
ok('L1 V door screens pinned', (() => { let d = 0, n = 0; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((L1.scroll[r] >> c) & 1) { n++; if (screenHasDoor(L1, doors1, r, c)) d++; } return d === 3 && n === 17; })(), 'want V 3/17');
const p1b = parseBank(stock.prg[1], 1);
const L9 = p1b.levels.find(l => l.level === 9);
ok('L9 overhead runs helper', L9 && typeof screenHasDoor(L9, doorComboSet(L9), 0, 0) === 'boolean');
console.log('----');
console.log('pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
