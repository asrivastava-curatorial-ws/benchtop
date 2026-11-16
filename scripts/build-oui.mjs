// Builds src/data/oui.tsv.gz from the oui-data package (IEEE MA-L, MA-M and MA-S registries):
// one "prefix<TAB>organisation<TAB>country" line per assignment, gzip-compressed.
// Run after updating oui-data: node scripts/build-oui.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const data = JSON.parse(readFileSync(new URL('index.json', `file://${require.resolve('oui-data').replace(/[^/]*$/, '')}`), 'utf8'));
const lines = Object.entries(data)
  .map(([prefix, text]) => {
    const parts = String(text).split('\n');
    const name = (parts[0] ?? '').replace(/\s+/g, ' ').trim();
    const country = (parts.length > 1 ? parts[parts.length - 1] : '').trim();
    return `${prefix}\t${name}\t${country}`;
  })
  .sort();
const gz = gzipSync(Buffer.from(`${lines.join('\n')}\n`), { level: 9 });
writeFileSync(new URL('../src/data/oui.tsv.gz', import.meta.url), gz);
console.log(`${lines.length} prefixes, ${gz.length} bytes`);
