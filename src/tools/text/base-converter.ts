import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function parseInBase(text: string, base: number): bigint {
  let source = text
    .trim()
    .toLowerCase()
    .replace(/[\s_,]/g, '');
  let negative = false;
  if (source.startsWith('-')) {
    negative = true;
    source = source.slice(1);
  } else if (source.startsWith('+')) {
    source = source.slice(1);
  }
  const prefix = { 16: '0x', 2: '0b', 8: '0o' }[base];
  if (prefix && source.startsWith(prefix)) source = source.slice(2);
  if (source === '') throw new ToolError('Enter a number to convert.');
  let value = 0n;
  const big = BigInt(base);
  for (const ch of source) {
    const digit = DIGITS.indexOf(ch);
    if (digit < 0 || digit >= base) {
      throw new ToolError(`"${ch}" is not a digit in base ${base}${base <= 10 ? ` (digits 0-${base - 1})` : ` (digits 0-9 and a-${DIGITS[base - 1]})`}.`);
    }
    value = value * big + BigInt(digit);
  }
  return negative ? -value : value;
}

export function group(text: string, size: number, separator = ' '): string {
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= size) parts.unshift(digits.slice(Math.max(0, end - size), end));
  return (negative ? '-' : '') + parts.join(separator);
}

const BASES = Array.from({ length: 35 }, (_, index) => String(index + 2));

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'value', label: 'Number', type: 'text', default: '255', mono: true, wide: true, placeholder: '255, ff, 0b1010, -42' },
    { key: 'from', label: 'From base', type: 'select', choices: BASES, default: '10' },
    { key: 'to', label: 'Custom target base', type: 'select', choices: BASES, default: '36' },
    { key: 'grouped', label: 'Group digits', type: 'toggle', default: true },
    { key: 'upper', label: 'Uppercase letters', type: 'toggle', default: false },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const value = parseInBase(o.value, Number(o.from));
    const show = (base: number, size: number): string => {
      const text = value.toString(base);
      const cased = o.upper ? text.toUpperCase() : text;
      return o.grouped ? group(cased, size) : cased;
    };
    const fields: Field[] = [
      { label: 'Binary (2)', value: show(2, 4), mono: true },
      { label: 'Octal (8)', value: show(8, 3), mono: true },
      { label: 'Decimal (10)', value: o.grouped ? group(value.toString(10), 3, ',') : value.toString(10), mono: true },
      { label: 'Hexadecimal (16)', value: show(16, 4), mono: true },
      { label: `Base ${o.to}`, value: show(Number(o.to), 4), mono: true },
    ];
    const magnitude = value < 0n ? -value : value;
    const bits = magnitude === 0n ? 1 : magnitude.toString(2).length;
    return { fields, info: `${bits} bit${bits === 1 ? '' : 's'}${value < 0n ? ' plus sign' : ''} · arbitrary precision` };
  },
});
