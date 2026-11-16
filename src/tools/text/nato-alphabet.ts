import { defineTextTool } from '../types';

export const NATO: Record<string, string> = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
  '0': 'Zero',
  '1': 'One',
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  '-': 'Dash',
  '.': 'Stop',
  '@': 'At',
  '/': 'Slash',
  _: 'Underscore',
  '+': 'Plus',
  '#': 'Hash',
  '&': 'Ampersand',
  ',': 'Comma',
  ':': 'Colon',
};

const REVERSE = new Map(Object.entries(NATO).map(([char, word]) => [word.toLowerCase(), char]));
REVERSE.set('alpha', 'A');
REVERSE.set('juliet', 'J');
REVERSE.set('xray', 'X');
REVERSE.set('niner', '9');
REVERSE.set('space', ' ');

export default defineTextTool({
  input: { label: 'Text', sample: 'VITM-2026' },
  output: { label: 'Spelled out' },
  options: [
    {
      key: 'direction',
      label: 'Direction',
      type: 'segmented',
      choices: [
        { value: 'spell', label: 'Text to NATO' },
        { value: 'read', label: 'NATO to text' },
      ],
      default: 'spell',
    },
    {
      key: 'separator',
      label: 'Between words',
      type: 'select',
      choices: [
        { value: ' ', label: 'Space' },
        { value: '\n', label: 'New line' },
        { value: ' - ', label: 'Dash' },
      ],
      default: ' ',
      showIf: (v) => v.direction === 'spell',
    },
  ],
  swap: (v) => ({ direction: v.direction === 'spell' ? 'read' : 'spell' }),
  run(input, o) {
    if (o.direction === 'read') {
      const unknown: string[] = [];
      const text = input
        .replace(/x-ray/gi, 'xray')
        .split(/[^A-Za-z]+/)
        .filter(Boolean)
        .map((word) => {
          const char = REVERSE.get(word.toLowerCase());
          if (char === undefined) unknown.push(word);
          return char ?? '?';
        })
        .join('');
      return { output: text, warnings: unknown.length > 0 ? [`Not in the alphabet: ${[...new Set(unknown)].join(', ')}`] : undefined };
    }
    const words = [...input.toUpperCase()].map((char) => (char === ' ' ? '(space)' : (NATO[char] ?? char))).filter((word) => word !== '\n' && word !== '\r');
    return { output: words.join(o.separator), info: `${input.replace(/\s/g, '').length} characters` };
  },
});
