/** IPA and Shavian spellings of English from CMU dictionary pronunciations (General American). */
import { isVowel } from './cmudict';

const IPA: Record<string, string> = {
  AA: 'ɑ',
  AE: 'æ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  EH: 'ɛ',
  EY: 'eɪ',
  IH: 'ɪ',
  IY: 'i',
  OW: 'oʊ',
  OY: 'ɔɪ',
  UH: 'ʊ',
  UW: 'u',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

/** Consonant pairs that can begin an English syllable, for placing stress marks. */
const ONSETS = new Set([
  'P R',
  'P L',
  'B R',
  'B L',
  'T R',
  'D R',
  'K R',
  'K L',
  'G R',
  'G L',
  'F R',
  'F L',
  'TH R',
  'S P',
  'S T',
  'S K',
  'S M',
  'S N',
  'S L',
  'S W',
  'SH R',
  'T W',
  'K W',
  'D W',
  'P Y',
  'B Y',
  'K Y',
  'M Y',
  'F Y',
  'HH Y',
  'V Y',
]);
/** Three-consonant onsets: s, a stop, then a liquid or glide (split, street, square). */
const ONSETS3 = new Set(['S P R', 'S P L', 'S P Y', 'S T R', 'S T Y', 'S K R', 'S K W', 'S K Y', 'S K L']);

export function toIpa(phones: readonly string[], stress = true): string {
  const parts: string[] = [];
  const marks = new Map<number, string>();
  phones.forEach((p, i) => {
    const s = p.match(/\d$/)?.[0];
    if (!stress || !s || s === '0' || !isVowel(p)) return;
    // Put the mark before the syllable's onset: the longest run of consonants that can start a syllable.
    let at = i;
    const prev = phones[i - 1];
    const prev2 = phones[i - 2];
    const prev3 = phones[i - 3];
    if (prev && !isVowel(prev)) {
      at = i - 1;
      if (prev2 && !isVowel(prev2) && ONSETS.has(`${prev2} ${prev}`)) at = i - 2;
      if (at === i - 2 && prev3 && ONSETS3.has(`${prev3} ${prev2} ${prev}`)) at = i - 3;
    }
    if (i > 0 && !phones.slice(0, i).some(isVowel)) at = 0;
    marks.set(at, s === '1' ? 'ˈ' : 'ˌ');
  });
  phones.forEach((p, i) => {
    const mark = marks.get(i);
    if (mark && phones.some(isVowel) && phones.filter(isVowel).length > 1) parts.push(mark);
    const base = p.replace(/\d$/, '');
    const s = p.match(/\d$/)?.[0];
    if (base === 'AH') parts.push(s === '0' ? 'ə' : 'ʌ');
    else if (base === 'ER') parts.push(s === '0' ? 'ɚ' : 'ɝ');
    else parts.push(IPA[base] ?? base.toLowerCase());
  });
  return parts.join('');
}

const SHAW: Record<string, string> = {
  P: '𐑐',
  T: '𐑑',
  K: '𐑒',
  F: '𐑓',
  TH: '𐑔',
  S: '𐑕',
  SH: '𐑖',
  CH: '𐑗',
  Y: '𐑘',
  NG: '𐑙',
  B: '𐑚',
  D: '𐑛',
  G: '𐑜',
  V: '𐑝',
  DH: '𐑞',
  Z: '𐑟',
  ZH: '𐑠',
  JH: '𐑡',
  W: '𐑢',
  HH: '𐑣',
  L: '𐑤',
  M: '𐑥',
  IH: '𐑦',
  EH: '𐑧',
  AE: '𐑨',
  UH: '𐑫',
  AW: '𐑬',
  R: '𐑮',
  N: '𐑯',
  IY: '𐑰',
  EY: '𐑱',
  AY: '𐑲',
  OW: '𐑴',
  UW: '𐑵',
  OY: '𐑶',
  AO: '𐑷',
};

/** Common words with their own short Shavian forms. */
const SHAVIAN_WORDS: Record<string, string> = { the: '𐑞', of: '𐑝', and: '𐑯', to: '𐑑', for: '𐑓' };

export function toShavian(word: string, phones: readonly string[]): string {
  const short = SHAVIAN_WORDS[word.toLowerCase()];
  if (short) return short;
  const out: string[] = [];
  for (let i = 0; i < phones.length; i++) {
    const p = phones[i] as string;
    const base = p.replace(/\d$/, '');
    const s = p.match(/\d$/)?.[0];
    const next = phones[i + 1]?.replace(/\d$/, '');
    // R-coloured vowels and yew have letters of their own.
    if (next === 'R' && (base === 'AA' || base === 'AO' || base === 'EH' || base === 'IH' || base === 'IY')) {
      out.push(base === 'AA' ? '𐑸' : base === 'AO' ? '𐑹' : base === 'EH' ? '𐑺' : '𐑽');
      i++;
      continue;
    }
    if (base === 'Y' && next === 'UW') {
      out.push('𐑿');
      i++;
      continue;
    }
    if (base === 'IY' && next === 'AH' && phones[i + 1]?.endsWith('0')) {
      out.push('𐑾');
      i++;
      continue;
    }
    if (base === 'ER') out.push(s === '0' ? '𐑼' : '𐑻');
    else if (base === 'AH') out.push(s === '0' ? '𐑩' : '𐑳');
    else if (base === 'AA') out.push(next === undefined ? '𐑭' : '𐑪');
    else out.push(SHAW[base] ?? '');
  }
  return out.join('');
}
