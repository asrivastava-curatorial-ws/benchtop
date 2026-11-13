import { defineTextTool } from '../types';
import { MODE, swapMode } from './_shared';

/** International Morse Code (ITU-R M.1677-1) plus the common unofficial symbols. */
const CODES: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  0: '-----',
  1: '.----',
  2: '..---',
  3: '...--',
  4: '....-',
  5: '.....',
  6: '-....',
  7: '--...',
  8: '---..',
  9: '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
};

const LETTERS = new Map(Object.entries(CODES).map(([letter, code]) => [code, letter]));

export default defineTextTool({
  input: { label: 'Input', sample: 'SOS — send help at 9:30!' },
  output: { label: 'Output' },
  options: [
    {
      ...MODE,
      choices: [
        { value: 'encode', label: 'Text → Morse' },
        { value: 'decode', label: 'Morse → Text' },
      ],
    },
  ],
  swap: swapMode,
  run(input, o) {
    const unknown = new Set<string>();
    if (o.mode === 'encode') {
      const output = input
        .split(/\r\n|\r|\n/)
        .map((line) =>
          line
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((word) =>
              Array.from(word.toUpperCase())
                .map((ch) => {
                  const code = CODES[ch];
                  if (code === undefined) unknown.add(ch);
                  return code ?? '?';
                })
                .join(' '),
            )
            .join(' / '),
        )
        .join('\n');
      return {
        output,
        warnings: unknown.size > 0 ? [`No Morse code exists for: ${[...unknown].join(' ')} (shown as ?).`] : undefined,
      };
    }
    const output = input
      .split(/\r\n|\r|\n/)
      .map((line) =>
        line
          .replace(/[·•∙*]/g, '.')
          .replace(/[–—−_]/g, '-')
          .trim()
          .split(/\s*[/|]\s*|\s{3,}/)
          .filter(Boolean)
          .map((word) =>
            word
              .split(/\s+/)
              .filter(Boolean)
              .map((code) => {
                const letter = LETTERS.get(code);
                if (letter === undefined) unknown.add(code);
                return letter ?? '\uFFFD';
              })
              .join(''),
          )
          .join(' '),
      )
      .join('\n');
    return {
      output,
      warnings: unknown.size > 0 ? [`Unrecognised Morse sequences: ${[...unknown].slice(0, 8).join('  ')}`] : undefined,
    };
  },
});
