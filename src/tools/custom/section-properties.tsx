/** Section properties of beams, columns, tubes and bars, with a scale drawing. */
import { useMemo } from 'preact/hooks';
import { SHAPES, type ShapeId } from '../../lib/beam/sections';
import { copyText } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { SECTION_MATERIALS, type SectionUnits, ShapeDrawing, sectionFromInputs, sectionRows } from './_sections';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

interface Saved {
  readonly shape: ShapeId;
  readonly dims: Readonly<Record<string, string>>;
  readonly units: SectionUnits;
  readonly material: string;
}

const UNIT_CHOICES: readonly SegmentChoice<SectionUnits>[] = [
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm (steel tables)' },
  { value: 'in', label: 'inch' },
];

const examples = (shape: ShapeId) => Object.fromEntries((SHAPES.find((s) => s.id === shape)?.dims ?? []).map((d) => [d.key, String(d.example)]));

const INITIAL: Saved = { shape: 'ibeam', dims: examples('ibeam'), units: 'cm', material: 'steel' };

function readSaved(stored: Values | undefined): Saved {
  if (!stored) return INITIAL;
  const shape = SHAPES.find((s) => s.id === stored.shape)?.id ?? INITIAL.shape;
  const dims: Record<string, string> = { ...examples(shape) };
  if (stored.dims && typeof stored.dims === 'object') {
    for (const [key, value] of Object.entries(stored.dims as Record<string, unknown>)) if (key in dims && typeof value === 'string') dims[key] = value.slice(0, 20);
  }
  return {
    shape,
    dims,
    units: stored.units === 'mm' || stored.units === 'in' ? stored.units : 'cm',
    material: SECTION_MATERIALS.some((m) => m.id === stored.material) ? (stored.material as string) : INITIAL.material,
  };
}

function SectionProperties({ toolId }: { toolId: string }) {
  const [saved, setSaved] = usePersistentState(toolId, readSaved, (s: Saved): Values => ({ ...s }));
  const spec = SHAPES.find((s) => s.id === saved.shape) ?? (SHAPES[0] as (typeof SHAPES)[number]);
  const result = useMemo(() => sectionFromInputs(saved.shape, saved.dims), [saved.shape, saved.dims]);
  const material = SECTION_MATERIALS.find((m) => m.id === saved.material) ?? (SECTION_MATERIALS[0] as (typeof SECTION_MATERIALS)[number]);
  const rows = 'error' in result ? [] : sectionRows(result, saved.units, material.density);

  return (
    <section class="tool sp-tool" data-testid="tool" data-state={'error' in result ? 'idle' : 'done'}>
      <div class="sp-inputs">
        <label class="control">
          <span class="control-label">Shape</span>
          <select
            class="input"
            value={saved.shape}
            onChange={(e) => setSaved((s) => ({ ...s, shape: e.currentTarget.value as ShapeId, dims: examples(e.currentTarget.value as ShapeId) }))}
            data-testid="sp-shape"
          >
            {SHAPES.map((shape) => (
              <option key={shape.id} value={shape.id}>
                {shape.name}
              </option>
            ))}
          </select>
        </label>
        {spec.dims.map((dim) => (
          <label class="control sp-dim" key={dim.key}>
            <span class="control-label">{dim.label} (mm)</span>
            <input
              class="input sp-value"
              type="text"
              inputMode="decimal"
              value={saved.dims[dim.key] ?? ''}
              onInput={(e) => setSaved((s) => ({ ...s, dims: { ...s.dims, [dim.key]: e.currentTarget.value } }))}
              data-testid={`sp-${dim.key}`}
            />
          </label>
        ))}
        <label class="control">
          <span class="control-label">Material (for mass)</span>
          <select class="input" value={saved.material} onChange={(e) => setSaved((s) => ({ ...s, material: e.currentTarget.value }))}>
            {SECTION_MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div class="control">
          <span class="control-label">Results in</span>
          <Segmented label="Results in" value={saved.units} choices={UNIT_CHOICES} onChange={(units) => setSaved((s) => ({ ...s, units }))} />
        </div>
      </div>

      {'error' in result ? (
        <p class="st-error" role="status" data-testid="sp-error">
          <Icon name="alert" size={16} /> {result.error}
        </p>
      ) : (
        <div class="sp-body">
          <figure class="sp-figure">
            <ShapeDrawing section={result} />
            <figcaption>Centroid and centroidal axes{result.angle !== 0 && result.angle !== 90 && Math.abs(result.Ixy) > 1e-6 ? '; the dotted line is the major principal axis' : ''}.</figcaption>
          </figure>
          <div class="sp-results">
            <div class="st-result-head">
              <h2>Properties</h2>
              <button
                type="button"
                class="button button-small"
                onClick={() =>
                  attempt(async () => {
                    await copyText(rows.map((r) => `${r.label}\t${r.value}\t${r.unit}`).join('\n'));
                    notify('Copied the properties');
                  })
                }
              >
                <Icon name="copy" size={14} /> Copy
              </button>
            </div>
            <div class="ref-table-wrap" {...scrollRegion('Section properties')}>
              <table class="ref-table sp-table" data-testid="sp-table">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">
                        {row.label}
                        {row.symbol && <span class="sp-symbol">{row.symbol}</span>}
                      </th>
                      <td class="st-num">{row.value}</td>
                      <td class="ref-muted">{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="st-note">
              Sharp corners: rolled sections with root radii have slightly more area and stiffness than these figures. The torsion constant uses thin-wall formulas for open and box shapes.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default defineCustomTool(SectionProperties);
