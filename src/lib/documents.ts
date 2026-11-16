/**
 * Plain text from office documents and PDFs, so they can be compared or
 * searched like any other text.  Formatting, images and layout are dropped.
 *
 * Word, Excel, PowerPoint and OpenDocument files are ZIP archives of XML and
 * are read here directly; PDFs use pdf.js, loaded only when one is opened.
 */
import { unzipSync } from 'fflate';
import { utf8Decode } from './bytes';
import { ToolError } from './errors';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodeXml = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });

const MAX_UNZIPPED = 200 * 1024 * 1024;

function unzip(bytes: Uint8Array, what: string): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_UNZIPPED) throw new ToolError(`This ${what} expands to more than 200 MB.`);
        return /\.xml$/i.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`This is not a valid ${what} (it should be a ZIP archive).`);
  }
}

const part = (files: Record<string, Uint8Array>, name: string): string | undefined => {
  const bytes = files[name];
  return bytes ? utf8Decode(bytes) : undefined;
};

const numbered = (files: Record<string, Uint8Array>, pattern: RegExp): string[] =>
  Object.keys(files)
    .filter((name) => pattern.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0));

/** Text of a WordprocessingML body: paragraphs on lines, tabs and table cells as tabs. */
export function wordXmlText(xml: string): string {
  const body = xml.replace(/<w:(?:instrText|delText)[^>]*>[\s\S]*?<\/w:(?:instrText|delText)>/g, '');
  let out = '';
  let cellDepth = 0;
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<w:cr\/>|<\/w:p>|<w:tc(?:\s[^>]*)?>|<\/w:tc>|<\/w:tr>|<w:noBreakHyphen\/>/g;
  for (const match of body.matchAll(pattern)) {
    const token = match[0];
    if (match[1] !== undefined) out += decodeXml(match[1]);
    else if (token === '<w:tab/>') out += '\t';
    else if (token.startsWith('<w:br') || token === '<w:cr/>') out += cellDepth > 0 ? ' ' : '\n';
    else if (token === '</w:p>') out += cellDepth > 0 ? ' ' : '\n';
    else if (token.startsWith('<w:tc')) cellDepth++;
    else if (token === '</w:tc>') {
      cellDepth = Math.max(0, cellDepth - 1);
      out = `${out.replace(/ +$/, '')}\t`;
    } else if (token === '</w:tr>') out = `${out.replace(/\t$/, '')}\n`;
    else if (token === '<w:noBreakHyphen/>') out += '-';
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function docxText(bytes: Uint8Array): string {
  const files = unzip(bytes, 'Word document');
  const document = part(files, 'word/document.xml');
  if (document === undefined) throw new ToolError('This file has no Word document body (word/document.xml).');
  const notes = ['word/footnotes.xml', 'word/endnotes.xml']
    .map((name) => part(files, name))
    .filter((xml): xml is string => xml !== undefined)
    .map(wordXmlText)
    .filter((text) => text !== '');
  return [wordXmlText(document), ...notes].join('\n\n');
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function xlsxText(bytes: Uint8Array): string {
  const files = unzip(bytes, 'Excel workbook');
  const shared: string[] = [];
  const sharedXml = part(files, 'xl/sharedStrings.xml') ?? '';
  for (const item of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push([...(item[1] as string).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1] as string)).join(''));
  }
  const names = [...(part(files, 'xl/workbook.xml') ?? '').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1] as string));
  const sheets = numbered(files, /^xl\/worksheets\/sheet\d+\.xml$/);
  if (sheets.length === 0) throw new ToolError('This workbook has no worksheets.');
  return sheets
    .map((name, index) => {
      const xml = part(files, name) ?? '';
      const lines: string[] = [];
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const cell of (row[1] as string).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attributes = cell[1] as string;
          const content = cell[2] ?? '';
          const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
          const type = /\bt="(\w+)"/.exec(attributes)?.[1];
          const raw = /<v>([\s\S]*?)<\/v>/.exec(content)?.[1];
          let value = '';
          if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
          else if (type === 'inlineStr') value = [...content.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1] as string)).join('');
          else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else if (raw !== undefined) value = decodeXml(raw);
          const column = reference ? columnIndex(reference) : cells.length;
          while (cells.length < column) cells.push('');
          cells[column] = value.replace(/[\t\n]/g, ' ');
        }
        lines.push(cells.join('\t').replace(/\t+$/, ''));
      }
      return `# ${names[index] ?? `Sheet ${index + 1}`}\n${lines.join('\n').trim()}`;
    })
    .join('\n\n');
}

export function pptxText(bytes: Uint8Array): string {
  const files = unzip(bytes, 'PowerPoint presentation');
  const slides = numbered(files, /^ppt\/slides\/slide\d+\.xml$/);
  if (slides.length === 0) throw new ToolError('This presentation has no slides.');
  return slides
    .map((name, index) => {
      const xml = part(files, name) ?? '';
      const paragraphs = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
        .map((p) => [...(p[1] as string).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1] as string)).join(''))
        .filter((text) => text.trim() !== '');
      return `# Slide ${index + 1}\n${paragraphs.join('\n')}`;
    })
    .join('\n\n');
}

export function odfText(bytes: Uint8Array): string {
  const files = unzip(bytes, 'OpenDocument file');
  const content = part(files, 'content.xml');
  if (content === undefined) throw new ToolError('This file has no OpenDocument content (content.xml).');
  // Only text inside the document body counts; styles and settings come before it.
  const body = content.slice(Math.max(0, content.indexOf('<office:body')));
  let out = '';
  for (const match of body.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0];
    if (!token.startsWith('<')) {
      out += decodeXml(token);
      continue;
    }
    const spaces = /^<text:s(?:\s+text:c="(\d+)")?\s*\/>$/.exec(token);
    if (spaces) out += ' '.repeat(Number(spaces[1] ?? 1));
    else if (token === '<text:tab/>' || token === '</table:table-cell>') out += '\t';
    else if (token === '<text:line-break/>' || token === '</text:p>' || token === '</text:h>' || token === '</table:table-row>') out += '\n';
  }
  return out
    .replace(/\t+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.min.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  // The worker is bundled with the app and loaded from its own origin, like every other script.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolError(/password/i.test(message) ? 'This PDF is password-protected.' : `The PDF could not be read: ${message}`);
  }
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
    }
    pages.push(text.replace(/[ \t]+\n/g, '\n').trim());
  }
  await task.destroy();
  const joined = pages.map((text, index) => (document.numPages > 1 ? `# Page ${index + 1}\n${text}` : text)).join('\n\n');
  if (joined.replace(/# Page \d+/g, '').trim() === '') throw new ToolError('This PDF has no text layer (it is probably scanned images). Run it through OCR first.');
  return joined;
}

export const DOCUMENT_EXTENSIONS = /\.(docx|docm|xlsx|xlsm|pptx|odt|ods|odp|pdf)$/i;

/** Plain text of a document file, chosen by its extension. */
export async function documentText(name: string, bytes: Uint8Array): Promise<string> {
  const extension = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase();
  switch (extension) {
    case 'docx':
    case 'docm':
      return docxText(bytes);
    case 'xlsx':
    case 'xlsm':
      return xlsxText(bytes);
    case 'pptx':
      return pptxText(bytes);
    case 'odt':
    case 'ods':
    case 'odp':
      return odfText(bytes);
    case 'pdf':
      return pdfText(bytes);
    default:
      throw new ToolError(`${name} is not a document this tool can read.`);
  }
}
