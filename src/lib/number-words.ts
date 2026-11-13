/** Spells out numbers in English, in the international or the Indian numbering system. */
import { ToolError } from './errors';

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALE = [
  '',
  'thousand',
  'million',
  'billion',
  'trillion',
  'quadrillion',
  'quintillion',
  'sextillion',
  'septillion',
  'octillion',
  'nonillion',
  'decillion',
  'undecillion',
  'duodecillion',
  'tredecillion',
  'quattuordecillion',
  'quindecillion',
  'sexdecillion',
  'septendecillion',
  'octodecillion',
  'novemdecillion',
  'vigintillion',
];
const ORDINALS: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

export interface WordOptions {
  readonly system: 'international' | 'indian';
  /** British style: "one hundred and one". */
  readonly and: boolean;
}

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] as string;
  const ten = TENS[Math.floor(n / 10)] as string;
  return n % 10 === 0 ? ten : `${ten}-${ONES[n % 10]}`;
}

function belowThousand(n: number, and: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return belowHundred(rest);
  const head = `${ONES[hundreds]} hundred`;
  return rest === 0 ? head : `${head}${and ? ' and ' : ' '}${belowHundred(rest)}`;
}

/** Joins the groups, adding the British "and" before a final group under one hundred. */
function join(parts: { value: number; words: string }[], and: boolean): string {
  const last = parts[parts.length - 1];
  if (and && parts.length > 1 && last && last.value < 100) {
    return `${parts
      .slice(0, -1)
      .map((part) => part.words)
      .join(' ')} and ${last.words}`;
  }
  return parts.map((part) => part.words).join(' ');
}

function international(value: bigint, and: boolean): string {
  const parts: { value: number; words: string }[] = [];
  const digits = value.toString();
  const groups = Math.ceil(digits.length / 3);
  if (groups > SCALE.length) throw new ToolError('That number is too large to spell out (the limit is 10^66 - 1).');
  const padded = digits.padStart(groups * 3, '0');
  for (let index = 0; index < groups; index++) {
    const group = Number(padded.slice(index * 3, index * 3 + 3));
    if (group === 0) continue;
    const scale = SCALE[groups - 1 - index] as string;
    parts.push({ value: scale === '' ? group : 1000, words: `${belowThousand(group, and)}${scale === '' ? '' : ` ${scale}`}` });
  }
  return join(parts, and);
}

/** Indian system: thousand, lakh, crore; larger values are counted in crores ("one lakh crore"). */
function indian(value: bigint, and: boolean): string {
  const CRORE = 10000000n;
  const parts: { value: number; words: string }[] = [];
  const crores = value / CRORE;
  let rest = Number(value % CRORE);
  if (crores > 0n) parts.push({ value: 1000, words: `${indian(crores, and)} crore` });
  const lakhs = Math.floor(rest / 100000);
  rest %= 100000;
  const thousands = Math.floor(rest / 1000);
  rest %= 1000;
  if (lakhs > 0) parts.push({ value: 1000, words: `${belowHundred(lakhs)} lakh` });
  if (thousands > 0) parts.push({ value: 1000, words: `${belowHundred(thousands)} thousand` });
  if (rest > 0) parts.push({ value: rest, words: belowThousand(rest, and) });
  return join(parts, and);
}

export function integerToWords(value: bigint, options: WordOptions): string {
  if (value < 0n) return `minus ${integerToWords(-value, options)}`;
  if (value === 0n) return 'zero';
  return options.system === 'indian' ? indian(value, options.and) : international(value, options.and);
}

export function toOrdinal(words: string): string {
  const match = /([a-z]+)$/.exec(words);
  if (!match) return words;
  const last = match[1] as string;
  const ordinal = ORDINALS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.slice(0, match.index) + ordinal;
}

export interface ParsedNumber {
  readonly negative: boolean;
  readonly integer: bigint;
  /** Digits after the decimal point, exactly as written (may be empty). */
  readonly fraction: string;
}

/** Accepts plain decimals with optional sign, thousands separators (`,` `_` space) and exponents. */
export function parseNumber(text: string): ParsedNumber {
  const cleaned = text.trim().replace(/[,_\s\u00A0]/g, '');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(cleaned);
  if (!match || ((match[2] ?? '') === '' && (match[3] ?? '') === '')) {
    throw new ToolError(`"${text.trim()}" is not a number.`);
  }
  let integer = match[2] ?? '';
  let fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? 0);
  if (Math.abs(exponent) > 400) throw new ToolError('The exponent is too large.');
  if (exponent > 0) {
    integer += fraction.slice(0, exponent).padEnd(exponent, '0');
    fraction = fraction.slice(exponent);
  } else if (exponent < 0) {
    const shifted = integer.padStart(-exponent + 1, '0');
    fraction = shifted.slice(shifted.length + exponent) + fraction;
    integer = shifted.slice(0, shifted.length + exponent);
  }
  return { negative: match[1] === '-', integer: BigInt(integer === '' ? '0' : integer), fraction };
}

export function numberToWords(text: string, options: WordOptions): string {
  const number = parseNumber(text);
  const isZero = number.integer === 0n && /^0*$/.test(number.fraction);
  let words = integerToWords(number.integer, options);
  if (number.fraction !== '') {
    words += ` point ${Array.from(number.fraction, (digit) => ONES[Number(digit)]).join(' ')}`;
  }
  return number.negative && !isZero ? `minus ${words}` : words;
}

export function numberToOrdinal(text: string, options: WordOptions): string {
  const number = parseNumber(text);
  if (number.fraction.replace(/0+$/, '') !== '') throw new ToolError(`"${text.trim()}" is not a whole number, so it has no ordinal form.`);
  const words = toOrdinal(integerToWords(number.integer, options));
  return number.negative && number.integer !== 0n ? `minus ${words}` : words;
}

export interface Currency {
  readonly major: [singular: string, plural: string];
  readonly minor: [singular: string, plural: string];
}

export const CURRENCIES: Record<string, Currency> = {
  USD: { major: ['dollar', 'dollars'], minor: ['cent', 'cents'] },
  EUR: { major: ['euro', 'euros'], minor: ['cent', 'cents'] },
  GBP: { major: ['pound', 'pounds'], minor: ['penny', 'pence'] },
  INR: { major: ['rupee', 'rupees'], minor: ['paisa', 'paise'] },
};

/** Splits an amount into whole units and hundredths, rounding half away from zero. */
function toMinorUnits(number: ParsedNumber): { units: bigint; hundredths: number } {
  const digits = number.fraction.padEnd(3, '0');
  let total = number.integer * 100n + BigInt(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) total += 1n;
  return { units: total / 100n, hundredths: Number(total % 100n) };
}

/** "one thousand two hundred thirty-four dollars and fifty-six cents" */
export function amountToWords(text: string, currency: Currency, options: WordOptions): string {
  const number = parseNumber(text);
  const { units, hundredths } = toMinorUnits(number);
  const major = `${integerToWords(units, options)} ${units === 1n ? currency.major[0] : currency.major[1]}`;
  const minor = `${integerToWords(BigInt(hundredths), options)} ${hundredths === 1 ? currency.minor[0] : currency.minor[1]}`;
  const sign = number.negative && (units > 0n || hundredths > 0) ? 'minus ' : '';
  if (hundredths === 0) return sign + major;
  return units === 0n ? sign + minor : `${sign}${major} and ${minor}`;
}

/** The form written on cheques: "One thousand two hundred thirty-four and 56/100 dollars". */
export function amountToCheque(text: string, currency: Currency, options: WordOptions): string {
  const number = parseNumber(text);
  if (number.negative) throw new ToolError('A cheque amount cannot be negative.');
  const { units, hundredths } = toMinorUnits(number);
  return `${integerToWords(units, options)} and ${String(hundredths).padStart(2, '0')}/100 ${currency.major[1]}`;
}
