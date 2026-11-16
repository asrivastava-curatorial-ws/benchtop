import { defineTextTool } from '../types';

/** internationalization → i18n: first letter, the count of letters between, last letter. */
export const numeronym = (word: string): string => {
  const chars = [...word];
  return chars.length < 4 ? word : `${chars[0]}${chars.length - 2}${chars[chars.length - 1]}`;
};

export default defineTextTool({
  input: { label: 'Words', sample: 'internationalization\nlocalization\naccessibility\nKubernetes' },
  output: { label: 'Numeronyms' },
  options: [{ key: 'min', label: 'Shorten words of at least', type: 'number', default: 4, min: 3, max: 30, step: 1, unit: 'letters' }],
  run(input, o) {
    return input.replace(/\p{L}[\p{L}\p{M}]*/gu, (word) => ([...word].length >= o.min ? numeronym(word) : word));
  },
});
