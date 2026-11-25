/** ZIP, TAR, GZip and bzip2 archives read in the page, and their files put into a new ZIP. */
import { gunzipSync, zipSync } from 'fflate';
import { bunzip2, untar, unzip } from '../recipe/ops/compression';

export interface ArchiveEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const isTar = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar';

/** The files in a ZIP (also with a ZipCrypto password), TAR, .tar.gz, .tar.bz2, or a single .gz or .bz2. */
export async function openArchive(name: string, bytes: Uint8Array, password: string): Promise<ArchiveEntry[]> {
  const lower = name.toLowerCase();
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return unzip(bytes, password);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const inner = gunzipSync(bytes);
    // A .tar.gz has the "ustar" magic at offset 257 once unpacked.
    if (/\.(tgz|tar\.gz)$/.test(lower) || isTar(inner)) return untar(inner);
    return [{ name: name.replace(/\.gz$/i, '') || 'file', bytes: inner }];
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68) {
    const inner = bunzip2(bytes);
    if (/\.(tbz2?|tar\.bz2)$/.test(lower) || isTar(inner)) return untar(inner);
    return [{ name: name.replace(/\.bz2$/i, '') || 'file', bytes: inner }];
  }
  if (isTar(bytes) || lower.endsWith('.tar')) return untar(bytes);
  throw new Error('This is not a ZIP, TAR, GZip or bzip2 file.');
}

/** A name safe inside a ZIP: forward slashes, no leading slash or drive, no "..". */
export function safeEntryName(name: string): string {
  const parts = name
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/') || 'file';
}

/** The files of a TAR (or .tar.gz, .tar.bz2, ZIP) in a new ZIP. */
export async function archiveToZip(name: string, bytes: Uint8Array, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Promise<Uint8Array> {
  const entries = await openArchive(name, bytes, '');
  if (!entries.length) throw new Error('This archive has no files in it.');
  const files: Record<string, [Uint8Array, { level: typeof level }]> = {};
  for (const entry of entries) {
    let key = safeEntryName(entry.name);
    // Two files of the same name: the later ones are numbered.
    for (let n = 2; key in files; n++) key = safeEntryName(entry.name).replace(/(\.[^./]*)?$/, (ext) => ` (${n})${ext}`);
    files[key] = [entry.bytes, { level }];
  }
  return zipSync(files);
}
