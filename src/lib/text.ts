/** Small text helpers shared by several tools. */

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

let segmenter: Intl.Segmenter | null | undefined;

/** Splits text into user-perceived characters so emoji and combining marks stay intact. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  if (segmenter === null) return Array.from(text);
  const out: string[] = [];
  for (const part of segmenter.segment(text)) out.push(part.segment);
  return out;
}

/** Splits an identifier or phrase into lower-level words: "fooBar_baz-qux" -> foo, Bar, baz, qux. */
export function splitWords(text: string): string[] {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function capitalize(word: string): string {
  return word === '' ? word : word[0]?.toUpperCase() + word.slice(1).toLowerCase();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

/** Deterministic PRNG (mulberry32) for reproducible "random" artwork from a seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexDump(bytes: Uint8Array, limit = 4096): string {
  const lines: string[] = [];
  const end = Math.min(bytes.length, limit);
  for (let offset = 0; offset < end; offset += 16) {
    const slice = bytes.subarray(offset, Math.min(end, offset + 16));
    let hex = '';
    let ascii = '';
    for (let i = 0; i < 16; i++) {
      if (i < slice.length) {
        const byte = slice[i] as number;
        hex += `${byte.toString(16).padStart(2, '0')} `;
        ascii += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
      } else {
        hex += '   ';
      }
      if (i === 7) hex += ' ';
    }
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`);
  }
  if (bytes.length > end) lines.push(`... ${bytes.length - end} more bytes`);
  return lines.join('\n');
}

/** Guesses a file type from its first bytes. */
export function sniffType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const starts = (signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (starts([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(4, 4) === 'ftyp' && /avif|avis/.test(ascii(8, 4))) return { mime: 'image/avif', ext: 'avif' };
  if (starts([0x42, 0x4d])) return { mime: 'image/bmp', ext: 'bmp' };
  if (starts([0x00, 0x00, 0x01, 0x00])) return { mime: 'image/x-icon', ext: 'ico' };
  if (ascii(0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (starts([0x50, 0x4b, 0x03, 0x04])) return { mime: 'application/zip', ext: 'zip' };
  if (starts([0x1f, 0x8b])) return { mime: 'application/gzip', ext: 'gz' };
  if (starts([0x00, 0x61, 0x73, 0x6d])) return { mime: 'application/wasm', ext: 'wasm' };
  if (ascii(0, 4) === 'wOFF') return { mime: 'font/woff', ext: 'woff' };
  if (ascii(0, 4) === 'wOF2') return { mime: 'font/woff2', ext: 'woff2' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(0, 3) === 'ID3') return { mime: 'audio/mpeg', ext: 'mp3' };
  const head = ascii(0, Math.min(bytes.length, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return { mime: 'image/svg+xml', ext: 'svg' };
  }
  return null;
}
