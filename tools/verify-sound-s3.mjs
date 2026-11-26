// S3 song structure (bank-5 tracker bytecode): parse all 85 songs + editor wiring.
// Run: node tools/verify-sound-s3.mjs
import { readFileSync } from 'fs';
import { buildPack } from '../src/pack/builder.js';
import { SONG_PTR, STREAM, songPtr, songChannels, walkStream, parseSong, songLine } from '../src/pack/songs.js';
const PROJ = '/data/data/com.termux/files/home/storage/AiAgent/def7cmrvqe';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + (x ? ' :: ' + x : '')); } };
ok('lib ptr table', SONG_PTR.BANK === 5 && SONG_PTR.OFFSET === 1200 && SONG_PTR.COUNT === 85 && STREAM.LO === 0x8000 && STREAM.HI === 0xC000);
const rom = new Uint8Array(readFileSync(PROJ + '/work/roms-dev/blaster-master-usa.nes'));
const stock = buildPack(rom, 'ref.nes').pack;
const B5 = stock.prg[5];
ok('ptr alias', songPtr(B5, 0) === 0x983A && songPtr(B5, 6) === 0x983A && songPtr(B5, 84) >= 0x8000);
ok('ptr bad', songPtr(B5, 85) === -1 && songPtr(B5, -1) === -1 && songPtr(null, 0) === -1 && songPtr(new Uint8Array(10), 0) === -1);
const c6 = songChannels(B5, 6);
ok('song6 header', c6 !== null && c6.length === 4 && c6[0].slot === 0 && c6[1].slot === 1 && c6[0].stream === 0x9853 && c6[1].stream === 0x9A3D && c6[2].stream === 0x9C58 && c6[3].stream === 0x9ECC, JSON.stringify(c6.map((c) => c.stream.toString(16))));
let bad = 0, tn = 0, tl = 0, tg = 0, te = 0, inf = 0;
for (let id = 0; id < 85; id++) { const r = parseSong(B5, id); if (!r.ok) { bad++; console.log('BADSONG ' + id + ' ' + r.errors.join(' ').slice(0, 120)); continue; } tn += r.notes; tl += r.loops; tg += r.gosubs; te += r.ends; if (!r.ends) inf++; }
ok('all 85 parse', bad === 0, 'bad=' + bad);
ok('totals', tn === 5586 && tl === 415 && tg === 60 && te === 108, 'n=' + tn + ' l=' + tl + ' g=' + tg + ' e=' + te);
ok('infinite design', inf > 0, 'inf=' + inf);
const r6 = parseSong(B5, 6);
ok('song6 line', r6.ok && songLine(r6).indexOf('4ch') >= 0 && songLine(r6).indexOf('9853') >= 0);
const w = walkStream(B5, 0x9A3D);
ok('walk start-range', walkStream(B5, 0x7000).errors.length > 0 && w.notes > 10 && w.ends + 0 >= 0);
const ed = readFileSync(PROJ + '/frontend/src/ui/editor.js', 'utf8');
const hx = readFileSync(PROJ + '/frontend/index.html', 'utf8');
ok('ed browser', ed.includes('renderSongBrowser') && ed.includes('parseSong(base, id)') && ed.includes('edSongSel'));
ok('html browser', hx.includes('edSongSel') && hx.includes('edSongOut'));
console.log('---- s3: ' + pass + ' pass / ' + fail + ' fail ----');
if (fail) process.exit(1);
