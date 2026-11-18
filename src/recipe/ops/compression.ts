/** Compression: Deflate, Zlib, Gzip, ZIP (including ZipCrypto), tar, bzip2, LZ4, LZString and LZNT1. */
import { bArg, bool, cjs, defineOp, nArg, OpError, type Operation, type OpResult, sArg, sel, str, toBytes, utf8 } from '../core';

const C = 'Compression' as const;

const LEVELS = ['Dynamic Huffman Coding', 'Fixed Huffman Coding', 'None (Store)'];
const level = (name: string): 0 | 6 | 9 => (name === 'None (Store)' ? 0 : name === 'Fixed Huffman Coding' ? 6 : 9);

/* ---------------------------------------------------------------- CRC32 -- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32Byte = (crc: number, byte: number) => ((CRC_TABLE[(crc ^ byte) & 255] as number) ^ (crc >>> 8)) >>> 0;

/* ----------------------------------------------------------------- ZIP -- */

interface Entry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

function zipCryptoDecrypt(data: Uint8Array, password: Uint8Array, check: number): Uint8Array {
  let k0 = 0x12345678;
  let k1 = 0x23456789;
  let k2 = 0x34567890;
  const update = (c: number) => {
    k0 = crc32Byte(k0, c);
    k1 = (Math.imul((k1 + (k0 & 255)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crc32Byte(k2, k1 >>> 24);
  };
  for (const c of password) update(c);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const temp = (k2 | 2) & 0xffff;
    const plain = (data[i] as number) ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 255);
    out[i] = plain;
    update(plain);
  }
  if (out[11] !== check) throw new OpError('Wrong ZIP password.');
  return out.slice(12);
}

async function unzip(bytes: Uint8Array, password: string): Promise<Entry[]> {
  const { inflateSync } = await import('fflate');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new OpError('This is not a ZIP archive (no end of central directory).');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new OpError('The ZIP central directory is damaged.');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1').decode(bytes.slice(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) continue;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    let data: Uint8Array = bytes.slice(dataStart, dataStart + size);
    if (flags & 1) {
      if (method === 99) throw new OpError(`"${name}" uses AES encryption, which is not supported; only traditional ZipCrypto is.`);
      if (password === '') throw new OpError(`"${name}" is encrypted: enter the password.`);
      data = zipCryptoDecrypt(data, toBytes(password), flags & 8 ? time >> 8 : crc >>> 24);
    }
    let content: Uint8Array;
    if (method === 0) content = data;
    else if (method === 8) content = inflateSync(data);
    else throw new OpError(`"${name}" uses compression method ${method}, which is not supported.`);
    entries.push({ name, bytes: content });
  }
  return entries;
}

/* ----------------------------------------------------------------- TAR -- */

function tar(name: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const put = (text: string, at: number, length: number) => header.set(utf8(text).slice(0, length), at);
  const octal = (n: number, length: number) => `${n.toString(8).padStart(length - 1, '0')}\0`;
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(data.length, 12), 124, 12);
  put(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  header.fill(32, 148, 156);
  header[156] = 48;
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  const sum = header.reduce((acc, b) => acc + b, 0);
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  const out = new Uint8Array(512 + Math.ceil(data.length / 512) * 512 + 1024);
  out.set(header);
  out.set(data, 512);
  return out;
}

function untar(bytes: Uint8Array): Entry[] {
  const entries: Entry[] = [];
  let at = 0;
  let longName = '';
  while (at + 512 <= bytes.length) {
    const header = bytes.slice(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from: number, length: number) => new TextDecoder().decode(header.slice(from, from + length)).replace(/\0.*$/s, '');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] ?? 48);
    const prefix = field(345, 155);
    let name = longName || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = '';
    const data = bytes.slice(at + 512, at + 512 + size);
    if (type === 'L') longName = new TextDecoder().decode(data).replace(/\0.*$/s, '');
    else if (type === '0' || type === '\0' || type === '7') entries.push({ name, bytes: data });
    else if (type === 'x' || type === 'g') {
      const path = /\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(data));
      if (path) longName = path[1] ?? '';
    }
    name = '';
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function filesResult(entries: Entry[]): OpResult {
  return { value: entries.map((e) => `${e.name} (${e.bytes.length} bytes)`).join('\n'), preview: { kind: 'files', files: entries } };
}

/* --------------------------------------------------------------- bzip2 -- */

class Bits {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.data[this.pos >> 3];
      if (byte === undefined) throw new OpError('The bzip2 data ends early.');
      v = (v << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v >>> 0;
  }
  bit(): number {
    return this.read(1);
  }
  get offset(): number {
    return this.pos;
  }
  align(): void {
    this.pos = (this.pos + 7) & ~7;
  }
  get done(): boolean {
    return this.pos >= this.data.length * 8;
  }
}

export function bunzip2(data: Uint8Array): Uint8Array {
  const bits = new Bits(data);
  const out: number[] = [];
  const header = () => {
    if (bits.read(8) !== 0x42 || bits.read(8) !== 0x5a || bits.read(8) !== 0x68) throw new OpError('This is not bzip2 data (no BZh header).');
    const level = bits.read(8) - 0x30;
    if (level < 1 || level > 9) throw new OpError('Invalid bzip2 block size.');
    return level * 100000;
  };
  let blockMax = header();
  for (;;) {
    const hi = bits.read(24);
    const lo = bits.read(24);
    if (hi === 0x177245 && lo === 0x385090) {
      bits.read(32);
      bits.align();
      if (bits.done || data.length - bits.offset / 8 < 4) break;
      blockMax = header();
      continue;
    }
    if (hi !== 0x314159 || lo !== 0x265359) throw new OpError('The bzip2 block header is damaged.');
    bits.read(32);
    if (bits.bit()) throw new OpError('Randomised bzip2 blocks are not supported.');
    const origPtr = bits.read(24);
    const used: number[] = [];
    const groups16 = bits.read(16);
    for (let i = 0; i < 16; i++) {
      if (groups16 & (0x8000 >> i)) {
        const word = bits.read(16);
        for (let j = 0; j < 16; j++) if (word & (0x8000 >> j)) used.push(i * 16 + j);
      }
    }
    if (used.length === 0) throw new OpError('The bzip2 block uses no symbols.');
    const nGroups = bits.read(3);
    const nSelectors = bits.read(15);
    if (nGroups < 2 || nGroups > 6 || nSelectors < 1) throw new OpError('The bzip2 Huffman tables are damaged.');
    const mtfGroups = Array.from({ length: nGroups }, (_, i) => i);
    const selectors: number[] = [];
    for (let i = 0; i < nSelectors; i++) {
      let j = 0;
      while (bits.bit()) {
        j++;
        if (j >= nGroups) throw new OpError('The bzip2 selectors are damaged.');
      }
      const v = mtfGroups[j] as number;
      mtfGroups.splice(j, 1);
      mtfGroups.unshift(v);
      selectors.push(v);
    }
    const alphaSize = used.length + 2;
    const tables = Array.from({ length: nGroups }, () => {
      const lengths: number[] = [];
      let curr = bits.read(5);
      for (let i = 0; i < alphaSize; i++) {
        for (;;) {
          if (curr < 1 || curr > 20) throw new OpError('The bzip2 code lengths are damaged.');
          if (!bits.bit()) break;
          curr += bits.bit() ? -1 : 1;
        }
        lengths.push(curr);
      }
      const minLen = Math.min(...lengths);
      const maxLen = Math.max(...lengths);
      const perm: number[] = [];
      for (let l = minLen; l <= maxLen; l++) for (let s = 0; s < alphaSize; s++) if (lengths[s] === l) perm.push(s);
      const base = new Array<number>(23).fill(0);
      for (const l of lengths) base[l + 1] = (base[l + 1] as number) + 1;
      for (let i = 1; i < 23; i++) base[i] = (base[i] as number) + (base[i - 1] as number);
      const limit = new Array<number>(23).fill(0);
      let vec = 0;
      for (let i = minLen; i <= maxLen; i++) {
        vec += (base[i + 1] as number) - (base[i] as number);
        limit[i] = vec - 1;
        vec <<= 1;
      }
      for (let i = minLen + 1; i <= maxLen; i++) base[i] = (((limit[i - 1] as number) + 1) << 1) - (base[i] as number);
      return { minLen, maxLen, perm, base, limit };
    });
    const tt = new Uint32Array(blockMax);
    const counts = new Array<number>(256).fill(0);
    const mtf = Array.from({ length: used.length }, (_, i) => i);
    const eob = used.length + 1;
    let n = 0;
    let group = 0;
    let left = 0;
    let runPos = 0;
    let runLength = 0;
    let selector = 0;
    const flushRun = () => {
      if (runLength > 0) {
        const symbol = used[mtf[0] as number] as number;
        if (n + runLength > blockMax) throw new OpError('The bzip2 block is larger than its header says.');
        counts[symbol] = (counts[symbol] as number) + runLength;
        for (let r = 0; r < runLength; r++) tt[n++] = symbol;
        runLength = 0;
        runPos = 0;
      }
    };
    for (;;) {
      if (left === 0) {
        if (selector >= selectors.length) throw new OpError('The bzip2 data ran out of selectors.');
        group = selectors[selector++] as number;
        left = 50;
      }
      left--;
      const t = tables[group] as (typeof tables)[number];
      let zn = t.minLen;
      let zvec = bits.read(zn);
      while (zvec > (t.limit[zn] as number)) {
        zn++;
        if (zn > 20) throw new OpError('The bzip2 data is damaged.');
        zvec = (zvec << 1) | bits.bit();
      }
      const sym = t.perm[zvec - (t.base[zn] as number)];
      if (sym === undefined) throw new OpError('The bzip2 data is damaged.');
      if (sym <= 1) {
        runLength += (sym + 1) << runPos;
        runPos++;
        continue;
      }
      flushRun();
      if (sym === eob) break;
      const index = sym - 1;
      const v = mtf[index] as number;
      mtf.splice(index, 1);
      mtf.unshift(v);
      const symbol = used[v] as number;
      if (n >= blockMax) throw new OpError('The bzip2 block is larger than its header says.');
      counts[symbol] = (counts[symbol] as number) + 1;
      tt[n++] = symbol;
    }
    if (origPtr >= n) throw new OpError('The bzip2 block pointer is out of range.');
    const cumulative = new Array<number>(256).fill(0);
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      cumulative[i] = sum;
      sum += counts[i] as number;
    }
    for (let i = 0; i < n; i++) {
      const c = (tt[i] as number) & 255;
      tt[cumulative[c] as number] = ((tt[cumulative[c] as number] as number) | (i << 8)) >>> 0;
      cumulative[c] = (cumulative[c] as number) + 1;
    }
    let pos = (tt[origPtr] as number) >>> 8;
    let last = -1;
    let run = 0;
    for (let i = 0; i < n; i++) {
      const entry = tt[pos] as number;
      const ch = entry & 255;
      pos = entry >>> 8;
      if (run === 4) {
        for (let r = 0; r < ch; r++) out.push(last);
        run = 0;
        last = -1;
        continue;
      }
      if (ch === last) run++;
      else {
        run = 1;
        last = ch;
      }
      out.push(ch);
    }
  }
  return Uint8Array.from(out);
}

/* ----------------------------------------------------------------- LZ4 -- */

async function xxh32(data: Uint8Array): Promise<number> {
  const { xxhash32 } = await import('hash-wasm');
  return Number.parseInt(await xxhash32(data, 0), 16);
}

function lz4Block(src: Uint8Array, out: number[]): void {
  let at = 0;
  while (at < src.length) {
    const token = src[at++] as number;
    let literals = token >> 4;
    if (literals === 15) {
      let b: number;
      do {
        b = src[at++] as number;
        literals += b;
      } while (b === 255);
    }
    for (let i = 0; i < literals; i++) out.push(src[at++] as number);
    if (at >= src.length) break;
    const offset = (src[at] as number) | ((src[at + 1] as number) << 8);
    at += 2;
    if (offset === 0 || offset > out.length) throw new OpError('The LZ4 data refers outside the output.');
    let length = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b: number;
      do {
        b = src[at++] as number;
        length += b;
      } while (b === 255);
    }
    const start = out.length - offset;
    for (let i = 0; i < length; i++) out.push(out[start + i] as number);
  }
}

async function lz4Decompress(data: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 7 || view.getUint32(0, true) !== 0x184d2204) {
    const out: number[] = [];
    lz4Block(data, out);
    return Uint8Array.from(out);
  }
  const flags = data[4] as number;
  let at = 6 + (flags & 8 ? 8 : 0) + (flags & 1 ? 4 : 0) + 1;
  const blockChecksum = (flags & 16) !== 0;
  const out: number[] = [];
  while (at + 4 <= data.length) {
    const size = view.getUint32(at, true);
    at += 4;
    if (size === 0) break;
    const length = size & 0x7fffffff;
    const block = data.slice(at, at + length);
    at += length + (blockChecksum ? 4 : 0);
    if (size & 0x80000000) out.push(...block);
    else lz4Block(block, out);
  }
  return Uint8Array.from(out);
}

function lz4CompressBlock(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  const table = new Map<number, number>();
  let anchor = 0;
  let at = 0;
  const limit = src.length - 12;
  const writeLength = (n: number) => {
    let rest = n;
    while (rest >= 255) {
      out.push(255);
      rest -= 255;
    }
    out.push(rest);
  };
  while (at < limit) {
    const key = ((src[at] as number) | ((src[at + 1] as number) << 8) | ((src[at + 2] as number) << 16) | ((src[at + 3] as number) << 24)) >>> 0;
    const candidate = table.get(key);
    table.set(key, at);
    if (candidate === undefined || at - candidate > 65535) {
      at++;
      continue;
    }
    let length = 4;
    while (at + length < src.length - 5 && src[candidate + length] === src[at + length]) length++;
    const literals = at - anchor;
    out.push((Math.min(literals, 15) << 4) | Math.min(length - 4, 15));
    if (literals >= 15) writeLength(literals - 15);
    for (let i = anchor; i < at; i++) out.push(src[i] as number);
    const offset = at - candidate;
    out.push(offset & 255, offset >> 8);
    if (length - 4 >= 15) writeLength(length - 4 - 15);
    at += length;
    anchor = at;
  }
  const literals = src.length - anchor;
  out.push(Math.min(literals, 15) << 4);
  if (literals >= 15) writeLength(literals - 15);
  for (let i = anchor; i < src.length; i++) out.push(src[i] as number);
  return Uint8Array.from(out);
}

async function lz4Compress(data: Uint8Array): Promise<Uint8Array> {
  const descriptor = Uint8Array.of(0x60, 0x70);
  const hc = ((await xxh32(descriptor)) >>> 8) & 255;
  const out: number[] = [0x04, 0x22, 0x4d, 0x18, ...descriptor, hc];
  const BLOCK = 4 * 1024 * 1024;
  for (let at = 0; at < data.length; at += BLOCK) {
    const raw = data.slice(at, at + BLOCK);
    const packed = lz4CompressBlock(raw);
    const store = packed.length >= raw.length;
    const body = store ? raw : packed;
    const size = (body.length | (store ? 0x80000000 : 0)) >>> 0;
    out.push(size & 255, (size >>> 8) & 255, (size >>> 16) & 255, size >>> 24, ...body);
  }
  out.push(0, 0, 0, 0);
  return Uint8Array.from(out);
}

/* --------------------------------------------------------------- LZNT1 -- */

function lznt1(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let at = 0;
  while (at + 2 <= data.length) {
    const header = (data[at] as number) | ((data[at + 1] as number) << 8);
    at += 2;
    if (header === 0) break;
    const size = (header & 0xfff) + 1;
    const chunk = data.slice(at, at + size);
    at += size;
    if (!(header & 0x8000)) {
      out.push(...chunk);
      continue;
    }
    const start = out.length;
    let i = 0;
    while (i < chunk.length) {
      const flags = chunk[i++] as number;
      for (let bit = 0; bit < 8 && i < chunk.length; bit++) {
        if (!(flags & (1 << bit))) {
          out.push(chunk[i++] as number);
          continue;
        }
        const token = (chunk[i] as number) | ((chunk[i + 1] as number) << 8);
        i += 2;
        let lengthBits = 12;
        for (let d = out.length - start - 1; d >= 0x10; d >>= 1) lengthBits--;
        const length = (token & ((1 << lengthBits) - 1)) + 3;
        const offset = (token >> lengthBits) + 1;
        const from = out.length - offset;
        if (from < start) throw new OpError('The LZNT1 data refers outside its chunk.');
        for (let k = 0; k < length; k++) out.push(out[from + k] as number);
      }
    }
  }
  return Uint8Array.from(out);
}

/* --------------------------------------------------------------- operations -- */

export const compressionOps: Operation[] = [
  defineOp({
    name: 'Raw Deflate',
    category: C,
    description: 'Compresses with raw Deflate (no header).',
    input: 'bytes',
    output: 'bytes',
    args: [sel('type', 'Compression type', LEVELS)],
    run: async (input, a) => (await import('fflate')).deflateSync(input, { level: level(sArg(a, 'type')) }),
  }),
  defineOp({
    name: 'Raw Inflate',
    category: C,
    description: 'Decompresses raw Deflate data.',
    input: 'bytes',
    output: 'bytes',
    args: [num0('start', 'Start index')],
    run: async (input, a) => (await import('fflate')).inflateSync(input.slice(nArg(a, 'start'))),
  }),
  defineOp({
    name: 'Zlib Deflate',
    category: C,
    description: 'Compresses with zlib (Deflate with a 2-byte header and Adler-32 checksum).',
    input: 'bytes',
    output: 'bytes',
    args: [sel('type', 'Compression type', LEVELS)],
    run: async (input, a) => (await import('fflate')).zlibSync(input, { level: level(sArg(a, 'type')) }),
  }),
  defineOp({
    name: 'Zlib Inflate',
    category: C,
    description: 'Decompresses zlib data.',
    input: 'bytes',
    output: 'bytes',
    args: [num0('start', 'Start index')],
    // biome-ignore lint/suspicious/noControlCharactersInRegex: file signatures are binary
    magic: [{ pattern: /^\x78(\x01|\x9c|\xda|\x5e)/ }],
    run: async (input, a) => (await import('fflate')).unzlibSync(input.slice(nArg(a, 'start'))),
  }),
  defineOp({
    name: 'Gzip',
    category: C,
    description: 'Compresses with gzip.',
    input: 'bytes',
    output: 'bytes',
    args: [sel('type', 'Compression type', LEVELS), str('filename', 'Filename (optional)', ''), str('comment', 'Comment (optional)', '')],
    run: async (input, a) => (await import('fflate')).gzipSync(input, { level: level(sArg(a, 'type')), filename: sArg(a, 'filename') || undefined, mtime: Date.now() }),
  }),
  defineOp({
    name: 'Gunzip',
    category: C,
    description: 'Decompresses gzip data.',
    input: 'bytes',
    output: 'bytes',
    // biome-ignore lint/suspicious/noControlCharactersInRegex: file signatures are binary
    magic: [{ pattern: /^\x1f\x8b\x08/ }],
    run: async (input) => (await import('fflate')).gunzipSync(input),
  }),
  defineOp({
    name: 'Zip',
    category: C,
    description: 'Packs the data into a ZIP archive as a single file.',
    input: 'bytes',
    output: 'bytes',
    args: [str('filename', 'Filename', 'file.txt'), str('comment', 'Comment', ''), sel('method', 'Compression method', ['Deflate', 'None (Store)']), sel('type', 'Compression type', LEVELS)],
    run: async (input, a) => {
      const { zipSync } = await import('fflate');
      return zipSync({ [sArg(a, 'filename') || 'file.txt']: [input, { level: sArg(a, 'method') === 'Deflate' ? level(sArg(a, 'type')) : 0 }] }, { comment: sArg(a, 'comment') || undefined } as never);
    },
  }),
  defineOp({
    name: 'Unzip',
    category: C,
    description: 'Lists and extracts the files in a ZIP archive, including traditional ZipCrypto archives with a password.',
    input: 'bytes',
    output: 'text',
    args: [str('password', 'Password', '')],
    // biome-ignore lint/suspicious/noControlCharactersInRegex: file signatures are binary
    magic: [{ pattern: /^\x50\x4b(?:\x03|\x05|\x07)(?:\x04|\x06|\x08)/ }],
    run: async (input, a) => filesResult(await unzip(input, sArg(a, 'password'))),
  }),
  defineOp({
    name: 'Bzip2 Decompress',
    category: C,
    description: 'Decompresses bzip2 data.',
    input: 'bytes',
    output: 'bytes',
    magic: [{ pattern: /^BZh[1-9]1AY&SY/ }],
    run: (input) => bunzip2(input),
  }),
  defineOp({
    name: 'Tar',
    category: C,
    description: 'Packs the data into a tar archive as a single file.',
    input: 'bytes',
    output: 'bytes',
    args: [str('filename', 'Filename', 'file.txt')],
    run: (input, a) => tar(sArg(a, 'filename') || 'file.txt', input),
  }),
  defineOp({
    name: 'Untar',
    category: C,
    description: 'Lists and extracts the files in a tar archive.',
    input: 'bytes',
    output: 'text',
    magic: [{ pattern: /^.{257}ustar/s }],
    run: (input) => filesResult(untar(input)),
  }),
  defineOp({
    name: 'LZString Compress',
    category: C,
    description: 'Compresses text with lz-string.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Compression Format', ['default', 'UTF16', 'Base64'])],
    run: async (input, a) => {
      const lz = cjs(await import('lz-string'));
      const format = sArg(a, 'format');
      return format === 'UTF16' ? lz.compressToUTF16(input) : format === 'Base64' ? lz.compressToBase64(input) : lz.compress(input);
    },
  }),
  defineOp({
    name: 'LZString Decompress',
    category: C,
    description: 'Decompresses lz-string data.',
    input: 'text',
    output: 'text',
    args: [sel('format', 'Compression Format', ['default', 'UTF16', 'Base64'])],
    run: async (input, a) => {
      const lz = cjs(await import('lz-string'));
      const format = sArg(a, 'format');
      const out = format === 'UTF16' ? lz.decompressFromUTF16(input) : format === 'Base64' ? lz.decompressFromBase64(input) : lz.decompress(input);
      if (out === null) throw new OpError('This is not valid lz-string data in the chosen format.');
      return out;
    },
  }),
  defineOp({
    name: 'LZ4 Compress',
    category: C,
    description: 'Compresses with LZ4 (frame format).',
    input: 'bytes',
    output: 'bytes',
    run: (input) => lz4Compress(input),
  }),
  defineOp({
    name: 'LZ4 Decompress',
    category: C,
    description: 'Decompresses LZ4 frames or raw blocks.',
    input: 'bytes',
    output: 'bytes',
    // biome-ignore lint/suspicious/noControlCharactersInRegex: file signatures are binary
    magic: [{ pattern: /^\x04\x22\x4d\x18/ }],
    run: (input) => lz4Decompress(input),
  }),
  defineOp({
    name: 'LZNT1 Decompress',
    category: C,
    description: 'Decompresses LZNT1, the compression used by NTFS and some Windows malware.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => lznt1(input),
  }),
];

function num0(key: string, label: string) {
  return { key, label, type: 'number' as const, default: 0, min: 0 };
}

export { bArg, bool, untar, unzip };
