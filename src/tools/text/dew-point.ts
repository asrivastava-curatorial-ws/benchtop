import { dewPointFromPressure, saturationPressure } from '../../lib/fluids';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

/** ISO 8573-1:2010 water classes by pressure dew point (°C). */
const ISO_CLASSES: readonly (readonly [number, number])[] = [
  [1, -70],
  [2, -40],
  [3, -20],
  [4, 3],
  [5, 7],
  [6, 10],
];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'mode',
      label: 'Convert',
      type: 'select',
      choices: [
        { value: 'air', label: 'Air temperature and humidity → dew point' },
        { value: 'pdp', label: 'Pressure dew point → atmospheric dew point' },
        { value: 'adp', label: 'Atmospheric dew point → pressure dew point' },
      ],
      default: 'pdp',
    },
    { key: 'temperature', label: 'Air temperature', type: 'number', default: 30, min: -40, max: 60, step: 0.5, unit: '°C', showIf: (v) => v.mode === 'air' },
    { key: 'rh', label: 'Relative humidity', type: 'number', default: 70, min: 1, max: 100, step: 1, unit: '%', showIf: (v) => v.mode === 'air' },
    { key: 'dew', label: 'Dew point', type: 'number', default: 3, min: -80, max: 50, step: 0.5, unit: '°C', showIf: (v) => v.mode !== 'air' },
    { key: 'pressure', label: 'Line pressure', type: 'number', default: 7, min: 0, max: 40, step: 0.5, unit: 'bar g', showIf: (v) => v.mode !== 'air' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const fields: Field[] = [];
    if (o.mode === 'air') {
      const pv = (saturationPressure(o.temperature) * o.rh) / 100;
      const dew = dewPointFromPressure(pv);
      fields.push(
        { label: 'Dew point', value: `${num(dew, 1)} °C`, mono: true, tone: 'ok' },
        { label: 'Water vapour pressure', value: `${num(pv / 100, 2)} hPa`, mono: true },
        { label: 'Spread (temperature − dew point)', value: `${num(o.temperature - dew, 1)} °C`, mono: true, tone: o.temperature - dew < 3 ? 'warn' : undefined },
      );
      return { fields, info: 'Magnus formula over water; accurate to about ±0.4 °C from −40 to 50 °C.' };
    }
    const ratio = (o.pressure + 1.01325) / 1.01325;
    let pdp: number;
    let adp: number;
    if (o.mode === 'pdp') {
      pdp = o.dew;
      adp = dewPointFromPressure(saturationPressure(pdp) / ratio);
    } else {
      adp = o.dew;
      pdp = dewPointFromPressure(saturationPressure(adp) * ratio);
    }
    const isoClass = ISO_CLASSES.find(([, limit]) => pdp <= limit);
    fields.push(
      { label: 'Pressure dew point', value: `${num(pdp, 1)} °C at ${o.pressure} bar g`, mono: true, tone: o.mode === 'adp' ? 'ok' : undefined },
      { label: 'Atmospheric dew point', value: `${num(adp, 1)} °C`, mono: true, tone: o.mode === 'pdp' ? 'ok' : undefined },
      heading('ISO 8573-1 water class'),
      { label: 'Class', value: isoClass ? `${isoClass[0]} (pressure dew point ≤ ${isoClass[1]} °C)` : 'Worse than class 6 (above +10 °C)', tone: isoClass ? 'ok' : 'warn' },
      { label: 'Typical dryer', value: pdp <= -40 ? 'Desiccant (adsorption) dryer' : pdp <= 3 ? 'Refrigerated dryer reaches about +3 °C; colder needs desiccant' : 'Refrigerated dryer' },
    );
    return { fields, info: 'Water vapour keeps its partial pressure when the air expands, so the dew point falls as pressure drops.' };
  },
});
