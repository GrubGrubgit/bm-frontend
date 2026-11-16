#!/usr/bin/env python3
"""Embed the device-local reference ROM as the shipped default (ROM-less boot)."""
import sys, binascii
rom = sys.argv[1]; out = sys.argv[2]
b = open(rom, 'rb').read()
assert b[:4] == b'NES\x1a', 'bad magic'
prg, ch = b[4], b[5]
assert (prg, ch) == (8, 16), 'need 8 PRG + 16 CHR, got %d+%d' % (prg, ch)
mapper = ((b[7] & 0xF0) | (b[6] >> 4))
assert mapper == 1, 'need mapper 1, got %d' % mapper
assert not (b[6] & 4), 'trainer unsupported'
exp = 16 + 8*16384 + 16*8192
assert len(b) == exp, 'size %d != %d' % (len(b), exp)
open(out, 'wb').write(b)
print('default ROM: %d bytes crc32=%08x prg8+chr16 mapper1' % (len(b), binascii.crc32(b) & 0xFFFFFFFF))
