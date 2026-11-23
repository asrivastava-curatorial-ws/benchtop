import { trimNumber } from '../../lib/color';
import { findPaper, fitsOn, inUnit, PAPERS, type Paper, SERIES_NAMES, type Series, sheetMass, type Unit } from '../../lib/paper';
import { defineTextTool, type Field } from '../types';

const UNIT_LABELS: Record<Unit, string> = { mm: 'mm', cm: 'cm', in: 'in', pt: 'pt', px: 'px' };
const digits = (unit: Unit) => (unit === 'in' ? 2 : unit === 'cm' ? 1 : unit === 'mm' ? 1 : 0);

function size(p: { width: number; height: number }, unit: Unit, dpi: number): string {
  const d = digits(unit);
  return `${trimNumber(inUnit(p.width, unit, dpi), d)} × ${trimNumber(inUnit(p.height, unit, dpi), d)} ${UNIT_LABELS[unit]}`;
}

const SHEETS = ['a3', 'sra3', 'crown', 'demy', 'double-demy'] as const;

/** Short side to long side: 1:√2 for ISO sizes, small whole numbers where they fit (17:22 for Letter). */
function paperRatio(width: number, height: number): string {
  const r = Math.max(width, height) / Math.min(width, height);
  const exact = trimNumber(r, 4);
  if (Math.abs(r / Math.SQRT2 - 1) < 0.004) return `1:√2 (${exact})`;
  for (let b = 1; b <= 40; b++) {
    const a = Math.round(r * b);
    if (Math.abs(a / b - r) <= r * 0.0015) return `${b}:${a} (${exact})`;
  }
  return `1:${exact}`;
}

export default defineTextTool({
  input: false,
  output: { label: 'Sizes' },
  runOnEmpty: true,
  options: [
    { key: 'paper', label: 'Paper', type: 'select', choices: PAPERS.map((p) => ({ value: p.id, label: `${p.name} — ${SERIES_NAMES[p.series]}` })), default: 'a4' },
    {
      key: 'orientation',
      label: 'Orientation',
      type: 'segmented',
      choices: [
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
      default: 'portrait',
    },
    { key: 'unit', label: 'Units', type: 'segmented', choices: ['mm', 'cm', 'in', 'pt', 'px'], default: 'mm' },
    { key: 'dpi', label: 'Resolution for pixels', type: 'number', default: 300, min: 1, max: 4800, step: 1, unit: 'dpi', help: '300 for print, 150 for posters seen from afar, 72 or 96 for screens.' },
    { key: 'gsm', label: 'Paper weight', type: 'number', default: 80, min: 1, max: 1000, step: 1, unit: 'g/m²' },
    {
      key: 'series',
      label: 'List',
      type: 'select',
      choices: [{ value: 'all', label: 'All sizes' }, ...Object.entries(SERIES_NAMES).map(([value, label]) => ({ value, label }))],
      default: 'all',
    },
  ],
  run(_input, o) {
    const unit = o.unit as Unit;
    const base = findPaper(o.paper) ?? (findPaper('a4') as Paper);
    const p = o.orientation === 'landscape' ? { ...base, width: base.height, height: base.width } : base;
    const mass = sheetMass(p, o.gsm);
    const fits = SHEETS.map((id) => findPaper(id) as Paper)
      .filter((s) => s.id !== base.id)
      .map((s) => `${fitsOn(p, s)} on ${s.name}`)
      .join(', ');
    const fields: Field[] = [
      { label: base.name, value: size(p, 'mm', o.dpi), mono: true },
      { label: 'Inches', value: size(p, 'in', o.dpi), mono: true },
      { label: 'Points (PDF)', value: size(p, 'pt', o.dpi), mono: true },
      { label: `Pixels at ${o.dpi} dpi`, value: size(p, 'px', o.dpi), mono: true },
      { label: 'Aspect ratio', value: paperRatio(p.width, p.height), mono: true },
      { label: 'Area', value: `${trimNumber((p.width * p.height) / 1_000_000, 4)} m²`, mono: true },
      { label: `Sheet at ${o.gsm} g/m²`, value: `${trimNumber(mass, 2)} g; a ream of 500 weighs ${trimNumber((mass * 500) / 1000, 2)} kg`, mono: true },
      { label: 'Copies per sheet', value: fits || '—' },
    ];
    if (base.note) fields.push({ label: 'Used for', value: base.note });

    const list = PAPERS.filter((x) => o.series === 'all' || x.series === (o.series as Series));
    const groups = new Map<Series, Paper[]>();
    for (const x of list) groups.set(x.series, [...(groups.get(x.series) ?? []), x]);
    const width = Math.max(...list.map((x) => x.name.length), 4);
    const lines: string[] = [];
    for (const [series, papers] of groups) {
      if (lines.length) lines.push('');
      lines.push(SERIES_NAMES[series]);
      for (const x of papers) {
        const shown = o.orientation === 'landscape' ? { width: x.height, height: x.width } : x;
        lines.push(`  ${x.name.padEnd(width)}  ${size(shown, unit, o.dpi).padEnd(24)}${unit === 'mm' ? `  ${size(shown, 'in', o.dpi)}` : `  ${size(shown, 'mm', o.dpi)}`}`);
      }
    }
    return { output: `${lines.join('\n')}\n`, fields, info: `${base.name}: ${size(p, unit, o.dpi)}${unit === 'px' ? ` at ${o.dpi} dpi` : ''}` };
  },
});
