import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'medium',
      label: 'Medium',
      type: 'segmented',
      choices: [
        { value: 'liquid', label: 'Liquid' },
        { value: 'gas', label: 'Gas' },
      ],
      default: 'liquid',
    },
    {
      key: 'solve',
      label: 'Find',
      type: 'segmented',
      choices: [
        { value: 'kv', label: 'Kv / Cv' },
        { value: 'flow', label: 'Flow' },
        { value: 'dp', label: 'Pressure drop' },
      ],
      default: 'kv',
    },
    { key: 'flow', label: 'Flow', type: 'number', default: 12, min: 0, step: 0.1, unit: 'm³/h (gas: Nm³/h)', showIf: (v) => v.solve !== 'flow' },
    { key: 'kv', label: 'Valve Kv', type: 'number', default: 25, min: 0.01, step: 0.1, showIf: (v) => v.solve !== 'kv' },
    { key: 'dp', label: 'Pressure drop across the valve', type: 'number', default: 0.5, min: 0.001, step: 0.05, unit: 'bar', showIf: (v) => v.solve !== 'dp' },
    { key: 'sg', label: 'Specific gravity (water = 1)', type: 'number', default: 1, min: 0.1, max: 3, step: 0.01, showIf: (v) => v.medium === 'liquid' },
    { key: 'p1', label: 'Inlet pressure (absolute)', type: 'number', default: 7, min: 0.1, step: 0.1, unit: 'bar a', showIf: (v) => v.medium === 'gas' },
    {
      key: 'density',
      label: 'Gas density at normal conditions',
      type: 'number',
      default: 1.293,
      min: 0.05,
      step: 0.001,
      unit: 'kg/Nm³',
      help: 'Air 1.293, natural gas ≈ 0.78, nitrogen 1.25, CO₂ 1.98.',
      showIf: (v) => v.medium === 'gas',
    },
    { key: 'temperature', label: 'Gas temperature', type: 'number', default: 20, min: -200, max: 800, step: 1, unit: '°C', showIf: (v) => v.medium === 'gas' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const fields: Field[] = [];
    if (o.medium === 'liquid') {
      // Kv = Q √(SG/ΔP), Q in m³/h and ΔP in bar (IEC 60534).
      const kv = o.solve === 'kv' ? o.flow * Math.sqrt(o.sg / o.dp) : o.kv;
      const flow = o.solve === 'flow' ? kv * Math.sqrt(o.dp / o.sg) : o.flow;
      const dp = o.solve === 'dp' ? o.sg * (flow / kv) ** 2 : o.dp;
      fields.push(
        { label: 'Kv', value: num(kv, 2), mono: true, tone: o.solve === 'kv' ? 'ok' : undefined },
        { label: 'Cv (US)', value: num(kv * 1.156, 2), mono: true, tone: o.solve === 'kv' ? 'ok' : undefined },
        { label: 'Flow', value: `${num(flow, 2)} m³/h = ${num(flow * 4.40287, 1)} US gpm`, mono: true, tone: o.solve === 'flow' ? 'ok' : undefined },
        { label: 'Pressure drop', value: `${num(dp, 3)} bar = ${num(dp * 14.5038, 2)} psi`, mono: true, tone: o.solve === 'dp' ? 'ok' : undefined },
        { label: 'Select a valve with', value: o.solve === 'kv' ? `Kvs about ${num(kv * 1.25, 1)} (controlling near 80% open)` : 'Kv at the operating opening as above' },
      );
      return { fields, info: 'Turbulent, non-flashing liquid (IEC 60534 simplified). Check for cavitation when the pressure drop is large.' };
    }
    const t = o.temperature + 273.15;
    const critical = (dp: number) => dp >= o.p1 / 2;
    // Gas (VDI/VDE 2173): subcritical Q = 514 Kv √(ΔP·p2/(ρn·T)); critical Q = 257 Kv p1/√(ρn·T).
    const flowFor = (kv: number, dp: number) => (critical(dp) ? 257 * kv * (o.p1 / Math.sqrt(o.density * t)) : 514 * kv * Math.sqrt((dp * (o.p1 - dp)) / (o.density * t)));
    if (o.solve === 'dp') throw new ToolError('For gases, find Kv or flow; the pressure drop has two solutions near choked flow.');
    const kv = o.solve === 'kv' ? o.flow / flowFor(1, o.dp) : o.kv;
    const flow = o.solve === 'flow' ? flowFor(kv, o.dp) : o.flow;
    fields.push(
      { label: 'Kv', value: num(kv, 3), mono: true, tone: o.solve === 'kv' ? 'ok' : undefined },
      { label: 'Cv (US)', value: num(kv * 1.156, 3), mono: true },
      { label: 'Flow', value: `${num(flow, 1)} Nm³/h`, mono: true, tone: o.solve === 'flow' ? 'ok' : undefined },
      { label: 'Flow regime', value: critical(o.dp) ? 'Choked (critical): more pressure drop gives no more flow' : 'Subcritical', tone: critical(o.dp) ? 'warn' : undefined },
    );
    return { fields, info: 'Simplified gas sizing (VDI/VDE 2173); for final selection use IEC 60534-2-1 with the expansion factor.' };
  },
});
