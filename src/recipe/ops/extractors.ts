/** Extractors: strings, addresses, URLs, paths, hashes, XPath/JSONPath/CSS queries, EXIF, ID3 and keywords. */
import { bArg, bool, defineOp, nArg, num, OpError, type Operation, sArg, sel, str, txt, unescapeShort } from '../core';

const C = 'Extractors' as const;

const listArgs = () => [bool('total', 'Display total'), bool('sort', 'Sort'), bool('unique', 'Unique')];

function present(found: string[], a: Record<string, unknown>): string {
  let list = found;
  if (a.unique === true) list = [...new Set(list)];
  if (a.sort === true) list = [...list].sort();
  return (a.total === true ? `Total found: ${list.length}\n\n` : '') + list.join('\n');
}

function extractor(name: string, description: string, regex: RegExp): Operation {
  return defineOp({ name, category: C, description, input: 'text', output: 'text', args: listArgs(), run: (input, a) => present(input.match(regex) ?? [], a) });
}

const IPV4 = /(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)/g;
const IPV6 =
  /(?:[\da-f]{1,4}:){7}[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,7}:|(?:[\da-f]{1,4}:){1,6}:[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,5}(?::[\da-f]{1,4}){1,2}|(?:[\da-f]{1,4}:){1,4}(?::[\da-f]{1,4}){1,3}|(?:[\da-f]{1,4}:){1,3}(?::[\da-f]{1,4}){1,4}|(?:[\da-f]{1,4}:){1,2}(?::[\da-f]{1,4}){1,5}|[\da-f]{1,4}:(?::[\da-f]{1,4}){1,6}|::(?:[\da-f]{1,4}:){0,6}[\da-f]{1,4}/gi;

const isLocalV4 = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

const STRINGS_MATCH = [
  '[ASCII]',
  'Alphanumeric + punctuation (A)',
  'All printable chars (A)',
  'Null-terminated strings (A)',
  '[Unicode]',
  'Alphanumeric + punctuation (U)',
  'All printable chars (U)',
  'Null-terminated strings (U)',
];

function strings(bytes: Uint8Array, encoding: string, min: number, match: string): string[] {
  const unicode = match.endsWith('(U)') || match === '[Unicode]';
  const printable = match.startsWith('All printable') || match === '[ASCII]' || match === '[Unicode]';
  const nullTerminated = match.startsWith('Null-terminated');
  const ok = (c: number) => (printable || nullTerminated ? c >= 32 && c < 127 : /[A-Za-z\d/\-:.,_$%'"()<>= ![\]{}@]/.test(String.fromCharCode(c))) || c === 9;
  const results: string[] = [];
  const scan = (step: number, little: boolean) => {
    let current = '';
    for (let i = 0; i + step - 1 < bytes.length; i += step) {
      const c = step === 1 ? (bytes[i] as number) : little ? (bytes[i] as number) | ((bytes[i + 1] as number) << 8) : ((bytes[i] as number) << 8) | (bytes[i + 1] as number);
      if (c < 256 && ok(c)) current += String.fromCharCode(c);
      else {
        if (current.length >= min && (!nullTerminated || c === 0)) results.push(current);
        current = '';
      }
    }
    if (current.length >= min && !nullTerminated) results.push(current);
  };
  if (!unicode && (encoding === 'Single byte' || encoding === 'All')) scan(1, true);
  if (encoding === '16-bit littleendian' || encoding === 'All' || unicode) scan(2, true);
  if (encoding === '16-bit bigendian' || encoding === 'All') scan(2, false);
  return results;
}

function id3(bytes: Uint8Array): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const text = (b: Uint8Array) => {
    const encoding = b[0];
    const body = b.slice(1);
    if (encoding === 1 || encoding === 2) {
      const little = encoding === 1 ? body[0] === 0xff : false;
      const start = encoding === 1 ? 2 : 0;
      let s = '';
      for (let i = start; i + 1 < body.length; i += 2) {
        const c = little ? (body[i] as number) | ((body[i + 1] as number) << 8) : ((body[i] as number) << 8) | (body[i + 1] as number);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
    return new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(body).replace(/\0+$/, '');
  };
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const version = bytes[3] as number;
    out.version = `ID3v2.${version}.${bytes[4]}`;
    const size = (((bytes[6] as number) & 127) << 21) | (((bytes[7] as number) & 127) << 14) | (((bytes[8] as number) & 127) << 7) | ((bytes[9] as number) & 127);
    let at = 10;
    const end = Math.min(bytes.length, 10 + size);
    const frames: Record<string, string> = {};
    while (at + 10 <= end) {
      const id = String.fromCharCode(...bytes.slice(at, at + 4));
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const length =
        version === 4
          ? (((bytes[at + 4] as number) & 127) << 21) | (((bytes[at + 5] as number) & 127) << 14) | (((bytes[at + 6] as number) & 127) << 7) | ((bytes[at + 7] as number) & 127)
          : (((bytes[at + 4] as number) << 24) | ((bytes[at + 5] as number) << 16) | ((bytes[at + 6] as number) << 8) | (bytes[at + 7] as number)) >>> 0;
      const body = bytes.slice(at + 10, at + 10 + length);
      if (id.startsWith('T')) frames[id] = text(body);
      else if (id === 'COMM')
        frames[id] =
          text(Uint8Array.from([body[0] ?? 0, ...body.slice(4)]))
            .split('\0')
            .pop() ?? '';
      else if (id === 'APIC') frames[id] = `picture, ${length} bytes`;
      else frames[id] = `${length} bytes`;
      at += 10 + length;
    }
    out.frames = frames;
  }
  if (bytes.length >= 128 && String.fromCharCode(...bytes.slice(bytes.length - 128, bytes.length - 125)) === 'TAG') {
    const tag = bytes.slice(bytes.length - 128);
    const field = (from: number, to: number) => new TextDecoder('latin1').decode(tag.slice(from, to)).replace(/\0.*$/, '').trim();
    out.id3v1 = { title: field(3, 33), artist: field(33, 63), album: field(63, 93), year: field(93, 97), comment: field(97, 127), genre: tag[127] };
  }
  if (Object.keys(out).length === 0) throw new OpError('No ID3 tags were found.');
  return out;
}

const STOP_WORDS =
  "i,me,my,myself,we,our,ours,ourselves,you,you're,you've,you'll,you'd,your,yours,yourself,yourselves,he,him,his,himself,she,she's,her,hers,herself,it,it's,its,itself,they,them,their,theirs,themselves,what,which,who,whom,this,that,that'll,these,those,am,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,a,an,the,and,but,if,or,because,as,until,while,of,at,by,for,with,about,against,between,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,then,once,here,there,when,where,why,how,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,s,t,can,will,just,don,don't,should,should've,now,d,ll,m,o,re,ve,y,ain,aren,aren't,couldn,couldn't,didn,didn't,doesn,doesn't,hadn,hadn't,hasn,hasn't,haven,haven't,isn,isn't,ma,mightn,mightn't,mustn,mustn't,needn,needn't,shan,shan't,shouldn,shouldn't,wasn,wasn't,weren,weren't,won,won't,wouldn,wouldn't";

function rake(text: string, wordDelim: string, sentenceDelim: string, stops: string[]): [number, string][] {
  const stop = new Set(stops.map((w) => w.trim().toLowerCase()).filter(Boolean));
  const phrases: string[][] = [];
  for (const sentence of text.toLowerCase().split(new RegExp(sentenceDelim))) {
    let current: string[] = [];
    for (const raw of sentence.split(new RegExp(wordDelim))) {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (word === '' || stop.has(word)) {
        if (current.length) phrases.push(current);
        current = [];
      } else current.push(word);
    }
    if (current.length) phrases.push(current);
  }
  const freq = new Map<string, number>();
  const degree = new Map<string, number>();
  for (const phrase of phrases) {
    for (const word of phrase) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
      degree.set(word, (degree.get(word) ?? 0) + phrase.length);
    }
  }
  const scored = new Map<string, number>();
  for (const phrase of phrases) {
    const key = phrase.join(' ');
    scored.set(
      key,
      phrase.reduce((sum, w) => sum + (degree.get(w) ?? 0) / (freq.get(w) ?? 1), 0),
    );
  }
  return [...scored.entries()].map(([phrase, score]) => [score, phrase] as [number, string]).sort((x, y) => y[0] - x[0]);
}

export const extractorOps: Operation[] = [
  defineOp({
    name: 'Strings',
    category: C,
    description: 'Lists runs of printable characters in data, like the Unix strings command.',
    input: 'bytes',
    output: 'text',
    args: [
      sel('encoding', 'Encoding', ['Single byte', '16-bit littleendian', '16-bit bigendian', 'All']),
      num('min', 'Minimum length', 4, { min: 1 }),
      sel('match', 'Match', STRINGS_MATCH),
      ...listArgs(),
    ],
    run: (input, a) => present(strings(input, sArg(a, 'encoding'), nArg(a, 'min'), sArg(a, 'match')), a),
  }),
  defineOp({
    name: 'Extract IP addresses',
    category: C,
    description: 'Finds IPv4 and IPv6 addresses.',
    input: 'text',
    output: 'text',
    args: [bool('v4', 'IPv4', true), bool('v6', 'IPv6'), bool('removeLocal', 'Remove local IPv4 addresses'), ...listArgs()],
    run: (input, a) => {
      let found: string[] = [];
      if (bArg(a, 'v4')) found.push(...(input.match(IPV4) ?? []));
      if (bArg(a, 'v6')) found.push(...(input.match(IPV6) ?? []).filter((ip) => ip.includes(':') && ip.length > 2));
      if (bArg(a, 'removeLocal')) found = found.filter((ip) => !isLocalV4(ip));
      return present(found, a);
    },
  }),
  extractor('Extract email addresses', 'Finds email addresses.', /\b[\w.!#$%&'*+/=?^`{|}~-]+@(?:[\w-]+\.)+[a-z]{2,}\b/gi),
  extractor('Extract MAC addresses', 'Finds MAC addresses.', /\b[A-F\d]{2}(?:[:-][A-F\d]{2}){5}\b/gi),
  extractor('Extract URLs', 'Finds URLs.', /[a-z][a-z\d+.-]*:\/\/[^\s"'<>()[\]{}]+[^\s"'<>()[\]{}.,!?;:]/gi),
  defineOp({
    name: 'Extract domains',
    category: C,
    description: 'Finds fully qualified domain names.',
    input: 'text',
    output: 'text',
    args: [...listArgs(), bool('underscore', 'Underscore (DMARC, DKIM, etc)')],
    run: (input, a) =>
      present(input.match(bArg(a, 'underscore') ? /\b(?:[a-z\d_](?:[a-z\d_-]{0,61}[a-z\d])?\.)+[a-z]{2,63}\b/gi : /\b(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}\b/gi) ?? [], a),
  }),
  defineOp({
    name: 'Extract file paths',
    category: C,
    description: 'Finds Windows and UNIX file paths.',
    input: 'text',
    output: 'text',
    args: [bool('windows', 'Windows', true), bool('unix', 'UNIX', true), ...listArgs()],
    run: (input, a) => {
      const found: string[] = [];
      if (bArg(a, 'windows')) found.push(...(input.match(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g) ?? []));
      if (bArg(a, 'unix')) found.push(...(input.match(/(?<![\w.])(?:\/[\w.-]+)+\/?/g) ?? []));
      return present(found, a);
    },
  }),
  defineOp({
    name: 'Extract hashes',
    category: C,
    description: 'Finds hexadecimal hashes of a given length (40 for SHA-1), or of every common length.',
    input: 'text',
    output: 'text',
    args: [num('length', 'Hash character length', 40, { min: 8 }), bool('all', 'All hashes'), bool('total', 'Display Total')],
    run: (input, a) => {
      const lengths = bArg(a, 'all') ? [32, 40, 56, 64, 96, 128] : [nArg(a, 'length')];
      const found = lengths.flatMap((n) => input.match(new RegExp(`(?<![0-9a-f])[0-9a-f]{${n}}(?![0-9a-f])`, 'gi')) ?? []);
      return (bArg(a, 'total') ? `Total found: ${found.length}\n\n` : '') + found.join('\n');
    },
  }),
  defineOp({
    name: 'XPath expression',
    category: C,
    also: ['Code tidy'],
    description: 'Selects parts of an XML document with an XPath expression.',
    input: 'text',
    output: 'text',
    args: [str('xpath', 'XPath', ''), str('delimiter', 'Result delimiter', '\\n')],
    run: async (input, a) => {
      const { DOMParser, XMLSerializer } = await import('@xmldom/xmldom');
      const xpath = await import('xpath');
      const errors: string[] = [];
      const doc = new DOMParser({ onError: (level: string, message: string) => (level !== 'warning' ? errors.push(message) : undefined) } as never).parseFromString(input, 'text/xml');
      if (errors.length) throw new OpError(`Invalid XML: ${errors[0]}`);
      let nodes: unknown;
      try {
        nodes = xpath.select(sArg(a, 'xpath'), doc as never);
      } catch (error) {
        throw new OpError(`Invalid XPath: ${(error as Error).message}`);
      }
      const serializer = new XMLSerializer();
      const list = Array.isArray(nodes) ? nodes : [nodes];
      return list
        .map((node) =>
          typeof node === 'object' && node !== null && 'nodeType' in node
            ? (node as { nodeType: number }).nodeType === 2
              ? String((node as { value: string }).value)
              : serializer.serializeToString(node as never)
            : String(node),
        )
        .join(unescapeShort(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'JPath expression',
    category: C,
    also: ['Code tidy'],
    description: 'Selects parts of a JSON document with a JSONPath query.',
    input: 'text',
    output: 'text',
    args: [str('query', 'Query', ''), str('delimiter', 'Result delimiter', '\\n')],
    run: async (input, a) => {
      const { JSONPath } = await import('jsonpath-plus');
      const result = JSONPath({ path: sArg(a, 'query'), json: JSON.parse(input) as object, wrap: true, eval: 'safe' }) as unknown[];
      return result.map((item) => JSON.stringify(item)).join(unescapeShort(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'CSS selector',
    category: C,
    also: ['Code tidy'],
    description: 'Selects HTML elements with a CSS selector.',
    input: 'text',
    output: 'text',
    args: [str('selector', 'CSS selector', ''), str('delimiter', 'Delimiter', '\\n')],
    run: async (input, a) => {
      const { parseDocument } = await import('htmlparser2');
      const { selectAll } = await import('css-select');
      const { getOuterHTML } = await import('domutils');
      const doc = parseDocument(input);
      let found: unknown[];
      try {
        found = selectAll(sArg(a, 'selector'), doc as never) as unknown[];
      } catch (error) {
        throw new OpError(`Invalid selector: ${(error as Error).message}`);
      }
      return found.map((node) => getOuterHTML(node as never)).join(unescapeShort(sArg(a, 'delimiter')));
    },
  }),
  defineOp({
    name: 'Extract EXIF',
    category: C,
    also: ['Forensics', 'Multimedia'],
    description: 'Lists the EXIF, GPS, IPTC and XMP metadata in a photo.',
    input: 'bytes',
    output: 'text',
    run: async (input) => {
      const exifr = await import('exifr');
      const data = (await exifr.parse(input, { tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: false, mergeOutput: true, translateValues: true })) as
        | Record<string, unknown>
        | undefined;
      if (!data) return 'No EXIF data found.';
      return Object.entries(data)
        .map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? `${v.length} bytes` : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('\n');
    },
  }),
  defineOp({
    name: 'Extract ID3',
    category: C,
    description: 'Reads ID3 tags (title, artist, album…) from MP3 files.',
    input: 'bytes',
    output: 'text',
    run: (input) => JSON.stringify(id3(input), null, 4),
  }),
  defineOp({
    name: 'RAKE',
    category: C,
    description: 'Ranks the key phrases in a text (Rapid Automatic Keyword Extraction).',
    input: 'text',
    output: 'text',
    args: [txt('word', 'Word Delimiter (Regex)', '\\s'), txt('sentence', 'Sentence Delimiter (Regex)', '\\.\\s|\\n'), txt('stops', 'Stop Words', STOP_WORDS)],
    run: (input, a) =>
      `Scores: , Keywords: \n${rake(input, sArg(a, 'word'), sArg(a, 'sentence'), sArg(a, 'stops').split(','))
        .map(([score, phrase]) => `${score.toFixed(2)}, ${phrase}`)
        .join('\n')}`,
  }),
];
