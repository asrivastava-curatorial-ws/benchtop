/**
 * Sun and Moon (sunrise, sunset, twilight, golden hour, moon phase, sun
 * path diagrams, seasons) and Star Chart (the sky over a place at a time:
 * stars, constellations, planets, the Moon and Messier objects).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { minus } from '../../lib/si';
import {
  constellationAt,
  eclipticPoints,
  formatDate,
  formatTime,
  horizontal,
  loadSky,
  moonFacts,
  nextQuarters,
  PLACES,
  type Place,
  planets,
  type SkyData,
  seasons,
  skyRotation,
  starColour,
  sunMoonDay,
  sunPath,
  sunPosition,
  utcToZoned,
  yearCsv,
  zonedToUtc,
} from '../../lib/sky';
import { saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

/* ------------------------------------------------------------ the place -- */

interface PlaceState {
  readonly place: string;
  readonly lat: string;
  readonly lon: string;
  readonly zone: string;
}

const DEFAULT_PLACE = PLACES[0] as Place;

const readPlace = (v: Values | undefined): PlaceState => ({
  place: typeof v?.place === 'string' ? v.place : DEFAULT_PLACE.name,
  lat: typeof v?.lat === 'string' ? v.lat : String(DEFAULT_PLACE.lat),
  lon: typeof v?.lon === 'string' ? v.lon : String(DEFAULT_PLACE.lon),
  zone: typeof v?.zone === 'string' ? v.zone : DEFAULT_PLACE.zone,
});

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return [...new Set(PLACES.map((p) => p.zone)), 'UTC'];
  }
}

function PlacePicker({ state, onChange }: { state: PlaceState; onChange: (next: PlaceState) => void }) {
  const zoneList = useMemo(zones, []);
  return (
    <div class="sky-place">
      <label class="control">
        <span class="control-label">Place</span>
        <select
          class="select"
          value={PLACES.some((p) => p.name === state.place) ? state.place : ''}
          onChange={(e) => {
            const p = PLACES.find((x) => x.name === e.currentTarget.value);
            if (p) onChange({ place: p.name, lat: String(p.lat), lon: String(p.lon), zone: p.zone });
            else onChange({ ...state, place: '' });
          }}
          data-testid="sky-place"
        >
          {PLACES.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
          <option value="">Other place…</option>
        </select>
      </label>
      <label class="control">
        <span class="control-label">Latitude (° north)</span>
        <input class="input" inputMode="decimal" value={state.lat} onInput={(e) => onChange({ ...state, place: '', lat: e.currentTarget.value })} data-testid="sky-lat" />
      </label>
      <label class="control">
        <span class="control-label">Longitude (° east)</span>
        <input class="input" inputMode="decimal" value={state.lon} onInput={(e) => onChange({ ...state, place: '', lon: e.currentTarget.value })} data-testid="sky-lon" />
      </label>
      <label class="control">
        <span class="control-label">Time zone</span>
        <select class="select" value={state.zone} onChange={(e) => onChange({ ...state, zone: e.currentTarget.value })}>
          {!zoneList.includes(state.zone) && <option value={state.zone}>{state.zone}</option>}
          {zoneList.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function coordinates(state: PlaceState): { lat: number; lon: number } | null {
  const lat = Number(state.lat);
  const lon = Number(state.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const today = (zone: string) => utcToZoned(new Date(), zone).slice(0, 10);
const compass = (az: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];
const hm = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, '0')} min`;

/* ----------------------------------------------------------- sun and moon -- */

function MoonPicture({ angle, size = 64 }: { angle: number; size?: number }) {
  const r = size / 2 - 2;
  const waxing = angle <= 180;
  const phi = ((waxing ? angle : 360 - angle) * Math.PI) / 180;
  const rx = Math.abs(Math.cos(phi)) * r;
  const gibbous = phi > Math.PI / 2;
  const lit = `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx.toFixed(2)} ${r} 0 0 ${gibbous ? 1 : 0} 0 ${-r}Z`;
  return (
    <svg viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} width={size} height={size} class="sky-moon" role="img" aria-label="The Moon's phase">
      <circle r={r} class="sky-moon-dark" />
      <path d={lit} class="sky-moon-lit" transform={waxing ? undefined : 'scale(-1 1)'} />
    </svg>
  );
}

const DAY_W = 640;
const DAY_H = 220;

function AltitudeChart({ path, zone, now }: { path: ReturnType<typeof sunPath>; zone: string; now: Date | null }) {
  const left = 40;
  const right = 10;
  const top = 10;
  const bottom = 26;
  const start = path[0]?.t.getTime() ?? 0;
  const end = path[path.length - 1]?.t.getTime() ?? 1;
  const px = (t: number) => left + ((t - start) / (end - start || 1)) * (DAY_W - left - right);
  const py = (a: number) => top + ((90 - a) / 180) * (DAY_H - top - bottom);
  const bands = [
    [0, -6, 'sky-band-civil'],
    [-6, -12, 'sky-band-nautical'],
    [-12, -18, 'sky-band-astro'],
    [-18, -90, 'sky-band-night'],
  ] as const;
  return (
    <svg class="sky-chart" viewBox={`0 0 ${DAY_W} ${DAY_H}`} role="img" aria-label="Height of the Sun through the day">
      {bands.map(([a, b, cls]) => (
        <rect key={cls} x={left} width={DAY_W - left - right} y={py(a)} height={py(b) - py(a)} class={cls} />
      ))}
      {[-60, -30, 0, 30, 60, 90].map((a) => (
        <g key={a}>
          <line x1={left} x2={DAY_W - right} y1={py(a)} y2={py(a)} class={a === 0 ? 'sky-horizon' : 'sky-grid'} />
          <text x={left - 6} y={py(a) + 4} text-anchor="end" class="sky-tick">
            {minus(a)}°
          </text>
        </g>
      ))}
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <text key={h} x={px(start + h * 3600000)} y={DAY_H - 8} text-anchor="middle" class="sky-tick">
          {String(h).padStart(2, '0')}:00
        </text>
      ))}
      <polyline class="sky-sun-line" fill="none" points={path.map((p) => `${px(p.t.getTime()).toFixed(1)},${py(p.altitude).toFixed(1)}`).join(' ')} />
      {now && now.getTime() >= start && now.getTime() <= end && <line x1={px(now.getTime())} x2={px(now.getTime())} y1={top} y2={DAY_H - bottom} class="sky-now" />}
      <text x={DAY_W - right - 4} y={py(0) - 4} text-anchor="end" class="sky-tick">
        horizon ({zone})
      </text>
    </svg>
  );
}

const POLAR = 300;

function PolarSunPath({ place, ymd, zone }: { place: { lat: number; lon: number }; ymd: string; zone: string }) {
  const c = POLAR / 2;
  const R = c - 24;
  const point = (alt: number, az: number) => {
    const r = R * (1 - alt / 90);
    const a = (az * Math.PI) / 180;
    return [c + r * Math.sin(a), c - r * Math.cos(a)] as const;
  };
  const year = Number(ymd.slice(0, 4));
  const curves = [
    { ymd, cls: 'sky-sun-line' },
    { ymd: `${year}-06-21`, cls: 'sky-solstice' },
    { ymd: `${year}-12-21`, cls: 'sky-solstice' },
  ];
  const day = sunPath(place, ymd, zone, 60);
  return (
    <svg class="sky-polar" viewBox={`0 0 ${POLAR} ${POLAR}`} role="img" aria-label="Sun path diagram">
      {[0, 30, 60].map((alt) => (
        <circle key={alt} cx={c} cy={c} r={R * (1 - alt / 90)} class={alt === 0 ? 'sky-horizon' : 'sky-grid'} fill="none" />
      ))}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((az) => {
        const [x, y] = point(0, az);
        return <line key={az} x1={c} y1={c} x2={x} y2={y} class="sky-grid" />;
      })}
      {(['N', 'E', 'S', 'W'] as const).map((label, i) => {
        const [x, y] = point(-12, i * 90);
        return (
          <text key={label} x={x} y={y + 4} text-anchor="middle" class="sky-cardinal">
            {label}
          </text>
        );
      })}
      {curves.map((curve) => {
        const pts = sunPath(place, curve.ymd, zone, 15).filter((p) => p.altitude >= 0);
        return <polyline key={curve.ymd + curve.cls} class={curve.cls} fill="none" points={pts.map((p) => point(p.altitude, p.azimuth).join(',')).join(' ')} />;
      })}
      {day
        .filter((p) => p.altitude > 0)
        .map((p) => {
          const [x, y] = point(p.altitude, p.azimuth);
          return (
            <g key={p.t.getTime()}>
              <circle cx={x} cy={y} r={2.5} class="sky-sun-dot" />
              <text x={x + 4} y={y - 4} class="sky-tick">
                {formatTime(p.t, zone).slice(0, 2)}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

interface SunState extends PlaceState {
  readonly date: string;
}

function SunMoon({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState<SunState>(
    toolId,
    (v) => ({ ...readPlace(v), date: '' }),
    ({ date: _date, ...rest }) => ({ ...rest }),
  );
  const place = coordinates(state);
  const ymd = state.date || today(state.zone);
  const result = useMemo(() => {
    if (!place) return null;
    try {
      return {
        day: sunMoonDay(place, ymd, state.zone),
        path: sunPath(place, ymd, state.zone, 10),
        quarters: nextQuarters(zonedToUtc(`${ymd}T00:00`, state.zone)),
        seasons: seasons(Number(ymd.slice(0, 4))),
      };
    } catch {
      return null;
    }
  }, [state.lat, state.lon, state.zone, ymd]);
  const isToday = ymd === today(state.zone);
  const now = isToday ? new Date() : null;
  const sunNow = place && now ? sunPosition(place, now) : null;
  const t = (d: Date | null) => formatTime(d, state.zone);
  const day = result?.day;

  return (
    <section class="tool sky-tool" data-testid="tool" data-state={day ? 'done' : 'idle'}>
      <PlacePicker state={state} onChange={(next) => setState((s) => ({ ...s, ...next }))} />
      <div class="button-row">
        <label class="control control-inline">
          <span class="control-label">Date</span>
          <input class="input" type="date" value={ymd} onInput={(e) => setState((s) => ({ ...s, date: e.currentTarget.value }))} data-testid="sky-date" />
        </label>
        <button type="button" class="button button-small" onClick={() => setState((s) => ({ ...s, date: '' }))}>
          Today
        </button>
        <button
          type="button"
          class="button button-small"
          disabled={!place}
          onClick={() =>
            attempt(async () => {
              if (!place) return;
              const year = Number(ymd.slice(0, 4));
              const outcome = await saveFile(`sunrise and sunset ${year} ${state.place || `${state.lat},${state.lon}`}.csv`, yearCsv(place, year, state.zone), 'text/csv');
              if (outcome.saved) notify(`Saved to ${outcome.location}`);
            })
          }
        >
          <Icon name="save" size={12} /> Whole year as CSV
        </button>
      </div>
      {!place && <p class="recipe-error">Enter a latitude from −90 to 90 and a longitude from −180 to 180 (west is negative).</p>}
      {day && result && (
        <>
          <p class="sky-day-title">{formatDate(zonedToUtc(`${ymd}T12:00`, state.zone), state.zone)}</p>
          <div class="sky-cards" data-testid="sky-sun">
            <div class="sky-card">
              <span class="sky-label">Sunrise</span>
              <span class="sky-value">{day.polar === 'day' ? 'Sun up all day' : day.polar === 'night' ? 'Sun down all day' : t(day.sunrise)}</span>
            </div>
            <div class="sky-card">
              <span class="sky-label">Sunset</span>
              <span class="sky-value">{day.polar ? '–' : t(day.sunset)}</span>
            </div>
            <div class="sky-card">
              <span class="sky-label">Solar noon</span>
              <span class="sky-value">{t(day.noon)}</span>
              <span class="sky-note">Sun {day.noonAltitude.toFixed(1)}° up</span>
            </div>
            <div class="sky-card">
              <span class="sky-label">Daylight</span>
              <span class="sky-value">{hm(day.daylight)}</span>
            </div>
            <div class="sky-card">
              <span class="sky-label">Golden hour</span>
              <span class="sky-value sky-value-small">
                until {t(day.golden[0])}, from {t(day.golden[1])}
              </span>
            </div>
          </div>
          <table class="data-table sky-twilight" data-testid="sky-twilight">
            <thead>
              <tr>
                <th>Twilight</th>
                <th>Morning starts</th>
                <th>Evening ends</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Civil</td>
                <td>{t(day.civil[0])}</td>
                <td>{t(day.civil[1])}</td>
                <td class="tone-muted">Sun up to 6° below the horizon: outdoor work needs no lights</td>
              </tr>
              <tr>
                <td>Nautical</td>
                <td>{t(day.nautical[0])}</td>
                <td>{t(day.nautical[1])}</td>
                <td class="tone-muted">To 12° below: the horizon at sea is still visible</td>
              </tr>
              <tr>
                <td>Astronomical</td>
                <td>{t(day.astronomical[0])}</td>
                <td>{t(day.astronomical[1])}</td>
                <td class="tone-muted">To 18° below: after this the sky is fully dark</td>
              </tr>
            </tbody>
          </table>
          {sunNow && (
            <p class="sky-now-line">
              Now the Sun is {Math.abs(sunNow.altitude).toFixed(1)}° {sunNow.altitude >= 0 ? 'above' : 'below'} the horizon, towards {compass(sunNow.azimuth)} ({sunNow.azimuth.toFixed(0)}°)
              {sunNow.altitude > 1 && `; a 1 m stick casts a ${(1 / Math.tan((sunNow.altitude * Math.PI) / 180)).toFixed(2)} m shadow`}.
            </p>
          )}
          <div class="sky-diagrams">
            <AltitudeChart path={result.path} zone={state.zone} now={now} />
            {place && <PolarSunPath place={place} ymd={ymd} zone={state.zone} />}
          </div>
          <p class="control-help">Left: the Sun's height through the day, with the bands of twilight. Right: its path across the sky as seen from above (north up), with the solstices dashed.</p>
          <div class="sky-moon-row" data-testid="sky-moon">
            <MoonPicture angle={day.moon.angle} />
            <div>
              <strong>{day.moon.name}</strong>
              <p>
                {(day.moon.illuminated * 100).toFixed(0)} % lit, {day.moon.age.toFixed(1)} days old. Moonrise {t(day.moonrise)}, moonset {t(day.moonset)}.
              </p>
            </div>
          </div>
          <div class="sky-lists">
            <div>
              <h3>Next phases</h3>
              <ul>
                {result.quarters.map((q) => (
                  <li key={q.date.getTime()}>
                    {q.name}: {formatDate(q.date, state.zone)}, {t(q.date)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Seasons in {ymd.slice(0, 4)}</h3>
              <ul>
                {result.seasons.map((q) => (
                  <li key={q.name}>
                    {q.name}: {formatDate(q.date, state.zone)}, {t(q.date)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
      <p class="control-help">Times include refraction by the air and are for flat ground at sea level. Calculated on this computer with Astronomy Engine.</p>
    </section>
  );
}

/* ------------------------------------------------------------ star chart -- */

interface ChartState extends PlaceState {
  readonly lines: boolean;
  readonly labels: boolean;
  readonly starNames: boolean;
  readonly messier: boolean;
  readonly grid: boolean;
  readonly ecliptic: boolean;
  readonly night: boolean;
  readonly limit: number;
}

const readChart = (v: Values | undefined): ChartState => ({
  ...readPlace(v),
  lines: v?.lines !== false,
  labels: v?.labels !== false,
  starNames: v?.starNames !== false,
  messier: v?.messier === true,
  grid: v?.grid === true,
  ecliptic: v?.ecliptic === true,
  night: v?.night === true,
  limit: typeof v?.limit === 'number' ? v.limit : 5.5,
});

interface Picked {
  readonly title: string;
  readonly detail: string;
}

interface Hit {
  readonly x: number;
  readonly y: number;
  readonly picked: Picked;
}

function StarChart({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readChart, (s) => ({ ...s }));
  const [sky, setSky] = useState<SkyData | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [when, setWhen] = useState<string>(() => utcToZoned(new Date(), readChart(undefined).zone));
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hits = useRef<Hit[]>([]);
  const place = coordinates(state);
  const instant = zonedToUtc(when, state.zone);
  const set = <K extends keyof ChartState>(k: K, v: ChartState[K]) => setState((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    loadSky().then(setSky, (e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    setWhen(utcToZoned(new Date(), state.zone));
  }, [state.zone]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setWhen((w) => utcToZoned(new Date(zonedToUtc(w, state.zone).getTime() + 5 * 60000), state.zone)), 80);
    return () => clearInterval(timer);
  }, [playing, state.zone]);

  const bodies = useMemo(() => (place && Number.isFinite(instant.getTime()) ? planets(place, instant) : []), [state.lat, state.lon, instant.getTime()]);
  const moon = useMemo(() => (Number.isFinite(instant.getTime()) ? moonFacts(instant) : null), [instant.getTime()]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !sky || !place || !Number.isFinite(instant.getTime())) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const size = el.clientWidth;
      el.width = Math.round(size * ratio);
      el.height = Math.round(size * ratio);
      const g = el.getContext('2d');
      if (!g) return;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      const c = size / 2;
      const R = c - 26;
      const red = state.night;
      const ink = red ? '#ff6b5b' : '#e8eef5';
      const faint = red ? 'rgba(255,90,70,0.35)' : 'rgba(170,190,215,0.35)';
      g.fillStyle = red ? '#120404' : '#0b1220';
      g.fillRect(0, 0, size, size);
      g.save();
      g.beginPath();
      g.arc(c, c, R, 0, 2 * Math.PI);
      g.fillStyle = red ? '#1c0606' : '#0f1b30';
      g.fill();
      g.clip();
      const rot = skyRotation(place, instant);
      const project = (alt: number, az: number): [number, number] | null => {
        if (alt < -0.5) return null;
        const r = R * Math.tan(((90 - alt) * Math.PI) / 360);
        const a = (az * Math.PI) / 180;
        return [c - r * Math.sin(a), c - r * Math.cos(a)];
      };
      const at = (ra: number, dec: number) => {
        const h = horizontal(rot, ra, dec);
        return project(h.altitude, h.azimuth);
      };
      const found: Hit[] = [];
      g.lineWidth = 1;
      if (state.grid) {
        g.strokeStyle = faint;
        for (const alt of [30, 60]) {
          g.beginPath();
          g.arc(c, c, R * Math.tan(((90 - alt) * Math.PI) / 360), 0, 2 * Math.PI);
          g.stroke();
        }
        for (let az = 0; az < 360; az += 30) {
          const p = project(0, az);
          if (!p) continue;
          g.beginPath();
          g.moveTo(c, c);
          g.lineTo(p[0], p[1]);
          g.stroke();
        }
      }
      if (state.ecliptic) {
        g.strokeStyle = red ? 'rgba(255,120,60,0.6)' : 'rgba(230,180,80,0.6)';
        g.setLineDash([4, 4]);
        g.beginPath();
        let pen = false;
        for (const [ra, dec] of eclipticPoints(180)) {
          const p = at(ra, dec);
          if (!p) {
            pen = false;
            continue;
          }
          if (pen) g.lineTo(p[0], p[1]);
          else g.moveTo(p[0], p[1]);
          pen = true;
        }
        g.stroke();
        g.setLineDash([]);
      }
      if (state.lines) {
        g.strokeStyle = red ? 'rgba(255,80,60,0.45)' : 'rgba(120,160,220,0.55)';
        for (const figure of Object.values(sky.lines)) {
          for (const line of figure) {
            g.beginPath();
            let pen = false;
            for (const [ra, dec] of line) {
              const p = at(ra, dec);
              if (!p) {
                pen = false;
                continue;
              }
              if (pen) g.lineTo(p[0], p[1]);
              else g.moveTo(p[0], p[1]);
              pen = true;
            }
            g.stroke();
          }
        }
      }
      for (const [ra, dec, mag, bv, hip] of sky.stars) {
        if (mag > state.limit) continue;
        const p = at(ra, dec);
        if (!p) continue;
        const radius = Math.max(0.6, 3.6 - 0.6 * mag) * (size / 720);
        g.fillStyle = red ? '#ff5a46' : starColour(bv);
        g.beginPath();
        g.arc(p[0], p[1], radius, 0, 2 * Math.PI);
        g.fill();
        const name = sky.names[String(hip)];
        if (mag < 4.5) {
          const h = horizontal(rot, ra, dec);
          found.push({
            x: p[0],
            y: p[1],
            picked: {
              title: name?.[0] || `${name?.[1] ? `${name[1]} ` : ''}${constellationAt(ra, dec).name}`.trim() || `HIP ${hip}`,
              detail: `Star, magnitude ${mag}. ${describe(h.altitude, h.azimuth)}. RA ${(ra / 15).toFixed(2)} h, Dec ${minus(dec.toFixed(1))}°.`,
            },
          });
        }
        if (state.starNames && name?.[0] && mag < 2.2) {
          g.fillStyle = faint.replace('0.35', '0.9');
          g.font = `${Math.round(11 * (size / 720))}px system-ui, sans-serif`;
          g.fillText(name[0], p[0] + radius + 3, p[1] + 3);
        }
      }
      if (state.messier) {
        g.strokeStyle = red ? '#ff7a66' : '#9be7c4';
        for (const [id, ra, dec, mag, , common] of sky.messier) {
          const p = at(ra, dec);
          if (!p) continue;
          g.beginPath();
          g.arc(p[0], p[1], 3.5, 0, 2 * Math.PI);
          g.stroke();
          const h = horizontal(rot, ra, dec);
          found.push({
            x: p[0],
            y: p[1],
            picked: { title: `${id}${common ? ` (${common})` : ''}`, detail: `Messier object, magnitude ${mag === 99 ? 'unknown' : mag}. ${describe(h.altitude, h.azimuth)}.` },
          });
        }
      }
      if (state.labels) {
        g.fillStyle = red ? 'rgba(255,110,90,0.75)' : 'rgba(160,190,230,0.8)';
        g.font = `${Math.round(10.5 * (size / 720))}px system-ui, sans-serif`;
        g.textAlign = 'center';
        for (const [, name, ra, dec, rank] of sky.constellations) {
          if (rank > 2) continue;
          const p = at(ra, dec);
          if (p) g.fillText(name.toUpperCase(), p[0], p[1]);
        }
        g.textAlign = 'start';
      }
      for (const b of bodies) {
        const p = project(b.altitude, b.azimuth);
        if (!p) continue;
        const sun = b.name === 'Sun';
        const isMoon = b.name === 'Moon';
        g.fillStyle = red ? '#ff7a66' : sun ? '#ffd34d' : isMoon ? '#f2f2e8' : '#ffb3e6';
        g.beginPath();
        g.arc(p[0], p[1], sun || isMoon ? 7 : 4, 0, 2 * Math.PI);
        g.fill();
        g.fillStyle = ink;
        g.font = `600 ${Math.round(12 * (size / 720))}px system-ui, sans-serif`;
        g.fillText(b.name, p[0] + 9, p[1] - 6);
        found.push({ x: p[0], y: p[1], picked: { title: b.name, detail: `${b.magnitude !== null ? `Magnitude ${b.magnitude.toFixed(1)}. ` : ''}${describe(b.altitude, b.azimuth)}.` } });
      }
      g.restore();
      g.strokeStyle = ink;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(c, c, R, 0, 2 * Math.PI);
      g.stroke();
      g.fillStyle = ink;
      g.font = `600 ${Math.round(14 * (size / 720))}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [label, az] of [
        ['N', 0],
        ['E', 90],
        ['S', 180],
        ['W', 270],
      ] as const) {
        const a = (az * Math.PI) / 180;
        g.fillText(label, c - (R + 14) * Math.sin(a), c - (R + 14) * Math.cos(a));
      }
      g.textAlign = 'start';
      g.textBaseline = 'alphabetic';
      hits.current = found;
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sky, state, instant.getTime(), bodies]);

  const shift = (minutes: number) => setWhen((w) => utcToZoned(new Date(zonedToUtc(w, state.zone).getTime() + minutes * 60000), state.zone));
  const visible = bodies.filter((b) => b.altitude > 0);

  return (
    <section class="tool sky-tool" data-testid="tool" data-state={sky ? 'done' : 'idle'}>
      <PlacePicker state={state} onChange={(next) => setState((s) => ({ ...s, ...next }))} />
      <div class="button-row">
        <label class="control control-inline">
          <span class="control-label">Date and time</span>
          <input class="input" type="datetime-local" value={when} onInput={(e) => e.currentTarget.value && setWhen(e.currentTarget.value)} data-testid="sky-when" />
        </label>
        <button type="button" class="button button-small" onClick={() => shift(-1440)}>
          −1 day
        </button>
        <button type="button" class="button button-small" onClick={() => shift(-60)}>
          −1 h
        </button>
        <button type="button" class="button button-small" onClick={() => setWhen(utcToZoned(new Date(), state.zone))}>
          Now
        </button>
        <button type="button" class="button button-small" onClick={() => shift(60)}>
          +1 h
        </button>
        <button type="button" class="button button-small" onClick={() => shift(1440)}>
          +1 day
        </button>
        <button type="button" class="button button-small" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
          <Icon name="play" size={12} /> {playing ? 'Stop' : 'Run the clock'}
        </button>
      </div>
      <div class="button-row sky-layers">
        {(
          [
            ['lines', 'Constellation lines'],
            ['labels', 'Constellation names'],
            ['starNames', 'Star names'],
            ['messier', 'Messier objects'],
            ['ecliptic', 'Ecliptic'],
            ['grid', 'Altitude grid'],
            ['night', 'Red night view'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} class="check">
            <input type="checkbox" checked={state[key]} onChange={(e) => set(key, e.currentTarget.checked)} /> {label}
          </label>
        ))}
        <label class="control control-inline">
          <span class="control-label">Faintest stars</span>
          <input type="range" min={2} max={6} step={0.5} value={state.limit} onInput={(e) => set('limit', Number(e.currentTarget.value))} aria-label="Faintest magnitude shown" />
          <span class="tone-muted">{state.limit}</span>
        </label>
      </div>
      {failure && <p class="recipe-error">{failure}</p>}
      {!place && <p class="recipe-error">Enter a latitude from −90 to 90 and a longitude from −180 to 180.</p>}
      <div class="sky-chart-layout">
        <canvas
          ref={canvas}
          class="sky-canvas"
          role="img"
          aria-label="Chart of the sky overhead, north at the top and east on the left"
          data-testid="sky-canvas"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            let best: Hit | null = null;
            let distance = 14;
            for (const h of hits.current) {
              const d = Math.hypot(h.x - x, h.y - y);
              if (d < distance) {
                distance = d;
                best = h;
              }
            }
            setPicked(best?.picked ?? null);
          }}
        />
        <aside class="sky-side">
          {picked ? (
            <div class="sky-picked" data-testid="sky-picked">
              <strong>{picked.title}</strong>
              <p>{picked.detail}</p>
            </div>
          ) : (
            <p class="control-help">Hold the chart above your head with its top to the north: east is then on the left. Click a star, planet or object to name it.</p>
          )}
          <h3>Above the horizon</h3>
          <ul class="sky-bodies" data-testid="sky-bodies">
            {visible.length === 0 && <li class="tone-muted">No planets, Sun or Moon are up.</li>}
            {visible.map((b) => (
              <li key={b.name}>
                <strong>{b.name}</strong> {describe(b.altitude, b.azimuth)}
                {b.name === 'Moon' && moon ? `, ${moon.name.toLowerCase()} (${(moon.illuminated * 100).toFixed(0)} % lit)` : ''}
              </li>
            ))}
          </ul>
          <p class="control-help">
            {sky ? `${sky.stars.filter((s) => s[2] <= state.limit).length} stars to magnitude ${state.limit}.` : 'Loading the stars…'} Star data from the Hipparcos catalogue via d3-celestial;
            positions by Astronomy Engine.
          </p>
        </aside>
      </div>
    </section>
  );
}

const describe = (alt: number, az: number) => `${alt.toFixed(0)}° up towards ${compass(az)} (${az.toFixed(0)}°)`;

function SkyTools({ toolId }: { toolId: string }) {
  if (toolId === 'star-chart') return <StarChart toolId={toolId} />;
  return <SunMoon toolId={toolId} />;
}

export default defineCustomTool(SkyTools);
