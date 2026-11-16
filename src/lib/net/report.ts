/**
 * Small HTML builders for the reports the online checks show in their preview.
 * Every value is escaped; the preview is sanitised again before display.
 */
/** Tones a result field can take. */
export type FieldTone = 'ok' | 'warn' | 'bad' | 'muted';
export type Tone = FieldTone | 'info';

export const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

export const pill = (text: string, tone: Tone): string => `<span class="pill pill-${tone}">${esc(text)}</span>`;

export const mono = (text: string): string => `<code>${esc(text)}</code>`;

/** A cell may be plain text (escaped) or `{ html }` that was built with these helpers. */
export type Cell = string | number | { readonly html: string } | null | undefined;

const cell = (value: Cell): string => (value === null || value === undefined ? '' : typeof value === 'object' ? value.html : esc(value));

export const html = (value: string): { readonly html: string } => ({ html: value });

export function table(headers: readonly string[], rows: readonly (readonly Cell[])[], options: { readonly numeric?: readonly number[]; readonly className?: string } = {}): string {
  const numeric = new Set(options.numeric ?? []);
  const head = headers.map((title, index) => `<th${numeric.has(index) ? ' class="num"' : ''}>${esc(title)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((value, index) => `<td${numeric.has(index) ? ' class="num"' : ''}>${cell(value)}</td>`).join('')}</tr>`).join('');
  return `<div class="report-scroll"><table class="report-table${options.className ? ` ${options.className}` : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Two-column label/value list. */
export function pairs(rows: readonly (readonly [string, Cell])[]): string {
  return `<table class="report-pairs"><tbody>${rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${cell(value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

export const heading = (text: string): string => `<h3>${esc(text)}</h3>`;

export const note = (text: string, tone: Tone = 'muted'): string => `<p class="report-note tone-${tone}">${esc(text)}</p>`;

export const report = (...parts: readonly string[]): string => `<div class="report">${parts.filter((part) => part !== '').join('')}</div>`;

/** "in 41 days", "today", "3 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export const daysUntil = (date: Date, now = Date.now()): number => Math.floor((date.getTime() - now) / 86_400_000);

/** Tone for something that expires: red when past or within a week, amber within `warnDays`. */
export const expiryTone = (days: number, warnDays = 30): FieldTone => (days < 7 ? 'bad' : days < warnDays ? 'warn' : 'ok');

/** "2026-03-14 09:30 UTC". */
export const formatDate = (date: Date): string => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export const formatDay = (date: Date): string => date.toISOString().slice(0, 10);

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
