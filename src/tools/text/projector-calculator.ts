import { ToolError } from '../../lib/errors';
import {
  brightnessAdvice,
  distanceForAngle,
  feetInches,
  footLamberts,
  formatLength,
  fromMetres,
  imageWidthAt,
  type LengthUnit,
  lensHeightRange,
  NITS_PER_FL,
  nativeImageFor,
  parseAspect,
  pixelAcuityDistance,
  RESOLUTIONS,
  round,
  sizeFrom,
  throwDistance,
  toMetres,
} from '../../lib/projection';
import { defineTextTool, type Field, type Values } from '../types';

export const ASPECTS = [
  { value: '16:9', label: '16:9 (HDTV, most projectors)' },
  { value: '16:10', label: '16:10 (WUXGA)' },
  { value: '4:3', label: '4:3' },
  { value: '17:9', label: '17:9 (DCI 4K)' },
  { value: '1.85:1', label: '1.85:1 (flat cinema)' },
  { value: '2.35:1', label: '2.35:1 (cinemascope)' },
  { value: '2.39:1', label: '2.39:1 (scope)' },
  { value: '21:9', label: '21:9' },
  { value: '1:1', label: '1:1' },
  { value: 'custom', label: 'Other…' },
] as const;

export const UNITS = [
  { value: 'm', label: 'Metres' },
  { value: 'cm', label: 'Centimetres' },
  { value: 'ft', label: 'Feet' },
  { value: 'in', label: 'Inches' },
] as const;

const aspectOf = (choice: string, custom: string, what: string): number => {
  const value = parseAspect(choice === 'custom' ? custom : choice);
  if (!Number.isFinite(value) || value <= 0.2 || value > 10) throw new ToolError(`Enter the ${what} aspect ratio as width:height, for example 2.4:1.`);
  return value;
};

/** Side view: screen on the left, projector at `distance`, beam to the native image, seating band on the floor. */
function sideView(options: {
  imageBottom: number;
  imageHeight: number;
  screenTop: number;
  screenBottom: number;
  distance: number;
  lens: number;
  lensRange: [number, number];
  throwRange: [number, number];
  seats: [number, number];
  unit: LengthUnit;
}): string {
  const { imageBottom, imageHeight, screenTop, screenBottom, distance, lens, lensRange, throwRange, seats, unit } = options;
  const roomLength = Math.max(throwRange[1], distance, seats[1]) * 1.12 + 0.3;
  const roomHeight = Math.max(screenTop, lensRange[1], lens, imageBottom + imageHeight) * 1.15 + 0.2;
  const width = 760;
  const height = 300;
  const pad = 46;
  const scale = Math.min((width - pad * 2) / roomLength, (height - pad * 2) / roomHeight);
  const x = (metres: number) => pad + metres * scale;
  const y = (metres: number) => height - pad - metres * scale;
  const label = (value: number) => (unit === 'ft' || unit === 'in' ? feetInches(value) : `${round(fromMetres(value, unit), unit === 'cm' ? 0 : 2)} ${unit}`);
  const text = (tx: number, ty: number, content: string, anchor = 'middle', fill = '#8b949e') =>
    `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" fill="${fill}" font-size="12" font-family="JetBrains Mono, monospace">${content}</text>`;
  const lensX = x(distance);
  const lensY = y(lens);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect width="${width}" height="${height}" rx="8" fill="#0d1117" stroke="#30363d"/>
<line x1="${pad - 10}" y1="${y(0)}" x2="${width - pad + 10}" y2="${y(0)}" stroke="#484f58" stroke-width="1.5"/>
<rect x="${x(seats[0]).toFixed(1)}" y="${(y(0) - 6).toFixed(1)}" width="${(x(seats[1]) - x(seats[0])).toFixed(1)}" height="6" fill="#3fb950" fill-opacity="0.45"/>
${text((x(seats[0]) + x(seats[1])) / 2, y(0) + 30, `seats ${label(seats[0])}–${label(seats[1])}`, 'middle', '#3fb950')}
<rect x="${x(throwRange[0]).toFixed(1)}" y="${(y(0) + 4).toFixed(1)}" width="${Math.max(2, x(throwRange[1]) - x(throwRange[0])).toFixed(1)}" height="5" fill="#2f81f7" fill-opacity="0.8"/>
${text((x(throwRange[0]) + x(throwRange[1])) / 2, y(0) + 17, `throw ${label(throwRange[0])}–${label(throwRange[1])}`, 'middle', '#58a6ff')}
<line x1="${x(0)}" y1="${y(screenBottom)}" x2="${x(0)}" y2="${y(screenTop)}" stroke="#c9d1d9" stroke-width="5" stroke-linecap="round"/>
<polygon points="${lensX.toFixed(1)},${lensY.toFixed(1)} ${x(0)},${y(imageBottom + imageHeight).toFixed(1)} ${x(0)},${y(imageBottom).toFixed(1)}" fill="#2f81f7" fill-opacity="0.16" stroke="#2f81f7" stroke-opacity="0.7"/>
<line x1="${(lensX - 12).toFixed(1)}" y1="${y(lensRange[0]).toFixed(1)}" x2="${(lensX - 12).toFixed(1)}" y2="${y(lensRange[1]).toFixed(1)}" stroke="#d29922" stroke-width="3" stroke-linecap="round"/>
<rect x="${(lensX - 4).toFixed(1)}" y="${(lensY - 12).toFixed(1)}" width="44" height="24" rx="4" fill="#21262d" stroke="#8b949e"/>
<circle cx="${lensX.toFixed(1)}" cy="${lensY.toFixed(1)}" r="5" fill="#58a6ff"/>
${text(lensX + 18, lensY - 18, `lens ${label(lens)}`, 'middle', '#c9d1d9')}
${text(lensX - 18, y(lensRange[1]) - 6, 'lens range', 'end', '#d29922')}
${text(x(0) + 8, y(screenTop) - 8, `screen top ${label(screenTop)}`, 'start', '#c9d1d9')}
${text(x(0) + 8, y(screenBottom) + 16, `bottom ${label(screenBottom)}`, 'start', '#8b949e')}
</svg>`;
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'unit', label: 'Units', type: 'select', choices: UNITS, default: 'm' },
    { key: 'screenHeading', label: 'Screen', type: 'heading' },
    { key: 'aspect', label: 'Screen aspect ratio', type: 'select', choices: ASPECTS, default: '16:9' },
    { key: 'customAspect', label: 'Aspect ratio', type: 'text', default: '2.4:1', showIf: (v: Values) => v.aspect === 'custom' },
    {
      key: 'sizeBy',
      label: 'Size given as',
      type: 'segmented',
      choices: [
        { value: 'diagonal', label: 'Diagonal' },
        { value: 'width', label: 'Width' },
        { value: 'height', label: 'Height' },
      ],
      default: 'diagonal',
    },
    { key: 'size', label: 'Size', type: 'number', default: 2.54, min: 0.01, max: 100000, step: 0.01, help: '100 inches is 2.54 m.' },
    { key: 'bottom', label: 'Screen bottom above the floor', type: 'number', default: 0.6, min: 0, max: 100000, step: 0.05 },
    { key: 'gain', label: 'Screen gain', type: 'number', default: 1, min: 0.3, max: 3, step: 0.1 },
    { key: 'projectorHeading', label: 'Projector', type: 'heading' },
    { key: 'native', label: 'Native aspect ratio', type: 'select', choices: ASPECTS.filter((choice) => choice.value !== '2.39:1' && choice.value !== '1.85:1'), default: '16:9' },
    { key: 'customNative', label: 'Native aspect', type: 'text', default: '16:9', showIf: (v: Values) => v.native === 'custom' },
    { key: 'throwMin', label: 'Throw ratio, wide end', type: 'number', default: 1.36, min: 0.1, max: 20, step: 0.01, help: 'From the projector’s spec sheet: distance ÷ image width.' },
    { key: 'throwMax', label: 'Throw ratio, telephoto end', type: 'number', default: 2.18, min: 0.1, max: 20, step: 0.01, help: 'The same as the wide end for a fixed lens.' },
    { key: 'shiftUp', label: 'Vertical lens shift up', type: 'number', default: 0, min: 0, max: 200, step: 1, unit: '%' },
    { key: 'shiftDown', label: 'Vertical lens shift down', type: 'number', default: 0, min: 0, max: 200, step: 1, unit: '%' },
    { key: 'shiftSide', label: 'Horizontal lens shift', type: 'number', default: 0, min: 0, max: 100, step: 1, unit: '±%' },
    {
      key: 'offset',
      label: 'Fixed offset',
      type: 'number',
      default: 0,
      min: -200,
      max: 200,
      step: 1,
      unit: '%',
      help: 'For lenses without shift: how far the image centre sits above the lens, in % of image height. 50% puts the lens level with the image bottom.',
    },
    { key: 'distance', label: 'Your throw distance', type: 'number', default: 0, min: 0, max: 100000, step: 0.05, help: 'Optional: lens to screen. 0 means use the middle of the range.' },
    { key: 'lightHeading', label: 'Brightness', type: 'heading' },
    { key: 'lumens', label: 'Rated brightness', type: 'number', default: 2000, min: 10, max: 100000, step: 50, unit: 'lm' },
    {
      key: 'mode',
      label: 'Lamp mode',
      type: 'select',
      choices: [
        { value: '1', label: 'Full power' },
        { value: '0.75', label: 'Eco (about 75%)' },
        { value: '0.6', label: 'Low (about 60%)' },
      ],
      default: '1',
    },
    {
      key: 'teleLoss',
      label: 'Light lost at full telephoto',
      type: 'number',
      default: 15,
      min: 0,
      max: 60,
      step: 1,
      unit: '%',
      help: 'Zoom lenses pass less light at the long end; 10–25% is typical.',
    },
    {
      key: 'room',
      label: 'Room',
      type: 'select',
      choices: [
        { value: 'dark', label: 'Dark (home cinema)' },
        { value: 'dim', label: 'Dim (lights low)' },
        { value: 'lit', label: 'Lit (meeting room, gallery)' },
        { value: 'bright', label: 'Bright (daylight)' },
      ],
      default: 'dark',
    },
    { key: 'threeD', label: 'Viewed through 3D glasses', type: 'toggle', default: false },
    { key: 'resolution', label: 'Resolution', type: 'select', choices: Object.keys(RESOLUTIONS), default: '1920x1080' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const unit = o.unit as LengthUnit;
    const screenAspect = aspectOf(o.aspect, o.customAspect, 'screen');
    const nativeAspect = aspectOf(o.native, o.customNative, 'projector');
    if (o.throwMax < o.throwMin) throw new ToolError('The telephoto throw ratio must be at least the wide one.');
    const screen = sizeFrom(o.sizeBy as 'diagonal' | 'width' | 'height', toMetres(o.size, unit), screenAspect);
    const native = nativeImageFor(screen, screenAspect, nativeAspect);
    const ratio = { min: o.throwMin, max: o.throwMax };
    const range = throwDistance(native.width, ratio);
    const distance = o.distance > 0 ? toMetres(o.distance, unit) : (range.min + range.max) / 2;
    const fmt = (metres: number) => formatLength(metres, unit);
    const fields: Field[] = [];

    fields.push({ label: 'Screen image', value: '' });
    fields.push({ label: 'Width × height', value: `${fmt(screen.width)} × ${fmt(screen.height)}`, mono: true });
    fields.push({ label: 'Diagonal', value: `${fmt(screen.diagonal)}, ${round(screen.diagonal / 0.0254, 1)}″`, mono: true });
    fields.push({ label: 'Area', value: `${round(screen.width * screen.height, 2)} m² (${round(screen.width * screen.height * 10.7639, 1)} ft²)`, mono: true });
    if (Math.abs(screenAspect - nativeAspect) > 0.01) {
      const used = (screen.width * screen.height) / (native.width * native.height);
      fields.push({
        label: 'Projector image',
        value: `${fmt(native.width)} × ${fmt(native.height)}; ${Math.round(used * 100)}% of the panel lands on the screen (${screenAspect > nativeAspect ? 'black bars above and below' : 'black bars at the sides'})`,
        tone: 'warn',
      });
    }

    fields.push({ label: 'Throw distance (lens to screen)', value: '' });
    fields.push({ label: o.throwMin === o.throwMax ? 'Distance' : 'Range', value: o.throwMin === o.throwMax ? fmt(range.min) : `${fmt(range.min)} to ${fmt(range.max)}`, mono: true, tone: 'ok' });
    if (o.distance > 0) {
      const inRange = distance >= range.min - 1e-9 && distance <= range.max + 1e-9;
      const widths = imageWidthAt(distance, ratio);
      fields.push({
        label: 'At your distance',
        value: inRange
          ? `Fits: zoom ${o.throwMax === o.throwMin ? 'fixed' : `${Math.round(((distance / native.width - o.throwMin) / (o.throwMax - o.throwMin)) * 100)}% toward telephoto`}`
          : `Does not fit: this lens makes an image ${fmt(widths.min)} to ${fmt(widths.max)} wide from there`,
        tone: inRange ? 'ok' : 'bad',
      });
    }

    const lens = lensHeightRange(native.height, o.shiftUp, o.shiftDown, o.offset);
    const nativeBottom = toMetres(o.bottom, unit) - (native.height - screen.height) / 2;
    const lensLow = nativeBottom + lens.min;
    const lensHigh = nativeBottom + lens.max;
    fields.push({ label: 'Lens position', value: '' });
    fields.push({
      label: lens.min === lens.max ? 'Lens height' : 'Lens height range',
      value: lens.min === lens.max ? `${fmt(lensLow)} above the floor` : `${fmt(lensLow)} to ${fmt(lensHigh)} above the floor`,
      mono: true,
    });
    fields.push({
      label: 'Mounting',
      value:
        lensHigh < toMetres(o.bottom, unit) + screen.height * 0.2
          ? 'Table or floor, below the image'
          : lensLow > toMetres(o.bottom, unit) + screen.height * 0.8
            ? 'Ceiling (inverted), above the image'
            : 'Table or ceiling, within the image height',
    });
    if (o.shiftSide > 0) fields.push({ label: 'Sideways', value: `Up to ${fmt((o.shiftSide / 100) * native.width)} either side of the screen centre`, mono: true });

    const throwFraction = o.throwMax === o.throwMin ? 0 : Math.min(1, Math.max(0, (distance / native.width - o.throwMin) / (o.throwMax - o.throwMin)));
    const lumensOnScreen = ((o.lumens * Number(o.mode) * (1 - (o.teleLoss / 100) * throwFraction) * (screen.width * screen.height)) / (native.width * native.height)) * (o.threeD ? 0.25 : 1);
    const fl = footLamberts(lumensOnScreen, screen.width * screen.height, o.gain);
    const advice = brightnessAdvice(fl, o.room as 'dark' | 'dim' | 'lit' | 'bright');
    fields.push({ label: 'Brightness on screen', value: '' });
    fields.push({ label: 'Luminance', value: `${round(fl, 1)} fL, ${Math.round(fl * NITS_PER_FL)} nits`, mono: true, tone: advice.tone });
    fields.push({ label: 'Verdict', value: advice.text, tone: advice.tone });
    fields.push({ label: 'Light on the screen', value: `${Math.round(lumensOnScreen)} lm${o.threeD ? ' after 3D glasses (about 25% passes)' : ''}`, mono: true });

    const [, rows] = RESOLUTIONS[o.resolution] ?? [1920, 1080];
    const smpte = distanceForAngle(screen.width, 30);
    const thx = distanceForAngle(screen.width, 36);
    const immersive = distanceForAngle(screen.width, 40);
    const acuity = pixelAcuityDistance(screen.height, rows * (screen.height / native.height));
    fields.push({ label: 'Seating distance (eyes to screen)', value: '' });
    fields.push({ label: 'SMPTE minimum (30° view)', value: fmt(smpte), mono: true });
    fields.push({ label: 'THX recommended (36°)', value: fmt(thx), mono: true });
    fields.push({ label: 'Immersive (40°)', value: fmt(immersive), mono: true });
    fields.push({ label: 'Pixels stop being visible beyond', value: fmt(acuity), mono: true, tone: 'muted' });

    const svg = sideView({
      imageBottom: nativeBottom,
      imageHeight: native.height,
      screenBottom: toMetres(o.bottom, unit),
      screenTop: toMetres(o.bottom, unit) + screen.height,
      distance,
      lens: (lensLow + lensHigh) / 2,
      lensRange: [lensLow, lensHigh],
      throwRange: [range.min, range.max],
      seats: [Math.min(immersive, smpte), Math.max(immersive, smpte)],
      unit,
    });
    return {
      fields,
      preview: { kind: 'svg', svg },
      info: 'Screening estimates from the spec-sheet ratios; check the manufacturer’s calculator before drilling holes.',
      filename: 'projector-side-view.svg',
    };
  },
});
