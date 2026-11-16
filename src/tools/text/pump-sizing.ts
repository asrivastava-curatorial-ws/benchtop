import { ToolError } from '../../lib/errors';
import { G, P_ATM, pipeFlow, ROUGHNESS, water, waterVapourPressure } from '../../lib/fluids';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'flow', label: 'Flow', type: 'number', default: 10, min: 0.01, step: 0.1, unit: 'm³/h' },
    { key: 'static', label: 'Static lift (level difference)', type: 'number', default: 25, min: -500, max: 2000, step: 0.5, unit: 'm' },
    { key: 'pressure', label: 'Pressure needed at the outlet', type: 'number', default: 1, min: 0, max: 100, step: 0.1, unit: 'bar' },
    { key: 'diameter', label: 'Pipe inside diameter', type: 'number', default: 50, min: 5, max: 2000, step: 1, unit: 'mm' },
    { key: 'length', label: 'Pipe length', type: 'number', default: 120, min: 0, step: 1, unit: 'm' },
    { key: 'fittings', label: 'Fittings (sum of K values)', type: 'number', default: 8, min: 0, max: 500, step: 0.5, help: 'Elbow ≈ 0.75, gate valve ≈ 0.2, check valve ≈ 2, entry ≈ 0.5, exit = 1.' },
    {
      key: 'material',
      label: 'Pipe material',
      type: 'select',
      choices: Object.entries(ROUGHNESS)
        .filter(([key]) => key !== 'duct')
        .map(([value, { label }]) => ({ value, label })),
      default: 'pvc',
    },
    { key: 'temperature', label: 'Water temperature', type: 'number', default: 25, min: 1, max: 99, step: 1, unit: '°C' },
    { key: 'pumpEff', label: 'Pump efficiency', type: 'number', default: 70, min: 10, max: 95, step: 1, unit: '%' },
    { key: 'motorEff', label: 'Motor efficiency', type: 'number', default: 90, min: 50, max: 99, step: 1, unit: '%' },
    { key: 'suction', label: 'Suction: liquid level above the pump', type: 'number', default: -3, min: -10, max: 50, step: 0.5, unit: 'm', help: 'Negative when the pump lifts from below.' },
    { key: 'hours', label: 'Running hours per day', type: 'number', default: 6, min: 0, max: 24, step: 0.5 },
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.flow <= 0 || o.diameter <= 0) throw new ToolError('Enter the flow and pipe diameter.');
    const { density, viscosity } = water(o.temperature);
    const q = o.flow / 3600;
    const d = o.diameter / 1000;
    const flow = pipeFlow(q, d, o.length, density, viscosity, ROUGHNESS[o.material]?.metres ?? 0.0015e-3, o.fittings);
    const pressureHead = (o.pressure * 1e5) / (density * G);
    const head = o.static + flow.headLoss + pressureHead;
    const hydraulic = density * G * q * head;
    const shaft = hydraulic / (o.pumpEff / 100);
    const input = shaft / (o.motorEff / 100);
    const npsha = (P_ATM - waterVapourPressure(o.temperature)) / (density * G) + o.suction - flow.headLoss * 0.1;
    const fields: Field[] = [
      heading('Head'),
      { label: 'Total dynamic head', value: `${num(head, 1)} m (${num((head * density * G) / 1e5, 2)} bar)`, mono: true, tone: 'ok' },
      { label: 'Friction loss', value: `${num(flow.headLoss, 2)} m`, mono: true },
      { label: 'Velocity in the pipe', value: `${num(flow.velocity, 2)} m/s`, mono: true, tone: flow.velocity > 3 ? 'warn' : flow.velocity < 0.6 ? 'warn' : undefined },
      { label: 'Reynolds number', value: `${num(flow.reynolds, 0)} (${flow.reynolds < 2300 ? 'laminar' : 'turbulent'})`, mono: true },
      heading('Power'),
      { label: 'Hydraulic power', value: `${num(hydraulic / 1000, 2)} kW`, mono: true },
      { label: 'Pump shaft power', value: `${num(shaft / 1000, 2)} kW`, mono: true },
      { label: 'Motor to choose', value: `at least ${num((shaft / 1000) * 1.15, 2)} kW (${num(((shaft / 1000) * 1.15) / 0.7457, 1)} hp) with 15% margin`, mono: true, tone: 'ok' },
      { label: 'Electrical input', value: `${num(input / 1000, 2)} kW`, mono: true },
      { label: 'Running cost', value: `${num(((input / 1000) * o.hours * 365 * o.tariff) / 1, 0)} a year`, mono: true },
      heading('Suction'),
      {
        label: 'NPSH available',
        value: `about ${num(npsha, 1)} m, taking a tenth of the friction as suction-side loss; it must exceed the pump’s NPSH required with margin`,
        mono: true,
        tone: npsha < 3 ? 'warn' : undefined,
      },
    ];
    if (flow.velocity > 3) fields.push({ label: 'Note', value: 'Velocities above about 3 m/s cause noise, erosion and water hammer; consider a larger pipe.', tone: 'warn' });
    return { fields, info: ESTIMATE };
  },
});
