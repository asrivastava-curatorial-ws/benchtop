/**
 * Magic: tries the decoding operations whose input patterns match the data,
 * recursively, and ranks what comes out by how much it looks like text in
 * English, a known file type or the crib you give.
 */
import { type Args, bArg, bytesToLatin1, nArg, type Operation, sArg, toBytes } from './core';
import { detectFileType } from './filetypes';

export interface Catalog {
  get(id: string): Operation | undefined;
  readonly all: readonly Operation[];
}

export interface MagicStep {
  readonly op: string;
  readonly args: Args;
}

export interface MagicSuggestion {
  readonly recipe: readonly MagicStep[];
  readonly preview: string;
  readonly fileType: string | null;
  readonly entropy: number;
  /** Share of characters that are printable text, 0–1. */
  readonly printable: number;
  /** How closely the letters match English letter frequencies, 0–1. */
  readonly english: number;
  readonly matchesCrib: boolean;
  readonly score: number;
}

const ENGLISH = [8.167, 1.492, 2.782, 4.253, 12.702, 2.228, 2.015, 6.094, 6.966, 0.153, 0.772, 4.025, 2.406, 6.749, 7.507, 1.929, 0.095, 5.987, 6.327, 9.056, 2.758, 0.978, 2.36, 0.15, 1.974, 0.074];

export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Array<number>(256).fill(0);
  for (const byte of bytes) counts[byte] = (counts[byte] ?? 0) + 1;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function printableShare(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 8192));
  let good = 0;
  let total = 0;
  for (const ch of text) {
    total++;
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd) continue;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127) || (code >= 160 && /\p{L}|\p{N}|\p{P}|\p{Zs}/u.test(ch))) good++;
  }
  return total === 0 ? 0 : good / total;
}

/** Share of whitespace-separated tokens that look like words (letters with a vowel), scaled down when there are no spaces. */
function wordiness(text: string, anyScript = false): number {
  const sample = text.slice(0, 20000);
  const tokens = sample.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const shape = anyScript ? /^["'([«„]?\p{L}[\p{Ll}\p{M}'-]{0,24}[.,!?;:'")\]»“]*$/u : /^["'([]?[A-Za-z][a-z'-]{0,15}[.,!?;:'")\]]*$/;
  const vowel = anyScript ? /[aeiouyàáâäãåèéêëìíîïòóôöõùúûüæœ]|[^\p{Script=Latin}]/iu : /[aeiouy]/i;
  const words = tokens.filter((t) => shape.test(t) && vowel.test(t)).length;
  return (words / tokens.length) * (tokens.length > 1 ? 1 : 0.3);
}

/** 1 for text that reads like English (letter frequencies and word shapes), falling towards 0 for anything else. */
export function englishScore(text: string, anyScript = false): number {
  return anyScript ? Math.max(0.5 * letterScore(text) + 0.5 * wordiness(text), wordiness(text, true) * 0.9) : 0.5 * letterScore(text) + 0.5 * wordiness(text);
}

function letterScore(text: string): number {
  const counts = new Array<number>(26).fill(0);
  let letters = 0;
  let spaces = 0;
  for (let i = 0; i < Math.min(text.length, 20000); i++) {
    const code = text.charCodeAt(i) | 32;
    if (code >= 97 && code <= 122) {
      counts[code - 97] = (counts[code - 97] ?? 0) + 1;
      letters++;
    } else if (code === 32) spaces++;
  }
  if (letters < 6) return 0;
  let chi = 0;
  for (let i = 0; i < 26; i++) {
    const expected = ((ENGLISH[i] ?? 0) / 100) * letters;
    chi += ((counts[i] ?? 0) - expected) ** 2 / expected;
  }
  // Normalise by sample size so short and long texts compare fairly.
  const perLetter = chi / letters;
  const letterShare = letters / Math.min(text.length, 20000);
  const spacing = spaces > 0 ? 1 : 0.7;
  return Math.max(0, Math.min(1, Math.exp(-perLetter * 1.5) * Math.min(1, letterShare * 1.6) * spacing));
}

function isUtf8Text(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 65536));
    return true;
  } catch {
    return false;
  }
}

function cribMatcher(crib: string): ((text: string) => boolean) | null {
  if (crib === '') return null;
  try {
    const regex = new RegExp(crib, 'i');
    return (text) => regex.test(text);
  } catch {
    const lower = crib.toLowerCase();
    return (text) => text.toLowerCase().includes(lower);
  }
}

function previewOf(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 600));
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what the preview hides
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\uFFFD]/g, '.').slice(0, 200);
}

function keyOf(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ (bytes[i] ?? 0), 16777619);
  return `${bytes.length}:${hash >>> 0}`;
}

interface Candidate {
  readonly op: Operation;
  readonly args: Args;
}

function candidates(sample: string, catalog: Catalog, intensive: boolean): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const op of catalog.all) {
    for (const hint of op.magic ?? []) {
      hint.pattern.lastIndex = 0;
      if (!hint.pattern.test(sample)) continue;
      const args = { ...defaults(op), ...(hint.args ?? {}) };
      const id = `${op.id}${JSON.stringify(args)}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ op, args });
      }
    }
  }
  if (intensive) {
    for (const id of ['rot13', 'rot47', 'atbash-cipher', 'reverse']) {
      const op = catalog.get(id);
      if (op) out.push({ op, args: defaults(op) });
    }
    const xor = catalog.get('xor');
    if (xor) {
      // Single-byte keys that would turn the most common byte into a space or "e".
      const bytes = toBytes(sample);
      const counts = new Array<number>(256).fill(0);
      for (const byte of bytes) counts[byte] = (counts[byte] ?? 0) + 1;
      const common = counts.indexOf(Math.max(...counts));
      for (const target of [0x20, 0x65, 0x00]) {
        const key = (common ^ target).toString(16).padStart(2, '0');
        if (key !== '00') out.push({ op: xor, args: { ...defaults(xor), key, 'key.format': 'Hex' } });
      }
    }
  }
  return out;
}

function defaults(op: Operation): Args {
  const args: Args = {};
  for (const arg of op.args) {
    args[arg.key] = arg.default;
    if (arg.type === 'keyed') args[`${arg.key}.format`] = arg.format;
  }
  return args;
}

export async function magic(input: Uint8Array, args: Args, catalog: Catalog): Promise<MagicSuggestion[]> {
  const depth = Math.max(0, Math.min(6, Math.round(nArg(args, 'depth'))));
  const intensive = bArg(args, 'intensive');
  const anyScript = bArg(args, 'extensive');
  const crib = cribMatcher(sArg(args, 'crib'));
  const found = new Map<string, MagicSuggestion>();
  let budget = 400;

  const visit = async (data: Uint8Array, recipe: MagicStep[], level: number): Promise<void> => {
    const key = keyOf(data);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data.subarray(0, 20000));
    const type = detectFileType(data);
    const printable = printableShare(data);
    const english = englishScore(text, anyScript);
    const matchesCrib = crib ? crib(text) : false;
    // A recognised file is a strong signal, but an archive or compressed stream is only a step on the way: what it unpacks to should rank higher.
    const container = type !== null && /Gzip|Bzip2|XZ|7-Zip|RAR|Zstandard|LZ4|Zlib|ZIP|Tar/.test(type.name);
    const textual = printable >= 0.95 && isUtf8Text(data);
    const score = (type ? (container ? 25 : 55) : 0) + printable * 30 + (textual ? 20 : 0) + english * 70 + (matchesCrib ? 120 : 0) - recipe.length * 3;
    const previous = found.get(key);
    if (!previous || previous.recipe.length > recipe.length) {
      found.set(key, { recipe, preview: previewOf(data), fileType: type?.name ?? null, entropy: shannonEntropy(data), printable, english, matchesCrib, score });
    } else if (previous) return;
    if (level >= depth || budget <= 0 || data.length === 0) return;
    const sample = bytesToLatin1(data.subarray(0, 65536)).replace(/\s+$/, '');
    for (const candidate of candidates(sample, catalog, intensive && level === 0)) {
      if (--budget <= 0) break;
      try {
        const value = candidate.op.input === 'text' ? new TextDecoder('utf-8', { fatal: false }).decode(data) : data;
        const result = await candidate.op.run(value as never, candidate.args, { registers: [] });
        const out = toBytes(typeof result === 'string' || result instanceof Uint8Array ? result : result.value);
        if (out.length === 0 || keyOf(out) === key) continue;
        await visit(out, [...recipe, { op: candidate.op.id, args: candidate.args }], level + 1);
      } catch {
        // A decoder that fails on this data is simply not a match.
      }
    }
  };

  await visit(input, [], 0);
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 25);
}

export function renderSuggestions(suggestions: readonly MagicSuggestion[], catalog?: Catalog): string {
  if (suggestions.length === 0) return 'Magic found nothing to try.';
  return suggestions
    .map((s, i) => {
      const recipe = s.recipe.length === 0 ? '(input as it is)' : s.recipe.map((step) => catalog?.get(step.op)?.name ?? step.op).join(' → ');
      const facts = [
        s.fileType ? `file: ${s.fileType}` : '',
        `English ${Math.round(s.english * 100)}%`,
        `printable ${Math.round(s.printable * 100)}%`,
        `entropy ${s.entropy.toFixed(2)}`,
        s.matchesCrib ? 'matches crib' : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `${i + 1}. ${recipe}\n   ${facts}\n   ${s.preview}`;
    })
    .join('\n\n');
}
