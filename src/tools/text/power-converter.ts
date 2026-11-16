import { HP_TO_KW, SQRT3 } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num, PF, PHASE, VOLTAGE } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'known',
      label: 'I know the',
      type: 'select',
      choices: [
        { value: 'kw', label: 'Real power (kW)' },
        { value: 'kva', label: 'Apparent power (kVA)' },
        { value: 'amps', label: 'Current (A)' },
        { value: 'hp', label: 'Motor output (hp)' },
      ],
      default: 'kw',
    },
    { key: 'value', label: 'Value', type: 'number', default: 10, min: 0, step: 0.1 },
    PHASE,
    VOLTAGE,
    PF,
    { key: 'efficiency', label: 'Motor efficiency', type: 'number', default: 0.9, min: 0.1, max: 1, step: 0.01, unit: '', showIf: (v) => v.known === 'hp' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.volts <= 0) throw new ToolError('Enter the voltage.');
    const pf = o.phase === 'dc' ? 1 : o.pf;
    const factor = o.phase === '3' ? SQRT3 * o.volts : o.volts;
    let kva: number;
    switch (o.known) {
      case 'kva':
        kva = o.value;
        break;
      case 'amps':
        kva = (factor * o.value) / 1000;
        break;
      case 'hp':
        kva = (o.value * HP_TO_KW) / o.efficiency / pf;
        break;
      default:
        kva = o.value / pf;
    }
    const kw = kva * pf;
    const amps = (kva * 1000) / factor;
    const kvar = Math.sqrt(Math.max(0, kva * kva - kw * kw));
    const fields: Field[] = [
      heading('Power'),
      { label: 'Real power', value: `${num(kw, 3)} kW`, mono: true, tone: o.known === 'kw' ? undefined : 'ok' },
      { label: 'Apparent power', value: `${num(kva, 3)} kVA`, mono: true },
      { label: 'Reactive power', value: `${num(kvar, 3)} kVAR`, mono: true },
      { label: 'Horsepower equivalent', value: `${num(kw / HP_TO_KW, 2)} hp`, mono: true },
      heading('Current'),
      { label: o.phase === '3' ? 'Line current' : 'Current', value: `${num(amps, 2)} A`, mono: true, tone: o.known === 'amps' ? undefined : 'ok' },
      { label: 'Phase angle', value: `${num((Math.acos(pf) * 180) / Math.PI, 1)}°`, mono: true },
    ];
    if (o.phase === '3') fields.push({ label: 'Phase voltage (star)', value: `${num(o.volts / SQRT3, 1)} V`, mono: true });
    return { fields, info: ESTIMATE };
  },
});
