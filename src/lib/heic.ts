/**
 * HEIC and HEIF pictures (iPhone photos), decoded here with libheif
 * (WebAssembly, LGPL-3.0) when the web view cannot show them itself.
 */

/** Brands of HEIF files whose pictures are HEVC (and the general HEIF ones). */
const BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2']);

/** Whether the bytes are an HEIF file (an ISO media "ftyp" box naming a HEIF brand). */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') return false;
  const size = ((bytes[0] ?? 0) * 2 ** 24 + ((bytes[1] ?? 0) << 16) + ((bytes[2] ?? 0) << 8) + (bytes[3] ?? 0)) >>> 0;
  const end = Math.min(bytes.length, Math.max(16, size), 256);
  for (let at = 8; at + 4 <= end; at += 4) {
    // The four bytes after the major brand are its version, not a brand.
    if (at === 12) continue;
    if (BRANDS.has(String.fromCharCode(...bytes.subarray(at, at + 4)))) return true;
  }
  return false;
}

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA */
  readonly data: Uint8ClampedArray;
}

type Decoder = Awaited<ReturnType<typeof import('libheif-js/libheif-wasm/libheif-bundle.mjs').default>>;
let library: Promise<Decoder> | null = null;

/** The main picture of an HEIC or HEIF file, as RGBA pixels. */
export async function decodeHeif(bytes: Uint8Array): Promise<Pixels> {
  library ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default());
  const lib = await library;
  const images = new lib.HeifDecoder().decode(bytes);
  try {
    const image = images.find((i) => i.is_primary()) ?? images[0];
    if (!image) throw new Error('No picture was found in this HEIC file.');
    const width = image.get_width();
    const height = image.get_height();
    if (!width || !height || width * height > 200e6) throw new Error('This HEIC picture is too large to open here.');
    return await new Promise<Pixels>((resolve, reject) =>
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (shown) => {
        if (shown) resolve({ width, height, data: shown.data });
        else reject(new Error('This HEIC picture could not be decoded.'));
      }),
    );
  } finally {
    for (const image of images) image.free();
  }
}
