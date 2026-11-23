/**
 * English pronunciations from the CMU Pronouncing Dictionary (134,000 words,
 * ARPAbet, American English), loaded on first use, with a rough
 * spelling-based guess for words it does not list.
 */

let table: Promise<Record<string, string>> | null = null;

export function loadDictionary(): Promise<Record<string, string>> {
  table ??= import('cmu-pronouncing-dictionary').then((m) => m.dictionary as Record<string, string>);
  return table;
}

export interface Pronunciation {
  readonly word: string;
  /** ARPAbet phonemes with stress digits on vowels, e.g. ["M", "Y", "UW0", "Z", "IY1", "AH0", "M"]. */
  readonly phones: readonly string[];
  /** True when the word was not in the dictionary and the sounds were guessed from its spelling. */
  readonly guessed: boolean;
}

export const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
export const isVowel = (phone: string) => VOWELS.has(phone.replace(/\d$/, ''));

/** A best guess at the sounds of a word from its spelling. */
export function guessPhones(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const out: string[] = [];
  const vowel = (c: string | undefined) => !!c && 'aeiou'.includes(c);
  let i = 0;
  // A final silent e lengthens the vowel before the last consonant: make, time, home, cute.
  const magicE = (at: number) => w[at + 2] === 'e' && at + 3 === w.length && !vowel(w[at + 1]);
  while (i < w.length) {
    const rest = w.slice(i);
    const c = w[i] as string;
    const next = w[i + 1];
    const take = (phones: string[], n: number) => {
      out.push(...phones);
      i += n;
    };
    if (rest.startsWith('tch')) take(['CH'], 3);
    else if (rest.startsWith('igh')) take(['AY1'], 3);
    else if (rest.startsWith('ch')) take(['CH'], 2);
    else if (rest.startsWith('sh')) take(['SH'], 2);
    else if (rest.startsWith('th')) take(['TH'], 2);
    else if (rest.startsWith('ph')) take(['F'], 2);
    else if (rest.startsWith('ck')) take(['K'], 2);
    else if (rest.startsWith('qu')) take(['K', 'W'], 2);
    else if (rest.startsWith('wh')) take(['W'], 2);
    else if (i === 0 && rest.startsWith('kn')) take(['N'], 2);
    else if (i === 0 && rest.startsWith('wr')) take(['R'], 2);
    else if (rest.startsWith('ng') && !vowel(w[i + 2])) take(['NG'], 2);
    else if (rest.startsWith('ee') || rest.startsWith('ea')) take(['IY1'], 2);
    else if (rest.startsWith('oo')) take(['UW1'], 2);
    else if (rest.startsWith('ai') || rest.startsWith('ay')) take(['EY1'], 2);
    else if (rest.startsWith('oa')) take(['OW1'], 2);
    else if (rest.startsWith('ou') || (rest.startsWith('ow') && i + 2 < w.length)) take(['AW1'], 2);
    else if (rest.startsWith('ow')) take(['OW1'], 2);
    else if (rest.startsWith('oi') || rest.startsWith('oy')) take(['OY1'], 2);
    else if (rest.startsWith('au') || rest.startsWith('aw')) take(['AO1'], 2);
    else if (rest.startsWith('er') && (i + 2 === w.length || !vowel(w[i + 2]))) take(['ER0'], 2);
    else if (vowel(c)) {
      if (c === 'e' && i === w.length - 1 && out.length) {
        i++;
        continue;
      }
      const long = magicE(i);
      const map: Record<string, string> = long ? { a: 'EY1', e: 'IY1', i: 'AY1', o: 'OW1', u: 'UW1' } : { a: 'AE1', e: 'EH1', i: 'IH1', o: 'AA1', u: 'AH1' };
      take([map[c] as string], 1);
    } else if (c === 'y') take(i === 0 && vowel(next) ? ['Y'] : i === w.length - 1 ? ['IY0'] : ['IH0'], 1);
    else if (c === 'x') take(['K', 'S'], 1);
    else if (c === 'c') take(['eiy'.includes(next ?? '') ? 'S' : 'K'], 1);
    else if (c === 'g') take([next === 'e' && i + 2 === w.length ? 'JH' : 'G'], 1);
    else if (c === 'j') take(['JH'], 1);
    else if (c === 'h') take(vowel(next) ? ['HH'] : [], 1);
    else {
      const map: Record<string, string> = { b: 'B', d: 'D', f: 'F', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P', q: 'K', r: 'R', s: 'S', t: 'T', v: 'V', w: 'W', z: 'Z' };
      const phone = map[c];
      // Doubled letters are one sound: little, summer.
      if (phone && out[out.length - 1] !== phone) out.push(phone);
      i++;
    }
  }
  return out;
}

export async function pronounce(word: string): Promise<Pronunciation> {
  const dict = await loadDictionary();
  const key = word.toLowerCase().replace(/[’‘]/g, "'");
  const entry = dict[key] ?? dict[key.replace(/'s$/, '')]?.concat(' Z') ?? null;
  if (entry) return { word, phones: entry.split(' '), guessed: false };
  return { word, phones: guessPhones(word), guessed: true };
}
