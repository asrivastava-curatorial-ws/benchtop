#!/bin/sh
# Builds benchtop-esp32 for the Linux installers: fetches lcgamboa's QEMU at a
# fixed commit, builds qemu-system-xtensa (release build, xtensa only),
# relinks it with Benchtop's main (build.sh) and copies the program and the
# ESP32 ROM images to the output folder.  With a second argument it also
# writes the complete source the program was built from, for the release.
#
#   sh esp32-helper/ci-build.sh src-tauri/resources/esp32 [benchtop-esp32-source.tar.xz]
#
# Needs git, gcc, perl, python3 (with venv), ninja, pkg-config and the
# development files of glib, libgcrypt, libfdt and libslirp.  On Debian and
# Ubuntu: apt install git build-essential perl python3-venv ninja-build
#   pkg-config libglib2.0-dev libgcrypt20-dev libfdt-dev libslirp-dev
# Set QEMU_WORK to keep the QEMU checkout and build between runs.
# SPDX-License-Identifier: GPL-2.0-or-later
set -eu
QEMU_REPO=https://github.com/lcgamboa/qemu
QEMU_COMMIT=885a6e7061fb70fac78a074a719423810bc19a17
here=$(cd "$(dirname "$0")" && pwd)
# Both paths are relative to where the script is run.  Make them absolute now:
# the build below changes directory, and relative paths would put the program
# and the archive inside the QEMU build folder instead.
mkdir -p "$1"
out=$(cd "$1" && pwd)
archive=${2:-}
case $archive in
  '' | /*) ;;
  *) archive="$(pwd)/$archive" ;;
esac
work=${QEMU_WORK:-$(mktemp -d)}
mkdir -p "$work"
if [ ! -d "$work/qemu/.git" ]; then
  git init -q "$work/qemu"
  git -C "$work/qemu" fetch -q --depth 1 "$QEMU_REPO" "$QEMU_COMMIT"
  git -C "$work/qemu" checkout -q FETCH_HEAD
fi
cd "$work/qemu"
mkdir -p build
cd build
if [ ! -f build.ninja ]; then
  # Every optional feature off, then only what the ESP32 machine needs.
  flags=$(../configure --help | perl -ne 'print if s/^  ([a-z][\w-]*) .*/\1/' | tail -n +2 | awk '{print "--disable-"$1}' ORS=' ')
  # shellcheck disable=SC2086
  ../configure --target-list=xtensa-softmmu --extra-cflags=-fPIC $flags --enable-tcg --enable-system --disable-werror --enable-gcrypt --enable-slirp
fi
ninja qemu-system-xtensa
sh "$here/build.sh" "$work/qemu" "$out"
[ -x "$out/benchtop-esp32" ] || { echo "benchtop-esp32 is missing from $out" >&2; exit 1; }
if [ -n "$archive" ]; then
  # The QEMU tree as built (with the subprojects meson fetched) and Benchtop's part.
  stage=$(mktemp -d)
  mkdir -p "$stage/benchtop-esp32-source"
  tar -C "$work/qemu" --exclude=./build --exclude=./.git -cf - . | tar -C "$stage/benchtop-esp32-source" -xf -
  mkdir -p "$stage/benchtop-esp32-source/benchtop"
  cp "$here"/*.c "$here"/*.sh "$here"/README.md "$stage/benchtop-esp32-source/benchtop/"
  tar -C "$stage" -cJf "$archive" benchtop-esp32-source
  rm -rf "$stage"
  echo "Wrote $archive"
fi
