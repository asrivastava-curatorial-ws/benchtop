/**
 * Map Viewer: open GeoJSON, TopoJSON, KML, KMZ, GPX, TCX or CSV files and see
 * them on an offline world map (Natural Earth land, no borders), with
 * lengths, areas, track profiles and export to GeoJSON, KML, GPX and CSV.
 */
import type { Feature, FeatureCollection } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type GeoFacts, geoFacts, measure, readGeo, rewindForD3, type TrackProfile, toCsv, toGpx, toKml, trackProfile } from '../../lib/geo';
import { minus } from '../../lib/si';
import { saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { MultiDrop } from './_files';

type D3Geo = typeof import('d3-geo');

interface Loaded {
  readonly name: string;
  readonly data: FeatureCollection;
  readonly facts: GeoFacts;
}

/** A made-up walk with three stops, to show what the viewer does. */
function sample(): FeatureCollection {
  const start = Date.UTC(2026, 10, 1, 6, 30);
  const coords: [number, number, number][] = [];
  const times: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * 2 * Math.PI;
    coords.push([77.5946 + 0.012 * Math.cos(t) + 0.002 * Math.cos(3 * t), 12.9716 + 0.009 * Math.sin(t), 905 + 18 * Math.sin(t * 2) + 6 * Math.cos(5 * t)]);
    times.push(new Date(start + i * 45000).toISOString());
  }
  const stop = (name: string, i: number) => ({ type: 'Feature' as const, properties: { name, 'marker-color': '#d55e00' }, geometry: { type: 'Point' as const, coordinates: coords[i] as number[] } });
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Sample loop (made up)', stroke: '#0072b2', coordinateProperties: { times } }, geometry: { type: 'LineString', coordinates: coords } },
      stop('Start and finish', 0),
      stop('Viewpoint', 40),
      stop('Tea stall', 80),
      {
        type: 'Feature',
        properties: { name: 'Sample park (made up)', fill: '#009e73' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [77.589, 12.968],
              [77.6, 12.968],
              [77.6, 12.976],
              [77.589, 12.976],
              [77.589, 12.968],
            ],
          ],
        },
      },
    ],
  };
}

const featureName = (f: Feature, i: number) => {
  const p = (f.properties ?? {}) as Record<string, unknown>;
  return String(p.name ?? p.title ?? p.NAME ?? p.id ?? `${f.geometry?.type ?? 'Feature'} ${i + 1}`);
};

const km = (v: number) => (v >= 1 ? `${v.toFixed(2)} km` : `${(v * 1000).toFixed(0)} m`);
const area = (v: number) => (v >= 1 ? `${v.toFixed(2)} km²` : `${(v * 1e6).toFixed(0)} m² (${(v * 100).toFixed(2)} ha)`);
const duration = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
const degrees = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;

function Profile({ profile }: { profile: TrackProfile }) {
  const w = 420;
  const h = 150;
  const pts = profile.distance.map((d, i) => [d, profile.elevation[i]] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return null;
  const maxD = profile.totalKm || 1;
  const zs = pts.map((p) => p[1]);
  const lo = Math.min(...zs);
  const hi = Math.max(...zs);
  const px = (d: number) => 36 + (d / maxD) * (w - 46);
  const py = (z: number) => 10 + (1 - (z - lo) / (hi - lo || 1)) * (h - 34);
  return (
    <svg class="geo-profile" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Height along the track" data-testid="geo-profile">
      <polyline class="geo-profile-line" fill="none" points={pts.map(([d, z]) => `${px(d).toFixed(1)},${py(z).toFixed(1)}`).join(' ')} />
      <text x={32} y={py(hi) + 4} text-anchor="end" class="sky-tick">
        {Math.round(hi)} m
      </text>
      <text x={32} y={py(lo) + 4} text-anchor="end" class="sky-tick">
        {Math.round(lo)} m
      </text>
      <text x={px(0)} y={h - 6} class="sky-tick">
        0
      </text>
      <text x={px(maxD)} y={h - 6} text-anchor="end" class="sky-tick">
        {km(maxD)}
      </text>
    </svg>
  );
}

function MapViewer() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [d3, setD3] = useState<D3Geo | null>(null);
  const [land, setLand] = useState<Feature | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const [geo, topo, world] = await Promise.all([import('d3-geo'), import('topojson-client'), import('world-atlas/land-50m.json')]);
      const topology = (world as { default?: unknown }).default ?? world;
      setLand(topo.feature(topology as never, (topology as { objects: { land: never } }).objects.land) as unknown as Feature);
      setD3(geo);
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: Math.max(360, Math.round(Math.min(window.innerHeight * 0.62, (el.clientWidth || 800) * 0.68))) }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const open = (name: string, data: FeatureCollection) => {
    const wound = rewindForD3(data);
    setLoaded({ name, data: wound, facts: geoFacts(wound) });
    setPicked(null);
    setView({ k: 1, x: 0, y: 0 });
    setError(null);
  };
  const openFile = (file: File) =>
    attempt(async () => {
      try {
        open(file.name, await readGeo(file.name, new Uint8Array(await file.arrayBuffer())));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  /** The fitted projection, before zooming. */
  const base = useMemo(() => {
    if (!d3) return null;
    const bounds = loaded?.facts.bounds;
    const wide = !bounds || bounds[1][0] - bounds[0][0] > 90 || bounds[0][0] > bounds[1][0];
    const projection = wide ? d3.geoEqualEarth() : d3.geoMercator();
    const pad = 24;
    if (loaded && bounds) {
      const [[w, s], [e, n]] = bounds;
      // A single point or a tiny area is shown about 2 km across.
      const span = Math.max(e - w, n - s);
      const target: FeatureCollection =
        span < 0.01
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'MultiPoint',
                    coordinates: [
                      [w - 0.01, s - 0.01],
                      [e + 0.01, n + 0.01],
                    ],
                  },
                },
              ],
            }
          : loaded.data;
      projection.fitExtent(
        [
          [pad, pad],
          [size.w - pad, size.h - pad],
        ],
        target,
      );
    } else
      projection.fitExtent(
        [
          [pad, pad],
          [size.w - pad, size.h - pad],
        ],
        { type: 'Sphere' },
      );
    return { projection, scale: projection.scale(), translate: projection.translate() };
  }, [d3, loaded, size.w, size.h]);

  const drawing = useMemo(() => {
    if (!d3 || !base) return null;
    const p = base.projection
      .scale(base.scale * view.k)
      .translate([base.translate[0] * view.k + view.x, base.translate[1] * view.k + view.y])
      .clipExtent([
        [-10, -10],
        [size.w + 10, size.h + 10],
      ]);
    const path = d3.geoPath(p);
    return {
      projection: p,
      sphere: path({ type: 'Sphere' }) ?? '',
      graticule: path(d3.geoGraticule10()) ?? '',
      land: land ? (path(land) ?? '') : '',
      features: (loaded?.data.features ?? []).map((f) => {
        const g = f.geometry;
        const isPoint = g?.type === 'Point' || g?.type === 'MultiPoint';
        const points = isPoint ? (g.type === 'Point' ? [g.coordinates] : g.coordinates).map((c) => p([c[0] as number, c[1] as number])).filter((xy): xy is [number, number] => xy !== null) : [];
        return { d: isPoint ? '' : (path(f) ?? ''), points, kind: g?.type ?? '' };
      }),
    };
  }, [d3, base, view, land, loaded, size.w, size.h]);

  const selected = picked !== null ? loaded?.data.features[picked] : undefined;
  const selectedProfile = selected ? trackProfile(selected) : null;
  const selectedMeasure = selected ? measure(selected) : null;

  const exportAs = (kind: 'geojson' | 'kml' | 'gpx' | 'csv') =>
    attempt(async () => {
      if (!loaded) return;
      const base = loaded.name.replace(/\.[^.]+$/, '');
      const text = kind === 'geojson' ? `${JSON.stringify(loaded.data, null, 1)}\n` : kind === 'kml' ? toKml(loaded.data, base) : kind === 'gpx' ? toGpx(loaded.data) : toCsv(loaded.data);
      const mime = { geojson: 'application/geo+json', kml: 'application/vnd.google-earth.kml+xml', gpx: 'application/gpx+xml', csv: 'text/csv' }[kind];
      const outcome = await saveFile(`${base}.${kind}`, text, mime);
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  const style = (f: Feature, i: number) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const on = i === picked;
    return {
      stroke: typeof p.stroke === 'string' ? p.stroke : '#0072b2',
      fill: typeof p.fill === 'string' ? p.fill : '#56b4e9',
      marker: typeof p['marker-color'] === 'string' ? p['marker-color'] : '#d55e00',
      on,
    };
  };

  return (
    <section class="tool geo-tool" data-testid="tool" data-state={loaded ? 'done' : 'idle'}>
      <div class="button-row">
        <MultiDrop icon="file" compact accept=".geojson,.json,.topojson,.kml,.kmz,.gpx,.tcx,.csv" title="Open a map file" onFiles={(f) => f[0] && openFile(f[0])} testId="geo-open" />
        <button type="button" class="button button-small" onClick={() => open('sample.geojson', sample())} data-testid="geo-sample">
          Sample
        </button>
        <button type="button" class="button button-small" onClick={() => setView({ k: 1, x: 0, y: 0 })}>
          Fit to the data
        </button>
        {loaded && (
          <>
            <span class="tone-muted">Save as</span>
            {(['geojson', 'kml', 'gpx', 'csv'] as const).map((k) => (
              <button key={k} type="button" class="button button-small" onClick={() => exportAs(k)} data-testid={`geo-save-${k}`}>
                {k === 'geojson' ? 'GeoJSON' : k.toUpperCase()}
              </button>
            ))}
          </>
        )}
      </div>
      {error && <p class="recipe-error">{error}</p>}
      <div class="geo-layout">
        <div class="geo-map" ref={box}>
          <svg
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            class="geo-svg"
            role="img"
            aria-label="Map"
            data-testid="geo-map"
            onWheel={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - rect.left;
              const py = e.clientY - rect.top;
              const factor = Math.exp(-e.deltaY * 0.0015);
              setView((v) => {
                const k = Math.min(4000, Math.max(0.3, v.k * factor));
                const ratio = k / v.k;
                return { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
              });
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            }}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ll = drawing?.projection.invert?.([e.clientX - rect.left, e.clientY - rect.top]);
              setPointer(ll && Number.isFinite(ll[0]) ? [ll[0], ll[1]] : null);
              const d = drag.current;
              if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          >
            {drawing && (
              <>
                <path d={drawing.sphere} class="geo-sea" />
                <path d={drawing.land} class="geo-land" />
                <path d={drawing.graticule} class="geo-graticule" />
                {loaded?.data.features.map((f, i) => {
                  const shape = drawing.features[i];
                  const s = style(f, i);
                  if (!shape) return null;
                  const title = <title>{featureName(f, i)}</title>;
                  if (shape.points.length) {
                    return (
                      <g key={i} class="geo-feature" onClick={() => setPicked(i)}>
                        {shape.points.map(([x, y], k) => (
                          <circle key={k} cx={x} cy={y} r={s.on ? 7 : 5} fill={s.marker} class={s.on ? 'geo-point is-active' : 'geo-point'}>
                            {title}
                          </circle>
                        ))}
                      </g>
                    );
                  }
                  const area = shape.kind.includes('Polygon');
                  return (
                    <path
                      key={i}
                      d={shape.d}
                      class={`geo-feature${s.on ? ' is-active' : ''}`}
                      fill={area ? s.fill : 'none'}
                      fill-opacity={area ? 0.3 : undefined}
                      stroke={area ? s.fill : s.stroke}
                      stroke-width={s.on ? 4 : 2.4}
                      onClick={() => setPicked(i)}
                    >
                      {title}
                    </path>
                  );
                })}
              </>
            )}
          </svg>
          <p class="geo-status">{pointer ? `${degrees(pointer[1], 'N', 'S')}, ${degrees(pointer[0], 'E', 'W')}` : 'Scroll to zoom, drag to move.'} Land outlines from Natural Earth (public domain).</p>
        </div>
        <aside class="geo-side">
          {loaded ? (
            <>
              <h3 class="geo-title">{loaded.name}</h3>
              <dl class="flt-facts" data-testid="geo-facts">
                <div>
                  <dt>Features</dt>
                  <dd>{loaded.facts.features}</dd>
                </div>
                <div>
                  <dt>Points, lines, areas</dt>
                  <dd>
                    {loaded.facts.points}, {loaded.facts.lines}, {loaded.facts.polygons}
                  </dd>
                </div>
                {loaded.facts.lengthKm > 0 && (
                  <div>
                    <dt>Length of lines</dt>
                    <dd>{km(loaded.facts.lengthKm)}</dd>
                  </div>
                )}
                {loaded.facts.areaKm2 > 0 && (
                  <div>
                    <dt>Area</dt>
                    <dd>{area(loaded.facts.areaKm2)}</dd>
                  </div>
                )}
                {loaded.facts.bounds && (
                  <div>
                    <dt>Bounds (W, S, E, N)</dt>
                    <dd>
                      {loaded.facts.bounds
                        .flat()
                        .map((v) => minus(v.toFixed(4)))
                        .join(', ')}
                    </dd>
                  </div>
                )}
              </dl>
              <ul class="geo-list" data-testid="geo-list">
                {loaded.data.features.slice(0, 500).map((f, i) => (
                  <li key={i}>
                    <button type="button" class={`link-button${i === picked ? ' is-active' : ''}`} onClick={() => setPicked(i)}>
                      {featureName(f, i)}
                    </button>{' '}
                    <span class="tone-muted">{f.geometry?.type}</span>
                  </li>
                ))}
                {loaded.data.features.length > 500 && <li class="tone-muted">and {loaded.data.features.length - 500} more</li>}
              </ul>
              {selected && (
                <div class="geo-picked" data-testid="geo-picked">
                  <h3>{featureName(selected, picked ?? 0)}</h3>
                  {selectedMeasure && selectedMeasure.lengthKm > 0 && <p>Length {km(selectedMeasure.lengthKm)}</p>}
                  {selectedMeasure && selectedMeasure.areaKm2 > 0 && <p>Area {area(selectedMeasure.areaKm2)}</p>}
                  {selectedProfile && (
                    <>
                      <p>
                        {selectedProfile.gain > 0 && `Climb ${Math.round(selectedProfile.gain)} m, descent ${Math.round(selectedProfile.loss)} m. `}
                        {selectedProfile.duration !== null && `Time ${duration(selectedProfile.duration)}, average ${((selectedProfile.totalKm / selectedProfile.duration) * 3600).toFixed(1)} km/h.`}
                      </p>
                      <Profile profile={selectedProfile} />
                    </>
                  )}
                  <table class="data-table">
                    <tbody>
                      {Object.entries(selected.properties ?? {})
                        .filter(([k]) => k !== 'coordinateProperties')
                        .map(([k, v]) => (
                          <tr key={k}>
                            <th>{k}</th>
                            <td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p class="control-help">
              Open a GeoJSON, TopoJSON, KML or KMZ file, a GPX or TCX track from a phone or GPS, or a CSV with latitude and longitude columns. Everything stays on this computer: the map has no online
              tiles, only coastlines.
            </p>
          )}
        </aside>
      </div>
      <p class="control-help">
        <Icon name="info" size={12} /> Country borders are not drawn.
      </p>
    </section>
  );
}

export default defineCustomTool(MapViewer);
