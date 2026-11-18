/**
 * Core contracts of the Recipe tool: Benchtop's own rebuild of CyberChef.
 *
 * Operation names and argument lists follow CyberChef so that recipes copied
 * from it load here.  Values passed between operations are either text or
 * bytes, converted the way CyberChef converts them: text becomes bytes one
 * byte per character when every character fits in a byte (otherwise UTF-8),
 * and bytes become text as UTF-8 when valid (otherwise one character per byte).
 */
import { fromBase64, toBase64 } from '../lib/bytes';

export type Dish = string | Uint8Array;
export type DataKind = 'text' | 'bytes';
export type ArgValue = string | number | boolean;
export type Args = Record<string, ArgValue>;

export type Preview =
  | { readonly kind: 'image'; readonly bytes: Uint8Array; readonly mime: string }
  | { readonly kind: 'media'; readonly bytes: Uint8Array; readonly mime: string }
  | { readonly kind: 'html'; readonly html: string }
  /** A drawing (charts, maps), shown as a picture that can be saved as PNG. */
  | { readonly kind: 'svg'; readonly svg: string }
  /** A PDF, whose pages are drawn in the preview. */
  | { readonly kind: 'pdf'; readonly bytes: Uint8Array }
  /** Several output files (Unzip, Untar, Extract Files), each of which can be saved. */
  | { readonly kind: 'files'; readonly files: readonly { readonly name: string; readonly bytes: Uint8Array }[] };

export interface OpResult {
  readonly value: Dish;
  readonly preview?: Preview;
}

export type KeyFormat = 'UTF8' | 'Latin1' | 'Hex' | 'Base64' | 'Decimal' | 'Binary';
export const KEY_FORMATS: readonly KeyFormat[] = ['Hex', 'UTF8', 'Latin1', 'Base64', 'Decimal', 'Binary'];

interface ArgBase {
  readonly key: string;
  readonly label: string;
  readonly help?: string;
  readonly showIf?: (args: Args) => boolean;
}

export interface Choice {
  readonly label: string;
  readonly value: string;
}

export type ArgDef =
  | (ArgBase & { readonly type: 'string'; readonly default: string; readonly placeholder?: string })
  | (ArgBase & { readonly type: 'text'; readonly default: string })
  | (ArgBase & { readonly type: 'number'; readonly default: number; readonly min?: number; readonly max?: number; readonly step?: number })
  | (ArgBase & { readonly type: 'boolean'; readonly default: boolean })
  | (ArgBase & { readonly type: 'select'; readonly default: string; readonly choices: readonly string[] })
  /** A text value with a list of ready-made values (alphabets, regular expressions). */
  | (ArgBase & { readonly type: 'editable'; readonly default: string; readonly choices: readonly Choice[] })
  /** A key, IV or similar typed in one of several formats; the format is stored under `${key}.format`. */
  | (ArgBase & { readonly type: 'keyed'; readonly default: string; readonly formats: readonly string[]; readonly format: string });

export type Category =
  | 'Data format'
  | 'Encryption / Encoding'
  | 'Public Key'
  | 'Arithmetic / Logic'
  | 'Networking'
  | 'Language'
  | 'Utils'
  | 'Date / Time'
  | 'Extractors'
  | 'Compression'
  | 'Hashing'
  | 'Code tidy'
  | 'Forensics'
  | 'Multimedia'
  | 'Other'
  | 'Flow control';

export const CATEGORY_ORDER: readonly Category[] = [
  'Data format',
  'Encryption / Encoding',
  'Public Key',
  'Arithmetic / Logic',
  'Networking',
  'Language',
  'Utils',
  'Date / Time',
  'Extractors',
  'Compression',
  'Hashing',
  'Code tidy',
  'Forensics',
  'Multimedia',
  'Other',
  'Flow control',
];

export type FlowKind = 'fork' | 'merge' | 'subsection' | 'register' | 'label' | 'jump' | 'cjump' | 'return' | 'comment' | 'magic';

export interface OpContext {
  /** Values captured by Register, referenced as $R0, $R1… in later arguments. */
  readonly registers: readonly string[];
}

export interface MagicHint {
  /** Input that this operation is likely to decode. */
  readonly pattern: RegExp;
  readonly args?: Args;
}

export interface Operation {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  /** Also listed under these categories (CyberChef lists some operations twice). */
  readonly also?: readonly Category[];
  readonly description: string;
  readonly input: DataKind;
  readonly output: DataKind;
  readonly args: readonly ArgDef[];
  readonly keywords?: readonly string[];
  readonly magic?: readonly MagicHint[];
  readonly flow?: FlowKind;
  /** Output is randomly generated or depends on the clock: never cache it. */
  readonly volatile?: boolean;
  readonly run: (input: never, args: Args, ctx: OpContext) => Dish | OpResult | Promise<Dish | OpResult>;
}

type RunFor<I extends DataKind> = (input: I extends 'text' ? string : Uint8Array, args: Args, ctx: OpContext) => Dish | OpResult | Promise<Dish | OpResult>;

export type OperationInit<I extends DataKind> = Omit<Operation, 'id' | 'run' | 'input' | 'args'> & {
  readonly input: I;
  readonly args?: readonly ArgDef[];
  readonly run: RunFor<I>;
};

export const slug = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function defineOp<I extends DataKind>(init: OperationInit<I>): Operation {
  return { ...init, id: slug(init.name), args: init.args ?? [], run: init.run as Operation['run'] };
}

/* ------------------------------------------------------------- arguments -- */

export const str = (key: string, label: string, def = '', extra: Partial<ArgBase> & { placeholder?: string } = {}): ArgDef => ({ key, label, type: 'string', default: def, ...extra });
export const txt = (key: string, label: string, def = '', extra: Partial<ArgBase> = {}): ArgDef => ({ key, label, type: 'text', default: def, ...extra });
export const num = (key: string, label: string, def: number, extra: Partial<ArgBase> & { min?: number; max?: number; step?: number } = {}): ArgDef => ({
  key,
  label,
  type: 'number',
  default: def,
  ...extra,
});
export const bool = (key: string, label: string, def = false, extra: Partial<ArgBase> = {}): ArgDef => ({ key, label, type: 'boolean', default: def, ...extra });
export const sel = (key: string, label: string, choices: readonly string[], def: string = choices[0] ?? '', extra: Partial<ArgBase> = {}): ArgDef => ({
  key,
  label,
  type: 'select',
  default: def,
  choices,
  ...extra,
});
export const editable = (key: string, label: string, choices: readonly Choice[], def: string = choices[0]?.value ?? '', extra: Partial<ArgBase> = {}): ArgDef => ({
  key,
  label,
  type: 'editable',
  default: def,
  choices,
  ...extra,
});
export const keyed = (key: string, label: string, format: string = 'Hex', formats: readonly string[] = KEY_FORMATS, extra: Partial<ArgBase> & { default?: string } = {}): ArgDef => ({
  key,
  label,
  type: 'keyed',
  default: extra.default ?? '',
  formats,
  format,
  ...extra,
});

/** Default values for every argument of an operation. */
export function defaultArgs(op: Operation): Args {
  const args: Args = {};
  for (const arg of op.args) {
    args[arg.key] = arg.default;
    if (arg.type === 'keyed') args[`${arg.key}.format`] = arg.format;
  }
  return args;
}

/* ------------------------------------------------------------ conversion -- */

const utf8Fatal = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

/** One character per byte (ISO-8859-1). */
export function bytesToLatin1(bytes: Uint8Array): string {
  // TextDecoder('latin1') is really windows-1252, so bytes are mapped directly, in chunks.
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}
export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** CyberChef's bytes-to-text rule: UTF-8 when valid, otherwise one character per byte. */
export function toText(value: Dish): string {
  if (typeof value === 'string') return value;
  if (value.length === 0) return '';
  try {
    return utf8Fatal.decode(value);
  } catch {
    return bytesToLatin1(value);
  }
}

/** CyberChef's text-to-bytes rule: one byte per character when they all fit, otherwise UTF-8. */
export function toBytes(value: Dish): Uint8Array {
  if (typeof value !== 'string') return value;
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > 255) return encoder.encode(value);
  return latin1ToBytes(value);
}

export const utf8 = (text: string): Uint8Array => encoder.encode(text);

/* -------------------------------------------------------- argument values -- */

export const sArg = (args: Args, key: string): string => String(args[key] ?? '');
export const nArg = (args: Args, key: string): number => {
  const value = Number(args[key]);
  return Number.isFinite(value) ? value : 0;
};
export const bArg = (args: Args, key: string): boolean => args[key] === true || args[key] === 'true';

/** Turns a keyed argument (key, IV, salt…) into bytes using its chosen format. */
export function keyArg(args: Args, key: string): Uint8Array {
  return parseKeyed(sArg(args, key), (sArg(args, `${key}.format`) || 'UTF8') as KeyFormat);
}

export function parseKeyed(text: string, format: KeyFormat): Uint8Array {
  switch (format) {
    case 'Hex':
      return hexToBytes(text);
    case 'Base64':
      return text.trim() === '' ? new Uint8Array(0) : fromBase64(text);
    case 'Latin1':
      return latin1ToBytes(text);
    case 'Decimal':
      return Uint8Array.from(
        text
          .split(/[^0-9]+/)
          .filter(Boolean)
          .map((part) => Number(part) & 0xff),
      );
    case 'Binary':
      return Uint8Array.from((text.replace(/[^01]/g, '').match(/.{1,8}/g) ?? []).map((part) => Number.parseInt(part, 2)));
    default:
      return encoder.encode(text);
  }
}

/** Lenient hex parsing: ignores spaces, 0x, \x, % and other separators. */
export function hexToBytes(text: string): Uint8Array {
  const clean = text.replace(/0x|\\x/gi, ' ').replace(/[^0-9a-fA-F]/g, '');
  const digits = clean.length % 2 === 1 ? `0${clean}` : clean;
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const hex = (bytes: Uint8Array, separator = ''): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(separator);
export const b64 = (bytes: Uint8Array): string => toBase64(bytes);

/* ------------------------------------------------------------- delimiters -- */

export const DELIMITERS = ['Space', 'Comma', 'Semi-colon', 'Colon', 'Line feed', 'CRLF'] as const;
export const DELIMITERS_NONE = [...DELIMITERS, 'None'] as const;

const DELIMITER_CHARS: Record<string, string> = {
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  'Line feed': '\n',
  CRLF: '\r\n',
  'Forward slash': '/',
  Backslash: '\\',
  '0x': '0x',
  '\\x': '\\x',
  'Nothing (separate chars)': '',
  None: '',
  Tab: '\t',
  Pipe: '|',
};

export function delimiter(name: string): string {
  return DELIMITER_CHARS[name] ?? name;
}

/** Splits on a named delimiter, or guesses a common one when `name` is "Auto". */
export function splitBy(text: string, name: string): string[] {
  if (name === 'Auto') return text.split(/[\s,;:]+/).filter(Boolean);
  const delim = delimiter(name);
  if (delim === '') return Array.from(text);
  return text.split(delim);
}

/** Interprets \n, \t, \r, \0, \\ and \xNN in short delimiter arguments ("binary short strings"). */
export function unescapeShort(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[nrt0\\])/g, (_, code: string) => {
    if (code === 'n') return '\n';
    if (code === 'r') return '\r';
    if (code === 't') return '\t';
    if (code === '0') return '\0';
    if (code === '\\') return '\\';
    return String.fromCharCode(Number.parseInt(code.slice(1), 16));
  });
}

/** Builds a RegExp from user text, turning a syntax error into a clear message. */
export function userRegex(source: string, flags: string): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${(error as Error).message}`);
  }
}

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

/** The value of a CommonJS package loaded with import(), which some loaders wrap in `default` and others do not. */
export function cjs<T>(module: { default?: T } | T): T {
  const wrapped = module as { default?: T };
  return (wrapped.default ?? module) as T;
}
