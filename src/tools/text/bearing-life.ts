import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { num } from './_calc';

/** ISO 281:2007 life adjustment factor a1 for reliability. */
const RELIABILITY: Record<string, number> = { '90': 1, '95': 0.64, '96': 0.55, '97': 0.47, '98': 0.37, '99': 0.25, '99.5': 0.175, '99.9': 0.093 };

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'type',
      label: 'Bearing type',
      type: 'segmented',
      choices: [
        { value: '3', label: 'Ball' },
        { value: '3.333', label: 'Roller' },
      ],
      default: '3',
    },
    { key: 'c', label: 'Dynamic load rating C', type: 'number', default: 30.7, min: 0.01, step: 0.1, unit: 'kN' },
    { key: 'radial', label: 'Radial load Fr', type: 'number', default: 3, min: 0, step: 0.1, unit: 'kN' },
    { key: 'axial', label: 'Axial load Fa', type: 'number', default: 0, min: 0, step: 0.1, unit: 'kN' },
    { key: 'x', label: 'Radial factor X', type: 'number', default: 1, min: 0, max: 2, step: 0.01, help: 'From the bearing catalogue; X = 1, Y = 0 for pure radial load.' },
    { key: 'y', label: 'Axial factor Y', type: 'number', default: 0, min: 0, max: 5, step: 0.01 },
    { key: 'rpm', label: 'Speed', type: 'number', default: 1450, min: 1, step: 10, unit: 'rpm' },
    { key: 'reliability', label: 'Reliability', type: 'select', choices: Object.keys(RELIABILITY).map((value) => ({ value, label: `${value}%` })), default: '90' },
    { key: 'aiso', label: 'Life modification factor aISO', type: 'number', default: 1, min: 0.1, max: 50, step: 0.1, help: 'Accounts for lubrication and contamination; 1 ignores them.' },
    { key: 'required', label: 'Required life', type: 'number', default: 20000, min: 0, step: 1000, unit: 'h' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const p = o.radial > 0 || o.axial > 0 ? o.x * o.radial + o.y * o.axial : 0;
    if (p <= 0) throw new ToolError('Enter the load on the bearing.');
    const exponent = Number(o.type);
    const l10 = (o.c / p) ** exponent;
    const a1 = RELIABILITY[o.reliability] ?? 1;
    const lnm = a1 * o.aiso * l10;
    const hours = (lnm * 1e6) / (60 * o.rpm);
    const fields: Field[] = [
      { label: 'Equivalent load P', value: `${num(p, 2)} kN`, mono: true },
      { label: 'Load ratio C/P', value: num(o.c / p, 2), mono: true, tone: o.c / p < 2 ? 'warn' : undefined },
      { label: 'Basic life L10', value: `${num(l10, 1)} million revolutions = ${num((l10 * 1e6) / (60 * o.rpm), 0)} h`, mono: true },
      {
        label: `Modified life L${o.reliability === '90' ? '10' : (100 - Number(o.reliability)).toString()}m`,
        value: `${num(hours, 0)} h (${num(hours / 8760, 1)} years running non-stop)`,
        mono: true,
        tone: hours >= o.required ? 'ok' : 'bad',
      },
      {
        label: 'Meets the requirement',
        value: hours >= o.required ? 'Yes' : `No: needs C ≥ ${num(p * ((o.required * 60 * o.rpm) / 1e6 / (a1 * o.aiso)) ** (1 / exponent), 1)} kN`,
        tone: hours >= o.required ? 'ok' : 'bad',
      },
    ];
    return { fields, info: 'ISO 281 basic rating life; a catalogue’s aISO calculation refines it for lubrication and cleanliness.' };
  },
});
