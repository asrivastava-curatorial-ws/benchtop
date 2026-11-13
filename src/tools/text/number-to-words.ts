import { ToolError } from '../../lib/errors';
import { amountToCheque, amountToWords, CURRENCIES, numberToOrdinal, numberToWords } from '../../lib/number-words';
import { capitalize, splitLines } from '../../lib/text';
import { defineTextTool, type Values } from '../types';

function recase(text: string, style: string): string {
  switch (style) {
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text.replace(/[a-z]+/g, (word) => (word === 'and' ? word : capitalize(word)));
    case 'sentence':
      return text.charAt(0).toUpperCase() + text.slice(1);
    default:
      return text;
  }
}

const isMoney = (v: Values): boolean => v.mode === 'currency' || v.mode === 'cheque';

export default defineTextTool({
  input: { label: 'Numbers (one per line)', sample: '42\n1,234,567.89\n-0.5\n1e9\n10000000', placeholder: '1234.56' },
  output: { label: 'In words' },
  options: [
    {
      key: 'mode',
      label: 'Write as',
      type: 'select',
      choices: [
        { value: 'cardinal', label: 'Number (forty-two)' },
        { value: 'ordinal', label: 'Ordinal (forty-second)' },
        { value: 'currency', label: 'Money (dollars and cents)' },
        { value: 'cheque', label: 'Cheque (and 56/100 dollars)' },
      ],
      default: 'cardinal',
    },
    {
      key: 'currency',
      label: 'Currency',
      type: 'select',
      choices: [
        { value: 'USD', label: 'US dollar' },
        { value: 'EUR', label: 'Euro' },
        { value: 'GBP', label: 'Pound sterling' },
        { value: 'INR', label: 'Indian rupee' },
      ],
      default: 'USD',
      showIf: isMoney,
    },
    {
      key: 'system',
      label: 'Numbering',
      type: 'select',
      choices: [
        { value: 'international', label: 'International (million, billion)' },
        { value: 'indian', label: 'Indian (lakh, crore)' },
      ],
      default: 'international',
    },
    { key: 'and', label: '"and" after hundred', type: 'toggle', default: false, help: 'British usage: one hundred and one.' },
    {
      key: 'case',
      label: 'Capitalisation',
      type: 'select',
      choices: [
        { value: 'sentence', label: 'Sentence case' },
        { value: 'lower', label: 'lowercase' },
        { value: 'title', label: 'Title Case' },
        { value: 'upper', label: 'UPPERCASE' },
      ],
      default: 'sentence',
    },
  ],
  run(input, o) {
    const options = { system: o.system as 'international' | 'indian', and: o.and };
    const currency = CURRENCIES[o.currency] ?? CURRENCIES.USD;
    if (!currency) throw new ToolError('Unknown currency.');
    const lines = splitLines(input);
    return lines
      .map((line, index) => {
        if (line.trim() === '') return '';
        try {
          const words =
            o.mode === 'ordinal'
              ? numberToOrdinal(line, options)
              : o.mode === 'currency'
                ? amountToWords(line, currency, options)
                : o.mode === 'cheque'
                  ? amountToCheque(line, currency, options)
                  : numberToWords(line, options);
          return recase(words, o.case);
        } catch (error) {
          if (error instanceof ToolError && lines.length > 1) throw new ToolError(`Line ${index + 1}: ${error.message}`, { line: index + 1 });
          throw error;
        }
      })
      .join('\n');
  },
});
