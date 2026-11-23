# benchtop-esp32

The Circuit Simulator runs ESP32 firmware in **benchtop-esp32**, a separate
program built from [lcgamboa's QEMU](https://github.com/lcgamboa/qemu) (QEMU
9.2.2 with Espressif's ESP32 machine and the hooks PICSimLab uses to connect
pins to a simulated circuit). Benchtop starts it, writes the firmware into a
4 MB flash image, and talks to it over standard input and output:

| Direction | Line | Meaning |
| --- | --- | --- |
| out | `R` | the machine is running |
| out | `P <pin> <0\|1>` | a pin's output level changed |
| out | `D <pin> <0\|1>` | a pin became an output (1) or an input (0) |
| out | `W <pin> <0-1000>` | a pin carries LEDC PWM at this duty, in tenths of a percent (`-1`: no longer) |
| out | `U <hex>` | a byte sent on UART0 |
| in | `I <pin> <0\|1>` | drive an input pin |
| in | `A <channel> <0-4095>` | set an ADC1 channel's reading |
| in | `S <hex bytes>` | bytes received on UART0 |
| in | `Q` | quit |

Pins are numbered in the order of Benchtop's ESP32 board: GPIO 2, 4, 5, 12,
13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36 and 39.
The emulated ESP32 runs in real time, so the circuit around it does too.

## Building

The Linux release job runs `ci-build.sh`, which fetches the QEMU fork at a
fixed commit, builds `qemu-system-xtensa` and relinks it with
`benchtop_esp32_main.c` in place of QEMU's own `main`:

```sh
sudo apt install git build-essential perl python3-venv ninja-build pkg-config \
  libglib2.0-dev libgcrypt20-dev libfdt-dev libslirp-dev
sh esp32-helper/ci-build.sh src-tauri/resources/esp32
```

`src-tauri/resources/esp32` then holds `benchtop-esp32` and the two ROM
images, which `pnpm tauri build` bundles. The installed program needs the
`libgcrypt20` and `libfdt1` packages, which the .deb and .rpm declare.

On macOS the same script works with Homebrew's `glib libgcrypt dtc libslirp
ninja pkg-config`. Windows builds of the fork are made with MSYS2 (MinGW-w64);
see the fork's README. To use a helper built elsewhere, put it with the ROM
images in a folder and start Benchtop with `BENCHTOP_ESP32_HELPER` set to the
program's path.

## Firmware

Benchtop boots an image the way the chip's ROM does: a merged image (Arduino
IDE 2: Sketch → Export Compiled Binary, the `.merged.bin` file; or `esptool
merge_bin`) goes at offset 0, and a single bootloader-style image at 0x1000.
`firmware/esp32/demo.S` is Benchtop's own SDK-free demo, built into the app.

## Licence

`benchtop_esp32_main.c`, `build.sh` and `ci-build.sh` are GPL-2.0-or-later,
like the QEMU code they are linked with; the resulting program is GPL-2.0.
Benchtop itself (MIT) only starts it as a separate process. Each release
carries `benchtop-esp32-source.tar.xz`, the complete source of the helper in
the installers. The ESP32 ROM images are Espressif's, released under the
Apache License 2.0.
