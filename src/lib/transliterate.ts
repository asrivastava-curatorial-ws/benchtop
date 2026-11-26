/**
 * Transliteration and phonetic typing, offline and rule-based.
 *
 * Roman letters become the scripts of 35 languages (ITRANS / IAST for the Indian
 * scripts, Revised Romanization for Korean, Telex for Vietnamese, Arabizi, Finglish,
 * the usual Latin spellings for Cyrillic, Greek, Armenian and Georgian, Ge'ez syllables
 * and Ol Chiki), five more are typed on their on-screen keyboards, and text in any
 * Indian script converts to any other or to IAST, ISO 15919, ITRANS or a plain
 * English-style spelling.
 *
 * This is a port of the rule engines of the author's Universal Transliterator, so the
 * two apps spell alike; its AI (IndicXlit), Mandarin (Rime) and Japanese (libkkc)
 * engines need native libraries and stay in that app.
 */
import {
  ARABIC_CONSONANTS,
  ARMENIAN,
  BELARUSIAN,
  BULGARIAN,
  CASUAL_CONSONANTS,
  CASUAL_VOWELS,
  ETHIOPIC_CONSONANTS,
  ETHIOPIC_VOWELS,
  GEORGIAN,
  GREEK,
  HANGUL_FINALS,
  HANGUL_INITIALS,
  HANGUL_VOWELS,
  HEBREW_CONSONANTS,
  IAST_CONSONANTS,
  IAST_VOWELS,
  ISO_VOWELS,
  ITRANS,
  ITRANS_CONSONANTS,
  ITRANS_VOWELS,
  type KeyboardLayout,
  LAYOUTS,
  MACEDONIAN,
  MARK_KEYS,
  OL_CHIKI,
  PERSIAN_CONSONANTS,
  RUSSIAN,
  SERBIAN,
  SINHALA_FROM,
  SINHALA_TO,
  SPECIAL,
  UKRAINIAN,
  UNASSIGNED,
} from './transliterate-data';

export type { KeyboardLayout } from './transliterate-data';

/* ------------------------------------------------------------------ characters -- */

const ALPHABETIC = /\p{Alphabetic}/u;
const WHITE_SPACE = /\p{White_Space}/u;
const UPPERCASE = /\p{Uppercase}/u;
const ASCII_LETTER = /^[A-Za-z]$/;

const code = (ch: string): number => ch.codePointAt(0) ?? 0;
const char = (value: number): string => String.fromCodePoint(value);
const isAsciiLetter = (ch: string | undefined): boolean => ch !== undefined && ASCII_LETTER.test(ch);
const isAsciiDigit = (ch: string | undefined): boolean => ch !== undefined && ch.length === 1 && ch >= '0' && ch <= '9';
const isWhite = (ch: string): boolean => WHITE_SPACE.test(ch);
const lowerFirst = (ch: string): string => Array.from(ch.toLowerCase())[0] ?? ch;
const between = (value: number, from: number, to: number): boolean => value >= from && value <= to;

/** The longest table entry the text starts with at `at`; the later one of equal length wins. */
function longest<T extends readonly [string, ...unknown[]]>(table: readonly T[], text: string, at = 0): T | undefined {
  let best: T | undefined;
  for (const entry of table) {
    if ((best === undefined || entry[0].length >= best[0].length) && text.startsWith(entry[0], at)) best = entry;
  }
  return best;
}

/* --------------------------------------------------------------- Indian scripts -- */

export type IndicScript = 'Devanagari' | 'Bengali' | 'Assamese' | 'Gurmukhi' | 'Gujarati' | 'Odia' | 'Tamil' | 'Telugu' | 'Kannada' | 'Malayalam' | 'Sinhala';

export const INDIC_SCRIPTS: readonly IndicScript[] = ['Devanagari', 'Bengali', 'Assamese', 'Gurmukhi', 'Gujarati', 'Odia', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala'];

/** Offset of each block from Devanagari's, for the nine blocks laid out like it. */
const OFFSET: Readonly<Record<IndicScript, number | null>> = {
  Devanagari: 0,
  Bengali: 0x80,
  Assamese: 0x80,
  Gurmukhi: 0x100,
  Gujarati: 0x180,
  Odia: 0x200,
  Tamil: 0x280,
  Telugu: 0x300,
  Kannada: 0x380,
  Malayalam: 0x400,
  Sinhala: null,
};

const VIRAMA = char(0x094d);
const NUKTA = char(0x093c);
const ANUSVARA = char(0x0902);
const CHANDRABINDU = char(0x0901);
const VISARGA = char(0x0903);
const GURMUKHI_ADDAK = char(0x0a71);
const GURMUKHI_TIPPI = char(0x0a70);
const GURMUKHI_VIRAMA = char(0x0a4d);
const ODIA_VIRAMA = char(0x0b4d);

/** The Indian script a character belongs to. */
export function scriptOf(ch: string): IndicScript | null {
  const c = code(ch);
  if (between(c, 0x0900, 0x097f)) return 'Devanagari';
  if (c === 0x09f0 || c === 0x09f1) return 'Assamese';
  if (between(c, 0x0980, 0x09ff)) return 'Bengali';
  if (between(c, 0x0a00, 0x0a7f)) return 'Gurmukhi';
  if (between(c, 0x0a80, 0x0aff)) return 'Gujarati';
  if (between(c, 0x0b00, 0x0b7f)) return 'Odia';
  if (between(c, 0x0b80, 0x0bff)) return 'Tamil';
  if (between(c, 0x0c00, 0x0c7f)) return 'Telugu';
  if (between(c, 0x0c80, 0x0cff)) return 'Kannada';
  if (between(c, 0x0d00, 0x0d7f)) return 'Malayalam';
  if (between(c, 0x0d80, 0x0dff)) return 'Sinhala';
  return null;
}

/** The script most of a text is written in, among the Indian ones. */
export function detectIndicScript(text: string): IndicScript | null {
  const counts = new Map<IndicScript, number>();
  for (const ch of text) {
    const script = scriptOf(ch);
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  let best: IndicScript | null = null;
  let most = 0;
  for (const script of INDIC_SCRIPTS) {
    const count = counts.get(script) ?? 0;
    if (count > 0 && count >= most) {
      best = script;
      most = count;
    }
  }
  return best;
}

/* ---------------------------------------------- ITRANS / IAST / ISO 15919 → Devanagari -- */

/**
 * ITRANS (with common casual aliases) or IAST / ISO 15919 letters to Devanagari.  With
 * `finalVirama` a word-final consonant gets a virama (Sanskrit: bhaarat → भारत्); without
 * it the consonant keeps its vowel as Hindi is written.  With `dravidian`, e / o are the
 * short vowels and E / O the long ones (Tamil, Telugu, Kannada, Malayalam).
 */
export function itransToDevanagari(input: string, finalVirama: boolean, dravidian = false): string {
  const text = input.normalize('NFC');
  let out = '';
  let offset = 0;
  let pending = false;
  while (offset < text.length) {
    const entry = longest(ITRANS as readonly (readonly [string, ...string[]])[], text, offset);
    if (entry) {
      const [token, kind, first = '', second = ''] = entry;
      switch (kind) {
        case 'Consonant':
          if (pending) out += VIRAMA;
          out += first;
          pending = true;
          break;
        case 'Vowel': {
          let independent = first;
          let sign = second;
          if (dravidian && token === 'e') {
            independent = 'ऎ';
            sign = char(0x0946);
          } else if (dravidian && token === 'o') {
            independent = 'ऒ';
            sign = char(0x094a);
          }
          out += pending ? sign : independent;
          pending = false;
          break;
        }
        case 'Sign':
          out += first;
          pending = false;
          break;
        case 'Avagraha':
          out += 'ऽ';
          pending = false;
          break;
        case 'Virama':
          if (pending) out += VIRAMA;
          pending = false;
          break;
        case 'Om':
          if (pending && finalVirama) out += VIRAMA;
          out += 'ॐ';
          pending = false;
          break;
        default:
          break; // "_" separates letters and writes nothing
      }
      offset += token.length;
      continue;
    }
    const ch = char(text.codePointAt(offset) ?? 0x20);
    if (pending && finalVirama) out += VIRAMA;
    pending = false;
    out += ch;
    offset += ch.length;
  }
  if (pending && finalVirama) out += VIRAMA;
  // NFC keeps the nukta letters (U+0958–095F) decomposed and composes the rest.
  return out.normalize('NFC');
}

/* --------------------------------------------------------- Devanagari ⇄ other scripts -- */

const isDevanagariConsonant = (c: number): boolean => between(c, 0x0915, 0x0939) || between(c, 0x0958, 0x095f) || between(c, 0x0979, 0x097f);
const isMatra = (c: number): boolean => between(c, 0x093a, 0x094c) || c === 0x094e || c === 0x094f || between(c, 0x0955, 0x0957) || c === 0x0962 || c === 0x0963;
const isLetterOrMark = (ch: string): boolean => ALPHABETIC.test(ch) || (between(code(ch), 0x0900, 0x0dff) && !isWhite(ch));
const isAssignedIn = (script: IndicScript, ch: string): boolean => !(UNASSIGNED[script] ?? []).includes(code(ch) & 0x7f);

const CHILLU: Readonly<Record<string, string>> = { ण: 'ൺ', न: 'ൻ', र: 'ർ', ल: 'ൽ', ळ: 'ൾ' };

function mapOne(ch: string, script: IndicScript): string {
  if (ch === '।' || ch === '॥') return ch;
  if (script === 'Sinhala') {
    const value = SINHALA_FROM[ch];
    if (value !== undefined) return value;
    const c = code(ch);
    return between(c, 0x0966, 0x096f) ? String.fromCharCode(48 + c - 0x0966) : ch;
  }
  const special = SPECIAL[script]?.[ch];
  if (special !== undefined) return special;
  const candidate = char(code(ch) + (OFFSET[script] ?? 0));
  return isAssignedIn(script, candidate) ? candidate : ch;
}

/** Devanagari to another Indian script; other characters are kept. */
export function fromDevanagari(text: string, script: IndicScript): string {
  if (script === 'Devanagari') return text.normalize('NFC');
  const chars = Array.from(text.normalize('NFC'));
  let out = '';
  let index = 0;
  while (index < chars.length) {
    const ch = chars[index] as string;
    const next = chars[index + 1];
    const after = chars[index + 2];
    const c = code(ch);
    if (!between(c, 0x0900, 0x097f)) {
      out += ch;
      index++;
      continue;
    }
    // Each script's own spelling of consonant clusters.
    if (script === 'Gurmukhi' && isDevanagariConsonant(c) && next === VIRAMA) {
      const base = mapOne(ch, script);
      if (after === ch) {
        out += GURMUKHI_ADDAK + base;
        index += 3;
      } else if (after === 'र' || after === 'व' || after === 'ह' || after === 'य') {
        out += base + GURMUKHI_VIRAMA;
        index += 2;
      } else {
        // Punjabi writes most clusters without a halant.
        out += base;
        index += 2;
      }
      continue;
    }
    if (script === 'Malayalam' && next === VIRAMA) {
      const wordEnds = after === undefined || !isLetterOrMark(after);
      const chillu = CHILLU[ch];
      if (wordEnds && chillu) {
        out += chillu;
        index += 2;
        continue;
      }
    }
    if (script === 'Tamil' && ch === 'फ' && next === NUKTA) {
      out += 'ஃப';
      index += 2;
      continue;
    }
    if (script === 'Odia' && ch === 'व') {
      out += out.endsWith(ODIA_VIRAMA) ? 'ୱ' : 'ବ';
      index++;
      continue;
    }
    out += mapOne(ch, script);
    index++;
  }
  return out.normalize('NFC');
}

function reverseOffset(ch: string, script: IndicScript): string | null {
  const offset = OFFSET[script];
  if (offset === null || !isAssignedIn(script, ch)) return null;
  const c = code(ch) - offset;
  return between(c, 0x0900, 0x097f) ? char(c) : null;
}

const TO_DEVANAGARI: Readonly<Record<string, string>> = {
  ৰ: 'र',
  ৱ: 'व',
  ৎ: `त${VIRAMA}`,
  [GURMUKHI_TIPPI]: ANUSVARA,
  ୱ: 'व',
  ൺ: `ण${VIRAMA}`,
  ൻ: `न${VIRAMA}`,
  ർ: `र${VIRAMA}`,
  ൽ: `ल${VIRAMA}`,
  ൾ: `ळ${VIRAMA}`,
  ൿ: `क${VIRAMA}`,
  ೞ: 'ऴ',
};

/** Text in any Indian script to Devanagari; other text is kept. */
export function toDevanagari(text: string): string {
  const chars = Array.from(text.normalize('NFC'));
  let out = '';
  let index = 0;
  while (index < chars.length) {
    const ch = chars[index] as string;
    const next = chars[index + 1];
    const script = scriptOf(ch);
    index++;
    if (!script) {
      out += ch;
      continue;
    }
    let mapped: string | null;
    if (script === 'Devanagari') mapped = ch;
    else if (script === 'Sinhala') {
      const c = code(ch);
      mapped = SINHALA_TO[ch] ?? (between(c, 0x0de6, 0x0def) ? String.fromCharCode(48 + c - 0x0de6) : null);
    } else if (ch === GURMUKHI_ADDAK) {
      // Addak doubles the consonant after it.
      const consonant = next === undefined ? null : reverseOffset(next, 'Gurmukhi');
      mapped = consonant && isDevanagariConsonant(code(consonant)) ? consonant + VIRAMA : '';
    } else if (ch === 'ஃ') {
      if (next === 'ப') {
        index++;
        mapped = `फ${NUKTA}`;
      } else mapped = VISARGA;
    } else mapped = TO_DEVANAGARI[ch] ?? reverseOffset(ch, script);
    out += mapped ?? ch;
  }
  return out.normalize('NFC');
}

/* ------------------------------------------------------------------ romanization -- */

export type Romanization = 'iast' | 'iso15919' | 'itrans' | 'casual';

export const ROMANIZATIONS: readonly { readonly id: Romanization; readonly name: string }[] = [
  { id: 'iast', name: 'IAST' },
  { id: 'iso15919', name: 'ISO 15919' },
  { id: 'itrans', name: 'ITRANS' },
  { id: 'casual', name: 'Simple Roman' },
];

interface RomanTable {
  readonly vowel: (ch: string) => string | undefined;
  readonly consonant: (ch: string, nukta: boolean) => string | undefined;
  readonly anusvara: string;
  readonly chandrabindu: string;
  readonly visarga: string;
  readonly avagraha: string;
  readonly om: string;
  readonly danda: string;
  readonly doubleDanda: string;
}

const consonantIn =
  (own: typeof IAST_CONSONANTS, fallback: typeof IAST_CONSONANTS | null) =>
  (ch: string, nukta: boolean): string | undefined =>
    (nukta ? own.nukta[ch] : undefined) ?? own.plain[ch] ?? fallback?.plain[ch];

const M_CANDRABINDU = `m${char(0x0310)}`;

const ROMAN: Readonly<Record<Romanization, RomanTable>> = {
  iast: {
    vowel: (ch) => IAST_VOWELS[ch],
    consonant: consonantIn(IAST_CONSONANTS, null),
    anusvara: 'ṃ',
    chandrabindu: M_CANDRABINDU,
    visarga: 'ḥ',
    avagraha: "'",
    om: 'oṃ',
    danda: '|',
    doubleDanda: '||',
  },
  iso15919: {
    vowel: (ch) => ISO_VOWELS[ch] ?? IAST_VOWELS[ch],
    consonant: consonantIn(IAST_CONSONANTS, null),
    anusvara: 'ṁ',
    chandrabindu: M_CANDRABINDU,
    visarga: 'ḥ',
    avagraha: "'",
    om: 'ōṁ',
    danda: '.',
    doubleDanda: '..',
  },
  itrans: {
    vowel: (ch) => ITRANS_VOWELS[ch],
    consonant: consonantIn(ITRANS_CONSONANTS, IAST_CONSONANTS),
    anusvara: 'M',
    chandrabindu: '.N',
    visarga: 'H',
    avagraha: '.a',
    om: 'OM',
    danda: '|',
    doubleDanda: '||',
  },
  casual: {
    vowel: (ch) => CASUAL_VOWELS[ch],
    consonant: consonantIn(CASUAL_CONSONANTS, IAST_CONSONANTS),
    anusvara: 'n',
    chandrabindu: 'n',
    visarga: 'h',
    avagraha: '',
    om: 'om',
    danda: '.',
    doubleDanda: '.',
  },
};

const LABIALS = new Set(['प', 'फ', 'ब', 'भ', 'म']);

/** Text in any Indian script in Roman letters. */
export function romanize(text: string, scheme: Romanization): string {
  const dev = Array.from(toDevanagari(text));
  const table = ROMAN[scheme];
  let out = '';
  // Where the word's last inherent "a" was written (the plain spelling drops it: bharat).
  let droppable: number | null = null;
  let syllables = 0;
  const finishWord = () => {
    if (scheme === 'casual' && syllables > 1 && droppable !== null && droppable + 1 === out.length) out = out.slice(0, droppable);
    droppable = null;
    syllables = 0;
  };
  let index = 0;
  while (index < dev.length) {
    const ch = dev[index] as string;
    const c = code(ch);
    const next = dev[index + 1];
    if (isDevanagariConsonant(c)) {
      const nukta = next === NUKTA;
      const step = nukta ? 2 : 1;
      const following = dev[index + step];
      out += table.consonant(ch, nukta) ?? '';
      index += step;
      syllables++;
      const sign = following === undefined ? undefined : table.vowel(following);
      if (following === VIRAMA) {
        index++;
        droppable = null;
      } else if (following !== undefined && isMatra(code(following)) && sign !== undefined) {
        out += sign;
        index++;
        droppable = null;
      } else {
        droppable = out.length;
        out += 'a';
      }
      continue;
    }
    const vowel = table.vowel(ch);
    if (vowel !== undefined) {
      out += vowel;
      syllables++;
      droppable = null;
      index++;
      continue;
    }
    let mark: string | undefined;
    switch (ch) {
      case ANUSVARA:
        // Before a labial the plain spelling writes "m" (sambandh).
        mark = scheme === 'casual' && next !== undefined && LABIALS.has(next) ? 'm' : table.anusvara;
        break;
      case CHANDRABINDU:
        mark = table.chandrabindu;
        break;
      case VISARGA:
        mark = table.visarga;
        break;
      case 'ऽ':
        mark = table.avagraha;
        break;
      case 'ॐ':
        mark = table.om;
        break;
      case '।':
        mark = table.danda;
        break;
      case '॥':
        mark = table.doubleDanda;
        break;
      case VIRAMA:
      case NUKTA:
        mark = '';
        break;
    }
    if (mark !== undefined) {
      if (ch === ANUSVARA || ch === CHANDRABINDU || ch === VISARGA) droppable = null;
      out += mark;
      index++;
      continue;
    }
    finishWord();
    out += between(c, 0x0966, 0x096f) ? String.fromCharCode(48 + c - 0x0966) : ch;
    index++;
  }
  finishWord();
  return out.normalize('NFC');
}

export type ConvertTarget = IndicScript | Romanization;

export const isRomanization = (target: ConvertTarget): target is Romanization => ROMANIZATIONS.some((r) => r.id === target);

/** Text in any Indian script (each character's own) to another script or a romanization. */
export function convertIndic(text: string, target: ConvertTarget): string {
  return isRomanization(target) ? romanize(text, target) : fromDevanagari(toDevanagari(text), target);
}

/* ------------------------------------------------------- alphabets (Greek, Cyrillic…) -- */

type Pairs = readonly (readonly [string, string])[];
type Prepared = readonly (readonly [readonly string[], string])[];

const prepared = new WeakMap<Pairs, Prepared>();
const prepare = (table: Pairs): Prepared => {
  let ready = prepared.get(table);
  if (!ready) {
    ready = table.map(([latin, native]) => [Array.from(latin), native] as const);
    prepared.set(table, ready);
  }
  return ready;
};

/** The longest entry matching `chars` at `index` (the first of equal length wins). */
function match(chars: readonly string[], index: number, table: Prepared): readonly [number, string] | null {
  let best: readonly [number, string] | null = null;
  for (const [latin, native] of table) {
    const count = latin.length;
    if (index + count <= chars.length && latin.every((c, i) => chars[index + i] === c) && (best === null || count > best[0])) best = [count, native];
  }
  return best;
}

/** Longest-match replacement; with `foldCase` letters match either case and a capital stays one. */
function replace(word: string, table: Pairs, foldCase: boolean): string {
  const chars = Array.from(word);
  const lower = foldCase ? chars.map(lowerFirst) : chars;
  const ready = prepare(table);
  let out = '';
  let index = 0;
  while (index < chars.length) {
    const best = match(lower, index, ready);
    if (best) {
      const [count, native] = best;
      if (foldCase && UPPERCASE.test(chars[index] as string)) {
        const letters = Array.from(native);
        if (letters.length) out += (letters[0] as string).toUpperCase() + letters.slice(1).join('');
      } else out += native;
      index += count;
    } else {
      out += chars[index];
      index++;
    }
  }
  return out;
}

function greek(word: string): string {
  const out = replace(word, GREEK, true);
  return out.endsWith('σ') ? `${out.slice(0, -1)}ς` : out;
}

const CYRILLIC_VOWELS = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я', 'і', 'ї', 'є']);

/** After a vowel, Roman "y" is the semivowel й rather than ы / и / ъ. */
function semivowelAfterVowel(text: string, from: string, upperFrom: string): string {
  const chars = Array.from(text);
  return chars
    .map((ch, index) => {
      const afterVowel = index > 0 && CYRILLIC_VOWELS.has(lowerFirst(chars[index - 1] as string));
      if (afterVowel && ch === from) return 'й';
      if (afterVowel && ch === upperFrom) return 'Й';
      return ch;
    })
    .join('');
}

function armenian(word: string): string {
  const out = replace(word, ARMENIAN, true);
  // A word-initial "o" is written օ in modern spelling.
  if (out.startsWith('ո') && !out.startsWith('ու')) return `օ${out.slice(1)}`;
  if (out.startsWith('Ո') && !out.startsWith('Ու')) return `Օ${out.slice(1)}`;
  return out;
}

/* ------------------------------------------------------ abjads (Hebrew, Arabic, Persian) -- */

type Abjad = 'Hebrew' | 'Arabic' | 'Persian';

interface Vowel {
  readonly long: boolean;
  readonly ch: string;
}

const ABJAD_CONSONANTS: Readonly<Record<Abjad, Pairs>> = { Hebrew: HEBREW_CONSONANTS, Arabic: ARABIC_CONSONANTS, Persian: PERSIAN_CONSONANTS };

function vowelAt(rest: readonly string[]): readonly [number, Vowel] | null {
  const pair = rest.slice(0, 2).join('');
  const long =
    pair === 'aa' || pair === 'â'
      ? 'a'
      : pair === 'ee' || pair === 'ii'
        ? 'i'
        : pair === 'oo' || pair === 'uu' || pair === 'ou'
          ? 'u'
          : pair === 'ai' || pair === 'ay' || pair === 'ei' || pair === 'ey'
            ? 'y'
            : null;
  if (long) return [2, { long: true, ch: long }];
  const first = rest[0];
  if (first === 'a' || first === 'e') return [1, { long: false, ch: first }];
  if (first === 'â') return [1, { long: true, ch: 'a' }];
  if (first === 'i' || first === 'u' || first === 'o') return [1, { long: true, ch: first }];
  return null;
}

function abjadVowel(kind: Abjad, vowel: Vowel, initial: boolean, final: boolean, keepShortA: boolean): string {
  const { long, ch } = vowel;
  const iy = ch === 'i' || ch === 'y';
  switch (kind) {
    case 'Hebrew':
      if (!long) return initial ? 'א' : ch === 'a' && final ? 'ה' : keepShortA ? 'א' : '';
      if (ch === 'a') return 'א';
      if (iy) return initial ? 'אי' : 'י';
      return initial ? 'או' : 'ו';
    case 'Arabic':
      if (!long) return initial ? 'أ' : ch === 'a' && final ? 'ا' : final ? 'ي' : keepShortA ? 'ا' : '';
      if (ch === 'a') return initial ? 'آ' : 'ا';
      if (ch === 'i' && initial) return 'إي';
      if (iy) return 'ي';
      return initial ? 'أو' : 'و';
    default:
      if (!long) return initial ? 'ا' : ch === 'e' && final ? 'ه' : final ? 'ا' : ch === 'a' && keepShortA ? 'ا' : '';
      if (ch === 'a') return initial ? 'آ' : 'ا';
      if (iy) return initial ? 'ای' : 'ی';
      if (ch === 'o' && initial) return 'ا';
      if (ch === 'o' && !final) return '';
      return initial ? 'او' : 'و';
  }
}

const SUN_LETTERS = ['t', 'th', 'd', 'dh', 'r', 'z', 's', 'sh', 'S', 'D', 'T', 'Z', 'n'];

/** Length of a leading Arabic article: al- (el-), an assimilated one (ash-shams), or "al…". */
function arabicArticle(chars: readonly string[]): number | null {
  const first = chars[0];
  if (first !== 'a' && first !== 'e') return null;
  const hyphen = chars.indexOf('-');
  if (hyphen === 2 || hyphen === 3) {
    const consonant = chars.slice(1, hyphen);
    const after = chars.slice(hyphen + 1);
    const lam = consonant.length === 1 && consonant[0] === 'l';
    const sun = SUN_LETTERS.includes(consonant.join('')) && consonant.every((c, i) => after[i] === c);
    if ((lam || sun) && after.length > 0) return hyphen + 1;
  }
  return first === 'a' && chars.length > 2 && chars[1] === 'l' ? 2 : null;
}

/** `shortIU`: a single i, u or o inside a word is a short vowel and not written (عليكم). */
function abjad(word: string, kind: Abjad, keepShortA: boolean, shortIU: boolean): string {
  const chars = Array.from(word);
  const consonants = prepare(ABJAD_CONSONANTS[kind]);
  let out = '';
  let index = 0;
  let lastConsonant: string | null = null;
  // A long i or u written as ي / و already spells a following y or w (عربية, سیاه, هو).
  let lastVowelLetter: string | null = null;
  if (kind === 'Arabic') {
    const skip = arabicArticle(chars);
    if (skip !== null) {
      out += 'ال';
      index = skip;
      // Not a plain ل, so "allah" keeps its second lam.
      lastConsonant = 'ل-article';
    }
  }
  while (index < chars.length) {
    const initial = index === 0;
    const vowel = vowelAt(chars.slice(index));
    if (vowel) {
      const [count, v] = vowel;
      const final = index + count === chars.length;
      const short = shortIU && count === 1 && !initial && !final && v.long && (v.ch === 'i' || v.ch === 'u' || v.ch === 'o');
      const letter = short ? '' : abjadVowel(kind, v, initial, final, keepShortA);
      out += letter;
      lastConsonant = null;
      lastVowelLetter = letter === 'ي' || letter === 'ی' || letter === 'و' ? letter : null;
      index += count;
      continue;
    }
    const best = match(chars, index, consonants);
    if (best) {
      const [count, native] = best;
      // Doubled consonants are written once.
      const doubled = lastConsonant === native || (kind !== 'Hebrew' && lastVowelLetter === native);
      if (!doubled) out += native;
      lastConsonant = native;
      index += count;
    } else {
      out += chars[index];
      lastConsonant = null;
      index++;
    }
    lastVowelLetter = null;
  }
  return kind === 'Hebrew' ? hebrewFinalForms(out) : out;
}

/** Arabic feminine ending: a final short a after a consonant as ة. */
function taaMarbuta(word: string, converted: string): string | null {
  const lower = Array.from(word.toLowerCase());
  const n = lower.length;
  if (n < 3 || lower[n - 1] !== 'a' || 'aeiou-'.includes(lower[n - 2] as string) || !converted.endsWith('ا')) return null;
  const stem = converted.slice(0, -1);
  return stem ? `${stem}ة` : null;
}

const HEBREW_FINAL: Readonly<Record<string, string>> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' };

function hebrewFinalForms(text: string): string {
  const chars = Array.from(text);
  const last = chars[chars.length - 1];
  if (last !== undefined && HEBREW_FINAL[last]) chars[chars.length - 1] = HEBREW_FINAL[last] as string;
  return chars.join('');
}

const unique = (values: readonly (string | null)[]): string[] => {
  const result: string[] = [];
  for (const value of values) if (value && !result.includes(value)) result.push(value);
  return result;
};

/** Spellings of one word in a table-driven language, best first ([] for others). */
function tableCandidates(language: string, word: string): string[] {
  switch (language) {
    case 'el':
      return [greek(word)];
    case 'ru':
      return [semivowelAfterVowel(replace(word, RUSSIAN, true), 'ы', 'Ы')];
    case 'uk':
      return [semivowelAfterVowel(replace(word, UKRAINIAN, true), 'и', 'И')];
    case 'be':
      return [semivowelAfterVowel(replace(word, BELARUSIAN, true), 'ы', 'Ы')];
    case 'bg':
      return [semivowelAfterVowel(replace(word, BULGARIAN, true), 'ъ', 'Ъ')];
    case 'sr':
      return [replace(word, SERBIAN, true)];
    case 'mk':
      return [replace(word, MACEDONIAN, true)];
    case 'hy':
      return [armenian(word)];
    case 'ka':
      return [replace(word.toLowerCase(), GEORGIAN, false)];
    case 'he':
      return unique([abjad(word, 'Hebrew', false, false), abjad(word, 'Hebrew', true, false)]);
    case 'ar': {
      const plain = abjad(word, 'Arabic', false, false);
      const withA = abjad(word, 'Arabic', true, false);
      const short = abjad(word, 'Arabic', false, true);
      const marbuta = taaMarbuta(word, plain);
      // "-iya" / "-iyya" is almost always ية (عربية, حرية).
      const lower = word.toLowerCase();
      return lower.endsWith('iya') || lower.endsWith('iyya') ? unique([marbuta, plain, withA, short]) : unique([plain, withA, marbuta, short]);
    }
    case 'fa': {
      // Writers who double long vowels (salaam, mamnoon) mean a single "a" as the short,
      // unwritten vowel; otherwise a single "a" is usually the long ا (farsi, iran).
      const lower = word.toLowerCase();
      const marksLength = ['aa', 'ee', 'ii', 'oo', 'uu', 'â'].some((marker) => lower.includes(marker));
      return unique([abjad(word, 'Persian', !marksLength, false), abjad(word, 'Persian', marksLength, false)]);
    }
    default:
      return [];
  }
}

/* ------------------------------------------------------------------------ Korean -- */

const HANGUL_CONSONANT_LETTERS = new Set('gkndtrlmbpsjchfvz');
const SILENT_INITIAL = 11;
const MAX_KOREAN = 8;

const lookupNumber = (table: readonly (readonly [string, number])[], key: string): number | null => table.find(([token]) => token === key)?.[1] ?? null;
const hangulInitial = (cluster: string): number | null => (cluster ? lookupNumber(HANGUL_INITIALS, cluster) : SILENT_INITIAL);
const hangulFinal = (cluster: string): number | null => (cluster ? lookupNumber(HANGUL_FINALS, cluster) : 0);
const compose = (initial: number, vowel: number, final: number): string => char(0xac00 + (initial * 21 + vowel) * 28 + final);

interface Split {
  readonly final: number;
  readonly initial: number;
  readonly score: number;
}

/** The ways to share the consonants between two vowels, likeliest first. */
function splits(cluster: string): Split[] {
  const result: Split[] = [];
  for (let cut = 0; cut <= cluster.length; cut++) {
    const coda = cluster.slice(0, cut);
    const onset = cluster.slice(cut);
    const final = hangulFinal(coda);
    const initial = hangulInitial(onset);
    if (final === null || initial === null) continue;
    let score = (onset ? 20 : 0) + (coda ? 0 : 10);
    // Past-tense "-ss-eo" (있어, 했어) is far more common than an initial ㅆ.
    if (cluster === 'ss' && coda === 'ss') score += 40;
    // Short onsets win ties ("ngg" is ㅇ + ㄱ rather than ㄴ + ㄲ).
    score -= onset.length;
    result.push({ final, initial, score });
  }
  return result.sort((a, b) => b.score - a.score);
}

/** A lowercase segment as (consonants, vowel) pairs and the consonants after the last vowel. */
function parseKorean(segment: string): { pairs: [string, number][]; trailing: string } | null {
  const pairs: [string, number][] = [];
  let cluster = '';
  let offset = 0;
  while (offset < segment.length) {
    const vowel = longest(HANGUL_VOWELS, segment, offset);
    if (vowel) {
      pairs.push([cluster, vowel[1]]);
      cluster = '';
      offset += vowel[0].length;
      continue;
    }
    const ch = segment[offset] as string;
    if (!HANGUL_CONSONANT_LETTERS.has(ch)) return null;
    cluster += ch;
    offset++;
  }
  return pairs.length ? { pairs, trailing: cluster } : null;
}

function segmentCandidates(segment: string): [string, number][] | null {
  const parsed = parseKorean(segment);
  if (!parsed) return null;
  const { pairs, trailing } = parsed;
  const firstInitial = hangulInitial((pairs[0] as [string, number])[0]);
  const lastFinal = hangulFinal(trailing);
  if (firstInitial === null || lastFinal === null) return null;
  const options: Split[][] = [];
  for (const [cluster] of pairs.slice(1)) {
    const choices = splits(cluster);
    if (!choices.length) return null;
    options.push(choices);
  }
  let results: [number[], number][] = [[[], 0]];
  for (const choices of options) {
    const next: [number[], number][] = [];
    for (const [path, score] of results) {
      choices.slice(0, 3).forEach((choice, index) => {
        next.push([[...path, index], score + choice.score]);
      });
    }
    next.sort((a, b) => b[1] - a[1]);
    results = next.slice(0, MAX_KOREAN * 2);
  }
  return results.map(([path, score]) => {
    let text = '';
    pairs.forEach(([, vowel], position) => {
      const onset = position === 0 ? firstInitial : ((options[position - 1] as Split[])[path[position - 1] as number] as Split).initial;
      const coda = position + 1 === pairs.length ? lastFinal : ((options[position] as Split[])[path[position] as number] as Split).final;
      text += compose(onset, vowel, coda);
    });
    return [text, score];
  });
}

/** Hangul spellings of a romanized word, likeliest first; [] when it is not romanized Korean. */
export function hangulCandidates(word: string): string[] {
  const segments = word
    .toLowerCase()
    .split(/[-']/)
    .filter((segment) => segment);
  if (!segments.length) return [];
  let combined: [string, number][] = [['', 0]];
  for (const segment of segments) {
    const options = segmentCandidates(segment);
    if (!options) return [];
    const next: [string, number][] = [];
    for (const [prefix, score] of combined) for (const [text, extra] of options.slice(0, 4)) next.push([prefix + text, score + extra]);
    next.sort((a, b) => b[1] - a[1]);
    combined = next.slice(0, MAX_KOREAN);
  }
  return unique(combined.map(([text]) => text));
}

/* --------------------------------------------------------------- Vietnamese Telex -- */

const VI_VOWELS = new Set(['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y']);
const VI_MARKED = new Set(['ă', 'â', 'ê', 'ô', 'ơ', 'ư']);
const isViVowel = (ch: string | undefined): boolean => ch !== undefined && VI_VOWELS.has(ch);
const VI_TONES: Readonly<Record<string, number>> = { s: 0x301, f: 0x300, r: 0x309, x: 0x303, j: 0x323 };
const VI_INITIALS = ['', 'b', 'c', 'ch', 'd', 'đ', 'g', 'gh', 'gi', 'h', 'k', 'kh', 'l', 'm', 'n', 'ng', 'ngh', 'nh', 'p', 'ph', 'qu', 'r', 's', 't', 'th', 'tr', 'v', 'x'];
const VI_FINALS = ['', 'c', 'ch', 'm', 'n', 'ng', 'nh', 'p', 't'];
const VI_NUCLEI = [
  'a',
  'ă',
  'â',
  'e',
  'ê',
  'i',
  'o',
  'ô',
  'ơ',
  'u',
  'ư',
  'y',
  'ai',
  'ao',
  'au',
  'ay',
  'âu',
  'ây',
  'eo',
  'êu',
  'ia',
  'iê',
  'iu',
  'oa',
  'oă',
  'oe',
  'oi',
  'ôi',
  'ơi',
  'oo',
  'ua',
  'uâ',
  'uê',
  'ui',
  'uô',
  'uơ',
  'ưa',
  'ưi',
  'ươ',
  'ưu',
  'uy',
  'yê',
  'iêu',
  'yêu',
  'oai',
  'oay',
  'oeo',
  'uây',
  'uôi',
  'ươi',
  'ươu',
  'uya',
  'uyê',
  'uyu',
];

function lastIndexWhere(letters: readonly string[], test: (ch: string) => boolean): number {
  for (let i = letters.length - 1; i >= 0; i--) if (test(letters[i] as string)) return i;
  return -1;
}

/** (start, end) of the vowels when the letters form a Vietnamese syllable. */
function viSyllable(letters: readonly string[]): readonly [number, number] | null {
  const text = letters.join('');
  let initial: number | null = null;
  for (const candidate of VI_INITIALS) {
    const count = Array.from(candidate).length;
    if (text.startsWith(candidate) && isViVowel(letters[count]) && !(initial !== null && count <= initial)) initial = count;
  }
  if (initial === null) return null;
  let end = initial;
  while (end < letters.length && isViVowel(letters[end])) end++;
  const nucleus = letters.slice(initial, end).join('');
  const coda = letters.slice(end).join('');
  return VI_NUCLEI.includes(nucleus) && VI_FINALS.includes(coda) ? [initial, end] : null;
}

function tonePosition(letters: readonly string[], start: number, end: number): number {
  const nucleus = letters.slice(start, end);
  const horn = nucleus.indexOf('ơ');
  if (horn >= 0) return start + horn;
  const marked = nucleus.findIndex((ch) => VI_MARKED.has(ch));
  if (marked >= 0) return start + marked;
  if (nucleus.length <= 1) return start;
  if (nucleus.length === 2) return end < letters.length ? start + 1 : start;
  return start + 1;
}

/** One word typed in Telex (tieengs → tiếng); null when it is not a Vietnamese syllable. */
export function telex(word: string): string | null {
  const letters: string[] = [];
  const upper: boolean[] = [];
  let tone = '';
  let changed = false;
  const push = (key: string, isUpper: boolean) => {
    letters.push(key);
    upper.push(isUpper);
  };
  for (const raw of word) {
    if (!ASCII_LETTER.test(raw)) return null;
    const key = raw.toLowerCase();
    const isUpper = raw !== key;
    const hasVowel = letters.some((ch) => isViVowel(ch));
    if (key === 'a' || key === 'e' || key === 'o') {
      const hat = key === 'a' ? 'â' : key === 'e' ? 'ê' : 'ô';
      const position = lastIndexWhere(letters, (ch) => ch === key || ch === hat);
      if (position >= 0) {
        const tail = letters.slice(position + 1);
        const inNucleus = tail.every((ch) => !isViVowel(ch)) || tail.every((ch) => isViVowel(ch));
        if (inNucleus && letters[position] === key) {
          letters[position] = hat;
          changed = true;
          continue;
        }
        if (inNucleus && letters[position] === hat) {
          letters[position] = key;
          push(key, isUpper);
          continue;
        }
      }
      push(key, isUpper);
    } else if (key === 'w') {
      let uo = -1;
      for (let i = letters.length - 2; i >= 0; i--) {
        if (letters[i] === 'u' && letters[i + 1] === 'o') {
          uo = i;
          break;
        }
      }
      if (uo >= 0) {
        letters[uo] = 'ư';
        letters[uo + 1] = 'ơ';
        changed = true;
        continue;
      }
      const index = lastIndexWhere(letters, (ch) => ['a', 'o', 'u', 'ă', 'ơ', 'ư'].includes(ch));
      if (index < 0) {
        push('ư', isUpper);
        changed = true;
        continue;
      }
      const current = letters[index];
      if (current === 'a') letters[index] = 'ă';
      else if (current === 'o') letters[index] = 'ơ';
      else if (current === 'u') letters[index] = 'ư';
      else {
        // Typing the modifier again undoes it.
        letters[index] = current === 'ă' ? 'a' : current === 'ơ' ? 'o' : 'u';
        push('w', isUpper);
        continue;
      }
      changed = true;
    } else if (key === 'd' && letters.length === 1 && letters[0] === 'd') {
      letters[0] = 'đ';
      changed = true;
    } else if (key === 'd' && letters.length === 1 && letters[0] === 'đ') {
      letters[0] = 'd';
      push('d', isUpper);
    } else if (key === 'z' && tone) {
      tone = '';
      changed = true;
    } else if (hasVowel && VI_TONES[key] !== undefined) {
      if (tone === key) {
        tone = '';
        push(key, isUpper);
      } else {
        tone = key;
        changed = true;
      }
    } else push(key, isUpper);
  }
  const syllable = viSyllable(letters);
  if (!syllable) return null;
  if (!changed && !tone) return word;
  const toneAt = tonePosition(letters, syllable[0], syllable[1]);
  let out = '';
  letters.forEach((ch, index) => {
    let piece = ch;
    if (index === toneAt && tone) piece += char(VI_TONES[tone] as number);
    piece = piece.normalize('NFC');
    out += upper[index] ? piece.toUpperCase() : piece;
  });
  return out.normalize('NFC');
}

/* -------------------------------------------------------------- Ge'ez and Ol Chiki -- */

const GLOTTAL = 0x12a0;
const ETHIOPIC_STANDALONE: readonly (readonly [string, number])[] = [
  ['aa', 3],
  ['ie', 4],
  ['E', 4],
  ['a', 0],
  ['u', 1],
  ['i', 2],
  ['e', 5],
  ['I', 5],
  ['o', 6],
];

/** Labialized "-wa" syllables that are not at offset 7 of their row. */
function labialized(base: number): number | null {
  switch (base) {
    case 0x1240:
      return 0x124b;
    case 0x1250:
      return 0x125b;
    case 0x1280:
      return 0x128b;
    case 0x12a8:
      return 0x12b3;
    case 0x12b8:
      return 0x12c3;
    case 0x1308:
      return 0x1313;
    case 0x1200:
    case 0x12c8:
    case 0x12d0:
    case 0x12e8:
    case 0x1340:
      return null;
    default:
      return base + 7;
  }
}

/** One romanized Amharic or Tigrinya word in Ge'ez syllables (selam → ሰላም). */
export function ethiopic(word: string): string {
  let out = '';
  let offset = 0;
  while (offset < word.length) {
    const consonant = longest(ETHIOPIC_CONSONANTS, word, offset);
    if (consonant) {
      const [token, base] = consonant;
      offset += token.length;
      // Doubled consonants are written once.
      if (word.startsWith(token, offset) && longest(ETHIOPIC_CONSONANTS, word, offset)?.[0] === token) continue;
      if (word.startsWith('wa', offset)) {
        const syllable = labialized(base);
        if (syllable !== null) {
          out += char(syllable);
          offset += 2;
          continue;
        }
      }
      const vowel = longest(ETHIOPIC_VOWELS, word, offset);
      if (vowel) {
        out += char(base + vowel[1]);
        offset += vowel[0].length;
      } else out += char(base + 5);
      continue;
    }
    // Vowels on their own use the glottal-stop row.
    const standalone = ETHIOPIC_STANDALONE.find(([token]) => word.startsWith(token, offset));
    if (standalone) {
      out += char(GLOTTAL + standalone[1]);
      offset += standalone[0].length;
      continue;
    }
    const ch = char(word.codePointAt(offset) ?? 0x20);
    out += ch;
    offset += ch.length;
  }
  return out;
}

/** One romanized Santali word in Ol Chiki (santaRi → ᱥᱟᱱᱛᱟᱲᱤ). */
export function olChiki(word: string): string {
  let out = '';
  let offset = 0;
  while (offset < word.length) {
    const entry = longest(OL_CHIKI, word, offset);
    if (entry) {
      out += entry[1];
      offset += entry[0].length;
      continue;
    }
    const ch = char(word.codePointAt(offset) ?? 0x20);
    out += ch;
    offset += ch.length;
  }
  return out;
}

/* ---------------------------------------------------------------------- languages -- */

/** How a language's Roman letters are turned into its script. */
export type TypingEngine = 'exact' | 'rules' | 'keyboard';

/** The writing system of the result (fonts, digits, punctuation and direction). */
export type OutputScript = IndicScript | 'Arabic' | 'Nastaliq' | 'Hebrew' | 'Greek' | 'Cyrillic' | 'Armenian' | 'Georgian' | 'Hangul' | 'Latin' | 'Thai' | 'Ethiopic' | 'OlChiki' | 'MeeteiMayek';

export interface TypingLanguage {
  readonly id: string;
  readonly name: string;
  readonly native: string;
  readonly group: string;
  /** On-screen keyboard layout. */
  readonly keyboard: string;
  readonly engine: TypingEngine;
  readonly script: OutputScript;
  readonly rtl: boolean;
  /** Roman input to try. */
  readonly example: string;
  /** The typing scheme in a line. */
  readonly note: string;
}

const EXACT_NOTE = 'ITRANS / IAST, case-sensitive: aa A = आ · ii I = ई · T Th D Dh N = retroflex · sh = श · Sh = ष · ~n = ञ · M = ं · H = ः · .h = ् (virama) · {braces} keep English';
const DRAVIDIAN_NOTE = `${EXACT_NOTE} · e o short, E O long`;
const KEYBOARD_NOTE = 'Type with the on-screen keyboard or your system’s keyboard layout; the text is kept as typed.';

const indian = (id: string, name: string, native: string, keyboard: string, script: IndicScript, example: string): TypingLanguage => ({
  id,
  name,
  native,
  group: 'Indian languages',
  keyboard,
  engine: 'exact',
  script,
  rtl: false,
  example,
  note: script === 'Tamil' || script === 'Telugu' || script === 'Kannada' || script === 'Malayalam' ? DRAVIDIAN_NOTE : EXACT_NOTE,
});

const rules = (id: string, name: string, native: string, group: string, keyboard: string, script: OutputScript, example: string, note: string, rtl = false): TypingLanguage => ({
  id,
  name,
  native,
  group,
  keyboard,
  engine: 'rules',
  script,
  rtl,
  example,
  note,
});

const keyboardOnly = (id: string, name: string, native: string, keyboard: string, script: OutputScript, rtl: boolean): TypingLanguage => ({
  id,
  name,
  native,
  group: 'Indian languages',
  keyboard,
  engine: 'keyboard',
  script,
  rtl,
  example: '',
  note: KEYBOARD_NOTE,
});

export const TYPING_LANGUAGES: readonly TypingLanguage[] = [
  indian('hi', 'Hindi', 'हिन्दी', 'devanagari', 'Devanagari', 'namaste, meraa naam abhiShT hai'),
  indian('mr', 'Marathi', 'मराठी', 'devanagari', 'Devanagari', 'namaskaar, tumhii kase aahaat'),
  indian('ne', 'Nepali', 'नेपाली', 'devanagari', 'Devanagari', 'namaste, mero naam'),
  indian('sa', 'Sanskrit', 'संस्कृतम्', 'devanagari', 'Devanagari', 'vasudhaiva kuTumbakam'),
  indian('mai', 'Maithili', 'मैथिली', 'devanagari', 'Devanagari', 'praNaam'),
  indian('brx', 'Bodo', 'बड़ो', 'devanagari', 'Devanagari', 'baRo'),
  indian('gom', 'Konkani', 'कोंकणी', 'devanagari', 'Devanagari', 'koMkaNii'),
  indian('doi', 'Dogri', 'डोगरी', 'devanagari', 'Devanagari', 'Dogarii'),
  indian('bn', 'Bengali', 'বাংলা', 'bengali', 'Bengali', 'aamaar sonaar baaMlaa'),
  indian('as', 'Assamese', 'অসমীয়া', 'assamese', 'Assamese', 'asam, guvaahaaTii'),
  indian('gu', 'Gujarati', 'ગુજરાતી', 'gujarati', 'Gujarati', 'kem chho'),
  indian('pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'gurmukhi', 'Gurmukhi', 'sat srii akaal'),
  indian('or', 'Odia', 'ଓଡ଼ିଆ', 'odia', 'Odia', 'namaskaar'),
  indian('ta', 'Tamil', 'தமிழ்', 'tamil', 'Tamil', 'vaNakkam.h'),
  indian('te', 'Telugu', 'తెలుగు', 'telugu', 'Telugu', 'namaskaaraM'),
  indian('kn', 'Kannada', 'ಕನ್ನಡ', 'kannada', 'Kannada', 'namaskaara, hEgiddIri'),
  indian('ml', 'Malayalam', 'മലയാളം', 'malayalam', 'Malayalam', 'namaskaaraM'),
  indian('si', 'Sinhala', 'සිංහල', 'sinhala', 'Sinhala', 'aayubovan.h'),
  rules(
    'sat',
    'Santali (Ol Chiki)',
    'ᱥᱟᱱᱛᱟᱲᱤ',
    'Indian languages',
    'olchiki',
    'OlChiki',
    'johar, santaRi',
    'Ol Chiki: a ᱟ · o ᱚ · O ᱳ · e ᱮ · T D N R = retroflex · kh gh … = aspirates · ~ = nasal · | = ᱾',
  ),
  keyboardOnly('ur', 'Urdu', 'اردو', 'perso_arabic', 'Nastaliq', true),
  keyboardOnly('ks', 'Kashmiri', 'کٲشُر', 'perso_arabic', 'Nastaliq', true),
  keyboardOnly('sd', 'Sindhi', 'سنڌي', 'perso_arabic', 'Arabic', true),
  keyboardOnly('mni', 'Manipuri (Meetei Mayek)', 'ꯃꯤꯇꯩꯂꯣꯟ', 'meetei', 'MeeteiMayek', false),
  rules('ko', 'Korean', '한국어', 'East Asia', 'korean', 'Hangul', 'annyeonghaseyo, saranghae', 'Revised Romanization (eo, eu, ae, ya …); a - or ’ splits syllables: jung-ang = 중앙.'),
  rules(
    'vi',
    'Vietnamese (Telex)',
    'Tiếng Việt',
    'Southeast Asia',
    'vietnamese',
    'Latin',
    'xin chaof, tieengs Vieetj',
    'Telex: aa â · aw ă · ee ê · oo ô · ow ơ · uw ư · dd đ · tones s f r x j · z clears.',
  ),
  { ...keyboardOnly('th', 'Thai', 'ไทย', 'thai', 'Thai', false), group: 'Southeast Asia' },
  rules('ar', 'Arabic', 'العربية', 'Middle East', 'arabic', 'Arabic', 'mar7aba, salaam', 'Arabizi: 7 ح · 3 ع · 2 ء · 5 خ · H S D T Z = emphatics · aa = ا. Short a is not written.', true),
  rules('fa', 'Persian', 'فارسی', 'Middle East', 'persian', 'Arabic', 'salaam, khaane', 'Finglish: aa ا · kh خ · gh غ · sh ش · ch چ · zh ژ · final e ه.', true),
  rules('he', 'Hebrew', 'עברית', 'Middle East', 'hebrew', 'Hebrew', 'shalom, toda', 't ת · T ט · k כ · q ק · ch ח · sh ש · tz צ · 3 ע; final letters are automatic.', true),
  rules('ru', 'Russian', 'Русский', 'Europe and the Caucasus', 'cyrillic', 'Cyrillic', 'privet, kak dela', 'zh ж · kh х · ts ц · ch ч · sh ш · shch щ · ya я · yu ю · yo ё · e’ э · ’ ь · ’’ ъ'),
  rules('uk', 'Ukrainian', 'Українська', 'Europe and the Caucasus', 'ukrainian', 'Cyrillic', 'dyakuyu, Kyjiv', 'y и · i і · ji ї · je є · h г · g ґ · ’ ь · ` apostrophe'),
  rules('be', 'Belarusian', 'Беларуская', 'Europe and the Caucasus', 'belarusian', 'Cyrillic', 'dzyakuj, Minsk', 'y ы · i і · w ў · h г · eh э · ’ ь · ` apostrophe'),
  rules('bg', 'Bulgarian', 'Български', 'Europe and the Caucasus', 'cyrillic', 'Cyrillic', 'zdravei, Bylgariya', 'y ъ · sht щ · zh ж · ch ч · sh ш · ya я · yu ю'),
  rules('sr', 'Serbian', 'Српски', 'Europe and the Caucasus', 'serbian', 'Cyrillic', 'zdravo, Beograd', 'Latinica → ћирилица: č ć š ž đ dž lj nj (or ch cj sh zh dj dzh).'),
  rules('mk', 'Macedonian', 'Македонски', 'Europe and the Caucasus', 'macedonian', 'Cyrillic', 'zdravo, Makedonija', 'gj ѓ · kj ќ · dz ѕ · lj љ · nj њ · dzh џ · j ј'),
  rules('el', 'Greek', 'Ελληνικά', 'Europe and the Caucasus', 'greek', 'Greek', "kalhme'ra, Athina", 'th θ · ch χ · ps ψ · h η · w ω · x ξ · ’ after a vowel adds a tonos · final σ → ς'),
  rules('hy', 'Armenian', 'Հայերեն', 'Europe and the Caucasus', 'armenian', 'Armenian', 'barev, Hayastan', 'y յ · u ու · ev և · gh ղ · kh խ · rr ռ · t’ p’ k’ = aspirates · @ ը'),
  rules('ka', 'Georgian', 'ქართული', 'Europe and the Caucasus', 'georgian', 'Georgian', 'gamarjoba, sakartvelo', 'k ქ · k’ კ · t თ · t’ ტ · p ფ · p’ პ · q ყ · ts ც · ts’ წ · ch ჩ · ch’ ჭ'),
  rules('am', 'Amharic', 'አማርኛ', 'Africa', 'ethiopic', 'Ethiopic', 'selam, amarnya', 'e ä · u · i · a · ie é · o; a consonant alone takes the 6th order. T C P S = ejectives.'),
  rules('ti', 'Tigrinya', 'ትግርኛ', 'Africa', 'ethiopic', 'Ethiopic', 'selam, tgrnya', 'e ä · u · i · a · ie é · o; a consonant alone takes the 6th order. Q = ቐ, K = ኸ.'),
];

export const typingLanguage = (id: string): TypingLanguage => TYPING_LANGUAGES.find((l) => l.id === id) ?? (TYPING_LANGUAGES[0] as TypingLanguage);

const isIndic = (script: OutputScript): script is IndicScript => (INDIC_SCRIPTS as readonly string[]).includes(script);

/* ---------------------------------------------------------------------- tokenizing -- */

type WordKind = 'none' | 'ascii' | 'letters';

interface WordRule {
  readonly kind: WordKind;
  /** Allowed inside a word when a letter follows. */
  readonly inner: string;
  /** Allowed right after a letter, also at a word's end. */
  readonly trailing: string;
  /** Digits count as letters next to a Roman letter (Arabizi 7abibi). */
  readonly digits: boolean;
}

const rule = (kind: WordKind, inner = '', trailing = '', digits = false): WordRule => ({ kind, inner, trailing, digits });

function wordRule(language: TypingLanguage): WordRule {
  if (language.engine === 'exact') return rule('letters', ".~^'_", '~');
  if (language.engine === 'keyboard') return rule('none');
  switch (language.id) {
    case 'ko':
      return rule('letters', "-'");
    case 'vi':
    case 'am':
    case 'ti':
      return rule('ascii');
    case 'sat':
      return rule('ascii', '~', '~');
    case 'ar':
      return rule('letters', "'-", '', true);
    case 'fa':
    case 'he':
      return rule('letters', "'", '', true);
    case 'ru':
      return rule('letters', '\'"', '\'"');
    case 'uk':
    case 'be':
      return rule('letters', "'`", "'`");
    case 'el':
    case 'bg':
    case 'ka':
      return rule('letters', "'", "'");
    case 'hy':
      return rule('letters', "'@", "'");
    default:
      return rule('letters');
  }
}

export type TokenKind = 'word' | 'text' | 'protected';

export interface Token {
  readonly kind: TokenKind;
  /** As typed (a protected span with its braces). */
  readonly text: string;
  /** What is kept of a protected span (without braces). */
  readonly inner: string;
}

const isCombining = (ch: string): boolean => {
  const c = code(ch);
  return between(c, 0x0300, 0x036f) || between(c, 0x1ab0, 0x1aff) || between(c, 0x1dc0, 0x1dff);
};

function isBaseLetter(r: WordRule, ch: string | undefined): boolean {
  if (ch === undefined || r.kind === 'none') return false;
  if (r.kind === 'ascii') return isAsciiLetter(ch);
  return ALPHABETIC.test(ch) || isCombining(ch);
}

const LINK_PREFIXES = ['http://', 'https://', 'ftp://', 'file://', 'mailto:', 'www.'];
const LINK_END = new Set(['{', '}', '<', '>', '"']);
const LINK_TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', "'"]);
const EMAIL_LOCAL = /^[A-Za-z0-9._%+-]+$/;

/** Length (in characters) of a web address or e-mail address starting at `start`. */
function linkLength(chars: readonly string[], start: number): number | null {
  let end = start;
  while (end < chars.length && !isWhite(chars[end] as string) && !LINK_END.has(chars[end] as string)) end++;
  const chunk = chars.slice(start, end);
  const text = chunk.join('');
  const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const url = LINK_PREFIXES.some((prefix) => lower.startsWith(prefix) && text.length > prefix.length);
  const at = text.indexOf('@');
  const email = at > 0 && text.slice(at + 1).includes('.') && EMAIL_LOCAL.test(text.slice(0, at));
  if (!url && !email) return null;
  let length = chunk.length;
  while (length > 0 && LINK_TRAILING.has(chunk[length - 1] as string)) length--;
  return length > 0 ? length : null;
}

function startsWord(r: WordRule, chars: readonly string[], index: number): boolean {
  const ch = chars[index] as string;
  if (r.kind === 'none' || isCombining(ch)) return false;
  if (isBaseLetter(r, ch)) return true;
  if (r.digits && isAsciiDigit(ch)) return isAsciiLetter(chars[index + 1]);
  // ITRANS marks such as ".D" or "~N" may begin a word.
  return r.inner.includes(ch) && (ch === '.' || ch === '~') && isAsciiLetter(chars[index + 1]);
}

function continuesWord(r: WordRule, chars: readonly string[], index: number): boolean {
  const ch = chars[index] as string;
  const next = chars[index + 1];
  if (isBaseLetter(r, ch)) return true;
  if (r.digits && isAsciiDigit(ch)) return isAsciiLetter(chars[index - 1]) || isAsciiLetter(next);
  if (
    r.inner.includes(ch) &&
    next !== undefined &&
    // Arabizi digit letters too: al-3arabiya.
    (isBaseLetter(r, next) || r.inner.includes(next) || (r.digits && isAsciiDigit(next) && isAsciiLetter(chars[index + 2])))
  )
    return true;
  return r.trailing.includes(ch);
}

/**
 * Splits Roman input into words to convert, text to keep, and protected spans that are never
 * converted: {anything} (the braces are dropped; {{ gives {), web and e-mail addresses.
 */
function tokenize(input: string, r: WordRule): Token[] {
  const chars = Array.from(input);
  const tokens: Token[] = [];
  const pushText = (text: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === 'text') tokens[tokens.length - 1] = { kind: 'text', text: last.text + text, inner: last.inner + text };
    else tokens.push({ kind: 'text', text, inner: text });
  };
  let index = 0;
  while (index < chars.length) {
    const ch = chars[index] as string;
    if (ch === '{') {
      if (chars[index + 1] === '{') {
        tokens.push({ kind: 'protected', text: '{{', inner: '{' });
        index += 2;
        continue;
      }
      let close = index + 1;
      while (close < chars.length && chars[close] !== '}' && chars[close] !== '\n') close++;
      const closed = chars[close] === '}';
      // An unclosed brace protects the rest of the line while you type.
      tokens.push({ kind: 'protected', text: chars.slice(index, closed ? close + 1 : close).join(''), inner: chars.slice(index + 1, close).join('') });
      index = closed ? close + 1 : close;
      continue;
    }
    if (index === 0 || isWhite(chars[index - 1] as string)) {
      const length = linkLength(chars, index);
      if (length !== null) {
        const text = chars.slice(index, index + length).join('');
        tokens.push({ kind: 'protected', text, inner: text });
        index += length;
        continue;
      }
    }
    if (startsWord(r, chars, index)) {
      const start = index;
      index++;
      while (index < chars.length && continuesWord(r, chars, index)) index++;
      const text = chars.slice(start, index).join('');
      tokens.push({ kind: 'word', text, inner: text });
      continue;
    }
    pushText(ch);
    index++;
  }
  return tokens;
}

/* ------------------------------------------------------------- words and whole texts -- */

const DRAVIDIAN = new Set<OutputScript>(['Tamil', 'Telugu', 'Kannada', 'Malayalam']);

/** Spellings of one Roman word in a language, best first (the word itself when none). */
export function wordCandidates(languageId: string, word: string): string[] {
  const language = typingLanguage(languageId);
  let found: (string | null)[];
  if (language.engine === 'exact' && isIndic(language.script)) {
    found = [fromDevanagari(itransToDevanagari(word, language.id === 'sa', DRAVIDIAN.has(language.script)), language.script)];
  } else if (language.engine === 'keyboard') found = [];
  else if (language.id === 'ko') found = hangulCandidates(word);
  else if (language.id === 'vi') found = [telex(word)];
  else if (language.id === 'am' || language.id === 'ti') found = [ethiopic(word)];
  else if (language.id === 'sat') found = [olChiki(word)];
  else found = tableCandidates(language.id, word);
  const result = found.filter((candidate): candidate is string => !!candidate);
  return result.length ? result : [word];
}

const DIGIT_ZERO: Readonly<Partial<Record<OutputScript, number>>> = {
  Devanagari: 0x0966,
  Bengali: 0x09e6,
  Assamese: 0x09e6,
  Gurmukhi: 0x0a66,
  Gujarati: 0x0ae6,
  Odia: 0x0b66,
  Tamil: 0x0be6,
  Telugu: 0x0c66,
  Kannada: 0x0ce6,
  Malayalam: 0x0d66,
  Thai: 0x0e50,
  OlChiki: 0x1c50,
  MeeteiMayek: 0xabf0,
};

function digitZero(language: TypingLanguage): number | null {
  if (language.id === 'ar') return 0x0660;
  if (['fa', 'ur', 'ks', 'sd'].includes(language.id)) return 0x06f0;
  return DIGIT_ZERO[language.script] ?? null;
}

/** Whether the language has its own digits to use instead of 0–9. */
export const hasNativeDigits = (languageId: string): boolean => digitZero(typingLanguage(languageId)) !== null;

/** Punctuation (and, if asked, digits) of the text between words, in the script's own forms. */
export function punctuate(languageId: string, text: string, nativeDigits: boolean): string {
  const language = typingLanguage(languageId);
  const script = language.script;
  const zero = nativeDigits ? digitZero(language) : null;
  const chars = Array.from(text);
  let out = '';
  for (let index = 0; index < chars.length; index++) {
    const ch = chars[index] as string;
    const next = chars[index + 1];
    const betweenDigits = isAsciiDigit(chars[index - 1]) && isAsciiDigit(next);
    let mapped: string | null = null;
    if (isIndic(script) && ch === '|') {
      if (next === '|') {
        index++;
        mapped = '॥';
      } else mapped = '।';
    } else if (script === 'OlChiki' && ch === '|') {
      if (next === '|') {
        index++;
        mapped = '᱿';
      } else mapped = '᱾';
    } else if (script === 'MeeteiMayek' && ch === '|') mapped = '꯫';
    else if ((script === 'Arabic' || script === 'Nastaliq') && (ch === ',' || ch === '?' || ch === ';')) mapped = ch === ',' ? '،' : ch === '?' ? '؟' : '؛';
    else if (script === 'Nastaliq' && ch === '.' && !betweenDigits && language.id === 'ur') mapped = '۔';
    else if (script === 'Ethiopic' && ch === '.' && !betweenDigits) mapped = '።';
    else if (script === 'Ethiopic' && ch === ',') mapped = '፣';
    else if (script === 'Ethiopic' && ch === ';') mapped = '፤';
    else if (script === 'Greek' && ch === '?') mapped = ';';
    else if (script === 'Armenian' && ch === '.' && !betweenDigits) mapped = '։';
    if (mapped !== null) out += mapped;
    else if (zero !== null && isAsciiDigit(ch)) out += char(zero + code(ch) - 48);
    else out += ch;
  }
  return out;
}

/** A converted piece of text; a word with more than one spelling lists them all. */
export interface Converted {
  readonly kind: TokenKind;
  /** The Roman text as typed. */
  readonly source: string;
  readonly output: string;
  readonly options: readonly string[];
}

export interface TypingOptions {
  /** Use the script's digits instead of 0–9. */
  readonly nativeDigits?: boolean;
  /** Spellings chosen for words before (Roman word → spelling). */
  readonly choices?: Readonly<Record<string, string>>;
}

/** Roman text in a language's script, piece by piece (for showing other spellings). */
export function transliterateParts(text: string, languageId: string, options: TypingOptions = {}): Converted[] {
  const language = typingLanguage(languageId);
  return tokenize(text, wordRule(language)).map((token) => {
    if (token.kind === 'protected') return { kind: token.kind, source: token.text, output: token.inner, options: [] };
    if (token.kind === 'text') return { kind: token.kind, source: token.text, output: punctuate(language.id, token.text, options.nativeDigits ?? false), options: [] };
    const candidates = wordCandidates(language.id, token.text);
    const chosen = options.choices?.[token.text];
    const output = chosen !== undefined && candidates.includes(chosen) ? chosen : (candidates[0] as string);
    return { kind: token.kind, source: token.text, output, options: candidates.length > 1 ? candidates : [] };
  });
}

/** Roman text in a language's script (ITRANS for the Indian ones, Telex for Vietnamese…). */
export function transliterate(text: string, languageId: string, options: TypingOptions = {}): string {
  return transliterateParts(text, languageId, options)
    .map((part) => part.output)
    .join('');
}

/* ---------------------------------------------------------------------- keyboards -- */

export const KEYBOARDS: readonly KeyboardLayout[] = LAYOUTS;

/** The on-screen keys for a language: its letters, then its vowel signs and marks. */
export function keyboardFor(languageId: string): { readonly layout: KeyboardLayout | null; readonly marks: readonly string[] } {
  const id = typingLanguage(languageId).keyboard;
  return { layout: LAYOUTS.find((l) => l.id === id) ?? null, marks: MARK_KEYS[id] ?? [] };
}
