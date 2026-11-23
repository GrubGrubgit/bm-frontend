// P0 custom-pack verification on device (uses reference ROM work/roms-dev/).
// Exercises REAL shipped code: buildPack, applyOverlay/validateCustomPack,
// GameHost.packGate/packTag, MesenHost._buildRomBytes, movie make/parse +
// verdict fns. The two inline gate mirrors (app.js replay gate, mesen save
// gate) copy the shipped conditions verbatim - disclosed, DOM-bound there.
import { readFileSync } from 'fs';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
const FE = PROJ + '/frontend';
const { buildPack } = await import('file://' + FE + '/src/pack/builder.js');
const OV = await import('file://' + FE + '/src/pack/overlay.js');
const MV = await import('file://' + FE + '/src/input/movie.js');
const { GameHost } = await import('file://' + FE + '/src/core/host.js');
const { MesenHost } = await import('file://' + FE + '/src/core/mesen_host.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function fnv(u8) { let h = 2166136261; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
// T1: stock pack from reference ROM
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const sb = buildPack(rom, 'blaster-master-usa.nes');
ok('T1 buildPack ok', sb.ok, (sb.errors||[]).join(' '));
const stock = sb.pack;
const stockCrc = stock.meta.crc32;
console.log('  stock crc32=' + stockCrc + ' md5=' + stock.meta.md5);
// T2: custom pack applies (PRG + CHR patches)
const prgPatchBytes = Uint8Array.from([0xDE,0xAD,0xBE,0xEF,0x01,0x02,0x03,0x04]);
const chrPatchBytes = Uint8Array.from([0x11,0x22,0x33,0x44]);
const custom = { customVersion: 1, id: 'c-p0verify', name: 'p0 verify', baseCrc: stockCrc,
  patches: [OV.makePatch('prg', 3, 0x200, prgPatchBytes), OV.makePatch('chr', 5, 0x10, chrPatchBytes)],
  editorVersion: 'p0test', builtAt: 'test' };
ok('T2a validateCustomPack ok', OV.validateCustomPack(custom).ok);
const stockPrgSnap = stock.prg.map(b => b.slice());
const r = OV.applyOverlay(stock, custom);
ok('T2b applyOverlay ok', r.ok, (r.errors||[]).join(' '));
const res = r.pack;
let prgHit = true; for (let i = 0; i < 8; i++) if (res.prg[3][0x200+i] !== prgPatchBytes[i]) prgHit = false;
let chrHit = true; for (let i = 0; i < 4; i++) if (res.chr[5][0x10+i] !== chrPatchBytes[i]) chrHit = false;
ok('T2c prg patch bytes land', prgHit);
ok('T2d chr patch bytes land', chrHit);
ok('T2e packIdOf custom', OV.packIdOf(res) === 'c-p0verify');
ok('T2f packCrcOf hex8', /^[0-9a-f]{8}$/i.test(OV.packCrcOf(res)) && OV.packCrcOf(res) !== stockCrc);
// T3: stock untouched
let untouched = true;
for (let i = 0; i < 8 && untouched; i++) for (let j = 0; j < 16384; j++) if (stock.prg[i][j] !== stockPrgSnap[i][j]) { untouched = false; break; }
ok('T3 stock banks untouched', untouched);
ok('T3b packIdOf stock', OV.packIdOf(stock) === 'stock');
// T4: refusals
const badBase = JSON.parse(JSON.stringify(custom)); badBase.baseCrc = 'deadbeef';
const rb = OV.applyOverlay(stock, badBase);
ok('T4a base-mismatch refused', !rb.ok && /base-mismatch/.test(rb.errors.join(' ')), rb.errors.join(' '));
ok('T4b overflow refused', !OV.validateCustomPack({customVersion:1,id:'c-x',name:'x',baseCrc:stockCrc,patches:[OV.makePatch('prg',0,16380,[1,2,3,4,5])]}).ok);
ok('T4c bad-area refused', !OV.validateCustomPack({customVersion:1,id:'c-x',name:'x',baseCrc:stockCrc,patches:[{area:'srm',bank:0,offset:0,bytes:OV.makePatch('prg',0,0,[9]).bytes}]}).ok);
ok('T4d empty refused', !OV.validateCustomPack({customVersion:1,id:'c-x',name:'x',baseCrc:stockCrc,patches:[OV.makePatch('chr',0,0,[])]}).ok);
ok('T4e bad-id refused', !OV.validateCustomPack({customVersion:1,id:'BAD ID!!',name:'x',baseCrc:stockCrc,patches:[]}).ok);
// T5+T6: engine spawn. Sync pattern copied from ~/warptest.mjs.
async function bootAndRun(prgBanks, chrBanks, frames) {
  const bytes = readFileSync(FE + '/build/game.wasm');
  let inst;
  const p = await WebAssembly.instantiate(bytes, { env: { host_frame: f => {
    const ex = inst.exports;
    ex.bm_set_pad(0);
    if (f + 1 >= frames) throw new Error('STOP');
  } } });
  inst = p.instance;
  const ex = inst.exports;
  const mem = () => new Uint8Array(ex.memory.buffer);
  const prg = new Uint8Array(8*16384), chr = new Uint8Array(16*8192);
  for (let i = 0; i < 8; i++) prg.set(prgBanks[i], i*16384);
  for (let j = 0; j < 16; j++) chr.set(chrBanks[j], j*8192);
  mem().set(prg, ex.bm_stage_ptr()); ex.bm_load_prg();
  mem().set(chr, ex.bm_stage_ptr()); ex.bm_load_chr();
  // readback of loaded banks via exported globals (proves consume path)
  const gv = g => (g && typeof g.value !== 'undefined') ? g.value : ((typeof g === 'number') ? g : null);
  const pa = gv(ex.prg), ca = gv(ex.chr);
  let loadedPrg = null, loadedChr = null;
  if (pa != null) loadedPrg = mem().slice(pa, pa + 8*16384);
  if (ca != null) loadedChr = mem().slice(ca, ca + 16*8192);
  try { ex.bm_boot(); } catch (e) { if (e.message !== 'STOP') throw e; }
  const trap = ex.bm_trap_flag() ? 1 : 0;
  const vp = ex.bm_video_ptr();
  const vhash = fnv(mem().slice(vp, vp + 256*240*4));
  const h0 = (ex.bm_hash() >>> 0).toString(16);
  return { trap, vhash, h0, loadedPrg, loadedChr };
}
const FR = 400;
const s1 = await bootAndRun(stock.prg, stock.chr, FR);
ok('T5 stock boot no-trap', s1.trap === 0, 'trap=' + s1.trap);
// CHR-modded pack: invert every CHR byte (render-visible, boot-safe)
const modChr = stock.chr.map(b => { const o = b.slice(); for (let i = 0; i < o.length; i++) o[i] ^= 0xFF; return o; });
const chrOnly = { customVersion: 1, id: 'c-chrboot', name: 'chr boot', baseCrc: stockCrc, patches: [], editorVersion: 't', builtAt: 't' };
// build 16 full-bank patches via makePatch (8192B each, within limits)
chrOnly.patches = modChr.map((b, j) => OV.makePatch('chr', j, 0, b));
const rc = OV.applyOverlay(stock, chrOnly);
ok('T6a chr-full overlay ok', rc.ok, (rc.errors||[]).join(' '));
const s2 = await bootAndRun(rc.pack.prg, rc.pack.chr, FR);
ok('T6b MODDED pack boot no-trap', s2.trap === 0, 'trap=' + s2.trap);
ok('T6c modded video differs (patch rendered)', s1.vhash !== s2.vhash, 'stock=' + s1.vhash + ' mod=' + s2.vhash);
// T5b: PRG load-path readback on the T2 resolved pack
const s3 = await bootAndRun(res.prg, res.chr, 30);
let prgEqual = false;
if (s3.loadedPrg) { prgEqual = s3.loadedPrg.length === 8*16384; if (prgEqual) for (let i = 0; i < 8 && prgEqual; i++) for (let j = 0; j < 16384; j++) if (s3.loadedPrg[i*16384+j] !== res.prg[i][j]) { prgEqual = false; break; } }
ok('T5b wasm loaded-PRGr == overlaid bytes', prgEqual, s3.loadedPrg ? ('len=' + s3.loadedPrg.length) : 'no prg global');
let chrEqual = false;
if (s3.loadedChr) { chrEqual = s3.loadedChr.length === 16*8192; if (chrEqual) for (let i = 0; i < 16 && chrEqual; i++) for (let j = 0; j < 8192; j++) if (s3.loadedChr[i*8192+j] !== res.chr[i][j]) { chrEqual = false; break; } }
ok('T5c wasm loaded-CHR == overlaid bytes', chrEqual, s3.loadedChr ? ('len=' + s3.loadedChr.length) : 'no chr global');
// T7: REAL GameHost pack gate on a spawned-engine-equivalent pack object
const fakeThis = new GameHost();
fakeThis.pack = res;
const tag = fakeThis.packTag();
ok('T7a packTag custom', tag.pack === 'c-p0verify' && tag.packCrc === OV.packCrcOf(res));
let threw = null;
try { fakeThis.packGate( { pack: 'stock', packCrc: stockCrc }); } catch (e) { threw = e; }
ok('T7b save under other pack throws pack-mismatch', !!threw && /pack-mismatch/.test(threw.message), String(threw && threw.message));
let threw2 = 'no-call';
try { fakeThis.packGate( { pack: tag.pack, packCrc: tag.packCrc }); threw2 = null; } catch (e) { threw2 = e; }
ok('T7c save under same pack passes', threw2 === null, String(threw2 && threw2.message));
let threw3 = 'no-call';
try { fakeThis.packGate( { pack: 'unknown' }); threw3 = null; } catch (e) { threw3 = e; }
ok('T7d legacy unknown pack passes', threw3 === null);
// T8: REAL MesenHost ROM rebuild consumes the overlay
const rebuilt = MesenHost.prototype._buildRomBytes.call({}, res);
let rok = rebuilt.length === 16 + 8*16384 + 16*8192 && rebuilt[0] === 0x4E && rebuilt[1] === 0x45;
const po = 16 + 3*16384 + 0x200;
for (let i = 0; i < 8 && rok; i++) if (rebuilt[po+i] !== prgPatchBytes[i]) rok = false;
const co = 16 + 8*16384 + 5*8192 + 0x10;
for (let i = 0; i < 4 && rok; i++) if (rebuilt[co+i] !== chrPatchBytes[i]) rok = false;
ok('T8 mesen rebuilt ROM carries overlay bytes', rok, 'len=' + rebuilt.length);
// T9: movie pack fields + replay gate (verbatim app.js:1350-1353 condition)
function replayPackGate(m, ap) {
  if (m.pack && m.pack !== 'unknown') {
    if (m.pack !== ap.id || (m.packCrc && m.packCrc !== 'unknown' && m.packCrc !== ap.crc))
      throw new Error('pack-mismatch movie=' + m.pack + ' active=' + ap.id + ' (switch to the matching custom pack?)');
  }
}
const pads = Uint8Array.from([0,0,8,8,8,0,1,0]);
const movCustom = MV.parseMovie(MV.makeMovieV2(pads, stockCrc, { engine: 'wasm', pack: 'c-p0verify', packCrc: OV.packCrcOf(res) }));
const activeStock = { id: 'stock', crc: stockCrc };
let mt = null;
try { replayPackGate(movCustom, activeStock); } catch (e) { mt = e; }
ok('T9a replay custom-movie vs stock-active throws pack-mismatch', !!mt && /pack-mismatch/.test(mt.message), String(mt && mt.message));
let mt2 = 'no-call';
try { replayPackGate(movCustom, { id: 'c-p0verify', crc: OV.packCrcOf(res) }); mt2 = null; } catch (e) { mt2 = e; }
ok('T9b replay custom-movie vs same-active passes', mt2 === null);
const movV1 = { app: 'bm-movie', v: 1, rom: stockCrc, frame: pads.length, pads: MV.encodePads(pads) };
let mt3 = 'no-call';
try { replayPackGate(MV.parseMovie(movV1), activeStock); mt3 = null; } catch (e) { mt3 = e; }
ok('T9c legacy v1 movie passes (unverifiable)', mt3 === null);
ok('T9d romGateVerdict', MV.romGateVerdict(stockCrc, stockCrc) === 'ok' && MV.romGateVerdict('aa', stockCrc) === 'mismatch' && MV.romGateVerdict('unknown', stockCrc) === 'unverifiable');
ok('T9e sameEngineForAnchor', MV.sameEngineForAnchor('wasm','wasm') === true && MV.sameEngineForAnchor('mesen','wasm') === false);
// T10: mesen save-gate condition (verbatim mesen_host.js load lines)
function mesenSaveGate(data, pack) {
  if (data.v === 2 && data.pack != null && data.pack !== 'unknown') {
    var c0 = pack && pack.custom;
    var cur = c0 && c0.id ? { pack: String(c0.id), packCrc: String(c0.crc || 'unknown') } : { pack: 'stock', packCrc: String((pack && pack.meta && pack.meta.crc32) || 'unknown') };
    if (String(data.pack) !== cur.pack || (data.packCrc && data.packCrc !== 'unknown' && String(data.packCrc) !== cur.packCrc))
      throw new Error('pack-mismatch save=' + data.pack + ' active=' + cur.pack + ' (load the matching custom pack?)');
  }
}
let gt = null;
try { mesenSaveGate({ v: 2, pack: 'c-p0verify', packCrc: OV.packCrcOf(res) }, stock); } catch (e) { gt = e; }
ok('T10a mesen save custom vs stock-active throws', !!gt && /pack-mismatch/.test(gt.message));
let gt2 = 'no-call';
try { mesenSaveGate({ v: 2, pack: 'c-p0verify', packCrc: OV.packCrcOf(res) }, res); gt2 = null; } catch (e) { gt2 = e; }
ok('T10b mesen save custom vs same-active passes', gt2 === null);
console.log('----');
console.log('pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
