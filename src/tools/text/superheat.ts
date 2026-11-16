import { ToolError } from '../../lib/errors';
import { pressureAtAltitude } from '../../lib/psychro';
import { PRESSURE_UNITS, REFRIGERANTS, refrigerant, saturationPressures, saturationTemperature } from '../../lib/refrigerant';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

export function superheatTone(kelvin: number): Field['tone'] {
  if (kelvin < 2) return 'bad';
  if (kelvin < 4 || kelvin > 12) return 'warn';
  return 'ok';
}

export function subcoolingTone(kelvin: number): Field['tone'] {
  if (kelvin < 2) return 'bad';
  if (kelvin < 3 || kelvin > 12) return 'warn';
  return 'ok';
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'refrigerant', label: 'Refrigerant', type: 'select', choices: REFRIGERANTS.map(({ id, label }) => ({ value: id, label })), default: 'R32' },
    {
      key: 'mode',
      label: 'Calculate',
      type: 'segmented',
      choices: [
        { value: 'both', label: 'Gauge readings' },
        { value: 'pt', label: 'P–T chart' },
      ],
      default: 'both',
    },
    { key: 'unit', label: 'Gauge unit', type: 'segmented', choices: Object.entries(PRESSURE_UNITS).map(([value, { label }]) => ({ value, label })), default: 'bar' },
    { key: 'suction', label: 'Suction pressure (gauge)', type: 'number', default: 8.5, min: -1, step: 0.1, showIf: (v) => v.mode === 'both' },
    {
      key: 'suctionTemp',
      label: 'Suction line temperature',
      type: 'number',
      default: 10,
      min: -60,
      max: 60,
      step: 0.5,
      unit: '°C',
      help: 'Measured on the suction line near the outdoor unit or the evaporator outlet.',
      showIf: (v) => v.mode === 'both',
    },
    { key: 'liquid', label: 'Liquid line pressure (gauge)', type: 'number', default: 28, min: -1, step: 0.1, showIf: (v) => v.mode === 'both' },
    { key: 'liquidTemp', label: 'Liquid line temperature', type: 'number', default: 40, min: -60, max: 80, step: 0.5, unit: '°C', showIf: (v) => v.mode === 'both' },
    { key: 'from', label: 'Chart from', type: 'number', default: -40, min: -60, max: 60, step: 5, unit: '°C', showIf: (v) => v.mode === 'pt' },
    { key: 'to', label: 'Chart to', type: 'number', default: 60, min: -50, max: 100, step: 5, unit: '°C', showIf: (v) => v.mode === 'pt' },
    { key: 'altitude', label: 'Altitude', type: 'number', default: 0, min: 0, max: 5000, step: 50, unit: 'm', help: 'Gauges read above local air pressure; Bengaluru is about 920 m.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const r = refrigerant(o.refrigerant);
    const unit = PRESSURE_UNITS[o.unit] ?? (PRESSURE_UNITS.bar as (typeof PRESSURE_UNITS)[string]);
    const atmosphere = pressureAtAltitude(o.altitude);
    const gauge = (pa: number) => `${num((pa - atmosphere) / unit.pa, unit.pa >= 1e5 ? 2 : 1)} ${unit.label}`;
    const blend = r.dew !== undefined;
    const fields: Field[] = [];
    if (o.mode === 'pt') {
      if (o.to <= o.from) throw new ToolError('The chart must run from a lower to a higher temperature.');
      const step = o.to - o.from > 60 ? 5 : o.to - o.from > 20 ? 2 : 1;
      for (let t = o.from; t <= o.to + 1e-9; t += step) {
        const p = saturationPressures(r, t);
        if (!p) continue;
        fields.push({ label: `${t} °C`, value: blend ? `liquid ${gauge(p.bubble)}, vapour ${gauge(p.dew)}` : gauge(p.bubble), mono: true });
      }
      if (fields.length === 0) throw new ToolError(`${r.label} has no saturation curve in that range (critical point ${num(r.tc - 273.15, 1)} °C).`);
      return {
        fields,
        info: `Gauge pressures at ${num(atmosphere / 1000, 1)} kPa air pressure.${blend ? ' Blends boil over a range: use the vapour (dew) column for superheat, the liquid (bubble) column for subcooling.' : ''}`,
      };
    }
    const suction = o.suction * unit.pa + atmosphere;
    const liquid = o.liquid * unit.pa + atmosphere;
    const evaporating = saturationTemperature(r, suction, 'dew');
    const condensing = saturationTemperature(r, liquid, 'bubble');
    if (evaporating === undefined) throw new ToolError(`The suction pressure is outside the ${r.label} saturation range.`);
    const superheat = o.suctionTemp - evaporating;
    fields.push(
      heading('Low side'),
      { label: blend ? 'Evaporating (dew point)' : 'Evaporating temperature', value: `${num(evaporating, 1)} °C`, mono: true },
      { label: 'Superheat', value: `${num(superheat, 1)} K (${num(superheat * 1.8, 1)} °F)`, mono: true, tone: superheatTone(superheat) },
    );
    if (superheat < 2)
      fields.push({ label: 'Reading', value: 'Too little superheat: liquid may reach the compressor (overcharge, low airflow over the indoor coil, or an expansion valve stuck open)', tone: 'bad' });
    else if (superheat > 12) fields.push({ label: 'Reading', value: 'High superheat: the evaporator is starved (undercharge, restriction, or an expansion valve closing down)', tone: 'warn' });
    fields.push(heading('High side'));
    if (condensing === undefined) {
      fields.push({
        label: 'Condensing temperature',
        value: r.id === 'R744' ? 'Above the critical point: a transcritical CO₂ system has no condensing temperature; judge the gas cooler outlet instead' : 'Outside the saturation range',
        tone: 'warn',
      });
    } else {
      const subcooling = condensing - o.liquidTemp;
      fields.push(
        { label: blend ? 'Condensing (bubble point)' : 'Condensing temperature', value: `${num(condensing, 1)} °C`, mono: true },
        { label: 'Subcooling', value: `${num(subcooling, 1)} K (${num(subcooling * 1.8, 1)} °F)`, mono: true, tone: subcoolingTone(subcooling) },
      );
      if (subcooling < 2)
        fields.push({ label: 'Reading', value: 'Little subcooling: flash gas likely before the expansion device (undercharge or a dirty condenser feeding a restriction)', tone: 'bad' });
      else if (subcooling > 12) fields.push({ label: 'Reading', value: 'High subcooling: overcharge, or a restriction in the liquid line', tone: 'warn' });
    }
    const bubbleAtSuction = blend ? saturationTemperature(r, suction, 'bubble') : undefined;
    if (bubbleAtSuction !== undefined) fields.push({ label: 'Temperature glide at suction pressure', value: `${num(evaporating - bubbleAtSuction, 1)} K`, mono: true });
    return {
      fields,
      info: `Typical targets with an expansion valve: superheat 4–8 K, subcooling 4–8 K; the equipment maker’s charging chart wins. Saturation data: CoolProp ancillary equations.${blend ? ' Charge blends as liquid.' : ''}`,
    };
  },
});
