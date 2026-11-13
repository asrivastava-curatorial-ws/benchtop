#!/usr/bin/env node
/**
 * Collects the licence texts of every production dependency (including
 * transitive ones) into one notice file.  Used by the Vite build, which ships
 * the result as THIRD-PARTY-LICENSES.txt; run directly to print it.
 *
 * Works with pnpm, npm and Yarn layouts: dependencies are found by walking up
 * from each package's real directory, the way Node itself resolves them.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i;

/** Components compiled into a dependency's WebAssembly, keyed by that dependency; texts live in licenses/. */
const EMBEDDED = {
  'jq-wasm': [
    { name: 'jq (compiled into jq-wasm)', version: '1.8.2', license: 'MIT, with ICU (decNumber) and other notices', repository: 'https://github.com/jqlang/jq', file: 'jq-COPYING.txt' },
    { name: 'Oniguruma (compiled into jq-wasm)', version: 'as bundled with jq 1.8.2', license: 'BSD-2-Clause', repository: 'https://github.com/kkos/oniguruma', file: 'oniguruma-COPYING.txt' },
  ],
};

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

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((entry) => entry.type ?? entry).join(' OR ');
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
    seen.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), repository: repositoryOf(pkg), texts });
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
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function renderNotice(packages) {
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
  return `${header}\n${body}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packages = collectLicenses();
  if (process.argv.includes('--summary')) {
    const counts = new Map();
    for (const pkg of packages) counts.set(pkg.license, (counts.get(pkg.license) ?? 0) + 1);
    for (const [license, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(4)}  ${license}`);
  } else {
    process.stdout.write(renderNotice(packages));
  }
}
