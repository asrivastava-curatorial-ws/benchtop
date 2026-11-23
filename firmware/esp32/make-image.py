#!/usr/bin/env python3
"""Turns an ELF into an ESP32 image (the format the ROM loads from flash
offset 0x1000).  usage: make-image.py <in.elf> <out.bin>
SPDX-License-Identifier: MIT"""
import struct
import sys

elf = open(sys.argv[1], 'rb').read()
if elf[:4] != b'\x7fELF' or elf[4] != 1 or elf[5] != 1:
    sys.exit('not a 32-bit little-endian ELF')
entry, phoff = struct.unpack_from('<II', elf, 24)
phentsize, phnum = struct.unpack_from('<HH', elf, 42)
segments = []
for i in range(phnum):
    p_type, p_offset, p_vaddr, _, p_filesz, _, _, _ = struct.unpack_from('<8I', elf, phoff + i * phentsize)
    if p_type == 1 and p_filesz:
        data = elf[p_offset:p_offset + p_filesz]
        segments.append((p_vaddr, data + b'\0' * (-len(data) % 4)))

# Header: magic, segment count, SPI mode (DIO), 40 MHz / 4 MB flash, entry point;
# extended header: no WP pin, chip ESP32, no revision limits, no appended hash.
image = struct.pack('<BBBBI', 0xE9, len(segments), 2, 0x20, entry)
image += struct.pack('<B3sHBHH4sB', 0xEE, b'\0\0\0', 0, 0, 0, 0xFFFF, b'\0' * 4, 0)
checksum = 0xEF
for address, data in segments:
    image += struct.pack('<II', address, len(data)) + data
    for b in data:
        checksum ^= b
image += b'\0' * (15 - len(image) % 16) + bytes([checksum])
open(sys.argv[2], 'wb').write(image)
print(f'{sys.argv[2]}: {len(image)} bytes, {len(segments)} segments, entry {entry:#x}')
