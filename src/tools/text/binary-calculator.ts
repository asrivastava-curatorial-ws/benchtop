import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field, type Values } from '../types';
import { group, parseInBase } from './base-converter';

const UNARY = new Set(['not']);

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'a', label: 'A', type: 'text', default: '1011', mono: true, wide: true },
    {
      key: 'op',
      label: 'Operation',
      type: 'select',
      choices: [
        { value: 'add', label: 'A + B' },
        { value: 'sub', label: 'A − B' },
        { value: 'mul', label: 'A × B' },
        { value: 'div', label: 'A ÷ B (integer)' },
        { value: 'mod', label: 'A mod B' },
        { value: 'and', label: 'A AND B' },
        { value: 'or', label: 'A OR B' },
        { value: 'xor', label: 'A XOR B' },
        { value: 'not', label: 'NOT A' },
        { value: 'shl', label: 'A << B' },
        { value: 'shr', label: 'A >> B' },
      ],
      default: 'add',
    },
    { key: 'b', label: 'B', type: 'text', default: '110', mono: true, wide: true, showIf: (v: Values) => !UNARY.has(String(v.op)) },
    {
      key: 'base',
      label: 'Inputs are',
      type: 'select',
      choices: [
        { value: '2', label: 'Binary' },
        { value: '10', label: 'Decimal' },
        { value: '16', label: 'Hexadecimal' },
        { value: '8', label: 'Octal' },
      ],
      default: '2',
    },
    {
      key: 'width',
      label: 'Word size',
      type: 'select',
      choices: [
        { value: '8', label: '8-bit' },
        { value: '16', label: '16-bit' },
        { value: '32', label: '32-bit' },
        { value: '64', label: '64-bit' },
      ],
      default: '8',
      help: "Used for NOT and for showing negative results in two's complement.",
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const base = Number(o.base);
    const a = parseInBase(o.a, base);
    const b = UNARY.has(o.op) ? 0n : parseInBase(o.b, base);
    const width = BigInt(o.width);
    const mask = (1n << width) - 1n;
    if ((o.op === 'shl' || o.op === 'shr') && (b < 0n || b > 4096n)) throw new ToolError('The shift amount must be between 0 and 4096.');
    if ((o.op === 'div' || o.op === 'mod') && b === 0n) throw new ToolError('Division by zero.');
    let result: bigint;
    switch (o.op) {
      case 'sub':
        result = a - b;
        break;
      case 'mul':
        result = a * b;
        break;
      case 'div':
        result = a / b;
        break;
      case 'mod':
        result = a % b;
        break;
      case 'and':
        result = a & b;
        break;
      case 'or':
        result = a | b;
        break;
      case 'xor':
        result = a ^ b;
        break;
      case 'not':
        result = ~a & mask;
        break;
      case 'shl':
        result = a << b;
        break;
      case 'shr':
        result = a >> b;
        break;
      default:
        result = a + b;
    }
    const fields: Field[] = [
      { label: 'Binary', value: group(result.toString(2), 4), mono: true },
      { label: 'Decimal', value: result.toString(10), mono: true },
      { label: 'Hexadecimal', value: group(result.toString(16).toUpperCase(), 4), mono: true },
      { label: 'Octal', value: result.toString(8), mono: true },
    ];
    const min = -(1n << (width - 1n));
    if (result < 0n && result >= min) {
      fields.push({
        label: `Two's complement (${o.width}-bit)`,
        value: group((result & mask).toString(2).padStart(Number(width), '0'), 4),
        mono: true,
      });
    }
    const overflow = result > mask || result < min;
    return {
      fields,
      warnings: overflow ? [`The result does not fit in ${o.width} bits; it is shown with full precision.`] : undefined,
    };
  },
});
