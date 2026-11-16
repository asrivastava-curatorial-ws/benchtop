import { randomBytes, toHex } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Values } from '../types';

/** Uniform random integer in [min, max] from the secure generator (rejection sampling, no modulo bias). */
export function randomBetween(min: number, max: number): number {
  const range = max - min + 1;
  if (range <= 0 || !Number.isSafeInteger(range)) throw new ToolError('The range is empty or too large.');
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if ((buffer[0] as number) < limit) return min + ((buffer[0] as number) % range);
  }
}

const isPrime = (n: number): boolean => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};

const show =
  (...kinds: string[]) =>
  (v: Values) =>
    kinds.includes(String(v.kind));

export default defineTextTool({
  input: false,
  output: { label: 'Results' },
  options: [
    {
      key: 'kind',
      label: 'Generate',
      type: 'select',
      choices: [
        { value: 'integer', label: 'Whole numbers' },
        { value: 'decimal', label: 'Decimal numbers' },
        { value: 'prime', label: 'Prime numbers' },
        { value: 'string', label: 'Random strings' },
        { value: 'hex', label: 'Hex strings' },
        { value: 'pick', label: 'Pick from a list' },
        { value: 'shuffle', label: 'Shuffle a list' },
        { value: 'teams', label: 'Split a list into groups' },
        { value: 'ipv4', label: 'IPv4 addresses' },
        { value: 'ipv6', label: 'IPv6 addresses' },
        { value: 'port', label: 'Free-range ports (49152–65535)' },
        { value: 'date', label: 'Dates' },
        { value: 'colour', label: 'Colours' },
        { value: 'dice', label: 'Dice rolls' },
        { value: 'coin', label: 'Coin flips' },
      ],
      default: 'integer',
    },
    { key: 'count', label: 'How many', type: 'number', default: 10, min: 1, max: 100000, step: 1, showIf: (v) => !['shuffle', 'teams'].includes(String(v.kind)) },
    { key: 'min', label: 'From', type: 'number', default: 1, step: 1, showIf: show('integer', 'decimal', 'prime') },
    { key: 'max', label: 'To', type: 'number', default: 100, step: 1, showIf: show('integer', 'decimal', 'prime') },
    { key: 'decimals', label: 'Decimal places', type: 'number', default: 2, min: 1, max: 12, step: 1, showIf: show('decimal') },
    { key: 'unique', label: 'No repeats', type: 'toggle', default: false, showIf: show('integer', 'prime', 'pick') },
    { key: 'length', label: 'Length', type: 'number', default: 16, min: 1, max: 1024, step: 1, showIf: show('string', 'hex') },
    { key: 'charset', label: 'Characters', type: 'text', default: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', mono: true, wide: true, showIf: show('string') },
    { key: 'list', label: 'Items (one per line)', type: 'text', default: 'Engines\nSpace\nElectricity\nKids\nBiotech\nScience on a Sphere', multiline: true, showIf: show('pick', 'shuffle', 'teams') },
    { key: 'groups', label: 'Groups', type: 'number', default: 2, min: 2, max: 100, step: 1, showIf: show('teams') },
    { key: 'from', label: 'Earliest date', type: 'text', default: '2020-01-01', mono: true, showIf: show('date') },
    { key: 'to', label: 'Latest date', type: 'text', default: '2030-12-31', mono: true, showIf: show('date') },
    { key: 'sides', label: 'Sides', type: 'number', default: 6, min: 2, max: 1000, step: 1, showIf: show('dice') },
    { key: 'sort', label: 'Sort the results', type: 'toggle', default: false, showIf: show('integer', 'decimal', 'prime', 'date') },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    const count = Math.min(100000, Math.max(1, Math.trunc(o.count)));
    const items = o.list
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const shuffle = <T>(array: T[]): T[] => {
      for (let i = array.length - 1; i > 0; i--) {
        const j = randomBetween(0, i);
        [array[i], array[j]] = [array[j] as T, array[i] as T];
      }
      return array;
    };
    let out: (string | number)[] = [];
    switch (o.kind) {
      case 'integer':
      case 'prime': {
        const [low, high] = [Math.ceil(Math.min(o.min, o.max)), Math.floor(Math.max(o.min, o.max))];
        const pool = o.kind === 'prime' ? Array.from({ length: Math.min(2_000_000, high - low + 1) }, (_, i) => low + i).filter(isPrime) : null;
        if (pool && pool.length === 0) throw new ToolError('There are no primes in that range.');
        if (o.unique && count > (pool ? pool.length : high - low + 1)) throw new ToolError('The range has fewer distinct values than you asked for.');
        const seen = new Set<number>();
        while (out.length < count) {
          const value = pool ? (pool[randomBetween(0, pool.length - 1)] as number) : randomBetween(low, high);
          if (o.unique && seen.has(value)) continue;
          seen.add(value);
          out.push(value);
        }
        break;
      }
      case 'decimal':
        out = Array.from({ length: count }, () => (Math.min(o.min, o.max) + (randomBetween(0, 2 ** 31) / 2 ** 31) * Math.abs(o.max - o.min)).toFixed(o.decimals));
        break;
      case 'string': {
        const chars = [...o.charset];
        if (chars.length === 0) throw new ToolError('Enter the characters to choose from.');
        out = Array.from({ length: count }, () => Array.from({ length: o.length }, () => chars[randomBetween(0, chars.length - 1)]).join(''));
        break;
      }
      case 'hex':
        out = Array.from({ length: count }, () => toHex(randomBytes(Math.ceil(o.length / 2))).slice(0, o.length));
        break;
      case 'pick':
        if (items.length === 0) throw new ToolError('Enter some items to pick from.');
        if (o.unique && count > items.length) throw new ToolError(`The list has only ${items.length} items.`);
        out = o.unique ? shuffle([...items]).slice(0, count) : Array.from({ length: count }, () => items[randomBetween(0, items.length - 1)] as string);
        break;
      case 'shuffle':
        out = shuffle([...items]);
        break;
      case 'teams': {
        const shuffled = shuffle([...items]);
        const groups: string[][] = Array.from({ length: o.groups }, () => []);
        for (const [index, item] of shuffled.entries()) groups[index % o.groups]?.push(item);
        out = groups.map((group, index) => `Group ${index + 1}: ${group.join(', ')}`);
        break;
      }
      case 'ipv4':
        out = Array.from({ length: count }, () => [randomBetween(1, 223), randomBetween(0, 255), randomBetween(0, 255), randomBetween(1, 254)].join('.'));
        break;
      case 'ipv6':
        out = Array.from({ length: count }, () => `2001:db8:${(toHex(randomBytes(12)).match(/.{4}/g) ?? []).join(':').replace(/(^|:)0{1,3}/g, '$1')}`);
        break;
      case 'port':
        out = Array.from({ length: count }, () => randomBetween(49152, 65535));
        break;
      case 'date': {
        const [from, to] = [Date.parse(o.from), Date.parse(o.to)];
        if (Number.isNaN(from) || Number.isNaN(to)) throw new ToolError('Enter the dates as YYYY-MM-DD.');
        out = Array.from({ length: count }, () => new Date(randomBetween(Math.floor(Math.min(from, to) / 86400000), Math.floor(Math.max(from, to) / 86400000)) * 86400000).toISOString().slice(0, 10));
        break;
      }
      case 'colour':
        out = Array.from({ length: count }, () => `#${toHex(randomBytes(3))}`);
        break;
      case 'dice': {
        const rolls = Array.from({ length: count }, () => randomBetween(1, o.sides));
        return { output: rolls.join(' '), fields: [{ label: 'Total', value: String(rolls.reduce((a, b) => a + b, 0)) }] };
      }
      case 'coin': {
        const flips = Array.from({ length: count }, () => (randomBetween(0, 1) ? 'Heads' : 'Tails'));
        return {
          output: flips.join('\n'),
          fields: [
            { label: 'Heads', value: String(flips.filter((flip) => flip === 'Heads').length) },
            { label: 'Tails', value: String(flips.filter((flip) => flip === 'Tails').length) },
          ],
        };
      }
    }
    if (o.sort) out.sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })));
    return { output: out.join('\n'), info: 'From the system’s cryptographically secure random generator.' };
  },
});
