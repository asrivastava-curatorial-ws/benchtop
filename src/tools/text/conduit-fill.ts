import { CONDUIT_AREAS, fillLimit, THHN_AREAS } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'mode',
      label: 'Sizes in',
      type: 'segmented',
      choices: [
        { value: 'nec', label: 'NEC trade sizes' },
        { value: 'metric', label: 'Millimetres' },
      ],
      default: 'metric',
      help: 'NEC uses the Chapter 9 areas of THHN wire in EMT or PVC conduit; millimetres works for any cable.',
    },
    { key: 'conduit', label: 'Conduit', type: 'select', choices: Object.keys(CONDUIT_AREAS), default: 'EMT', showIf: (v) => v.mode === 'nec' },
    { key: 'wires', label: 'Conductors', type: 'text', default: '3 × 10 AWG, 1 × 12 AWG', mono: true, wide: true, help: 'Count × size, separated by commas.', showIf: (v) => v.mode === 'nec' },
    {
      key: 'inside',
      label: 'Conduit inside diameter',
      type: 'number',
      default: 21.1,
      min: 1,
      step: 0.1,
      unit: 'mm',
      help: '25 mm PVC conduit is about 21 mm inside; check the maker’s data.',
      showIf: (v) => v.mode === 'metric',
    },
    { key: 'cables', label: 'Cables', type: 'text', default: '4 × 5.2', mono: true, wide: true, help: 'Count × outside diameter in mm, separated by commas.', showIf: (v) => v.mode === 'metric' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const entries = (o.mode === 'nec' ? o.wires : o.cables)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = /^(\d+)\s*[x×*]\s*(.+)$/i.exec(part);
        return { count: match ? Number(match[1]) : 1, size: (match ? (match[2] as string) : part).trim() };
      });
    if (entries.length === 0) throw new ToolError('List the conductors as count × size.');
    const count = entries.reduce((sum, entry) => sum + entry.count, 0);
    const limit = fillLimit(count);
    const fields: Field[] = [];
    if (o.mode === 'nec') {
      const wireArea = entries.reduce((sum, entry) => {
        const size = /awg|kcmil/i.test(entry.size) ? entry.size.replace(/\s*awg/i, ' AWG').replace(/\s*kcmil/i, ' kcmil') : `${entry.size} AWG`;
        const area = THHN_AREAS[size];
        if (area === undefined) throw new ToolError(`No THHN area for "${entry.size}".`);
        return sum + area * entry.count;
      }, 0);
      const sizes = CONDUIT_AREAS[o.conduit] ?? {};
      const fit = Object.entries(sizes).find(([, area]) => wireArea <= area * limit);
      fields.push(
        { label: 'Conductor area', value: `${num(wireArea, 4)} in² (${count} conductors)`, mono: true },
        { label: 'Allowed fill', value: `${limit * 100}% (NEC Chapter 9 Table 1)` },
        { label: 'Smallest conduit', value: fit ? `${fit[0]} inch ${o.conduit} (${num((wireArea / fit[1]) * 100, 1)}% full)` : 'Larger than 4 inch: split the run', tone: fit ? 'ok' : 'bad' },
      );
      for (const [size, area] of Object.entries(sizes).slice(0, 6))
        fields.push({ label: `${size} inch`, value: `${num((wireArea / area) * 100, 1)}% full`, mono: true, tone: wireArea <= area * limit ? 'ok' : 'bad' });
    } else {
      const cableArea = entries.reduce((sum, entry) => {
        const diameter = Number(entry.size.replace(/mm/i, ''));
        if (!(diameter > 0)) throw new ToolError(`"${entry.size}" is not a diameter in mm.`);
        return sum + entry.count * Math.PI * (diameter / 2) ** 2;
      }, 0);
      const conduitArea = Math.PI * (o.inside / 2) ** 2;
      const fill = cableArea / conduitArea;
      fields.push(
        { label: 'Cable area', value: `${num(cableArea, 1)} mm² (${count} cables)`, mono: true },
        { label: 'Conduit area', value: `${num(conduitArea, 1)} mm²`, mono: true },
        { label: 'Fill', value: `${num(fill * 100, 1)}% (limit ${limit * 100}%)`, mono: true, tone: fill <= limit ? 'ok' : 'bad' },
        { label: 'Smallest inside diameter for this fill', value: `${num(Math.sqrt((4 * cableArea) / (Math.PI * limit)), 1)} mm`, mono: true },
      );
    }
    return { fields, info: `${ESTIMATE} Long runs and bends need more space for pulling.` };
  },
});
