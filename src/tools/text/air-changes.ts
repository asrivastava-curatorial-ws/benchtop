import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { heading, num } from './_calc';

/** Typical total air-change rates; codes and standards set the binding values. */
const SPACES: Record<string, { label: string; ach: string }> = {
  custom: { label: 'Not specified', ach: '' },
  office: { label: 'Office', ach: '4–6' },
  classroom: { label: 'Classroom', ach: '5–6' },
  gallery: { label: 'Museum gallery, library', ach: '4–6' },
  auditorium: { label: 'Auditorium, theatre', ach: '6–10' },
  restaurant: { label: 'Restaurant dining', ach: '8–12' },
  kitchen: { label: 'Commercial kitchen', ach: '15–30' },
  toilet: { label: 'Toilet (exhaust)', ach: '10–15' },
  lab: { label: 'Laboratory (occupied)', ach: '6–12' },
  ward: { label: 'Hospital patient room', ach: '4–6 (ASHRAE 170 minimum 4)' },
  isolation: { label: 'Airborne infection isolation room', ach: '12 or more' },
  theatre: { label: 'Operating theatre', ach: '20 or more' },
  parking: { label: 'Enclosed car park (exhaust)', ach: '6 normal, 10 for smoke' },
  iso8: { label: 'Cleanroom ISO 8', ach: '10–25' },
  iso7: { label: 'Cleanroom ISO 7', ach: '30–60' },
};

const FLOW_UNITS: Record<string, { label: string; m3h: number }> = {
  m3h: { label: 'm³/h', m3h: 1 },
  cfm: { label: 'CFM', m3h: 1.699011 },
  ls: { label: 'l/s', m3h: 3.6 },
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'mode',
      label: 'Find',
      type: 'segmented',
      choices: [
        { value: 'flow', label: 'Airflow' },
        { value: 'ach', label: 'Air changes' },
      ],
      default: 'flow',
    },
    { key: 'space', label: 'Space', type: 'select', choices: Object.entries(SPACES).map(([value, { label }]) => ({ value, label })), default: 'office' },
    { key: 'length', label: 'Length', type: 'number', default: 10, min: 0.1, step: 0.5, unit: 'm' },
    { key: 'width', label: 'Width', type: 'number', default: 8, min: 0.1, step: 0.5, unit: 'm' },
    { key: 'height', label: 'Ceiling height', type: 'number', default: 3, min: 1, max: 50, step: 0.1, unit: 'm' },
    { key: 'ach', label: 'Air changes per hour', type: 'number', default: 6, min: 0.1, max: 600, step: 0.5, showIf: (v) => v.mode === 'flow' },
    { key: 'flow', label: 'Airflow', type: 'number', default: 1000, min: 0, step: 10, showIf: (v) => v.mode === 'ach' },
    { key: 'unit', label: 'Airflow unit', type: 'segmented', choices: Object.entries(FLOW_UNITS).map(([value, { label }]) => ({ value, label })), default: 'cfm' },
    { key: 'people', label: 'People in the room', type: 'number', default: 0, min: 0, step: 1, help: 'Optional: shows the airflow per person.' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const volume = o.length * o.width * o.height;
    if (!(volume > 0)) throw new ToolError('Enter the room size.');
    const unit = FLOW_UNITS[o.unit] ?? (FLOW_UNITS.m3h as (typeof FLOW_UNITS)[string]);
    const m3h = o.mode === 'flow' ? o.ach * volume : o.flow * unit.m3h;
    const ach = m3h / volume;
    const space = SPACES[o.space];
    const fields: Field[] = [
      { label: 'Room volume', value: `${num(volume, 1)} m³ (${num(volume * 35.3147, 0)} ft³)`, mono: true },
      { label: 'Airflow', value: `${num(m3h, 0)} m³/h = ${num(m3h / 1.699011, 0)} CFM = ${num(m3h / 3.6, 0)} l/s`, mono: true, tone: o.mode === 'flow' ? 'ok' : undefined },
      { label: 'Air changes per hour', value: num(ach, 2), mono: true, tone: o.mode === 'ach' ? 'ok' : undefined },
    ];
    if (space?.ach) fields.push({ label: `Typical for ${space.label.toLowerCase()}`, value: `${space.ach} ACH`, mono: true });
    if (o.people > 0) fields.push({ label: 'Per person', value: `${num(m3h / 3.6 / o.people, 1)} l/s (${num(m3h / 1.699011 / o.people, 1)} CFM)`, mono: true });
    fields.push(
      heading('Clearing airborne particles (well-mixed room)'),
      { label: '90% removed', value: `${num((60 * Math.log(10)) / ach, 0)} min`, mono: true },
      { label: '99% removed', value: `${num((60 * Math.log(100)) / ach, 0)} min`, mono: true },
      { label: '99.9% removed', value: `${num((60 * Math.log(1000)) / ach, 0)} min`, mono: true },
    );
    return { fields, info: 'Typical ranges are guidance; ventilation codes (ASHRAE 62.1 and 170, the National Building Code) set required outdoor-air rates.' };
  },
});
