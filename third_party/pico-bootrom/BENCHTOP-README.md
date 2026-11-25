# RP2040 boot ROM source (revision B1)

The circuit simulator's Raspberry Pi Pico starts from the RP2040's boot ROM,
which Benchtop carries in `src/lib/circuit/pico-bootrom.ts` (the B1 image as
rp2040js's demo includes it). This folder is the source of that image:
https://github.com/raspberrypi/pico-bootrom at commit
00a4a19114195e20fb817bdfbca1165e157eef37 ("B1 changes"), without its
`pico_sdk` submodule (https://github.com/raspberrypi/pico-sdk, BSD-3-Clause).

Licences:

- Everything here except `bootrom/mufplib.S` and `bootrom/mufplib-double.S`:
  BSD-3-Clause, Copyright (c) 2020 Raspberry Pi (Trading) Ltd. (`LICENSE.TXT`).
- `bootrom/mufplib.S` and `bootrom/mufplib-double.S`, the floating-point
  routines by Mark Owen: Raspberry Pi's licence covers use only on an RP2040
  chip, so Benchtop, which runs them in an emulator, uses them under the GNU
  General Public License version 2, under which their author also offers
  them (`COPYING-GPL-2.0.txt`).

The boot ROM is a separate program that runs inside the emulated chip; the
rest of Benchtop stays under the MIT licence.
