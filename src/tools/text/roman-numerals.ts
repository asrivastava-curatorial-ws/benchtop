import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

const NUMERALS: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) throw new ToolError('Roman numerals cover whole numbers from 1 to 3999.');
  let rest = value;
  let out = '';
  for (const [size, symbol] of NUMERALS) {
    while (rest >= size) {
      out += symbol;
      rest -= size;
    }
  }
  return out;
}

export function fromRoman(text: string): number {
  const roman = text.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(roman)) throw new ToolError(`"${text.trim()}" contains characters that are not Roman numerals.`);
  const values: Record<string, number> = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const current = values[roman[i] as string] as number;
    const next = values[roman[i + 1] as string] ?? 0;
    total += current < next ? -current : current;
  }
  // Only the canonical spelling is valid: IIII, VX and IL are not.
  if (total < 1 || total > 3999 || toRoman(total) !== roman)
    throw new ToolError(`"${roman}" is not a valid Roman numeral${total >= 1 && total <= 3999 ? `; ${total} is written ${toRoman(total)}` : ''}.`);
  return total;
}

export default defineTextTool({
  input: { label: 'Numbers or numerals', placeholder: 'One per line: 2026 or MMXXVI', sample: '2026\nMCMLXXXIV\n49' },
  output: { label: 'Converted' },
  options: [],
  run(input) {
    const lines = input.split(/\r?\n/).filter((line) => line.trim() !== '');
    const out = lines.map((line) => {
      const value = line.trim();
      return /^\d+$/.test(value) ? toRoman(Number(value)) : String(fromRoman(value));
    });
    return { output: out.join('\n'), info: 'Numbers become numerals and numerals become numbers, line by line.' };
  },
});
