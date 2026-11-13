/** Text utilities: statistics, slugs, placeholder text and line sorting. */

import { randomInt } from './bytes';
import { ToolError } from './errors';
import { graphemes, seededRandom } from './text';

/* ------------------------------------------------------------------ stats -- */

export interface TextStats {
  readonly characters: number;
  readonly charactersNoSpaces: number;
  readonly words: number;
  readonly sentences: number;
  readonly paragraphs: number;
  readonly lines: number;
  readonly bytes: number;
  readonly readingMinutes: number;
  readonly speakingMinutes: number;
  readonly topWords: readonly [string, number][];
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;

export function textStats(text: string, topCount = 10): TextStats {
  const chars = graphemes(text);
  const words = text.match(WORD) ?? [];
  const sentenceSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null;
  const sentences = sentenceSegmenter ? [...sentenceSegmenter.segment(text)].filter((s) => /[\p{L}\p{N}]/u.test(s.segment)).length : (text.match(/[^.!?]+[.!?]+/g) ?? []).length;
  const counts = new Map<string, number>();
  for (const word of words) {
    const key = word.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    characters: chars.length,
    charactersNoSpaces: chars.filter((c) => !/^\s+$/u.test(c)).length,
    words: words.length,
    sentences,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim() !== '').length,
    lines: text === '' ? 0 : text.split(/\r\n|\r|\n/).length,
    bytes: new TextEncoder().encode(text).length,
    // Typical adult rates: about 238 words a minute reading silently, 150 speaking.
    readingMinutes: words.length / 238,
    speakingMinutes: words.length / 150,
    topWords: [...counts]
      .filter(([word]) => word.length > 3)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topCount),
  };
}

export function formatDuration(minutes: number): string {
  const seconds = Math.round(minutes * 60);
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/* ------------------------------------------------------------------- slug -- */

const SPECIAL: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
  œ: 'oe',
  Œ: 'OE',
  đ: 'd',
  Đ: 'D',
  ł: 'l',
  Ł: 'L',
  þ: 'th',
  Þ: 'Th',
  ð: 'd',
  '&': ' and ',
  '@': ' at ',
  '%': ' percent ',
};

export interface SlugOptions {
  readonly separator: string;
  readonly lowercase: boolean;
  readonly maxLength: number;
  /** Keep non-Latin letters (Devanagari, Cyrillic...) instead of dropping them. */
  readonly keepUnicode: boolean;
}

export function slugify(text: string, options: SlugOptions): string {
  let value = [...text].map((c) => SPECIAL[c] ?? c).join('');
  // Accents are dropped for Latin-only slugs; other scripts need their vowel signs and viramas.
  value = options.keepUnicode
    ? value.normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    : value
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[^A-Za-z0-9]+/g, ' ');
  let slug = value.trim().split(/\s+/).filter(Boolean).join(options.separator);
  if (options.lowercase) slug = slug.toLocaleLowerCase();
  if (options.maxLength > 0 && slug.length > options.maxLength) {
    slug = slug.slice(0, options.maxLength);
    // Prefer cutting at a separator so words stay whole.
    const cut = options.separator ? slug.lastIndexOf(options.separator) : -1;
    if (cut > options.maxLength / 2) slug = slug.slice(0, cut);
  }
  return slug;
}

/* ------------------------------------------------------------------ lorem -- */

const LOREM_WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus nunc pulvinar sapien ligula viverra mauris aenean faucibus tellus orci luctus porta pellentesque habitant morbi tristique senectus netus malesuada fames ac turpis egestas vestibulum ante primis faucibus integer quam vitae justo eget magna fermentum iaculis'.split(
    ' ',
  );

const CLASSIC = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
const CLASSIC_WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit'.split(' ');

export interface LoremOptions {
  readonly unit: 'paragraphs' | 'sentences' | 'words';
  readonly count: number;
  /** Begin with the familiar "Lorem ipsum dolor sit amet..." */
  readonly classicStart: boolean;
  readonly html: boolean;
  /** Fixed seed for repeatable output (tests); random otherwise. */
  readonly seed?: number;
}

export function lorem(options: LoremOptions): string {
  const random = options.seed === undefined ? () => randomInt(1_000_000) / 1_000_000 : seededRandom(options.seed);
  const pick = (n: number) => Array.from({ length: n }, () => LOREM_WORDS[Math.floor(random() * LOREM_WORDS.length)] as string);
  const capital = (text: string) => `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
  const sentence = () => {
    const words = pick(6 + Math.floor(random() * 10));
    // A comma in about half of the longer sentences.
    if (words.length > 8 && random() < 0.5) words[3 + Math.floor(random() * 3)] += ',';
    return `${capital(words.join(' '))}.`;
  };
  const count = Math.max(1, Math.min(options.unit === 'words' ? 5000 : 500, Math.round(options.count)));
  let blocks: string[];
  if (options.unit === 'words') {
    const words = options.classicStart ? [...CLASSIC_WORDS, ...pick(count)].slice(0, count) : pick(count);
    blocks = [`${capital(words.join(' '))}.`];
  } else if (options.unit === 'sentences') {
    const sentences = Array.from({ length: count }, sentence);
    if (options.classicStart) sentences[0] = CLASSIC;
    blocks = [sentences.join(' ')];
  } else {
    blocks = Array.from({ length: count }, (_, index) => {
      const sentences = Array.from({ length: 4 + Math.floor(random() * 4) }, sentence);
      if (index === 0 && options.classicStart) sentences[0] = CLASSIC;
      return sentences.join(' ');
    });
  }
  return options.html ? `${blocks.map((block) => `<p>${block}</p>`).join('\n')}\n` : `${blocks.join('\n\n')}\n`;
}

/* ------------------------------------------------------------ line sorting -- */

export type SortMode = 'alpha' | 'natural' | 'numeric' | 'length' | 'reverse' | 'shuffle';

export interface SortOptions {
  readonly mode: SortMode;
  readonly descending: boolean;
  readonly caseSensitive: boolean;
  readonly unique: boolean;
  readonly trim: boolean;
  readonly removeEmpty: boolean;
}

export function sortLines(text: string, options: SortOptions): string {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (options.trim) lines = lines.map((line) => line.trim());
  if (options.removeEmpty) lines = lines.filter((line) => line.trim() !== '');
  if (options.unique) {
    const seen = new Set<string>();
    lines = lines.filter((line) => {
      const key = options.caseSensitive ? line : line.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const collator = new Intl.Collator(undefined, { numeric: options.mode === 'natural', sensitivity: options.caseSensitive ? 'variant' : 'accent' });
  const number = (line: string) => {
    const match = /-?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?/i.exec(line);
    return match ? Number(match[0].replace(',', '.')) : Number.NaN;
  };
  switch (options.mode) {
    case 'alpha':
    case 'natural':
      lines.sort(collator.compare);
      break;
    case 'numeric':
      lines.sort((a, b) => {
        const x = number(a);
        const y = number(b);
        if (Number.isNaN(x) && Number.isNaN(y)) return collator.compare(a, b);
        if (Number.isNaN(x)) return 1;
        if (Number.isNaN(y)) return -1;
        return x - y || collator.compare(a, b);
      });
      break;
    case 'length':
      lines.sort((a, b) => a.length - b.length || collator.compare(a, b));
      break;
    case 'reverse':
      lines.reverse();
      break;
    case 'shuffle':
      for (let i = lines.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [lines[i], lines[j]] = [lines[j] as string, lines[i] as string];
      }
      break;
    default:
      throw new ToolError(`Unknown sort mode "${options.mode}".`);
  }
  if (options.descending && options.mode !== 'reverse' && options.mode !== 'shuffle') lines.reverse();
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
