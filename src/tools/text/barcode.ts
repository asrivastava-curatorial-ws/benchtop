import { hexOf, isColor } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field, type Values } from '../types';

const LINEAR = new Set(['code128', 'ean13', 'ean8', 'upca', 'code39', 'itf14']);
const isLinear = (v: Values): boolean => LINEAR.has(String(v.type));

/** GS1 modulo-10 check digit for EAN/UPC/ITF data (without the check digit). */
export function gs1CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const weight = (digits.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

const GS1_LENGTHS: Record<string, number> = { ean13: 13, ean8: 8, upca: 12, itf14: 14 };

export default defineTextTool({
  input: false,
  output: { label: 'SVG', language: 'xml' },
  options: [
    {
      key: 'type',
      label: 'Symbology',
      type: 'select',
      choices: [
        { value: 'code128', label: 'Code 128' },
        { value: 'ean13', label: 'EAN-13' },
        { value: 'ean8', label: 'EAN-8' },
        { value: 'upca', label: 'UPC-A' },
        { value: 'code39', label: 'Code 39' },
        { value: 'itf14', label: 'ITF-14' },
        { value: 'qrcode', label: 'QR Code' },
        { value: 'datamatrix', label: 'Data Matrix' },
      ],
      default: 'code128',
    },
    { key: 'value', label: 'Data', type: 'text', default: 'BENCHTOP-2026', mono: true, wide: true },
    { key: 'scale', label: 'Module size', type: 'range', default: 3, min: 1, max: 10, step: 1, unit: 'px' },
    { key: 'height', label: 'Bar height', type: 'range', default: 15, min: 5, max: 50, step: 1, unit: 'mm', showIf: isLinear },
    { key: 'text', label: 'Show text', type: 'toggle', default: true, showIf: isLinear },
    { key: 'foreground', label: 'Bars', type: 'color', default: '#000000' },
    { key: 'background', label: 'Background', type: 'color', default: '#ffffff' },
    { key: 'transparent', label: 'Transparent background', type: 'toggle', default: false },
  ],
  presets: [
    { name: 'EAN-13', values: { type: 'ean13', value: '590123412345' } },
    { name: 'UPC-A', values: { type: 'upca', value: '03600029145' } },
    { name: 'Code 39', values: { type: 'code39', value: 'CODE-39 OK' } },
    { name: 'Code 128', values: { type: 'code128', value: 'BENCHTOP-2026' } },
    { name: 'QR Code', values: { type: 'qrcode', value: 'https://example.org/offline' } },
  ],
  runOnEmpty: true,
  async run(_input, o) {
    const value = o.value;
    if (value === '') throw new ToolError('Enter the data to encode.');
    if (!isColor(o.foreground) || !isColor(o.background)) throw new ToolError('The colours must be valid CSS colours.');
    const fields: Field[] = [];
    const gs1 = GS1_LENGTHS[o.type];
    if (gs1 !== undefined && /^\d+$/.test(value)) {
      if (value.length === gs1 - 1) {
        const check = gs1CheckDigit(value);
        fields.push({ label: 'Check digit', value: `${check}  → full number ${value}${check}`, mono: true });
      } else if (value.length === gs1) {
        const expected = gs1CheckDigit(value.slice(0, -1));
        const actual = Number(value[value.length - 1]);
        fields.push(
          expected === actual ? { label: 'Check digit', value: `${actual} is correct`, tone: 'ok' } : { label: 'Check digit', value: `${actual} is wrong — it should be ${expected}`, tone: 'bad' },
        );
        if (expected !== actual) throw new ToolError(`Wrong check digit: the last digit should be ${expected}, not ${actual}.`);
      }
    }
    const { toSVG } = await import('bwip-js/generic');
    let svg: string;
    try {
      svg = toSVG({
        bcid: o.type,
        text: value,
        scale: o.scale,
        ...(LINEAR.has(o.type) ? { height: o.height, includetext: o.text, textxalign: 'center' as const } : {}),
        barcolor: hexOf(o.foreground).slice(1),
        textcolor: hexOf(o.foreground).slice(1),
        ...(o.transparent ? {} : { backgroundcolor: hexOf(o.background).slice(1) }),
        paddingwidth: 4,
        paddingheight: 4,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolError(message.replace(/^(?:bwipp|bwip-js)\.[\w-]+(?:#\d+)?:\s*/, ''));
    }
    const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    // Give the image explicit dimensions so it has a predictable size wherever it is placed.
    const sized = size ? svg.replace('<svg ', `<svg width="${size[1]}" height="${size[2]}" `) : svg;
    if (size) fields.push({ label: 'Size', value: `${size[1]} × ${size[2]} px` });
    return { output: sized, preview: { kind: 'svg', svg: sized, checker: o.transparent }, fields, filename: `${o.type}.svg` };
  },
});
