/**
 * Map files for the Map Viewer: GeoJSON, TopoJSON, KML, KMZ, GPX, TCX and
 * CSV with latitude and longitude columns, read into GeoJSON; lengths,
 * areas and track profiles; and writing GeoJSON back out as KML, GPX or CSV.
 */
import { gpx, kml, tcx } from '@tmcw/togeojson';
import { geoArea, geoBounds, geoDistance, geoLength } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, Position } from 'geojson';

/** Mean Earth radius in kilometres. */
export const EARTH_KM = 6371.0088;

type XmlParser = (text: string) => Document;
let xmlParser: XmlParser = (text) => new DOMParser().parseFromString(text, 'text/xml');

/** For tests outside a browser. */
export function setXmlParser(parser: XmlParser): void {
  xmlParser = parser;
}

const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

function asCollection(value: unknown): FeatureCollection {
  const v = value as { type?: string };
  if (v?.type === 'FeatureCollection') return value as FeatureCollection;
  if (v?.type === 'Feature') return collection([value as Feature]);
  if (typeof v?.type === 'string') return collection([{ type: 'Feature', properties: {}, geometry: value as Geometry }]);
  throw new Error('This JSON is not GeoJSON: it needs a "type" such as FeatureCollection.');
}

async function fromTopo(topology: { objects: Record<string, unknown> }): Promise<FeatureCollection> {
  const { feature } = await import('topojson-client');
  const features: Feature[] = [];
  for (const [name, object] of Object.entries(topology.objects)) {
    const result = feature(topology as never, object as never) as unknown as FeatureCollection | Feature;
    const list = 'features' in result ? result.features : [result];
    for (const f of list) features.push({ ...f, properties: { layer: name, ...(f.properties ?? {}) } });
  }
  return collection(features);
}

function splitCsvLine(line: string, separator: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

/** Points from a CSV with latitude and longitude columns (lat/latitude/y and lon/lng/long/longitude/x). */
export function fromCsv(text: string): FeatureCollection {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0] ?? '';
  const separator = [',', ';', '\t'].sort((a, b) => header.split(b).length - header.split(a).length)[0] as string;
  const names = splitCsvLine(header, separator);
  const find = (re: RegExp) => names.findIndex((n) => re.test(n));
  const lat = find(/^(lat|latitude|y)$/i);
  const lon = find(/^(lon|lng|long|longitude|x)$/i);
  if (lat < 0 || lon < 0) throw new Error('The CSV needs latitude and longitude columns (named lat and lon, latitude and longitude, or y and x).');
  const features: Feature[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, separator);
    const y = Number(cells[lat]);
    const x = Number(cells[lon]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const properties: Record<string, string> = {};
    names.forEach((n, i) => {
      if (i !== lat && i !== lon) properties[n] = cells[i] ?? '';
    });
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, y] } });
  }
  if (features.length === 0) throw new Error('No rows had numbers in the latitude and longitude columns.');
  return collection(features);
}

/** Reads any supported map file into GeoJSON. */
export async function readGeo(name: string, bytes: Uint8Array): Promise<FeatureCollection> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'kmz') {
    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(bytes);
    const entry = Object.keys(files).find((k) => k.toLowerCase().endsWith('.kml'));
    if (!entry) throw new Error('This KMZ file holds no KML document.');
    return kml(xmlParser(strFromU8(files[entry] as Uint8Array))) as FeatureCollection;
  }
  const text = new TextDecoder().decode(bytes);
  if (ext === 'kml') return kml(xmlParser(text)) as FeatureCollection;
  if (ext === 'gpx') return gpx(xmlParser(text)) as FeatureCollection;
  if (ext === 'tcx') return tcx(xmlParser(text)) as FeatureCollection;
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return fromCsv(text);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (/<kml[\s>]/i.test(text)) return kml(xmlParser(text)) as FeatureCollection;
    if (/<gpx[\s>]/i.test(text)) return gpx(xmlParser(text)) as FeatureCollection;
    throw new Error('This file could not be read as GeoJSON, TopoJSON, KML, GPX, TCX or CSV.');
  }
  if ((json as { type?: string }).type === 'Topology') return fromTopo(json as { objects: Record<string, unknown> });
  return asCollection(json);
}

/* -------------------------------------------------------------- d3 winding -- */

function reverseRings(rings: Position[][]): Position[][] {
  return rings.map((ring) => [...ring].reverse());
}

/**
 * GeoJSON (RFC 7946) winds outer rings anticlockwise; d3-geo expects
 * clockwise and would otherwise fill the rest of the globe.  Flips any
 * polygon whose area comes out larger than a hemisphere.
 */
export function rewindForD3(fc: FeatureCollection): FeatureCollection {
  const fix = (g: Geometry | null): Geometry | null => {
    if (!g) return g;
    if (g.type === 'Polygon') return geoArea(g) > 2 * Math.PI ? { ...g, coordinates: reverseRings(g.coordinates) } : g;
    if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map((p) => (geoArea({ type: 'Polygon', coordinates: p }) > 2 * Math.PI ? reverseRings(p) : p)) };
    if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map((x) => fix(x) as Geometry) };
    return g;
  };
  return { ...fc, features: fc.features.map((f) => ({ ...f, geometry: fix(f.geometry) as Geometry })) };
}

/* ----------------------------------------------------------------- facts -- */

export interface GeoFacts {
  readonly features: number;
  readonly points: number;
  readonly lines: number;
  readonly polygons: number;
  /** [[west, south], [east, north]] */
  readonly bounds: [[number, number], [number, number]] | null;
  readonly lengthKm: number;
  readonly areaKm2: number;
}

function kinds(g: Geometry | null, into: { points: number; lines: number; polygons: number }): void {
  if (!g) return;
  if (g.type === 'Point' || g.type === 'MultiPoint') into.points++;
  else if (g.type === 'LineString' || g.type === 'MultiLineString') into.lines++;
  else if (g.type === 'Polygon' || g.type === 'MultiPolygon') into.polygons++;
  else if (g.type === 'GeometryCollection') for (const x of g.geometries) kinds(x, into);
}

/** Length of the lines (km) and area of the polygons (km²) of a feature or collection already wound for d3. */
export function measure(object: Feature | FeatureCollection): { lengthKm: number; areaKm2: number } {
  const features = object.type === 'FeatureCollection' ? object.features : [object];
  let lengthKm = 0;
  let areaKm2 = 0;
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString' || g.type === 'MultiLineString') lengthKm += geoLength(f) * EARTH_KM;
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') areaKm2 += geoArea(f) * EARTH_KM * EARTH_KM;
  }
  return { lengthKm, areaKm2 };
}

export function geoFacts(fc: FeatureCollection): GeoFacts {
  const counts = { points: 0, lines: 0, polygons: 0 };
  for (const f of fc.features) kinds(f.geometry, counts);
  const b = fc.features.length ? geoBounds(fc) : null;
  const bounds = b?.every((p) => p.every(Number.isFinite)) ? (b as [[number, number], [number, number]]) : null;
  return { features: fc.features.length, ...counts, bounds, ...measure(fc) };
}

/* ---------------------------------------------------------------- tracks -- */

export interface TrackProfile {
  /** Distance from the start at each point, km. */
  readonly distance: number[];
  readonly elevation: (number | null)[];
  readonly times: (number | null)[];
  readonly gain: number;
  readonly loss: number;
  readonly totalKm: number;
  /** Seconds from the first to the last time stamp, or null. */
  readonly duration: number | null;
}

/** Distance, height and time along a line, from its coordinates and any GPX times. */
export function trackProfile(feature: Feature): TrackProfile | null {
  const g = feature.geometry as LineString | MultiLineString | null;
  if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) return null;
  const coords: Position[] = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
  if (coords.length < 2) return null;
  const rawTimes = (feature.properties as { coordinateProperties?: { times?: unknown } } | null)?.coordinateProperties?.times;
  const times = (Array.isArray(rawTimes) ? (rawTimes.flat() as unknown[]) : []).map((t) => (typeof t === 'string' ? Date.parse(t) : null));
  const distance = [0];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1] as Position;
    const b = coords[i] as Position;
    distance.push((distance[i - 1] as number) + geoDistance([a[0] as number, a[1] as number], [b[0] as number, b[1] as number]) * EARTH_KM);
    const dz = (b[2] ?? Number.NaN) - (a[2] ?? Number.NaN);
    if (dz > 0) gain += dz;
    else if (dz < 0) loss -= dz;
  }
  const valid = times.filter((t): t is number => t !== null && Number.isFinite(t));
  return {
    distance,
    elevation: coords.map((c) => (typeof c[2] === 'number' ? c[2] : null)),
    times: coords.map((_, i) => times[i] ?? null),
    gain,
    loss,
    totalKm: distance[distance.length - 1] as number,
    duration: valid.length >= 2 ? ((valid[valid.length - 1] as number) - (valid[0] as number)) / 1000 : null,
  };
}

/* ---------------------------------------------------------------- export -- */

const xml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const nameOf = (f: Feature, i: number) => {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return String(p.name ?? p.title ?? p.NAME ?? p.id ?? `Feature ${i + 1}`);
};

const coordText = (c: readonly Position[]) => c.map((p) => `${p[0]},${p[1]}${p[2] !== undefined ? `,${p[2]}` : ''}`).join(' ');

function kmlGeometry(g: Geometry): string {
  switch (g.type) {
    case 'Point':
      return `<Point><coordinates>${coordText([g.coordinates])}</coordinates></Point>`;
    case 'MultiPoint':
      return `<MultiGeometry>${g.coordinates.map((c) => `<Point><coordinates>${coordText([c])}</coordinates></Point>`).join('')}</MultiGeometry>`;
    case 'LineString':
      return `<LineString><coordinates>${coordText(g.coordinates)}</coordinates></LineString>`;
    case 'MultiLineString':
      return `<MultiGeometry>${g.coordinates.map((l) => `<LineString><coordinates>${coordText(l)}</coordinates></LineString>`).join('')}</MultiGeometry>`;
    case 'Polygon':
      return polygonKml(g.coordinates);
    case 'MultiPolygon':
      return `<MultiGeometry>${g.coordinates.map(polygonKml).join('')}</MultiGeometry>`;
    case 'GeometryCollection':
      return `<MultiGeometry>${g.geometries.map(kmlGeometry).join('')}</MultiGeometry>`;
  }
}

function polygonKml(rings: Position[][]): string {
  const [outer, ...holes] = rings;
  return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordText(outer ?? [])}</coordinates></LinearRing></outerBoundaryIs>${holes.map((h) => `<innerBoundaryIs><LinearRing><coordinates>${coordText(h)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
}

export function toKml(fc: FeatureCollection, title = 'Benchtop map'): string {
  const placemarks = fc.features
    .filter((f) => f.geometry)
    .map((f, i) => {
      const props = Object.entries(f.properties ?? {}).filter(([k, v]) => k !== 'coordinateProperties' && typeof v !== 'object');
      const data = props.length ? `<ExtendedData>${props.map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join('')}</ExtendedData>` : '';
      return `<Placemark><name>${xml(nameOf(f, i))}</name>${data}${kmlGeometry(f.geometry as Geometry)}</Placemark>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(title)}</name>\n${placemarks.join('\n')}\n</Document></kml>\n`;
}

export function toGpx(fc: FeatureCollection): string {
  const points: string[] = [];
  const tracks: string[] = [];
  fc.features.forEach((f, i) => {
    const g = f.geometry;
    if (!g) return;
    const name = `<name>${xml(nameOf(f, i))}</name>`;
    const pt = (tag: string, p: Position, time?: unknown) =>
      `<${tag} lat="${p[1]}" lon="${p[0]}">${p[2] !== undefined ? `<ele>${p[2]}</ele>` : ''}${typeof time === 'string' ? `<time>${xml(time)}</time>` : ''}</${tag}>`;
    if (g.type === 'Point') points.push(pt('wpt', g.coordinates).replace('</wpt>', `${name}</wpt>`));
    if (g.type === 'MultiPoint') for (const c of g.coordinates) points.push(pt('wpt', c).replace('</wpt>', `${name}</wpt>`));
    const times = ((f.properties as { coordinateProperties?: { times?: unknown[] } } | null)?.coordinateProperties?.times ?? []) as unknown[];
    if (g.type === 'LineString') tracks.push(`<trk>${name}<trkseg>${g.coordinates.map((c, k) => pt('trkpt', c, times[k])).join('')}</trkseg></trk>`);
    if (g.type === 'MultiLineString')
      tracks.push(`<trk>${name}${g.coordinates.map((l, s) => `<trkseg>${l.map((c, k) => pt('trkpt', c, (times[s] as unknown[] | undefined)?.[k])).join('')}</trkseg>`).join('')}</trk>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Benchtop" xmlns="http://www.topografix.com/GPX/1/1">\n${[...points, ...tracks].join('\n')}\n</gpx>\n`;
}

/** Points (and the vertices of lines) as CSV rows. */
export function toCsv(fc: FeatureCollection): string {
  const keys = [...new Set(fc.features.flatMap((f) => Object.keys(f.properties ?? {}).filter((k) => k !== 'coordinateProperties')))];
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['feature', 'latitude', 'longitude', 'elevation', ...keys].map(cell).join(',')];
  fc.features.forEach((f, i) => {
    const g = f.geometry;
    const coords: Position[] = !g
      ? []
      : g.type === 'Point'
        ? [g.coordinates]
        : g.type === 'MultiPoint' || g.type === 'LineString'
          ? g.coordinates
          : g.type === 'MultiLineString'
            ? g.coordinates.flat()
            : [];
    for (const c of coords) rows.push([nameOf(f, i), c[1], c[0], c[2] ?? '', ...keys.map((k) => (f.properties as Record<string, unknown> | null)?.[k])].map(cell).join(','));
  });
  return `${rows.join('\n')}\n`;
}
