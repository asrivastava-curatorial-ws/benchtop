/**
 * Kundli: a Vedic birth chart (North or South Indian style) with the
 * grahas' sidereal positions, nakshatras, divisional charts, the panchang
 * of the birth moment, Vimshottari dashas and Ashtakoota matching; and the
 * day's panchang for any place.  English or Hindi.
 */
import { useMemo } from 'preact/hooks';
import { timeZones, zonedToEpoch } from '../../lib/datetime';
import {
  type Chart,
  chart,
  DASHA_LORDS,
  dms,
  type Graha,
  grahaName,
  gunaMilan,
  INDIAN_PLACES,
  type Lang,
  lagnaName,
  manglik,
  monthName,
  type NodeKind,
  nakshatraLord,
  nakshatraName,
  type Panchang,
  panchang,
  runningDasha,
  SIGN_LORDS,
  signName,
  VARGA_NAMES,
  VARGAS,
  type Varga,
  varaName,
  varga,
  vimshottari,
  type Zodiac,
} from '../../lib/kundli';
import { PLACES } from '../../lib/sky';
import { escapeXml } from '../../lib/text';
import { htmlToPdf, isDesktop, saveFile } from '../../platform';
import { printDocument } from '../../ui/print';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Mode = 'chart' | 'panchang' | 'match';
type Style = 'north' | 'south';

interface Birth {
  readonly name: string;
  readonly date: string;
  readonly time: string;
  readonly place: string;
  readonly lat: number;
  readonly lon: number;
  readonly zone: string;
}

interface KundliState {
  readonly mode: Mode;
  readonly style: Style;
  readonly lang: Lang;
  readonly node: NodeKind;
  readonly zodiac: Zodiac;
  readonly divisional: Varga;
  readonly person: Birth;
  readonly bride: Birth;
  readonly groom: Birth;
  readonly day: Birth;
}

const ALL_PLACES = [...PLACES, ...INDIAN_PLACES.filter((p) => !PLACES.some((q) => q.name === p.name))].sort((a, b) => a.name.localeCompare(b.name));
const OTHER = '__other';
const today = () => new Date().toISOString().slice(0, 10);
const BENGALURU = ALL_PLACES.find((p) => p.name === 'Bengaluru') ?? { name: 'Bengaluru', lat: 12.9716, lon: 77.5946, zone: 'Asia/Kolkata' };
const blank = (name: string, date: string, time: string): Birth => ({ name, date, time, place: BENGALURU.name, lat: BENGALURU.lat, lon: BENGALURU.lon, zone: BENGALURU.zone });

const readBirth = (v: unknown, fallback: Birth): Birth => {
  if (!v || typeof v !== 'object') return fallback;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && x >= lo && x <= hi ? x : d);
  return {
    name: typeof o.name === 'string' ? o.name.slice(0, 80) : fallback.name,
    date: typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : fallback.date,
    time: typeof o.time === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(o.time) ? o.time : fallback.time,
    place: typeof o.place === 'string' ? o.place : fallback.place,
    lat: num(o.lat, -90, 90, fallback.lat),
    lon: num(o.lon, -180, 180, fallback.lon),
    zone: typeof o.zone === 'string' && o.zone ? o.zone : fallback.zone,
  };
};
const read = (v: Values | undefined): KundliState => ({
  mode: v?.mode === 'panchang' || v?.mode === 'match' ? v.mode : 'chart',
  style: v?.style === 'south' ? 'south' : 'north',
  lang: v?.lang === 'hi' ? 'hi' : 'en',
  node: v?.node === 'true' ? 'true' : 'mean',
  zodiac: v?.zodiac === 'tropical' ? 'tropical' : 'lahiri',
  divisional: (VARGAS as readonly number[]).includes(Number(v?.divisional)) ? (Number(v?.divisional) as Varga) : 9,
  person: readBirth(v?.person, blank('', '1990-01-01', '06:30:00')),
  bride: readBirth(v?.bride, blank('Bride', '1995-03-10', '08:15:00')),
  groom: readBirth(v?.groom, blank('Groom', '1993-07-22', '17:40:00')),
  day: readBirth(v?.day, blank('', today(), '12:00:00')),
});
const write = (s: KundliState): Values => ({ ...s }) as unknown as Values;

/** The UTC instant of a birth's local date and time. */
function instantOf(b: Birth): Date {
  const [y, m, d] = b.date.split('-').map(Number);
  const [h = 0, mi = 0, sec = 0] = b.time.split(':').map(Number);
  return new Date(zonedToEpoch(b.zone, y ?? 2000, m ?? 1, d ?? 1, h, mi, sec));
}

const fmt = (date: Date | null, zone: string, withDate = false) =>
  date
    ? new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...(withDate ? { day: 'numeric', month: 'short', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
    : '–';
const dateOnly = (date: Date, zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(date);

/* ------------------------------------------------------------------ charts -- */

interface Occupant {
  readonly label: string;
  readonly retro: boolean;
}

/** What sits in each sign: the ascendant and the grahas. */
function occupants(c: Chart, d: Varga, lang: Lang): { lagna: number; bySign: Occupant[][] } {
  const v = varga(c, d);
  const bySign: Occupant[][] = Array.from({ length: 12 }, () => []);
  (bySign[v.lagna] as Occupant[]).push({ label: lagnaName(lang, true), retro: false });
  for (const g of v.grahas) (bySign[g.sign] as Occupant[]).push({ label: grahaName(g.graha, lang, true), retro: g.retrograde && g.graha !== 'rahu' && g.graha !== 'ketu' });
  return { lagna: v.lagna, bySign };
}

const S = 300;
const NORTH_HOUSES: readonly { poly: string; at: readonly [number, number]; sign: readonly [number, number] }[] = (() => {
  const q = S / 4;
  const pts = {
    A: [0, 0],
    B: [S, 0],
    C: [S, S],
    D: [0, S],
    M1: [S / 2, 0],
    M2: [S, S / 2],
    M3: [S / 2, S],
    M4: [0, S / 2],
    O: [S / 2, S / 2],
    P: [q, q],
    Q: [3 * q, q],
    R: [q, 3 * q],
    T: [3 * q, 3 * q],
  } as const;
  const poly = (...names: (keyof typeof pts)[]) => names.map((n) => pts[n].join(',')).join(' ');
  return [
    { poly: poly('M1', 'Q', 'O', 'P'), at: [S / 2, q], sign: [S / 2, S / 2 - 16] },
    { poly: poly('A', 'M1', 'P'), at: [q, S / 12 + 2], sign: [q, q - 12] },
    { poly: poly('A', 'P', 'M4'), at: [S / 12, q], sign: [q - 14, q + 4] },
    { poly: poly('M4', 'P', 'O', 'R'), at: [q, S / 2], sign: [S / 2 - 16, S / 2 + 4] },
    { poly: poly('M4', 'R', 'D'), at: [S / 12, 3 * q], sign: [q - 14, 3 * q + 4] },
    { poly: poly('D', 'R', 'M3'), at: [q, (11 * S) / 12 - 2], sign: [q, 3 * q + 18] },
    { poly: poly('M3', 'R', 'O', 'T'), at: [S / 2, 3 * q], sign: [S / 2, S / 2 + 22] },
    { poly: poly('M3', 'T', 'C'), at: [3 * q, (11 * S) / 12 - 2], sign: [3 * q, 3 * q + 18] },
    { poly: poly('C', 'T', 'M2'), at: [(11 * S) / 12, 3 * q], sign: [3 * q + 14, 3 * q + 4] },
    { poly: poly('M2', 'T', 'O', 'Q'), at: [3 * q, S / 2], sign: [S / 2 + 16, S / 2 + 4] },
    { poly: poly('M2', 'Q', 'B'), at: [(11 * S) / 12, q], sign: [3 * q + 14, q + 4] },
    { poly: poly('B', 'Q', 'M1'), at: [3 * q, S / 12 + 2], sign: [3 * q, q - 12] },
  ];
})();

/** Rows of up to `per` labels, centred on a point. */
function Labels({ items, x, y, per, size }: { items: readonly Occupant[]; x: number; y: number; per: number; size: number }) {
  const rows: Occupant[][] = [];
  for (let i = 0; i < items.length; i += per) rows.push(items.slice(i, i + per));
  const lh = size + 3;
  const top = y - ((rows.length - 1) * lh) / 2;
  return (
    <>
      {rows.map((row, r) => (
        <text key={r} x={x} y={top + r * lh + size / 3} text-anchor="middle" class="kd-graha" font-size={size}>
          {row.map((o, i) => (
            <tspan key={`${o.label}${i}`}>
              {i > 0 ? ' ' : ''}
              {o.label}
              {o.retro && <tspan font-size={size * 0.7}>(R)</tspan>}
            </tspan>
          ))}
        </text>
      ))}
    </>
  );
}

function NorthChart({ c, d, lang, title }: { c: Chart; d: Varga; lang: Lang; title: string }) {
  const { lagna, bySign } = occupants(c, d, lang);
  return (
    <svg class="kd-chart" viewBox={`-2 -2 ${S + 4} ${S + 4}`} role="img" aria-label={`${title}, North Indian style`}>
      <rect x={0} y={0} width={S} height={S} class="kd-frame" />
      <path d={`M0 0L${S} ${S}M${S} 0L0 ${S}M${S / 2} 0L${S} ${S / 2}L${S / 2} ${S}L0 ${S / 2}Z`} class="kd-lines" />
      {NORTH_HOUSES.map((h, i) => {
        const sign = (lagna + i) % 12;
        const items = bySign[sign] as Occupant[];
        const kendra = i % 3 === 0;
        return (
          <g key={h.poly}>
            <text x={h.sign[0]} y={h.sign[1]} text-anchor="middle" class="kd-sign-number">
              {sign + 1}
            </text>
            <Labels items={items} x={h.at[0]} y={h.at[1]} per={kendra ? 3 : 2} size={items.length > 4 ? 10 : 12} />
          </g>
        );
      })}
    </svg>
  );
}

/** South Indian chart: the signs keep their places; Pisces is at the top left. */
const SOUTH_CELLS: readonly (readonly [number, number])[] = [
  [1, 0],
  [2, 0],
  [3, 0],
  [3, 1],
  [3, 2],
  [3, 3],
  [2, 3],
  [1, 3],
  [0, 3],
  [0, 2],
  [0, 1],
  [0, 0],
];

function SouthChart({ c, d, lang, title }: { c: Chart; d: Varga; lang: Lang; title: string }) {
  const { lagna, bySign } = occupants(c, d, lang);
  const w = S / 4;
  return (
    <svg class="kd-chart" viewBox={`-2 -2 ${S + 4} ${S + 4}`} role="img" aria-label={`${title}, South Indian style`}>
      {SOUTH_CELLS.map(([col, row], sign) => {
        const x = col * w;
        const y = row * w;
        const items = (bySign[sign] as Occupant[]).filter((o) => o.label !== lagnaName(lang, true));
        return (
          <g key={sign}>
            <rect x={x} y={y} width={w} height={w} class="kd-frame" />
            <text x={x + 4} y={y + 11} class="kd-sign-small">
              {signName(sign, lang).replace(/ \(.*\)$/, '')}
            </text>
            {sign === lagna && (
              <>
                <line x1={x} y1={y + 18} x2={x + 18} y2={y} class="kd-lines" />
                <text x={x + w - 4} y={y + 12} text-anchor="end" class="kd-asc">
                  {lagnaName(lang, true)}
                </text>
              </>
            )}
            <Labels items={items} x={x + w / 2} y={y + w / 2 + 6} per={2} size={items.length > 4 ? 10 : 12} />
          </g>
        );
      })}
      <text x={S / 2} y={S / 2 - 6} text-anchor="middle" class="kd-centre">
        {title}
      </text>
    </svg>
  );
}

/* -------------------------------------------------------------- the forms -- */

function BirthForm({
  value,
  onChange,
  label,
  test,
  withName = true,
  withTime = true,
}: {
  value: Birth;
  onChange: (b: Birth) => void;
  label: string;
  test: string;
  withName?: boolean;
  withTime?: boolean;
}) {
  const zones = useMemo(() => timeZones(), []);
  const known = ALL_PLACES.some((p) => p.name === value.place);
  const set = (patch: Partial<Birth>) => onChange({ ...value, ...patch });
  return (
    <fieldset class="kd-form" data-testid={test}>
      <legend class="control-label">{label}</legend>
      {withName && (
        <label class="kd-field kd-wide">
          <span class="control-label">Name</span>
          <input class="input" value={value.name} maxLength={80} onInput={(e) => set({ name: e.currentTarget.value })} />
        </label>
      )}
      <label class="kd-field">
        <span class="control-label">Date</span>
        <input
          class="input"
          type="date"
          value={value.date}
          min="1600-01-01"
          max="2400-12-31"
          onChange={(e) => e.currentTarget.value && set({ date: e.currentTarget.value })}
          data-testid={`${test}-date`}
        />
      </label>
      {withTime && (
        <label class="kd-field">
          <span class="control-label">Time</span>
          <input
            class="input"
            type="time"
            step={1}
            value={value.time}
            onChange={(e) => e.currentTarget.value && set({ time: e.currentTarget.value.length === 5 ? `${e.currentTarget.value}:00` : e.currentTarget.value })}
            data-testid={`${test}-time`}
          />
        </label>
      )}
      <label class="kd-field kd-wide">
        <span class="control-label">Place</span>
        <select
          class="select"
          value={known ? value.place : OTHER}
          onChange={(e) => {
            const p = ALL_PLACES.find((x) => x.name === e.currentTarget.value);
            if (p) set({ place: p.name, lat: p.lat, lon: p.lon, zone: p.zone });
            else set({ place: '' });
          }}
          data-testid={`${test}-place`}
        >
          {ALL_PLACES.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
          <option value={OTHER}>Another place (enter its latitude and longitude)…</option>
        </select>
      </label>
      {!known && (
        <label class="kd-field kd-wide">
          <span class="control-label">Place name</span>
          <input class="input" value={value.place} maxLength={80} onInput={(e) => set({ place: e.currentTarget.value })} />
        </label>
      )}
      <label class="kd-field">
        <span class="control-label">Latitude (°N)</span>
        <input
          class="input input-number"
          type="number"
          step="0.0001"
          min={-90}
          max={90}
          value={value.lat}
          readOnly={known}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v) && Math.abs(v) <= 90) set({ lat: v });
          }}
          data-testid={`${test}-lat`}
        />
      </label>
      <label class="kd-field">
        <span class="control-label">Longitude (°E)</span>
        <input
          class="input input-number"
          type="number"
          step="0.0001"
          min={-180}
          max={180}
          value={value.lon}
          readOnly={known}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v) && Math.abs(v) <= 180) set({ lon: v });
          }}
          data-testid={`${test}-lon`}
        />
      </label>
      <label class="kd-field kd-wide">
        <span class="control-label">Time zone</span>
        <select class="select" value={value.zone} onChange={(e) => set({ zone: e.currentTarget.value })}>
          {(zones.includes(value.zone) ? zones : [value.zone, ...zones]).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

/* ---------------------------------------------------------------- the tool -- */

const DIGNITY: Record<string, string> = { exalted: 'Exalted', debilitated: 'Debilitated', own: 'Own sign' };

function PanchangTable({ p, zone, lang }: { p: Panchang; zone: string; lang: Lang }) {
  const until = (d: Date | null) => (d ? ` until ${fmt(d, zone, true)}` : '');
  return (
    <table class="data-table kd-table" data-testid="kd-panchang">
      <tbody>
        <tr>
          <th scope="row">Tithi</th>
          <td>
            {p.tithi.name}
            {until(p.tithi.ends)}
          </td>
        </tr>
        <tr>
          <th scope="row">Vara</th>
          <td>
            {varaName(p.vara, lang)}
            {p.beforeSunrise ? ' (before sunrise, the Hindu day is still the previous one)' : ''}
          </td>
        </tr>
        <tr>
          <th scope="row">Nakshatra</th>
          <td>
            {p.nakshatra.name}
            {until(p.nakshatra.ends)}
          </td>
        </tr>
        <tr>
          <th scope="row">Yoga</th>
          <td>
            {p.yoga.name}
            {until(p.yoga.ends)}
          </td>
        </tr>
        <tr>
          <th scope="row">Karana</th>
          <td>
            {p.karana.name}
            {until(p.karana.ends)}
          </td>
        </tr>
        <tr>
          <th scope="row">Month</th>
          <td>
            {p.adhika ? `${lang === 'hi' ? 'अधिक' : 'Adhika'} ` : ''}
            {monthName(p.amanta, lang)} (amanta), {monthName(p.purnimanta, lang)} (purnimanta)
          </td>
        </tr>
        <tr>
          <th scope="row">Samvat</th>
          <td>
            Vikram {p.vikramSamvat}, Shaka {p.shakaSamvat}
          </td>
        </tr>
        <tr>
          <th scope="row">Sun and Moon</th>
          <td>
            Sun in {signName(p.sunSign, lang)}, Moon in {signName(p.moonSign, lang)}
          </td>
        </tr>
        <tr>
          <th scope="row">Sunrise and sunset</th>
          <td>
            {fmt(p.sunrise, zone)} and {fmt(p.sunset, zone)}
          </td>
        </tr>
        <tr>
          <th scope="row">Moonrise and moonset</th>
          <td>
            {fmt(p.moonrise, zone)} and {fmt(p.moonset, zone)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Kundli({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, read, write);
  const set = <K extends keyof KundliState>(key: K, value: KundliState[K]) => setState((s) => ({ ...s, [key]: value }));
  const { lang } = state;

  const computed = useMemo(() => {
    try {
      const instant = instantOf(state.person);
      const c = chart(instant, state.person.lat, state.person.lon, { zodiac: state.zodiac, node: state.node });
      const moon = c.grahas.find((g) => g.graha === 'moon');
      return { c, p: panchang(instant, state.person.lat, state.person.lon, state.person.zone, lang), d: vimshottari(moon?.longitude ?? 0, instant), m: manglik(c), error: '' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [state.person, state.zodiac, state.node, lang]);

  const day = useMemo(() => {
    if (state.mode !== 'panchang') return null;
    try {
      // The day's panchang is read at sunrise, as calendars give it.
      const noon = instantOf({ ...state.day, time: '12:00:00' });
      const first = panchang(noon, state.day.lat, state.day.lon, state.day.zone, lang);
      return { p: first.sunrise ? panchang(new Date(first.sunrise.getTime() + 60_000), state.day.lat, state.day.lon, state.day.zone, lang) : first, error: '' };
    } catch (error) {
      return { p: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [state.mode, state.day, lang]);

  const match = useMemo(() => {
    if (state.mode !== 'match') return null;
    try {
      const bc = chart(instantOf(state.bride), state.bride.lat, state.bride.lon, { zodiac: state.zodiac, node: state.node });
      const gc = chart(instantOf(state.groom), state.groom.lat, state.groom.lon, { zodiac: state.zodiac, node: state.node });
      const moonOf = (c: Chart) => c.grahas.find((g) => g.graha === 'moon')?.longitude ?? 0;
      return { result: gunaMilan(moonOf(bc), moonOf(gc)), bride: manglik(bc), groom: manglik(gc), error: '' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [state.mode, state.bride, state.groom, state.zodiac, state.node]);

  const ChartView = state.style === 'north' ? NorthChart : SouthChart;
  const now = new Date();

  const report = (kind: 'html' | 'pdf') =>
    attempt(async () => {
      if (!('c' in computed) || !computed.c) throw new Error(computed.error || 'Calculate a chart first.');
      const section = document.querySelector('[data-testid="kd-report"]');
      if (!section) throw new Error('The chart is not shown.');
      const title = `Kundli${state.person.name ? ` of ${state.person.name}` : ''}`;
      const html = `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>
body{font:14px/1.5 system-ui,"Noto Sans","Noto Sans Devanagari",sans-serif;color:#1f2328;background:#fff;margin:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}
.kd-charts{display:flex;gap:24px;flex-wrap:wrap}.kd-chart{width:300px;height:300px}
.kd-frame{fill:#fff;stroke:#1f2328}.kd-lines{fill:none;stroke:#1f2328}.kd-sign-number,.kd-sign-small{fill:#59636e;font-size:10px}
.kd-graha{fill:#1f2328;font-weight:600}.kd-asc{fill:#9a2b00;font-size:10px;font-weight:700}.kd-centre{fill:#59636e;font-size:13px}
table{border-collapse:collapse;margin:6px 0}th,td{border:1px solid #d1d9e0;padding:3px 8px;text-align:left;font-size:12.5px}
.kd-current{background:#fff8c5}details{display:none}.kd-hint{display:none}
@page{margin:14mm}</style></head><body><h1>${escapeXml(title)}</h1><p>${escapeXml(`${state.person.date} ${state.person.time} (${state.person.zone}), ${state.person.place} ${state.person.lat.toFixed(4)}°N ${state.person.lon.toFixed(4)}°E`)}</p>${section.innerHTML}</body></html>`;
      const base = (state.person.name || 'kundli').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'kundli';
      if (kind === 'html') {
        const outcome = await saveFile(`${base}.html`, html, 'text/html');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } else if (!isDesktop) printDocument(html);
      else {
        const outcome = await saveFile(`${base}.pdf`, await htmlToPdf(html), 'application/pdf');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      }
    });

  return (
    <section class="tool kd-tool" data-testid="tool" data-state={'c' in computed && computed.c ? 'done' : 'idle'}>
      <div class="button-row kd-bar">
        <Segmented
          label="What to work out"
          value={state.mode}
          onChange={(mode) => set('mode', mode)}
          choices={[
            { value: 'chart', label: 'Birth chart' },
            { value: 'panchang', label: 'Panchang' },
            { value: 'match', label: 'Matching' },
          ]}
        />
        <Segmented
          label="Chart style"
          value={state.style}
          onChange={(style) => set('style', style)}
          choices={[
            { value: 'north', label: 'North Indian' },
            { value: 'south', label: 'South Indian' },
          ]}
        />
        <Segmented
          label="Language"
          value={state.lang}
          onChange={(l) => set('lang', l)}
          choices={[
            { value: 'en', label: 'English' },
            { value: 'hi', label: 'हिन्दी' },
          ]}
        />
        <label class="kd-field">
          <span class="control-label">Zodiac</span>
          <select class="select select-small" value={state.zodiac} onChange={(e) => set('zodiac', e.currentTarget.value as Zodiac)} data-testid="kd-zodiac">
            <option value="lahiri">Sidereal, Lahiri ayanamsa</option>
            <option value="tropical">Tropical (sayana)</option>
          </select>
        </label>
        <label class="kd-field">
          <span class="control-label">Rahu and Ketu</span>
          <select class="select select-small" value={state.node} onChange={(e) => set('node', e.currentTarget.value as NodeKind)}>
            <option value="mean">Mean node</option>
            <option value="true">True node</option>
          </select>
        </label>
      </div>

      {state.mode === 'chart' && (
        <div class="kd-main">
          <BirthForm value={state.person} onChange={(b) => set('person', b)} label="Birth details" test="kd-person" />
          {'c' in computed && computed.c ? (
            <div class="kd-out">
              <div class="kd-report" data-testid="kd-report">
                <div class="kd-charts">
                  <ChartView c={computed.c} d={1} lang={lang} title={VARGA_NAMES[1]} />
                  <ChartView c={computed.c} d={state.divisional} lang={lang} title={VARGA_NAMES[state.divisional]} />
                </div>
                <p class="kd-hint">
                  <label class="kd-field kd-inline">
                    <span class="control-label">Second chart</span>
                    <select class="select select-small" value={String(state.divisional)} onChange={(e) => set('divisional', Number(e.currentTarget.value) as Varga)} data-testid="kd-varga">
                      {VARGAS.map((d) => (
                        <option key={d} value={d}>
                          {VARGA_NAMES[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span class="tone-muted">Ayanamsa {dms(computed.c.ayanamsa)}. Houses are whole signs from the ascendant; (R) marks a retrograde graha.</span>
                </p>
                <h3 class="kd-h">Positions</h3>
                <div class="kd-scroll">
                  <table class="data-table kd-table" data-testid="kd-positions">
                    <thead>
                      <tr>
                        <th scope="col">{lang === 'hi' ? 'ग्रह' : 'Graha'}</th>
                        <th scope="col">{lang === 'hi' ? 'राशि' : 'Sign'}</th>
                        <th scope="col">{lang === 'hi' ? 'अंश' : 'Degree'}</th>
                        <th scope="col">{lang === 'hi' ? 'नक्षत्र (पद)' : 'Nakshatra (pada)'}</th>
                        <th scope="col">{lang === 'hi' ? 'नक्षत्र स्वामी' : 'Nakshatra lord'}</th>
                        <th scope="col">{lang === 'hi' ? 'भाव' : 'House'}</th>
                        <th scope="col">{lang === 'hi' ? 'नवांश' : 'Navamsa'}</th>
                        <th scope="col">{lang === 'hi' ? 'गति °/दिन' : 'Speed °/day'}</th>
                        <th scope="col">{lang === 'hi' ? 'स्थिति' : 'State'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">{lagnaName(lang)}</th>
                        <td>{signName(computed.c.lagna.sign, lang)}</td>
                        <td>{dms(computed.c.lagna.degree)}</td>
                        <td>
                          {nakshatraName(computed.c.lagna.nakshatra, lang)} ({computed.c.lagna.pada})
                        </td>
                        <td>{grahaName(nakshatraLord(computed.c.lagna.nakshatra), lang)}</td>
                        <td>1</td>
                        <td>{signName(varga(computed.c, 9).lagna, lang)}</td>
                        <td />
                        <td>
                          {lang === 'hi' ? 'स्वामी' : 'Lord'}: {grahaName(SIGN_LORDS[computed.c.lagna.sign] as Graha, lang)}
                        </td>
                      </tr>
                      {computed.c.grahas.map((g) => (
                        <tr key={g.graha}>
                          <th scope="row">{grahaName(g.graha, lang)}</th>
                          <td>{signName(g.sign, lang)}</td>
                          <td>{dms(g.degree)}</td>
                          <td>
                            {nakshatraName(g.nakshatra, lang)} ({g.pada})
                          </td>
                          <td>{grahaName(nakshatraLord(g.nakshatra), lang)}</td>
                          <td>{g.house}</td>
                          <td>{signName(varga(computed.c, 9).grahas.find((x) => x.graha === g.graha)?.sign ?? 0, lang)}</td>
                          <td>{g.speed.toFixed(3)}</td>
                          <td>{[g.retrograde ? (lang === 'hi' ? 'वक्री' : 'Retrograde') : '', g.dignity ? DIGNITY[g.dignity] : ''].filter(Boolean).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3 class="kd-h">Panchang at birth</h3>
                <PanchangTable p={computed.p} zone={state.person.zone} lang={lang} />
                <p class="kd-note" data-testid="kd-manglik">
                  Mars is in house {computed.m.fromLagna} from the ascendant and {computed.m.fromMoon} from the Moon.{' '}
                  {computed.m.manglik ? 'By the common rule (houses 1, 2, 4, 7, 8 and 12) the chart is called Manglik.' : 'By the common rule (houses 1, 2, 4, 7, 8 and 12) the chart is not Manglik.'}
                </p>
                <h3 class="kd-h">Vimshottari dasha</h3>
                <p class="kd-note">
                  At birth, {grahaName(computed.d.dashas[0]?.lord ?? 'ketu', lang)} mahadasha with {computed.d.balance.toFixed(2)} years to run.
                </p>
                <div class="kd-scroll">
                  <table class="data-table kd-table" data-testid="kd-dashas">
                    <thead>
                      <tr>
                        <th scope="col">Mahadasha</th>
                        <th scope="col">From</th>
                        <th scope="col">To</th>
                        <th scope="col">Antardashas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {computed.d.dashas.map((d) => {
                        const running = runningDasha([d], now);
                        return (
                          <tr key={d.lord} class={running ? 'kd-current' : undefined}>
                            <th scope="row">{grahaName(d.lord, lang)}</th>
                            <td>{dateOnly(d.start, state.person.zone)}</td>
                            <td>{dateOnly(d.end, state.person.zone)}</td>
                            <td>
                              <details>
                                <summary>{running ? `Now: ${grahaName(running.antar.lord, lang)} until ${dateOnly(running.antar.end, state.person.zone)}` : 'Show'}</summary>
                                <ul class="kd-antar">
                                  {d.antardashas.map((a) => (
                                    <li key={a.lord}>
                                      {grahaName(a.lord, lang)}: {dateOnly(a.start, state.person.zone)} to {dateOnly(a.end, state.person.zone)}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="button-row">
                <button type="button" class="button button-small" onClick={() => report('html')} data-testid="kd-save-html">
                  Save as web page
                </button>
                <button type="button" class="button button-small" onClick={() => report('pdf')}>
                  {isDesktop ? 'Save PDF' : 'Print'}
                </button>
              </div>
            </div>
          ) : (
            <p class="tone-error" role="alert">
              {computed.error}
            </p>
          )}
        </div>
      )}

      {state.mode === 'panchang' && (
        <div class="kd-main">
          <BirthForm value={state.day} onChange={(b) => set('day', b)} label="Day and place" test="kd-day" withName={false} withTime={false} />
          <div class="kd-out">
            {day?.p ? (
              <>
                <h3 class="kd-h">
                  {varaName(day.p.vara, lang)}, {state.day.date}, at sunrise in {state.day.place || 'this place'}
                </h3>
                <PanchangTable p={day.p} zone={state.day.zone} lang={lang} />
                <button type="button" class="button button-small" onClick={() => set('day', { ...state.day, date: today() })}>
                  Today
                </button>
              </>
            ) : (
              <p class="tone-error">{day?.error}</p>
            )}
          </div>
        </div>
      )}

      {state.mode === 'match' && (
        <div class="kd-main kd-match">
          <BirthForm value={state.bride} onChange={(b) => set('bride', b)} label="Bride" test="kd-bride" />
          <BirthForm value={state.groom} onChange={(b) => set('groom', b)} label="Groom" test="kd-groom" />
          {match && 'result' in match && match.result ? (
            <div class="kd-out kd-match-out">
              <table class="data-table kd-table" data-testid="kd-kootas">
                <thead>
                  <tr>
                    <th scope="col">Koota</th>
                    <th scope="col">{state.bride.name || 'Bride'}</th>
                    <th scope="col">{state.groom.name || 'Groom'}</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {match.result.kootas.map((k) => (
                    <tr key={k.name}>
                      <th scope="row">{k.name}</th>
                      <td>{k.bride}</td>
                      <td>{k.groom}</td>
                      <td>
                        {k.points} / {k.max}
                      </td>
                    </tr>
                  ))}
                  <tr class="kd-total">
                    <th scope="row" colSpan={3}>
                      Total
                    </th>
                    <td data-testid="kd-total">{match.result.total} / 36</td>
                  </tr>
                </tbody>
              </table>
              <p class="kd-note">
                Tradition commonly asks for 18 points or more.
                {match.result.nadiDosha ? ' Both Moons share a nadi (Nadi dosha).' : ''}
                {match.result.bhakootDosha ? ' The Moon signs stand 2/12, 5/9 or 6/8 apart (Bhakoot dosha).' : ''} Manglik by the common rule: bride {match.bride.manglik ? 'yes' : 'no'}, groom{' '}
                {match.groom.manglik ? 'yes' : 'no'}.
              </p>
            </div>
          ) : (
            <p class="tone-error">{match?.error}</p>
          )}
        </div>
      )}

      <p class="control-help">
        Positions are astronomical (VSOP87 planets and the ELP Moon via astronomy-engine), in the sidereal zodiac with the Lahiri ayanamsa of Indian panchangs; birth times are read in the place’s time
        zone, historical changes included. What a chart is taken to mean is a matter of tradition, not of astronomy. Dashas use the {DASHA_LORDS.length}-lord Vimshottari order and years of 365.2425
        days.
      </p>
    </section>
  );
}

export default defineCustomTool(Kundli);
