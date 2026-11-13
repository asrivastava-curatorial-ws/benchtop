/** Renders the visual result of a text tool: an image, sanitised HTML or a diff. */
import { useMemo } from 'preact/hooks';
import { readSvg, svgIntrinsicSize } from '../lib/xml-scan';
import { saveFile } from '../platform';
import type { DiffRow, Preview as PreviewData } from '../tools/types';
import { encodeCanvas, rasterizeSvg } from './canvas';
import { useObjectUrl } from './hooks';
import { Icon } from './icons';
import { sanitizeHtml } from './sanitize';
import { attempt, notify } from './toast';

const MAX_DIFF_ROWS = 4000;

function highlight(text: string, spans: DiffRow['spans']) {
  if (!spans || spans.length === 0) return text;
  const parts: (string | preact.JSX.Element)[] = [];
  let cursor = 0;
  spans.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={index}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function DiffView({ rows }: { rows: readonly DiffRow[] }) {
  const shown = rows.length > MAX_DIFF_ROWS ? rows.slice(0, MAX_DIFF_ROWS) : rows;
  return (
    <div class="diff" data-testid="diff">
      <table>
        <tbody>
          {shown.map((row, index) => (
            <tr key={index} class={`diff-${row.type}`}>
              <td class="diff-number">{row.left ?? ''}</td>
              <td class="diff-number">{row.right ?? ''}</td>
              <td class="diff-sign" aria-hidden="true">
                {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ''}
              </td>
              <td class="diff-text">
                <span class="visually-hidden">{row.type === 'add' ? 'Added: ' : row.type === 'del' ? 'Removed: ' : ''}</span>
                {highlight(row.text, row.spans)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && <p class="diff-more">{rows.length - shown.length} more lines are not shown. The patch contains everything.</p>}
    </div>
  );
}

function SvgPreview({ svg, checker, name }: { svg: string; checker: boolean; name: string }) {
  const url = useObjectUrl(svg, 'image/svg+xml');
  const savePng = (scale: number) =>
    attempt(async () => {
      const size = svgIntrinsicSize(readSvg(svg));
      const canvas = await rasterizeSvg(svg, size.width * scale, size.height * scale);
      const outcome = await saveFile(`${name.replace(/\.svg$/i, '')}${scale === 1 ? '' : `@${scale}x`}.png`, await encodeCanvas(canvas, { format: 'png', quality: 100 }), 'image/png');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });
  return (
    <div class="preview-image">
      <div class={`preview-stage${checker ? ' checker' : ''}`}>{url && <img src={url} alt="Preview" data-testid="preview-image" />}</div>
      <div class="preview-actions">
        <button type="button" class="button button-small" onClick={() => savePng(1)}>
          <Icon name="save" size={14} /> Save PNG
        </button>
        <button type="button" class="button button-small" onClick={() => savePng(2)}>
          PNG 2×
        </button>
        <button type="button" class="button button-small" onClick={() => savePng(4)}>
          PNG 4×
        </button>
      </div>
    </div>
  );
}

function ImagePreview({ bytes, mime }: { bytes: Uint8Array; mime: string }) {
  const url = useObjectUrl(bytes, mime);
  return (
    <div class="preview-image">
      <div class="preview-stage checker">{url && <img src={url} alt="Preview" data-testid="preview-image" />}</div>
    </div>
  );
}

function HtmlPreview({ html }: { html: string }) {
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  return <div class="preview-html prose" data-testid="preview-html" dangerouslySetInnerHTML={{ __html: safe }} />;
}

export function PreviewView({ preview, name }: { preview: PreviewData; name: string }) {
  switch (preview.kind) {
    case 'svg':
      return <SvgPreview svg={preview.svg} checker={preview.checker === true} name={name} />;
    case 'image':
      return <ImagePreview bytes={preview.bytes} mime={preview.mime} />;
    case 'html':
      return <HtmlPreview html={preview.html} />;
    case 'diff':
      return <DiffView rows={preview.rows} />;
  }
}
