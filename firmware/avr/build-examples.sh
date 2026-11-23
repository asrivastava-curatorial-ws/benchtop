#!/bin/sh
# Builds the example sketches with avr-gcc and Benchtop's small core, and
# writes src/lib/circuit/uno-examples.ts.  Needs gcc-avr and avr-libc.
#   sh firmware/avr/build-examples.sh
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
avr-g++ --version | head -n 1
for sketch in "$here"/examples/*.ino; do
  name="$(basename "$sketch" .ino)"
  avr-g++ -mmcu=atmega328p -DF_CPU=16000000UL -Os -std=gnu++11 -fno-exceptions -fno-threadsafe-statics \
    -ffunction-sections -fdata-sections -Wl,--gc-sections -I"$here" \
    -include "$here/benchtop.h" -x c++ "$sketch" -x c++ "$here/benchtop.cpp" -o "$work/$name.elf"
  avr-objcopy -O ihex -R .eeprom "$work/$name.elf" "$work/$name.hex"
  avr-size "$work/$name.elf" | tail -n 1
done
node "$here/write-examples.mjs" "$here/examples" "$work" "$root/src/lib/circuit/uno-examples.ts"
