import { ToolError } from '../../lib/errors';
import { type AirState, airState, humidityRatioFromPressure, humidityRatioFromRh, humidityRatioFromWetBulb, mix, pressureAtAltitude, saturationPressure } from '../../lib/psychro';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

const temp = (celsius: number) => `${num(celsius, 1)} °C (${num((celsius * 9) / 5 + 32, 1)} °F)`;

export function stateFields(state: AirState): Field[] {
  return [
    { label: 'Dry bulb', value: temp(state.dryBulb), mono: true },
    { label: 'Relative humidity', value: `${num(state.relativeHumidity, 1)}%`, mono: true },
    { label: 'Wet bulb', value: temp(state.wetBulb), mono: true },
    { label: 'Dew point', value: temp(state.dewPoint), mono: true },
    { label: 'Humidity ratio', value: `${num(state.humidityRatio * 1000, 2)} g/kg dry air (${num(state.humidityRatio * 7000, 1)} gr/lb)`, mono: true },
    { label: 'Enthalpy', value: `${num(state.enthalpy, 2)} kJ/kg dry air`, mono: true },
    { label: 'Specific volume', value: `${num(state.specificVolume, 4)} m³/kg dry air`, mono: true },
    { label: 'Density', value: `${num(state.density, 4)} kg/m³`, mono: true },
    { label: 'Vapour pressure', value: `${num(state.vapourPressure / 1000, 3)} kPa (saturation ${num(state.saturationPressure / 1000, 3)} kPa)`, mono: true },
    { label: 'Absolute humidity', value: `${num(state.absoluteHumidity, 2)} g/m³`, mono: true },
  ];
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'known',
      label: 'Second property',
      type: 'select',
      choices: [
        { value: 'rh', label: 'Relative humidity' },
        { value: 'wb', label: 'Wet bulb' },
        { value: 'dp', label: 'Dew point' },
        { value: 'w', label: 'Humidity ratio' },
      ],
      default: 'rh',
    },
    { key: 'dryBulb', label: 'Dry bulb', type: 'number', default: 30, min: -50, max: 90, step: 0.5, unit: '°C' },
    { key: 'rh', label: 'Relative humidity', type: 'number', default: 60, min: 0, max: 100, step: 1, unit: '%', showIf: (v) => v.known === 'rh' },
    { key: 'wetBulb', label: 'Wet bulb', type: 'number', default: 24, min: -50, max: 90, step: 0.5, unit: '°C', showIf: (v) => v.known === 'wb' },
    { key: 'dew', label: 'Dew point', type: 'number', default: 21, min: -60, max: 90, step: 0.5, unit: '°C', showIf: (v) => v.known === 'dp' },
    { key: 'ratio', label: 'Humidity ratio', type: 'number', default: 15, min: 0, max: 200, step: 0.1, unit: 'g/kg', showIf: (v) => v.known === 'w' },
    { key: 'altitude', label: 'Altitude', type: 'number', default: 0, min: -400, max: 9000, step: 50, unit: 'm', help: 'Sets the air pressure; Bengaluru is about 920 m.' },
    { key: 'mixing', label: 'Mix with a second air stream', type: 'toggle', default: false },
    { key: 'dryBulb2', label: 'Stream 2 dry bulb', type: 'number', default: 24, min: -50, max: 90, step: 0.5, unit: '°C', showIf: (v) => v.mixing === true },
    { key: 'rh2', label: 'Stream 2 relative humidity', type: 'number', default: 50, min: 0, max: 100, step: 1, unit: '%', showIf: (v) => v.mixing === true },
    {
      key: 'share2',
      label: 'Stream 2 share of the mix',
      type: 'number',
      default: 70,
      min: 0,
      max: 100,
      step: 5,
      unit: '%',
      help: 'By mass of dry air; volume share is close enough at similar temperatures.',
      showIf: (v) => v.mixing === true,
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const p = pressureAtAltitude(o.altitude);
    const t = o.dryBulb;
    let w: number;
    if (o.known === 'rh') w = humidityRatioFromRh(t, o.rh, p);
    else if (o.known === 'wb') {
      if (o.wetBulb > t) throw new ToolError('The wet bulb cannot be above the dry bulb.');
      w = humidityRatioFromWetBulb(t, o.wetBulb, p);
    } else if (o.known === 'dp') {
      if (o.dew > t) throw new ToolError('The dew point cannot be above the dry bulb.');
      w = humidityRatioFromPressure(saturationPressure(o.dew), p);
    } else w = o.ratio / 1000;
    if (!(w >= 0)) throw new ToolError('That wet bulb is too low for this dry bulb: the air would hold negative moisture.');
    if (w > humidityRatioFromPressure(saturationPressure(t), p) * 1.0001) throw new ToolError('That is more moisture than the air can hold at this temperature.');
    const state = airState(t, w, p);
    const fields: Field[] = [{ label: 'Air pressure', value: `${num(p / 1000, 2)} kPa`, mono: true }, ...stateFields(state)];
    if (o.mixing) {
      const w2 = humidityRatioFromRh(o.dryBulb2, o.rh2, p);
      const mixed = mix(t, w, o.dryBulb2, w2, o.share2 / 100);
      const result = airState(mixed.t, mixed.w, p);
      fields.push(heading('Mixed air'), ...stateFields(result));
      if (result.relativeHumidity > 100) fields.push({ label: 'Note', value: 'The mix is supersaturated: fog or condensation forms', tone: 'warn' });
    }
    return { fields, info: 'ASHRAE Handbook — Fundamentals (2017) equations; saturation over ice below 0 °C.' };
  },
});
