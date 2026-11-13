/**
 * The tool catalogue: everything the sidebar, search and home screen show.
 *
 * Adding a tool means adding one module and one entry here.  `covers` lists
 * the web tools an entry replaces and feeds the generated docs/TOOLS.md.
 */
import { type TextToolId, textToolLoaders } from './text';
import type { AnyToolSpec, CategoryId, ToolEntry } from './types';

export interface Category {
  readonly id: CategoryId;
  readonly name: string;
  readonly blurb: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'format', name: 'Format and minify', blurb: 'Tidy up or shrink code and markup' },
  { id: 'convert', name: 'Convert', blurb: 'Turn one format into another' },
  { id: 'encode', name: 'Encode and decode', blurb: 'Base64, hex, entities, tokens' },
  { id: 'crypto', name: 'Hash and encrypt', blurb: 'Checksums, HMAC, AES, password files' },
  { id: 'generate', name: 'Generate', blurb: 'IDs, barcodes, schedules, config files' },
  { id: 'text', name: 'Text', blurb: 'Compare, clean and reshape plain text' },
  { id: 'css', name: 'CSS generators', blurb: 'Build styles visually and copy the code' },
  { id: 'color', name: 'Colour', blurb: 'Convert, scale and check colours' },
  { id: 'image', name: 'Images and SVG', blurb: 'Convert, edit and inspect pictures' },
  { id: 'misc', name: 'Reference and extras', blurb: 'Playground, calculators, cheat sheets' },
];

type Loader = () => Promise<{ default: AnyToolSpec }>;

interface Draft {
  id: string;
  name: string;
  description: string;
  keywords?: string[];
  covers?: string[];
}

const text = (category: CategoryId, draft: Draft & { id: TextToolId }): ToolEntry => ({
  ...draft,
  category,
  kind: 'text',
  load: textToolLoaders[draft.id] as Loader,
});

const other = (category: CategoryId, kind: ToolEntry['kind'], load: Loader, draft: Draft): ToolEntry => ({ ...draft, category, kind, load });

export const TOOLS: readonly ToolEntry[] = [
  /* ------------------------------------------------------ format -- */
  text('format', {
    id: 'json-formatter',
    name: 'JSON Formatter',
    description: 'Pretty-print, minify, sort and validate JSON without losing number precision.',
    keywords: ['beautify', 'lint', 'validate', 'pretty'],
    covers: ['JSON Formatter'],
  }),
  text('format', {
    id: 'html-formatter',
    name: 'HTML Formatter',
    description: 'Indent HTML or minify it while leaving scripts, styles and <pre> intact.',
    keywords: ['beautify', 'minify', 'markup'],
    covers: ['HTML Formatter'],
  }),
  text('format', {
    id: 'css-formatter',
    name: 'CSS Formatter',
    description: 'Format CSS, SCSS and Less, or minify CSS.',
    keywords: ['beautify', 'minify', 'scss', 'less', 'stylesheet'],
    covers: ['CSS Beautifier', 'CSS minify and beautify'],
  }),
  text('format', {
    id: 'js-formatter',
    name: 'JavaScript Formatter',
    description: 'Format JavaScript, JSX and TypeScript with Prettier.',
    keywords: ['beautify', 'typescript', 'jsx', 'tsx', 'prettier'],
    covers: ['JavaScript Formatter'],
  }),
  text('format', {
    id: 'js-minifier',
    name: 'JavaScript Minifier',
    description: 'Shrink JavaScript with Terser and compare sizes.',
    keywords: ['minify', 'uglify', 'terser', 'compress'],
    covers: ['Minify JS', 'JavaScript encode and decode'],
  }),
  text('format', {
    id: 'xml-formatter',
    name: 'XML Formatter',
    description: 'Format, minify and check XML, keeping comments and CDATA.',
    keywords: ['beautify', 'validate', 'well-formed'],
    covers: ['XML Formatter'],
  }),
  text('format', { id: 'svg-minifier', name: 'SVG Minifier', description: 'Optimise SVG files with SVGO.', keywords: ['optimize', 'svgo', 'compress'], covers: ['SVG Minifier'] }),

  /* ----------------------------------------------------- convert -- */
  text('convert', {
    id: 'csv-to-json',
    name: 'CSV to JSON',
    description: 'Turn CSV or TSV into JSON, handling quotes and multi-line cells.',
    keywords: ['tsv', 'spreadsheet', 'table'],
    covers: ['CSV to JSON Converter'],
  }),
  text('convert', { id: 'json-to-csv', name: 'JSON to CSV', description: 'Flatten JSON into a CSV table.', keywords: ['spreadsheet', 'excel', 'table', 'export'], covers: ['JSON to CSV Converter'] }),
  text('convert', {
    id: 'json-to-typescript',
    name: 'JSON to TypeScript',
    description: 'Infer TypeScript interfaces from a JSON sample.',
    keywords: ['types', 'interface', 'schema'],
    covers: ['JSON to TypeScript Converter'],
  }),
  text('convert', { id: 'yaml-json', name: 'YAML ↔ JSON', description: 'Convert YAML to JSON and JSON to YAML.', keywords: ['yml', 'config'], covers: ['YAML to JSON Converter'] }),
  text('convert', {
    id: 'markdown-to-html',
    name: 'Markdown to HTML',
    description: 'Render Markdown to HTML with a live preview.',
    keywords: ['md', 'gfm', 'preview'],
    covers: ['Markdown to HTML Converter'],
  }),
  text('convert', {
    id: 'html-to-markdown',
    name: 'HTML to Markdown',
    description: 'Convert HTML to Markdown, including tables and strikethrough.',
    keywords: ['md', 'gfm', 'turndown'],
    covers: ['HTML to Markdown Converter'],
  }),
  text('convert', {
    id: 'curl-to-fetch',
    name: 'cURL to fetch',
    description: 'Convert a curl command into JavaScript fetch() code.',
    keywords: ['http', 'request', 'api', 'javascript'],
    covers: ['cURL to Fetch Converter'],
  }),
  text('convert', {
    id: 'svg-to-react',
    name: 'SVG to React',
    description: 'Turn SVG markup into a React component (JSX or TSX).',
    keywords: ['jsx', 'tsx', 'component', 'icon'],
    covers: ['SVG to React Component Converter'],
  }),
  text('convert', {
    id: 'css-to-tailwind',
    name: 'CSS to Tailwind',
    description: 'Translate CSS rules into Tailwind v4 utility classes.',
    keywords: ['utility', 'classes', 'tailwindcss'],
    covers: ['CSS to Tailwind Converter'],
  }),
  text('convert', {
    id: 'number-to-words',
    name: 'Number to Words',
    description: 'Spell out numbers, ordinals and money, in international or Indian numbering.',
    keywords: ['cheque', 'check', 'lakh', 'crore', 'spell'],
    covers: ['Number to Words Converter'],
  }),
  text('convert', {
    id: 'unix-timestamp',
    name: 'Unix Timestamp',
    description: 'Convert epoch timestamps to dates in any time zone, and back.',
    keywords: ['epoch', 'date', 'time', 'timezone', 'iso 8601'],
    covers: ['Unix Timestamp Converter'],
  }),
  text('convert', {
    id: 'base-converter',
    name: 'Number Base Converter',
    description: 'Convert numbers between binary, octal, decimal, hex and any base up to 36.',
    keywords: ['radix', 'hex to decimal', 'binary', 'octal'],
    covers: ['Base Converter', 'Hex to Decimal Converter'],
  }),
  text('convert', {
    id: 'binary-calculator',
    name: 'Binary Calculator',
    description: 'Arithmetic and bitwise operations on binary, decimal or hex numbers.',
    keywords: ['bitwise', 'and', 'or', 'xor', 'shift', "two's complement"],
    covers: ['Binary Calculator'],
  }),
  text('convert', {
    id: 'px-rem',
    name: 'PX ↔ REM',
    description: 'Convert between pixels and rem, with a reference table.',
    keywords: ['em', 'font size', 'units', 'css'],
    covers: ['PX to REM Converter'],
  }),
  text('convert', {
    id: 'android-pixel-calculator',
    name: 'Android Pixel Calculator',
    description: 'Convert between dp, px, sp, in, mm and pt for any screen density.',
    keywords: ['dpi', 'density', 'mdpi', 'xhdpi'],
    covers: ['Android Pixel Calculator'],
  }),

  /* ------------------------------------------------------ encode -- */
  text('encode', {
    id: 'base64',
    name: 'Base64',
    description: 'Encode and decode Base64 and Base64URL, including files and data URIs.',
    keywords: ['b64', 'data uri', 'atob', 'btoa'],
    covers: ['Base64 Decode & Encode', 'Base64 encode and decode'],
  }),
  text('encode', { id: 'base32', name: 'Base32', description: 'Encode and decode RFC 4648 Base32.', keywords: ['totp', 'rfc 4648'], covers: ['Base 32 Decoder'] }),
  text('encode', {
    id: 'base58',
    name: 'Base58',
    description: 'Encode and decode Base58 text or hex (Bitcoin, Flickr, Ripple alphabets).',
    keywords: ['bitcoin', 'ipfs'],
    covers: ['Base58 Decoder / Encoder'],
  }),
  text('encode', { id: 'base62', name: 'Base62', description: 'Encode and decode URL-safe Base62.', keywords: ['short id', 'url safe'], covers: ['Base 62 Encoder'] }),
  text('encode', {
    id: 'hex-text',
    name: 'Hex ↔ Text',
    description: 'Turn text into hex bytes and decode hex in any common notation.',
    keywords: ['hexadecimal', 'bytes', '0x'],
    covers: ['Hex Decoder'],
  }),
  text('encode', { id: 'url-encode', name: 'URL Encode', description: 'Percent-encode and decode URLs, values and form data.', keywords: ['percent', 'uri', 'query string', 'urlencode'] }),
  text('encode', {
    id: 'html-entities',
    name: 'HTML Entities',
    description: 'Escape text for HTML and decode named or numeric entities.',
    keywords: ['escape', 'unescape', '&amp;'],
    covers: ['HTML Encoder / Decoder'],
  }),
  text('encode', {
    id: 'ascii-text',
    name: 'ASCII ↔ Text',
    description: 'Convert text to decimal, octal, hex or binary character codes and back.',
    keywords: ['char codes', 'code points'],
    covers: ['ASCII to Text Converter'],
  }),
  text('encode', {
    id: 'binary-text',
    name: 'Binary ↔ Text',
    description: 'Translate text to binary and back, with a per-byte breakdown.',
    keywords: ['bits', 'translator'],
    covers: ['Binary Translator'],
  }),
  text('encode', {
    id: 'utf8-bytes',
    name: 'UTF-8 Bytes',
    description: 'See the UTF-8 bytes of text, or decode percent, hex or decimal bytes.',
    keywords: ['unicode', 'code point', 'percent encoded'],
    covers: ['UTF-8 Decoder'],
  }),
  text('encode', {
    id: 'morse-code',
    name: 'Morse Code',
    description: 'Translate text to International Morse Code and back.',
    keywords: ['dots', 'dashes', 'telegraph'],
    covers: ['Morse Code Translator'],
  }),
  text('encode', {
    id: 'rot13',
    name: 'ROT13 and Caesar',
    description: 'Apply ROT13, ROT5, ROT18, ROT47 or a custom Caesar shift.',
    keywords: ['cipher', 'rot47', 'shift'],
    covers: ['ROT13 Encoder/Decoder'],
  }),
  text('encode', {
    id: 'jwt-decoder',
    name: 'JWT Decoder',
    description: 'Read a JSON Web Token: header, claims, expiry and HMAC signature check.',
    keywords: ['json web token', 'bearer', 'claims', 'verify'],
    covers: ['JWT Decoder'],
  }),
  text('encode', { id: 'jwt-encoder', name: 'JWT Encoder', description: 'Sign JSON Web Tokens with HS256, HS384 or HS512.', keywords: ['json web token', 'sign', 'hmac'], covers: ['JWT Encoder'] }),
  text('encode', {
    id: 'image-to-base64',
    name: 'Image to Base64',
    description: 'Embed an image as a data URI for CSS, HTML or Markdown.',
    keywords: ['data uri', 'inline', 'embed'],
    covers: ['Image Base64'],
  }),

  /* ------------------------------------------------------ crypto -- */
  text('crypto', {
    id: 'hash',
    name: 'Hash and HMAC',
    description: 'MD5, SHA-1, SHA-2, SHA-3 and CRC-32 of text or files, with HMAC and checksum comparison.',
    keywords: ['md5', 'sha1', 'sha256', 'sha512', 'checksum', 'digest', 'crc32'],
    covers: ['SHA-1 Hash Generator', 'SHA-512 Hash Generator', 'MD5 hash generator'],
  }),
  text('crypto', {
    id: 'aes',
    name: 'AES Encryption',
    description: 'Encrypt and decrypt with a password (AES-256-GCM, or OpenSSL-compatible CBC).',
    keywords: ['encrypt', 'decrypt', 'openssl', 'pbkdf2', 'cipher'],
    covers: ['AES encryption and decryption'],
  }),
  text('crypto', {
    id: 'htpasswd',
    name: 'Htpasswd Generator',
    description: 'Create and check password entries for Apache and nginx basic auth.',
    keywords: ['bcrypt', 'apache', 'nginx', 'basic auth', 'apr1'],
    covers: ['Htpasswd Generator'],
  }),

  /* ---------------------------------------------------- generate -- */
  text('generate', {
    id: 'uuid',
    name: 'UUID Generator',
    description: 'Generate v1, v4, v6 and v7 UUIDs in bulk and decode existing ones.',
    keywords: ['guid', 'unique id', 'v4', 'v7'],
    covers: ['UUID & GUID Generator'],
  }),
  text('generate', {
    id: 'random-words',
    name: 'Random Words',
    description: 'Pick random words by length and case, for test data or passphrases.',
    keywords: ['passphrase', 'lorem', 'word list'],
    covers: ['Random Word Generator'],
  }),
  text('generate', {
    id: 'barcode',
    name: 'Barcode Generator',
    description: 'Create Code 128, EAN, UPC, Code 39, ITF-14, QR and Data Matrix codes as SVG or PNG.',
    keywords: ['qr code', 'ean13', 'upc', 'code128', 'check digit'],
    covers: ['Barcode Generator'],
  }),
  text('generate', {
    id: 'cron',
    name: 'Cron Expression',
    description: 'Explain a cron expression and preview its next run times.',
    keywords: ['crontab', 'schedule', 'scheduler'],
    covers: ['Cron Expression Generator'],
  }),
  text('generate', {
    id: 'robots-txt',
    name: 'robots.txt Generator',
    description: 'Write crawler rules, including a block list for AI crawlers.',
    keywords: ['seo', 'crawler', 'sitemap', 'ai bots'],
    covers: ['robots.txt Generator'],
  }),
  text('generate', {
    id: 'llms-txt',
    name: 'llms.txt Generator',
    description: 'Build or validate an llms.txt file from links or a pasted sitemap.',
    keywords: ['llm', 'ai', 'sitemap'],
    covers: ['llms.txt Generator'],
  }),
  text('generate', {
    id: 'email-link',
    name: 'Email Link Builder',
    description: 'Build mailto links with subject and body, optionally hidden from scrapers.',
    keywords: ['mailto', 'obfuscate', 'spam'],
    covers: ['Code for Email'],
  }),

  /* -------------------------------------------------------- text -- */
  text('text', {
    id: 'diff',
    name: 'Diff Checker',
    description: 'Compare two texts by line, word or character and export a patch.',
    keywords: ['compare', 'difference', 'patch'],
    covers: ['Diff Checker'],
  }),
  text('text', {
    id: 'case-converter',
    name: 'Case Converter',
    description: 'Switch between camelCase, snake_case, kebab-case, Title Case and more.',
    keywords: ['camel', 'snake', 'kebab', 'pascal', 'uppercase'],
    covers: ['Case Converter'],
  }),
  text('text', {
    id: 'dedupe-lines',
    name: 'Duplicate Line Remover',
    description: 'Remove repeated lines, with control over case and which copy to keep.',
    keywords: ['unique', 'dedupe', 'sort lines'],
    covers: ['Duplicate Line Remover'],
  }),
  text('text', {
    id: 'remove-line-breaks',
    name: 'Remove Line Breaks',
    description: 'Join lines into paragraphs or a single line.',
    keywords: ['newline', 'unwrap', 'pdf text'],
    covers: ['Remove Line Breaks'],
  }),
  text('text', { id: 'text-reverser', name: 'Text Reverser', description: 'Reverse characters, word order or line order.', keywords: ['backwards', 'mirror'], covers: ['Text Reverser'] }),

  /* --------------------------------------------------------- css -- */
  other('css', 'visual', () => import('./css/gradient'), {
    id: 'gradient',
    name: 'Gradient Generator',
    description: 'Linear, radial and conic gradients as CSS, SVG, Canvas, SwiftUI, Android XML or PNG.',
    keywords: ['linear', 'radial', 'conic', 'background'],
    covers: ['CSS Gradient Generator', 'CSS Gradient', 'Gradient Generator', 'Gradient Image'],
  }),
  other('css', 'visual', () => import('./css/mesh-gradient'), {
    id: 'mesh-gradient',
    name: 'Mesh Gradient',
    description: 'Soft multi-point gradients as CSS, SVG or PNG.',
    keywords: ['blurry', 'aurora', 'background'],
    covers: ['Mesh Gradient Generator'],
  }),
  other('css', 'visual', () => import('./css/box-shadow'), {
    id: 'box-shadow',
    name: 'Box Shadow',
    description: 'Layer drop shadows and copy the CSS or Tailwind class.',
    keywords: ['drop shadow', 'elevation', 'neumorphism'],
    covers: ['CSS Box Shadow Generator', 'Box Shadow'],
  }),
  other('css', 'visual', () => import('./css/text-shadow'), {
    id: 'text-shadow',
    name: 'Text Shadow',
    description: 'Stack text shadows for glows, outlines and 3D lettering.',
    keywords: ['glow', 'outline', 'neon'],
    covers: ['CSS Text Shadow Generator', 'Text Shadow'],
  }),
  other('css', 'visual', () => import('./css/border-radius'), {
    id: 'border-radius',
    name: 'Border Radius',
    description: 'Round corners individually or shape organic blobs.',
    keywords: ['rounded', 'corners', 'blob'],
    covers: ['CSS Border Radius Generator', 'Border Radius'],
  }),
  other('css', 'visual', () => import('./css/border'), {
    id: 'border',
    name: 'Border',
    description: 'Set border width, style and colour per side.',
    keywords: ['outline', 'stroke'],
    covers: ['Border'],
  }),
  other('css', 'visual', () => import('./css/background'), {
    id: 'background',
    name: 'Background',
    description: 'Compose background colour, image, repeat, position and size.',
    keywords: ['background-image', 'cover', 'repeat'],
    covers: ['Background'],
  }),
  other('css', 'visual', () => import('./css/pattern-background'), {
    id: 'pattern-background',
    name: 'Background Patterns',
    description: 'Grids, dots, stripes, checks and starfields built from CSS gradients.',
    keywords: ['grid', 'dots', 'stripes', 'checkerboard', 'particles'],
    covers: ['Background Generator'],
  }),
  other('css', 'visual', () => import('./css/glassmorphism'), {
    id: 'glassmorphism',
    name: 'Glassmorphism',
    description: 'Frosted-glass panels with blur, tint and border.',
    keywords: ['frosted', 'backdrop-filter', 'blur'],
    covers: ['Glassmorphism Generator'],
  }),
  other('css', 'custom', () => import('./custom/clip-path'), {
    id: 'clip-path',
    name: 'Clip-Path',
    description: 'Draw polygon, circle, ellipse and inset clip-paths by dragging points.',
    keywords: ['polygon', 'mask', 'shape'],
    covers: ['CSS Clip-Path Generator'],
  }),
  other('css', 'visual', () => import('./css/flexbox'), {
    id: 'flexbox',
    name: 'Flexbox',
    description: 'Try flex container and item settings with a live layout.',
    keywords: ['flex', 'layout', 'justify', 'align'],
    covers: ['CSS Flexbox Generator', 'Flexbox layout Generator'],
  }),
  other('css', 'visual', () => import('./css/grid'), {
    id: 'grid',
    name: 'Grid',
    description: 'Define tracks, gaps and named areas for CSS Grid.',
    keywords: ['layout', 'grid-template-areas', 'columns'],
    covers: ['CSS Grid Generator', 'Grid layout Generator'],
  }),
  other('css', 'visual', () => import('./css/transform'), {
    id: 'transform',
    name: 'Transform',
    description: 'Translate, rotate, scale and skew, with the equivalent matrix().',
    keywords: ['matrix', 'rotate', 'scale', 'skew', '3d'],
    covers: ['Matrix Transform'],
  }),
  other('css', 'visual', () => import('./css/transition'), {
    id: 'transition',
    name: 'Transition',
    description: 'Tune transition timing and try it on hover.',
    keywords: ['ease', 'duration', 'hover'],
    covers: ['Transition'],
  }),
  other('css', 'visual', () => import('./css/animation'), {
    id: 'animation',
    name: 'Animation',
    description: 'Pick or write keyframes and set the animation timing.',
    keywords: ['keyframes', 'bounce', 'fade', 'spin'],
    covers: ['Animation', 'CSS Animation Kit'],
  }),
  other('css', 'visual', () => import('./css/filter'), {
    id: 'filter',
    name: 'Filter',
    description: 'Combine blur, brightness, contrast, hue and other CSS filters.',
    keywords: ['blur', 'grayscale', 'sepia', 'hue-rotate'],
    covers: ['Image Filter (CSS)'],
  }),
  other('css', 'custom', () => import('./custom/cubic-bezier'), {
    id: 'cubic-bezier',
    name: 'Cubic Bezier',
    description: 'Shape an easing curve and export it for CSS and animation libraries.',
    keywords: ['easing', 'timing function', 'curve'],
    covers: ['Cubic Bezier Generator'],
  }),
  other('css', 'custom', () => import('./custom/media-query'), {
    id: 'media-query',
    name: 'Media Query',
    description: 'Build @media queries and test them in a resizable frame.',
    keywords: ['responsive', 'breakpoint', 'viewport'],
    covers: ['CSS Media Query'],
  }),
  other('css', 'custom', () => import('./custom/bootstrap-theme'), {
    id: 'bootstrap-theme',
    name: 'Bootstrap Theme Builder',
    description: "Edit any of Bootstrap 5.3's Sass variables with a live preview, then export Sass or compiled CSS.",
    keywords: ['bootstrap', 'sass', 'scss', 'variables', 'theme', 'bootswatch'],
    covers: ['Bootstrap Build (Bootstrap 5 theme editor)'],
  }),
  other('css', 'visual', () => import('./css/blob'), {
    id: 'blob',
    name: 'Blob Generator',
    description: 'Random organic shapes as SVG, optionally animated.',
    keywords: ['shape', 'organic', 'svg'],
    covers: ['Blob Generator'],
  }),
  other('css', 'visual', () => import('./css/wave'), {
    id: 'wave',
    name: 'Wave Generator',
    description: 'Layered SVG waves for section dividers.',
    keywords: ['divider', 'svg', 'section'],
    covers: ['Wave Generator'],
  }),
  other('css', 'visual', () => import('./css/sunburst'), {
    id: 'sunburst',
    name: 'Sunburst Generator',
    description: 'Radiating ray patterns as CSS or SVG.',
    keywords: ['rays', 'retro', 'conic'],
    covers: ['Sunburst Generator'],
  }),

  /* ------------------------------------------------------- color -- */
  text('color', {
    id: 'color-converter',
    name: 'Colour Converter',
    description: 'Convert between HEX, RGB, HSL, OKLCH and more, with gamut checks.',
    keywords: ['oklch', 'hex', 'rgb', 'hsl', 'p3', 'color'],
    covers: ['OKLCH Converter'],
  }),
  text('color', {
    id: 'color-shades',
    name: 'Colour Shades',
    description: 'Build a perceptually even 50-950 scale from one colour.',
    keywords: ['palette', 'tints', 'scale', 'color'],
    covers: ['Color Shades Generator'],
  }),
  text('color', {
    id: 'contrast-checker',
    name: 'Contrast Checker',
    description: 'Check WCAG contrast and get the nearest passing colour.',
    keywords: ['wcag', 'accessibility', 'a11y', 'aa', 'aaa'],
    covers: ['Color Contrast Checker'],
  }),
  other('color', 'custom', () => import('./custom/tailwind-colors'), {
    id: 'tailwind-colors',
    name: 'Tailwind Colours',
    description: 'Browse the Tailwind v4 palette, copy any shade, or match a hex value.',
    keywords: ['palette', 'tailwindcss', 'color'],
    covers: ['Tailwind Colors'],
  }),
  text('color', {
    id: 'shadcn-theme',
    name: 'shadcn/ui Theme',
    description: 'Generate accessible light and dark theme variables from one colour.',
    keywords: ['theme', 'globals.css', 'css variables', 'dark mode'],
    covers: ['Shadcn Theme Generator'],
  }),
  other('color', 'image', () => import('./image/color-blindness'), {
    id: 'color-blindness',
    name: 'Colour Blindness Simulator',
    description: 'See an image as people with common colour vision deficiencies do.',
    keywords: ['protanopia', 'deuteranopia', 'tritanopia', 'accessibility'],
    covers: ['Color Blindness Simulator'],
  }),

  /* ------------------------------------------------------- image -- */
  other('image', 'image', () => import('./image/image-converter'), {
    id: 'image-converter',
    name: 'Image Converter',
    description: 'Convert and compress between PNG, JPEG, WebP and AVIF.',
    keywords: ['avif', 'webp', 'png', 'jpg', 'compress', 'quality'],
    covers: ['AVIF Converter', 'PNG to WebP Converter', 'Image Compress'],
  }),
  other('image', 'image', () => import('./image/image-resize'), {
    id: 'image-resize',
    name: 'Image Resize',
    description: 'Resize by pixels or percentage, keeping the aspect ratio if you want.',
    keywords: ['scale', 'dimensions', 'thumbnail'],
    covers: ['Image Resize'],
  }),
  other('image', 'custom', () => import('./custom/image-crop'), {
    id: 'image-crop',
    name: 'Image Crop',
    description: 'Crop freely or to a fixed aspect ratio.',
    keywords: ['trim', 'cut', 'aspect ratio'],
    covers: ['Image Crop'],
  }),
  other('image', 'image', () => import('./image/image-rotate'), {
    id: 'image-rotate',
    name: 'Image Rotate',
    description: 'Rotate by any angle and flip horizontally or vertically.',
    keywords: ['flip', 'mirror', 'turn'],
    covers: ['Image Rotate'],
  }),
  other('image', 'image', () => import('./image/image-filter'), {
    id: 'image-filter',
    name: 'Image Filter',
    description: 'Adjust brightness, contrast, saturation, blur and more, or go greyscale.',
    keywords: ['grayscale', 'sepia', 'blur', 'brightness'],
    covers: ['Image Filter', 'Image Grayscale'],
  }),
  other('image', 'image', () => import('./image/image-color-replace'), {
    id: 'image-color-replace',
    name: 'Colour Replacer',
    description: 'Replace or swap colours in an image, with tolerance and soft edges.',
    keywords: ['swap', 'recolor', 'transparent', 'background'],
    covers: ['Color Swapper', 'PNG Color Replacer'],
  }),
  other('image', 'image', () => import('./image/image-fade'), {
    id: 'image-fade',
    name: 'Image Fade',
    description: 'Fade an image to transparent evenly, along a line or from a point.',
    keywords: ['opacity', 'transparent', 'gradient mask'],
    covers: ['Image Fade Effect Generator'],
  }),
  other('image', 'custom', () => import('./custom/image-color-picker'), {
    id: 'image-color-picker',
    name: 'Image Colour Picker',
    description: 'Pick colours from an image and extract its palette.',
    keywords: ['eyedropper', 'palette', 'dominant colours'],
    covers: ['Image Color Picker/Palette'],
  }),
  other('image', 'custom', () => import('./custom/favicon'), {
    id: 'favicon',
    name: 'Favicon and ICO',
    description: 'Make multi-size .ico files, PNG icons and the HTML tags for them.',
    keywords: ['ico', 'icon', 'apple-touch-icon', 'transparent'],
    covers: ['Favicon Generator', 'PNG to ICO Converter', 'ICO Transparency Creator'],
  }),
  other('image', 'custom', () => import('./custom/svg-to-png'), {
    id: 'svg-to-png',
    name: 'SVG to PNG',
    description: 'Rasterise SVG at any scale, with or without a background.',
    keywords: ['rasterize', 'export', 'convert'],
    covers: ['SVG to PNG Converter'],
  }),
  text('image', { id: 'svg-viewer', name: 'SVG Viewer', description: 'Preview SVG safely and see its size, viewBox and tidy source.', keywords: ['preview', 'inspect'], covers: ['SVG Viewer'] }),
  text('image', {
    id: 'svg-background-remover',
    name: 'SVG Background Remover',
    description: 'Remove the backdrop of an SVG without rasterising it.',
    keywords: ['transparent', 'backdrop'],
    covers: ['SVG Background Remover'],
  }),

  /* -------------------------------------------------------- misc -- */
  other('misc', 'custom', () => import('./custom/html-playground'), {
    id: 'html-playground',
    name: 'HTML Playground',
    description: 'Try HTML and CSS, with Bootstrap 5 available offline and a resizable preview.',
    keywords: ['bootstrap', 'editor', 'sandbox', 'responsive'],
    covers: ['Bootstrap Code Editor'],
  }),
  other('misc', 'custom', () => import('./custom/commands'), {
    id: 'commands',
    name: 'Command Cheat Sheet',
    description: 'Equivalent terminal commands for Linux, Windows cmd and PowerShell.',
    keywords: ['ubuntu', 'bash', 'powershell', 'terminal', 'shell'],
    covers: ['Basic Commands - Ubuntu/Windows'],
  }),
  other('misc', 'visual', () => import('./css/android-button'), {
    id: 'android-button',
    name: 'Android Button Maker',
    description: 'Design a button and get the shape-drawable XML.',
    keywords: ['drawable', 'xml', 'shape', 'selector'],
    covers: ['Android Button Maker'],
  }),
  text('misc', {
    id: 'payment-fee',
    name: 'Payment Fee Calculator',
    description: 'Work out card processing fees, or what to charge to receive a set amount.',
    keywords: ['stripe', 'fees', 'payout', 'processing'],
    covers: ['Stripe Fee Calculator'],
  }),
  text('misc', {
    id: 'cac-calculator',
    name: 'CAC Calculator',
    description: 'Customer acquisition cost, payback period and LTV:CAC.',
    keywords: ['ltv', 'saas', 'marketing', 'payback'],
    covers: ['Customer Acquisition Cost (CAC) Calculator'],
  }),
];

const BY_ID = new Map(TOOLS.map((tool) => [tool.id, tool]));

export const findTool = (id: string): ToolEntry | undefined => BY_ID.get(id);

export const toolsIn = (category: CategoryId): ToolEntry[] => TOOLS.filter((tool) => tool.category === category);

/** Web tools that cannot work without a network service and are deliberately not included. */
export const NOT_INCLUDED: readonly { name: string; reason: string }[] = [
  { name: 'AI Dashboard Generator', reason: 'Depends on a hosted AI model to write its insights; there is no faithful offline equivalent.' },
];

function score(tool: ToolEntry, query: string): number {
  const name = tool.name.toLowerCase();
  if (name === query) return 100;
  if (name.startsWith(query)) return 90;
  if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(query))) return 80;
  if (name.includes(query)) return 70;
  if (tool.keywords?.some((keyword) => keyword.startsWith(query))) return 60;
  if (tool.keywords?.some((keyword) => keyword.includes(query))) return 50;
  if (tool.covers?.some((covered) => covered.toLowerCase().includes(query))) return 45;
  if (tool.description.toLowerCase().includes(query)) return 30;
  // Every word of a multi-word query appears somewhere.
  const haystack = `${name} ${tool.keywords?.join(' ') ?? ''} ${tool.description.toLowerCase()}`;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((word) => haystack.includes(word))) return 25;
  // Letters in order, for abbreviations such as "jfmt".
  let index = 0;
  for (const ch of name) if (ch === query[index]) index++;
  return index === query.length && query.length >= 3 ? 10 : 0;
}

export function searchTools(query: string): ToolEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...TOOLS];
  return TOOLS.map((tool) => ({ tool, rank: score(tool, needle) }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.tool.name.localeCompare(b.tool.name))
    .map((item) => item.tool);
}
