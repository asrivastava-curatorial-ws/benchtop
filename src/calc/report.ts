/**
 * Keeping and sharing calculations from the calculator library: the values
 * as a link (Base64url JSON in the address), and a one-page PDF report.
 */
import type { PDFFont, PDFPage } from 'pdf-lib';
import { fromBase64, toBase64 } from '../lib/bytes';

/** What the user set in a calculator: typed text, chosen units and choices. */
export interface SavedState {
  readonly typed: Readonly<Record<string, string>>;
  readonly units: Readonly<Record<string, string>>;
  readonly choices: Readonly<Record<string, number>>;
}

/** One line of a result: a value the user typed, or one the calculator worked out. */
export interface CalcRow {
  readonly label: string;
  readonly value: string;
  readonly typed: boolean;
}

const isStringMap = (value: unknown): value is Record<string, string> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string');
const isNumberMap = (value: unknown): value is Record<string, number> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'number' && Number.isInteger(v));

export function encodeState(state: SavedState): string {
  const json = JSON.stringify({ t: state.typed, u: state.units, c: state.choices });
  return toBase64(new TextEncoder().encode(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The state in a shared link, or null when the text is not one (or was edited into nonsense). */
export function decodeState(text: string): SavedState | null {
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(text.replace(/-/g, '+').replace(/_/g, '/')));
    const data = JSON.parse(json) as { t?: unknown; u?: unknown; c?: unknown };
    const typed = data.t ?? {};
    const units = data.u ?? {};
    const choices = data.c ?? {};
    if (!isStringMap(typed) || !isStringMap(units) || !isNumberMap(choices)) return null;
    // Values are short numbers; anything long is not a calculator's input.
    if (Object.values(typed).some((v) => v.length > 64)) return null;
    return { typed, units, choices };
  } catch {
    return null;
  }
}

/** A short line for the history list: the results, then what they came from. */
export function summarise(rows: readonly CalcRow[], limit = 180): string {
  const results = rows.filter((r) => !r.typed).map((r) => `${r.label} ${r.value}`);
  const inputs = rows.filter((r) => r.typed).map((r) => `${r.label} ${r.value}`);
  const text = results.length ? `${results.join(', ')}${inputs.length ? ` (from ${inputs.join(', ')})` : ''}` : inputs.join(', ');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function wrap(text: string, font: PDFFont, size: number, width: number, measure: (font: PDFFont, text: string, size: number) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(font, next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** A one-page A4 report: title, what the calculator does, the values, the formula and notes. */
export async function calcPdf(report: { title: string; description: string; rows: readonly CalcRow[]; formula: readonly string[]; notes?: string; when: Date }): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const { drawText, finishFonts, fontsFor, textWidth } = await import('../lib/pdf-text');
  const doc = await PDFDocument.create();
  doc.setTitle(report.title);
  doc.setCreator('Benchtop');
  doc.setProducer('Benchtop');
  doc.setCreationDate(report.when);
  const footer = `Calculated with Benchtop on ${report.when.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}. Check important results independently.`;
  const texts = [report.title, report.description, ...report.rows.flatMap((r) => [r.label, r.value]), ...report.formula, report.notes ?? '', footer, 'Entered', 'Calculated'];
  const { regular, bold } = await fontsFor(doc, texts);
  const ink = rgb(0.1, 0.13, 0.16);
  const muted = rgb(0.37, 0.42, 0.47);
  const rule = rgb(0.83, 0.86, 0.89);
  const accent = rgb(0.09, 0.41, 0.31);
  const [width, height] = [595.28, 841.89];
  const margin = 56;
  const inner = width - margin * 2;
  let page: PDFPage = doc.addPage([width, height]);
  let y = height - margin;
  const room = (needed: number) => {
    if (y - needed >= margin + 30) return;
    page = doc.addPage([width, height]);
    y = height - margin;
  };
  const write = (text: string, font: PDFFont, size: number, colour = ink, gap = 1.35) => {
    for (const line of wrap(text, font, size, inner, textWidth)) {
      room(size * gap);
      y -= size * gap;
      drawText(page, font, line, { x: margin, y, size, color: colour });
    }
  };

  write(report.title, bold, 20, ink, 1.2);
  y -= 4;
  write(report.description, regular, 10.5, muted);
  y -= 18;
  // The Entered and Calculated tags line up in one column, left of the widest value.
  const valueWidth = Math.min(inner * 0.55, Math.max(0, ...report.rows.map((row) => textWidth(bold, row.value, 12))));
  const tagRight = width - margin - valueWidth - 14;
  for (const row of report.rows) {
    const labelLines = wrap(row.label, regular, 11, tagRight - margin - 70, textWidth);
    const rowHeight = Math.max(1, labelLines.length) * 15 + 10;
    room(rowHeight);
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.6, color: rule });
    let lineY = y - 16;
    for (const line of labelLines) {
      drawText(page, regular, line, { x: margin, y: lineY, size: 11, color: ink });
      lineY -= 15;
    }
    const tag = row.typed ? 'Entered' : 'Calculated';
    drawText(page, regular, tag, { x: tagRight - textWidth(regular, tag, 8.5), y: y - 15.5, size: 8.5, color: row.typed ? muted : accent });
    drawText(page, bold, row.value, { x: width - margin - textWidth(bold, row.value, 12), y: y - 16, size: 12, color: ink });
    y -= rowHeight;
  }
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.6, color: rule });
  if (report.formula.length) {
    y -= 22;
    write('Formula', bold, 11);
    for (const line of report.formula) write(line, regular, 9.5, muted, 1.45);
  }
  if (report.notes) {
    y -= 12;
    write(report.notes, regular, 9.5, muted);
  }
  for (const each of doc.getPages()) {
    drawText(each, regular, footer, { x: margin, y: margin - 10, size: 8, color: muted });
  }
  await finishFonts(doc);
  return doc.save();
}
