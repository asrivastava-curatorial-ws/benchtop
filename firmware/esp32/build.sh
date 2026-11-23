#!/bin/sh
# Builds the ESP32 demo firmware and writes src/lib/circuit/esp32-demo.ts.
# Needs Xtensa binutils (Debian and Ubuntu: apt install binutils-xtensa-lx106;
# the demo uses only instructions the ESP32's core shares with the ESP8266's).
# SPDX-License-Identifier: MIT
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
xtensa-lx106-elf-as --text-section-literals -o "$out/demo.o" "$here/demo.S"
xtensa-lx106-elf-ld -T "$here/demo.ld" -o "$out/demo.elf" "$out/demo.o"
python3 "$here/make-image.py" "$out/demo.elf" "$out/demo.bin"
node "$here/write-demo.mjs" "$here/demo.S" "$out/demo.bin" "$here/../../src/lib/circuit/esp32-demo.ts"
