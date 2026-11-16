import { adiabaticArea, IEC_SIZES, iecProtectiveConductor, NEC_EGC } from '../../lib/electrical';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

const K_VALUES = [
  { value: '143', label: 'Copper, separate conductor, PVC-insulated (k = 143)' },
  { value: '176', label: 'Copper, separate conductor, XLPE-insulated (k = 176)' },
  { value: '115', label: 'Copper core in a PVC cable (k = 115)' },
  { value: '143c', label: 'Copper core in an XLPE cable (k = 143)' },
  { value: '95', label: 'Aluminium, separate, PVC (k = 95)' },
  { value: '76', label: 'Aluminium core in a PVC cable (k = 76)' },
  { value: '52', label: 'Steel conduit or armour (k = 52)' },
];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'standard',
      label: 'Standard',
      type: 'segmented',
      choices: [
        { value: 'iec', label: 'IEC 60364-5-54' },
        { value: 'nec', label: 'NEC 250.122' },
      ],
      default: 'iec',
    },
    { key: 'line', label: 'Line conductor size', type: 'number', default: 25, min: 0.5, step: 0.5, unit: 'mm²', showIf: (v) => v.standard === 'iec' },
    { key: 'fault', label: 'Earth fault current', type: 'number', default: 3000, min: 0, step: 100, unit: 'A', showIf: (v) => v.standard === 'iec', help: 'For the adiabatic check; 0 skips it.' },
    { key: 'time', label: 'Disconnection time', type: 'number', default: 0.4, min: 0.01, max: 5, step: 0.01, unit: 's', showIf: (v) => v.standard === 'iec' },
    { key: 'k', label: 'Material and insulation', type: 'select', choices: K_VALUES, default: '115', showIf: (v) => v.standard === 'iec' },
    { key: 'ocpd', label: 'Breaker or fuse rating', type: 'number', default: 100, min: 1, step: 1, unit: 'A', showIf: (v) => v.standard === 'nec' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const fields: Field[] = [];
    if (o.standard === 'nec') {
      const row = NEC_EGC.find(([rating]) => rating >= o.ocpd);
      fields.push(
        { label: 'Minimum copper grounding conductor', value: row ? row[1] : 'Engineering design needed above 6000 A', mono: true, tone: row ? 'ok' : 'warn' },
        { label: 'Note', value: 'Upsize it in proportion if the line conductors are upsized for voltage drop (NEC 250.122(B)).' },
      );
      return { fields, info: ESTIMATE };
    }
    const table = iecProtectiveConductor(o.line);
    fields.push(heading('Table 54.2 (same material as the line conductors)'), { label: 'Protective conductor', value: `${num(table, 1)} mm²`, mono: true });
    if (o.fault > 0) {
      const k = Number.parseInt(o.k, 10);
      const minimum = adiabaticArea(o.fault, o.time, k);
      const standard = IEC_SIZES.find((size) => size.area >= minimum)?.area;
      fields.push(
        heading('Adiabatic check (S = √(I²t) / k)'),
        { label: 'Minimum area', value: `${num(minimum, 2)} mm²`, mono: true },
        { label: 'Next standard size', value: standard ? `${standard} mm²` : 'above 300 mm²', mono: true, tone: 'ok' },
      );
      fields.push({ label: 'Table size passes', value: table >= minimum ? 'Yes' : `No: use at least ${standard ?? '—'} mm²`, tone: table >= minimum ? 'ok' : 'bad' });
    }
    fields.push({ label: 'Separate conductors', value: 'A protective conductor not in a cable or enclosure must be at least 2.5 mm² copper with mechanical protection, or 4 mm² without (543.1.3).' });
    return { fields, info: ESTIMATE };
  },
});
