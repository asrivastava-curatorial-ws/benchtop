import * as randomWords from 'random-words';
import { entropyBits, generatePassphrase, generatePassword, passwordPoolSize, strengthLabel } from '../../lib/password';
import { defineTextTool, type Field, type Values } from '../types';

const wordList = [...new Set((randomWords as unknown as { wordList: string[] }).wordList.filter((word) => /^[a-z]{3,9}$/.test(word)))];
const passwords = (v: Values) => v.kind === 'password';

export default defineTextTool({
  input: false,
  output: { label: 'Generated' },
  options: [
    {
      key: 'kind',
      label: 'Kind',
      type: 'segmented',
      choices: [
        { value: 'password', label: 'Password' },
        { value: 'passphrase', label: 'Passphrase' },
      ],
      default: 'password',
    },
    { key: 'length', label: 'Length', type: 'range', min: 6, max: 128, step: 1, default: 20, showIf: passwords },
    { key: 'lower', label: 'a-z', type: 'toggle', default: true, showIf: passwords },
    { key: 'upper', label: 'A-Z', type: 'toggle', default: true, showIf: passwords },
    { key: 'digits', label: '0-9', type: 'toggle', default: true, showIf: passwords },
    { key: 'symbols', label: 'Symbols', type: 'toggle', default: true, showIf: passwords },
    { key: 'avoidAmbiguous', label: 'Avoid look-alikes (0 O 1 l I)', type: 'toggle', default: true, showIf: passwords },
    { key: 'exclude', label: 'Never use', type: 'text', default: '', mono: true, showIf: passwords, placeholder: 'characters a system rejects' },
    { key: 'words', label: 'Words', type: 'range', min: 3, max: 12, step: 1, default: 5, showIf: (v: Values) => v.kind === 'passphrase' },
    {
      key: 'separator',
      label: 'Separator',
      type: 'select',
      choices: [
        { value: '-', label: 'Hyphen' },
        { value: ' ', label: 'Space' },
        { value: '.', label: 'Dot' },
        { value: '_', label: 'Underscore' },
        { value: '', label: 'None' },
      ],
      default: '-',
      showIf: (v: Values) => v.kind === 'passphrase',
    },
    { key: 'capitalize', label: 'Capitalise words', type: 'toggle', default: true, showIf: (v: Values) => v.kind === 'passphrase' },
    { key: 'number', label: 'Add a number', type: 'toggle', default: true, showIf: (v: Values) => v.kind === 'passphrase' },
    { key: 'count', label: 'How many', type: 'number', min: 1, max: 100, step: 1, default: 5 },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    const items: string[] = [];
    let bits: number;
    if (o.kind === 'passphrase') {
      for (let i = 0; i < o.count; i++) items.push(generatePassphrase(wordList, o.words, o.separator, o.capitalize, o.number));
      bits = entropyBits(wordList.length, o.words) + (o.number ? Math.log2(100) : 0);
    } else {
      for (let i = 0; i < o.count; i++) items.push(generatePassword(o));
      bits = entropyBits(passwordPoolSize(o), o.length);
    }
    const strength = strengthLabel(bits);
    const fields: Field[] = [
      { label: 'Strength', value: `${Math.round(bits)} bits of entropy: ${strength.label}`, tone: strength.tone },
      { label: 'Source', value: o.kind === 'passphrase' ? `${wordList.length.toLocaleString('en-US')}-word list, system random numbers` : 'System random numbers (crypto.getRandomValues)' },
    ];
    return { output: `${items.join('\n')}\n`, fields, info: 'Generated on this computer and never stored. Press Generate for new ones.' };
  },
});
