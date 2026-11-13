/**
 * Lazy loaders for every text tool.
 *
 * This map is imported by the main thread (to render a tool's options) and by
 * the web worker (to run it off the UI thread), so it must stay free of any
 * UI code.  Each tool lives in its own chunk and is read from disk on demand.
 */
import type { TextToolSpec } from '../types';

// biome-ignore lint/suspicious/noExplicitAny: specs have differing option tuples
type Loader = () => Promise<{ default: TextToolSpec<any> }>;

export const textToolLoaders = {
  'json-formatter': () => import('./json-formatter'),
  'html-formatter': () => import('./html-formatter'),
  'css-formatter': () => import('./css-formatter'),
  'js-formatter': () => import('./js-formatter'),
  'js-minifier': () => import('./js-minifier'),
  'xml-formatter': () => import('./xml-formatter'),
  'svg-minifier': () => import('./svg-minifier'),
  'csv-to-json': () => import('./csv-to-json'),
  'json-to-csv': () => import('./json-to-csv'),
  'json-to-typescript': () => import('./json-to-typescript'),
  'yaml-json': () => import('./yaml-json'),
  'markdown-to-html': () => import('./markdown-to-html'),
  'html-to-markdown': () => import('./html-to-markdown'),
  'curl-to-fetch': () => import('./curl-to-fetch'),
  'svg-to-react': () => import('./svg-to-react'),
  'css-to-tailwind': () => import('./css-to-tailwind'),
  'number-to-words': () => import('./number-to-words'),
  'unix-timestamp': () => import('./unix-timestamp'),
  'base-converter': () => import('./base-converter'),
  'binary-calculator': () => import('./binary-calculator'),
  'px-rem': () => import('./px-rem'),
  'android-pixel-calculator': () => import('./android-pixel-calculator'),
  base64: () => import('./base64'),
  base32: () => import('./base32'),
  base58: () => import('./base58'),
  base62: () => import('./base62'),
  'hex-text': () => import('./hex-text'),
  'url-encode': () => import('./url-encode'),
  'html-entities': () => import('./html-entities'),
  'ascii-text': () => import('./ascii-text'),
  'binary-text': () => import('./binary-text'),
  'utf8-bytes': () => import('./utf8-bytes'),
  'morse-code': () => import('./morse-code'),
  rot13: () => import('./rot13'),
  'jwt-decoder': () => import('./jwt-decoder'),
  'jwt-encoder': () => import('./jwt-encoder'),
  'image-to-base64': () => import('./image-to-base64'),
  hash: () => import('./hash'),
  aes: () => import('./aes'),
  htpasswd: () => import('./htpasswd'),
  uuid: () => import('./uuid'),
  'random-words': () => import('./random-words'),
  barcode: () => import('./barcode'),
  cron: () => import('./cron'),
  'robots-txt': () => import('./robots-txt'),
  'llms-txt': () => import('./llms-txt'),
  'email-link': () => import('./email-link'),
  'case-converter': () => import('./case-converter'),
  diff: () => import('./diff'),
  'dedupe-lines': () => import('./dedupe-lines'),
  'remove-line-breaks': () => import('./remove-line-breaks'),
  'text-reverser': () => import('./text-reverser'),
  'color-converter': () => import('./color-converter'),
  'color-shades': () => import('./color-shades'),
  'contrast-checker': () => import('./contrast-checker'),
  'shadcn-theme': () => import('./shadcn-theme'),
  'svg-viewer': () => import('./svg-viewer'),
  'svg-background-remover': () => import('./svg-background-remover'),
  'payment-fee': () => import('./payment-fee'),
  'cac-calculator': () => import('./cac-calculator'),
} satisfies Record<string, Loader>;

export type TextToolId = keyof typeof textToolLoaders;

export const isTextToolId = (id: string): id is TextToolId => Object.hasOwn(textToolLoaders, id);
