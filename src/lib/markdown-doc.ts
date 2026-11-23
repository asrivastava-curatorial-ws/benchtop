/**
 * Markdown documents for the Markdown Editor: HTML with maths ($…$ and $$…$$,
 * drawn by MathJax as SVG images), an outline, and export to a standalone HTML
 * page, EPUB 3 and Word (.docx).  Pictures embedded as data URLs travel into
 * every format, so an exported document needs no other files.
 */
import { strToU8, zipSync } from 'fflate';
import { marked, type Token, type Tokens } from 'marked';
import { escapeHtml } from './text';

export type MathRenderer = (tex: string, display: boolean) => { svg: string; error: string | null; depth?: number };

const MATH_BLOCK = /\$\$([\s\S]+?)\$\$/g;
const MATH_INLINE = /(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

/** Replaces maths with placeholders before Markdown parsing (so _ and * inside it are left alone). */
export function extractMath(md: string): { text: string; math: { tex: string; display: boolean }[] } {
  const math: { tex: string; display: boolean }[] = [];
  // Code spans and fences keep their dollar signs.
  const code: string[] = [];
  let text = md.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g, (m) => {
    code.push(m);
    return `\uE001C${code.length - 1}\uE002`;
  });
  text = text.replace(MATH_BLOCK, (_, tex: string) => {
    math.push({ tex: tex.trim(), display: true });
    return `\n\n\uE001M${math.length - 1}\uE002\n\n`;
  });
  text = text.replace(MATH_INLINE, (_, before: string, tex: string) => {
    math.push({ tex, display: false });
    return `${before}\uE001M${math.length - 1}\uE002`;
  });
  text = text.replace(/\uE001C(\d+)\uE002/g, (_, i: string) => code[Number(i)] as string);
  return { text, math };
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

/** Markdown to HTML; maths becomes SVG images, or the TeX in red when it does not parse. */
export function renderMarkdown(md: string, renderMath?: MathRenderer): string {
  const { text, math } = extractMath(md);
  const html = marked.parse(text, { async: false, gfm: true, breaks: false }) as string;
  return html.replace(/\uE001M(\d+)\uE002/g, (_, i: string) => {
    const item = math[Number(i)];
    if (!item) return '';
    if (!renderMath) return `<code>${escapeHtml(item.tex)}</code>`;
    const r = renderMath(item.tex, item.display);
    if (r.error) return `<code class="md-math-error" title="${escapeHtml(r.error)}">${escapeHtml(item.tex)}</code>`;
    const lower = !item.display && r.depth ? ` style="vertical-align:-${r.depth}px"` : '';
    const img = `<img class="md-math${item.display ? ' md-math-block' : ''}" alt="${escapeHtml(item.tex)}"${lower} src="${svgDataUrl(r.svg)}">`;
    return item.display ? `<span class="md-math-display">${img}</span>` : img;
  });
}

export interface Heading {
  readonly depth: number;
  readonly text: string;
  readonly line: number;
}

/** Headings with their line numbers, for an outline. */
export function outline(md: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  md.split('\n').forEach((line, i) => {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ depth: (m[1] as string).length, text: (m[2] as string).replace(/[*_`]/g, ''), line: i + 1 });
  });
  return out;
}

export function documentTitle(md: string): string {
  return outline(md)[0]?.text ?? 'Document';
}

export const DOCUMENT_CSS = `
body { margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.5rem; font: 16px/1.65 system-ui, "Segoe UI", "Noto Sans", "Noto Sans Devanagari", sans-serif; color: #1f2328; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.25em; }
a { color: #0969da; }
code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.9em; background: #f6f8fa; padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d1d9e0; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #d1d9e0; padding: 6px 12px; }
th { background: #f6f8fa; }
img { max-width: 100%; }
img.md-math { vertical-align: middle; max-width: none; }
.md-math-display { display: block; text-align: center; margin: 1em 0; }
hr { border: 0; border-top: 1px solid #d1d9e0; margin: 2em 0; }
li > input[type="checkbox"] { margin-right: 0.4em; }
@media print { body { max-width: none; padding: 0; } pre, blockquote, table, img { break-inside: avoid; } }
`;

/** A complete HTML page that opens anywhere with no other files. */
export function standaloneHtml(title: string, body: string, lang = 'en'): string {
  return `<!DOCTYPE html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${DOCUMENT_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/* ------------------------------------------------------------------ EPUB -- */

const xhtmlFix = (html: string) =>
  html
    .replace(/<(img|br|hr|input|col)([^>]*?)\s*\/?>/g, '<$1$2 />')
    .replace(/&nbsp;/g, '&#160;')
    .replace(/<input([^>]*?)checked=""([^>]*?)\/>/g, '<input$1checked="checked"$2/>')
    .replace(/<input([^>]*?)disabled=""([^>]*?)\/>/g, '<input$1disabled="disabled"$2/>');

/** EPUB 3 with one chapter per top-level heading; embedded pictures and maths are stored as files. */
export function toEpub(md: string, renderMath?: MathRenderer, meta: { title?: string; author?: string; lang?: string } = {}): Uint8Array {
  const title = meta.title || documentTitle(md);
  const lang = meta.lang || 'en';
  // Split before each level-1 heading (outside code fences).
  const chapters: string[] = [];
  let current: string[] = [];
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^#\s/.test(line) && current.some((l) => l.trim())) {
      chapters.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  chapters.push(current.join('\n'));
  const images = new Map<string, { name: string; mime: string; data: Uint8Array }>();
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n',
    ),
  };
  const nav: { file: string; title: string }[] = [];
  chapters.forEach((chapter, i) => {
    let html = xhtmlFix(renderMarkdown(chapter, renderMath));
    // Data URLs become files in the package.
    html = html.replace(/src="data:(image\/[\w.+-]+);base64,([^"]+)"/g, (_, mime: string, b64: string) => {
      const key = `${mime}:${b64.length}:${b64.slice(0, 64)}`;
      let image = images.get(key);
      if (!image) {
        const ext = mime === 'image/svg+xml' ? 'svg' : (mime.split('/')[1] ?? 'bin').replace('jpeg', 'jpg');
        image = { name: `images/image${images.size + 1}.${ext}`, mime, data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) };
        images.set(key, image);
      }
      return `src="${image.name}"`;
    });
    const file = `chapter${i + 1}.xhtml`;
    const chapterTitle = documentTitle(chapter) || `Chapter ${i + 1}`;
    nav.push({ file, title: chapterTitle });
    files[`OEBPS/${file}`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">\n<head><meta charset="utf-8" /><title>${escapeHtml(chapterTitle)}</title><link rel="stylesheet" type="text/css" href="style.css" /></head>\n<body>\n${html}\n</body>\n</html>\n`,
    );
  });
  for (const image of images.values()) files[`OEBPS/${image.name}`] = image.data;
  files['OEBPS/style.css'] = strToU8(DOCUMENT_CSS.replace(/max-width: 46rem; padding: 2.5rem 1.5rem;/, ''));
  files['OEBPS/nav.xhtml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">\n<head><meta charset="utf-8" /><title>Contents</title></head>\n<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${nav.map((n) => `<li><a href="${n.file}">${escapeHtml(n.title)}</a></li>`).join('')}</ol></nav></body>\n</html>\n`,
  );
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  files['OEBPS/content.opf'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${escapeHtml(title)}</dc:title><dc:language>${lang}</dc:language>${meta.author ? `<dc:creator>${escapeHtml(meta.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta></metadata>\n<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${nav.map((n, i) => `<item id="c${i + 1}" href="${n.file}" media-type="application/xhtml+xml"/>`).join('')}${[...images.values()].map((im, i) => `<item id="img${i + 1}" href="${im.name}" media-type="${im.mime}"/>`).join('')}</manifest>\n<spine>${nav.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine>\n</package>\n`,
  );
  return zipSync(files as Parameters<typeof zipSync>[0]);
}

/* ------------------------------------------------------------------ DOCX -- */

export interface DocxImage {
  readonly data: Uint8Array;
  readonly type: 'png' | 'jpg' | 'gif' | 'bmp';
  readonly width: number;
  readonly height: number;
}

/** Turns a data URL (and maths SVG) into a raster picture Word can show; supplied by the caller (it needs a canvas). */
export type ImageLoader = (src: string) => Promise<DocxImage | null>;

/** Word document from Markdown: headings, paragraphs, lists, tables, code, quotes, links and pictures. */
export async function toDocx(md: string, loadImage: ImageLoader, renderMath?: MathRenderer, meta: { title?: string } = {}): Promise<Uint8Array> {
  const d = await import('docx');
  const { text, math } = extractMath(md);
  const tokens = marked.lexer(text, { gfm: true });
  const mathSrc = (i: number) => {
    const item = math[i];
    if (!item || !renderMath) return null;
    const r = renderMath(item.tex, item.display);
    return r.error ? null : svgDataUrl(r.svg);
  };

  type Run = InstanceType<typeof d.TextRun> | InstanceType<typeof d.ImageRun> | InstanceType<typeof d.ExternalHyperlink>;
  const inline = async (list: readonly Token[] | undefined, style: { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean } = {}): Promise<Run[]> => {
    const runs: Run[] = [];
    for (const t of list ?? []) {
      switch (t.type) {
        case 'strong':
          runs.push(...(await inline((t as Tokens.Strong).tokens, { ...style, bold: true })));
          break;
        case 'em':
          runs.push(...(await inline((t as Tokens.Em).tokens, { ...style, italics: true })));
          break;
        case 'del':
          runs.push(...(await inline((t as Tokens.Del).tokens, { ...style, strike: true })));
          break;
        case 'codespan':
          runs.push(new d.TextRun({ text: decode((t as Tokens.Codespan).text), font: 'Consolas', bold: style.bold, italics: style.italics }));
          break;
        case 'br':
          runs.push(new d.TextRun({ text: '', break: 1 }));
          break;
        case 'link': {
          const link = t as Tokens.Link;
          runs.push(new d.ExternalHyperlink({ link: link.href, children: [new d.TextRun({ text: decode(link.text), style: 'Hyperlink' })] }));
          break;
        }
        case 'image': {
          const img = await loadImage((t as Tokens.Image).href);
          if (img) runs.push(imageRun(d, img, 600));
          else runs.push(new d.TextRun({ text: `[${(t as Tokens.Image).text}]`, italics: true }));
          break;
        }
        case 'text':
        case 'escape': {
          const raw = (t as Tokens.Text).text;
          if ((t as Tokens.Text).tokens?.length) {
            runs.push(...(await inline((t as Tokens.Text).tokens, style)));
            break;
          }
          // Maths placeholders inside text become pictures.
          for (const part of raw.split(/(\uE001M\d+\uE002)/)) {
            const m = /^\uE001M(\d+)\uE002$/.exec(part);
            if (m) {
              const src = mathSrc(Number(m[1]));
              const img = src ? await loadImage(src) : null;
              if (img) runs.push(imageRun(d, img, 600));
              else runs.push(new d.TextRun({ text: math[Number(m[1])]?.tex ?? '', font: 'Cambria Math' }));
            } else if (part) runs.push(new d.TextRun({ text: decode(part), bold: style.bold, italics: style.italics, strike: style.strike }));
          }
          break;
        }
        default:
          if ('text' in t && typeof t.text === 'string') runs.push(new d.TextRun({ text: decode(t.text), bold: style.bold, italics: style.italics }));
      }
    }
    return runs;
  };

  const blocks: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [];
  const HEADINGS = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  const listItems = async (list: Tokens.List, level: number) => {
    for (const item of list.items) {
      const first = item.tokens.find((x) => x.type === 'text' || x.type === 'paragraph') as Tokens.Text | Tokens.Paragraph | undefined;
      const prefix = item.task ? (item.checked ? '☑ ' : '☐ ') : '';
      const children = [...(prefix ? [new d.TextRun(prefix)] : []), ...(await inline(first?.tokens ?? (first ? [{ type: 'text', raw: first.text, text: first.text } as Tokens.Text] : [])))];
      blocks.push(new d.Paragraph(list.ordered ? { children, numbering: { reference: 'numbers', level } } : { children, bullet: { level } }));
      for (const sub of item.tokens) if (sub.type === 'list') await listItems(sub as Tokens.List, Math.min(level + 1, 8));
    }
  };
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        blocks.push(new d.Paragraph({ heading: HEADINGS[(t as Tokens.Heading).depth - 1], children: await inline((t as Tokens.Heading).tokens) }));
        break;
      case 'paragraph': {
        const p = t as Tokens.Paragraph;
        const lone = /^\uE001M(\d+)\uE002$/.exec(p.text.trim());
        blocks.push(new d.Paragraph({ children: await inline(p.tokens), alignment: lone ? d.AlignmentType.CENTER : undefined }));
        break;
      }
      case 'list':
        await listItems(t as Tokens.List, 0);
        break;
      case 'code':
        for (const line of (t as Tokens.Code).text.split('\n'))
          blocks.push(
            new d.Paragraph({
              children: [new d.TextRun({ text: line || ' ', font: 'Consolas', size: 19 })],
              shading: { type: d.ShadingType.CLEAR, fill: 'F6F8FA', color: 'auto' },
              spacing: { after: 0 },
            }),
          );
        blocks.push(new d.Paragraph({ children: [] }));
        break;
      case 'blockquote':
        for (const inner of (t as Tokens.Blockquote).tokens)
          if ('tokens' in inner)
            blocks.push(
              new d.Paragraph({
                children: await inline((inner as Tokens.Paragraph).tokens, { italics: true }),
                indent: { left: 720 },
                border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: 'D1D9E0', space: 8 } },
              }),
            );
        break;
      case 'table': {
        const tbl = t as Tokens.Table;
        const row = async (cells: Tokens.TableCell[], header: boolean) =>
          new d.TableRow({
            tableHeader: header,
            children: await Promise.all(
              cells.map(
                async (c) =>
                  new d.TableCell({
                    children: [new d.Paragraph({ children: await inline(c.tokens, header ? { bold: true } : {}) })],
                    shading: header ? { type: d.ShadingType.CLEAR, fill: 'F6F8FA', color: 'auto' } : undefined,
                  }),
              ),
            ),
          });
        blocks.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: [await row(tbl.header, true), ...(await Promise.all(tbl.rows.map((r) => row(r, false))))] }));
        blocks.push(new d.Paragraph({ children: [] }));
        break;
      }
      case 'hr':
        blocks.push(new d.Paragraph({ children: [], border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'D1D9E0', space: 1 } } }));
        break;
      case 'space':
        break;
      default:
        if ('text' in t && typeof t.text === 'string' && t.text.trim()) blocks.push(new d.Paragraph({ children: [new d.TextRun(decode(t.text))] }));
    }
  }
  const doc = new d.Document({
    title: meta.title || documentTitle(md),
    creator: 'Benchtop',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'numbers',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: d.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: d.AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: blocks.length ? blocks : [new d.Paragraph('')] }],
  });
  return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer());
}

function imageRun(d: typeof import('docx'), img: DocxImage, maxWidth: number) {
  const scale = Math.min(1, maxWidth / img.width);
  return new d.ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) } });
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
