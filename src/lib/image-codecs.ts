/**
 * WebP and AVIF encoders (the Squoosh codecs, compiled to WebAssembly).
 *
 * Browsers disagree about which formats a canvas can export - WebKit cannot
 * write WebP, and nothing writes AVIF - so these formats are always encoded
 * here, giving identical results on every platform.
 */
import type { ImageFormat } from '../tools/types';

export interface EncodeRequest {
  readonly format: Extract<ImageFormat, 'webp' | 'avif'>;
  readonly width: number;
  readonly height: number;
  /** RGBA pixels, 4 bytes per pixel. */
  readonly rgba: ArrayBuffer;
  /** 1-100. */
  readonly quality: number;
  readonly lossless: boolean;
}

interface AvifModule {
  encode(data: Uint8Array, width: number, height: number, options: Record<string, unknown>): { buffer: ArrayBuffer } | Uint8Array | null;
}

let avif: Promise<AvifModule> | undefined;

async function loadAvif(): Promise<AvifModule> {
  // The single-threaded build is used deliberately: the threaded one needs cross-origin isolation.
  const [{ default: factory }, { initEmscriptenModule }] = await Promise.all([import('@jsquash/avif/codec/enc/avif_enc.js'), import('@jsquash/avif/utils.js')]);
  return initEmscriptenModule(factory as never) as Promise<AvifModule>;
}

export async function encodeRgba(request: EncodeRequest): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(request.rgba);
  if (data.length !== request.width * request.height * 4) throw new Error('Pixel buffer does not match the image size.');
  const quality = Math.min(100, Math.max(1, Math.round(request.quality)));

  if (request.format === 'webp') {
    const { default: encode } = await import('@jsquash/webp/encode.js');
    const image = { data, width: request.width, height: request.height, colorSpace: 'srgb' } as unknown as ImageData;
    return new Uint8Array(await encode(image, request.lossless ? { lossless: 1, quality: 100, exact: 1 } : { quality }));
  }

  avif ??= loadAvif();
  const module = await avif;
  const options = {
    quality: request.lossless ? 100 : quality,
    qualityAlpha: -1,
    denoiseLevel: 0,
    tileColsLog2: 0,
    tileRowsLog2: 0,
    speed: 6,
    subsample: request.lossless ? 3 : 1,
    chromaDeltaQ: false,
    sharpness: 0,
    tune: 0,
    enableSharpYUV: false,
    bitDepth: 8,
    lossless: request.lossless,
  };
  const output = module.encode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), request.width, request.height, options);
  if (!output) throw new Error('The AVIF encoder could not encode this image.');
  // Copy out of the WebAssembly heap before it is reused.
  return output instanceof Uint8Array ? output.slice() : new Uint8Array(output.buffer).slice();
}
