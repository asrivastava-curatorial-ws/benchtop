import { defineTextTool } from '../types';

/** Keeps the first and last characters and masks the rest, as for sharing a secret's shape. */
export function obfuscate(text: string, keepStart: number, keepEnd: number, mask: string, keepSpaces: boolean): string {
  const chars = [...text];
  return chars
    .map((char, index) => {
      if (index < keepStart || index >= chars.length - keepEnd) return char;
      if (keepSpaces && /\s/.test(char)) return char;
      return mask;
    })
    .join('');
}

export default defineTextTool({
  input: { label: 'Text', sample: 'token-EXAMPLE-not-a-real-key-1234' },
  output: { label: 'Obfuscated' },
  options: [
    { key: 'start', label: 'Keep first', type: 'number', default: 4, min: 0, max: 100, step: 1, unit: 'chars' },
    { key: 'end', label: 'Keep last', type: 'number', default: 4, min: 0, max: 100, step: 1, unit: 'chars' },
    { key: 'mask', label: 'Mask character', type: 'text', default: '*' },
    { key: 'spaces', label: 'Keep spaces', type: 'toggle', default: true },
    { key: 'perLine', label: 'Each line separately', type: 'toggle', default: true },
  ],
  run(input, o) {
    const mask = [...o.mask][0] ?? '*';
    const apply = (text: string) => obfuscate(text, o.start, o.end, mask, o.spaces);
    return o.perLine ? input.split('\n').map(apply).join('\n') : apply(input);
  },
});
