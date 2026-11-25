/** The parts of lcms-wasm (Little CMS built to WebAssembly) that Benchtop uses. */
declare module 'lcms-wasm' {
  /** A handle the library gives out for a profile or a transform: 0 when it could not make one. */
  type Handle = number;

  export interface Lcms {
    cmsOpenProfileFromMem(bytes: Uint8Array, size: number): Handle;
    cmsCloseProfile(profile: Handle): void;
    cmsCreate_sRGBProfile(): Handle;
    cmsCreateLab4Profile(whitePoint: number[] | null): Handle;
    cmsGetProfileInfoASCII(profile: Handle, info: number, language: string, country: string): string;
    cmsGetColorSpaceASCII(profile: Handle): string | null;
    cmsGetHeaderRenderingIntent(profile: Handle): number;
    cmsCreateTransform(input: Handle, inputFormat: number, output: Handle, outputFormat: number, intent: number, flags: number): Handle;
    cmsCreateProofingTransform(input: Handle, inputFormat: number, output: Handle, outputFormat: number, proofing: Handle, intent: number, proofingIntent: number, flags: number): Handle;
    cmsDeleteTransform(transform: Handle): void;
    cmsDoTransform(transform: Handle, input: Uint8Array | Uint16Array | Float32Array, pixels: number): Uint8Array | Uint16Array | Float32Array;
  }

  export function instantiate(options?: { locateFile?: (name: string) => string; wasmBinary?: ArrayBuffer | Uint8Array }): Promise<Lcms>;

  export const TYPE_RGB_8: number;
  export const TYPE_RGBA_8: number;
  export const TYPE_CMYK_8: number;
  export const TYPE_CMYK_16: number;
  export const TYPE_GRAY_8: number;
  export const PT_Lab: number;
  export const FLOAT_SH: (value: number) => number;
  export const COLORSPACE_SH: (value: number) => number;
  export const CHANNELS_SH: (value: number) => number;
  export const BYTES_SH: (value: number) => number;
  export const INTENT_PERCEPTUAL: number;
  export const INTENT_RELATIVE_COLORIMETRIC: number;
  export const INTENT_SATURATION: number;
  export const INTENT_ABSOLUTE_COLORIMETRIC: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export const cmsFLAGS_NOOPTIMIZE: number;
  export const cmsFLAGS_HIGHRESPRECALC: number;
  export const cmsInfoDescription: number;
  export const cmsInfoManufacturer: number;
  export const cmsInfoModel: number;
  export const cmsInfoCopyright: number;
}

declare module 'lcms-wasm/dist/lcms.wasm?url' {
  const url: string;
  export default url;
}
