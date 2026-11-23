#!/usr/bin/env node
/**
 * Builds public/oui.json, the network-card maker names used by the LAN
 * Scanner, from the IEEE MA-L registry as packaged in oui-data (BSD-2-Clause):
 *   npm pack oui-data && tar xzf oui-data-*.tgz && node scripts/oui-table.mjs package/index.json
 * Names are shortened ("Apple, Inc." → "Apple") and stored once each.  Prefixes
 * are 6 (MA-L), 7 (MA-M) or 9 (MA-S) hex digits; each length has its own sorted
 * string of fixed-width records: the prefix, then its name's index in base 36 (3 digits).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(process.argv[2] ?? 'package/index.json', 'utf8'));
const tidy = (raw) =>
  raw
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .replace(
      /[,.]?\s*\b(co\.?,? ?ltd|company,? limited|co\.? limited|corp(oration)?|inc(orporated)?|l\.?l\.?c|ltd|limited|gmbh( & co\.? kg)?|s\.?a\.?|s\.?p\.?a\.?|b\.?v\.?|a\.?g\.?|ab|oy|plc|pty|pvt|private|technolog(y|ies)|electronics?|communications?|international|holdings?)\b\.?/gi,
      '',
    )
    .replace(/[\s,.-]+$/, '')
    .trim() || raw.split('\n')[0].trim();
const names = [];
const index = new Map();
const records = { 6: '', 7: '', 9: '' };
for (const prefix of Object.keys(source).sort()) {
  const name = tidy(source[prefix]);
  if (!name || name === 'Private' || !(prefix.length in records)) continue;
  if (!index.has(name)) {
    index.set(name, names.length);
    names.push(name);
  }
  records[prefix.length] += prefix.toUpperCase() + index.get(name).toString(36).padStart(3, '0');
}
writeFileSync(new URL('../public/oui.json', import.meta.url), JSON.stringify({ source: 'IEEE MA-L, MA-M and MA-S registries via oui-data', names, records }));
console.log(
  `${Object.entries(records)
    .map(([n, r]) => `${r.length / (Number(n) + 3)} × ${n}`)
    .join(', ')} prefixes, ${names.length} names`,
);
