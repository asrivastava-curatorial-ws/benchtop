#!/usr/bin/env node
/**
 * Guards the source tree against invisible characters.
 *
 * Byte-order marks, non-breaking and zero-width spaces, control characters and
 * bidirectional overrides are impossible to see in review and have been used
 * to disguise malicious code ("Trojan Source", CVE-2021-42574).  They must be
 * written as explicit escapes such as "\u00A0" so that the intent is visible.
 *
 *   node scripts/check-source-chars.mjs          # report, exit 1 if any are found
 *   node scripts/check-source-chars.mjs --fix    # rewrite them as \uXXXX escapes
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOTS = ['src', 'tests', 'scripts', 'src-tauri/src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.html', '.json', '.rs', '.toml']);
// Code point ranges that must never appear literally: C0/C1 controls except tab/LF/CR, DEL, NBSP,
// soft hyphen, zero-width and bidirectional controls, line/paragraph separators, exotic spaces,
// the BOM and the replacement character.  (Written as numbers so this file passes its own check.)
const RANGES = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00a0, 0x00a0],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffd],
];
const hex4 = (code) => `\\u${code.toString(16).padStart(4, '0')}`;
const SUSPICIOUS = new RegExp(`[${RANGES.map(([from, to]) => (from === to ? hex4(from) : `${hex4(from)}-${hex4(to)}`)).join('')}]`, 'g');

const fix = process.argv.includes('--fix');
const root = process.cwd();
let findings = 0;

function* walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'target' || entry === 'dist' || entry === 'gen') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(entry))) yield path;
  }
}

const toEscape = (ch) => `\\u${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

for (const base of ROOTS) {
  for (const file of walk(join(root, base))) {
    const text = readFileSync(file, 'utf8');
    if (!SUSPICIOUS.test(text)) continue;
    SUSPICIOUS.lastIndex = 0;
    if (fix) {
      writeFileSync(file, text.replace(SUSPICIOUS, escape));
      console.log(`fixed  ${relative(root, file)}`);
      continue;
    }
    text.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(SUSPICIOUS)) {
        findings++;
        console.error(`${relative(root, file)}:${index + 1}:${match.index + 1}  invisible character ${toEscape(match[0])}`);
      }
    });
  }
}

if (findings > 0) {
  console.error(`\n${findings} invisible character(s) found. Write them as escapes, or run with --fix.`);
  process.exit(1);
}
