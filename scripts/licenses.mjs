#!/usr/bin/env node
/**
 * Collects the licence texts of every production dependency (including
 * transitive ones) into one notice file.  Used by the Vite build, which ships
 * the result as THIRD-PARTY-LICENSES.txt; run directly to print it.
 *
 * Works with pnpm, npm and Yarn layouts: dependencies are found by walking up
 * from each package's real directory, the way Node itself resolves them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;

/** Components compiled into a dependency's WebAssembly, keyed by that dependency; texts live in licenses/. */
const EMBEDDED = {
  'lcms-wasm': [{ name: 'Little CMS (compiled into lcms-wasm)', version: '2.16', license: 'MIT', repository: 'https://github.com/mm2/Little-CMS', file: 'lcms2-LICENSE.txt' }],
  'libyara-wasm': [{ name: 'YARA (compiled into libyara-wasm)', version: '4.x', license: 'BSD-3-Clause', repository: 'https://github.com/VirusTotal/yara', file: 'yara-COPYING.txt' }],
  'jq-wasm': [
    { name: 'jq (compiled into jq-wasm)', version: '1.8.2', license: 'MIT, with ICU (decNumber) and other notices', repository: 'https://github.com/jqlang/jq', file: 'jq-COPYING.txt' },
    { name: 'Oniguruma (compiled into jq-wasm)', version: 'as bundled with jq 1.8.2', license: 'BSD-2-Clause', repository: 'https://github.com/kkos/oniguruma', file: 'oniguruma-COPYING.txt' },
  ],
  pyodide: [
    {
      name: 'CPython and its standard library (compiled into Pyodide, used by the Code Runner)',
      version: '3.14.2',
      license: 'PSF-2.0',
      repository: 'https://github.com/python/cpython',
      file: 'cpython-LICENSE.txt',
    },
  ],
  wasmoon: [{ name: 'Lua (compiled into wasmoon, used by the Code Runner)', version: '5.4', license: 'MIT', repository: 'https://www.lua.org', file: 'lua-LICENSE.txt' }],
  'libheif-js': [
    {
      name: 'libheif and libde265 (compiled into libheif-js)',
      version: 'libheif 1.23',
      license: 'LGPL-3.0',
      repository: 'https://github.com/strukturag/libheif',
      file: 'libheif-NOTICE.txt',
    },
  ],
};

/** Bundled components that do not come from npm; texts live in licenses/. */
const BUNDLED = [
  {
    name: 'Benchtop Coated FOGRA39L press profile (made from the FOGRA39L characterization data, as published in colord)',
    version: 'FOGRA39L, December 2006',
    license: 'CC0-1.0',
    repository: 'https://github.com/hughsie/colord',
    file: 'fogra39l-NOTICE.txt',
  },
  {
    name: 'Compact ICC Profiles',
    version: '(sRGB v2 micro, sRGB v4, CGATS001 compatible v2 micro)',
    license: 'CC0-1.0',
    repository: 'https://github.com/saucecontrol/Compact-ICC-Profiles',
    file: 'compact-icc-NOTICE.txt',
  },
  {
    name: 'CyberChef (operation designs reimplemented, and the code of 65 operations)',
    version: '10',
    license: 'Apache-2.0',
    repository: 'https://github.com/gchq/CyberChef',
    file: 'cyberchef-NOTICE.txt',
  },
  {
    name: 'tessdata_fast English and Hindi models (eng.traineddata, hin.traineddata)',
    version: '4.1.0',
    license: 'Apache-2.0',
    repository: 'https://github.com/tesseract-ocr/tessdata_fast',
    file: 'tessdata-NOTICE.txt',
  },
  { name: 'Benchtop Sans (built from Noto Sans and Noto Sans Devanagari)', version: '2.004 / 2.001', license: 'OFL-1.1', repository: 'https://github.com/notofonts', file: 'benchtop-sans-NOTICE.txt' },
  {
    name: 'Network card maker names (IEEE MA-L registry, as packaged in oui-data)',
    version: '2.1.65',
    license: 'BSD-2-Clause',
    repository: 'https://github.com/silverwind/oui-data',
    file: 'oui-data-LICENSE.txt',
  },
  {
    name: 'Element data (PubChem periodic table, as packaged in periodic-table-data)',
    version: '1.1.1',
    license: 'MIT',
    repository: 'https://github.com/sjf8203/periodic-table-data',
    file: 'periodic-table-data-LICENSE.txt',
  },
  {
    name: 'Star, constellation and Messier data (from d3-celestial)',
    version: '0.7.35',
    license: 'BSD-3-Clause',
    repository: 'https://github.com/ofrohn/d3-celestial',
    file: 'd3-celestial-LICENSE.txt',
  },
  {
    name: 'Stable isotope masses and abundances (from chemical-elements)',
    version: '2.3.3',
    license: 'MIT',
    repository: 'https://github.com/cheminfo/mass-tools',
    file: 'chemical-elements-LICENSE.txt',
  },
  {
    name: 'benchtop-esp32: QEMU with the ESP32 machine (Linux installers; a separate program)',
    version: '9.2.2 (lcgamboa 885a6e7)',
    license: 'GPL-2.0-or-later',
    repository: 'https://github.com/lcgamboa/qemu',
    file: 'qemu-esp32-NOTICE.txt',
  },
  { name: 'ESP32 ROM images (Linux installers)', version: 'revision 3', license: 'Apache-2.0', repository: 'https://github.com/espressif/esp-rom-elfs', file: 'esp32-rom-NOTICE.txt' },
  {
    name: 'Adafruit GFX 5×7 font (glcdfont), in the simulated displays and the example sketches',
    version: '1.11',
    license: 'BSD-2-Clause',
    repository: 'https://github.com/adafruit/Adafruit-GFX-Library',
    file: 'adafruit-gfx-LICENSE.txt',
  },
  {
    name: 'RP2040 boot ROM, B1 (runs inside the emulated Raspberry Pi Pico; source in third_party/pico-bootrom)',
    version: '00a4a19',
    license: 'BSD-3-Clause AND GPL-2.0-only',
    repository: 'https://github.com/raspberrypi/pico-bootrom',
    file: 'pico-bootrom-NOTICE.txt',
  },
];

/**
 * Rust crates compiled into the desktop program, with their licences and
 * where their source is published (crates.io).  Needs cargo; returns an empty
 * list without it, as in web-only builds.
 */
export function collectCrates(root = ROOT) {
  let meta;
  try {
    const out = execFileSync('cargo', ['metadata', '--format-version', '1', '--manifest-path', join(root, 'src-tauri', 'Cargo.toml')], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    meta = JSON.parse(out);
  } catch {
    return [];
  }
  const packages = new Map(meta.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(meta.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const stack = [meta.resolve.root];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      // Only normal dependencies end up in the program.
      if (dep.dep_kinds.some((kind) => kind.kind === null)) stack.push(dep.pkg);
    }
  }
  seen.delete(meta.resolve.root);
  return [...seen]
    .map((id) => packages.get(id))
    .filter(Boolean)
    .map((pkg) => ({ name: pkg.name, version: pkg.version, license: pkg.license ?? 'see the crate', repository: pkg.repository ?? `https://crates.io/crates/${pkg.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function findPackage(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) return dirname(realpathSync(candidate));
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The licence a package declares, or else the one its licence file is recognisably the text of. */
function licenseOf(pkg, texts = []) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((entry) => entry.type ?? entry).join(' OR ');
  const text = texts.join('\n');
  if (/Permission is hereby granted, free of charge/.test(text)) return 'MIT (from its licence file)';
  if (/Redistribution and use in source and binary forms/.test(text)) {
    return /Neither the name/.test(text) ? 'BSD-3-Clause (from its licence file)' : 'BSD-2-Clause (from its licence file)';
  }
  return 'UNKNOWN';
}

function repositoryOf(pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '') : (pkg.homepage ?? '');
}

export function collectLicenses(root = ROOT) {
  const manifest = readJson(join(root, 'package.json'));
  const seen = new Map();
  const queue = Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, from: root }));
  while (queue.length > 0) {
    const { name, from } = queue.shift();
    const dir = findPackage(name, from);
    if (!dir) continue; // An optional dependency that is not installed on this platform.
    const pkg = readJson(join(dir, 'package.json'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    const files = readdirSync(dir)
      .filter((file) => LICENSE_FILE.test(file))
      .sort();
    const texts = files.map((file) => readFileSync(join(dir, file), 'utf8').trim());
    seen.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg, texts), repository: repositoryOf(pkg), texts });
    for (const dependency of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dependency, from: dir });
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: dependency, from: dir });
  }
  // Software compiled into a package's WebAssembly, whose licences the package itself does not ship.
  for (const [parent, components] of Object.entries(EMBEDDED)) {
    if (![...seen.values()].some((pkg) => pkg.name === parent)) continue;
    for (const component of components) {
      seen.set(`${component.name}@${component.version}`, { ...component, texts: [readFileSync(join(root, 'licenses', component.file), 'utf8').trim()] });
    }
  }
  for (const component of BUNDLED) {
    seen.set(`${component.name}@${component.version}`, { ...component, texts: [readFileSync(join(root, 'licenses', component.file), 'utf8').trim()] });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function renderNotice(packages, crates = []) {
  const header = ['Benchtop includes the following open-source software.', 'Each component is distributed under the licence shown with it.', '', `${packages.length} packages.`, ''].join('\n');
  const body = packages
    .map((pkg) => {
      const title = `${pkg.name} ${pkg.version}`;
      const lines = [title, '-'.repeat(title.length), `Licence: ${pkg.license}`];
      if (pkg.repository) lines.push(`Source: ${pkg.repository}`);
      lines.push('', pkg.texts.length > 0 ? pkg.texts.join('\n\n') : `(No licence file is included in the package; it declares the ${pkg.license} licence.)`);
      return lines.join('\n');
    })
    .join('\n\n\n');
  const rust = crates.length
    ? `\n\n\nRust crates in the desktop program\n----------------------------------\nEach is published with its source and licence text at the address shown (crates.io).\n\n${crates.map((c) => `${c.name} ${c.version}: ${c.license} (${c.repository})`).join('\n')}\n`
    : '';
  return `${header}\n${body}\n${rust}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packages = collectLicenses();
  if (process.argv.includes('--summary')) {
    const counts = new Map();
    for (const pkg of packages) counts.set(pkg.license, (counts.get(pkg.license) ?? 0) + 1);
    for (const [license, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(4)}  ${license}`);
  } else {
    process.stdout.write(renderNotice(packages, collectCrates()));
  }
}
