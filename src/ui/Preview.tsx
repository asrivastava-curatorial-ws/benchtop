/** Renders the visual result of a text tool: an image, sanitised HTML or a diff. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { readSvg, svgIntrinsicSize } from '../lib/xml-scan';
import { saveFile } from '../platform';
import type { DiffRow, Preview as PreviewData } from '../tools/types';
import { scrollRegion } from './a11y';
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

interface ChangeBlock {
  readonly kind: 'change';
  readonly index: number;
  readonly rows: readonly DiffRow[];
}

interface SameBlock {
  readonly kind: 'same';
  readonly rows: readonly DiffRow[];
}

interface GapBlock {
  readonly kind: 'gap';
  readonly id: number;
  readonly rows: readonly DiffRow[];
}

type Block = ChangeBlock | SameBlock | GapBlock;

/** Groups rows into changes and unchanged runs; long unchanged runs keep `context` lines each side. */
function diffBlocks(rows: readonly DiffRow[], context: number | undefined): Block[] {
  const blocks: Block[] = [];
  let changes = 0;
  let gaps = 0;
  let index = 0;
  while (index < rows.length) {
    const start = index;
    const same = (rows[index] as DiffRow).type === 'same';
    while (index < rows.length && ((rows[index] as DiffRow).type === 'same') === same) index++;
    const run = rows.slice(start, index);
    if (!same) {
      blocks.push({ kind: 'change', index: changes++, rows: run });
      continue;
    }
    const keepBefore = start === 0 ? 0 : (context ?? run.length);
    const keepAfter = index === rows.length ? 0 : (context ?? run.length);
    if (context === undefined || run.length <= keepBefore + keepAfter + 2) {
      blocks.push({ kind: 'same', rows: run });
      continue;
    }
    if (keepBefore > 0) blocks.push({ kind: 'same', rows: run.slice(0, keepBefore) });
    blocks.push({ kind: 'gap', id: gaps++, rows: run.slice(keepBefore, run.length - keepAfter) });
    if (keepAfter > 0) blocks.push({ kind: 'same', rows: run.slice(run.length - keepAfter) });
  }
  return blocks;
}

const sign = (row: DiffRow) => (row.type === 'add' ? '+' : row.type === 'del' ? '\u2212' : '');

function UnifiedRow({ row, current, anchor }: { row: DiffRow; current?: boolean; anchor?: number }) {
  return (
    <tr class={`diff-${row.type}${current ? ' is-current' : ''}`} data-change={anchor}>
      <td class="diff-number">{row.left ?? ''}</td>
      <td class="diff-number">{row.right ?? ''}</td>
      <td class="diff-sign" aria-hidden="true">
        {sign(row)}
      </td>
      <td class="diff-text">
        <span class="visually-hidden">{row.type === 'add' ? 'Added: ' : row.type === 'del' ? 'Removed: ' : ''}</span>
        {highlight(row.text, row.spans)}
      </td>
    </tr>
  );
}

function SplitRow({ left, right, current, anchor }: { left?: DiffRow; right?: DiffRow; current?: boolean; anchor?: number }) {
  const side = (row: DiffRow | undefined, which: 'left' | 'right') =>
    row ? (
      <>
        <td class={`diff-number diff-${row.type}`}>{which === 'left' ? row.left : row.right}</td>
        <td class={`diff-text diff-${row.type}`}>
          <span class="visually-hidden">{row.type === 'add' ? 'Added: ' : row.type === 'del' ? 'Removed: ' : ''}</span>
          {highlight(row.text, row.spans)}
        </td>
      </>
    ) : (
      <>
        <td class="diff-number diff-empty" />
        <td class="diff-text diff-empty" />
      </>
    );
  return (
    <tr class={current ? 'is-current' : undefined} data-change={anchor}>
      {side(left, 'left')}
      {side(right, 'right')}
    </tr>
  );
}

function DiffView({ rows, layout = 'split', context, titles }: { rows: readonly DiffRow[]; layout?: 'split' | 'unified'; context?: number; titles?: readonly [string, string] }) {
  const limited = rows.length > MAX_DIFF_ROWS ? rows.slice(0, MAX_DIFF_ROWS) : rows;
  const blocks = useMemo(() => diffBlocks(limited, context), [limited, context]);
  const changeCount = blocks.filter((block) => block.kind === 'change').length;
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [current, setCurrent] = useState(-1);
  const table = useRef<HTMLTableElement>(null);
  useEffect(() => {
    setOpened(new Set());
    setCurrent(-1);
  }, [rows]);

  const go = (step: number) => {
    if (changeCount === 0) return;
    const next = current < 0 ? (step > 0 ? 0 : changeCount - 1) : (current + step + changeCount) % changeCount;
    setCurrent(next);
    requestAnimationFrame(() => table.current?.querySelector(`[data-change="${next}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const body: preact.JSX.Element[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    if (block.kind === 'gap' && !opened.has(block.id)) {
      body.push(
        <tr key={`gap${block.id}`} class="diff-gap">
          <td colSpan={4}>
            <button type="button" class="diff-expand" onClick={() => setOpened(new Set([...opened, block.id]))}>
              Show {block.rows.length} unchanged line{block.rows.length === 1 ? '' : 's'}
            </button>
          </td>
        </tr>,
      );
      continue;
    }
    const isCurrent = block.kind === 'change' && block.index === current;
    if (layout === 'unified') {
      for (const [offset, row] of block.rows.entries()) {
        body.push(<UnifiedRow key={`${blockIndex}:${offset}`} row={row} current={isCurrent} anchor={block.kind === 'change' && offset === 0 ? block.index : undefined} />);
      }
      continue;
    }
    if (block.kind !== 'change') {
      for (const [offset, row] of block.rows.entries()) body.push(<SplitRow key={`${blockIndex}:${offset}`} left={row} right={row} />);
      continue;
    }
    const removed = block.rows.filter((row) => row.type === 'del');
    const added = block.rows.filter((row) => row.type === 'add');
    for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
      body.push(<SplitRow key={`${blockIndex}:${offset}`} left={removed[offset]} right={added[offset]} current={isCurrent} anchor={offset === 0 ? block.index : undefined} />);
    }
  }

  return (
    <div class={`diff diff-${layout}`} data-testid="diff">
      <div class="diff-toolbar">
        <span class="diff-count" aria-live="polite">
          {changeCount === 0 ? 'No differences' : current < 0 ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : `Change ${current + 1} of ${changeCount}`}
        </span>
        <button type="button" class="icon-button" title="Previous change" aria-label="Previous change" disabled={changeCount === 0} onClick={() => go(-1)}>
          <Icon name="up" size={15} />
        </button>
        <button type="button" class="icon-button" title="Next change" aria-label="Next change" disabled={changeCount === 0} onClick={() => go(1)}>
          <Icon name="down" size={15} />
        </button>
      </div>
      <table ref={table}>
        {layout === 'split' && (
          <colgroup>
            <col class="diff-col-number" />
            <col />
            <col class="diff-col-number" />
            <col />
          </colgroup>
        )}
        {layout === 'split' && titles && (
          <thead>
            <tr>
              <th colSpan={2}>{titles[0]}</th>
              <th colSpan={2}>{titles[1]}</th>
            </tr>
          </thead>
        )}
        <tbody>{body}</tbody>
      </table>
      {rows.length > limited.length && <p class="diff-more">{rows.length - limited.length} more lines are not shown. The patch contains everything.</p>}
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
  const host = useRef<HTMLDivElement>(null);
  // Code blocks scroll sideways on their own, so each needs a keyboard stop too.
  useEffect(() => {
    for (const block of host.current?.querySelectorAll('pre') ?? []) block.tabIndex = 0;
  }, [safe]);
  return <div ref={host} class="preview-html prose" data-testid="preview-html" {...scrollRegion('Preview')} dangerouslySetInnerHTML={{ __html: safe }} />;
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
      return <DiffView rows={preview.rows} layout={preview.layout} context={preview.context} titles={preview.titles} />;
  }
}
