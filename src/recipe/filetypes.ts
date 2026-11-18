/** File signatures ("magic bytes") for Detect File Type, Scan for Embedded Files and Magic. */

export interface FileType {
  readonly name: string;
  readonly ext: string;
  readonly mime: string;
  /** Bytes to match; null matches any byte. */
  readonly sig: readonly (number | null)[];
  /** Where the signature starts. */
  readonly offset?: number;
  /** Finds where a file that starts here ends (for carving), returning the length or null. */
  readonly length?: (bytes: Uint8Array, start: number) => number | null;
}

const s = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0));

function findBytes(bytes: Uint8Array, needle: readonly number[], from: number): number {
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const until =
  (trailer: readonly number[], extra = 0) =>
  (bytes: Uint8Array, start: number): number | null => {
    const at = findBytes(bytes, trailer, start + 2);
    return at === -1 ? null : at + trailer.length + extra - start;
  };

function pngLength(bytes: Uint8Array, start: number): number | null {
  let at = start + 8;
  while (at + 12 <= bytes.length) {
    const size = ((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const type = String.fromCharCode(bytes[at + 4] ?? 0, bytes[at + 5] ?? 0, bytes[at + 6] ?? 0, bytes[at + 7] ?? 0);
    at += 12 + size;
    if (type === 'IEND') return at - start;
  }
  return null;
}

function zipLength(bytes: Uint8Array, start: number): number | null {
  const at = findBytes(bytes, [0x50, 0x4b, 0x05, 0x06], start);
  if (at === -1 || at + 22 > bytes.length) return null;
  const comment = (bytes[at + 20] ?? 0) | ((bytes[at + 21] ?? 0) << 8);
  return at + 22 + comment - start;
}

const riffLength = (bytes: Uint8Array, start: number): number | null => {
  const size = (bytes[start + 4] ?? 0) | ((bytes[start + 5] ?? 0) << 8) | ((bytes[start + 6] ?? 0) << 16) | ((bytes[start + 7] ?? 0) << 24);
  return size > 0 ? size + 8 : null;
};

export const FILE_TYPES: readonly FileType[] = [
  { name: 'PNG image', ext: 'png', mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], length: pngLength },
  { name: 'JPEG image', ext: 'jpg', mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff], length: until([0xff, 0xd9]) },
  { name: 'GIF image', ext: 'gif', mime: 'image/gif', sig: s('GIF8'), length: until([0x00, 0x3b]) },
  { name: 'WebP image', ext: 'webp', mime: 'image/webp', sig: [...s('RIFF'), null, null, null, null, ...s('WEBP')], length: riffLength },
  { name: 'BMP image', ext: 'bmp', mime: 'image/bmp', sig: s('BM'), length: (b, at) => (b[at + 2] ?? 0) | ((b[at + 3] ?? 0) << 8) | ((b[at + 4] ?? 0) << 16) | ((b[at + 5] ?? 0) << 24) || null },
  { name: 'TIFF image (little-endian)', ext: 'tif', mime: 'image/tiff', sig: [0x49, 0x49, 0x2a, 0x00] },
  { name: 'TIFF image (big-endian)', ext: 'tif', mime: 'image/tiff', sig: [0x4d, 0x4d, 0x00, 0x2a] },
  { name: 'Windows icon', ext: 'ico', mime: 'image/x-icon', sig: [0x00, 0x00, 0x01, 0x00] },
  { name: 'AVIF image', ext: 'avif', mime: 'image/avif', sig: s('ftypavif'), offset: 4 },
  { name: 'HEIC image', ext: 'heic', mime: 'image/heic', sig: s('ftypheic'), offset: 4 },
  { name: 'Photoshop document', ext: 'psd', mime: 'image/vnd.adobe.photoshop', sig: s('8BPS') },
  { name: 'PDF document', ext: 'pdf', mime: 'application/pdf', sig: s('%PDF-'), length: until(s('%%EOF')) },
  { name: 'PostScript', ext: 'ps', mime: 'application/postscript', sig: s('%!PS') },
  { name: 'Rich Text Format', ext: 'rtf', mime: 'application/rtf', sig: s('{\\rtf') },
  { name: 'ZIP archive (also DOCX, XLSX, JAR, APK)', ext: 'zip', mime: 'application/zip', sig: [0x50, 0x4b, 0x03, 0x04], length: zipLength },
  { name: 'Empty ZIP archive', ext: 'zip', mime: 'application/zip', sig: [0x50, 0x4b, 0x05, 0x06] },
  { name: 'Gzip', ext: 'gz', mime: 'application/gzip', sig: [0x1f, 0x8b, 0x08] },
  { name: 'Bzip2', ext: 'bz2', mime: 'application/x-bzip2', sig: s('BZh') },
  { name: 'XZ', ext: 'xz', mime: 'application/x-xz', sig: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { name: '7-Zip archive', ext: '7z', mime: 'application/x-7z-compressed', sig: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { name: 'RAR archive', ext: 'rar', mime: 'application/vnd.rar', sig: s('Rar!\x1a\x07') },
  { name: 'Zstandard', ext: 'zst', mime: 'application/zstd', sig: [0x28, 0xb5, 0x2f, 0xfd] },
  { name: 'LZ4 frame', ext: 'lz4', mime: 'application/x-lz4', sig: [0x04, 0x22, 0x4d, 0x18] },
  { name: 'Tar archive', ext: 'tar', mime: 'application/x-tar', sig: s('ustar'), offset: 257 },
  { name: 'Zlib stream', ext: 'zlib', mime: 'application/zlib', sig: [0x78, 0x9c] },
  { name: 'Zlib stream (best compression)', ext: 'zlib', mime: 'application/zlib', sig: [0x78, 0xda] },
  { name: 'Microsoft Office (OLE2) document', ext: 'doc', mime: 'application/x-ole-storage', sig: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { name: 'Windows executable (PE)', ext: 'exe', mime: 'application/vnd.microsoft.portable-executable', sig: s('MZ') },
  { name: 'ELF executable', ext: 'elf', mime: 'application/x-executable', sig: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'Mach-O executable (64-bit)', ext: 'macho', mime: 'application/x-mach-binary', sig: [0xcf, 0xfa, 0xed, 0xfe] },
  { name: 'Java class file', ext: 'class', mime: 'application/java-vm', sig: [0xca, 0xfe, 0xba, 0xbe] },
  { name: 'WebAssembly module', ext: 'wasm', mime: 'application/wasm', sig: [0x00, 0x61, 0x73, 0x6d] },
  { name: 'SQLite database', ext: 'sqlite', mime: 'application/vnd.sqlite3', sig: s('SQLite format 3\0') },
  { name: 'MP3 audio (ID3 tag)', ext: 'mp3', mime: 'audio/mpeg', sig: s('ID3') },
  { name: 'MP3 audio', ext: 'mp3', mime: 'audio/mpeg', sig: [0xff, 0xfb] },
  { name: 'FLAC audio', ext: 'flac', mime: 'audio/flac', sig: s('fLaC') },
  { name: 'Ogg media', ext: 'ogg', mime: 'audio/ogg', sig: s('OggS') },
  { name: 'WAV audio', ext: 'wav', mime: 'audio/wav', sig: [...s('RIFF'), null, null, null, null, ...s('WAVE')], length: riffLength },
  { name: 'AVI video', ext: 'avi', mime: 'video/x-msvideo', sig: [...s('RIFF'), null, null, null, null, ...s('AVI ')], length: riffLength },
  { name: 'MIDI audio', ext: 'mid', mime: 'audio/midi', sig: s('MThd') },
  { name: 'MP4 video', ext: 'mp4', mime: 'video/mp4', sig: s('ftyp'), offset: 4 },
  { name: 'Matroska / WebM video', ext: 'mkv', mime: 'video/x-matroska', sig: [0x1a, 0x45, 0xdf, 0xa3] },
  { name: 'Flash video', ext: 'flv', mime: 'video/x-flv', sig: s('FLV\x01') },
  { name: 'WOFF font', ext: 'woff', mime: 'font/woff', sig: s('wOFF') },
  { name: 'WOFF2 font', ext: 'woff2', mime: 'font/woff2', sig: s('wOF2') },
  { name: 'TrueType font', ext: 'ttf', mime: 'font/ttf', sig: [0x00, 0x01, 0x00, 0x00, 0x00] },
  { name: 'OpenType font', ext: 'otf', mime: 'font/otf', sig: s('OTTO') },
  { name: 'PCAP capture', ext: 'pcap', mime: 'application/vnd.tcpdump.pcap', sig: [0xd4, 0xc3, 0xb2, 0xa1] },
  { name: 'PCAP-NG capture', ext: 'pcapng', mime: 'application/x-pcapng', sig: [0x0a, 0x0d, 0x0d, 0x0a] },
  { name: 'Windows shortcut', ext: 'lnk', mime: 'application/x-ms-shortcut', sig: [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00] },
  { name: 'Windows registry hive', ext: 'dat', mime: 'application/octet-stream', sig: s('regf') },
  { name: 'Debian package', ext: 'deb', mime: 'application/vnd.debian.binary-package', sig: s('!<arch>\ndebian') },
  { name: 'RPM package', ext: 'rpm', mime: 'application/x-rpm', sig: [0xed, 0xab, 0xee, 0xdb] },
  { name: 'ISO 9660 disc image', ext: 'iso', mime: 'application/x-iso9660-image', sig: s('CD001'), offset: 0x8001 },
  { name: 'Apple binary property list', ext: 'plist', mime: 'application/x-plist', sig: s('bplist0') },
  { name: 'PGP public key (armoured)', ext: 'asc', mime: 'application/pgp-keys', sig: s('-----BEGIN PGP') },
  { name: 'PEM data', ext: 'pem', mime: 'application/x-pem-file', sig: s('-----BEGIN ') },
  { name: 'OpenSSH private key', ext: 'key', mime: 'text/plain', sig: s('-----BEGIN OPENSSH PRIVATE KEY-----') },
  { name: 'XML document', ext: 'xml', mime: 'application/xml', sig: s('<?xml') },
  { name: 'SVG image', ext: 'svg', mime: 'image/svg+xml', sig: s('<svg') },
  { name: 'HTML document', ext: 'html', mime: 'text/html', sig: s('<!DOCTYPE html') },
  { name: 'Shell script', ext: 'sh', mime: 'text/x-shellscript', sig: s('#!') },
  { name: 'UTF-8 text with BOM', ext: 'txt', mime: 'text/plain', sig: [0xef, 0xbb, 0xbf] },
  { name: 'UTF-16 text (little-endian BOM)', ext: 'txt', mime: 'text/plain', sig: [0xff, 0xfe] },
  { name: 'UTF-16 text (big-endian BOM)', ext: 'txt', mime: 'text/plain', sig: [0xfe, 0xff] },
];

function matchesAt(bytes: Uint8Array, type: FileType, at: number): boolean {
  const start = at + (type.offset ?? 0);
  if (start + type.sig.length > bytes.length) return false;
  for (let i = 0; i < type.sig.length; i++) {
    const want = type.sig[i];
    if (want !== null && bytes[start + i] !== want) return false;
  }
  return true;
}

/** The most specific type whose signature matches at the start, or null. */
export function detectFileType(bytes: Uint8Array): FileType | null {
  let best: FileType | null = null;
  for (const type of FILE_TYPES) {
    if (matchesAt(bytes, type, 0) && (best === null || type.sig.filter((b) => b !== null).length > best.sig.filter((b) => b !== null).length)) best = type;
  }
  return best;
}

export interface Embedded {
  readonly offset: number;
  readonly type: FileType;
  readonly length: number | null;
}

/** Signatures found anywhere in the data (two-byte signatures are skipped as too noisy unless at the start). */
export function scanEmbedded(bytes: Uint8Array, limit = 500): Embedded[] {
  const found: Embedded[] = [];
  for (let at = 0; at < bytes.length && found.length < limit; at++) {
    for (const type of FILE_TYPES) {
      if (type.offset) continue;
      if (type.sig.length < 3 && at !== 0) continue;
      if (type.sig[0] !== bytes[at]) continue;
      if (matchesAt(bytes, type, at)) {
        found.push({ offset: at, type, length: type.length ? type.length(bytes, at) : null });
        break;
      }
    }
  }
  return found;
}
