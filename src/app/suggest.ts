/**
 * Which tools can open a file: from its extension, its MIME type and, when
 * those say nothing, its first bytes.  Used when files are dropped on the
 * window and by "Send to" on results.
 */
import { findTool } from '../tools/registry';
import type { ToolEntry } from '../tools/types';
import { extensionOf } from './handoff';

export interface Suggestion {
  readonly tool: ToolEntry;
  /** What the tool would do with the file. */
  readonly does: string;
}

type Kind =
  | 'image'
  | 'svg'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'json'
  | 'har'
  | 'yaml'
  | 'csv'
  | 'xml'
  | 'html'
  | 'markdown'
  | 'sql'
  | 'script'
  | 'css'
  | 'code'
  | 'certificate'
  | 'sqlite'
  | 'model'
  | 'archive'
  | 'office'
  | 'mermaid'
  | 'dot'
  | 'email'
  | 'text'
  | 'binary';

const BY_EXTENSION: Record<string, Kind> = {};
const add = (kind: Kind, list: string) => {
  for (const ext of list.split(' ')) BY_EXTENSION[ext] = kind;
};
add('image', 'png jpg jpeg gif webp avif bmp ico tif tiff heic heif');
add('svg', 'svg');
add('pdf', 'pdf');
add('video', 'mp4 m4v mkv webm mov avi wmv flv mpg mpeg ts mts m2ts 3gp ogv');
add('audio', 'mp3 wav m4a aac flac ogg oga opus wma aiff aif amr');
add('json', 'json geojson ipynb webmanifest');
add('har', 'har');
add('yaml', 'yaml yml');
add('csv', 'csv tsv');
add('xml', 'xml xsl xslt rss atom plist');
add('html', 'html htm');
add('markdown', 'md markdown');
add('sql', 'sql');
add('script', 'js mjs cjs ts tsx jsx');
add('css', 'css scss sass less');
add('code', 'py rs go java c h cpp hpp cs rb php sh bash ps1 kt swift lua toml ini env');
add('certificate', 'pem crt cer der csr key p12 pfx');
add('sqlite', 'db sqlite sqlite3 db3');
add('model', 'stl obj ply glb gltf gcode gco nc ngc tap');
add('archive', 'zip tar tgz gz bz2 tbz tbz2 7z rar xz txz cab iso');
add('office', 'docx doc docm dot dotx odt rtf epub xlsx xls xlsm ods pptx ppt pptm pps ppsx pot potx odp pages numbers key hwp wps pub vsd vsdx odg xps oxps ps eps');
add('mermaid', 'mmd mermaid');
add('dot', 'dot gv');
add('email', 'eml mht mhtml');
add('text', 'txt log text');

const RULES: Record<Kind, readonly (readonly [string, string])[]> = {
  image: [
    ['image-annotate', 'Draw arrows, boxes and text on it'],
    ['image-converter', 'Convert or compress it'],
    ['image-resize', 'Resize it'],
    ['image-crop', 'Crop it'],
    ['background-remover', 'Remove the background'],
    ['image-upscaler', 'Enlarge it with AI'],
    ['ocr', 'Read the text in it'],
    ['image-metadata', 'See or strip its EXIF and GPS data'],
    ['face-blur', 'Blur the faces'],
    ['qr-decoder', 'Read a QR code in it'],
    ['image-vectorise', 'Trace it to SVG'],
  ],
  svg: [
    ['svg-viewer', 'View and check it'],
    ['svg-minifier', 'Make it smaller'],
    ['svg-to-png', 'Save it as PNG'],
    ['svg-to-react', 'Turn it into a React component'],
  ],
  pdf: [
    ['pdf-reader', 'Read, search and annotate it'],
    ['pdf-organise', 'Reorder, rotate, merge or delete pages'],
    ['pdf-forms', 'Fill in its form'],
    ['pdf-sign', 'Sign it'],
    ['ocr', 'Read the text in a scanned PDF'],
    ['pdf-split', 'Split it'],
    ['pdf-stamp', 'Add page numbers or a stamp'],
    ['pdf-properties', 'Edit its title and properties'],
    ['pdf-pictures', 'Turn pages into pictures, or pictures into a PDF'],
    ['document-to-text', 'Get its text'],
    ['pdf-toolbox', 'Edit bookmarks, attachments and blank pages, clean it up or check it'],
    ['file-converter', 'Turn it into a Word document to edit'],
  ],
  video: [
    ['video-tools', 'Trim, crop, compress or add subtitles'],
    ['transcribe', 'Write down what is said'],
    ['file-converter', 'Convert it to another format'],
  ],
  audio: [
    ['audio-tools', 'Trim, join, change volume or speed'],
    ['transcribe', 'Write down what is said'],
    ['file-converter', 'Convert it to another format'],
  ],
  json: [
    ['json-formatter', 'Format and check it'],
    ['json-tree', 'Browse it as a tree'],
    ['json-query', 'Query it with JSONPath or jq'],
    ['json-to-csv', 'Turn it into CSV'],
    ['json-to-typescript', 'Write TypeScript types for it'],
    ['openapi-viewer', 'Browse it as an OpenAPI description'],
  ],
  har: [['har-viewer', 'Browse the recorded requests']],
  yaml: [
    ['yaml-formatter', 'Format and check it'],
    ['yaml-json', 'Turn it into JSON'],
    ['openapi-viewer', 'Browse it as an OpenAPI description'],
  ],
  csv: [
    ['csv-tools', 'Merge, split, sort or clean it'],
    ['csv-to-json', 'Turn it into JSON'],
    ['table-converter', 'Turn it into a Markdown, HTML or SQL table'],
  ],
  xml: [
    ['xml-formatter', 'Format and check it'],
    ['xslt', 'Transform it with XSLT'],
  ],
  html: [
    ['html-formatter', 'Format it'],
    ['html-to-markdown', 'Turn it into Markdown'],
  ],
  markdown: [['markdown-to-html', 'Preview it and turn it into HTML']],
  sql: [
    ['sql-formatter', 'Format it'],
    ['sql-er-diagram', 'Draw its tables as a diagram'],
  ],
  script: [
    ['js-formatter', 'Format it'],
    ['js-minifier', 'Minify it'],
    ['code-screenshot', 'Make a picture of the code'],
  ],
  css: [
    ['css-formatter', 'Format it'],
    ['css-preprocessor', 'Compile Sass or Less'],
  ],
  code: [
    ['syntax-highlighter', 'Highlight it'],
    ['code-screenshot', 'Make a picture of the code'],
  ],
  certificate: [['certificate-decoder', 'Read the certificate or key']],
  sqlite: [['sqlite-browser', 'Browse and query the database']],
  model: [['model-viewer', 'View it in 3D']],
  archive: [
    ['archive-tool', 'See and extract what is inside'],
    ['file-converter', 'Turn it into a ZIP'],
  ],
  office: [
    ['file-converter', 'Convert it, for example to PDF'],
    ['document-to-text', 'Get its text'],
  ],
  mermaid: [['mermaid-editor', 'Draw the diagram']],
  dot: [['graphviz-viewer', 'Draw the graph']],
  email: [
    ['file-converter', 'Turn it into a web page or PDF'],
    ['email-headers', 'Read the email’s headers'],
  ],
  text: [
    ['word-counter', 'Count words and characters'],
    ['diff', 'Compare it with another text'],
    ['text-cleaner', 'Clean it up'],
  ],
  binary: [],
};

/** Anything can be inspected byte by byte or put through a recipe. */
const ALWAYS: readonly (readonly [string, string])[] = [
  ['recipe', 'Decode or analyse it with a CyberChef recipe'],
  ['hex-viewer', 'Look at its bytes'],
];

function sniff(head: Uint8Array): Kind {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const text = new TextDecoder().decode(head);
  if (starts(0x89, 0x50, 0x4e, 0x47) || starts(0xff, 0xd8, 0xff) || text.startsWith('GIF8') || (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP')) return 'image';
  if (text.startsWith('%PDF')) return 'pdf';
  if (text.startsWith('SQLite format 3')) return 'sqlite';
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x1f, 0x8b)) return 'archive';
  if (text.slice(4, 8) === 'ftyp' || starts(0x1a, 0x45, 0xdf, 0xa3)) return 'video';
  if (text.startsWith('ID3') || text.startsWith('OggS') || text.startsWith('fLaC') || (text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE')) return 'audio';
  if (text.startsWith('-----BEGIN')) return 'certificate';
  if (/^\s*[{[]/.test(text)) return 'json';
  if (/^\s*</.test(text)) return 'xml';
  // Plain text: only tabs, line breaks and printable ASCII.
  return head.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) ? 'text' : 'binary';
}

export async function kindOf(file: Blob & { readonly name?: string }): Promise<Kind> {
  const ext = extensionOf(file.name ?? '');
  const byExtension = BY_EXTENSION[ext];
  if (byExtension) return byExtension;
  if (file.type.startsWith('image/svg')) return 'svg';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/pdf') return 'pdf';
  return sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
}

/** Tools for these files, best first; `except` leaves out the tool they came from. */
export async function suggestTools(files: readonly (Blob & { readonly name?: string })[], except?: string): Promise<Suggestion[]> {
  const kinds = await Promise.all(files.map(kindOf));
  const first = kinds[0] ?? 'binary';
  // Tools that suit every file come first, then the first file's own suggestions.
  const rules = [...(RULES[first] ?? []), ...ALWAYS];
  const out: Suggestion[] = [];
  for (const [id, does] of rules) {
    const tool = findTool(id);
    if (tool && id !== except && !out.some((s) => s.tool.id === id)) out.push({ tool, does });
  }
  return out;
}
