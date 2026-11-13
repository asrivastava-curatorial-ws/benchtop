import { ToolError } from '../../lib/errors';
import { defineVisualTool, type Values } from '../types';
import { css, html, inline, px, rule } from './_shared';

const useAreas = (v: Values) => v.useAreas === true;

const controls = [
  {
    key: 'columns',
    label: 'grid-template-columns',
    type: 'text',
    default: '200px 1fr 1fr',
    mono: true,
    wide: true,
    help: 'Any track list: 1fr 2fr, repeat(3, 1fr), repeat(auto-fill, minmax(120px, 1fr)).',
  },
  { key: 'rows', label: 'grid-template-rows', type: 'text', default: 'auto 1fr auto', mono: true, wide: true },
  { key: 'columnGap', label: 'column-gap', type: 'range', min: 0, max: 48, step: 1, unit: 'px', default: 12 },
  { key: 'rowGap', label: 'row-gap', type: 'range', min: 0, max: 48, step: 1, unit: 'px', default: 12 },
  { key: 'justifyItems', label: 'justify-items', type: 'select', choices: ['stretch', 'start', 'center', 'end'], default: 'stretch' },
  { key: 'alignItems', label: 'align-items', type: 'select', choices: ['stretch', 'start', 'center', 'end'], default: 'stretch' },
  { key: 'useAreas', label: 'Named areas', type: 'toggle', default: true },
  {
    key: 'areas',
    label: 'grid-template-areas',
    type: 'text',
    multiline: true,
    mono: true,
    default: 'header header header\nnav main main\nfooter footer footer',
    showIf: useAreas,
    help: 'One line per row; use the same name in neighbouring cells to span them, and "." for an empty cell.',
  },
  { key: 'items', label: 'Items', type: 'range', min: 1, max: 24, step: 1, default: 6, showIf: (v: Values) => v.useAreas !== true },
] as const;

/** Validates grid-template-areas: equal row lengths and rectangular areas. */
export function parseAreas(text: string): { rows: string[][]; names: string[] } {
  const rows = text
    .split('\n')
    .map((line) => line.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  if (rows.length === 0) throw new ToolError('Add at least one row of area names.');
  const width = (rows[0] as string[]).length;
  rows.forEach((row, index) => {
    if (row.length !== width) throw new ToolError(`Row ${index + 1} has ${row.length} cells but row 1 has ${width}. Every row needs the same number of cells.`);
    for (const cell of row) if (cell !== '.' && !/^-?[A-Za-z_][\w-]*$/.test(cell) && !/^\.+$/.test(cell)) throw new ToolError(`"${cell}" is not a valid area name.`);
  });
  const names = [...new Set(rows.flat().filter((cell) => !/^\.+$/.test(cell)))];
  for (const name of names) {
    let top = Infinity;
    let bottom = -1;
    let left = Infinity;
    let right = -1;
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y] as string[];
      for (let x = 0; x < row.length; x++) {
        if (row[x] === name) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) if (rows[y]?.[x] !== name) throw new ToolError(`The area "${name}" is not a rectangle. Areas must form a single rectangle of cells.`);
  }
  return { rows, names };
}

export default defineVisualTool({
  controls,
  presets: [
    { name: 'Holy grail', values: { useAreas: true, columns: '200px 1fr 160px', rows: 'auto 1fr auto', areas: 'header header header\nnav main aside\nfooter footer footer' } },
    { name: 'Gallery', values: { useAreas: false, columns: 'repeat(auto-fill, minmax(120px, 1fr))', rows: '', items: 12 } },
    { name: 'Dashboard', values: { useAreas: true, columns: 'repeat(4, 1fr)', rows: 'auto auto 1fr', areas: 'kpi1 kpi2 kpi3 kpi4\nchart chart chart side\nchart chart chart side' } },
    { name: '12 columns', values: { useAreas: false, columns: 'repeat(12, 1fr)', rows: '', items: 12, columnGap: 8 } },
  ],
  render(v) {
    const container: [string, string][] = [['display', 'grid']];
    if (v.columns.trim()) container.push(['grid-template-columns', v.columns.trim()]);
    if (v.rows.trim()) container.push(['grid-template-rows', v.rows.trim()]);
    let names: string[] = [];
    if (v.useAreas) {
      const parsed = parseAreas(v.areas);
      names = parsed.names;
      container.push(['grid-template-areas', parsed.rows.map((row) => `"${row.join(' ')}"`).join('\n    ')]);
    }
    if (v.columnGap === v.rowGap) container.push(['gap', px(v.columnGap)]);
    else container.push(['gap', `${px(v.rowGap)} ${px(v.columnGap)}`]);
    if (v.justifyItems !== 'stretch') container.push(['justify-items', v.justifyItems]);
    if (v.alignItems !== 'stretch') container.push(['align-items', v.alignItems]);
    const cells = v.useAreas ? names : Array.from({ length: v.items }, (_, i) => String(i + 1));
    const itemCss = v.useAreas ? names.map((name) => rule(`.${name}`, [['grid-area', name]])).join('') : '';
    const markup = `<div class="layout">\n${cells.map((cell) => (v.useAreas ? `  <div class="${cell}">${cell}</div>` : `  <div>${cell}</div>`)).join('\n')}\n</div>\n`;
    return {
      preview: (
        <div class="pv-grid" style={inline(container.map(([p, value]) => [p, p === 'grid-template-areas' ? value.replace(/\n\s*/g, ' ') : value]))}>
          {cells.map((cell) => (
            <div key={cell} class="pv-grid-item" style={v.useAreas ? `grid-area: ${cell};` : undefined}>
              {cell}
            </div>
          ))}
        </div>
      ),
      css: '.pv-grid { width: 100%; min-height: 360px; padding: 12px; border: 2px dashed var(--line-strong); border-radius: 6px; background: var(--panel); } .pv-grid-item { min-height: 44px; padding: 8px; display: grid; place-content: center; border-radius: 4px; background: var(--accent); color: #fff; font: 600 14px var(--font-ui); } .pv-grid-item:nth-child(even) { background: var(--brass); }',
      outputs: [css(`${rule('.layout', container)}${itemCss ? `\n${itemCss}` : ''}`), html(markup)],
    };
  },
});
