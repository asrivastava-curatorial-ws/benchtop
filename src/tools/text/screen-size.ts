import { ToolError } from '../../lib/errors';
import { distanceForAngle, formatLength, type LengthUnit, parseAspect, round, sizeFrom, toMetres } from '../../lib/projection';
import { defineTextTool, type Field, type Values } from '../types';
import { ASPECTS, UNITS } from './projector-calculator';

const COMPARE = ['16:9', '16:10', '4:3', '1.85:1', '2.39:1', '21:9', '1:1'];

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'unit', label: 'Units', type: 'select', choices: UNITS, default: 'in' },
    { key: 'aspect', label: 'Aspect ratio', type: 'select', choices: ASPECTS, default: '16:9' },
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
    { key: 'size', label: 'Size', type: 'number', default: 100, min: 0.01, max: 100000, step: 1 },
    {
      key: 'keep',
      label: 'Compare other shapes with the same',
      type: 'segmented',
      choices: [
        { value: 'height', label: 'Height' },
        { value: 'width', label: 'Width' },
        { value: 'area', label: 'Area' },
      ],
      default: 'height',
      help: 'Constant height is how cinema scope screens are compared with 16:9 ones.',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const unit = o.unit as LengthUnit;
    const aspect = parseAspect(o.aspect === 'custom' ? o.customAspect : o.aspect);
    if (!Number.isFinite(aspect) || aspect <= 0) throw new ToolError('Enter the aspect ratio as width:height, for example 2.4:1.');
    const size = sizeFrom(o.sizeBy as 'diagonal' | 'width' | 'height', toMetres(o.size, unit), aspect);
    const fmt = (metres: number) => formatLength(metres, unit);
    const area = size.width * size.height;
    const fields: Field[] = [
      { label: 'Width', value: fmt(size.width), mono: true },
      { label: 'Height', value: fmt(size.height), mono: true },
      { label: 'Diagonal', value: `${fmt(size.diagonal)}, ${round(size.diagonal / 0.0254, 1)}″`, mono: true },
      { label: 'Area', value: `${round(area, 3)} m², ${round(area * 10.7639, 2)} ft²`, mono: true },
      { label: 'Aspect ratio', value: `${round(aspect, 3)}:1`, mono: true },
      { label: 'Viewing distance (THX 36° to SMPTE 30°)', value: `${fmt(distanceForAngle(size.width, 36))} to ${fmt(distanceForAngle(size.width, 30))}`, mono: true },
      { label: `Other shapes with the same ${o.keep}`, value: '' },
    ];
    for (const other of COMPARE) {
      const ratio = parseAspect(other);
      if (Math.abs(ratio - aspect) < 0.005) continue;
      const match = o.keep === 'height' ? sizeFrom('height', size.height, ratio) : o.keep === 'width' ? sizeFrom('width', size.width, ratio) : sizeFrom('height', Math.sqrt(area / ratio), ratio);
      fields.push({ label: other, value: `${round(match.diagonal / 0.0254, 1)}″ diagonal, ${fmt(match.width)} × ${fmt(match.height)}`, mono: true });
    }
    return { fields };
  },
});
