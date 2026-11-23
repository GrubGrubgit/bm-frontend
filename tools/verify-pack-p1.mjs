// P1 headless tests: parse/serialize round-trip + relocation + overflow.
// Run: node tools/verify-pack-p1.mjs  (from frontend/)
import { readFileSync } from 'fs';
import { parseBank, serializeBank, BANK_LEVELS, mapLenOf } from '../src/pack/levels.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const bankOf = b => rom.slice(16 + b * 16384, 16 + (b + 1) * 16384);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
// Expected counts from the Data Crystal ROM map listing.
const EXPECT = { 1:[154,244,203],2:[152,142,160],3:[121,128,179],4:[131,182,158],5:[130,159,184],6:[104,193,202],7:[122,177,206],8:[133,149,254],9:[76,124,136],11:[90,99,114],13:[112,112,128],10:[75,124,108],14:[73,112,120],16:[75,136,144],12:[94,132,108],15:[92,116,152] };
const parsed = {};
for (const b of [0,1,2]) {
  const p = parseBank(bankOf(b), b);
  ok('parse bank' + b, p.ok, (p.errors||[]).join(' '));
  if (!p.ok) continue;
  parsed[b] = p;
  for (const L of p.levels) {
    const e = EXPECT[L.level];
    ok('L'+L.level+' counts '+L.nCombo+'/'+L.nStruct+'/'+L.nBlock, L.nCombo===e[0]&&L.nStruct===e[1]&&L.nBlock===e[2], 'want '+e);
    ok('L'+L.level+' maplen', L.map.length===mapLenOf(L.level));
  }
  const s = serializeBank(p, null);
  ok('bank'+b+' round-trip identical', s.ok && s.bytes.length===16384 && s.bytes.every((v,i)=>v===bankOf(b)[i]), (s.errors||[]).join(' '));
  // re-parse of serialized == same model
  const p2 = parseBank(s.bytes, b);
  let same = p2.ok && p2.levels.length===p.levels.length;
  if (same) for (let i=0;i<p.levels.length;i++) {
    const a=p.levels[i], c=p2.levels[i];
    same = same && a.nCombo===c.nCombo && a.nStruct===c.nStruct && a.nBlock===c.nBlock;
  }
  ok('bank'+b+' re-parse stable', same);
}
// Grow test (bank1 L9, 2005B free): +8 combos/attrs, +4 structs, +4 blocks
{
  const p = parsed[1];
  const L9 = p.levels.find(l=>l.level===9);
  const add = new Uint8Array([7,7,7,7, 8,8,8,8, 9,9,9,9, 10,10,10,10, 11,11,11,11, 12,12,12,12, 13,13,13,13, 14,14,14,14]);
  const nb = new Uint8Array(L9.combos.length + add.length); nb.set(L9.combos); nb.set(add, L9.combos.length);
  const na = new Uint8Array(L9.attrs.length + 8); na.set(L9.attrs); na.fill(0x83, L9.attrs.length); // solid combo
  const ns = new Uint8Array(L9.structs.length + 16); ns.set(L9.structs);
  const nk = new Uint8Array(L9.blocks.length + 16); nk.set(L9.blocks);
  const s = serializeBank(p, { 9: { combos: nb, attrs: na, structs: ns, blocks: nk } });
  ok('grow serializes', s.ok, (s.errors||[]).join(' '));
  if (s.ok) {
    const q = parseBank(s.bytes, 1);
    const Q9 = q.levels.find(l=>l.level===9);
    ok('grow re-parse counts', q.ok && Q9.nCombo===L9.nCombo+8 && Q9.nStruct===L9.nStruct+4 && Q9.nBlock===L9.nBlock+4, q.ok?('got '+Q9.nCombo+'/'+Q9.nStruct+'/'+Q9.nBlock):(q.errors||[]).join(' '));
    let hit = true;
    for (let i=0;i<add.length;i++) if (s.bytes[Q9.ptrs.combo+L9.combos.length+i]!==add[i]) hit=false;
    ok('grown bytes land', hit);
    // compact path moves offsets: other levels' CONTENT must be identical
    let othersSame = true;
    for (const L of p.levels) {
      if (L.level===9) continue;
      const Q = q.levels.find(x=>x.level===L.level);
      for (const k of ['pal','attrs','combos','structs','blocks','map','scroll']) {
        const a=L[k], c=Q[k];
        if (a.length!==c.length) { othersSame=false; break; }
        for (let i=0;i<a.length;i++) if (a[i]!==c[i]) { othersSame=false; break; }
      }
    }
    ok('other levels content preserved', othersSame);
  }
}
// Shrink test: L8 drop last 10 combos/attrs -> compact path -> re-parse stable
{
  const p = parsed[1];
  const L8 = p.levels.find(l=>l.level===8);
  const nc = L8.combos.slice(0, L8.combos.length-40);
  const na = L8.attrs.slice(0, L8.attrs.length-10);
  const s = serializeBank(p, { 8: { combos: nc, attrs: na } });
  ok('shrink serializes', s.ok, (s.errors||[]).join(' '));
  if (s.ok) {
    const q = parseBank(s.bytes, 1);
    const Q8 = q.levels.find(l=>l.level===8);
    ok('shrink re-parse stable', q.ok && Q8.nCombo===L8.nCombo-10, q.ok?('got '+Q8.nCombo):(q.errors||[]).join(' '));
    const s2 = serializeBank(q, null);
    ok('shrink output round-trips', s2.ok && s2.bytes.every((v,i)=>v===s.bytes[i]));
  }
}
// Overflow test: absurd combo table must fail with no bytes
{
  const p = parsed[2];
  const L13 = p.levels.find(l=>l.level===13);
  const big = new Uint8Array(60000*4);
  const s = serializeBank(p, { 13: { combos: big, attrs: new Uint8Array(60000) } });
  ok('overflow refused', !s.ok && /overflow/.test(s.errors.join(' ')) && !s.bytes, (s.errors||[]).join(' '));
}
// Count-mismatch test: combos not 4x attrs
{
  const p = parsed[0];
  const L1 = p.levels[0];
  const s = serializeBank(p, { 1: { combos: L1.combos.slice(0, 8) } });
  ok('count mismatch refused', !s.ok && /combo-attr-count/.test(s.errors.join(' ')));
}

// Write-back loop: edited bank -> diff vs stock -> patches -> custom pack
// -> applyOverlay -> re-parse resolved pack == edited model.
{
  const { buildPack } = await import('../src/pack/builder.js');
  const OV = await import('../src/pack/overlay.js');
  const ED = await import('../src/ui/editor.js');
  const sb = buildPack(rom, 'ref.nes');
  ok('wb stock pack builds', sb.ok);
  const stock = sb.pack;
  const p = parseBank(stock.prg[0], 0);
  const L1 = p.levels[0];
  const m = L1.map.slice(); m[100] = 7; m[101] = 8;
  const na = L1.attrs.slice(); na[3] ^= 0x80; // flip solid on combo 3
  const s = serializeBank(p, { 1: { map: m, attrs: na } });
  ok('wb serializes', s.ok, (s.errors||[]).join(' '));
  const runs = ED.diffRuns(stock.prg[0], s.bytes);
  ok('wb diff small', runs.length > 0 && runs.length < 20, 'runs='+runs.length);
  const patches = runs.map(r => OV.makePatch('prg', 0, r.off, r.bytes));
  // put combos/attrs edits in too via full-bank check: attrs run covered
  const doc = { customVersion: 1, id: 'c-wbtest', name: 'wb', baseCrc: stock.meta.crc32, patches, editorVersion: 'p1test', builtAt: 't' };
  ok('wb custom validates', OV.validateCustomPack(doc).ok);
  const r = OV.applyOverlay(stock, doc);
  ok('wb overlay applies', r.ok, (r.errors||[]).join(' '));
  if (r.ok) {
    const q = parseBank(r.pack.prg[0], 0);
    const Q1 = q.levels[0];
    ok('wb round-trips through pack', q.ok && Q1.map[100]===7 && Q1.map[101]===8 && Q1.attrs[3]===na[3]);
    ok('wb pack id/crc', OV.packIdOf(r.pack)==='c-wbtest' && OV.packCrcOf(r.pack)!==stock.meta.crc32);
  }
}

console.log('----');
console.log('pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
