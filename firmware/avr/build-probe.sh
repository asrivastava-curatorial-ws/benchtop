#!/bin/sh
# Builds the Logic Probe sketch for the Arduino Uno with avr-gcc and Benchtop's
# small Arduino-style core, and writes src/lib/logic-probe.ts with the sketch and its HEX.
# Needs gcc-avr and avr-libc.
#   sh firmware/avr/build-probe.sh
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
avr-g++ --version | head -n 1
avr-g++ -mmcu=atmega328p -DF_CPU=16000000UL -Os -std=gnu++11 -fno-exceptions -fno-threadsafe-statics \
  -ffunction-sections -fdata-sections -Wl,--gc-sections -Wall -Wextra -I"$here/core" \
  -include "$here/core/Arduino.h" -x c++ "$here/logic-probe/logic-probe.ino" -x c++ "$here/core/core.cpp" -o "$work/probe.elf"
avr-objcopy -O ihex -R .eeprom "$work/probe.elf" "$work/probe.hex"
avr-size "$work/probe.elf" | tail -n 1
node "$here/write-probe.mjs" "$here/logic-probe/logic-probe.ino" "$work/probe.hex" "$root/src/lib/logic-probe.ts"
# The module is laid out as the rest of the code is.
(cd "$root" && npx biome format --write src/lib/logic-probe.ts >/dev/null)
