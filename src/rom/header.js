// NES header parse (iNES + NES 2.0). Pure: no DOM, no I/O. Own code.
// bytes: Uint8Array of the whole ROM file. Never throws.
export function parseHeader(bytes) {
  const errors = [];
  const warnings = [];
  if (!(bytes instanceof Uint8Array)) errors.push("not-bytes");
  if (bytes.length < 16) { errors.push("too-short"); return { ok: false, errors, warnings }; }
  const magic = bytes[0] === 0x4E && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1A;
  if (!magic) { errors.push("bad-magic"); return { ok: false, errors, warnings }; }
  const prgUnits = bytes[4], chrUnits = bytes[5];
  const f6 = bytes[6], f7 = bytes[7];
  const nes2 = (f7 & 0x0C) === 0x08;
  let mapper = (f7 & 0xF0) | (f6 >> 4);
  if (nes2) mapper |= (bytes[8] & 0x0F) << 8;
  const fourScreen = (f6 & 0x08) !== 0;
  const mirror = fourScreen ? "4" : ((f6 & 0x01) ? "v" : "h");
  const battery = (f6 & 0x02) !== 0;
  const trainer = (f6 & 0x04) !== 0;
  if (prgUnits === 0) errors.push("no-prg");
  const prgSize = prgUnits * 16384;
  const chrSize = chrUnits * 8192;
  const headerLen = 16 + (trainer ? 512 : 0);
  const totalExpected = headerLen + prgSize + chrSize;
  if (bytes.length < totalExpected) errors.push("truncated");
  if (bytes.length > totalExpected) warnings.push("trailing-bytes:" + (bytes.length - totalExpected));
  const known = mapper === 1 && prgUnits === 8 && chrUnits === 16 && !trainer;
  if (!known) warnings.push("unknown-dump");
  return {
    ok: errors.length === 0, errors, warnings,
    format: nes2 ? "nes2" : "ines",
    prgUnits, chrUnits, prgSize, chrSize, headerLen, totalExpected,
    mapper, mirror, battery, trainer, known
  };
}
