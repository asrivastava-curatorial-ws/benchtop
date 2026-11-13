/** The Tailwind CSS v4 colour palette: browse, copy in any format, or find the nearest shade. */

import { useMemo, useState } from 'preact/hooks';
import palette from 'tailwindcss/colors';
import { describeColor, hexOf, isColor, readableOn } from '../../lib/color';
import { copyText } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { nearestTailwind } from '../text/color-converter';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

export const FAMILIES: { name: string; shades: Record<string, string> }[] = Object.entries(palette)
  .filter((entry): entry is [string, Record<string, string>] => typeof entry[1] === 'object' && entry[1] !== null && '500' in entry[1])
  .map(([name, shades]) => ({ name, shades }));

type Format = 'class' | 'hex' | 'oklch' | 'rgb' | 'var';

interface State {
  readonly format: Format;
  readonly prefix: string;
}

const PREFIXES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'shadow', 'outline', 'decoration', 'accent'];

export function formatShade(family: string, shade: string, value: string, format: Format, prefix: string): string {
  switch (format) {
    case 'hex':
      return hexOf(value);
    case 'oklch':
      return value;
    case 'rgb':
      return describeColor(value)?.rgb ?? value;
    case 'var':
      return `var(--color-${family}-${shade})`;
    default:
      return `${prefix}-${family}-${shade}`;
  }
}

function TailwindColors({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState<State>(
    toolId,
    (stored: Values | undefined) => ({
      format: ['class', 'hex', 'oklch', 'rgb', 'var'].includes(String(stored?.format)) ? (stored?.format as Format) : 'class',
      prefix: PREFIXES.includes(String(stored?.prefix)) ? String(stored?.prefix) : 'bg',
    }),
    (s) => ({ ...s }),
  );
  const [filter, setFilter] = useState('');
  const [match, setMatch] = useState('#3b82f6');
  const nearest = useMemo(() => (isColor(match) ? nearestTailwind(hexOf(match)) : null), [match]);
  const families = FAMILIES.filter((family) => family.name.includes(filter.trim().toLowerCase()));

  const copy = (family: string, shade: string, value: string) =>
    attempt(async () => {
      const text = formatShade(family, shade, value, state.format, state.prefix);
      await copyText(text);
      notify(`Copied ${text}`);
    });

  return (
    <section class="tool tool-tailwind" data-testid="tool" data-state="done">
      <div class="tool-options tw-toolbar">
        <div class="control">
          <span class="control-label">Copy as</span>
          <Segmented
            label="Copy format"
            value={state.format}
            onChange={(format) => setState((previous) => ({ ...previous, format }))}
            choices={[
              { value: 'class', label: 'Class' },
              { value: 'hex', label: 'HEX' },
              { value: 'oklch', label: 'OKLCH' },
              { value: 'rgb', label: 'RGB' },
              { value: 'var', label: 'CSS variable' },
            ]}
          />
        </div>
        {state.format === 'class' && (
          <label class="control">
            <span class="control-label">Utility</span>
            <select class="input" value={state.prefix} onChange={(event) => setState((previous) => ({ ...previous, prefix: event.currentTarget.value }))}>
              {PREFIXES.map((prefix) => (
                <option key={prefix} value={prefix}>
                  {prefix}-
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="control">
          <span class="control-label">Filter</span>
          <input class="input" type="search" placeholder="blue, slate…" value={filter} onInput={(event) => setFilter(event.currentTarget.value)} />
        </label>
        <label class="control">
          <span class="control-label">Nearest to</span>
          <span class="tw-match">
            <input type="color" class="color-swatch" value={isColor(match) ? hexOf(match) : '#000000'} onInput={(event) => setMatch(event.currentTarget.value)} aria-label="Pick a colour to match" />
            <input class={`input input-mono${isColor(match) ? '' : ' is-invalid'}`} value={match} onInput={(event) => setMatch(event.currentTarget.value)} aria-label="Colour to match" />
          </span>
        </label>
        {nearest && (
          <p class="tw-nearest" data-testid="tw-nearest">
            <span class="swatch" style={`background: ${nearest.hex};`} />
            <strong>{nearest.name}</strong> <span class="pane-meta">{nearest.hex}</span>
            {nearest.distance < 0.005 ? ' exact match' : ` difference ${(nearest.distance * 100).toFixed(1)}`}
          </p>
        )}
      </div>
      <div class="tw-grid" role="group" aria-label="Tailwind colour palette">
        <div class="tw-row tw-head" aria-hidden="true">
          <span />
          {SHADES.map((shade) => (
            <span key={shade}>{shade}</span>
          ))}
        </div>
        {families.map((family) => (
          <div key={family.name} class="tw-row" role="group" aria-label={family.name}>
            <span class="tw-family" aria-hidden="true">
              {family.name}
            </span>
            {SHADES.map((shade) => {
              const value = family.shades[shade];
              if (!value) return <span key={shade} />;
              const hex = hexOf(value);
              const active = nearest?.name === `${family.name}-${shade}`;
              return (
                <button
                  key={shade}
                  type="button"
                  class={`tw-swatch${active ? ' is-active' : ''}`}
                  style={`background: ${value}; color: ${readableOn(hex)};`}
                  title={`${family.name}-${shade}  ${hex}  ${value}`}
                  aria-label={`${family.name} ${shade}, ${hex}`}
                  onClick={() => copy(family.name, shade, value)}
                >
                  <span>{hex.slice(1)}</span>
                </button>
              );
            })}
          </div>
        ))}
        {families.length === 0 && <p class="control-help">No colour family matches “{filter}”.</p>}
      </div>
      <p class="status status-info">Tailwind CSS v4 defines its palette in OKLCH; HEX and RGB values are the closest sRGB equivalents. Click a swatch to copy it.</p>
    </section>
  );
}

export default defineCustomTool(TailwindColors);
