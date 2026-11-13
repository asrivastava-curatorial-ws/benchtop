/** Media query builder with a resizable test frame. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { trimNumber } from '../../lib/color';
import { CodeOutput } from '../../ui/CodeOutput';
import { ControlsForm } from '../../ui/Controls';
import { useToolValues } from '../../ui/hooks';
import { defineCustomTool, type OptionDef, type Values } from '../types';
import { PreviewFrame } from './_shared';

const ANY = { value: 'any', label: 'Any' };

const DEFS: readonly OptionDef[] = [
  { key: 'type', label: 'Media type', type: 'segmented', choices: ['all', 'screen', 'print'], default: 'screen' },
  { key: 'unit', label: 'Width unit', type: 'segmented', choices: ['px', 'em', 'rem'], default: 'px' },
  { key: 'minWidth', label: 'Minimum width', type: 'number', min: 0, max: 10000, step: 1, default: 768, help: '0 leaves it out.' },
  {
    key: 'maxWidth',
    label: 'Maximum width',
    type: 'number',
    min: 0,
    max: 10000,
    step: 0.01,
    default: 0,
    help: '0 leaves it out. With min-width, a common pattern is the next breakpoint minus 0.02px.',
  },
  { key: 'orientation', label: 'Orientation', type: 'select', choices: [ANY, 'portrait', 'landscape'], default: 'any' },
  { key: 'colorScheme', label: 'prefers-color-scheme', type: 'select', choices: [ANY, 'light', 'dark'], default: 'any' },
  { key: 'motion', label: 'prefers-reduced-motion', type: 'select', choices: [ANY, 'reduce', 'no-preference'], default: 'any' },
  { key: 'contrast', label: 'prefers-contrast', type: 'select', choices: [ANY, 'more', 'less'], default: 'any' },
  { key: 'hover', label: 'hover', type: 'select', choices: [ANY, 'hover', 'none'], default: 'any' },
  { key: 'pointer', label: 'pointer', type: 'select', choices: [ANY, 'fine', 'coarse', 'none'], default: 'any' },
  { key: 'resolution', label: 'Minimum pixel density', type: 'select', choices: [ANY, { value: '2', label: '2x (high-density screens)' }, { value: '3', label: '3x' }], default: 'any' },
  {
    key: 'syntax',
    label: 'Width syntax',
    type: 'segmented',
    choices: [
      { value: 'classic', label: 'min-/max-width' },
      { value: 'range', label: 'Range' },
    ],
    default: 'classic',
    help: 'Range syntax is shorter and works in all current browsers.',
  },
  { key: 'selector', label: 'Selector for the example', type: 'text', default: '.sidebar', mono: true },
];

const BREAKPOINTS: { name: string; values: Values }[] = [
  { name: 'Phones only', values: { unit: 'px', minWidth: 0, maxWidth: 575.98 } },
  { name: 'Tablet and up', values: { unit: 'px', minWidth: 768, maxWidth: 0 } },
  { name: 'Tablet only', values: { unit: 'px', minWidth: 768, maxWidth: 991.98 } },
  { name: 'Desktop and up', values: { unit: 'px', minWidth: 1200, maxWidth: 0 } },
  { name: 'Tailwind md', values: { unit: 'rem', minWidth: 48, maxWidth: 0 } },
  { name: 'Tailwind lg', values: { unit: 'rem', minWidth: 64, maxWidth: 0 } },
  { name: 'Dark mode', values: { minWidth: 0, maxWidth: 0, colorScheme: 'dark', type: 'all' } },
  { name: 'Reduced motion', values: { minWidth: 0, maxWidth: 0, motion: 'reduce', type: 'all' } },
  { name: 'Touch screens', values: { minWidth: 0, maxWidth: 0, hover: 'none', pointer: 'coarse', type: 'all' } },
  { name: 'Print', values: { minWidth: 0, maxWidth: 0, type: 'print' } },
];

export function buildQuery(v: Values): string {
  const unit = String(v.unit);
  const len = (value: unknown) => `${trimNumber(Number(value), 3)}${unit}`;
  const min = Math.max(0, Number(v.minWidth) || 0);
  const max = Math.max(0, Number(v.maxWidth) || 0);
  const features: string[] = [];
  if (v.syntax === 'range' && (min || max)) {
    if (min && max) features.push(`(${len(min)} <= width <= ${len(max)})`);
    else if (min) features.push(`(width >= ${len(min)})`);
    else features.push(`(width <= ${len(max)})`);
  } else {
    if (min) features.push(`(min-width: ${len(min)})`);
    if (max) features.push(`(max-width: ${len(max)})`);
  }
  const feature = (key: string, name: string) => {
    if (v[key] !== 'any') features.push(`(${name}: ${v[key]})`);
  };
  feature('orientation', 'orientation');
  feature('colorScheme', 'prefers-color-scheme');
  feature('motion', 'prefers-reduced-motion');
  feature('contrast', 'prefers-contrast');
  feature('hover', 'hover');
  feature('pointer', 'pointer');
  if (v.resolution !== 'any') features.push(`(min-resolution: ${v.resolution}dppx)`);
  const type = String(v.type);
  if (features.length === 0) return type;
  return type === 'all' ? features.join(' and ') : `${type} and ${features.join(' and ')}`;
}

function frameDocument(query: string, width: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html, body { margin: 0; height: 100%; font: 15px/1.5 system-ui, sans-serif; }
body { display: grid; place-content: center; text-align: center; background: #fdecea; color: #8a1c13; padding: 16px; }
.yes { display: none; }
.size { font: 12px ui-monospace, monospace; opacity: .75; }
@media ${query} {
  body { background: #e3f4ec; color: #0e5a3f; }
  .yes { display: block; }
  .no { display: none; }
}
</style></head><body><div><strong class="yes">The query matches in a ${width} px wide window</strong><strong class="no">The query does not match in a ${width} px wide window</strong><p class="size">${query.replace(/</g, '&lt;')}</p></div></body></html>`;
}

function MediaQuery({ toolId }: { toolId: string }) {
  const [values, patch, reset] = useToolValues(toolId, DEFS);
  const [width, setWidth] = useState(820);
  const query = useMemo(() => buildQuery(values), [values]);
  const [appMatches, setAppMatches] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const list = window.matchMedia(query);
      setAppMatches(list.matches);
      const update = () => setAppMatches(list.matches);
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    } catch {
      setAppMatches(null);
    }
  }, [query]);

  const valid = useMemo(() => {
    try {
      return window.matchMedia(query).media !== 'not all';
    } catch {
      return false;
    }
  }, [query]);
  const selector = String(values.selector).trim() || '.element';

  return (
    <section class="tool layout-form" data-testid="tool" data-state={valid ? 'done' : 'error'}>
      <aside class="tool-side">
        <div class="tool-options">
          <div class="presets" role="group" aria-label="Common queries">
            {BREAKPOINTS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                class="chip"
                onClick={() =>
                  patch({
                    ...preset.values,
                    ...(preset.values.colorScheme ? {} : { colorScheme: 'any' }),
                    ...(preset.values.motion ? {} : { motion: 'any' }),
                    ...(preset.values.hover ? {} : { hover: 'any', pointer: 'any' }),
                  })
                }
              >
                {preset.name}
              </button>
            ))}
          </div>
          <ControlsForm defs={DEFS} values={values} onChange={patch} layout="panel" idPrefix="mq" />
          <div class="tool-options-actions">
            <button type="button" class="button button-quiet" onClick={reset}>
              Reset options
            </button>
          </div>
        </div>
      </aside>
      <div class="tool-main">
        <div class="stage-bar">
          <label class="mq-width">
            <span class="pane-title">Test frame width</span>
            <input type="range" class="range" min={280} max={1600} step={1} value={width} onInput={(event) => setWidth(Number(event.currentTarget.value))} aria-label="Test frame width" />
            <output>{width} px</output>
          </label>
        </div>
        {!valid && (
          <p class="status status-error" role="alert">
            This query is not valid CSS.
          </p>
        )}
        <PreviewFrame html={frameDocument(query, width)} width={width} title="Media query test frame" />
        <p class="status status-info">
          Width conditions are tested against the frame above; preferences such as colour scheme, motion and pointer come from this computer.
          {appMatches !== null && ` In the Benchtop window itself the query ${appMatches ? 'matches' : 'does not match'}.`}
        </p>
        <CodeOutput
          baseName="media-query"
          outputs={[
            { label: 'CSS', language: 'css', code: `@media ${query} {\n  ${selector} {\n    /* styles for this condition */\n  }\n}\n` },
            {
              label: 'JavaScript',
              language: 'javascript',
              code: `const query = window.matchMedia('${query.replace(/'/g, "\\'")}');\n\nfunction update(event) {\n  document.documentElement.classList.toggle('is-match', event.matches);\n}\n\nupdate(query);\nquery.addEventListener('change', update);\n`,
            },
            { label: 'Query', language: 'text', code: `${query}\n` },
          ]}
        />
      </div>
    </section>
  );
}

export default defineCustomTool(MediaQuery);
