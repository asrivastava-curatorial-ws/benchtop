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
