import { HP_TO_KW, IEC_BREAKERS, NEC_MOTOR_1PH, NEC_MOTOR_3PH_460, nextSize, SQRT3, STARTING_MULTIPLIER, typicalMotor } from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'unit',
      label: 'Rated output in',
      type: 'segmented',
      choices: [
        { value: 'kw', label: 'kW' },
        { value: 'hp', label: 'hp' },
      ],
      default: 'kw',
    },
    { key: 'power', label: 'Rated output', type: 'number', default: 11, min: 0.01, step: 0.1 },
    {
      key: 'phase',
      label: 'Supply',
      type: 'segmented',
      choices: [
        { value: '3', label: 'Three-phase' },
        { value: '1', label: 'Single-phase' },
      ],
      default: '3',
    },
    { key: 'volts', label: 'Voltage', type: 'number', default: 415, min: 1, step: 1, unit: 'V' },
    { key: 'rpm', label: 'Speed', type: 'number', default: 1460, min: 1, step: 10, unit: 'rpm' },
    { key: 'efficiency', label: 'Efficiency', type: 'number', default: 0, min: 0, max: 1, step: 0.01, help: '0 uses a typical IE2/IE3 value for the size.' },
    { key: 'pf', label: 'Power factor', type: 'number', default: 0, min: 0, max: 1, step: 0.01, help: '0 uses a typical value for the size.' },
    {
      key: 'starter',
      label: 'Starting method',
      type: 'select',
      choices: [
        { value: 'dol', label: 'Direct on line' },
        { value: 'star', label: 'Star-delta' },
        { value: 'soft', label: 'Soft starter' },
        { value: 'vfd', label: 'Variable frequency drive' },
      ],
      default: 'dol',
    },
    {
      key: 'hz',
      label: 'Frequency',
      type: 'segmented',
      choices: [
        { value: '50', label: '50 Hz' },
        { value: '60', label: '60 Hz' },
      ],
      default: '50',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const kw = o.unit === 'hp' ? o.power * HP_TO_KW : o.power;
    const hp = kw / HP_TO_KW;
    if (!(kw > 0)) throw new ToolError('Enter the motor rating.');
    const typical = typicalMotor(kw);
    const efficiency = o.efficiency > 0 ? o.efficiency : typical.efficiency;
    const pf = o.pf > 0 ? o.pf : typical.pf;
    const inputKw = kw / efficiency;
    const amps = o.phase === '3' ? (inputKw * 1000) / (SQRT3 * o.volts * pf) : (inputKw * 1000) / (o.volts * pf);
    const torque = (9550 * kw) / o.rpm;
    const poles = Math.round((120 * Number(o.hz)) / o.rpm / 2) * 2 || 2;
    const synchronous = (120 * Number(o.hz)) / poles;
    const fields: Field[] = [
      heading('Running'),
      { label: 'Full-load current', value: `${num(amps, 1)} A`, mono: true, tone: 'ok' },
      { label: 'Input power', value: `${num(inputKw, 2)} kW, ${num(inputKw / pf, 2)} kVA`, mono: true },
      { label: 'Rated torque', value: `${num(torque, 1)} N·m (${num(torque * 0.737562, 1)} lbf·ft)`, mono: true },
      { label: 'Poles and slip', value: `${poles} poles, synchronous ${num(synchronous, 0)} rpm, slip ${num(((synchronous - o.rpm) / synchronous) * 100, 1)}%` },
      { label: 'Assumed', value: `efficiency ${num(efficiency * 100, 1)}%, power factor ${num(pf, 2)}${o.efficiency > 0 && o.pf > 0 ? '' : ' (typical for the size)'}` },
      heading('Starting and protection'),
      {
        label: 'Starting current',
        value: `about ${num(amps * (STARTING_MULTIPLIER[o.starter] ?? 6.5), 0)} A (${STARTING_MULTIPLIER[o.starter] ?? 6.5}× full load)`,
        mono: true,
        tone: o.starter === 'dol' && kw > 7.5 ? 'warn' : undefined,
      },
      { label: 'Overload relay setting', value: `${num(amps, 1)} A`, mono: true },
      { label: 'Cable sized for', value: `${num(amps * 1.25, 1)} A (125% of full load)`, mono: true },
      { label: 'Motor-protection breaker', value: `${nextSize(IEC_BREAKERS, amps * 1.25) ?? '—'} A frame or larger, with the trip set to the full-load current` },
    ];
    const hpKeys = Object.keys(NEC_MOTOR_3PH_460).map(Number);
    const nearestHp = hpKeys.reduce((best, key) => (Math.abs(key - hp) < Math.abs(best - hp) ? key : best), hpKeys[0] as number);
    if (o.phase === '3' && Math.abs(nearestHp - hp) / hp < 0.08) {
      const at460 = NEC_MOTOR_3PH_460[nearestHp] as number;
      fields.push(heading('NEC Table 430.250'), { label: `${nearestHp} hp at ${o.volts} V`, value: `${num((at460 * 460) / o.volts, 1)} A (table value scaled from 460 V)`, mono: true });
    }
    const single = Object.entries(NEC_MOTOR_1PH).find(([key]) => Math.abs(Number(key) - hp) / hp < 0.08);
    if (o.phase === '1' && single) fields.push(heading('NEC Table 430.248'), { label: `${num(Number(single[0]), 2)} hp`, value: `${single[1][0]} A at 115 V, ${single[1][1]} A at 230 V`, mono: true });
    if (o.starter === 'dol' && kw > 7.5) fields.push({ label: 'Note', value: 'Supply companies often limit direct-on-line starting above about 7.5 kW (10 hp); check the local rules.', tone: 'warn' });
    return { fields, info: ESTIMATE };
  },
});
