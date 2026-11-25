#!/bin/sh
# A stand-in for arduino-cli in the desktop tests: it answers the questions Benchtop asks
# and says what it was asked to do, without touching any board.
case "$1 $2" in
  "version --json")
    echo '{"Application":"arduino-cli","VersionString":"1.0.0-standin"}'
    ;;
  "core list")
    echo '{"platforms":[{"id":"arduino:avr","installed_version":"1.8.6"}]}'
    ;;
  "board list")
    echo '{"detected_ports":[{"matching_boards":[{"name":"Arduino Uno","fqbn":"arduino:avr:uno"}],"port":{"address":"/dev/ttyFAKE0","label":"/dev/ttyFAKE0","protocol":"serial","protocol_label":"Serial Port (USB)"}},{"port":{"address":"192.168.1.9","protocol":"network"}}]}'
    ;;
  "compile --upload")
    echo "asked: $*"
    for last in "$@"; do :; done
    echo "sketch.ino: $(head -n 1 "$last/sketch.ino")"
    echo "Sketch uses 444 bytes. New upload port: /dev/ttyFAKE0"
    ;;
  "upload --fqbn")
    echo "asked: $*"
    for last in "$@"; do :; done
    echo "program starts with: $(head -c 1 "$last")"
    ;;
  *)
    echo "the stand-in does not know: $*" >&2
    exit 1
    ;;
esac
