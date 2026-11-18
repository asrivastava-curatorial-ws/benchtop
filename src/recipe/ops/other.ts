/** Other operations, flow control and a few extras: statistics, UUIDs, one-time codes, QR codes, Bech32, colours. */
import { lorem } from '../../lib/words';
import { bArg, bool, bytesToLatin1, cjs, DELIMITERS, defineOp, delimiter, hex, hexToBytes, nArg, num, OpError, type Operation, sArg, sel, str, toBytes, txt } from '../core';
import { decode } from '../image';
import { englishScore, shannonEntropy } from '../magic';
import { base64Decode } from './data-format';

const O = 'Other' as const;
const FLOW = 'Flow control' as const;

/* ------------------------------------------------------------ Bech32 -- */

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i] as number;
  }
  return chk >>> 0;
}

const hrpExpand = (hrp: string) => [...Array.from(hrp, (c) => c.charCodeAt(0) >> 5), 0, ...Array.from(hrp, (c) => c.charCodeAt(0) & 31)];

function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    acc = (acc << from) | (data[i] as number);
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & max);
  else if (!pad && (bits >= from || (acc << (to - bits)) & max)) throw new OpError('Invalid padding in the Bech32 data.');
  return out;
}

function bech32Encode(hrp: string, data: number[], m: boolean): string {
  const constant = m ? 0x2bc830a3 : 1;
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ constant;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => BECH32[d]).join('')}`;
}

function bech32Decode(text: string): { hrp: string; data: number[]; variant: 'Bech32' | 'Bech32m' } {
  const s = text.trim();
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new OpError('Bech32 strings cannot mix upper and lower case.');
  const lower = s.toLowerCase();
  const at = lower.lastIndexOf('1');
  if (at < 1 || at + 7 > lower.length) throw new OpError('This is not a Bech32 string.');
  const hrp = lower.slice(0, at);
  const data = Array.from(lower.slice(at + 1), (c) => {
    const d = BECH32.indexOf(c);
    if (d === -1) throw new OpError(`"${c}" is not a Bech32 character.`);
    return d;
  });
  const check = polymod([...hrpExpand(hrp), ...data]);
  const variant = check === 1 ? 'Bech32' : check === 0x2bc830a3 ? 'Bech32m' : null;
  if (!variant) throw new OpError('The Bech32 checksum is wrong.');
  return { hrp, data: data.slice(0, -6), variant };
}

/* ------------------------------------------------------------- UUIDs -- */

function analyseUuid(text: string): string {
  const id = text.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/.test(id)) throw new OpError('This is not a UUID.');
  const h = id.replace(/-/g, '');
  const version = Number.parseInt(h[12] as string, 16);
  const variantBits = Number.parseInt(h[16] as string, 16);
  const variant = variantBits < 8 ? 'NCS (reserved)' : variantBits < 12 ? 'RFC 9562' : variantBits < 14 ? 'Microsoft (reserved)' : 'Future (reserved)';
  const lines = [`UUID version: ${version}`, `Variant: ${variant}`];
  if (h === '0'.repeat(32)) lines.unshift('This is the nil UUID.');
  if (version === 1 || version === 6) {
    const ts = version === 1 ? BigInt(`0x${h.slice(13, 16)}${h.slice(8, 12)}${h.slice(0, 8)}`) : BigInt(`0x${h.slice(0, 12)}${h.slice(13, 16)}`);
    const ms = Number((ts - 122192928000000000n) / 10000n);
    lines.push(`Timestamp: ${new Date(ms).toISOString()}`, `Clock sequence: ${Number.parseInt(h.slice(16, 20), 16) & 0x3fff}`, `Node: ${(h.slice(20).match(/../g) ?? []).join(':')}`);
  }
  if (version === 7) lines.push(`Timestamp: ${new Date(Number.parseInt(h.slice(0, 12), 16)).toISOString()}`);
  return lines.join('\n');
}

/* --------------------------------------------------------------- misc -- */

function deBruijn(k: number, n: number): string {
  if (k ** n > 1_000_000) throw new OpError('That sequence would be longer than a million symbols.');
  const a = new Array<number>(k * n).fill(0);
  const out: number[] = [];
  const db = (t: number, p: number) => {
    if (t > n) {
      if (n % p === 0) out.push(...a.slice(1, p + 1));
    } else {
      a[t] = a[t - p] as number;
      db(t + 1, p);
      for (let j = (a[t - p] as number) + 1; j < k; j++) {
        a[t] = j;
        db(t + 1, t);
      }
    }
  };
  db(1, 1);
  return out.map((d) => d.toString(36)).join('');
}

function haversine(text: string): number {
  const nums = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length !== 4) throw new OpError('Enter two points as "lat1, lon1, lat2, lon2".');
  const [lat1, lon1, lat2, lon2] = nums.map((v) => (v * Math.PI) / 180) as [number, number, number, number];
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export const otherOps: Operation[] = [
  defineOp({
    name: 'To Bech32',
    category: 'Data format',
    description: 'Encodes bytes as Bech32 or Bech32m, optionally as a Bitcoin SegWit address.',
    input: 'bytes',
    output: 'text',
    args: [
      str('hrp', 'Human-Readable Part (HRP)', 'bc'),
      sel('encoding', 'Encoding', ['Bech32', 'Bech32m']),
      sel('input', 'Input Format', ['Raw bytes', 'Hex']),
      sel('mode', 'Mode', ['Generic', 'Bitcoin SegWit']),
      num('witness', 'Witness Version', 0, { min: 0, max: 16 }),
    ],
    run: (input, a) => {
      const bytes = sArg(a, 'input') === 'Hex' ? hexToBytes(bytesToLatin1(input)) : input;
      const segwit = sArg(a, 'mode') === 'Bitcoin SegWit';
      const data = segwit ? [nArg(a, 'witness'), ...convertBits(bytes, 8, 5, true)] : convertBits(bytes, 8, 5, true);
      const m = segwit ? nArg(a, 'witness') > 0 : sArg(a, 'encoding') === 'Bech32m';
      return bech32Encode(sArg(a, 'hrp').toLowerCase(), data, m);
    },
  }),
  defineOp({
    name: 'From Bech32',
    category: 'Data format',
    description: 'Decodes Bech32 and Bech32m strings, including Bitcoin SegWit addresses.',
    input: 'text',
    output: 'text',
    args: [sel('encoding', 'Encoding', ['Auto-detect', 'Bech32', 'Bech32m']), sel('format', 'Output Format', ['Raw', 'Hex', 'Bitcoin scriptPubKey', 'HRP: Hex', 'JSON'], 'Hex')],
    magic: [{ pattern: /^(bc|tb|ltc)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/ }],
    run: (input, a) => {
      const { hrp, data, variant } = bech32Decode(input);
      const want = sArg(a, 'encoding');
      if (want !== 'Auto-detect' && want !== variant) throw new OpError(`The checksum is ${variant}, not ${want}.`);
      const segwit = /^(bc|tb|bcrt|ltc|tltc)$/.test(hrp);
      const witness = segwit ? data[0] : undefined;
      const bytes = Uint8Array.from(convertBits(segwit ? data.slice(1) : data, 5, 8, false));
      const format = sArg(a, 'format');
      if (format === 'Raw') return bytesToLatin1(bytes);
      if (format === 'HRP: Hex') return `${hrp}: ${hex(bytes)}`;
      if (format === 'Bitcoin scriptPubKey') {
        if (witness === undefined) throw new OpError('This is not a SegWit address.');
        return `${(witness === 0 ? 0 : 0x50 + witness).toString(16).padStart(2, '0')}${bytes.length.toString(16).padStart(2, '0')}${hex(bytes)}`;
      }
      if (format === 'JSON') return JSON.stringify({ hrp, encoding: variant, ...(witness !== undefined ? { witnessVersion: witness } : {}), data: hex(bytes) }, null, 4);
      return hex(bytes);
    },
  }),
  defineOp({
    name: 'Parse colour code',
    category: 'Utils',
    description: 'Shows a CSS colour as hex, RGB, HSL and CMYK.',
    input: 'text',
    output: 'text',
    run: async (input) => {
      const culori = await import('culori');
      const colour = culori.parse(input.trim());
      if (!colour) throw new OpError('This is not a colour CSS understands.');
      const rgb = culori.rgb(colour);
      const r = Math.round(Math.min(1, Math.max(0, rgb.r)) * 255);
      const g = Math.round(Math.min(1, Math.max(0, rgb.g)) * 255);
      const b = Math.round(Math.min(1, Math.max(0, rgb.b)) * 255);
      const hsl = culori.hsl(colour);
      const k = 1 - Math.max(r, g, b) / 255;
      const cmyk = k === 1 ? [0, 0, 0, 1] : [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k), k];
      return [
        `Hex:  ${culori.formatHex(colour)}`,
        `RGBA: rgba(${r}, ${g}, ${b}, ${rgb.alpha ?? 1})`,
        `HSLA: hsla(${Math.round(hsl.h ?? 0)}, ${Math.round((hsl.s ?? 0) * 100)}%, ${Math.round((hsl.l ?? 0) * 100)}%, ${hsl.alpha ?? 1})`,
        `CMYK: cmyk(${cmyk.map((v) => v.toFixed(2)).join(', ')})`,
      ].join('\n');
    },
  }),
  defineOp({
    name: 'Entropy',
    category: O,
    description: 'Shannon entropy in bits per byte: near 8 suggests encrypted or compressed data.',
    input: 'bytes',
    output: 'text',
    run: (input) => {
      const e = shannonEntropy(input);
      const verdict = e > 7.5 ? 'very high: likely encrypted or compressed' : e > 6 ? 'high: possibly compressed, or binary' : e > 3.5 ? 'typical of text' : 'low: repetitive data';
      const bar = '█'.repeat(Math.round(e * 5)).padEnd(40, '░');
      return `Shannon entropy: ${e.toFixed(6)} bits per byte (${verdict})\n0 ${bar} 8`;
    },
  }),
  defineOp({
    name: 'Frequency distribution',
    category: O,
    description: 'Counts how often each byte value appears.',
    input: 'bytes',
    output: 'text',
    args: [bool('zero', 'Show 0%s', true), bool('ascii', 'Show ASCII', true)],
    run: (input, a) => {
      const counts = new Array<number>(256).fill(0);
      for (const b of input) counts[b] = (counts[b] as number) + 1;
      const max = Math.max(1, ...counts);
      const lines = [`Total data length: ${input.length}`, `Number of bytes represented: ${counts.filter(Boolean).length}`, ''];
      counts.forEach((count, byte) => {
        if (count === 0 && !bArg(a, 'zero')) return;
        const pct = input.length ? (count / input.length) * 100 : 0;
        const label = bArg(a, 'ascii') && byte >= 32 && byte < 127 ? `'${String.fromCharCode(byte)}'` : '   ';
        lines.push(`${byte.toString(16).padStart(2, '0')} ${label} ${pct.toFixed(2).padStart(6)}% ${'█'.repeat(Math.round((count / max) * 30))}`);
      });
      return lines.join('\n');
    },
  }),
  defineOp({
    name: 'Index of Coincidence',
    category: O,
    description: 'Index of coincidence of the letters (English ≈ 0.0667, random ≈ 0.0385).',
    input: 'text',
    output: 'text',
    run: (input) => {
      const letters = input.toLowerCase().replace(/[^a-z]/g, '');
      const counts = new Array<number>(26).fill(0);
      for (const ch of letters) counts[ch.charCodeAt(0) - 97] = (counts[ch.charCodeAt(0) - 97] as number) + 1;
      const n = letters.length;
      const ic = n > 1 ? counts.reduce((s, c) => s + c * (c - 1), 0) / (n * (n - 1)) : 0;
      return `Index of Coincidence: ${ic.toFixed(6)}\nNormalised: ${(ic * 26).toFixed(4)}\nEnglish-likeness: ${Math.round(englishScore(input) * 100)}%`;
    },
  }),
  defineOp({
    name: 'Chi Square',
    category: O,
    description: 'Chi-squared statistic of the byte distribution against a uniform one.',
    input: 'bytes',
    output: 'text',
    run: (input) => {
      const counts = new Array<number>(256).fill(0);
      for (const b of input) counts[b] = (counts[b] as number) + 1;
      const expected = input.length / 256;
      return String(expected ? counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0) : 0);
    },
  }),
  defineOp({
    name: 'Pseudo-Random Integer Generator',
    category: O,
    description: 'Generates random whole numbers in a range.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [
      num('count', 'Number of Integers', 1, { min: 1, max: 100000 }),
      num('min', 'Min Value', 0),
      num('max', 'Max Value', 99),
      sel('delimiter', 'Delimiter', [...DELIMITERS]),
      sel('output', 'Output', ['Decimal', 'Hex', 'Raw']),
    ],
    run: (_input, a) => {
      const min = Math.ceil(nArg(a, 'min'));
      const max = Math.floor(nArg(a, 'max'));
      if (max < min) throw new OpError('Max Value must not be less than Min Value.');
      const range = max - min + 1;
      const values = Array.from(crypto.getRandomValues(new Uint32Array(Math.min(100000, Math.max(1, nArg(a, 'count'))))), (r) => min + (r % range));
      const out = sArg(a, 'output');
      if (out === 'Raw') return bytesToLatin1(Uint8Array.from(values.map((v) => v & 255)));
      return values.map((v) => (out === 'Hex' ? v.toString(16) : String(v))).join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Generate De Bruijn Sequence',
    category: O,
    description: 'A sequence containing every possible string of length n over an alphabet of k symbols exactly once.',
    input: 'text',
    output: 'text',
    args: [num('k', 'Alphabet size (k)', 2, { min: 2, max: 36 }), num('n', 'Key length (n)', 3, { min: 1, max: 20 })],
    run: (_input, a) => deBruijn(nArg(a, 'k'), nArg(a, 'n')),
  }),
  defineOp({
    name: 'Generate UUID',
    category: O,
    description: 'Generates a UUID (versions 1, 3, 4, 5, 6 and 7).',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [sel('version', 'Version', ['v1', 'v3', 'v4', 'v5', 'v6', 'v7'], 'v4'), str('namespace', 'Namespace', '1b671a64-40d5-491e-99b0-da01ff1f3341')],
    run: async (input, a) => {
      const uuid = await import('uuid');
      const v = sArg(a, 'version');
      if (v === 'v3' || v === 'v5') return (v === 'v3' ? uuid.v3 : uuid.v5)(input, sArg(a, 'namespace'));
      return ({ v1: uuid.v1, v4: uuid.v4, v6: uuid.v6, v7: uuid.v7 } as Record<string, () => string>)[v]?.() ?? uuid.v4();
    },
  }),
  defineOp({
    name: 'Analyse UUID',
    category: O,
    description: 'Shows the version and variant of a UUID and, for time-based ones, when it was made.',
    input: 'text',
    output: 'text',
    run: (input) => analyseUuid(input),
  }),
  defineOp({
    name: 'Generate TOTP',
    category: O,
    description: 'Time-based one-time password from a secret (the input, as raw bytes).',
    input: 'bytes',
    output: 'text',
    volatile: true,
    args: [str('name', 'Name', 'Account'), num('digits', 'Code length', 6, { min: 4, max: 10 }), num('t0', 'Epoch offset (T0)', 0), num('period', 'Interval (T1)', 30, { min: 1 })],
    run: async (input, a) => {
      const { totp } = await import('../../lib/totp');
      const { toBase32 } = await import('../../lib/bytes');
      const code = totp(input, Date.now() - nArg(a, 't0') * 1000, { period: nArg(a, 'period'), digits: nArg(a, 'digits') });
      return `URI: otpauth://totp/${encodeURIComponent(sArg(a, 'name'))}?secret=${toBase32(input).replace(/=+$/, '')}&period=${nArg(a, 'period')}&digits=${nArg(a, 'digits')}\n\nPassword: ${code}`;
    },
  }),
  defineOp({
    name: 'Generate HOTP',
    category: O,
    description: 'Counter-based one-time password from a secret (the input, as raw bytes).',
    input: 'bytes',
    output: 'text',
    args: [str('name', 'Name', 'Account'), num('digits', 'Code length', 6, { min: 4, max: 10 }), num('counter', 'Counter', 0, { min: 0 })],
    run: async (input, a) => {
      const { hotp } = await import('../../lib/totp');
      const { toBase32 } = await import('../../lib/bytes');
      const code = hotp(input, BigInt(nArg(a, 'counter')), nArg(a, 'digits'));
      return `URI: otpauth://hotp/${encodeURIComponent(sArg(a, 'name'))}?secret=${toBase32(input).replace(/=+$/, '')}&counter=${nArg(a, 'counter')}&digits=${nArg(a, 'digits')}\n\nPassword: ${code}`;
    },
  }),
  defineOp({
    name: 'Generate QR Code',
    category: O,
    description: 'Makes a QR code from the input.',
    input: 'text',
    output: 'text',
    args: [
      sel('format', 'Image Format', ['SVG']),
      num('size', 'Module size (px)', 5, { min: 1, max: 50 }),
      num('margin', 'Margin (num modules)', 4, { min: 0, max: 20 }),
      sel('ecc', 'Error correction', ['Low', 'Medium', 'Quartile', 'High'], 'Medium'),
    ],
    run: async (input, a) => {
      const { toSVG } = await import('bwip-js/generic');
      let svg: string;
      try {
        svg = toSVG({
          bcid: 'qrcode',
          text: input,
          scale: nArg(a, 'size'),
          paddingwidth: nArg(a, 'margin') * nArg(a, 'size'),
          paddingheight: nArg(a, 'margin') * nArg(a, 'size'),
          backgroundcolor: 'ffffff',
          eclevel: sArg(a, 'ecc')[0],
        } as never);
      } catch (error) {
        // CyberChef's wording; bwip-js reports an over-long input as "bwipp.qrcodeNoValidSymbol: Maximum length exceeded".
        const message = String(error instanceof Error ? error.message : error);
        throw new OpError(`Error generating QR code. (Error: ${/maximum length/i.test(message) ? 'Too much data' : message.replace(/^bwipp\.\w+#\d+:\s*/, '')})`);
      }
      return { value: svg, preview: { kind: 'image', bytes: new TextEncoder().encode(svg), mime: 'image/svg+xml' } };
    },
  }),
  defineOp({
    name: 'Parse QR Code',
    category: O,
    description: 'Reads the text in a QR code image.',
    input: 'bytes',
    output: 'text',
    run: async (input) => {
      const jsQR = cjs(await import('jsqr'));
      const px = await decode(input);
      const result = jsQR(px.data, px.width, px.height, { inversionAttempts: 'attemptBoth' });
      if (!result) throw new OpError('No QR code was found in the image.');
      return result.data;
    },
  }),
  defineOp({
    name: 'Haversine distance',
    category: O,
    description: 'Great-circle distance in metres between two points given as "lat1, lon1, lat2, lon2".',
    input: 'text',
    output: 'text',
    run: (input) => String(Math.round(haversine(input) * 1000) / 1000),
  }),
  defineOp({
    name: 'HTML To Text',
    category: O,
    description: 'Converts HTML to plain text, decoding entities.',
    input: 'text',
    output: 'text',
    run: async (input) => {
      const he = cjs(await import('he'));
      return he
        .decode(
          input
            .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
            .replace(/<[^>]+>/g, ''),
        )
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    },
  }),
  defineOp({
    name: 'Generate Lorem Ipsum',
    category: O,
    description: 'Placeholder text in paragraphs, sentences, words or bytes.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [num('length', 'Length', 3, { min: 1, max: 1000 }), sel('unit', 'Length in', ['Paragraphs', 'Sentences', 'Words', 'Bytes'])],
    run: (_input, a) => {
      const unit = sArg(a, 'unit');
      if (unit === 'Bytes') return lorem({ unit: 'paragraphs', count: Math.ceil(nArg(a, 'length') / 300) + 1, classicStart: true, html: false }).slice(0, nArg(a, 'length'));
      return lorem({ unit: unit.toLowerCase() as 'paragraphs', count: nArg(a, 'length'), classicStart: true, html: false });
    },
  }),
  /* ----------------------------------------------------- flow control -- */
  defineOp({
    name: 'Magic',
    category: FLOW,
    description: 'Tries likely decodings (Base64, hex, compression, URL encoding…) to the chosen depth and ranks the results.',
    input: 'bytes',
    output: 'text',
    flow: 'magic',
    keywords: ['auto', 'detect', 'guess'],
    args: [
      num('depth', 'Depth', 3, { min: 0, max: 6 }),
      bool('intensive', 'Intensive mode'),
      bool('extensive', 'Extensive language support', false, { help: 'Also rank text in other Latin and non-Latin scripts' }),
      str('crib', 'Crib (known plaintext string or regex)', ''),
    ],
    run: (input) => input,
  }),
  defineOp({
    name: 'Fork',
    category: FLOW,
    description: 'Splits the data and runs the following operations on each part separately, up to a Merge.',
    input: 'text',
    output: 'text',
    flow: 'fork',
    args: [str('split', 'Split delimiter', '\\n'), str('merge', 'Merge delimiter', '\\n'), bool('ignoreErrors', 'Ignore errors')],
    run: (input) => input,
  }),
  defineOp({
    name: 'Subsection',
    category: FLOW,
    description: 'Runs the following operations (up to a Merge) only on the parts that match a regular expression (or its first group).',
    input: 'text',
    output: 'text',
    flow: 'subsection',
    args: [str('section', 'Section (regex)', ''), bool('caseSensitive', 'Case sensitive matching', true), bool('global', 'Global matching', true), bool('ignoreErrors', 'Ignore errors')],
    run: (input) => input,
  }),
  defineOp({
    name: 'Merge',
    category: FLOW,
    description: 'Ends a Fork or Subsection and joins the parts back together.',
    input: 'text',
    output: 'text',
    flow: 'merge',
    args: [bool('all', 'Merge all', true)],
    run: (input) => input,
  }),
  defineOp({
    name: 'Register',
    category: FLOW,
    description: 'Saves regular-expression capture groups as $R0, $R1… for use in later arguments.',
    input: 'text',
    output: 'text',
    flow: 'register',
    args: [txt('extractor', 'Extractor', '([\\s\\S]*)'), bool('caseInsensitive', 'Case insensitive', true), bool('multiline', 'Multiline matching'), bool('dotAll', 'Dot matches all')],
    run: (input) => input,
  }),
  defineOp({
    name: 'Label',
    category: FLOW,
    description: 'Marks a place that Jump and Conditional Jump can go to.',
    input: 'text',
    output: 'text',
    flow: 'label',
    args: [str('name', 'Name', '')],
    run: (input) => input,
  }),
  defineOp({
    name: 'Jump',
    category: FLOW,
    description: 'Goes to a Label, up to a maximum number of times.',
    input: 'text',
    output: 'text',
    flow: 'jump',
    args: [str('label', 'Label name', ''), num('max', 'Maximum jumps (if jumping backwards)', 10, { min: 0 })],
    run: (input) => input,
  }),
  defineOp({
    name: 'Conditional Jump',
    category: FLOW,
    description: 'Goes to a Label when the data matches (or does not match) a regular expression.',
    input: 'text',
    output: 'text',
    flow: 'cjump',
    args: [str('match', 'Match (regex)', ''), bool('invert', 'Invert match'), str('label', 'Label name', ''), num('max', 'Maximum jumps (if jumping backwards)', 10, { min: 0 })],
    run: (input) => input,
  }),
  defineOp({
    name: 'Return',
    category: FLOW,
    description: 'Stops the recipe here.',
    input: 'text',
    output: 'text',
    flow: 'return',
    run: (input) => input,
  }),
  defineOp({
    name: 'Comment',
    category: FLOW,
    description: 'A note in the recipe; does nothing.',
    input: 'text',
    output: 'text',
    flow: 'comment',
    args: [txt('comment', 'Comment', '')],
    run: (input) => input,
  }),
];

export { base64Decode, toBytes };
