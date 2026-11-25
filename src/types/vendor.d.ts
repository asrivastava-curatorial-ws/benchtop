/** Minimal typings for dependencies that ship without TypeScript declarations. */

declare module 'he' {
  export interface EncodeOptions {
    useNamedReferences?: boolean;
    decimal?: boolean;
    encodeEverything?: boolean;
    strict?: boolean;
    allowUnsafeSymbols?: boolean;
  }
  export interface DecodeOptions {
    isAttributeValue?: boolean;
    strict?: boolean;
  }
  export function encode(text: string, options?: EncodeOptions): string;
  export function decode(html: string, options?: DecodeOptions): string;
  // biome-ignore lint/suspicious/noShadowRestrictedNames: these are the library's export names
  export function escape(text: string): string;
  // biome-ignore lint/suspicious/noShadowRestrictedNames: these are the library's export names
  export function unescape(html: string, options?: DecodeOptions): string;
}

declare module 'js-beautify' {
  export interface BeautifyOptions {
    indent_size?: number;
    indent_char?: string;
    indent_with_tabs?: boolean;
    end_with_newline?: boolean;
    preserve_newlines?: boolean;
    max_preserve_newlines?: number;
    wrap_line_length?: number;
    indent_inner_html?: boolean;
    wrap_attributes?: 'auto' | 'force' | 'force-aligned' | 'force-expand-multiline' | 'preserve';
    unformatted?: string[];
    content_unformatted?: string[];
    extra_liners?: string[];
    indent_scripts?: 'keep' | 'separate' | 'normal';
    brace_style?: string;
  }
  export function html(source: string, options?: BeautifyOptions): string;
  export function css(source: string, options?: BeautifyOptions): string;
  export function js(source: string, options?: BeautifyOptions): string;
  const beautify: { html: typeof html; css: typeof css; js: typeof js };
  export default beautify;
}

declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}

declare module 'tailwindcss/colors' {
  type Scale = Record<string, string>;
  const colors: Record<string, string | Scale>;
  export default colors;
}

declare module '*.css?raw' {
  const content: string;
  export default content;
}

declare module '*.scss?raw' {
  const source: string;
  export default source;
}

// The minified legacy build has the same API as the typed entry point.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist/legacy/build/pdf.mjs';
}

declare module 'gifenc' {
  export type Palette = number[][];
  export interface GifEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }
  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}

declare module 'imagetracerjs' {
  interface TracerOptions {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    rightangleenhance?: boolean;
    colorsampling?: number;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    layering?: number;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    blurradius?: number;
    blurdelta?: number;
    pal?: { r: number; g: number; b: number; a: number }[];
  }
  const tracer: {
    imagedataToSVG(imageData: ImageData | { width: number; height: number; data: Uint8ClampedArray }, options?: TracerOptions): string;
  };
  export default tracer;
}

declare module 'regenerator-runtime/runtime';

declare module 'xkcd-colors' {
  export const colors: readonly { readonly name: string; readonly clean_name: string; readonly hex: string; readonly rgb: readonly number[] }[];
  export function get_color(name: string, format?: 'hex' | 'rgb' | 'rgbf'): string | number[];
}

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void): void;
    free(): void;
  }
  interface LibHeif {
    HeifDecoder: new () => { decode(data: Uint8Array | ArrayBuffer): HeifImage[] };
  }
  const factory: (options?: Record<string, unknown>) => LibHeif | Promise<LibHeif>;
  export default factory;
}

declare module 'page-flip/dist/js/page-flip.module.js' {
  /** StPageFlip's book (only what Benchtop uses). */
  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(items: HTMLElement[]): void;
    on(event: string, handler: (event: { data: unknown }) => void): void;
    flipNext(): void;
    flipPrev(): void;
    flip(page: number): void;
    turnToPage(page: number): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getOrientation(): string;
    update(): void;
    destroy(): void;
  }
}
