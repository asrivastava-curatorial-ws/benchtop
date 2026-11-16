import { UPS_SIZES } from '../../lib/electrical';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num } from './_calc';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'racks', label: 'Racks', type: 'number', default: 12, min: 1, max: 10000, step: 1 },
    { key: 'kwPerRack', label: 'Average load per rack', type: 'number', default: 5, min: 0.1, max: 150, step: 0.1, unit: 'kW' },
    { key: 'pue', label: 'PUE', type: 'number', default: 1.6, min: 1, max: 3, step: 0.05, help: 'Total facility power ÷ IT power. 1.2–1.4 is efficient; 1.8+ is typical of older rooms.' },
    {
      key: 'redundancy',
      label: 'UPS redundancy',
      type: 'select',
      choices: [
        { value: 'n', label: 'N' },
        { value: 'n1', label: 'N+1' },
        { value: '2n', label: '2N' },
      ],
      default: 'n1',
    },
    { key: 'moduleKva', label: 'UPS module size', type: 'number', default: 40, min: 1, max: 1000, step: 1, unit: 'kVA' },
    { key: 'pf', label: 'UPS output power factor', type: 'number', default: 0.9, min: 0.7, max: 1, step: 0.05 },
    { key: 'growth', label: 'Growth allowance', type: 'number', default: 25, min: 0, max: 200, step: 5, unit: '%' },
    { key: 'tariff', label: 'Energy charge', type: 'number', default: 8.5, min: 0, step: 0.1, help: 'Per kWh.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const it = o.racks * o.kwPerRack;
    const design = it * (1 + o.growth / 100);
    const facility = it * o.pue;
    // Nearly all IT power becomes heat, plus roughly 10% for UPS, PDU and lighting losses in the room.
    const cooling = it * 1.1;
    const needKva = design / o.pf;
    const modules = Math.ceil(needKva / o.moduleKva);
    const installed = o.redundancy === '2n' ? modules * 2 : o.redundancy === 'n1' ? modules + 1 : modules;
    const fields: Field[] = [
      heading('Power'),
      { label: 'IT load now', value: `${num(it, 1)} kW`, mono: true },
      { label: 'IT load with growth', value: `${num(design, 1)} kW, ${num(needKva, 1)} kVA`, mono: true },
      { label: 'Facility load at this PUE', value: `${num(facility, 1)} kW`, mono: true },
      heading('UPS'),
      { label: 'Modules needed', value: `${modules} × ${o.moduleKva} kVA for the load`, mono: true },
      { label: 'Modules installed', value: `${installed} × ${o.moduleKva} kVA (${o.redundancy === 'n1' ? 'N+1' : o.redundancy === '2n' ? '2N' : 'N'})`, mono: true, tone: 'ok' },
      { label: 'Nearest single frame', value: `${UPS_SIZES.find((size) => size >= needKva) ?? '—'} kVA`, mono: true },
      heading('Cooling'),
      { label: 'Heat to remove', value: `${num(cooling, 1)} kW = ${num(cooling / 3.517, 1)} TR = ${num(cooling * 3412.14, 0)} BTU/h`, mono: true },
      { label: 'Airflow at 11 °C ΔT', value: `${num(((cooling * 1000) / (1.2 * 1005 * 11)) * 3600, 0)} m³/h (${num(((cooling * 1000) / (1.2 * 1005 * 11)) * 2118.88, 0)} CFM)`, mono: true },
      heading('Running cost'),
      { label: 'Energy per year', value: `${num((facility * 8760) / 1000, 1)} MWh`, mono: true },
      { label: 'Cost per year', value: num(facility * 8760 * o.tariff, 0), mono: true },
      { label: 'Overhead from PUE', value: `${num(((facility - it) * 8760 * o.tariff) / 1, 0)} a year is spent on cooling and losses`, mono: true },
    ];
    return { fields, info: ESTIMATE };
  },
});
