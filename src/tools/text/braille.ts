import { bharatiBraille, brailleSvg, englishBraille, toBrailleAscii } from '../../lib/braille';
import { defineTextTool, type TextResult } from '../types';

const SAMPLE = 'Welcome to the Engine Hall. Gallery 2 opens at 10:30.\nविज्ञान संग्रहालय में आपका स्वागत है।';

export default defineTextTool({
  input: { label: 'Text', language: 'text', sample: SAMPLE, placeholder: 'English or Hindi text' },
  output: { label: 'Braille' },
  options: [
    {
      key: 'script',
      label: 'Rules',
      type: 'segmented',
      choices: [
        { value: 'auto', label: 'By script' },
        { value: 'english', label: 'English (UEB grade 1)' },
        { value: 'bharati', label: 'Bharati (Hindi, Marathi…)' },
      ],
      default: 'auto',
      help: '“By script” uses Bharati Braille for Devanagari and English braille for the rest.',
    },
    {
      key: 'as',
      label: 'Write as',
      type: 'segmented',
      choices: [
        { value: 'unicode', label: 'Braille characters' },
        { value: 'ascii', label: 'Braille ASCII (.brf)' },
      ],
      default: 'unicode',
    },
    { key: 'cells', label: 'Cells per line on the sign', type: 'number', default: 28, min: 4, max: 80, step: 1 },
  ],
  run(input, o): TextResult {
    const convert = (line: string) => {
      if (o.script === 'english') return englishBraille(line);
      if (o.script === 'bharati') return bharatiBraille(line);
      return /[ऀ-ॿ]/.test(line) ? bharatiBraille(line) : englishBraille(line);
    };
    const unicode = input.split('\n').map(convert).join('\n');
    const svg = brailleSvg(unicode, undefined, o.cells);
    const cells = [...unicode].filter((c) => c >= '⠀' && c <= '⣿').length;
    return {
      output: o.as === 'ascii' ? toBrailleAscii(unicode) : unicode,
      filename: o.as === 'ascii' ? 'braille.brf' : 'braille.txt',
      preview: { kind: 'svg', svg },
      binary: { name: 'braille-sign.svg', mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg) },
      info: `${cells} cells · the picture is to scale for signs: 1.5 mm dots, 2.5 mm apart, cells 6.2 mm apart`,
      warnings: ['Uncontracted braille, as used on signs and labels; check signage with a braille reader before it is made.'],
    };
  },
});
