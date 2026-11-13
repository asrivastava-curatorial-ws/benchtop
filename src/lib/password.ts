/** Random passwords and passphrases from the system's cryptographic random source. */
import { randomInt } from './bytes';
import { ToolError } from './errors';

export interface PasswordOptions {
  readonly length: number;
  readonly lower: boolean;
  readonly upper: boolean;
  readonly digits: boolean;
  readonly symbols: boolean;
  /** Leave out characters that are easy to confuse: 0 O o 1 l I | ` ' " */
  readonly avoidAmbiguous: boolean;
  /** Extra characters to exclude. */
  readonly exclude?: string;
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!#$%&()*+,-./:;<=>?@[]^_{}~',
} as const;

const AMBIGUOUS = new Set('0Oo1lI|`\'"');

function pool(options: PasswordOptions): string[] {
  const excluded = new Set(options.exclude ?? '');
  const groups: string[] = [];
  for (const key of ['lower', 'upper', 'digits', 'symbols'] as const) {
    if (!options[key]) continue;
    const chars = [...SETS[key]].filter((c) => !excluded.has(c) && !(options.avoidAmbiguous && AMBIGUOUS.has(c))).join('');
    if (chars) groups.push(chars);
  }
  if (groups.length === 0) throw new ToolError('Choose at least one kind of character.');
  return groups;
}

/** A password with at least one character from every chosen group, shuffled without bias. */
export function generatePassword(options: PasswordOptions): string {
  const groups = pool(options);
  if (options.length < groups.length) throw new ToolError(`A password with ${groups.length} kinds of character needs at least ${groups.length} characters.`);
  const all = groups.join('');
  const chars = groups.map((group) => group[randomInt(group.length)] as string);
  while (chars.length < options.length) chars.push(all[randomInt(all.length)] as string);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}

/** Entropy in bits of a password drawn uniformly from a pool of the given size. */
export const entropyBits = (poolSize: number, length: number): number => (poolSize > 1 ? length * Math.log2(poolSize) : 0);

export function passwordPoolSize(options: PasswordOptions): number {
  return pool(options).join('').length;
}

export function generatePassphrase(words: readonly string[], count: number, separator: string, capitalize: boolean, addNumber: boolean): string {
  if (words.length < 2) throw new ToolError('The word list is empty.');
  const picked = Array.from({ length: count }, () => {
    const word = words[randomInt(words.length)] as string;
    return capitalize ? `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}` : word;
  });
  if (addNumber) picked.push(String(randomInt(100)));
  return picked.join(separator);
}

export function strengthLabel(bits: number): { label: string; tone: 'bad' | 'warn' | 'ok' } {
  if (bits < 50) return { label: 'Weak: guessable with modest effort', tone: 'bad' };
  if (bits < 72) return { label: 'Fair: fine for online accounts with rate limits', tone: 'warn' };
  if (bits < 100) return { label: 'Strong', tone: 'ok' };
  return { label: 'Very strong', tone: 'ok' };
}
