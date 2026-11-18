/** Utilities and language operations: case, sorting, filtering, find and replace, regular expressions, units, distances. */
import { escapeHtml } from '../../lib/text';
import { bArg, bool, type Choice, defineOp, delimiter, editable, keyed, nArg, num, OpError, type Operation, sArg, sel, splitBy, str, toBytes, txt, unescapeShort, userRegex } from '../core';

const C = 'Utils' as const;
const INPUT_DELIMS = ['Line feed', 'CRLF', 'Space', 'Comma', 'Semi-colon', 'Colon', 'Nothing (separate chars)'];

const items = (input: string, delim: string) => {
  const parts = splitBy(input, delim);
  return delim === 'Line feed' && parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts;
};

/* -------------------------------------------------------- regex presets -- */

export const BUILT_IN_REGEXES: readonly Choice[] = [
  { label: 'User defined', value: '' },
  { label: 'IPv4 address', value: '(?:(?:\\d|[01]?\\d\\d|2[0-4]\\d|25[0-5])\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d|\\d)(?:\\/\\d{1,2})?' },
  {
    label: 'IPv6 address',
    value:
      '((?=.*::)(?!.*::.+::)(::)?([\\dA-Fa-f]{1,4}:(:|\\b)|){5}|([\\dA-Fa-f]{1,4}:){6})((([\\dA-Fa-f]{1,4}((?!\\3)::|:\\b|(?![\\dA-Fa-f])))|(?!\\2\\3)){2}|(((2[0-4]|1\\d|[1-9])?\\d|25[0-5])\\.?\\b){4})',
  },
  { label: 'Email address', value: '\\b[\\w._%+\\-]+@[\\w.\\-]+\\.[A-Za-z]{2,}\\b' },
  { label: 'URL', value: '([A-Za-z]+://)([-\\w]+(?:\\.\\w[-\\w]*)+)(:\\d+)?(/[^.!,?"<>\\[\\]{}\\s\\x7F-\\xFF]*(?:[.!,?]+[^.!,?"<>\\[\\]{}\\s\\x7F-\\xFF]+)*)?' },
  { label: 'Domain', value: '\\b((?=[a-z0-9-]{1,63}\\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\\.)+[a-z]{2,63}\\b' },
  { label: 'Windows file path', value: '([A-Za-z]):\\\\((?:[A-Za-z\\d][A-Za-z\\d\\- \\x27_\\(\\)~]{0,61}\\\\?)*[A-Za-z\\d][A-Za-z\\d\\- \\x27_\\(\\)]{0,61})(\\.[A-Za-z\\d]{1,6})?' },
  { label: 'UNIX file path', value: '(?:/[A-Za-z\\d.][A-Za-z\\d\\-.]{0,61})+' },
  { label: 'MAC address', value: '[A-Fa-f\\d]{2}(?:[:-][A-Fa-f\\d]{2}){5}' },
  { label: 'Date (yyyy-mm-dd)', value: '((?:19|20)\\d\\d)[- /.](0[1-9]|1[012])[- /.](0[1-9]|[12][0-9]|3[01])' },
  { label: 'Date (dd/mm/yyyy)', value: '(0[1-9]|[12][0-9]|3[01])[- /.](0[1-9]|1[012])[- /.]((?:19|20)\\d\\d)' },
  { label: 'Date (mm/dd/yyyy)', value: '(0[1-9]|1[012])[- /.](0[1-9]|[12][0-9]|3[01])[- /.]((?:19|20)\\d\\d)' },
  { label: 'Strings', value: '[A-Za-z\\d/\\-:.,_$%\\x27"()<>= !\\[\\]{}@]{4,}' },
];

function regexMatches(input: string, regex: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  if (!regex.global) {
    const m = regex.exec(input);
    return m ? [m] : [];
  }
  regex.lastIndex = 0;
  for (let m = regex.exec(input); m; m = regex.exec(input)) {
    out.push(m);
    if (m[0] === '') regex.lastIndex++;
    if (out.length > 100000) break;
  }
  return out;
}

function highlight(input: string, matches: readonly RegExpExecArray[]): string {
  let html = '';
  let at = 0;
  for (const m of matches) {
    html += escapeHtml(input.slice(at, m.index));
    html += `<mark>${escapeHtml(m[0])}</mark>`;
    at = m.index + m[0].length;
  }
  return `<pre>${html}${escapeHtml(input.slice(at))}</pre>`;
}

/* ------------------------------------------------------------- units -- */

const DISTANCE: Record<string, number> = {
  'Nanometres (nm)': 1e-9,
  'Micrometres (µm)': 1e-6,
  'Millimetres (mm)': 1e-3,
  'Centimetres (cm)': 1e-2,
  'Metres (m)': 1,
  'Kilometres (km)': 1e3,
  'Thou (th)': 0.0000254,
  'Inches (in)': 0.0254,
  'Feet (ft)': 0.3048,
  'Yards (yd)': 0.9144,
  'Chains (ch)': 20.1168,
  'Furlongs (fur)': 201.168,
  'Miles (mi)': 1609.344,
  'Leagues (lea)': 4828.032,
  'Fathoms (ftm)': 1.853184,
  Cables: 185.3184,
  'Nautical miles': 1852,
  'Astronomical units (au)': 149597870700,
  'Light-years (ly)': 9460730472580800,
  'Parsecs (pc)': 3.085677581491367e16,
};
const AREA: Record<string, number> = {
  'Square metre (sq m)': 1,
  'Square kilometre (sq km)': 1e6,
  'Centiare (ca)': 1,
  'Deciare (da)': 10,
  'Are (a)': 100,
  'Decare (daa)': 1000,
  'Hectare (ha)': 10000,
  'Square inch (sq in)': 0.00064516,
  'Square foot (sq ft)': 0.09290304,
  'Square yard (sq yd)': 0.83612736,
  'Acre (ac)': 4046.8564224,
  'Square mile (sq mi)': 2589988.110336,
  'Perch (sq per)': 25.29285264,
  'Rood (ro)': 1011.7141056,
  'Football pitch': 7140,
  'Tennis court': 260.8704,
};
const MASS: Record<string, number> = {
  'Microgram (µg)': 1e-9,
  'Milligram (mg)': 1e-6,
  'Gram (g)': 1e-3,
  'Kilogram (kg)': 1,
  'Tonne (t)': 1000,
  'Grain (gr)': 0.00006479891,
  'Dram (dr)': 0.0017718451953125,
  'Ounce (oz)': 0.028349523125,
  'Pound (lb)': 0.45359237,
  'Stone (st)': 6.35029318,
  'Hundredweight (UK)': 50.80234544,
  'Hundredweight (US)': 45.359237,
  'Ton (UK long)': 1016.0469088,
  'Ton (US short)': 907.18474,
  'Troy ounce (oz t)': 0.0311034768,
  'Carat (ct)': 0.0002,
};
const SPEED: Record<string, number> = {
  'Metres per second (m/s)': 1,
  'Kilometres per hour (km/h)': 1 / 3.6,
  'Miles per hour (mph)': 0.44704,
  'Knots (kn)': 1852 / 3600,
  'Feet per second (ft/s)': 0.3048,
  'Speed of sound (sea level)': 340.29,
  'Speed of light (c)': 299792458,
};
const DATA: Record<string, number> = {
  'Bits (b)': 1,
  Nibbles: 4,
  Octets: 8,
  'Bytes (B)': 8,
  'Kilobits (kb)': 1e3,
  'Kilobytes (kB)': 8e3,
  'Megabits (Mb)': 1e6,
  'Megabytes (MB)': 8e6,
  'Gigabits (Gb)': 1e9,
  'Gigabytes (GB)': 8e9,
  'Terabits (Tb)': 1e12,
  'Terabytes (TB)': 8e12,
  'Petabytes (PB)': 8e15,
  'Kibibits (Kib)': 1024,
  'Kibibytes (KiB)': 8192,
  'Mebibits (Mib)': 1048576,
  'Mebibytes (MiB)': 8388608,
  'Gibibits (Gib)': 1073741824,
  'Gibibytes (GiB)': 8589934592,
  'Tebibytes (TiB)': 8796093022208,
  'Pebibytes (PiB)': 9007199254740992,
};

function unitOp(name: string, table: Record<string, number>, from: string, to: string): Operation {
  const units = Object.keys(table);
  return defineOp({
    name,
    category: C,
    description: `Converts ${name.replace('Convert ', '')} between units.`,
    input: 'text',
    output: 'text',
    args: [sel('from', 'Input units', units, from), sel('to', 'Output units', units, to)],
    run: (input, a) => {
      const value = Number(input.trim());
      if (!Number.isFinite(value)) throw new OpError('Enter a number.');
      const result = (value * (table[sArg(a, 'from')] ?? 1)) / (table[sArg(a, 'to')] ?? 1);
      return String(Number.parseFloat(result.toPrecision(15)));
    },
  });
}

/* ---------------------------------------------------------- distances -- */

function levenshtein(a: string, b: string, ins: number, del: number, sub: number): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j * ins);
  for (let i = 1; i <= x.length; i++) {
    const current = [i * del];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min((previous[j] as number) + del, (current[j - 1] as number) + ins, (previous[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : sub));
    }
    previous = current;
  }
  return previous[y.length] as number;
}

/* ------------------------------------------------------------ escapes -- */

function escapeString(input: string, level: string, quote: string, json: boolean, es6: boolean, upper: boolean): string {
  const q = quote === 'Double' ? '"' : quote === 'Backtick' ? '`' : "'";
  const h = (n: number, w: number) => {
    const s = n.toString(16).padStart(w, '0');
    return upper ? s.toUpperCase() : s;
  };
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0) as number;
    const named: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f', '\v': json ? '\\u000b' : '\\v', '\\': '\\\\' };
    if (ch === q || (json && ch === '"')) out += `\\${ch}`;
    else if (named[ch] !== undefined && level !== 'Minimal') out += named[ch];
    else if (level === 'Minimal' && (ch === '\\' || ch === '\n')) out += ch === '\n' ? '\\n' : '\\\\';
    else if (level === 'Everything' || (level === 'Special chars' && (cp < 32 || cp === 127 || cp > 126))) {
      if (level === 'Special chars' && cp > 126 && cp < 0xd800 && !/\s/.test(ch) && cp >= 160) out += ch;
      else if (cp > 0xffff) out += es6 && !json ? `\\u{${h(cp, 1)}}` : Array.from(String.fromCodePoint(cp), (u) => `\\u${h(u.charCodeAt(0), 4)}`).join('');
      else if (cp > 255 || json) out += `\\u${h(cp, 4)}`;
      else out += `\\x${h(cp, 2)}`;
    } else out += ch;
  }
  return out;
}

export function unescapeString(input: string): string {
  return input.replace(/\\(u\{[0-9a-f]+\}|u[0-9a-f]{4}|x[0-9a-f]{2}|[0-7]{1,3}|[\s\S])/gi, (match, code: string) => {
    if (code.startsWith('u{')) return String.fromCodePoint(Number.parseInt(code.slice(2, -1), 16));
    if (/^u[0-9a-f]{4}$/i.test(code)) return String.fromCharCode(Number.parseInt(code.slice(1), 16));
    if (/^x[0-9a-f]{2}$/i.test(code)) return String.fromCharCode(Number.parseInt(code.slice(1), 16));
    if (/^[0-7]+$/.test(code)) return String.fromCharCode(Number.parseInt(code, 8));
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    return map[code] ?? (code === match ? match : code);
  });
}

/* ---------------------------------------------------------------- misc -- */

const NATO: Record<string, string> = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
  '0': 'Zero',
  '1': 'One',
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  '.': 'Stop',
  ',': 'Comma',
  '-': 'Dash',
};
const LEET: Record<string, string> = { a: '4', b: '8', e: '3', g: '6', i: '1', l: '1', o: '0', s: '5', t: '7', z: '2' };

function caseScope(text: string, scope: string): string {
  if (scope === 'All') return text.toUpperCase();
  if (scope === 'Word') return text.replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  if (scope === 'Sentence') return text.replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  return text.replace(/(^\s*|\n\s*)(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function sortItems(list: string[], order: string): string[] {
  const ip = (s: string) => s.split('.').reduce((acc, part) => acc * 256 + (Number(part) || 0), 0);
  const copy = [...list];
  switch (order) {
    case 'Alphabetical (case insensitive)':
      return copy.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    case 'IP address':
      return copy.sort((a, b) => ip(a) - ip(b));
    case 'Numeric':
      return copy.sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b));
    case 'Numeric (hexadecimal)':
      return copy.sort((a, b) => Number.parseInt(a.replace(/^0x/i, ''), 16) - Number.parseInt(b.replace(/^0x/i, ''), 16));
    case 'Length':
      return copy.sort((a, b) => a.length - b.length);
    default:
      return copy.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}

function perLine(input: Uint8Array, each: boolean, fn: (chunk: Uint8Array) => Uint8Array): Uint8Array {
  if (!each) return fn(input);
  const out: number[] = [];
  let start = 0;
  for (let i = 0; i <= input.length; i++) {
    if (i === input.length || input[i] === 10) {
      out.push(...fn(input.slice(start, i)));
      if (i < input.length) out.push(10);
      start = i + 1;
    }
  }
  return Uint8Array.from(out);
}

function fileTree(paths: string[], sep: string): string {
  type Node = Map<string, Node>;
  const root: Node = new Map();
  for (const path of paths) {
    let node = root;
    for (const part of path.split(sep).filter(Boolean)) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part) as Node;
    }
  }
  const lines: string[] = [];
  const walk = (node: Node, prefix: string) => {
    const entries = [...node.entries()];
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${name}`);
      walk(child, `${prefix}${last ? '    ' : '│   '}`);
    });
  };
  walk(root, '');
  return lines.join('\n');
}

/* ---------------------------------------------------------- operations -- */

export const languageOps: Operation[] = [
  defineOp({
    name: 'Unicode Text Format',
    category: 'Language',
    description: 'Adds combining underline or strikethrough marks to every character.',
    input: 'text',
    output: 'text',
    args: [bool('underline', 'Underline'), bool('strike', 'Strikethrough')],
    run: (input, a) => Array.from(input, (ch) => ch + (bArg(a, 'underline') ? '̲' : '') + (bArg(a, 'strike') ? '̶' : '')).join(''),
  }),
  defineOp({
    name: 'Remove Diacritics',
    category: 'Language',
    description: 'Removes accents and other diacritical marks (é becomes e).',
    input: 'text',
    output: 'text',
    run: (input) => input.normalize('NFD').replace(/\p{M}/gu, ''),
  }),
  defineOp({
    name: 'Convert to NATO alphabet',
    category: 'Language',
    description: 'Spells text with the NATO phonetic alphabet.',
    input: 'text',
    output: 'text',
    run: (input) =>
      Array.from(input.toUpperCase(), (ch) => NATO[ch] ?? (ch === ' ' ? '\n' : ch))
        .join(' ')
        .replace(/ ?\n ?/g, '\n'),
  }),
  defineOp({
    name: 'Convert Leet Speak',
    category: 'Language',
    description: 'Converts text to or from leet speak (h3ll0).',
    input: 'text',
    output: 'text',
    args: [sel('direction', 'Direction', ['To Leet Speak', 'From Leet Speak'])],
    run: (input, a) => {
      if (sArg(a, 'direction') === 'To Leet Speak') return Array.from(input, (ch) => LEET[ch.toLowerCase()] ?? ch).join('');
      const back: Record<string, string> = { '4': 'a', '8': 'b', '3': 'e', '6': 'g', '1': 'l', '0': 'o', '5': 's', '7': 't', '2': 'z' };
      return Array.from(input, (ch) => back[ch] ?? ch).join('');
    },
  }),
];

export const utilsOps: Operation[] = [
  defineOp({
    name: 'Diff',
    category: C,
    description: 'Compares two samples by character, word, line, sentence, CSS or JSON.',
    input: 'text',
    output: 'text',
    args: [
      str('sample', 'Sample delimiter', '\\n\\n'),
      sel('by', 'Diff by', ['Character', 'Word', 'Line', 'Sentence', 'CSS', 'JSON']),
      bool('added', 'Show added', true),
      bool('removed', 'Show removed', true),
      bool('subtraction', 'Show subtraction'),
      bool('ignoreWhitespace', 'Ignore whitespace'),
    ],
    run: async (input, a) => {
      const samples = input.split(unescapeShort(sArg(a, 'sample')));
      if (samples.length !== 2) throw new OpError('Enter two samples separated by the sample delimiter (a blank line by default).');
      const d = await import('diff');
      const [x, y] = samples as [string, string];
      const by = sArg(a, 'by');
      const ignore = bArg(a, 'ignoreWhitespace');
      const changes =
        by === 'Character'
          ? d.diffChars(x, y)
          : by === 'Word'
            ? ignore
              ? d.diffWords(x, y)
              : d.diffWordsWithSpace(x, y)
            : by === 'Line'
              ? d.diffLines(x, y, { ignoreWhitespace: ignore })
              : by === 'Sentence'
                ? d.diffSentences(x, y)
                : by === 'CSS'
                  ? d.diffCss(x, y)
                  : d.diffJson(JSON.parse(x) as object, JSON.parse(y) as object);
      let text = '';
      let html = '';
      for (const part of changes) {
        if (part.added) {
          if (!bArg(a, 'added')) continue;
          text += `{+${part.value}+}`;
          html += `<ins>${escapeHtml(part.value)}</ins>`;
        } else if (part.removed) {
          if (!bArg(a, 'removed')) continue;
          text += `[-${part.value}-]`;
          html += `<del>${escapeHtml(part.value)}</del>`;
        } else if (!bArg(a, 'subtraction')) {
          text += part.value;
          html += escapeHtml(part.value);
        }
      }
      return { value: text, preview: { kind: 'html', html: `<pre class="recipe-diff">${html}</pre>` } };
    },
  }),
  defineOp({
    name: 'Remove whitespace',
    category: C,
    description: 'Removes spaces, line breaks, tabs and (optionally) full stops.',
    input: 'text',
    output: 'text',
    args: [
      bool('spaces', 'Spaces', true),
      bool('cr', 'Carriage returns (\\r)', true),
      bool('lf', 'Line feeds (\\n)', true),
      bool('tabs', 'Tabs', true),
      bool('ff', 'Form feeds (\\f)', true),
      bool('stops', 'Full stops'),
    ],
    run: (input, a) => {
      let chars = '';
      if (bArg(a, 'spaces')) chars += ' ';
      if (bArg(a, 'cr')) chars += '\\r';
      if (bArg(a, 'lf')) chars += '\\n';
      if (bArg(a, 'tabs')) chars += '\\t';
      if (bArg(a, 'ff')) chars += '\\f';
      if (bArg(a, 'stops')) chars += '.';
      return chars ? input.replace(new RegExp(`[${chars}]`, 'g'), '') : input;
    },
  }),
  defineOp({
    name: 'Remove null bytes',
    category: C,
    description: 'Removes all 0x00 bytes.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => input.filter((b) => b !== 0),
  }),
  defineOp({
    name: 'Remove ANSI Escape Codes',
    category: C,
    description: 'Removes terminal colour and cursor codes (such as ESC[31m).',
    input: 'text',
    output: 'text',
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences start with control characters
    run: (input) => input.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g, ''),
  }),
  defineOp({
    name: 'To Upper case',
    category: C,
    description: 'Upper-cases everything, or the first letter of each word, sentence or paragraph.',
    input: 'text',
    output: 'text',
    args: [sel('scope', 'Scope', ['All', 'Word', 'Sentence', 'Paragraph'])],
    run: (input, a) => caseScope(input, sArg(a, 'scope')),
  }),
  defineOp({ name: 'To Lower case', category: C, description: 'Lower-cases the text.', input: 'text', output: 'text', run: (input) => input.toLowerCase() }),
  defineOp({
    name: 'Swap case',
    category: C,
    description: 'Upper case becomes lower and lower becomes upper.',
    input: 'text',
    output: 'text',
    run: (input) => Array.from(input, (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join(''),
  }),
  defineOp({
    name: 'Alternating Caps',
    category: C,
    description: 'aLtErNaTeS tHe CaSe of letters.',
    input: 'text',
    output: 'text',
    run: (input) => {
      let upper = false;
      return Array.from(input, (ch) => {
        if (!/\p{L}/u.test(ch)) return ch;
        const out = upper ? ch.toUpperCase() : ch.toLowerCase();
        upper = !upper;
        return out;
      }).join('');
    },
  }),
  defineOp({
    name: 'To Case Insensitive Regex',
    category: C,
    description: 'Turns text into a regular expression that matches it in any case ([aA][bB]…).',
    input: 'text',
    output: 'text',
    run: (input) => Array.from(input, (ch) => (ch.toLowerCase() !== ch.toUpperCase() ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join(''),
  }),
  defineOp({
    name: 'From Case Insensitive Regex',
    category: C,
    description: 'Reverses To Case Insensitive Regex.',
    input: 'text',
    output: 'text',
    run: (input) => input.replace(/\[(\p{L})(\p{L})\]/gu, (m, x: string, y: string) => (x.toLowerCase() === y.toLowerCase() ? x : m)),
  }),
  defineOp({
    name: 'Add line numbers',
    category: C,
    description: 'Numbers every line.',
    input: 'text',
    output: 'text',
    args: [num('offset', 'Offset', 0)],
    run: (input, a) => {
      const lines = input.split('\n');
      const width = String(lines.length + nArg(a, 'offset')).length;
      return lines.map((line, i) => `${String(i + 1 + nArg(a, 'offset')).padStart(width)} ${line}`).join('\n');
    },
  }),
  defineOp({
    name: 'Remove line numbers',
    category: C,
    description: 'Removes leading line numbers.',
    input: 'text',
    output: 'text',
    run: (input) => input.replace(/^[ \t]{0,5}\d+[\s:|\-,.)\]]/gm, ''),
  }),
  defineOp({
    name: 'Get All Casings',
    category: C,
    description: 'Lists every combination of upper and lower case.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const chars = Array.from(input);
      const letters = chars.map((ch, i) => (ch.toLowerCase() !== ch.toUpperCase() ? i : -1)).filter((i) => i !== -1);
      if (letters.length > 16) throw new OpError('Limited to 16 letters (65,536 casings).');
      const out: string[] = [];
      for (let mask = 0; mask < 1 << letters.length; mask++) {
        const copy = [...chars];
        letters.forEach((index, bit) => {
          copy[index] = mask & (1 << bit) ? (copy[index] as string).toUpperCase() : (copy[index] as string).toLowerCase();
        });
        out.push(copy.join(''));
      }
      return out.join('\n');
    },
  }),
  defineOp({
    name: 'To Table',
    category: C,
    description: 'Lays out delimited data as an ASCII, HTML or Markdown table.',
    input: 'text',
    output: 'text',
    args: [str('cell', 'Cell delimiters', ','), str('row', 'Row delimiters', '\\r\\n'), bool('header', 'Make first row header'), sel('format', 'Format', ['ASCII', 'HTML', 'Markdown'])],
    run: (input, a) => {
      const rowSplit = new RegExp(`[${unescapeShort(sArg(a, 'row')).replace(/[\]\\^-]/g, '\\$&')}]+`);
      const cellSplit = new RegExp(`[${unescapeShort(sArg(a, 'cell')).replace(/[\]\\^-]/g, '\\$&')}]`);
      const rows = input
        .split(rowSplit)
        .filter((r) => r !== '')
        .map((r) => r.split(cellSplit));
      const cols = Math.max(0, ...rows.map((r) => r.length));
      const header = bArg(a, 'header');
      const format = sArg(a, 'format');
      if (format === 'HTML') {
        const html = `<table>${rows.map((r, i) => `<tr>${Array.from({ length: cols }, (_, c) => (header && i === 0 ? `<th>${escapeHtml(r[c] ?? '')}</th>` : `<td>${escapeHtml(r[c] ?? '')}</td>`)).join('')}</tr>`).join('')}</table>`;
        return { value: html, preview: { kind: 'html', html } };
      }
      const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r) => (r[c] ?? '').length)));
      const line = (r: string[], edge: string, sep: string) => `${edge} ${widths.map((w, c) => (r[c] ?? '').padEnd(w)).join(` ${sep} `)} ${edge}`;
      if (format === 'Markdown') {
        const body = rows.map((r) => line(r, '|', '|'));
        const rule = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
        return header ? [body[0], rule, ...body.slice(1)].join('\n') : [line([], '|', '|'), rule, ...body].join('\n');
      }
      const border = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
      const out = [border];
      rows.forEach((r, i) => {
        out.push(line(r, '|', '|'));
        if (header && i === 0) out.push(border.replace(/-/g, '='));
      });
      out.push(border);
      return out.join('\n');
    },
  }),
  defineOp({
    name: 'Reverse',
    category: C,
    description: 'Reverses the order of bytes, characters or lines.',
    input: 'bytes',
    output: 'bytes',
    args: [sel('by', 'By', ['Byte', 'Character', 'Line'], 'Character')],
    run: (input, a) => {
      const by = sArg(a, 'by');
      if (by === 'Byte') return input.slice().reverse();
      const text = new TextDecoder().decode(input);
      const out = by === 'Line' ? text.split('\n').reverse().join('\n') : Array.from(text).reverse().join('');
      return new TextEncoder().encode(out);
    },
  }),
  defineOp({
    name: 'Sort',
    category: C,
    description: 'Sorts items alphabetically, numerically, by IP address or by length.',
    input: 'text',
    output: 'text',
    args: [
      sel('delimiter', 'Delimiter', INPUT_DELIMS),
      bool('reverse', 'Reverse'),
      sel('order', 'Order', ['Alphabetical (case sensitive)', 'Alphabetical (case insensitive)', 'IP address', 'Numeric', 'Numeric (hexadecimal)', 'Length']),
    ],
    run: (input, a) => {
      const sorted = sortItems(items(input, sArg(a, 'delimiter')), sArg(a, 'order'));
      return (bArg(a, 'reverse') ? sorted.reverse() : sorted).join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Shuffle',
    category: C,
    description: 'Puts items in a random order.',
    input: 'text',
    output: 'text',
    volatile: true,
    args: [sel('delimiter', 'Delimiter', INPUT_DELIMS)],
    run: (input, a) => {
      const list = items(input, sArg(a, 'delimiter'));
      for (let i = list.length - 1; i > 0; i--) {
        const j = (crypto.getRandomValues(new Uint32Array(1))[0] as number) % (i + 1);
        [list[i], list[j]] = [list[j] as string, list[i] as string];
      }
      return list.join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Unique',
    category: C,
    description: 'Removes duplicate items, optionally counting them.',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', INPUT_DELIMS), bool('count', 'Display count')],
    run: (input, a) => {
      const counts = new Map<string, number>();
      for (const item of items(input, sArg(a, 'delimiter'))) counts.set(item, (counts.get(item) ?? 0) + 1);
      return [...counts.entries()].map(([item, n]) => (bArg(a, 'count') ? `${n} ${item}` : item)).join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Split',
    category: C,
    description: 'Splits on one delimiter and joins with another.',
    input: 'text',
    output: 'text',
    args: [
      editable('split', 'Split delimiter', [
        { label: 'Comma', value: ',' },
        { label: 'Space', value: ' ' },
        { label: 'Line feed', value: '\\n' },
        { label: 'CRLF', value: '\\r\\n' },
        { label: 'Semi-colon', value: ';' },
        { label: 'Colon', value: ':' },
        { label: 'Nothing (separate chars)', value: '' },
      ]),
      editable('join', 'Join delimiter', [
        { label: 'Line feed', value: '\\n' },
        { label: 'CRLF', value: '\\r\\n' },
        { label: 'Space', value: ' ' },
        { label: 'Comma', value: ',' },
        { label: 'Semi-colon', value: ';' },
        { label: 'Colon', value: ':' },
        { label: 'Nothing (join chars)', value: '' },
      ]),
    ],
    run: (input, a) => input.split(unescapeShort(sArg(a, 'split'))).join(unescapeShort(sArg(a, 'join'))),
  }),
  defineOp({
    name: 'Filter',
    category: C,
    description: 'Keeps only items that match (or do not match) a regular expression.',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', INPUT_DELIMS), str('regex', 'Regex', ''), bool('invert', 'Invert condition')],
    run: (input, a) => {
      const regex = userRegex(sArg(a, 'regex'), '');
      return items(input, sArg(a, 'delimiter'))
        .filter((item) => regex.test(item) !== bArg(a, 'invert'))
        .join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Head',
    category: C,
    description: 'Keeps the first n items (a negative n drops the last items).',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', INPUT_DELIMS), num('number', 'Number', 10)],
    run: (input, a) => {
      const list = splitBy(input, sArg(a, 'delimiter'));
      const n = nArg(a, 'number');
      return (n >= 0 ? list.slice(0, n) : list.slice(0, n)).join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Tail',
    category: C,
    description: 'Keeps the last n items (a negative n drops the first items).',
    input: 'text',
    output: 'text',
    args: [sel('delimiter', 'Delimiter', INPUT_DELIMS), num('number', 'Number', 10)],
    run: (input, a) => {
      const list = splitBy(input, sArg(a, 'delimiter'));
      const n = nArg(a, 'number');
      return (n >= 0 ? list.slice(Math.max(0, list.length - n)) : list.slice(-n)).join(delimiter(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Count occurrences',
    category: C,
    description: 'Counts how often a string or regular expression appears.',
    input: 'text',
    output: 'text',
    args: [keyed('search', 'Search string', 'Simple string', ['Regex', 'Extended (\\n, \\t, \\x...)', 'Simple string'])],
    run: (input, a) => {
      const search = sArg(a, 'search');
      if (search === '') return '0';
      const format = sArg(a, 'search.format');
      const regex = format === 'Regex' ? userRegex(search, 'g') : new RegExp((format.startsWith('Extended') ? unescapeShort(search) : search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      return String(regexMatches(input, regex).length);
    },
  }),
  defineOp({
    name: 'Expand alphabet range',
    category: C,
    description: 'Expands ranges such as a-z or 0-9 into every character.',
    input: 'text',
    output: 'text',
    args: [str('delimiter', 'Delimiter', '')],
    run: (input, a) => {
      let out = '';
      const chars = Array.from(input);
      for (let i = 0; i < chars.length; i++) {
        if (chars[i + 1] === '-' && chars[i + 2] !== undefined) {
          const from = (chars[i] as string).codePointAt(0) as number;
          const to = (chars[i + 2] as string).codePointAt(0) as number;
          for (let c = from; c <= to && c - from < 65536; c++) out += String.fromCodePoint(c);
          i += 2;
        } else out += chars[i];
      }
      return Array.from(out).join(unescapeShort(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Drop bytes',
    category: C,
    description: 'Removes a run of bytes.',
    input: 'bytes',
    output: 'bytes',
    args: [num('start', 'Start', 0, { min: 0 }), num('length', 'Length', 5, { min: 0 }), bool('each', 'Apply to each line')],
    run: (input, a) => perLine(input, bArg(a, 'each'), (chunk) => Uint8Array.from([...chunk.slice(0, nArg(a, 'start')), ...chunk.slice(nArg(a, 'start') + nArg(a, 'length'))])),
  }),
  defineOp({
    name: 'Take bytes',
    category: C,
    description: 'Keeps only a run of bytes.',
    input: 'bytes',
    output: 'bytes',
    args: [num('start', 'Start', 0, { min: 0 }), num('length', 'Length', 5, { min: 0 }), bool('each', 'Apply to each line')],
    run: (input, a) => perLine(input, bArg(a, 'each'), (chunk) => chunk.slice(nArg(a, 'start'), nArg(a, 'start') + nArg(a, 'length'))),
  }),
  defineOp({
    name: 'Pad lines',
    category: C,
    description: 'Pads every line at the start or end to a set length.',
    input: 'text',
    output: 'text',
    args: [sel('position', 'Position', ['Start', 'End']), num('length', 'Length', 5, { min: 0 }), str('char', 'Character', ' ')],
    run: (input, a) => {
      const ch = unescapeShort(sArg(a, 'char')) || ' ';
      return input
        .split('\n')
        .map((line) => (sArg(a, 'position') === 'Start' ? line.padStart(line.length + nArg(a, 'length'), ch) : line.padEnd(line.length + nArg(a, 'length'), ch)))
        .join('\n');
    },
  }),
  defineOp({
    name: 'Find / Replace',
    category: C,
    description: 'Replaces text or regular expression matches ($1 refers to a capture group).',
    input: 'text',
    output: 'text',
    keywords: ['substitute', 'sed'],
    args: [
      keyed('find', 'Find', 'Regex', ['Regex', 'Extended (\\n, \\t, \\x...)', 'Simple string']),
      str('replace', 'Replace', ''),
      bool('global', 'Global match', true),
      bool('caseInsensitive', 'Case insensitive'),
      bool('multiline', 'Multiline matching', true),
      bool('dotAll', 'Dot matches all'),
    ],
    run: (input, a) => {
      const find = sArg(a, 'find');
      if (find === '') return input;
      const format = sArg(a, 'find.format');
      const flags = `${bArg(a, 'global') ? 'g' : ''}${bArg(a, 'caseInsensitive') ? 'i' : ''}${bArg(a, 'multiline') ? 'm' : ''}${bArg(a, 'dotAll') ? 's' : ''}`;
      const regex = format === 'Regex' ? userRegex(find, flags) : new RegExp((format.startsWith('Extended') ? unescapeShort(find) : find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      return input.replace(regex, format === 'Regex' ? unescapeShort(sArg(a, 'replace')) : unescapeShort(sArg(a, 'replace')).replace(/\$/g, '$$$$'));
    },
  }),
  defineOp({
    name: 'Regular expression',
    category: C,
    also: ['Extractors'],
    description: 'Highlights or lists regular-expression matches and capture groups.',
    input: 'text',
    output: 'text',
    keywords: ['regex', 'grep'],
    args: [
      editable('builtin', 'Built in regexes', BUILT_IN_REGEXES),
      txt('regex', 'Regex', ''),
      bool('caseInsensitive', 'Case insensitive', true),
      bool('multiline', '^ and $ match at newlines', true),
      bool('dotAll', 'Dot matches all'),
      bool('unicode', 'Unicode support'),
      bool('astral', 'Astral support'),
      bool('total', 'Display total'),
      sel('output', 'Output format', ['Highlight matches', 'List matches', 'List capture groups', 'List matches with capture groups']),
    ],
    run: (input, a) => {
      const source = sArg(a, 'regex') || sArg(a, 'builtin');
      if (source === '') return input;
      const flags = `g${bArg(a, 'caseInsensitive') ? 'i' : ''}${bArg(a, 'multiline') ? 'm' : ''}${bArg(a, 'dotAll') ? 's' : ''}${bArg(a, 'unicode') || bArg(a, 'astral') ? 'u' : ''}`;
      const matches = regexMatches(input, userRegex(source, flags));
      const total = bArg(a, 'total') ? `Total found: ${matches.length}\n\n` : '';
      const format = sArg(a, 'output');
      if (format === 'Highlight matches') return { value: total + input, preview: { kind: 'html', html: highlight(input, matches) } };
      if (format === 'List matches') return total + matches.map((m) => m[0]).join('\n');
      if (format === 'List capture groups') return total + matches.map((m) => m.slice(1).join('\n')).join('\n');
      return total + matches.map((m) => [m[0], ...m.slice(1).map((g, i) => `  Group ${i + 1}: ${g ?? ''}`)].join('\n')).join('\n');
    },
  }),
  defineOp({
    name: 'Fuzzy Match',
    category: C,
    description: 'Finds lines that contain the letters of a search in order, best matches first.',
    input: 'text',
    output: 'text',
    args: [str('search', 'Search', '')],
    run: (input, a) => {
      const needle = Array.from(sArg(a, 'search').toLowerCase());
      if (needle.length === 0) return input;
      const scored: [number, string][] = [];
      for (const line of input.split('\n')) {
        const hay = line.toLowerCase();
        let at = -1;
        let score = 0;
        let previous = -2;
        let ok = true;
        for (const ch of needle) {
          at = hay.indexOf(ch, at + 1);
          if (at === -1) {
            ok = false;
            break;
          }
          score += at === previous + 1 ? 15 : 0;
          if (at === 0 || /[\s_\-./\\]/.test(hay[at - 1] ?? '')) score += 30;
          score -= Math.min(3, at);
          previous = at;
        }
        if (ok) scored.push([score - line.length * 0.1, line]);
      }
      return scored
        .sort((x, y) => y[0] - x[0])
        .map(([s, line]) => `${Math.round(s)}\t${line}`)
        .join('\n');
    },
  }),
  defineOp({
    name: 'Offset checker',
    category: C,
    description: 'Highlights characters that are the same at the same position in every sample.',
    input: 'text',
    output: 'text',
    args: [str('sample', 'Sample delimiter', '\\n\\n')],
    run: (input, a) => {
      const samples = input.split(unescapeShort(sArg(a, 'sample')));
      if (samples.length < 2) throw new OpError('Enter at least two samples.');
      const same = (i: number) => samples.every((s) => s[i] !== undefined && s[i] === samples[0]?.[i]);
      const text = samples.map((s) => Array.from(s, (ch, i) => (same(i) ? ch : '·')).join('')).join('\n');
      const html = `<pre>${samples.map((s) => Array.from(s, (ch, i) => (same(i) ? `<mark>${escapeHtml(ch)}</mark>` : escapeHtml(ch))).join('')).join('\n')}</pre>`;
      return { value: text, preview: { kind: 'html', html } };
    },
  }),
  defineOp({
    name: 'Hamming Distance',
    category: C,
    description: 'Counts the positions at which two equal-length samples differ.',
    input: 'text',
    output: 'text',
    args: [str('delimiter', 'Delimiter', '\\n\\n'), sel('unit', 'Unit', ['Byte', 'Bit']), sel('type', 'Input type', ['Raw string', 'Hex'])],
    run: async (input, a) => {
      const { hexToBytes } = await import('../core');
      const samples = input.split(unescapeShort(sArg(a, 'delimiter')));
      if (samples.length !== 2) throw new OpError('Enter exactly two samples.');
      const [x, y] = samples.map((s) => (sArg(a, 'type') === 'Hex' ? hexToBytes(s) : toBytes(s))) as [Uint8Array, Uint8Array];
      if (x.length !== y.length) throw new OpError('Both samples must be the same length.');
      let distance = 0;
      for (let i = 0; i < x.length; i++) {
        const diff = (x[i] as number) ^ (y[i] as number);
        if (sArg(a, 'unit') === 'Bit') for (let b = diff; b; b &= b - 1) distance++;
        else if (diff) distance++;
      }
      return String(distance);
    },
  }),
  defineOp({
    name: 'Levenshtein Distance',
    category: C,
    description: 'The number of edits needed to turn one sample into the other.',
    input: 'text',
    output: 'text',
    args: [str('sample', 'Sample delimiter', '\\n'), num('ins', 'Insertion cost', 1, { min: 0 }), num('del', 'Deletion cost', 1, { min: 0 }), num('sub', 'Substitution cost', 1, { min: 0 })],
    run: (input, a) => {
      const samples = input.split(unescapeShort(sArg(a, 'sample')));
      if (samples.length !== 2) throw new OpError('Enter exactly two samples.');
      return String(levenshtein(samples[0] as string, samples[1] as string, nArg(a, 'ins'), nArg(a, 'del'), nArg(a, 'sub')));
    },
  }),
  unitOp('Convert distance', DISTANCE, 'Metres (m)', 'Kilometres (km)'),
  unitOp('Convert area', AREA, 'Square metre (sq m)', 'Hectare (ha)'),
  unitOp('Convert mass', MASS, 'Kilogram (kg)', 'Pound (lb)'),
  unitOp('Convert speed', SPEED, 'Kilometres per hour (km/h)', 'Miles per hour (mph)'),
  unitOp('Convert data units', DATA, 'Megabytes (MB)', 'Mebibytes (MiB)'),
  defineOp({
    name: 'Parse UNIX file permissions',
    category: C,
    description: 'Explains permissions given as rwxr-xr-x or as an octal number such as 0755.',
    input: 'text',
    output: 'text',
    magic: [{ pattern: /^\s*d[rxw-]{9}\s*$/ }],
    run: (input) => {
      const text = input.trim();
      let mode: number;
      let type = '';
      if (/^[0-7]{3,4}$/.test(text)) mode = Number.parseInt(text, 8);
      else if (/^[-dlbcps]?[rwxsStT-]{9}$/.test(text)) {
        const body = text.length === 10 ? text.slice(1) : text;
        type = text.length === 10 ? (text[0] as string) : '';
        mode = 0;
        Array.from(body).forEach((ch, i) => {
          if (ch !== '-' && ch !== 'S' && ch !== 'T') mode |= 1 << (8 - i);
        });
        if (/[sS]/.test(body[2] ?? '')) mode |= 0o4000;
        if (/[sS]/.test(body[5] ?? '')) mode |= 0o2000;
        if (/[tT]/.test(body[8] ?? '')) mode |= 0o1000;
      } else throw new OpError('Enter permissions such as rwxr-xr-x, -rw-r--r-- or 0755.');
      const who = ['User', 'Group', 'Others'];
      const symbolic = who
        .map((_, i) => {
          const bits = (mode >> (6 - i * 3)) & 7;
          return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`;
        })
        .join('');
      const lines = [`Textual representation: ${type}${symbolic}`, `Octal representation:   ${(mode & 0o7777).toString(8).padStart(4, '0')}`];
      if (type)
        lines.push(
          `File type: ${({ '-': 'regular file', d: 'directory', l: 'symbolic link', b: 'block device', c: 'character device', p: 'named pipe', s: 'socket' } as Record<string, string>)[type] ?? type}`,
        );
      if (mode & 0o4000) lines.push('Set user ID (setuid)');
      if (mode & 0o2000) lines.push('Set group ID (setgid)');
      if (mode & 0o1000) lines.push('Sticky bit');
      for (const [i, w] of who.entries()) {
        const bits = (mode >> (6 - i * 3)) & 7;
        lines.push(`${w}: ${[bits & 4 ? 'read' : '', bits & 2 ? 'write' : '', bits & 1 ? 'execute' : ''].filter(Boolean).join(', ') || 'no access'}`);
      }
      return lines.join('\n');
    },
  }),
  defineOp({
    name: 'Parse ObjectID timestamp',
    category: C,
    description: 'Reads the creation time from a MongoDB ObjectId.',
    input: 'text',
    output: 'text',
    run: (input) => {
      const id = input.trim().replace(/^ObjectId\(["']?|["']?\)$/g, '');
      if (!/^[0-9a-f]{24}$/i.test(id)) throw new OpError('An ObjectId is 24 hexadecimal digits.');
      return new Date(Number.parseInt(id.slice(0, 8), 16) * 1000).toISOString();
    },
  }),
  defineOp({
    name: 'Escape string',
    category: C,
    description: 'Escapes special characters with backslash sequences.',
    input: 'text',
    output: 'text',
    args: [
      sel('level', 'Escape level', ['Special chars', 'Everything', 'Minimal']),
      sel('quote', 'Escape quote', ['Single', 'Double', 'Backtick']),
      bool('json', 'JSON compatible'),
      bool('es6', 'ES6 compatible', true),
      bool('upper', 'Uppercase hex'),
    ],
    run: (input, a) => escapeString(input, sArg(a, 'level'), sArg(a, 'quote'), bArg(a, 'json'), bArg(a, 'es6'), bArg(a, 'upper')),
  }),
  defineOp({
    name: 'Unescape string',
    category: C,
    description: 'Interprets backslash escapes (\\n, \\t, \\x41, \\u0041, \\u{1F600}, octal).',
    input: 'text',
    output: 'text',
    run: (input) => unescapeString(input),
  }),
  defineOp({
    name: 'Sleep',
    category: C,
    also: ['Date / Time'],
    description: 'Waits a set time before passing the data on (for testing).',
    input: 'bytes',
    output: 'bytes',
    args: [num('ms', 'Time (ms)', 1000, { min: 0, max: 60000 })],
    run: async (input, a) => {
      await new Promise((resolve) => setTimeout(resolve, Math.min(60000, Math.max(0, nArg(a, 'ms')))));
      return input;
    },
  }),
  defineOp({
    name: 'File Tree',
    category: C,
    description: 'Draws a tree from a list of file paths.',
    input: 'text',
    output: 'text',
    args: [str('sep', 'File Path Delimiter', '/'), sel('delimiter', 'Delimiter', INPUT_DELIMS)],
    run: (input, a) => fileTree(items(input, sArg(a, 'delimiter')), unescapeShort(sArg(a, 'sep')) || '/'),
  }),
  defineOp({
    name: 'Wrap',
    category: C,
    description: 'Breaks lines every n characters.',
    input: 'text',
    output: 'text',
    args: [num('width', 'Line Width', 64, { min: 1 })],
    run: (input, a) =>
      (
        Array.from(input)
          .join('')
          .match(new RegExp(`.{1,${Math.max(1, nArg(a, 'width'))}}`, 'gsu')) ?? []
      ).join('\n'),
  }),
  defineOp({
    name: 'Take nth bytes',
    category: C,
    description: 'Keeps every nth byte from a starting offset.',
    input: 'bytes',
    output: 'bytes',
    args: [num('every', 'Take every', 4, { min: 1 }), num('start', 'Starting at', 0, { min: 0 }), bool('each', 'Apply to each line')],
    run: (input, a) => perLine(input, bArg(a, 'each'), (chunk) => chunk.filter((_, i) => i >= nArg(a, 'start') && (i - nArg(a, 'start')) % Math.max(1, nArg(a, 'every')) === 0)),
  }),
  defineOp({
    name: 'Drop nth bytes',
    category: C,
    description: 'Removes every nth byte from a starting offset.',
    input: 'bytes',
    output: 'bytes',
    args: [num('every', 'Drop every', 4, { min: 1 }), num('start', 'Starting at', 0, { min: 0 }), bool('each', 'Apply to each line')],
    run: (input, a) => perLine(input, bArg(a, 'each'), (chunk) => chunk.filter((_, i) => !(i >= nArg(a, 'start') && (i - nArg(a, 'start')) % Math.max(1, nArg(a, 'every')) === 0))),
  }),
];
