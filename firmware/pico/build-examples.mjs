#!/usr/bin/env node
/*
 * Builds the Raspberry Pi Pico example sketches with arm-none-eabi-gcc,
 * Benchtop's small Arduino-style core for the RP2040 (core/) and the
 * libraries the sketches include: the Pico's own (libraries/: Wire, SPI,
 * Servo) and the portable ones shared with the AVR boards
 * (../avr/libraries: displays and sensors).  Writes
 * src/lib/circuit/pico-examples.ts with each sketch and its flash image
 * (from 0x10000000, the second stage boot loader first, with the checksum
 * the boot ROM checks).  Needs gcc-arm-none-eabi and libnewlib-arm-none-eabi:
 *   node firmware/pico/build-examples.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const LIBRARY_DIRS = [join(here, 'libraries'), join(here, '..', 'avr', 'libraries')];
const FLASH = 2 * 1024 * 1024;
const RAM = 256 * 1024;

const includes = (text) => [...text.matchAll(/#include\s*[<"]([\w]+)\.h[>"]/g)].map((m) => m[1]);
const folderOf = (name) => LIBRARY_DIRS.map((dir) => join(dir, name)).find((f) => existsSync(f));

/** The libraries a sketch needs (the Pico's own first), following the libraries' own includes. */
function librariesOf(sketch) {
  const found = new Map();
  const visit = (text) => {
    for (const name of includes(text)) {
      const folder = folderOf(name);
      if (found.has(name) || !folder) continue;
      found.set(name, folder);
      for (const file of readdirSync(folder)) if (/\.(h|cpp)$/.test(file)) visit(readFileSync(join(folder, file), 'utf8'));
    }
  };
  visit(sketch);
  return [...found.values()];
}

/** CRC-32 as the boot ROM checks boot2: polynomial 0x04C11DB7, not reflected, starting from all ones, not inverted. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b << 24;
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
  }
  return crc >>> 0;
}

const work = mkdtempSync(join(tmpdir(), 'benchtop-pico-'));
const examples = [];
try {
  console.log(execFileSync('arm-none-eabi-g++', ['--version'], { encoding: 'utf8' }).split('\n')[0]);
  // The boot stage is assembled on its own (the sketches' forced include of Arduino.h is C++).
  const boot2 = join(work, 'boot2.o');
  execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0plus', '-mthumb', '-c', join(here, 'core', 'boot2.S'), '-o', boot2], { stdio: 'inherit' });
  const dir = join(here, 'examples');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.ino'))
    .sort()) {
    const id = basename(file, '.ino');
    const sketch = readFileSync(join(dir, file), 'utf8');
    const libraries = librariesOf(sketch);
    const sources = [
      join(here, 'core', 'core.cpp'),
      ...libraries.flatMap((folder) =>
        readdirSync(folder)
          .filter((f) => f.endsWith('.cpp'))
          .map((f) => join(folder, f)),
      ),
    ];
    const elf = join(work, `${id}.elf`);
    execFileSync(
      'arm-none-eabi-g++',
      [
        '-mcpu=cortex-m0plus',
        '-mthumb',
        '-Os',
        '-std=gnu++17',
        '-fno-exceptions',
        '-fno-rtti',
        '-fno-threadsafe-statics',
        '-ffunction-sections',
        '-fdata-sections',
        '-nostartfiles',
        '--specs=nano.specs',
        '--specs=nosys.specs',
        '-nostdlib++',
        `-T${join(here, 'core', 'memmap.ld')}`,
        '-Wl,--gc-sections',
        '-Wl,--no-warn-rwx-segments',
        '-Wall',
        '-Wextra',
        '-Wno-unused-parameter',
        `-I${join(here, 'core')}`,
        ...libraries.map((folder) => `-I${folder}`),
        boot2,
        '-include',
        join(here, 'core', 'Arduino.h'),
        '-x',
        'c++',
        join(dir, file),
        '-x',
        'none',
        ...sources,
        '-o',
        elf,
      ],
      { stdio: 'inherit' },
    );
    const bin = join(work, `${id}.bin`);
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', elf, bin]);
    const image = new Uint8Array(readFileSync(bin));
    // The boot ROM only runs boot2 when the CRC in its last four bytes matches the first 252.
    const crc = crc32(image.subarray(0, 252));
    image[252] = crc & 0xff;
    image[253] = (crc >>> 8) & 0xff;
    image[254] = (crc >>> 16) & 0xff;
    image[255] = crc >>> 24;
    const [text, data, bss] = execFileSync('arm-none-eabi-size', [elf], { encoding: 'utf8' }).split('\n')[1].trim().split(/\s+/).map(Number);
    console.log(`${id}: ${text + data} bytes of flash, ${data + bss} of RAM${libraries.length ? ` (${libraries.map((f) => basename(f)).join(', ')})` : ''}`);
    if (image.length > FLASH) throw new Error(`${id} does not fit the flash.`);
    if (data + bss > RAM - 16 * 1024) throw new Error(`${id} leaves too little RAM.`);
    examples.push({ id, sketch, image: Buffer.from(image).toString('base64') });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const out = join(root, 'src', 'lib', 'circuit', 'pico-examples.ts');
writeFileSync(
  out,
  `/**
 * Example sketches for the Raspberry Pi Pico in the circuit simulator,
 * compiled with arm-none-eabi-gcc and Benchtop's small Arduino-style core
 * for the RP2040 (firmware/pico).  Each image is the flash from 0x10000000,
 * in Base64.  Generated by firmware/pico/build-examples.mjs; do not edit by hand.
 */
export interface PicoExample {
  readonly id: string;
  readonly sketch: string;
  readonly image: string;
}

export const PICO_EXAMPLES: readonly PicoExample[] = ${JSON.stringify(examples, null, 2)};
`,
);
console.log(`Wrote ${examples.length} examples to ${out}`);
execFileSync('npx', ['biome', 'format', '--write', out], { cwd: root, stdio: 'ignore' });
