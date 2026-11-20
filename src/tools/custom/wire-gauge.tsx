/** Wire gauge chart and converter: AWG, SWG and metric sizes with resistance and mass. */
import { useMemo } from 'preact/hooks';
import { CONDUCTORS, findSize, type GaugeSystem, massPerKm, nearest, resistancePerKm, SIZES, type WireSize } from '../../lib/wire-gauge';
import { copyText } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { figure, readNumber } from './_sections';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

type Known = 'awg' | 'swg' | 'metric' | 'dmm' | 'din' | 'amm2' | 'kcmil';

const KNOWN: readonly { readonly value: Known; readonly label: string; readonly placeholder: string }[] = [
  { value: 'awg', label: 'AWG number', placeholder: '12 or 4/0' },
  { value: 'swg', label: 'SWG number', placeholder: '18' },
  { value: 'metric', label: 'Metric size (mm²)', placeholder: '2.5' },
  { value: 'dmm', label: 'Diameter (mm)', placeholder: '1.6' },
  { value: 'din', label: 'Diameter (inch)', placeholder: '0.064' },
  { value: 'amm2', label: 'Any area (mm²)', placeholder: '3.3' },
  { value: 'kcmil', label: 'Area (kcmil)', placeholder: '250' },
];

const CHARTS: readonly SegmentChoice<GaugeSystem>[] = [
  { value: 'awg', label: 'AWG' },
  { value: 'swg', label: 'SWG' },
  { value: 'metric', label: 'Metric (IEC 60228)' },
];

const KCMIL = 0.506707479097498;

interface Saved {
  readonly known: Known;
  readonly value: string;
  readonly conductor: string;
  readonly temperature: string;
  readonly chart: GaugeSystem;
}

const INITIAL: Saved = { known: 'awg', value: '12', conductor: 'copper', temperature: '20', chart: 'awg' };

function readSaved(stored: Values | undefined): Saved {
  if (!stored) return INITIAL;
  return {
    known: KNOWN.find((k) => k.value === stored.known)?.value ?? INITIAL.known,
    value: typeof stored.value === 'string' ? stored.value.slice(0, 20) : INITIAL.value,
    conductor: CONDUCTORS.some((c) => c.id === stored.conductor) ? (stored.conductor as string) : INITIAL.conductor,
    temperature: typeof stored.temperature === 'string' ? stored.temperature.slice(0, 10) : INITIAL.temperature,
    chart: CHARTS.find((c) => c.value === stored.chart)?.value ?? INITIAL.chart,
  };
}

/** The cross-section asked for, in mm², with the matching named size if there is one. */
function resolve(known: Known, text: string): { area: number; size: WireSize | null } | { error: string } {
  if (known === 'awg' || known === 'swg' || known === 'metric') {
    const size = findSize(known, text);
    if (!size) return { error: known === 'metric' ? 'That is not an IEC 60228 size. Choose “Any area” for other areas.' : `There is no ${known.toUpperCase()} ${text.trim() || 'size'} in the chart.` };
    return { area: size.area, size };
  }
  const value = readNumber(text);
  if (value === null || value <= 0) return { error: 'Type a number above zero.' };
  const area = known === 'dmm' ? (Math.PI * value * value) / 4 : known === 'din' ? (Math.PI * (value * 25.4) ** 2) / 4 : known === 'kcmil' ? value * KCMIL : value;
  return { area, size: null };
}

function WireGauge({ toolId }: { toolId: string }) {
  const [saved, setSaved] = usePersistentState(toolId, readSaved, (s: Saved): Values => ({ ...s }));
  const conductor = CONDUCTORS.find((c) => c.id === saved.conductor) ?? (CONDUCTORS[0] as (typeof CONDUCTORS)[number]);
  const celsius = readNumber(saved.temperature) ?? 20;
  const found = useMemo(() => resolve(saved.known, saved.value), [saved.known, saved.value]);
  const known = KNOWN.find((k) => k.value === saved.known) ?? (KNOWN[0] as (typeof KNOWN)[number]);

  const facts = (() => {
    if ('error' in found) return null;
    const { area } = found;
    const d = Math.sqrt((4 * area) / Math.PI);
    const ohmKm = resistancePerKm(area, conductor, celsius);
    const kgKm = massPerKm(area, conductor);
    const equivalents = (['awg', 'swg', 'metric'] as const).map((system) => ({ system, ...nearest(system, area) }));
    return {
      rows: [
        { label: 'Diameter (solid round)', value: `${figure(d, 4)} mm, ${figure(d / 25.4, 4)} in, ${figure((d / 25.4) * 1000, 4)} mil` },
        { label: 'Cross-section', value: `${figure(area, 4)} mm², ${figure(area / KCMIL, 4)} kcmil (${figure((area / KCMIL) * 1000, 4)} circular mils)` },
        { label: `Resistance at ${figure(celsius, 4)} °C`, value: `${figure(ohmKm, 4)} Ω/km, ${figure(ohmKm * 0.3048, 4)} Ω per 1000 ft` },
        { label: 'Mass', value: `${figure(kgKm, 4)} kg/km, ${figure(kgKm * 0.671968975, 4)} lb per 1000 ft` },
      ],
      equivalents,
    };
  })();

  const highlight = (size: WireSize) => {
    if ('error' in found) return '';
    if (found.size === size) return 'is-to';
    return facts?.equivalents.find((e) => e.system === size.system)?.closest === size ? 'is-from' : '';
  };
  const chart = SIZES[saved.chart];

  return (
    <section class="tool wg-gauge-tool" data-testid="tool" data-state={'error' in found ? 'idle' : 'done'}>
      <div class="sp-inputs">
        <label class="control">
          <span class="control-label">I know the</span>
          <select class="input" value={saved.known} onChange={(e) => setSaved((s) => ({ ...s, known: e.currentTarget.value as Known }))} data-testid="wg-known">
            {KNOWN.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label class="control">
          <span class="control-label">Value</span>
          <input
            class="input sp-value"
            type="text"
            placeholder={known.placeholder}
            value={saved.value}
            onInput={(e) => setSaved((s) => ({ ...s, value: e.currentTarget.value }))}
            data-testid="wg-value"
          />
        </label>
        <label class="control">
          <span class="control-label">Conductor</span>
          <select class="input" value={saved.conductor} onChange={(e) => setSaved((s) => ({ ...s, conductor: e.currentTarget.value }))}>
            {CONDUCTORS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label class="control">
          <span class="control-label">Temperature (°C)</span>
          <input
            class="input sp-value"
            type="text"
            inputMode="decimal"
            value={saved.temperature}
            onInput={(e) => setSaved((s) => ({ ...s, temperature: e.currentTarget.value }))}
            data-testid="wg-temperature"
          />
        </label>
      </div>

      {'error' in found ? (
        <p class="st-error" role="status" data-testid="wg-error">
          <Icon name="alert" size={16} /> {found.error}
        </p>
      ) : (
        facts && (
          <div class="wg-found" data-testid="wg-found">
            <table class="ref-table">
              <tbody>
                {facts.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td class="st-num wg-left">{row.value}</td>
                  </tr>
                ))}
                {facts.equivalents.map((e) => (
                  <tr key={e.system}>
                    <th scope="row">Closest {e.system === 'metric' ? 'metric size' : e.system.toUpperCase()}</th>
                    <td class="wg-left">
                      <strong>{e.system === 'metric' ? e.closest.name : `${e.system.toUpperCase()} ${e.closest.name}`}</strong> ({figure(e.closest.area, 4)} mm²)
                      {e.larger && e.larger !== e.closest && (
                        <span class="tone-muted">
                          ; next larger {e.system === 'metric' ? e.larger.name : `${e.system.toUpperCase()} ${e.larger.name}`} ({figure(e.larger.area, 4)} mm²)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <div class="st-result">
        <div class="st-result-head">
          <Segmented label="Chart" value={saved.chart} choices={CHARTS} onChange={(value) => setSaved((s) => ({ ...s, chart: value }))} />
          <button
            type="button"
            class="button button-small"
            onClick={() =>
              attempt(async () => {
                const lines = [
                  'Size\tDiameter mm\tDiameter in\tArea mm²\tArea kcmil\tΩ/km\tkg/km',
                  ...chart.map((s) =>
                    [
                      s.name,
                      figure(s.diameter, 4),
                      figure(s.diameter / 25.4, 4),
                      figure(s.area, 4),
                      figure(s.area / KCMIL, 4),
                      figure(resistancePerKm(s.area, conductor, celsius), 4),
                      figure(massPerKm(s.area, conductor), 4),
                    ].join('\t'),
                  ),
                ];
                await copyText(lines.join('\n'));
                notify(`Copied ${chart.length} sizes`);
              })
            }
          >
            <Icon name="copy" size={14} /> Copy chart
          </button>
        </div>
        <div class="ref-table-wrap st-table-wrap" {...scrollRegion('Wire gauge chart')}>
          <table class="ref-table st-table" data-testid="wg-chart">
            <thead>
              <tr>
                <th scope="col">{saved.chart === 'metric' ? 'Size' : saved.chart.toUpperCase()}</th>
                <th scope="col" class="st-num">
                  Diameter (mm)
                </th>
                <th scope="col" class="st-num">
                  Diameter (in)
                </th>
                <th scope="col" class="st-num">
                  Area (mm²)
                </th>
                <th scope="col" class="st-num">
                  Area (kcmil)
                </th>
                <th scope="col" class="st-num">
                  Resistance (Ω/km)
                </th>
                <th scope="col" class="st-num">
                  Mass (kg/km)
                </th>
              </tr>
            </thead>
            <tbody>
              {chart.map((size) => (
                <tr key={size.name} class={highlight(size) || undefined}>
                  <th scope="row">{size.name}</th>
                  <td class="st-num">{figure(size.diameter, 4)}</td>
                  <td class="st-num">{figure(size.diameter / 25.4, 4)}</td>
                  <td class="st-num">{figure(size.area, 4)}</td>
                  <td class="st-num">{figure(size.area / KCMIL, 4)}</td>
                  <td class="st-num">{figure(resistancePerKm(size.area, conductor, celsius), 4)}</td>
                  <td class="st-num">{figure(massPerKm(size.area, conductor), 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p class="st-note">
        Solid round conductors. Stranded cables of the same nominal size are a little thicker, and IEC 60228 allows slightly higher resistance than these figures (for example 7.41 Ω/km for 2.5 mm²
        plain copper). Current ratings depend on insulation, grouping and installation, so they come from the cable standard or the maker’s tables, not from the size alone.
      </p>
    </section>
  );
}

export default defineCustomTool(WireGauge);
