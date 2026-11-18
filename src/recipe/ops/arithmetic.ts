/** Arithmetic and logic: sets, bitwise operations with a key, sums and statistics, modular arithmetic, shifts. */
import { bArg, bool, defineOp, delimiter, keyArg, keyed, nArg, num, OpError, type Operation, sArg, sel, str, unescapeShort } from '../core';

const C = 'Arithmetic / Logic' as const;

const ARITH_DELIMS = ['Line feed', 'Space', 'Comma', 'Semi-colon', 'Colon', 'CRLF'];

function numbers(input: string, delim: string): number[] {
  return input
    .split(delimiter(delim))
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const n = /^0x[0-9a-f]+$/i.test(part) ? Number.parseInt(part, 16) : Number(part);
      if (!Number.isFinite(n)) throw new OpError(`"${part}" is not a number.`);
      return n;
    });
}

/** Removes floating-point noise such as 0.30000000000000004. */
const tidy = (n: number) => (Number.isInteger(n) ? String(n) : String(Number.parseFloat(n.toPrecision(15))));

function sets(input: string, sampleDelim: string, itemDelim: string): string[][] {
  const samples = input.split(unescapeShort(sampleDelim));
  return samples.map((sample) => sample.split(unescapeShort(itemDelim)).filter((item) => item !== ''));
}

const setArgs = [str('sample', 'Sample delimiter', '\\n\\n'), str('item', 'Item delimiter', ',')];

function twoSets(input: string, a: Record<string, unknown>): [string[], string[], string] {
  const parts = sets(input, String(a.sample), String(a.item));
  if (parts.length !== 2) throw new OpError('Enter exactly two samples, separated by the sample delimiter.');
  return [parts[0] as string[], parts[1] as string[], unescapeShort(String(a.item))];
}

const unique = <T>(items: T[]) => [...new Set(items)];

function bitwise(name: string, fn: (b: number, k: number) => number, description: string): Operation {
  return defineOp({
    name,
    category: C,
    description,
    input: 'bytes',
    output: 'bytes',
    args: [keyed('key', 'Key', 'Hex')],
    run: (input, a) => {
      const key = keyArg(a, 'key');
      if (key.length === 0) return input.slice();
      return input.map((b, i) => fn(b, key[i % key.length] as number) & 255);
    },
  });
}

function aggregate(name: string, description: string, fn: (values: number[]) => number): Operation {
  return defineOp({
    name,
    category: C,
    description,
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', ARITH_DELIMS)],
    run: (input, a) => {
      const values = numbers(input, sArg(a, 'delimiter'));
      if (values.length === 0) return '';
      return tidy(fn(values));
    },
  });
}

const big = (text: string, label: string): bigint => {
  const t = text.trim();
  if (!/^-?(\d+|0x[0-9a-f]+)$/i.test(t)) throw new OpError(`${label} must be a whole number.`);
  return t.startsWith('-') ? -BigInt(t.slice(1)) : BigInt(t);
};

function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let [oldR, r] = [a, b];
  let [oldS, s] = [1n, 0n];
  let [oldT, t] = [0n, 1n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}

const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;

export const arithmeticOps: Operation[] = [
  defineOp({
    name: 'Set Union',
    category: C,
    description: 'Items in either of two samples.',
    input: 'text',
    output: 'text',
    args: setArgs,
    run: (input, a) => {
      const [x, y, sep] = twoSets(input, a);
      return unique([...x, ...y]).join(sep);
    },
  }),
  defineOp({
    name: 'Set Intersection',
    category: C,
    description: 'Items in both of two samples.',
    input: 'text',
    output: 'text',
    args: setArgs,
    run: (input, a) => {
      const [x, y, sep] = twoSets(input, a);
      return unique(x.filter((item) => y.includes(item))).join(sep);
    },
  }),
  defineOp({
    name: 'Set Difference',
    category: C,
    description: 'Items in the first sample but not the second.',
    input: 'text',
    output: 'text',
    args: setArgs,
    run: (input, a) => {
      const [x, y, sep] = twoSets(input, a);
      return unique(x.filter((item) => !y.includes(item))).join(sep);
    },
  }),
  defineOp({
    name: 'Symmetric Difference',
    category: C,
    description: 'Items in exactly one of two samples.',
    input: 'text',
    output: 'text',
    args: setArgs,
    run: (input, a) => {
      const [x, y, sep] = twoSets(input, a);
      return unique([...x.filter((item) => !y.includes(item)), ...y.filter((item) => !x.includes(item))]).join(sep);
    },
  }),
  defineOp({
    name: 'Cartesian Product',
    category: C,
    description: 'Every combination of one item from each sample.',
    input: 'text',
    output: 'text',
    args: setArgs,
    run: (input, a) => {
      const parts = sets(input, sArg(a, 'sample'), sArg(a, 'item'));
      const product = parts.reduce<string[][]>((acc, set) => acc.flatMap((combo) => set.map((item) => [...combo, item])), [[]]);
      if (product.length > 100000) throw new OpError('The product would have more than 100,000 combinations.');
      return product.map((combo) => `(${combo.join(',')})`).join(unescapeShort(sArg(a, 'item')));
    },
  }),
  defineOp({
    name: 'Power Set',
    category: C,
    description: 'Every subset of a set of items.',
    input: 'text',
    output: 'text',
    args: [str('item', 'Item delimiter', ',')],
    run: (input, a) => {
      const sep = unescapeShort(sArg(a, 'item'));
      const items = unique(input.split(sep).filter((item) => item !== ''));
      if (items.length > 16) throw new OpError('Power sets are limited to 16 items (65,536 subsets).');
      const out: string[] = [];
      for (let mask = 0; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)).join(sep));
      return out.join('\n');
    },
  }),
  bitwise('OR', (b, k) => b | k, 'Bitwise OR with a repeating key.'),
  bitwise('AND', (b, k) => b & k, 'Bitwise AND with a repeating key.'),
  bitwise('ADD', (b, k) => b + k, 'Adds a repeating key to each byte (mod 256).'),
  bitwise('SUB', (b, k) => b - k, 'Subtracts a repeating key from each byte (mod 256).'),
  defineOp({
    name: 'NOT',
    category: C,
    description: 'Inverts every bit.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => input.map((b) => ~b & 255),
  }),
  aggregate('Sum', 'Adds a list of numbers.', (v) => v.reduce((x, y) => x + y, 0)),
  aggregate('Subtract', 'Subtracts each number from the first.', (v) => v.slice(1).reduce((x, y) => x - y, v[0] as number)),
  aggregate('Multiply', 'Multiplies a list of numbers.', (v) => v.reduce((x, y) => x * y, 1)),
  aggregate('Divide', 'Divides the first number by each of the others.', (v) => v.slice(1).reduce((x, y) => x / y, v[0] as number)),
  aggregate('Mean', 'Average of a list of numbers.', (v) => v.reduce((x, y) => x + y, 0) / v.length),
  aggregate('Median', 'Middle value of a list of numbers.', (v) => {
    const s = [...v].sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  }),
  aggregate('Standard Deviation', 'Population standard deviation of a list of numbers.', (v) => {
    const mean = v.reduce((x, y) => x + y, 0) / v.length;
    return Math.sqrt(v.reduce((sum, x) => sum + (x - mean) ** 2, 0) / v.length);
  }),
  defineOp({
    name: 'MOD',
    category: C,
    description: 'Each number modulo a value.',
    input: 'text',
    output: 'text',
    args: [num('modulus', 'Modulus', 2), sel('delimiter', 'Delimiter', ARITH_DELIMS)],
    run: (input, a) => {
      const m = nArg(a, 'modulus');
      if (m === 0) throw new OpError('The modulus cannot be 0.');
      return numbers(input, sArg(a, 'delimiter'))
        .map((n) => tidy(((n % m) + m) % m))
        .join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Extended GCD',
    category: C,
    description: 'Greatest common divisor of a and b, with x and y such that ax + by = gcd.',
    input: 'text',
    output: 'text',
    args: [str('a', 'Value a', ''), str('b', 'Value b', '')],
    run: (_input, a) => {
      const [g, x, y] = egcd(big(sArg(a, 'a'), 'a'), big(sArg(a, 'b'), 'b'));
      return `GCD = ${g}\nx = ${x}\ny = ${y}`;
    },
  }),
  defineOp({
    name: 'Modular Exponentiation',
    category: C,
    description: 'base ^ exponent mod modulus, for very large numbers.',
    input: 'text',
    output: 'text',
    args: [str('base', 'Base', ''), str('modulus', 'Modulus', '1'), str('exponent', 'Exponent', '')],
    run: (_input, a) => {
      const m = big(sArg(a, 'modulus'), 'The modulus');
      let e = big(sArg(a, 'exponent'), 'The exponent');
      if (m <= 0n) throw new OpError('The modulus must be positive.');
      if (e < 0n) throw new OpError('The exponent must not be negative.');
      let base = mod(big(sArg(a, 'base'), 'The base'), m);
      let result = 1n % m;
      while (e > 0n) {
        if (e & 1n) result = (result * base) % m;
        base = (base * base) % m;
        e >>= 1n;
      }
      return result.toString();
    },
  }),
  defineOp({
    name: 'Modular Inverse',
    category: C,
    description: 'The number x such that a × x ≡ 1 (mod m).',
    input: 'text',
    output: 'text',
    args: [str('a', 'Value (a)', ''), str('m', 'Modulus (m)', '')],
    run: (_input, a) => {
      const m = big(sArg(a, 'm'), 'The modulus');
      const [g, x] = egcd(mod(big(sArg(a, 'a'), 'a'), m), m);
      if (g !== 1n) throw new OpError('No inverse exists: a and m are not coprime.');
      return mod(x, m).toString();
    },
  }),
  defineOp({
    name: 'Bit shift left',
    category: C,
    description: 'Shifts the bits of each byte left.',
    input: 'bytes',
    output: 'bytes',
    args: [num('amount', 'Amount', 1, { min: 0, max: 8 })],
    run: (input, a) => input.map((b) => (b << nArg(a, 'amount')) & 255),
  }),
  defineOp({
    name: 'Bit shift right',
    category: C,
    description: 'Shifts the bits of each byte right (logical or arithmetic).',
    input: 'bytes',
    output: 'bytes',
    args: [num('amount', 'Amount', 1, { min: 0, max: 8 }), sel('type', 'Type', ['Logical shift', 'Arithmetic shift'])],
    run: (input, a) => {
      const n = nArg(a, 'amount');
      return input.map((b) => (sArg(a, 'type') === 'Arithmetic shift' ? ((b << 24) >> (24 + n)) & 255 : b >>> n));
    },
  }),
  defineOp({
    name: 'Rotate left',
    category: C,
    description: 'Rotates the bits of each byte (or of the whole data with carry through) left.',
    input: 'bytes',
    output: 'bytes',
    args: [num('amount', 'Amount', 1, { min: 0 }), bool('carry', 'Carry through')],
    run: (input, a) => rotateBits(input, nArg(a, 'amount'), bArg(a, 'carry'), true),
  }),
  defineOp({
    name: 'Rotate right',
    category: C,
    description: 'Rotates the bits of each byte (or of the whole data with carry through) right.',
    input: 'bytes',
    output: 'bytes',
    args: [num('amount', 'Amount', 1, { min: 0 }), bool('carry', 'Carry through')],
    run: (input, a) => rotateBits(input, nArg(a, 'amount'), bArg(a, 'carry'), false),
  }),
];

function rotateBits(input: Uint8Array, amount: number, carry: boolean, left: boolean): Uint8Array {
  if (!carry) {
    const n = ((amount % 8) + 8) % 8;
    return input.map((b) => (left ? ((b << n) | (b >>> (8 - n))) & 255 : ((b >>> n) | (b << (8 - n))) & 255));
  }
  const total = input.length * 8;
  if (total === 0) return input.slice();
  const n = ((amount % total) + total) % total;
  const bit = (i: number) => ((input[i >> 3] as number) >> (7 - (i & 7))) & 1;
  const out = new Uint8Array(input.length);
  for (let i = 0; i < total; i++) {
    const from = left ? (i + n) % total : (i - n + total) % total;
    if (bit(from)) out[i >> 3] = (out[i >> 3] as number) | (1 << (7 - (i & 7)));
  }
  return out;
}
