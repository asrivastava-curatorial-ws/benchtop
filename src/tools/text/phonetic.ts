import { pronounce } from '../../lib/cmudict';
import { toIpa, toShavian } from '../../lib/phonetics';
import { defineTextTool, type TextResult } from '../types';

const SAMPLE = 'The museum opens at ten.\nScience is a way of thinking.';

export default defineTextTool({
  input: { label: 'English text', language: 'text', sample: SAMPLE },
  output: { label: 'Result' },
  options: [
    {
      key: 'to',
      label: 'Write in',
      type: 'segmented',
      choices: [
        { value: 'ipa', label: 'IPA' },
        { value: 'shavian', label: 'Shavian' },
        { value: 'arpabet', label: 'ARPAbet' },
      ],
      default: 'ipa',
    },
    { key: 'stress', label: 'Stress marks', type: 'toggle', default: true, showIf: (v) => v.to === 'ipa' },
    { key: 'slashes', label: 'Between slashes', type: 'toggle', default: false, showIf: (v) => v.to === 'ipa' },
    { key: 'namer', label: 'Namer dot before names', type: 'toggle', default: true, showIf: (v) => v.to === 'shavian' },
  ],
  async run(input, o): Promise<TextResult> {
    const guessed = new Set<string>();
    const lines: string[] = [];
    for (const line of input.split('\n')) {
      const parts = line.split(/([A-Za-z]+(?:['’][A-Za-z]+)*)/);
      let out = '';
      for (let k = 0; k < parts.length; k++) {
        const part = parts[k] as string;
        if (k % 2 === 0) {
          out += part;
          continue;
        }
        const p = await pronounce(part);
        if (p.guessed) guessed.add(part);
        if (o.to === 'arpabet') out += p.phones.join(' ');
        else if (o.to === 'shavian') {
          // A capitalised word that does not start a sentence is a name.
          const startsSentence = /(^|[.!?]\s*)$/.test(out);
          const name = o.namer && /^[A-Z]/.test(part) && !startsSentence && part.toLowerCase() !== 'i';
          out += (name ? '·' : '') + toShavian(part, p.phones);
        } else out += toIpa(p.phones, o.stress);
      }
      lines.push(o.to === 'ipa' && o.slashes && out.trim() ? `/${out.trim()}/` : out);
    }
    return {
      output: lines.join('\n'),
      info: o.to === 'shavian' ? 'Shavian needs a font with the Shavian letters, such as Noto Sans Shavian or Ormin' : 'General American pronunciations from the CMU Pronouncing Dictionary',
      warnings: guessed.size ? [`Not in the dictionary, so guessed from the spelling: ${[...guessed].slice(0, 12).join(', ')}${guessed.size > 12 ? '…' : ''}.`] : [],
    };
  },
});
