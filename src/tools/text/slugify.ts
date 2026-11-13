import { slugify } from '../../lib/words';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: { label: 'Titles (one per line)', sample: 'Visvesvaraya Industrial & Technological Museum\nRené Magritte: Ceci n’est pas une pipe\n10 Tips for Better Exhibit Labels (2026 Edition)' },
  output: { label: 'Slugs' },
  options: [
    {
      key: 'separator',
      label: 'Separator',
      type: 'select',
      choices: [
        { value: '-', label: 'Hyphen' },
        { value: '_', label: 'Underscore' },
        { value: '.', label: 'Dot' },
      ],
      default: '-',
    },
    { key: 'lowercase', label: 'Lower case', type: 'toggle', default: true },
    { key: 'keepUnicode', label: 'Keep non-Latin letters', type: 'toggle', default: false, help: 'Keeps Devanagari, Cyrillic and other scripts instead of dropping them.' },
    { key: 'maxLength', label: 'Maximum length', type: 'number', min: 0, max: 200, step: 1, default: 60, help: '0 means no limit; long slugs are cut at a separator.' },
  ],
  run(input, o) {
    return `${input
      .split(/\r?\n/)
      .map((line) => (line.trim() === '' ? '' : slugify(line, o)))
      .join('\n')}\n`;
  },
});
