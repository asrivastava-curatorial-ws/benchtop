import { trimNumber } from '../../lib/color';
import { bucketFor, convertLength, guessScale, heightClass, metrics, SCREENS, type Screen, UNIT_NAMES, widthClass } from '../../lib/screens';
import { defineTextTool, type Field } from '../types';

const n = (value: number, digits = 1) => trimNumber(value, digits);

function table(): string {
  const rows = SCREENS.map((s) => {
    const m = metrics(s.width, s.height, s.diagonal, s.scale);
    const unit = UNIT_NAMES[s.platform];
    return [
      s.label,
      `${s.width} × ${s.height}`,
      `${trimNumber(s.scale, 3)}×`,
      `${Math.round(m.layoutWidth)} × ${Math.round(m.layoutHeight)} ${unit}`,
      String(Math.round(m.ppi)),
      `${s.diagonal}″`,
      s.platform === 'android' || s.platform === 'ios' ? widthClass(m.layoutWidth) : '',
    ];
  });
  const head = ['Screen (portrait)', 'Pixels', 'Scale', 'Layout size', 'ppi', 'Size', 'Width class'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] as string).length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === 0 || i === 3 || i === 6 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number)))
      .join('  ')
      .trimEnd();
  return [line(head), line(widths.map((w) => '─'.repeat(w))), ...rows.map(line)].join('\n');
}

export default defineTextTool({
  input: false,
  output: { label: 'Common screens' },
  runOnEmpty: true,
  options: [
    {
      key: 'screen',
      label: 'Screen',
      type: 'select',
      choices: [...SCREENS.map((s) => ({ value: s.id, label: s.label })), { value: 'custom', label: 'Other: enter its size' }],
      default: 'pixel-8',
    },
    { key: 'width', label: 'Width', type: 'number', default: 1080, min: 1, max: 20000, step: 1, unit: 'px', showIf: (v) => v.screen === 'custom' },
    { key: 'height', label: 'Height', type: 'number', default: 2400, min: 1, max: 20000, step: 1, unit: 'px', showIf: (v) => v.screen === 'custom' },
    { key: 'diagonal', label: 'Diagonal', type: 'number', default: 6.5, min: 0.5, max: 400, step: 0.1, unit: 'in', showIf: (v) => v.screen === 'custom' },
    {
      key: 'scale',
      label: 'Scale (px per dp, pt or CSS px)',
      type: 'select',
      choices: [
        { value: 'auto', label: 'Guess from pixel density' },
        { value: '1', label: '1× (mdpi, KaiOS, standard monitors)' },
        { value: '1.25', label: '1.25× (Windows 125%)' },
        { value: '1.5', label: '1.5× (hdpi, Windows 150%)' },
        { value: '2', label: '2× (xhdpi, Retina)' },
        { value: '2.625', label: '2.625× (420 dpi, Pixel)' },
        { value: '2.75', label: '2.75× (440 dpi)' },
        { value: '3', label: '3× (xxhdpi, Super Retina)' },
        { value: '3.5', label: '3.5× (560 dpi)' },
        { value: '4', label: '4× (xxxhdpi)' },
      ],
      default: 'auto',
      showIf: (v) => v.screen === 'custom',
    },
    {
      key: 'orientation',
      label: 'Orientation',
      type: 'segmented',
      choices: [
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
      default: 'portrait',
    },
    { key: 'length', label: 'Convert a length', type: 'number', default: 48, min: 0, max: 100000, step: 1 },
    {
      key: 'lengthUnit',
      label: 'Unit',
      type: 'select',
      choices: [
        { value: 'unit', label: 'dp, pt or CSS px' },
        { value: 'px', label: 'device pixels' },
        { value: 'mm', label: 'millimetres' },
        { value: 'in', label: 'inches' },
        { value: 'pt', label: 'print points (1/72 in)' },
      ],
      default: 'unit',
    },
  ],
  run(_input, o) {
    const preset = SCREENS.find((s) => s.id === o.screen);
    const custom: Screen | null = preset ? null : { id: 'custom', label: 'Your screen', platform: 'android', width: o.width, height: o.height, diagonal: o.diagonal, scale: 1 };
    const base = preset ?? (custom as Screen);
    const ppiGuess = Math.hypot(base.width, base.height) / base.diagonal;
    const scale = preset ? preset.scale : o.scale === 'auto' ? guessScale(ppiGuess) : Number(o.scale);
    const [w, h] = o.orientation === 'landscape' ? [Math.max(base.width, base.height), Math.min(base.width, base.height)] : [Math.min(base.width, base.height), Math.max(base.width, base.height)];
    const m = metrics(w, h, base.diagonal, scale);
    const unit = preset ? UNIT_NAMES[preset.platform] : 'dp / pt / CSS px';
    const bucket = bucketFor(m.dpi);
    const len = convertLength(o.length, o.lengthUnit as 'unit' | 'px' | 'mm' | 'in' | 'pt', m);
    const target = convertLength(48, 'unit', m);

    const fields: Field[] = [
      { label: 'Pixels', value: `${w} × ${h} px`, mono: true },
      { label: 'Aspect ratio', value: m.aspect, mono: true },
      { label: 'Pixel density', value: `${Math.round(m.ppi)} ppi (${n(m.ppi / 25.4)} px per mm)`, mono: true },
      { label: 'Physical size', value: `${n(m.widthMm)} × ${n(m.heightMm)} mm, ${base.diagonal} in diagonal`, mono: true },
      {
        label: 'Scale',
        value: `${trimNumber(scale, 3)}× · ${Math.round(m.dpi)} dpi on Android, ${bucket.name} bitmaps${!preset && o.scale === 'auto' ? ' (guessed)' : ''}`,
        mono: true,
      },
      { label: 'Layout size', value: `${n(m.layoutWidth)} × ${n(m.layoutHeight)} ${unit}`, mono: true },
      { label: 'Smallest width', value: `sw${Math.floor(m.smallestWidth)}dp`, mono: true },
      { label: 'Material window class', value: `${widthClass(m.layoutWidth)} width, ${heightClass(m.layoutHeight)} height`, mono: false },
      { label: `${n(o.length, 3)} ${o.lengthUnit === 'unit' ? 'dp / pt' : o.lengthUnit}`, value: `${n(len.unit, 2)} dp/pt = ${n(len.px, 1)} px = ${n(len.mm, 2)} mm = ${n(len.in, 3)} in`, mono: true },
      {
        label: '48 dp touch target',
        value: `${n(target.mm, 1)} mm across`,
        tone: target.mm >= 7 ? 'ok' : 'warn',
        mono: true,
      },
    ];
    const warnings: string[] = [];
    if (preset?.platform === 'web') warnings.push('On desktops the scale is the operating system’s display scaling; browser zoom multiplies it.');
    if (preset?.platform === 'kaios') warnings.push('KaiOS apps lay out in CSS pixels at 1×; leave room for the soft-key bar (30 px) and the status bar (26 px).');
    return {
      output: table(),
      fields,
      info: `1 ${preset ? UNIT_NAMES[preset.platform] : 'layout unit'} = ${trimNumber(scale, 3)} px = ${n(m.unitMm, 3)} mm on this screen`,
      warnings,
    };
  },
});
