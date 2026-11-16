import { entropyToMnemonic, generateMnemonic, mnemonicToEntropy, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { toHex } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

const LISTS = {
  english: () => import('@scure/bip39/wordlists/english.js'),
  spanish: () => import('@scure/bip39/wordlists/spanish.js'),
  french: () => import('@scure/bip39/wordlists/french.js'),
  italian: () => import('@scure/bip39/wordlists/italian.js'),
  portuguese: () => import('@scure/bip39/wordlists/portuguese.js'),
  czech: () => import('@scure/bip39/wordlists/czech.js'),
  japanese: () => import('@scure/bip39/wordlists/japanese.js'),
  korean: () => import('@scure/bip39/wordlists/korean.js'),
  'simplified-chinese': () => import('@scure/bip39/wordlists/simplified-chinese.js'),
  'traditional-chinese': () => import('@scure/bip39/wordlists/traditional-chinese.js'),
} as const;

export default defineTextTool({
  input: false,
  output: { label: 'Mnemonic' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'generate', label: 'Generate' },
        { value: 'check', label: 'Check' },
        { value: 'entropy', label: 'From entropy' },
      ],
      default: 'generate',
    },
    { key: 'words', label: 'Words', type: 'select', choices: ['12', '15', '18', '21', '24'], default: '12', showIf: (v) => v.mode === 'generate' },
    { key: 'language', label: 'Word list', type: 'select', choices: Object.keys(LISTS), default: 'english' },
    { key: 'phrase', label: 'Mnemonic', type: 'text', default: '', secret: true, multiline: true, showIf: (v) => v.mode === 'check' },
    { key: 'entropy', label: 'Entropy (hex)', type: 'text', default: '', secret: true, mono: true, showIf: (v) => v.mode === 'entropy' },
    { key: 'passphrase', label: 'Optional passphrase', type: 'text', default: '', secret: true, help: 'The "25th word": changes the seed, not the words.' },
  ],
  action: 'Generate',
  runOnEmpty: true,
  async run(_input, o) {
    const { wordlist } = await LISTS[o.language as keyof typeof LISTS]();
    let phrase: string;
    if (o.mode === 'check') {
      phrase = o.phrase.trim().normalize('NFKD').split(/\s+/).join(' ');
      if (phrase === '') return {};
      if (!validateMnemonic(phrase, wordlist)) {
        const unknown = phrase.split(' ').filter((word) => !wordlist.includes(word));
        throw new ToolError(
          unknown.length > 0 ? `Not in the ${o.language} word list: ${unknown.join(', ')}` : 'The words are in the list but the checksum is wrong: a word is mistyped or out of order.',
        );
      }
    } else if (o.mode === 'entropy') {
      const hex = o.entropy.replace(/\s+/g, '');
      if (!/^([0-9a-f]{2})+$/i.test(hex) || ![16, 20, 24, 28, 32].includes(hex.length / 2)) throw new ToolError('Entropy must be 16, 20, 24, 28 or 32 bytes of hex.');
      phrase = entropyToMnemonic(
        Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)),
        wordlist,
      );
    } else {
      phrase = generateMnemonic(wordlist, (Number(o.words) / 3) * 32);
    }
    const seed = await mnemonicToSeed(phrase, o.passphrase);
    return {
      output: phrase,
      fields: [
        { label: 'Valid', value: 'Checksum correct', tone: 'ok' },
        { label: 'Words', value: String(phrase.split(' ').length) },
        { label: 'Entropy', value: toHex(mnemonicToEntropy(phrase, wordlist)), mono: true },
        { label: 'Seed (BIP39, 512-bit)', value: toHex(seed), mono: true },
      ],
      warnings: ['Generated on this computer from the system’s secure random source. For real funds, prefer an offline hardware wallet.'],
    };
  },
});
