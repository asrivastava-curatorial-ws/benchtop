#!/bin/sh
# Builds benchtop-esp32 (GPL-2.0-or-later) from lcgamboa's QEMU fork:
#   git clone -b picsimlab-esp32 https://github.com/lcgamboa/qemu qemu-lcgamboa
#   (configure and build qemu-system-xtensa in qemu-lcgamboa/build, as in
#    esp32-helper/README.md), then:
#   sh esp32-helper/build.sh /path/to/qemu-lcgamboa /path/to/output-folder
# The output folder receives benchtop-esp32 and the ESP32 ROM images it needs.
set -e
qemu="$(cd "$1" && pwd)"
out="$2"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
cd "$qemu/build"
compile="$(ninja -t commands qemu-system-xtensa | grep 'system_main.c.o' | grep -- ' -c ' | head -n 1)"
[ -n "$compile" ] || { echo "Build qemu-system-xtensa first." >&2; exit 1; }
# Same flags as QEMU's own main, for our main instead.
compile="$(printf '%s' "$compile" | sed -e "s# -o [^ ]*system_main.c.o# -o benchtop_esp32_main.o#" -e "s# -c [^ ]*system/main.c# -c $here/benchtop_esp32_main.c#" -e 's# -MD -MQ [^ ]* -MF [^ ]*##')"
eval "$compile"
link="$(ninja -t commands qemu-system-xtensa | tail -n 1)"
link="$(printf '%s' "$link" | sed -e 's# qemu-system-xtensa.p/system_main.c.o# benchtop_esp32_main.o#' -e "s#-o qemu-system-xtensa #-o $out/benchtop-esp32 #")"
eval "$link -lpthread"
strip "$out/benchtop-esp32" 2>/dev/null || true
cp "$qemu/pc-bios/esp32-v3-rom.bin" "$qemu/pc-bios/esp32-v3-rom-app.bin" "$out/"
echo "Built $out/benchtop-esp32"
