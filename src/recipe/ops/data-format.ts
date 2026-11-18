/** Data format operations: hex, binary, Base-N, entities, Unicode, character sets, serialisation formats. */
import { type Der, decodeOid, oidName, parseDer } from '../../lib/x509';
import {
  b64,
  bArg,
  bool,
  bytesToLatin1,
  type Choice,
  cjs,
  DELIMITERS,
  defineOp,
  delimiter,
  editable,
  hex,
  hexToBytes,
  latin1ToBytes,
  nArg,
  num,
  OpError,
  type Operation,
  sArg,
  sel,
  splitBy,
  str,
  toBytes,
  unescapeShort,
  utf8,
} from '../core';

const C = 'Data format' as const;

/* ---------------------------------------------------------------- helpers -- */

/** Expands CyberChef alphabet shorthand such as "A-Za-z0-9+/=" (a literal "-" is written "\-"). */
export function expandAlphabet(spec: string): string {
  let out = '';
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i] as string;
    if (ch === '\\' && i + 1 < spec.length) {
      out += spec[++i];
      continue;
    }
    if (i + 2 < spec.length && spec[i + 1] === '-' && spec[i + 2] !== '\\') {
      const from = ch.charCodeAt(0);
      const to = (spec[i + 2] as string).charCodeAt(0);
      for (let code = from; code <= to; code++) out += String.fromCharCode(code);
      i += 2;
      continue;
    }
    out += ch;
  }
  return out;
}

const HEX_DELIMS = ['Space', 'Percent', 'Comma', 'Semi-colon', 'Colon', 'Line feed', 'CRLF', '0x', '0x with comma', '\\x', 'None'];

export function toHexDelimited(bytes: Uint8Array, delim: string, perLine = 0, digits = '0123456789abcdef'): string {
  const parts = Array.from(bytes, (b) => (digits[b >> 4] ?? '') + (digits[b & 15] ?? ''));
  let prefix = '';
  let sep = '';
  switch (delim) {
    case 'Percent':
      prefix = '%';
      break;
    case '0x':
      prefix = '0x';
      break;
    case '0x with comma':
      prefix = '0x';
      sep = ',';
      break;
    case '\\x':
      prefix = '\\x';
      break;
    case 'None':
      break;
    default:
      sep = delimiter(delim);
  }
  const items = parts.map((p) => prefix + p);
  if (perLine > 0) {
    const lines: string[] = [];
    for (let i = 0; i < items.length; i += perLine) lines.push(items.slice(i, i + perLine).join(sep));
    return lines.join(sep === '\n' || sep === '\r\n' ? sep : `${sep === ' ' ? '' : sep}\n`);
  }
  return items.join(sep);
}

export function fromHexDelimited(text: string, delim: string): Uint8Array {
  if (delim === 'Auto' || delim === 'None' || delim === '0x' || delim === '\\x' || delim === '0x with comma' || delim === 'Percent') return hexToBytes(text);
  const sep = delimiter(delim);
  const parts = text.split(sep).map((part) => part.trim().replace(/^0x/i, ''));
  const out: number[] = [];
  for (const part of parts) {
    if (part === '') continue;
    const bytes = hexToBytes(part);
    for (const b of bytes) out.push(b);
  }
  return Uint8Array.from(out);
}

function numbersFrom(text: string, delim: string): string[] {
  return splitBy(text.trim(), delim)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

const BASE64_ALPHABETS: readonly Choice[] = [
  { label: 'Standard (RFC 4648): A-Za-z0-9+/=', value: 'A-Za-z0-9+/=' },
  { label: 'URL safe (RFC 4648 §5): A-Za-z0-9-_', value: 'A-Za-z0-9\\-_' },
  { label: 'Filename safe: A-Za-z0-9+-=', value: 'A-Za-z0-9+\\-=' },
  { label: 'itoa64: ./0-9A-Za-z=', value: './0-9A-Za-z=' },
  { label: 'XML: A-Za-z0-9_.', value: 'A-Za-z0-9_.' },
  { label: 'y64: A-Za-z0-9._-', value: 'A-Za-z0-9._\\-' },
  { label: 'z64: 0-9a-zA-Z+/=', value: '0-9a-zA-Z+/=' },
  { label: 'Radix-64 (RFC 4880): 0-9A-Za-z+/=', value: '0-9A-Za-z+/=' },
  { label: 'Uuencoding: [space]-_', value: ' -_' },
  { label: 'Xxencoding: +-0-9A-Za-z', value: '+\\-0-9A-Za-z' },
  { label: 'BinHex: !-,-0-689@A-NP-VX-Z[`a-fh-mp-r', value: '!-,\\-0-689@A-NP-VX-Z[`a-fh-mp-r' },
  { label: 'ROT13: N-ZA-Mn-za-m0-9+/=', value: 'N-ZA-Mn-za-m0-9+/=' },
  { label: 'UNIX crypt: ./0-9A-Za-z', value: './0-9A-Za-z' },
  { label: 'Atom128', value: '/128GhIoPQROSTeUbADfgHijKLM+n0pFWXY456xyzB7=39VaqrstJklmNuZvwcdEC' },
  { label: 'Megan35', value: '3G-Ub=c-pW-Z/12+406-9Vaq-zA-F5' },
  { label: 'Zong22', value: 'ZKj9n+yf0wDVX1s/5YbdxSo=ILaUpPBCHg8uvNO4klm6iJGhQ7eFrWczAMEq3RTt2' },
  { label: 'Hazz15', value: 'HNO4klm6ij9n+J2hyf0gzA8uvwDEq3X1Q7ZKeFrWcVTts/MRGYbdxSo=ILaUpPBC5' },
];

export function base64Encode(bytes: Uint8Array, spec: string): string {
  const alphabet = expandAlphabet(spec);
  if (alphabet.length < 64) throw new OpError('A Base64 alphabet needs at least 64 characters.');
  const pad = alphabet[64] ?? '';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += (alphabet[a >> 2] ?? '') + (alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] ?? '');
    out += b === undefined ? pad : (alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] ?? '');
    out += c === undefined ? pad : (alphabet[c & 63] ?? '');
  }
  return out;
}

export function base64Decode(text: string, spec: string, removeNonAlphabet = true, strict = false): Uint8Array {
  const alphabet = expandAlphabet(spec);
  const pad = alphabet[64] ?? '=';
  const index = new Map<string, number>();
  for (let i = 0; i < 64; i++) index.set(alphabet[i] as string, i);
  let body = '';
  for (const ch of text) {
    if (index.has(ch)) body += ch;
    else if (ch === pad) {
      if (strict && body.length % 4 < 2) throw new OpError('Padding appears in an invalid place.');
      break;
    } else if (strict) throw new OpError(`"${ch}" is not in the Base64 alphabet.`);
    else if (!removeNonAlphabet && !/\s/.test(ch)) throw new OpError(`"${ch}" is not in the Base64 alphabet.`);
  }
  if (strict && body.length % 4 === 1) throw new OpError('The Base64 input has an invalid length.');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of body) {
    buffer = (buffer << 6) | (index.get(ch) ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const BASE32_ALPHABETS: readonly Choice[] = [
  { label: 'Standard: A-Z2-7=', value: 'A-Z2-7=' },
  { label: 'Hex extended: 0-9A-V=', value: '0-9A-V=' },
];

function base32Encode(bytes: Uint8Array, spec: string): string {
  const alphabet = expandAlphabet(spec);
  const pad = alphabet[32] ?? '';
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  while (out.length % 8 !== 0 && pad) out += pad;
  return out;
}

function base32Decode(text: string, spec: string, remove: boolean): Uint8Array {
  const alphabet = expandAlphabet(spec).slice(0, 32);
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const raw of text) {
    const ch = alphabet.includes(raw) ? raw : raw.toUpperCase();
    const value = alphabet.indexOf(ch);
    if (value === -1) {
      if (raw === (expandAlphabet(spec)[32] ?? '=')) break;
      if (!remove && !/\s/.test(raw)) throw new OpError(`"${raw}" is not in the Base32 alphabet.`);
      continue;
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Base-N with arbitrary alphabets via BigInt (Base58, Base62); leading zero bytes become leading "zero" characters. */
export function baseNEncode(bytes: Uint8Array, alphabet: string): string {
  if (bytes.length === 0) return '';
  const base = BigInt(alphabet.length);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = (alphabet[Number(value % base)] ?? '') + out;
    value /= base;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = (alphabet[0] ?? '') + out;
  }
  return out;
}

export function baseNDecode(text: string, alphabet: string, remove = true): Uint8Array {
  const base = BigInt(alphabet.length);
  let value = 0n;
  let leading = 0;
  let started = false;
  for (const ch of text) {
    const digit = alphabet.indexOf(ch);
    if (digit === -1) {
      if (!remove && !/\s/.test(ch)) throw new OpError(`"${ch}" is not in the alphabet.`);
      continue;
    }
    if (!started && digit === 0) {
      leading++;
      continue;
    }
    started = true;
    value = value * base + BigInt(digit);
  }
  const out: number[] = [];
  while (value > 0n) {
    out.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  return Uint8Array.from([...new Array<number>(leading).fill(0), ...out]);
}

const BASE58_ALPHABETS: readonly Choice[] = [
  { label: 'Bitcoin', value: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz' },
  { label: 'Ripple', value: 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz' },
];

const BASE85_ALPHABETS: readonly Choice[] = [
  { label: 'Standard: !-u', value: '!-u' },
  { label: 'Z85 (ZeroMQ)', value: '0-9a-zA-Z.\\-:+=^!/*?&<>()[]{}@%$#' },
  { label: 'IPv6', value: '0-9A-Za-z!#$%&()*+\\-;<=>?@^_`{|}~' },
];

function base85Encode(bytes: Uint8Array, spec: string, wrap: boolean): string {
  const alphabet = expandAlphabet(spec);
  const standard = spec === '!-u';
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = [bytes[i] ?? 0, bytes[i + 1] ?? 0, bytes[i + 2] ?? 0, bytes[i + 3] ?? 0];
    const real = Math.min(4, bytes.length - i);
    let value = ((chunk[0] as number) * 2 ** 24 + ((chunk[1] as number) << 16) + ((chunk[2] as number) << 8) + (chunk[3] as number)) >>> 0;
    if (standard && value === 0 && real === 4) {
      out += 'z';
      continue;
    }
    const digits: string[] = [];
    for (let j = 0; j < 5; j++) {
      digits.unshift(alphabet[value % 85] ?? '');
      value = Math.floor(value / 85);
    }
    out += digits.slice(0, real + 1).join('');
  }
  return wrap ? `<~${out}~>` : out;
}

function base85Decode(text: string, spec: string, remove: boolean, zeroChar: string): Uint8Array {
  const alphabet = expandAlphabet(spec);
  let body = text.trim();
  if (body.startsWith('<~')) body = body.slice(2);
  if (body.endsWith('~>')) body = body.slice(0, -2);
  const out: number[] = [];
  let group: number[] = [];
  const flush = (count: number) => {
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const word = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...word.slice(0, count));
    group = [];
  };
  for (const ch of body) {
    if (zeroChar !== '' && ch === zeroChar && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const digit = alphabet.indexOf(ch);
    if (digit === -1) {
      if (!remove && !/\s/.test(ch)) throw new OpError(`"${ch}" is not in the Base85 alphabet.`);
      continue;
    }
    group.push(digit);
    if (group.length === 5) flush(4);
  }
  if (group.length > 0) flush(group.length - 1);
  return Uint8Array.from(out);
}

const BASE45 = '0-9A-Z $%*+\\-./:';

function base45Encode(bytes: Uint8Array, spec: string): string {
  const alphabet = expandAlphabet(spec);
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = (bytes[i] as number) * 256 + (bytes[i + 1] as number);
      const c = n % 45;
      n = (n - c) / 45;
      out += (alphabet[c] ?? '') + (alphabet[n % 45] ?? '') + (alphabet[Math.floor(n / 45)] ?? '');
    } else {
      const n = bytes[i] as number;
      out += (alphabet[n % 45] ?? '') + (alphabet[Math.floor(n / 45)] ?? '');
    }
  }
  return out;
}

function base45Decode(text: string, spec: string, remove: boolean): Uint8Array {
  const alphabet = expandAlphabet(spec);
  const digits: number[] = [];
  for (const ch of text) {
    const d = alphabet.indexOf(ch);
    if (d === -1) {
      if (!remove) throw new OpError(`"${ch}" is not in the Base45 alphabet.`);
      continue;
    }
    digits.push(d);
  }
  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    const group = digits.slice(i, i + 3);
    if (group.length === 3) {
      const n = (group[0] as number) + (group[1] as number) * 45 + (group[2] as number) * 2025;
      if (n > 65535) throw new OpError('The Base45 input is invalid.');
      out.push(n >> 8, n & 255);
    } else if (group.length === 2) {
      const n = (group[0] as number) + (group[1] as number) * 45;
      if (n > 255) throw new OpError('The Base45 input is invalid.');
      out.push(n);
    } else throw new OpError('The Base45 input has an invalid length.');
  }
  return Uint8Array.from(out);
}

const b92chr = (v: number) => (v === 0 ? '!' : v <= 61 ? String.fromCharCode(35 + v - 1) : String.fromCharCode(97 + v - 62));
const b92ord = (ch: string) => {
  const c = ch.charCodeAt(0);
  if (ch === '!') return 0;
  if (c >= 35 && c <= 95) return c - 35 + 1;
  if (c >= 97 && c <= 125) return c - 97 + 62;
  throw new OpError(`"${ch}" is not a Base92 character.`);
};

function base92Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '~';
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  while (bits.length >= 13) {
    const v = Number.parseInt(bits.slice(0, 13), 2);
    out += b92chr(Math.floor(v / 91)) + b92chr(v % 91);
    bits = bits.slice(13);
  }
  if (bits.length > 0) {
    if (bits.length < 7) out += b92chr(Number.parseInt(bits.padEnd(6, '0'), 2));
    else {
      const v = Number.parseInt(bits.padEnd(13, '0'), 2);
      out += b92chr(Math.floor(v / 91)) + b92chr(v % 91);
    }
  }
  return out;
}

function base92Decode(text: string): Uint8Array {
  if (text === '~' || text === '') return new Uint8Array(0);
  let bits = '';
  let i = 0;
  for (; i + 1 < text.length; i += 2) bits += (b92ord(text[i] as string) * 91 + b92ord(text[i + 1] as string)).toString(2).padStart(13, '0');
  if (i < text.length)
    bits += b92ord(text[i] as string)
      .toString(2)
      .padStart(6, '0');
  const out: number[] = [];
  for (let j = 0; j + 8 <= bits.length; j += 8) out.push(Number.parseInt(bits.slice(j, j + 8), 2));
  return Uint8Array.from(out);
}

/* ------------------------------------------------------------ punycode -- */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

const digitChar = (d: number) => String.fromCharCode(d + 22 + 75 * Number(d < 26));

export function punycodeEncode(input: string): string {
  const points = Array.from(input, (ch) => ch.codePointAt(0) as number);
  let n = 128;
  let delta = 0;
  let bias = 72;
  let output = points
    .filter((cp) => cp < 128)
    .map((cp) => String.fromCharCode(cp))
    .join('');
  const basic = output.length;
  let handled = basic;
  if (basic > 0) output += '-';
  while (handled < points.length) {
    let m = Number.MAX_SAFE_INTEGER;
    for (const cp of points) if (cp >= n && cp < m) m = cp;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const cp of points) {
      if (cp < n) delta++;
      if (cp === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
          if (q < t) break;
          output += digitChar(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digitChar(q);
        bias = adapt(delta, handled + 1, handled === basic);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}

export function punycodeDecode(input: string): string {
  const output: number[] = [];
  let n = 128;
  let i = 0;
  let bias = 72;
  let basic = input.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j));
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) throw new OpError('The Punycode input is invalid.');
      const code = input.charCodeAt(index++);
      const digit = code - 48 < 10 ? code - 22 : code - 65 < 26 ? code - 65 : code - 97 < 26 ? code - 97 : BASE;
      if (digit >= BASE) throw new OpError('The Punycode input is invalid.');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const size = output.length + 1;
    bias = adapt(i - oldi, size, oldi === 0);
    n += Math.floor(i / size);
    i %= size;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/* ----------------------------------------------------- character sets -- */

const WHATWG: readonly [string, string][] = [
  ['UTF-8 (65001)', 'utf-8'],
  ['UTF-16LE (1200)', 'utf-16le'],
  ['UTF-16BE (1201)', 'utf-16be'],
  ['UTF-32LE (12000)', 'utf-32le'],
  ['UTF-32BE (12001)', 'utf-32be'],
  ['ISO-8859-1 Latin 1 Western European (28591)', 'latin1-true'],
  ['ISO-8859-2 Latin 2 Central European (28592)', 'iso-8859-2'],
  ['ISO-8859-3 Latin 3 South European (28593)', 'iso-8859-3'],
  ['ISO-8859-4 Latin 4 North European (28594)', 'iso-8859-4'],
  ['ISO-8859-5 Latin/Cyrillic (28595)', 'iso-8859-5'],
  ['ISO-8859-6 Latin/Arabic (28596)', 'iso-8859-6'],
  ['ISO-8859-7 Latin/Greek (28597)', 'iso-8859-7'],
  ['ISO-8859-8 Latin/Hebrew (28598)', 'iso-8859-8'],
  ['ISO-8859-10 Latin 6 Nordic (28600)', 'iso-8859-10'],
  ['ISO-8859-13 Latin 7 Baltic Rim (28603)', 'iso-8859-13'],
  ['ISO-8859-14 Latin 8 Celtic (28604)', 'iso-8859-14'],
  ['ISO-8859-15 Latin 9 (28605)', 'iso-8859-15'],
  ['ISO-8859-16 Latin 10 (28606)', 'iso-8859-16'],
  ['Windows-874 Thai (874)', 'windows-874'],
  ['Windows-1250 Central European (1250)', 'windows-1250'],
  ['Windows-1251 Cyrillic (1251)', 'windows-1251'],
  ['Windows-1252 Latin 1 (1252)', 'windows-1252'],
  ['Windows-1253 Greek (1253)', 'windows-1253'],
  ['Windows-1254 Turkish (1254)', 'windows-1254'],
  ['Windows-1255 Hebrew (1255)', 'windows-1255'],
  ['Windows-1256 Arabic (1256)', 'windows-1256'],
  ['Windows-1257 Baltic (1257)', 'windows-1257'],
  ['Windows-1258 Vietnamese (1258)', 'windows-1258'],
  ['KOI8-R Russian Cyrillic (20866)', 'koi8-r'],
  ['KOI8-U Ukrainian Cyrillic (21866)', 'koi8-u'],
  ['IBM-866 Russian Cyrillic (866)', 'ibm866'],
  ['Mac Roman (10000)', 'macintosh'],
  ['Mac Cyrillic (10007)', 'x-mac-cyrillic'],
  ['Shift-JIS Japanese (932)', 'shift_jis'],
  ['EUC-JP Japanese (20932)', 'euc-jp'],
  ['ISO-2022-JP Japanese (50220)', 'iso-2022-jp'],
  ['GBK Simplified Chinese (936)', 'gbk'],
  ['GB18030 Simplified Chinese (54936)', 'gb18030'],
  ['Big5 Traditional Chinese (950)', 'big5'],
  ['EUC-KR Korean (949)', 'euc-kr'],
  ['IBM-437 US DOS (437)', 'cp437'],
  ['IBM EBCDIC US-Canada (37)', 'ebcdic037'],
];
export const CHARSETS = WHATWG.map(([name]) => name);
const charsetId = (name: string) => WHATWG.find(([label]) => label === name)?.[1] ?? 'utf-8';

const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0';
const EBCDIC037 =
  '\u0000\u0001\u0002\u0003\u009c\t\u0086\u007f\u0097\u008d\u008e\u000b\f\r\u000e\u000f\u0010\u0011\u0012\u0013\u009d\u0085\b\u0087\u0018\u0019\u0092\u008f\u001c\u001d\u001e\u001f\u0080\u0081\u0082\u0083\u0084\n\u0017\u001b\u0088\u0089\u008a\u008b\u008c\u0005\u0006\u0007\u0090\u0091\u0016\u0093\u0094\u0095\u0096\u0004\u0098\u0099\u009a\u009b\u0014\u0015\u009e\u001a \u00A0âäàáãåçñ¢.<(+|&éêëèíîïìß!$*);¬-/ÂÄÀÁÃÅÇÑ¦,%_>?øÉÊËÈÍÎÏÌ`:#@\'="Øabcdefghi«»ðýþ±°jklmnopqrªºæ¸Æ¤µ~stuvwxyz¡¿ÐÝÞ®^£¥·©§¶¼½¾[]¯¨´×{ABCDEFGHI\u00ADôöòóõ}JKLMNOPQR¹ûüùúÿ\\÷STUVWXYZ²ÔÖÒÓÕ0123456789³ÛÜÙÚ\u009f';

function tableDecode(bytes: Uint8Array, id: string): string | null {
  if (id === 'latin1-true') return bytesToLatin1(bytes);
  if (id === 'cp437') return Array.from(bytes, (b) => (b < 128 ? String.fromCharCode(b) : (CP437_HIGH[b - 128] ?? '?'))).join('');
  if (id === 'ebcdic037') return Array.from(bytes, (b) => EBCDIC037[b] ?? '?').join('');
  if (id === 'utf-32le' || id === 'utf-32be') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let out = '';
    for (let i = 0; i + 4 <= bytes.length; i += 4) {
      const cp = view.getUint32(i, id === 'utf-32le');
      out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '\uFFFD';
    }
    return out;
  }
  return null;
}

export function decodeCharset(bytes: Uint8Array, name: string): string {
  const id = charsetId(name);
  return tableDecode(bytes, id) ?? new TextDecoder(id).decode(bytes);
}

const reverseMaps = new Map<string, Map<string, number[]>>();

function reverseMap(id: string): Map<string, number[]> {
  const cached = reverseMaps.get(id);
  if (cached) return cached;
  const map = new Map<string, number[]>();
  const single = (b: number, ch: string) => {
    if (ch !== '\uFFFD' && !map.has(ch)) map.set(ch, [b]);
  };
  if (id === 'cp437' || id === 'ebcdic037') {
    for (let b = 0; b < 256; b++) single(b, tableDecode(Uint8Array.of(b), id) ?? '');
  } else {
    const decoder = new TextDecoder(id, { fatal: true });
    for (let b = 0; b < 256; b++) {
      try {
        single(b, decoder.decode(Uint8Array.of(b)));
      } catch {
        // lead byte of a multi-byte sequence
      }
    }
    if (['shift_jis', 'euc-jp', 'gbk', 'gb18030', 'big5', 'euc-kr'].includes(id)) {
      for (let lead = 0x81; lead <= 0xfe; lead++) {
        for (let trail = 0x40; trail <= 0xfe; trail++) {
          try {
            const ch = decoder.decode(Uint8Array.of(lead, trail));
            if (ch.length >= 1 && !map.has(ch)) map.set(ch, [lead, trail]);
          } catch {
            // not a valid pair
          }
        }
      }
    }
  }
  reverseMaps.set(id, map);
  return map;
}

export function encodeCharset(text: string, name: string): Uint8Array {
  const id = charsetId(name);
  if (id === 'utf-8') return utf8(text);
  if (id === 'latin1-true') return latin1ToBytes(text);
  if (id === 'utf-16le' || id === 'utf-16be') {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      out[i * 2 + (id === 'utf-16le' ? 0 : 1)] = code & 255;
      out[i * 2 + (id === 'utf-16le' ? 1 : 0)] = code >> 8;
    }
    return out;
  }
  if (id === 'utf-32le' || id === 'utf-32be') {
    const points = Array.from(text, (ch) => ch.codePointAt(0) as number);
    const out = new Uint8Array(points.length * 4);
    const view = new DataView(out.buffer);
    for (const [i, cp] of points.entries()) view.setUint32(i * 4, cp, id === 'utf-32le');
    return out;
  }
  if (id === 'iso-2022-jp') throw new OpError('Encoding to ISO-2022-JP is not supported; choose Shift-JIS or EUC-JP.');
  const map = reverseMap(id);
  const out: number[] = [];
  for (const ch of text) {
    const bytes = map.get(ch);
    out.push(...(bytes ?? [0x3f]));
  }
  return Uint8Array.from(out);
}

/* ------------------------------------------------------------- CBOR -- */

function cborEncode(value: unknown): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number | bigint) => {
    const big = BigInt(n);
    if (big < 24n) out.push((major << 5) | Number(big));
    else if (big < 256n) out.push((major << 5) | 24, Number(big));
    else if (big < 65536n) out.push((major << 5) | 25, Number(big >> 8n), Number(big & 255n));
    else if (big < 4294967296n) out.push((major << 5) | 26, ...[24n, 16n, 8n, 0n].map((s) => Number((big >> s) & 255n)));
    else out.push((major << 5) | 27, ...[56n, 48n, 40n, 32n, 24n, 16n, 8n, 0n].map((s) => Number((big >> s) & 255n)));
  };
  const write = (v: unknown): void => {
    if (v === null) out.push(0xf6);
    else if (v === undefined) out.push(0xf7);
    else if (v === false) out.push(0xf4);
    else if (v === true) out.push(0xf5);
    else if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) {
        if (v >= 0) head(0, v);
        else head(1, -1 - v);
      } else {
        const buf = new DataView(new ArrayBuffer(8));
        buf.setFloat64(0, v);
        out.push(0xfb, ...new Uint8Array(buf.buffer));
      }
    } else if (typeof v === 'string') {
      const bytes = utf8(v);
      head(3, bytes.length);
      out.push(...bytes);
    } else if (Array.isArray(v)) {
      head(4, v.length);
      for (const item of v) write(item);
    } else if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      head(5, entries.length);
      for (const [key, item] of entries) {
        write(key);
        write(item);
      }
    }
  };
  write(value);
  return Uint8Array.from(out);
}

function cborDecode(bytes: Uint8Array): unknown {
  let at = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (n: number) => {
    if (at + n > bytes.length) throw new OpError('The CBOR data ends early.');
  };
  const length = (info: number): number => {
    if (info < 24) return info;
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (size === -1) throw new OpError('Indefinite-length CBOR items are not supported.');
    need(size);
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + (bytes[at + i] as number);
    at += size;
    return n;
  };
  const read = (): unknown => {
    need(1);
    const first = bytes[at++] as number;
    const major = first >> 5;
    const info = first & 31;
    switch (major) {
      case 0:
        return length(info);
      case 1:
        return -1 - length(info);
      case 2: {
        const n = length(info);
        need(n);
        const value = hex(bytes.subarray(at, at + n));
        at += n;
        return { bytes: value };
      }
      case 3: {
        const n = length(info);
        need(n);
        const value = new TextDecoder().decode(bytes.subarray(at, at + n));
        at += n;
        return value;
      }
      case 4: {
        const n = length(info);
        return Array.from({ length: n }, () => read());
      }
      case 5: {
        const n = length(info);
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const key = read();
          obj[typeof key === 'string' ? key : JSON.stringify(key)] = read();
        }
        return obj;
      }
      case 6: {
        const tag = length(info);
        return { tag, value: read() };
      }
      default: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        if (info === 25) {
          need(2);
          const half = view.getUint16(at);
          at += 2;
          const exp = (half >> 10) & 31;
          const frac = half & 1023;
          const value = exp === 0 ? frac * 2 ** -24 : exp === 31 ? (frac ? Number.NaN : Number.POSITIVE_INFINITY) : (1 + frac / 1024) * 2 ** (exp - 15);
          return half & 0x8000 ? -value : value;
        }
        if (info === 26) {
          need(4);
          const value = view.getFloat32(at);
          at += 4;
          return value;
        }
        if (info === 27) {
          need(8);
          const value = view.getFloat64(at);
          at += 8;
          return value;
        }
        return info;
      }
    }
  };
  return read();
}

/* ------------------------------------------------------------- rison -- */

function risonEncode(value: unknown): string {
  if (value === null) return '!n';
  if (value === true) return '!t';
  if (value === false) return '!f';
  if (typeof value === 'number') return String(value).replace(/\+/g, '');
  if (typeof value === 'string') {
    if (value !== '' && /^[^-0-9 '!:(),*@$][^ '!:(),*@$]*$/.test(value)) return value;
    return `'${value.replace(/[!']/g, '!$&')}'`;
  }
  if (Array.isArray(value)) return `!(${value.map(risonEncode).join(',')})`;
  if (typeof value === 'object') {
    return `(${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${risonEncode(k)}:${risonEncode(v)}`)
      .join(',')})`;
  }
  return '!n';
}

function risonDecode(text: string): unknown {
  let at = 0;
  const peek = () => text[at];
  const next = () => text[at++];
  const value = (): unknown => {
    const ch = next();
    if (ch === '!') {
      const code = next();
      if (code === 't') return true;
      if (code === 'f') return false;
      if (code === 'n') return null;
      if (code === '(') {
        const items: unknown[] = [];
        while (peek() !== ')') {
          if (at >= text.length) throw new OpError('Unclosed Rison array.');
          items.push(value());
          if (peek() === ',') at++;
        }
        at++;
        return items;
      }
      throw new OpError(`Unknown Rison literal "!${code}".`);
    }
    if (ch === '(') {
      const obj: Record<string, unknown> = {};
      while (peek() !== ')') {
        if (at >= text.length) throw new OpError('Unclosed Rison object.');
        const key = value();
        if (next() !== ':') throw new OpError('Expected ":" in a Rison object.');
        obj[String(key)] = value();
        if (peek() === ',') at++;
      }
      at++;
      return obj;
    }
    if (ch === "'") {
      let out = '';
      for (;;) {
        const c = next();
        if (c === undefined) throw new OpError('Unclosed Rison string.');
        if (c === "'") break;
        if (c === '!') out += next() ?? '';
        else out += c;
      }
      return out;
    }
    at--;
    const match = /^-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/.exec(text.slice(at));
    if (match && match[0] !== '' && match[0] !== '-') {
      at += match[0].length;
      return Number(match[0]);
    }
    const id = /^[^ '!:(),*@$]+/.exec(text.slice(at));
    if (!id) throw new OpError(`Unexpected "${peek()}" in Rison.`);
    at += id[0].length;
    return id[0];
  };
  return value();
}

/* ----------------------------------------------------------- ASN.1 dump -- */

const UNIVERSAL: Record<number, string> = {
  1: 'BOOLEAN',
  2: 'INTEGER',
  3: 'BIT STRING',
  4: 'OCTET STRING',
  5: 'NULL',
  6: 'OBJECT IDENTIFIER',
  10: 'ENUMERATED',
  12: 'UTF8String',
  16: 'SEQUENCE',
  17: 'SET',
  19: 'PrintableString',
  20: 'TeletexString',
  22: 'IA5String',
  23: 'UTCTime',
  24: 'GeneralizedTime',
  26: 'VisibleString',
  30: 'BMPString',
};

export function asn1Dump(node: Der, truncate: number, depth = 0): string {
  const pad = '  '.repeat(depth);
  const name =
    node.tagClass === 0 ? (UNIVERSAL[node.tagNumber] ?? `[UNIVERSAL ${node.tagNumber}]`) : `[${node.tagClass === 2 ? '' : node.tagClass === 1 ? 'APPLICATION ' : 'PRIVATE '}${node.tagNumber}]`;
  let line = `${pad}${name}`;
  if (node.constructed) {
    return [line, ...node.children.map((child) => asn1Dump(child, truncate, depth + 1))].join('\n');
  }
  const content = node.content;
  if (node.tagClass === 0) {
    switch (node.tagNumber) {
      case 1:
        line += ` ${content[0] ? 'TRUE' : 'FALSE'}`;
        break;
      case 2:
      case 10:
        line += ` ${content.length <= 6 ? Number.parseInt(hex(content) || '0', 16) : hex(content)}`;
        break;
      case 5:
        break;
      case 6: {
        const oid = decodeOid(content);
        const label = oidName(oid);
        line += ` ${oid}${label && label !== oid ? ` (${label})` : ''}`;
        break;
      }
      case 12:
      case 19:
      case 20:
      case 22:
      case 23:
      case 24:
      case 26:
        line += ` '${new TextDecoder().decode(content)}'`;
        break;
      default: {
        const shown = truncate > 0 && content.length > truncate ? `${hex(content.subarray(0, truncate))}…(${content.length} bytes)` : hex(content);
        line += ` ${shown}`;
      }
    }
  } else line += ` ${hex(content)}`;
  return line;
}

/* ------------------------------------------------------- quoted printable -- */

function toQuotedPrintable(bytes: Uint8Array): string {
  const lines: string[] = [];
  let line = '';
  const push = (token: string) => {
    if (line.length + token.length > 75) {
      lines.push(`${line}=`);
      line = '';
    }
    line += token;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      lines.push(line.replace(/[ \t]$/, (c) => `=${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`));
      line = '';
      i++;
      continue;
    }
    if (b === 0x0a) {
      lines.push(line);
      line = '';
      continue;
    }
    const printable = (b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9;
    push(printable ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`);
  }
  lines.push(line);
  return lines.join('\r\n');
}

function fromQuotedPrintable(text: string): Uint8Array {
  const clean = text.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] as string;
    if (ch === '=' && /^[0-9a-f]{2}$/i.test(clean.slice(i + 1, i + 3))) {
      out.push(Number.parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      if (code > 255) out.push(...utf8(ch));
      else out.push(code);
    }
  }
  return Uint8Array.from(out);
}

/* ---------------------------------------------------------- hexdump -- */

function toHexdump(bytes: Uint8Array, width: number, upper: boolean, finalLength: boolean, unix: boolean): string {
  const w = Math.max(1, Math.round(width));
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += w) {
    const row = bytes.subarray(at, at + w);
    let hexPart = '';
    for (let i = 0; i < w; i++) {
      const b = row[i];
      hexPart += b === undefined ? '   ' : `${b.toString(16).padStart(2, '0')} `;
      if (unix && i === Math.floor(w / 2) - 1 && w >= 2) hexPart += ' ';
    }
    if (upper) hexPart = hexPart.toUpperCase();
    const ascii = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${at.toString(16).padStart(8, '0')}  ${hexPart} |${ascii}|`);
  }
  if (finalLength) lines.push(bytes.length.toString(16).padStart(8, '0'));
  return lines.join('\n');
}

function fromHexdump(text: string): Uint8Array {
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/^\s*[0-9a-f]{4,16}h?:?(?=\s)/i, '');
    const bar = line.indexOf('|');
    if (bar !== -1) line = line.slice(0, bar);
    else {
      const gap = /\S(\s{2,})\S/.exec(line.trimStart());
      if (gap) line = line.trimStart().slice(0, gap.index + 1);
    }
    for (const token of line.trim().split(/\s+/)) {
      if (/^(?:[0-9a-f]{2})+$/i.test(token)) out.push(...hexToBytes(token));
      else if (/^[0-9a-f]{2}-[0-9a-f]{2}$/i.test(token)) out.push(...hexToBytes(token.replace('-', '')));
    }
  }
  return Uint8Array.from(out);
}

/* ---------------------------------------------------------------- BCD -- */

const BCD_SCHEMES: Record<string, number[]> = {
  '8 4 2 1': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  '7 4 2 1': [0, 1, 2, 3, 4, 5, 6, 8, 9, 10],
  '4 2 2 1': [0, 1, 4, 5, 8, 9, 12, 13, 14, 15],
  '2 4 2 1': [0, 1, 2, 3, 4, 11, 12, 13, 14, 15],
  '8 4 -2 -1': [0, 7, 6, 5, 4, 11, 10, 9, 8, 15],
  'Excess-3': [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  'IBM 8 4 2 1': [10, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

/* ---------------------------------------------------------------- braille -- */

const BRAILLE_ASCII = ' A1B\'K2L@CIF/MSP"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=';

/* ----------------------------------------------------------- operations -- */

const hexDelimArg = sel('delimiter', 'Delimiter', HEX_DELIMS, 'Space');
const DECIMAL_DELIMS = [...DELIMITERS];

export const dataFormatOps: Operation[] = [
  defineOp({
    name: 'To Hexdump',
    category: C,
    description: 'Shows bytes as a hex dump with offsets and printable characters.',
    input: 'bytes',
    output: 'text',
    args: [num('width', 'Width', 16, { min: 1 }), bool('upper', 'Upper case hex'), bool('finalLength', 'Include final length'), bool('unix', 'UNIX format')],
    run: (input, a) => toHexdump(input, nArg(a, 'width'), bArg(a, 'upper'), bArg(a, 'finalLength'), bArg(a, 'unix')),
  }),
  defineOp({
    name: 'From Hexdump',
    category: C,
    description: 'Reads the bytes back out of a hex dump (xxd, hexdump -C, od and similar).',
    input: 'text',
    output: 'bytes',
    magic: [{ pattern: /^(?:(?:[\dA-F]{4,16}h?:?)?[ \t]*((?:[\dA-F]{2} ){1,8}(?:[ \t]|[\dA-F]{2}-)(?:[\dA-F]{2} ){1,8}|(?:[\dA-F]{4} )*[\dA-F]{4}|(?:[\dA-F]{2} )*[\dA-F]{2})[^\n]*\n?){2,}$/i }],
    run: (input) => fromHexdump(input),
  }),
  defineOp({
    name: 'To Hex',
    category: C,
    description: 'Writes each byte as two hexadecimal digits.',
    input: 'bytes',
    output: 'text',
    keywords: ['base16'],
    args: [hexDelimArg, num('perLine', 'Bytes per line', 0, { min: 0 })],
    run: (input, a) => toHexDelimited(input, sArg(a, 'delimiter'), nArg(a, 'perLine')),
  }),
  defineOp({
    name: 'From Hex',
    category: C,
    description: 'Turns hexadecimal digits back into bytes.',
    input: 'text',
    output: 'bytes',
    keywords: ['base16'],
    args: [sel('delimiter', 'Delimiter', ['Auto', ...HEX_DELIMS], 'Auto')],
    magic: [
      { pattern: /^(?:[\dA-F]{2})+$/i, args: { delimiter: 'None' } },
      { pattern: /^[\dA-F]{2}(?: [\dA-F]{2})*$/i, args: { delimiter: 'Space' } },
      { pattern: /^[\dA-F]{2}(?:,[\dA-F]{2})*$/i, args: { delimiter: 'Comma' } },
      { pattern: /^[\dA-F]{2}(?::[\dA-F]{2})*$/i, args: { delimiter: 'Colon' } },
      { pattern: /^[\dA-F]{2}(?:\n[\dA-F]{2})*$/i, args: { delimiter: 'Line feed' } },
      { pattern: /^(?:0x[\dA-F]{2})+$/i, args: { delimiter: '0x' } },
      { pattern: /^0x[\dA-F]{2}(?:,0x[\dA-F]{2})*$/i, args: { delimiter: '0x with comma' } },
      { pattern: /^(?:\\x[\dA-F]{2})+$/i, args: { delimiter: '\\x' } },
    ],
    run: (input, a) => fromHexDelimited(input, sArg(a, 'delimiter')),
  }),
  defineOp({
    name: 'To Charcode',
    category: C,
    description: 'Writes the Unicode code point of each character in a chosen base.',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', DECIMAL_DELIMS), num('base', 'Base', 16, { min: 2, max: 36 })],
    run: (input, a) => {
      const base = nArg(a, 'base');
      return Array.from(input, (ch) => {
        const cp = ch.codePointAt(0) as number;
        const text = cp.toString(base);
        if (base !== 16) return text;
        return text.padStart(cp < 256 ? 2 : cp < 65536 ? 4 : 6, '0');
      }).join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'From Charcode',
    category: C,
    description: 'Turns code points written in a chosen base back into characters.',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', DECIMAL_DELIMS), num('base', 'Base', 16, { min: 2, max: 36 })],
    run: (input, a) => {
      const base = nArg(a, 'base');
      return numbersFrom(input, sArg(a, 'delimiter'))
        .map((part) => {
          const cp = Number.parseInt(part, base);
          if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) throw new OpError(`"${part}" is not a valid character code.`);
          return String.fromCodePoint(cp);
        })
        .join('');
    },
  }),
  defineOp({
    name: 'To Decimal',
    category: C,
    description: 'Writes each byte as a decimal number.',
    input: 'bytes',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', DECIMAL_DELIMS), bool('signed', 'Support signed values')],
    run: (input, a) => Array.from(input, (b) => (bArg(a, 'signed') && b > 127 ? b - 256 : b)).join(delimiter(sArg(a, 'delimiter'))),
  }),
  defineOp({
    name: 'From Decimal',
    category: C,
    description: 'Turns decimal numbers (0–255, or −128–127) back into bytes.',
    input: 'text',
    output: 'bytes',
    args: [sel('delimiter', 'Delimiter', ['Auto', ...DECIMAL_DELIMS], 'Auto'), bool('signed', 'Support signed values')],
    magic: [
      { pattern: /^(?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5])(?: (?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5]))+$/, args: { delimiter: 'Space' } },
      { pattern: /^(?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5])(?:,(?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5]))+$/, args: { delimiter: 'Comma' } },
    ],
    run: (input, a) =>
      Uint8Array.from(
        numbersFrom(input, sArg(a, 'delimiter')).map((part) => {
          const n = Number(part);
          if (!Number.isInteger(n) || n < -128 || n > 255) throw new OpError(`"${part}" is not a byte value.`);
          return n < 0 ? n + 256 : n;
        }),
      ),
  }),
  defineOp({
    name: 'To Float',
    category: C,
    description: 'Reads the bytes as IEEE 754 floating-point numbers.',
    input: 'bytes',
    output: 'text',
    args: [sel('endianness', 'Endianness', ['Big Endian', 'Little Endian']), sel('size', 'Size', ['Float (4 bytes)', 'Double (8 bytes)']), sel('delimiter', 'Delimiter', DECIMAL_DELIMS)],
    run: (input, a) => {
      const size = sArg(a, 'size').startsWith('Double') ? 8 : 4;
      const little = sArg(a, 'endianness') === 'Little Endian';
      if (input.length % size !== 0) throw new OpError(`The input must be a multiple of ${size} bytes.`);
      const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
      const values: number[] = [];
      for (let i = 0; i < input.length; i += size) values.push(size === 8 ? view.getFloat64(i, little) : view.getFloat32(i, little));
      return values.join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'From Float',
    category: C,
    description: 'Writes numbers as IEEE 754 floating-point bytes.',
    input: 'text',
    output: 'bytes',
    args: [sel('endianness', 'Endianness', ['Big Endian', 'Little Endian']), sel('size', 'Size', ['Float (4 bytes)', 'Double (8 bytes)']), sel('delimiter', 'Delimiter', DECIMAL_DELIMS)],
    run: (input, a) => {
      const size = sArg(a, 'size').startsWith('Double') ? 8 : 4;
      const little = sArg(a, 'endianness') === 'Little Endian';
      const numbers = numbersFrom(input, sArg(a, 'delimiter')).map(Number);
      const out = new Uint8Array(numbers.length * size);
      const view = new DataView(out.buffer);
      for (const [i, n] of numbers.entries()) {
        if (size === 8) view.setFloat64(i * 8, n, little);
        else view.setFloat32(i * 4, n, little);
      }
      return out;
    },
  }),
  defineOp({
    name: 'To Binary',
    category: C,
    description: 'Writes each byte as binary digits.',
    input: 'bytes',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', [...DECIMAL_DELIMS, 'None']), num('length', 'Byte Length', 8, { min: 1, max: 64 })],
    run: (input, a) => Array.from(input, (b) => b.toString(2).padStart(nArg(a, 'length'), '0')).join(delimiter(sArg(a, 'delimiter'))),
  }),
  defineOp({
    name: 'From Binary',
    category: C,
    description: 'Turns binary digits back into bytes.',
    input: 'text',
    output: 'bytes',
    args: [sel('delimiter', 'Delimiter', [...DECIMAL_DELIMS, 'None']), num('length', 'Byte Length', 8, { min: 1, max: 64 })],
    magic: [
      { pattern: /^(?:[01]{8})+$/, args: { delimiter: 'None' } },
      { pattern: /^(?:[01]{8})(?: [01]{8})*$/, args: { delimiter: 'Space' } },
      { pattern: /^(?:[01]{8})(?:,[01]{8})*$/, args: { delimiter: 'Comma' } },
      { pattern: /^(?:[01]{8})(?:\n[01]{8})*$/, args: { delimiter: 'Line feed' } },
    ],
    run: (input, a) => {
      const width = nArg(a, 'length') || 8;
      const bits = input.replace(/[^01]/g, '');
      const out: number[] = [];
      for (let i = 0; i + width <= bits.length; i += width) out.push(Number.parseInt(bits.slice(i, i + width), 2) & 0xff);
      return Uint8Array.from(out);
    },
  }),
  defineOp({
    name: 'To Octal',
    category: C,
    description: 'Writes each byte as an octal number.',
    input: 'bytes',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', DECIMAL_DELIMS)],
    run: (input, a) => Array.from(input, (b) => b.toString(8)).join(delimiter(sArg(a, 'delimiter'))),
  }),
  defineOp({
    name: 'From Octal',
    category: C,
    description: 'Turns octal numbers back into bytes.',
    input: 'text',
    output: 'bytes',
    args: [sel('delimiter', 'Delimiter', DECIMAL_DELIMS)],
    magic: [{ pattern: /^(?:[0-7]{1,2}|[123][0-7]{2})(?: (?:[0-7]{1,2}|[123][0-7]{2}))+$/, args: { delimiter: 'Space' } }],
    run: (input, a) => Uint8Array.from(numbersFrom(input, sArg(a, 'delimiter')).map((part) => Number.parseInt(part, 8) & 0xff)),
  }),
  defineOp({
    name: 'To Base32',
    category: C,
    description: 'Encodes bytes as Base32.',
    input: 'bytes',
    output: 'text',
    args: [editable('alphabet', 'Alphabet', BASE32_ALPHABETS)],
    run: (input, a) => base32Encode(input, sArg(a, 'alphabet')),
  }),
  defineOp({
    name: 'From Base32',
    category: C,
    description: 'Decodes Base32.',
    input: 'text',
    output: 'bytes',
    args: [editable('alphabet', 'Alphabet', BASE32_ALPHABETS), bool('remove', 'Remove non-alphabet chars', true)],
    magic: [
      { pattern: /^(?:[A-Z2-7]{8})+(?:[A-Z2-7]{2}={6}|[A-Z2-7]{4}={4}|[A-Z2-7]{5}={3}|[A-Z2-7]{7}={1})?$/, args: { alphabet: 'A-Z2-7=' } },
      { pattern: /^(?:[0-9A-V]{8})+(?:[0-9A-V]{2}={6}|[0-9A-V]{4}={4}|[0-9A-V]{5}={3}|[0-9A-V]{7}={1})?$/, args: { alphabet: '0-9A-V=' } },
    ],
    run: (input, a) => base32Decode(input, sArg(a, 'alphabet'), bArg(a, 'remove')),
  }),
  defineOp({
    name: 'To Base45',
    category: C,
    description: 'Encodes bytes as Base45 (RFC 9285, used in EU vaccination QR codes).',
    input: 'bytes',
    output: 'text',
    args: [str('alphabet', 'Alphabet', BASE45)],
    run: (input, a) => base45Encode(input, sArg(a, 'alphabet')),
  }),
  defineOp({
    name: 'From Base45',
    category: C,
    description: 'Decodes Base45.',
    input: 'text',
    output: 'bytes',
    args: [str('alphabet', 'Alphabet', BASE45), bool('remove', 'Remove non-alphabet chars', true)],
    run: (input, a) => base45Decode(input, sArg(a, 'alphabet'), bArg(a, 'remove')),
  }),
  defineOp({
    name: 'To Base58',
    category: C,
    description: 'Encodes bytes as Base58 (Bitcoin or Ripple alphabet).',
    input: 'bytes',
    output: 'text',
    args: [editable('alphabet', 'Alphabet', BASE58_ALPHABETS)],
    run: (input, a) => baseNEncode(input, expandAlphabet(sArg(a, 'alphabet'))),
  }),
  defineOp({
    name: 'From Base58',
    category: C,
    description: 'Decodes Base58.',
    input: 'text',
    output: 'bytes',
    args: [editable('alphabet', 'Alphabet', BASE58_ALPHABETS), bool('remove', 'Remove non-alphabet chars', true)],
    magic: [{ pattern: /^[1-9A-HJ-NP-Za-km-z]{20,}$/, args: { alphabet: BASE58_ALPHABETS[0]?.value ?? '' } }],
    run: (input, a) => baseNDecode(input, expandAlphabet(sArg(a, 'alphabet')), bArg(a, 'remove')),
  }),
  defineOp({
    name: 'To Base62',
    category: C,
    description: 'Encodes bytes as Base62.',
    input: 'bytes',
    output: 'text',
    args: [str('alphabet', 'Alphabet', '0-9A-Za-z')],
    run: (input, a) => baseNEncode(input, expandAlphabet(sArg(a, 'alphabet'))),
  }),
  defineOp({
    name: 'From Base62',
    category: C,
    description: 'Decodes Base62.',
    input: 'text',
    output: 'bytes',
    args: [str('alphabet', 'Alphabet', '0-9A-Za-z')],
    run: (input, a) => baseNDecode(input, expandAlphabet(sArg(a, 'alphabet'))),
  }),
  defineOp({
    name: 'To Base64',
    category: C,
    description: 'Encodes bytes as Base64, with a choice of alphabets.',
    input: 'bytes',
    output: 'text',
    args: [editable('alphabet', 'Alphabet', BASE64_ALPHABETS)],
    run: (input, a) => base64Encode(input, sArg(a, 'alphabet')),
  }),
  defineOp({
    name: 'From Base64',
    category: C,
    description: 'Decodes Base64, with a choice of alphabets.',
    input: 'text',
    output: 'bytes',
    args: [editable('alphabet', 'Alphabet', BASE64_ALPHABETS), bool('remove', 'Remove non-alphabet chars', true), bool('strict', 'Strict mode')],
    magic: [
      { pattern: /^\s*(?:[A-Z\d+/]{4})+(?:[A-Z\d+/]{2}==|[A-Z\d+/]{3}=)?\s*$/i, args: { alphabet: 'A-Za-z0-9+/=' } },
      { pattern: /^\s*[A-Z\d\-_]{20,}\s*$/i, args: { alphabet: 'A-Za-z0-9\\-_' } },
    ],
    run: (input, a) => base64Decode(input, sArg(a, 'alphabet'), bArg(a, 'remove'), bArg(a, 'strict')),
  }),
  defineOp({
    name: 'Show Base64 offsets',
    category: C,
    description: 'Shows the three Base64 forms of some data, one per byte offset, for searching encoded logs.',
    input: 'bytes',
    output: 'text',
    args: [str('alphabet', 'Alphabet', 'A-Za-z0-9+/='), bool('showVariable', 'Show variable chars and padding', true), sel('format', 'Input format', ['Raw', 'Base64'])],
    run: (input, a) => {
      const alphabet = sArg(a, 'alphabet');
      const data = sArg(a, 'format') === 'Base64' ? base64Decode(bytesToLatin1(input), alphabet) : input;
      const lines: string[] = [];
      for (let offset = 0; offset < 3; offset++) {
        const encoded = base64Encode(Uint8Array.from([...new Array<number>(offset).fill(0), ...data]), alphabet);
        const lead = offset === 0 ? 0 : offset === 1 ? 2 : 3;
        const total = offset + data.length;
        const tailVar = total % 3 === 0 ? 0 : total % 3 === 1 ? 3 : 2;
        const fixedEnd = encoded.length - tailVar;
        const fixed = encoded.slice(lead, fixedEnd);
        lines.push(
          bArg(a, 'showVariable')
            ? `Offset ${offset}: ${encoded.slice(offset === 0 ? 0 : offset === 1 ? 1 : 2, lead) ? `[${encoded.slice(offset === 0 ? 0 : offset === 1 ? 1 : 2, lead)}]` : ''}${fixed}${tailVar ? `[${encoded.slice(fixedEnd)}]` : ''}`
            : `Offset ${offset}: ${fixed}`,
        );
      }
      return lines.join('\n');
    },
  }),
  defineOp({
    name: 'To Base92',
    category: C,
    description: 'Encodes data as Base92.',
    input: 'bytes',
    output: 'text',
    run: (input) => base92Encode(input),
  }),
  defineOp({
    name: 'From Base92',
    category: C,
    description: 'Decodes Base92.',
    input: 'text',
    output: 'bytes',
    run: (input) => base92Decode(input.trim()),
  }),
  defineOp({
    name: 'To Base85',
    category: C,
    description: 'Encodes bytes as Base85 (Ascii85, Z85 or the IPv6 alphabet).',
    input: 'bytes',
    output: 'text',
    keywords: ['ascii85', 'z85'],
    args: [editable('alphabet', 'Alphabet', BASE85_ALPHABETS), bool('wrap', 'Include delimiter')],
    run: (input, a) => base85Encode(input, sArg(a, 'alphabet'), bArg(a, 'wrap')),
  }),
  defineOp({
    name: 'From Base85',
    category: C,
    description: 'Decodes Base85.',
    input: 'text',
    output: 'bytes',
    keywords: ['ascii85', 'z85'],
    args: [editable('alphabet', 'Alphabet', BASE85_ALPHABETS), bool('remove', 'Remove non-alphabet chars', true), str('zero', 'All-zero group char', 'z')],
    magic: [{ pattern: /^\s*<~[!-uz\s]+~>\s*$/ }],
    run: (input, a) => base85Decode(input, sArg(a, 'alphabet'), bArg(a, 'remove'), sArg(a, 'zero')),
  }),
  defineOp({
    name: 'To Base',
    category: C,
    description: 'Writes a decimal number in another base (2–36).',
    input: 'text',
    output: 'text',
    args: [num('radix', 'Radix', 36, { min: 2, max: 36 })],
    run: (input, a) => {
      const radix = nArg(a, 'radix');
      const text = input.trim();
      if (!/^-?\d+$/.test(text)) {
        const value = Number(text);
        if (!Number.isFinite(value)) throw new OpError('Enter a decimal number.');
        return value.toString(radix);
      }
      return BigInt(text).toString(radix);
    },
  }),
  defineOp({
    name: 'From Base',
    category: C,
    description: 'Reads a number written in another base (2–36) and writes it in decimal.',
    input: 'text',
    output: 'text',
    args: [num('radix', 'Radix', 36, { min: 2, max: 36 })],
    run: (input, a) => {
      const radix = BigInt(nArg(a, 'radix'));
      const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
      let text = input.trim().toLowerCase();
      const negative = text.startsWith('-');
      if (negative) text = text.slice(1);
      let value = 0n;
      for (const ch of text) {
        const d = digits.indexOf(ch);
        if (d === -1 || BigInt(d) >= radix) throw new OpError(`"${ch}" is not a digit in base ${radix}.`);
        value = value * radix + BigInt(d);
      }
      return (negative ? -value : value).toString();
    },
  }),
  defineOp({
    name: 'To BCD',
    category: C,
    description: 'Encodes a decimal number as binary-coded decimal.',
    input: 'text',
    output: 'text',
    args: [sel('scheme', 'Scheme', Object.keys(BCD_SCHEMES)), bool('packed', 'Packed', true), bool('signed', 'Signed'), sel('format', 'Output format', ['Nibbles', 'Bytes', 'Raw'])],
    run: (input, a) => {
      const table = BCD_SCHEMES[sArg(a, 'scheme')] ?? BCD_SCHEMES['8 4 2 1'] ?? [];
      const text = input.trim();
      if (!/^-?\d+$/.test(text)) throw new OpError('BCD encodes whole decimal numbers.');
      const negative = text.startsWith('-');
      const nibbles = Array.from(text.replace('-', ''), (d) => table[Number(d)] ?? 0);
      if (bArg(a, 'signed')) nibbles.push(negative ? 13 : 12);
      let bytes: number[];
      if (bArg(a, 'packed')) {
        if (nibbles.length % 2) nibbles.unshift(0);
        bytes = [];
        for (let i = 0; i < nibbles.length; i += 2) bytes.push(((nibbles[i] as number) << 4) | (nibbles[i + 1] as number));
      } else bytes = nibbles;
      const format = sArg(a, 'format');
      if (format === 'Raw') return bytesToLatin1(Uint8Array.from(bytes));
      if (format === 'Bytes') return bytes.map((b) => b.toString(2).padStart(8, '0')).join(' ');
      return (bArg(a, 'packed') ? nibbles : bytes).map((n) => n.toString(2).padStart(4, '0')).join(' ');
    },
  }),
  defineOp({
    name: 'From BCD',
    category: C,
    description: 'Decodes binary-coded decimal back to a decimal number.',
    input: 'text',
    output: 'text',
    args: [sel('scheme', 'Scheme', Object.keys(BCD_SCHEMES)), bool('packed', 'Packed', true), bool('signed', 'Signed'), sel('format', 'Input format', ['Nibbles', 'Bytes', 'Raw'])],
    magic: [{ pattern: /^(?:\d{4} ){3,}\d{4}$/ }],
    run: (input, a) => {
      const table = BCD_SCHEMES[sArg(a, 'scheme')] ?? [];
      let nibbles: number[];
      const format = sArg(a, 'format');
      if (format === 'Raw') {
        const bytes = latin1ToBytes(input);
        nibbles = bArg(a, 'packed') ? Array.from(bytes).flatMap((b) => [b >> 4, b & 15]) : Array.from(bytes);
      } else {
        const bits = input.replace(/[^01]/g, '');
        nibbles = (bits.match(/.{4}/g) ?? []).map((n) => Number.parseInt(n, 2));
        if (format === 'Bytes' && !bArg(a, 'packed')) nibbles = nibbles.filter((_, i) => i % 2 === 1);
      }
      let sign = '';
      if (bArg(a, 'signed')) {
        const last = nibbles.pop();
        if (last === 13 || last === 11) sign = '-';
      }
      return (
        sign +
        nibbles
          .map((n) => {
            const digit = table.indexOf(n);
            if (digit === -1) throw new OpError(`Invalid BCD digit ${n.toString(2).padStart(4, '0')}.`);
            return digit;
          })
          .join('')
          .replace(/^0+(?=\d)/, '')
      );
    },
  }),
  defineOp({
    name: 'Text-Integer Conversion',
    category: C,
    description: 'Converts text to the big integer formed by its bytes, or a decimal or 0x hex integer back to text.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Output format', ['String', 'Decimal', 'Hexadecimal'])],
    run: (input, a) => {
      const text = input.trim();
      let value: bigint;
      if (/^\d+$/.test(text)) value = BigInt(text);
      else if (/^0x[0-9a-f]+$/i.test(text)) value = BigInt(text);
      else {
        value = 0n;
        for (const b of toBytes(input)) value = (value << 8n) | BigInt(b);
      }
      const format = sArg(a, 'format');
      if (format === 'Decimal') return value.toString();
      if (format === 'Hexadecimal') return `0x${value.toString(16)}`;
      const bytes: number[] = [];
      while (value > 0n) {
        bytes.unshift(Number(value & 255n));
        value >>= 8n;
      }
      return bytesToLatin1(Uint8Array.from(bytes));
    },
  }),
  defineOp({
    name: 'To HTML Entity',
    category: C,
    description: 'Escapes characters as HTML entities.',
    input: 'text',
    output: 'text',
    args: [bool('all', 'Convert all characters'), sel('to', 'Convert to', ['Named entities', 'Numeric entities', 'Hex entities'])],
    run: async (input, a) => {
      const he = cjs(await import('he'));
      const to = sArg(a, 'to');
      return he.encode(input, { useNamedReferences: to === 'Named entities', decimal: to === 'Numeric entities', encodeEverything: bArg(a, 'all'), allowUnsafeSymbols: false });
    },
  }),
  defineOp({
    name: 'From HTML Entity',
    category: C,
    description: 'Turns HTML entities back into characters.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /&(?:#\d{2,3}|#x[\da-f]{2}|[a-z]{2,6});/i }],
    run: async (input) => cjs(await import('he')).decode(input),
  }),
  defineOp({
    name: 'URL Encode',
    category: C,
    description: 'Percent-encodes text for use in a URL.',
    input: 'text',
    output: 'text',
    args: [bool('all', 'Encode all special chars')],
    run: (input, a) => (bArg(a, 'all') ? encodeURIComponent(input).replace(/[!'()*\-._~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`) : encodeURI(input)),
  }),
  defineOp({
    name: 'URL Decode',
    category: C,
    description: 'Decodes percent-encoded text.',
    input: 'text',
    output: 'text',
    args: [bool('backslash', 'Treat \\x as %', true)],
    magic: [{ pattern: /.*(?:%[\da-f]{2}.*){4}/i }],
    run: (input, a) => {
      const text = (bArg(a, 'backslash') ? input.replace(/\\x([0-9a-f]{2})/gi, '%$1') : input).replace(/\+/g, ' ');
      const bytes: number[] = [];
      for (let i = 0; i < text.length; i++) {
        const ch = text[i] as string;
        if (ch === '%' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
          bytes.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
          i += 2;
        } else bytes.push(...utf8(ch));
      }
      return new TextDecoder().decode(Uint8Array.from(bytes));
    },
  }),
  defineOp({
    name: 'Escape Unicode Characters',
    category: C,
    description: 'Writes non-ASCII characters (or all of them) as \\uXXXX, %uXXXX or U+XXXX.',
    input: 'text',
    output: 'text',
    args: [sel('prefix', 'Prefix', ['\\u', '%u', 'U+']), bool('all', 'Encode all chars'), num('padding', 'Padding', 4, { min: 0, max: 8 }), bool('upper', 'Uppercase hex', true)],
    run: (input, a) =>
      Array.from(input, (ch) => {
        const cp = ch.codePointAt(0) as number;
        if (!bArg(a, 'all') && cp < 128) return ch;
        let digits = cp.toString(16).padStart(nArg(a, 'padding'), '0');
        if (bArg(a, 'upper')) digits = digits.toUpperCase();
        return sArg(a, 'prefix') + digits;
      }).join(''),
  }),
  defineOp({
    name: 'Unescape Unicode Characters',
    category: C,
    also: ['Language'],
    description: 'Turns \\uXXXX, %uXXXX or U+XXXX escapes back into characters.',
    input: 'text',
    output: 'text',
    args: [sel('prefix', 'Prefix', ['\\u', '%u', 'U+'])],
    magic: [
      { pattern: /\\u(?:[\da-f]{4,6})/i, args: { prefix: '\\u' } },
      { pattern: /%u(?:[\da-f]{4,6})/i, args: { prefix: '%u' } },
      { pattern: /U\+(?:[\da-f]{4,6})/i, args: { prefix: 'U+' } },
    ],
    run: (input, a) => {
      const prefix = sArg(a, 'prefix').replace(/[\\+]/g, '\\$&');
      const text = input.replace(new RegExp(`${prefix}([\\da-f]{4,6})`, 'gi'), (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
      // Join UTF-16 surrogate pairs written as two escapes.
      return text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, (pair) => pair);
    },
  }),
  defineOp({
    name: 'Normalise Unicode',
    category: C,
    description: 'Applies Unicode normalisation (NFC, NFD, NFKC or NFKD).',
    input: 'text',
    output: 'text',
    args: [sel('form', 'Normal Form', ['NFD', 'NFC', 'NFKD', 'NFKC'])],
    run: (input, a) => input.normalize(sArg(a, 'form') as 'NFC'),
  }),
  defineOp({
    name: 'Escape Smart Characters',
    category: C,
    description: 'Replaces curly quotes, dashes, ellipses and similar with plain ASCII.',
    input: 'text',
    output: 'text',
    args: [sel('unmappable', 'Unmappable characters', ['Include', 'Remove', "Replace with '.'"])],
    run: (input, a) => {
      const map: Record<string, string> = {
        '‘': "'",
        '’': "'",
        '‚': "'",
        '‛': "'",
        '“': '"',
        '”': '"',
        '„': '"',
        '‟': '"',
        '′': "'",
        '″': '"',
        '–': '-',
        '—': '--',
        '―': '--',
        '−': '-',
        '…': '...',
        '\u00A0': ' ',
        '\u2002': ' ',
        '\u2003': ' ',
        '\u2009': ' ',
        '•': '*',
        '·': '.',
        '«': '<<',
        '»': '>>',
        '‹': '<',
        '›': '>',
        '©': '(c)',
        '®': '(R)',
        '™': '(TM)',
        '¼': '1/4',
        '½': '1/2',
        '¾': '3/4',
        '×': 'x',
        '÷': '/',
      };
      const mode = sArg(a, 'unmappable');
      return Array.from(input, (ch) => {
        if (map[ch] !== undefined) return map[ch];
        if ((ch.codePointAt(0) as number) < 128 || mode === 'Include') return ch;
        return mode === 'Remove' ? '' : '.';
      }).join('');
    },
  }),
  defineOp({
    name: 'To Quoted Printable',
    category: C,
    description: 'Encodes data as quoted-printable (MIME).',
    input: 'bytes',
    output: 'text',
    run: (input) => toQuotedPrintable(input),
  }),
  defineOp({
    name: 'From Quoted Printable',
    category: C,
    description: 'Decodes quoted-printable text.',
    input: 'text',
    output: 'bytes',
    magic: [{ pattern: /^[\x21-\x3d\x3f-\x7e \t]{0,76}(?:=[\da-f]{2}|=\r?\n)(?:[\x21-\x3d\x3f-\x7e \t]|=[\da-f]{2}|=\r?\n)*$/i }],
    run: (input) => fromQuotedPrintable(input),
  }),
  defineOp({
    name: 'To Punycode',
    category: C,
    description: 'Encodes Unicode as Punycode, optionally as an internationalised domain name (xn--).',
    input: 'text',
    output: 'text',
    args: [bool('idn', 'Internationalised domain name')],
    run: (input, a) =>
      bArg(a, 'idn')
        ? input
            .split('.')
            .map((label) => (/[^\p{ASCII}]/u.test(label) ? `xn--${punycodeEncode(label.toLowerCase())}` : label))
            .join('.')
        : punycodeEncode(input),
  }),
  defineOp({
    name: 'From Punycode',
    category: C,
    description: 'Decodes Punycode, optionally as an internationalised domain name.',
    input: 'text',
    output: 'text',
    args: [bool('idn', 'Internationalised domain name')],
    run: (input, a) =>
      bArg(a, 'idn')
        ? input
            .split('.')
            .map((label) => (label.toLowerCase().startsWith('xn--') ? punycodeDecode(label.slice(4)) : label))
            .join('.')
        : punycodeDecode(input),
  }),
  defineOp({
    name: 'To Hex Content',
    category: C,
    description: 'Writes bytes the way Snort rules do: printable text with |hex| for the rest.',
    input: 'bytes',
    output: 'text',
    args: [sel('convert', 'Convert', ['Only special chars', 'Only special chars including spaces', 'All chars']), bool('spaces', 'Print spaces between bytes')],
    run: (input, a) => {
      const mode = sArg(a, 'convert');
      const sep = bArg(a, 'spaces') ? ' ' : '';
      let out = '';
      let inHex = false;
      for (const b of input) {
        const special = mode === 'All chars' || b < 32 || b > 126 || (mode === 'Only special chars including spaces' && b === 32);
        if (special) {
          out += inHex ? `${sep}${hex(Uint8Array.of(b))}` : `|${hex(Uint8Array.of(b))}`;
          inHex = true;
        } else {
          if (inHex) out += '|';
          inHex = false;
          out += String.fromCharCode(b);
        }
      }
      return inHex ? `${out}|` : out;
    },
  }),
  defineOp({
    name: 'From Hex Content',
    category: C,
    description: 'Reads Snort-style content strings (text with |hex| sections) back into bytes.',
    input: 'text',
    output: 'bytes',
    magic: [{ pattern: /\|([\da-f]{2} ?)+\|/i }],
    run: (input) => {
      const out: number[] = [];
      const parts = input.split('|');
      parts.forEach((part, i) => {
        if (i % 2 === 1) out.push(...hexToBytes(part));
        else out.push(...toBytes(part));
      });
      return Uint8Array.from(out);
    },
  }),
  defineOp({
    name: 'PEM to Hex',
    category: C,
    also: ['Public Key'],
    description: 'Extracts the bytes inside PEM armour as hex.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const blocks = [...input.matchAll(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/g)];
      if (blocks.length === 0) throw new OpError('No PEM block was found.');
      return blocks.map((m) => hex(base64Decode(m[1] ?? '', 'A-Za-z0-9+/='))).join('\n');
    },
  }),
  defineOp({
    name: 'Hex to PEM',
    category: C,
    also: ['Public Key'],
    description: 'Wraps hex-encoded bytes in PEM armour.',
    input: 'text',
    output: 'text',
    args: [str('header', 'Header string', 'CERTIFICATE')],
    run: (input, a) => {
      const body = (b64(hexToBytes(input)).match(/.{1,64}/g) ?? []).join('\n');
      const header = sArg(a, 'header');
      return `-----BEGIN ${header}-----\n${body}\n-----END ${header}-----`;
    },
  }),
  defineOp({
    name: 'Parse ASN.1 hex string',
    category: C,
    also: ['Public Key'],
    description: 'Shows the structure of DER-encoded ASN.1 given as hex.',
    input: 'text',
    output: 'text',
    args: [num('start', 'Starting index', 0, { min: 0 }), num('truncate', 'Truncate octet strings longer than', 32, { min: 0 })],
    run: (input, a) => {
      const bytes = hexToBytes(input);
      return asn1Dump(parseDer(bytes, nArg(a, 'start')), nArg(a, 'truncate'));
    },
  }),
  defineOp({
    name: 'Change IP format',
    category: C,
    also: ['Networking'],
    description: 'Converts IPv4 addresses between dotted decimal, decimal, octal and hex.',
    input: 'text',
    output: 'text',
    args: [sel('from', 'Input format', ['Dotted Decimal', 'Decimal', 'Octal', 'Hex']), sel('to', 'Output format', ['Dotted Decimal', 'Decimal', 'Octal', 'Hex'])],
    run: (input, a) =>
      input
        .split('\n')
        .map((line) => {
          const text = line.trim();
          if (text === '') return '';
          let value: number;
          switch (sArg(a, 'from')) {
            case 'Decimal':
              value = Number(text);
              break;
            case 'Octal':
              value = Number.parseInt(text.replace(/^0o?/i, ''), 8);
              break;
            case 'Hex':
              value = Number.parseInt(text.replace(/^0x/i, '').replace(/[.:]/g, ''), 16);
              break;
            default: {
              const parts = text.split('.').map(Number);
              if (parts.length !== 4 || parts.some((p) => !(p >= 0 && p <= 255))) throw new OpError(`"${text}" is not a dotted decimal IPv4 address.`);
              value = ((parts[0] as number) * 2 ** 24 + (parts[1] as number) * 65536 + (parts[2] as number) * 256 + (parts[3] as number)) >>> 0;
            }
          }
          if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) throw new OpError(`"${text}" is not a valid IPv4 address.`);
          switch (sArg(a, 'to')) {
            case 'Decimal':
              return String(value);
            case 'Octal':
              return `0${value.toString(8)}`;
            case 'Hex':
              return `0x${value.toString(16).padStart(8, '0')}`;
            default:
              return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
          }
        })
        .join('\n'),
  }),
  defineOp({
    name: 'Encode text',
    category: C,
    also: ['Language'],
    description: 'Encodes text into bytes in a chosen character set (UTF-16, Windows-1252, Shift-JIS, EBCDIC…).',
    input: 'text',
    output: 'bytes',
    keywords: ['charset', 'codepage'],
    args: [sel('encoding', 'Encoding', CHARSETS)],
    run: (input, a) => encodeCharset(input, sArg(a, 'encoding')),
  }),
  defineOp({
    name: 'Decode text',
    category: C,
    also: ['Language'],
    description: 'Decodes bytes from a chosen character set into text.',
    input: 'bytes',
    output: 'text',
    keywords: ['charset', 'codepage', 'mojibake'],
    args: [sel('encoding', 'Encoding', CHARSETS)],
    run: (input, a) => decodeCharset(input, sArg(a, 'encoding')),
  }),
  defineOp({
    name: 'Text Encoding Brute Force',
    category: C,
    description: 'Shows the input encoded or decoded with every supported character set.',
    input: 'bytes',
    output: 'text',
    args: [sel('mode', 'Mode', ['Encode', 'Decode'])],
    run: (input, a) =>
      CHARSETS.map((name) => {
        try {
          const result = sArg(a, 'mode') === 'Encode' ? bytesToLatin1(encodeCharset(new TextDecoder().decode(input), name)) : decodeCharset(input, name);
          return `${name}: ${result.slice(0, 400)}`;
        } catch (error) {
          return `${name}: (${(error as Error).message})`;
        }
      }).join('\n'),
  }),
  defineOp({
    name: 'Swap endianness',
    category: C,
    also: ['Utils'],
    description: 'Reverses the byte order within each word.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Data format', ['Hex', 'Raw']), num('word', 'Word length (bytes)', 4, { min: 1 }), bool('pad', 'Pad incomplete words', true)],
    run: (input, a) => {
      const raw = sArg(a, 'format') === 'Hex';
      const data = Array.from(raw ? hexToBytes(input) : toBytes(input));
      const word = Math.max(1, nArg(a, 'word'));
      if (bArg(a, 'pad')) while (data.length % word) data.push(0);
      const out: number[] = [];
      for (let i = 0; i < data.length; i += word) out.push(...data.slice(i, i + word).reverse());
      return raw ? hex(Uint8Array.from(out), ' ') : bytesToLatin1(Uint8Array.from(out));
    },
  }),
  defineOp({
    name: 'To MessagePack',
    category: C,
    description: 'Encodes JSON as MessagePack.',
    input: 'text',
    output: 'bytes',
    run: async (input) => {
      const { encode } = await import('@msgpack/msgpack');
      return encode(JSON.parse(input));
    },
  }),
  defineOp({
    name: 'From MessagePack',
    category: C,
    also: ['Code tidy'],
    description: 'Decodes MessagePack into JSON.',
    input: 'bytes',
    output: 'text',
    run: async (input) => {
      const { decode } = await import('@msgpack/msgpack');
      return JSON.stringify(decode(input), (_, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? hex(v) : v), 4);
    },
  }),
  defineOp({
    name: 'To Braille',
    category: C,
    description: 'Writes text as Unicode Braille cells (Braille ASCII).',
    input: 'text',
    output: 'text',
    run: (input) =>
      Array.from(input.toUpperCase(), (ch) => {
        const index = BRAILLE_ASCII.indexOf(ch);
        return index === -1 ? ch : String.fromCharCode(0x2800 + index);
      }).join(''),
  }),
  defineOp({
    name: 'From Braille',
    category: C,
    description: 'Reads Unicode Braille cells back as Braille ASCII text.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^[⠀-⠿\s]{4,}$/ }],
    run: (input) =>
      Array.from(input, (ch) => {
        const code = ch.charCodeAt(0);
        return code >= 0x2800 && code < 0x2840 ? (BRAILLE_ASCII[code - 0x2800] ?? ch) : ch;
      }).join(''),
  }),
  defineOp({
    name: 'Parse TLV',
    category: C,
    description: 'Splits type-length-value records and lists them.',
    input: 'bytes',
    output: 'text',
    args: [num('typeSize', 'Type/Key size', 1, { min: 1, max: 4 }), num('lengthSize', 'Length size', 1, { min: 1, max: 4 }), bool('ber', 'Use BER')],
    run: (input, a) => {
      const records: { key: number; length: number; value: string }[] = [];
      const typeSize = nArg(a, 'typeSize');
      const lengthSize = nArg(a, 'lengthSize');
      let at = 0;
      const readInt = (size: number) => {
        let n = 0;
        for (let i = 0; i < size; i++) n = n * 256 + (input[at++] ?? 0);
        return n;
      };
      while (at < input.length) {
        const key = readInt(typeSize);
        let length: number;
        if (bArg(a, 'ber') && (input[at] ?? 0) & 0x80) {
          const count = (input[at++] ?? 0) & 0x7f;
          length = readInt(count);
        } else length = readInt(lengthSize);
        if (at + length > input.length) throw new OpError(`Record ${records.length + 1} runs past the end of the data.`);
        records.push({ key, length, value: hex(input.subarray(at, at + length)) });
        at += length;
      }
      return JSON.stringify(records, null, 4);
    },
  }),
  defineOp({
    name: 'CSV to JSON',
    category: C,
    description: 'Converts CSV to JSON.',
    input: 'text',
    output: 'text',
    args: [str('cell', 'Cell delimiters', ','), str('row', 'Row delimiters', '\\r\\n'), sel('format', 'Format', ['Array of dictionaries', 'Array of arrays'])],
    run: async (input, a) => {
      const Papa = cjs(await import('papaparse'));
      const rowDelims = unescapeShort(sArg(a, 'row'));
      const result = Papa.parse<string[]>(input.trim(), {
        delimiter: unescapeShort(sArg(a, 'cell')) || ',',
        newline: rowDelims.includes('\n') ? undefined : (rowDelims as '\n'),
        skipEmptyLines: true,
      });
      const rows = result.data;
      if (sArg(a, 'format') === 'Array of arrays') return JSON.stringify(rows, null, 4);
      const [head = [], ...body] = rows;
      return JSON.stringify(
        body.map((row) => Object.fromEntries(head.map((key, i) => [key, row[i] ?? '']))),
        null,
        4,
      );
    },
  }),
  defineOp({
    name: 'JSON to CSV',
    category: C,
    description: 'Converts a JSON array of objects or arrays to CSV.',
    input: 'text',
    output: 'text',
    args: [str('cell', 'Cell delimiter', ','), str('row', 'Row delimiter', '\\r\\n')],
    run: async (input, a) => {
      const Papa = cjs(await import('papaparse'));
      const data = JSON.parse(input) as unknown;
      const rows = Array.isArray(data) ? data : [data];
      return Papa.unparse(rows as object[], { delimiter: unescapeShort(sArg(a, 'cell')), newline: unescapeShort(sArg(a, 'row')) });
    },
  }),
  defineOp({
    name: 'CBOR Encode',
    category: C,
    description: 'Encodes JSON as CBOR (RFC 8949).',
    input: 'text',
    output: 'bytes',
    run: (input) => cborEncode(JSON.parse(input)),
  }),
  defineOp({
    name: 'CBOR Decode',
    category: C,
    description: 'Decodes CBOR into JSON. Byte strings appear as hex.',
    input: 'bytes',
    output: 'text',
    run: (input) => JSON.stringify(cborDecode(input), null, 4) ?? 'undefined',
  }),
  defineOp({
    name: 'YAML to JSON',
    category: C,
    description: 'Converts YAML to JSON.',
    input: 'text',
    output: 'text',
    run: async (input) => JSON.stringify((await import('yaml')).parse(input), null, 4),
  }),
  defineOp({
    name: 'JSON to YAML',
    category: C,
    description: 'Converts JSON to YAML.',
    input: 'text',
    output: 'text',
    run: async (input) => (await import('yaml')).stringify(JSON.parse(input)),
  }),
  defineOp({
    name: 'Caret/M-decode',
    category: C,
    description: 'Decodes caret and M- notation (as printed by cat -v) back into bytes.',
    input: 'text',
    output: 'bytes',
    run: (input) => {
      const out: number[] = [];
      for (let i = 0; i < input.length; i++) {
        let meta = 0;
        if (input.startsWith('M-', i)) {
          meta = 0x80;
          i += 2;
        }
        const ch = input[i];
        if (ch === undefined) break;
        if (ch === '^' && i + 1 < input.length) {
          const next = input[++i] as string;
          out.push((next === '?' ? 0x7f : next.charCodeAt(0) ^ 0x40) | meta);
        } else out.push((ch.charCodeAt(0) & 0xff) | meta);
      }
      return Uint8Array.from(out);
    },
  }),
  defineOp({
    name: 'Rison Encode',
    category: C,
    description: 'Encodes JSON as Rison, the compact URL-friendly format used by Kibana.',
    input: 'text',
    output: 'text',
    args: [sel('mode', 'Encode Option', ['Encode', 'Encode Object', 'Encode Array', 'Encode URI'])],
    run: (input, a) => {
      const value = JSON.parse(input) as unknown;
      const mode = sArg(a, 'mode');
      const encoded = risonEncode(value);
      if (mode === 'Encode Object') return encoded.replace(/^\(|\)$/g, '');
      if (mode === 'Encode Array') return encoded.replace(/^!\(|\)$/g, '');
      if (mode === 'Encode URI') return encodeURIComponent(encoded).replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%40/g, '@').replace(/%24/g, '$').replace(/%2F/g, '/').replace(/%20/g, '+');
      return encoded;
    },
  }),
  defineOp({
    name: 'Rison Decode',
    category: C,
    description: 'Decodes Rison into JSON.',
    input: 'text',
    output: 'text',
    args: [sel('mode', 'Decode Option', ['Decode', 'Decode Object', 'Decode Array'])],
    run: (input, a) => {
      const mode = sArg(a, 'mode');
      const text = mode === 'Decode Object' ? `(${input})` : mode === 'Decode Array' ? `!(${input})` : input;
      return JSON.stringify(risonDecode(text), null, 4);
    },
  }),
  defineOp({
    name: 'To Modhex',
    category: C,
    description: 'Encodes bytes as YubiKey modhex.',
    input: 'bytes',
    output: 'text',
    args: [hexDelimArg, num('perLine', 'Bytes per line', 0, { min: 0 })],
    run: (input, a) => toHexDelimited(input, sArg(a, 'delimiter'), nArg(a, 'perLine'), 'cbdefghijklnrtuv'),
  }),
  defineOp({
    name: 'From Modhex',
    category: C,
    description: 'Decodes YubiKey modhex.',
    input: 'text',
    output: 'bytes',
    args: [sel('delimiter', 'Delimiter', ['Auto', ...HEX_DELIMS], 'Auto')],
    magic: [{ pattern: /^(?:[cbdefghijklnrtuv]{2})+$/i }],
    run: (input) => hexToBytes(input.toLowerCase().replace(/[cbdefghijklnrtuv]/g, (ch) => '0123456789abcdef'['cbdefghijklnrtuv'.indexOf(ch)] ?? '')),
  }),
  defineOp({
    name: 'MIME Decoding',
    category: C,
    description: 'Decodes MIME encoded words such as =?UTF-8?B?…?= in email headers.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /=\?[^?]+\?[BQ]\?[^?]*\?=/i }],
    run: (input) =>
      input.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, charset: string, kind: string, body: string) => {
        const bytes = kind.toUpperCase() === 'B' ? base64Decode(body, 'A-Za-z0-9+/=') : fromQuotedPrintable(body.replace(/_/g, ' '));
        try {
          return new TextDecoder(charset.toLowerCase()).decode(bytes);
        } catch {
          return new TextDecoder().decode(bytes);
        }
      }),
  }),
  defineOp({
    name: 'To COBS',
    category: C,
    description: 'Encodes bytes with Consistent Overhead Byte Stuffing so the output has no zero bytes.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => {
      const out: number[] = [0];
      let codeAt = 0;
      let code = 1;
      for (const b of input) {
        if (b === 0) {
          out[codeAt] = code;
          codeAt = out.length;
          out.push(0);
          code = 1;
        } else {
          out.push(b);
          code++;
          if (code === 0xff) {
            out[codeAt] = code;
            codeAt = out.length;
            out.push(0);
            code = 1;
          }
        }
      }
      out[codeAt] = code;
      return Uint8Array.from(out);
    },
  }),
  defineOp({
    name: 'From COBS',
    category: C,
    description: 'Decodes Consistent Overhead Byte Stuffing.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => {
      const out: number[] = [];
      let at = 0;
      while (at < input.length) {
        const code = input[at++] as number;
        if (code === 0) break;
        for (let i = 1; i < code && at < input.length; i++) out.push(input[at++] as number);
        if (code !== 0xff && at < input.length) out.push(0);
      }
      return Uint8Array.from(out);
    },
  }),
];
