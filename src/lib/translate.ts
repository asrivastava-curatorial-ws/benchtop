/**
 * Text translation through a translation server on this computer: IndicTrans2
 * (English and the 22 scheduled languages of India) or any OpenAI-compatible
 * chat server (Ollama, LM Studio, llama.cpp).  Pure functions: cutting a text
 * into pieces a model handles well, keeping its layout, and putting the
 * translation back together; subtitles keep their timing.
 */
import { LANGUAGES, type Language, parseSubtitles, toSrt, toVtt } from './dubbing';

/** Every language offered: the dubbing list, the other scheduled languages of India, then more of the world's. */
export const TRANSLATION_LANGUAGES: readonly Language[] = [
  ...LANGUAGES.map((l) => (l.code === 'zh' ? { ...l, name: 'Chinese (Mandarin, simplified)' } : l)),
  { code: 'brx', name: 'Bodo', iso3: 'brx', flores: 'brx_Deva' },
  { code: 'doi', name: 'Dogri', iso3: 'doi', flores: 'doi_Deva' },
  { code: 'ks', name: 'Kashmiri', iso3: 'kas', flores: 'kas_Arab' },
  { code: 'mni', name: 'Manipuri (Meitei script)', iso3: 'mni', flores: 'mni_Mtei' },
  { code: 'sat', name: 'Santali', iso3: 'sat', flores: 'sat_Olck' },
  { code: 'sd', name: 'Sindhi', iso3: 'snd', flores: 'snd_Arab' },
  { code: 'zh-hant', name: 'Chinese (traditional)', iso3: 'chi', flores: 'zho_Hant' },
  { code: 'ko', name: 'Korean', iso3: 'kor', flores: 'kor_Hang' },
  { code: 'pt', name: 'Portuguese', iso3: 'por', flores: 'por_Latn' },
  { code: 'it', name: 'Italian', iso3: 'ita', flores: 'ita_Latn' },
  { code: 'nl', name: 'Dutch', iso3: 'dut', flores: 'nld_Latn' },
  { code: 'pl', name: 'Polish', iso3: 'pol', flores: 'pol_Latn' },
  { code: 'uk', name: 'Ukrainian', iso3: 'ukr', flores: 'ukr_Cyrl' },
  { code: 'el', name: 'Greek', iso3: 'gre', flores: 'ell_Grek' },
  { code: 'tr', name: 'Turkish', iso3: 'tur', flores: 'tur_Latn' },
  { code: 'fa', name: 'Persian', iso3: 'per', flores: 'pes_Arab' },
  { code: 'he', name: 'Hebrew', iso3: 'heb', flores: 'heb_Hebr' },
  { code: 'sw', name: 'Swahili', iso3: 'swa', flores: 'swh_Latn' },
  { code: 'th', name: 'Thai', iso3: 'tha', flores: 'tha_Thai' },
  { code: 'vi', name: 'Vietnamese', iso3: 'vie', flores: 'vie_Latn' },
  { code: 'id', name: 'Indonesian', iso3: 'ind', flores: 'ind_Latn' },
  { code: 'ms', name: 'Malay', iso3: 'may', flores: 'zsm_Latn' },
  { code: 'si', name: 'Sinhala', iso3: 'sin', flores: 'sin_Sinh' },
  { code: 'my', name: 'Burmese', iso3: 'bur', flores: 'mya_Mymr' },
  { code: 'km', name: 'Khmer', iso3: 'khm', flores: 'khm_Khmr' },
  { code: 'bo', name: 'Tibetan', iso3: 'tib', flores: 'bod_Tibt' },
];

export const translationLanguage = (code: string): Language => TRANSLATION_LANGUAGES.find((l) => l.code === code) ?? { code, name: code, iso3: 'und', flores: '' };

/** The languages IndicTrans2 translates between (English and India's scheduled languages). */
const INDIC = new Set(['en', 'hi', 'kn', 'ta', 'te', 'ml', 'bn', 'mr', 'gu', 'pa', 'or', 'as', 'ur', 'ne', 'sa', 'kok', 'mai', 'brx', 'doi', 'ks', 'mni', 'sat', 'sd']);
export const indicTransKnows = (code: string): boolean => INDIC.has(code);

/** Of the languages offered, those M2M-100 knows. */
const M2M = new Set([
  'en',
  'hi',
  'kn',
  'ta',
  'ml',
  'bn',
  'mr',
  'gu',
  'pa',
  'or',
  'ur',
  'ne',
  'sd',
  'fr',
  'de',
  'es',
  'ja',
  'zh',
  'zh-hant',
  'ar',
  'ru',
  'ko',
  'pt',
  'it',
  'nl',
  'pl',
  'uk',
  'el',
  'tr',
  'fa',
  'he',
  'sw',
  'th',
  'vi',
  'id',
  'ms',
  'si',
  'my',
  'km',
]);

/** Translation models the app can download and run on this computer, besides IndicTrans2. */
export interface TranslationModel {
  readonly key: string;
  readonly name: string;
  readonly languages: string;
  readonly size: string;
  readonly licence: string;
  readonly note?: string;
}

export const MODEL_CATALOGUE: readonly TranslationModel[] = [
  {
    key: 'm2m100-418m',
    name: 'M2M-100 (418M)',
    languages: '100 languages to and from each other: Arabic, Chinese, Japanese, Korean, Russian, European languages, Hindi, Bengali, Tamil, Kannada and more',
    size: 'about 1.9 GB',
    licence: 'MIT',
  },
  {
    key: 'nllb-200-600m',
    name: 'NLLB-200 (distilled 600M)',
    languages: '200 languages to and from each other, usually the best of these',
    size: 'about 2.5 GB',
    licence: 'CC BY-NC 4.0',
    note: 'Non-commercial licence: fine for study, research and free exhibits; check before using it for paid work.',
  },
  {
    key: 'madlad400-3b',
    name: 'MADLAD-400 (3B)',
    languages: 'over 400 languages to and from each other',
    size: 'about 11.8 GB, slow without a graphics card, needs about 16 GB of memory',
    licence: 'Apache 2.0',
  },
];

/** Whether a model run here knows a language (chat models and your own models are trusted to). */
export function modelKnows(model: string, code: string): boolean {
  if (model === 'indictrans2') return INDIC.has(code);
  if (model === 'm2m100-418m') return M2M.has(code);
  return true;
}

export const modelName = (model: string): string =>
  model === 'indictrans2' ? 'IndicTrans2' : (MODEL_CATALOGUE.find((m) => m.key === model)?.name ?? (model.startsWith('hf:') ? model.slice(3) : model));

/* ------------------------------------------------------------- detection -- */

const SCRIPTS: readonly [code: string, from: number, to: number][] = [
  ['hi', 0x0900, 0x097f],
  ['bn', 0x0980, 0x09ff],
  ['pa', 0x0a00, 0x0a7f],
  ['gu', 0x0a80, 0x0aff],
  ['or', 0x0b00, 0x0b7f],
  ['ta', 0x0b80, 0x0bff],
  ['te', 0x0c00, 0x0c7f],
  ['kn', 0x0c80, 0x0cff],
  ['ml', 0x0d00, 0x0d7f],
  ['sat', 0x1c50, 0x1c7f],
  ['mni', 0xabc0, 0xabff],
  ['si', 0x0d80, 0x0dff],
  ['th', 0x0e00, 0x0e7f],
  ['bo', 0x0f00, 0x0fff],
  ['my', 0x1000, 0x109f],
  ['km', 0x1780, 0x17ff],
  ['ar', 0x0600, 0x06ff],
  ['he', 0x0590, 0x05ff],
  ['el', 0x0370, 0x03ff],
  ['ru', 0x0400, 0x04ff],
  ['ko', 0xac00, 0xd7af],
  ['ja', 0x3040, 0x30ff],
  ['zh', 0x4e00, 0x9fff],
  ['en', 0x0041, 0x007a],
];

/**
 * The language a text is most likely in, from the script most of its letters
 * are written in (Devanagari is read as Hindi, Latin as English, Arabic as Urdu
 * when it has Urdu's own letters).  Null when there are no letters.
 */
export function detectLanguage(text: string): string | null {
  const counts = new Map<string, number>();
  let seen = 0;
  for (const char of text) {
    if (seen > 4000) break;
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0x5b && cp <= 0x60) continue;
    const hit = SCRIPTS.find(([, from, to]) => cp >= from && cp <= to);
    if (!hit) continue;
    seen++;
    counts.set(hit[0], (counts.get(hit[0]) ?? 0) + 1);
  }
  if (!counts.size) return null;
  let best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (best === 'zh' && counts.has('ja')) best = 'ja';
  if (best === 'ar' && /[\u0679\u0688\u0691\u06ba\u06be\u06c1\u06d2]/.test(text)) best = 'ur';
  else if (best === 'ar' && /[\u067e\u0686\u0698\u06af\u06cc\u06a9]/.test(text)) best = 'fa';
  return best;
}

/* ------------------------------------------------------- cutting a text -- */

export type Slot = { readonly keep: string } | { readonly piece: number };

export interface Plan {
  /** The pieces to translate, in order. */
  readonly pieces: readonly string[];
  /** The text as kept parts and pieces, to put back together. */
  readonly slots: readonly Slot[];
}

/** List markers, headings and quotes stay as they are; only the words after them are translated. */
const LEAD = /^(\s*(?:[-*+•▪◦]\s+|\d{1,3}[.)]\s+|[a-z][.)]\s+|#{1,6}\s+|>\s+)?)/i;
const ENDS = new Set(['.', '!', '?', '।', '॥', '۔', '。', '！', '？']);

/** Sentences of a long line, each with the space after it, so nothing is lost when they are joined again. */
export function sentences(text: string): { text: string; space: string }[] {
  const out: { text: string; space: string }[] = [];
  const chars = Array.from(text);
  let current = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    current += c;
    const next = chars[i + 1];
    if (!ENDS.has(c) || (next !== undefined && !/\s/.test(next))) continue;
    let space = '';
    while (i + 1 < chars.length && /\s/.test(chars[i + 1] as string)) {
      i++;
      space += chars[i];
    }
    out.push({ text: current, space });
    current = '';
  }
  if (current) out.push({ text: current, space: '' });
  return out;
}

/** Cuts a piece longer than `max` characters at spaces (for sentences too long for one go). */
function wrap(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^ /, '');
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Cuts a text into pieces to translate: one per line, with lines longer than
 * `max` characters cut into sentences.  Blank lines, indentation, list
 * markers and headings stay where they are.
 */
export function plan(text: string, max = 240): Plan {
  const pieces: string[] = [];
  const slots: Slot[] = [];
  const keep = (s: string) => {
    if (!s) return;
    const last = slots[slots.length - 1];
    if (last && 'keep' in last) slots[slots.length - 1] = { keep: last.keep + s };
    else slots.push({ keep: s });
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, n) => {
    if (n > 0) keep('\n');
    const lead = LEAD.exec(line)?.[1] ?? '';
    const body = line.slice(lead.length);
    const trail = /\s*$/.exec(body)?.[0] ?? '';
    const words = body.slice(0, body.length - trail.length);
    keep(lead);
    if (!/\p{L}/u.test(words)) {
      keep(words);
    } else if (words.length <= max) {
      slots.push({ piece: pieces.length });
      pieces.push(words);
    } else {
      for (const s of sentences(words)) {
        for (const [k, part] of wrap(s.text, Math.max(max, 120)).entries()) {
          if (k > 0) keep(' ');
          slots.push({ piece: pieces.length });
          pieces.push(part);
        }
        keep(s.space);
      }
    }
    keep(trail);
  });
  return { pieces, slots };
}

/** Puts a planned text back together with its translated pieces (an untranslated piece keeps its original). */
export function rebuild(p: Plan, translated: readonly string[]): string {
  return p.slots.map((s) => ('keep' in s ? s.keep : ((translated[s.piece]?.trim() || p.pieces[s.piece]) ?? ''))).join('');
}

/* ------------------------------------------------------------- subtitles -- */

/** Whether a text is SubRip or WebVTT subtitles. */
export function subtitleFormat(text: string): 'srt' | 'vtt' | null {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('WEBVTT')) return 'vtt';
  if (/^\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(t)) return 'srt';
  return null;
}

/** The cue texts of subtitles, and a way to write them back translated with the same times. */
export function subtitlePlan(text: string): { pieces: string[]; write: (translated: readonly string[]) => string } | null {
  const format = subtitleFormat(text);
  if (!format) return null;
  const lines = parseSubtitles(text);
  if (!lines.length) return null;
  return {
    pieces: lines.map((l) => l.text),
    write: (translated) => {
      const done = lines.map((l, i) => ({ ...l, translation: translated[i]?.trim() || l.text }));
      return format === 'vtt' ? toVtt(done, 'translation') : toSrt(done, 'translation');
    },
  };
}

/* --------------------------------------------------------------- requests -- */

/** The request to an OpenAI-compatible chat server for a batch of pieces (IndicTrans2's server reads the `benchtop` part). */
export function translationRequest(model: string, pieces: readonly string[], from: Language | null, to: Language, context: string): object {
  const source = from ? from.name : 'the language it is written in';
  return {
    model,
    benchtop: { lines: pieces, from: from?.flores || 'eng_Latn', to: to.flores },
    temperature: 0.2,
    stream: false,
    messages: [
      {
        role: 'system',
        content: `You translate text from ${source} into ${to.name}. Keep the meaning, names, numbers and punctuation; write natural ${to.name}; translate every item and add no notes or explanations.${context ? ` Context: ${context}` : ''}`,
      },
      {
        role: 'user',
        content: `Translate each item of this JSON array into ${to.name}. Reply with only a JSON array of the translated strings, in the same order, with exactly ${pieces.length} items.\n\n${JSON.stringify(pieces)}`,
      },
    ],
  };
}

/**
 * Translates pieces a batch at a time with `ask` (one request); a batch whose
 * answer lost its shape is asked again a piece at a time.  `onProgress` gets
 * the pieces translated so far; stops between batches when `stopped()` says so.
 */
export async function translatePieces(
  pieces: readonly string[],
  ask: (batch: string[]) => Promise<string[] | null>,
  onProgress: (done: number, translated: readonly string[]) => void = () => {},
  stopped: () => boolean = () => false,
  batch = 16,
): Promise<string[]> {
  const out = [...pieces].map(() => '');
  for (let i = 0; i < pieces.length; i += batch) {
    if (stopped()) throw new Error('Stopped.');
    const chunk = pieces.slice(i, i + batch);
    let answer = await ask(chunk);
    if (!answer || answer.length !== chunk.length) {
      answer = [];
      for (const piece of chunk) {
        if (stopped()) throw new Error('Stopped.');
        answer.push((await ask([piece]))?.[0] ?? '');
      }
    }
    answer.forEach((t, k) => {
      out[i + k] = t;
    });
    onProgress(Math.min(pieces.length, i + chunk.length), out);
  }
  return out;
}
