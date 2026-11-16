import { currentFor, IEC_BREAKERS, NEC_BREAKERS, nextSize } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, num, PF, PHASE, STANDARD, VOLTAGE } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    STANDARD,
    {
      key: 'kind',
      label: 'Load type',
      type: 'select',
      choices: [
        { value: 'general', label: 'General (lights, sockets, heaters)' },
        { value: 'continuous', label: 'Continuous (3 hours or more)' },
        { value: 'motor', label: 'Motor' },
        { value: 'ev', label: 'EV charger' },
        { value: 'transformer', label: 'Transformer primary' },
      ],
      default: 'general',
    },
    {
      key: 'loadBy',
      label: 'Load given as',
      type: 'segmented',
      choices: [
        { value: 'amps', label: 'Current' },
        { value: 'kw', label: 'Power' },
      ],
      default: 'kw',
    },
    { key: 'load', label: 'Load', type: 'number', default: 7.4, min: 0, step: 0.1, help: 'Amperes, or kilowatts.' },
    PHASE,
    VOLTAGE,
    PF,
    { key: 'cable', label: 'Cable rating (optional)', type: 'number', default: 0, min: 0, step: 1, unit: 'A', help: 'The derated current-carrying capacity of the cable, to check In ≤ Iz.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const pf = o.phase === 'dc' ? 1 : o.pf;
    const amps = o.loadBy === 'amps' ? o.load : currentFor(o.load * 1000, o.volts, o.phase as '1' | '3' | 'dc', pf);
    if (!(amps > 0)) throw new ToolError('Enter the load.');
    const factor = { general: 1, continuous: 1.25, motor: o.standard === 'nec' ? 2.5 : 1, ev: 1.25, transformer: 1.25 }[o.kind as 'general'] ?? 1;
    const sizes = o.standard === 'nec' ? NEC_BREAKERS : IEC_BREAKERS;
    const needed = amps * factor;
    const rating = nextSize(sizes, needed);
    const fields: Field[] = [
      { label: 'Load current', value: `${num(amps, 1)} A`, mono: true },
      { label: 'Sizing basis', value: factor === 1 ? 'Load current' : `${num(factor * 100, 0)}% of load current${o.kind === 'motor' ? ' (NEC 430.52 maximum for inverse-time breakers)' : ''}` },
      { label: 'Breaker rating', value: rating ? `${rating} A` : 'Larger than standard sizes', mono: true, tone: rating ? 'ok' : 'bad' },
    ];
    if (o.kind === 'motor' && o.standard === 'iec')
      fields.push({
        label: 'Curve',
        value: 'Use a motor-protection breaker or a D-curve MCB so starting current does not trip it; set the overload relay to the motor’s full-load current.',
        tone: 'warn',
      });
    else if (o.standard === 'iec')
      fields.push({ label: 'Curve', value: o.kind === 'transformer' ? 'D curve (high inrush)' : 'B curve for resistive loads and lighting; C curve for small motors and mixed loads' });
    if (o.cable > 0 && rating)
      fields.push({
        label: 'Cable check (In ≤ Iz)',
        value: rating <= o.cable ? `${rating} A ≤ ${o.cable} A: the cable is protected` : `${rating} A > ${o.cable} A: use a larger cable`,
        tone: rating <= o.cable ? 'ok' : 'bad',
      });
    if (o.kind === 'ev') fields.push({ label: 'Residual current', value: 'IEC 60364-7-722 needs RCD protection: type A plus 6 mA DC detection, or type B.' });
    return { fields, info: ESTIMATE };
  },
});
