import { ToolError } from '../../lib/errors';
import { humidityRatioFromRh, pressureAtAltitude } from '../../lib/psychro';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num, TR } from './_calc';

/** Screening allowances for heat through walls, roof and glass, W per m² of floor. */
const EXPOSURE: Record<string, { label: string; wm2: number }> = {
  interior: { label: 'Interior room: no outside wall or roof', wm2: 25 },
  shaded: { label: 'One outside wall, shaded or north-facing', wm2: 50 },
  normal: { label: 'Outside walls with some sun, normal windows', wm2: 80 },
  sunny: { label: 'Top floor under a roof, or large sunny windows', wm2: 120 },
  glass: { label: 'Glass façade or skylights, west sun', wm2: 160 },
};

/** Heat per person, sensible and latent W (ASHRAE Fundamentals, chapter 18). */
const ACTIVITY: Record<string, { label: string; sensible: number; latent: number }> = {
  seated: { label: 'Seated: theatre, classroom', sensible: 65, latent: 35 },
  office: { label: 'Office work, home', sensible: 75, latent: 55 },
  walking: { label: 'Standing and walking: shop, museum', sensible: 90, latent: 95 },
  heavy: { label: 'Heavy work, gym', sensible: 170, latent: 255 },
};

/** Common air-conditioner sizes in tons of refrigeration. */
export const AC_SIZES = [0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 5.5, 7.5, 8.5, 10, 11, 15, 16.5, 20];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'area', label: 'Floor area', type: 'number', default: 20, min: 1, step: 1, unit: 'm²' },
    { key: 'exposure', label: 'Exposure', type: 'select', choices: Object.entries(EXPOSURE).map(([value, { label }]) => ({ value, label })), default: 'normal' },
    { key: 'people', label: 'People', type: 'number', default: 2, min: 0, step: 1 },
    { key: 'activity', label: 'Activity', type: 'select', choices: Object.entries(ACTIVITY).map(([value, { label }]) => ({ value, label })), default: 'office' },
    { key: 'lighting', label: 'Lighting', type: 'number', default: 8, min: 0, max: 50, step: 1, unit: 'W/m²', help: 'About 8 for LED, 15 for fluorescent.' },
    { key: 'equipment', label: 'Equipment heat', type: 'number', default: 300, min: 0, step: 50, unit: 'W', help: 'Computers, displays, appliances: their running power.' },
    { key: 'freshAir', label: 'Outdoor air per person', type: 'number', default: 8, min: 0, max: 50, step: 0.5, unit: 'l/s' },
    { key: 'outdoor', label: 'Outdoor design temperature', type: 'number', default: 38, min: 20, max: 55, step: 0.5, unit: '°C' },
    { key: 'outdoorRh', label: 'Outdoor humidity', type: 'number', default: 40, min: 5, max: 100, step: 5, unit: '%' },
    { key: 'indoor', label: 'Indoor temperature', type: 'number', default: 24, min: 16, max: 30, step: 0.5, unit: '°C' },
    { key: 'indoorRh', label: 'Indoor humidity', type: 'number', default: 50, min: 30, max: 70, step: 5, unit: '%' },
    { key: 'altitude', label: 'Altitude', type: 'number', default: 0, min: 0, max: 5000, step: 50, unit: 'm' },
    { key: 'safety', label: 'Safety margin', type: 'number', default: 10, min: 0, max: 50, step: 5, unit: '%' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.outdoor <= o.indoor) throw new ToolError('The outdoor temperature should be above the indoor temperature for a cooling load.');
    const exposure = EXPOSURE[o.exposure] ?? (EXPOSURE.normal as (typeof EXPOSURE)[string]);
    const activity = ACTIVITY[o.activity] ?? (ACTIVITY.office as (typeof ACTIVITY)[string]);
    const p = pressureAtAltitude(o.altitude);
    const envelope = o.area * exposure.wm2;
    const peopleS = o.people * activity.sensible;
    const peopleL = o.people * activity.latent;
    const lights = o.area * o.lighting;
    const airMass = ((o.people * o.freshAir) / 1000) * 1.2 * (p / 101325);
    const wOut = humidityRatioFromRh(o.outdoor, o.outdoorRh, p);
    const wIn = humidityRatioFromRh(o.indoor, o.indoorRh, p);
    const ventS = airMass * (1006 + 1860 * wOut) * (o.outdoor - o.indoor);
    const ventL = airMass * 2501e3 * (wOut - wIn);
    const sensible = envelope + peopleS + lights + o.equipment + ventS;
    const latent = Math.max(0, peopleL + ventL);
    const total = (sensible + latent) * (1 + o.safety / 100);
    const tons = total / TR;
    const size = AC_SIZES.find((candidate) => candidate >= tons * 0.98);
    const roomSensible = (sensible - ventS) * (1 + o.safety / 100);
    const supply = roomSensible / (1.21 * 11); // l/s with air supplied 11 K below the room
    const fields: Field[] = [
      heading('Heat gains'),
      { label: 'Walls, roof and glass', value: `${num(envelope, 0)} W`, mono: true },
      { label: 'People', value: `${num(peopleS, 0)} W sensible + ${num(peopleL, 0)} W latent`, mono: true },
      { label: 'Lighting and equipment', value: `${num(lights + o.equipment, 0)} W`, mono: true },
      { label: 'Outdoor air', value: `${num(ventS, 0)} W sensible + ${num(ventL, 0)} W latent`, mono: true },
      heading('Cooling load'),
      { label: 'Sensible / latent', value: `${num(sensible, 0)} W / ${num(latent, 0)} W (sensible heat ratio ${num(sensible / (sensible + latent), 2)})`, mono: true },
      { label: 'Total with margin', value: `${num(total / 1000, 2)} kW = ${num(total / 0.29307, 0)} BTU/h = ${num(tons, 2)} TR`, mono: true, tone: 'ok' },
      { label: 'Air conditioner', value: size ? `${size} TR (${num(size * 12000, 0)} BTU/h)` : `${Math.ceil(tons / 20)} units or a central plant`, mono: true, tone: 'ok' },
      { label: 'Load density', value: `${num(total / o.area, 0)} W/m², ${num(o.area / tons, 1)} m² (${num((o.area * 10.7639) / tons, 0)} ft²) per TR`, mono: true },
      { label: 'Supply air', value: `${num(supply, 0)} l/s = ${num(supply * 3.6, 0)} m³/h = ${num(supply * 2.11888, 0)} CFM`, mono: true },
    ];
    return { fields, info: `${ESTIMATE} The wall, roof and glass allowance is a rule of thumb; a room-by-room calculation (CLTD or heat-balance method) replaces it for design.` };
  },
});
