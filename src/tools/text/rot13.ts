import { defineTextTool, type Values } from '../types';

function rotate(text: string, letters: number, digits: number): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch.length === 1 && code >= 65 && code <= 90) out += String.fromCharCode(((code - 65 + letters + 26) % 26) + 65);
    else if (ch.length === 1 && code >= 97 && code <= 122) out += String.fromCharCode(((code - 97 + letters + 26) % 26) + 97);
    else if (ch.length === 1 && code >= 48 && code <= 57) out += String.fromCharCode(((code - 48 + digits + 10) % 10) + 48);
    else out += ch;
  }
  return out;
}

function rot47(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += ch.length === 1 && code >= 33 && code <= 126 ? String.fromCharCode(((code - 33 + 47) % 94) + 33) : ch;
  }
  return out;
}

export default defineTextTool({
  input: { label: 'Input', sample: 'Why did the chicken cross the road? Gb trg gb gur bgure fvqr!' },
  output: { label: 'Output' },
  options: [
    {
      key: 'variant',
      label: 'Cipher',
      type: 'select',
      choices: [
        { value: 'rot13', label: 'ROT13 (letters)' },
        { value: 'rot5', label: 'ROT5 (digits)' },
        { value: 'rot18', label: 'ROT18 (letters + digits)' },
        { value: 'rot47', label: 'ROT47 (printable ASCII)' },
        { value: 'caesar', label: 'Caesar (custom shift)' },
      ],
      default: 'rot13',
    },
    {
      key: 'shift',
      label: 'Shift',
      type: 'number',
      default: 3,
      min: -25,
      max: 25,
      step: 1,
      showIf: (v: Values) => v.variant === 'caesar',
      help: 'Use the negative shift to decode.',
    },
  ],
  run(input, o) {
    switch (o.variant) {
      case 'rot5':
        return rotate(input, 0, 5);
      case 'rot18':
        return rotate(input, 13, 5);
      case 'rot47':
        return rot47(input);
      case 'caesar':
        return rotate(input, Math.trunc(o.shift), 0);
      default:
        return rotate(input, 13, 0);
    }
  },
});
