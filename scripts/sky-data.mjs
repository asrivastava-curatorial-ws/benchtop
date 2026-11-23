#!/usr/bin/env node
/**
 * Builds public/sky.json for the Star Chart from d3-celestial's data folder
 * (BSD-3-Clause, Olaf Frohn; stars from the XHIP Hipparcos compilation,
 * constellation figures after the IAU, Messier objects from SEDS):
 *
 *   node scripts/sky-data.mjs <d3-celestial>/data
 *
 * The files are only parsed as JSON.  Output:
 *   stars:  [ra°, dec°, mag, b−v, hip] for stars to magnitude 6
 *   names:  { hip: [proper name, Bayer letter] }
 *   lines:  { abbr: [[ra°, dec°], …][] }
 *   constellations: [abbr, Latin name, ra°, dec°, rank]
 *   messier: [id, ra°, dec°, mag, type, common name]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/sky-data.mjs <d3-celestial>/data');
  process.exit(1);
}
const load = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const ra = (lon) => Number((lon < 0 ? lon + 360 : lon).toFixed(3));
const dec = (lat) => Number(lat.toFixed(3));

const stars = load('stars.6.json').features.map((f) => [
  ra(f.geometry.coordinates[0]),
  dec(f.geometry.coordinates[1]),
  Number(f.properties.mag),
  Number(Number(f.properties.bv || 0.6).toFixed(2)),
  f.id,
]);
stars.sort((a, b) => a[2] - b[2]);
const kept = new Set(stars.map((s) => String(s[4])));

const names = {};
for (const [hip, entry] of Object.entries(load('starnames.json'))) {
  if (!kept.has(hip)) continue;
  const proper = entry.name || '';
  const bayer = entry.bayer || '';
  if (proper || bayer) names[hip] = [proper, bayer];
}

const lines = {};
for (const f of load('constellations.lines.json').features) lines[f.id] = f.geometry.coordinates.map((line) => line.map(([lon, lat]) => [ra(lon), dec(lat)]));

const constellations = load('constellations.json').features.map((f) => [
  f.id,
  f.properties.en || f.properties.name,
  ra(f.geometry.coordinates[0]),
  dec(f.geometry.coordinates[1]),
  Number(f.properties.rank) || 3,
]);

const messier = load('messier.json').features.map((f) => [
  f.id,
  ra(f.geometry.coordinates[0]),
  dec(f.geometry.coordinates[1]),
  Number(f.properties.mag) || 99,
  f.properties.type || '',
  f.properties.alt || '',
]);

const out = { source: 'd3-celestial 0.7.35 data (BSD-3-Clause)', stars, names, lines, constellations, messier };
writeFileSync(new URL('../public/sky.json', import.meta.url), JSON.stringify(out));
console.log(`${stars.length} stars, ${Object.keys(names).length} names, ${Object.keys(lines).length} figures, ${messier.length} Messier objects`);
