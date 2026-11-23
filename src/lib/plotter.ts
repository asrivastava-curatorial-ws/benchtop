/**
 * The Arduino Serial Plotter format: each line holds numbers separated by
 * spaces, tabs or commas, optionally as "label:value" pairs; a line of words
 * names the columns.  PlotBuffer keeps the latest rows for drawing.
 */

export interface Sample {
  /** The label, or null for a bare number (named by its column). */
  readonly name: string | null;
  readonly value: number;
}

export type PlotLine = { readonly labels: string[] } | { readonly samples: Sample[] };

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

export function parsePlotLine(line: string): PlotLine | null {
  const text = line.trim().replace(/:\s+/g, ':');
  if (text === '') return null;
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const samples: Sample[] = [];
  const words: string[] = [];
  for (const token of tokens) {
    const colon = token.lastIndexOf(':');
    if (colon > 0 && NUMBER.test(token.slice(colon + 1))) samples.push({ name: token.slice(0, colon), value: Number(token.slice(colon + 1)) });
    else if (NUMBER.test(token)) samples.push({ name: null, value: Number(token) });
    else words.push(token.replace(/:$/, ''));
  }
  if (samples.length) return { samples };
  return words.length ? { labels: words } : null;
}

export interface Series {
  readonly name: string;
  readonly values: readonly number[];
}

export class PlotBuffer {
  private names: string[] = [];
  private readonly order: string[] = [];
  private readonly data = new Map<string, number[]>();
  private times: number[] = [];
  private partial = '';
  private readonly decoder = new TextDecoder();
  /** Rows received in all, including those dropped from the window. */
  total = 0;

  constructor(public capacity = 2000) {}

  /** Feeds raw bytes from the port; complete lines are parsed. */
  feed(bytes: Uint8Array, at = Date.now()): number {
    this.partial += this.decoder.decode(bytes, { stream: true });
    const lines = this.partial.split(/\r?\n|\r/);
    this.partial = lines.pop() ?? '';
    // A device that never ends its lines would grow the buffer without limit.
    if (this.partial.length > 4096) this.partial = '';
    let added = 0;
    for (const line of lines) if (this.line(line, at)) added++;
    return added;
  }

  /** Adds one line; returns true when it held values. */
  line(text: string, at = Date.now()): boolean {
    const parsed = parsePlotLine(text);
    if (!parsed) return false;
    if ('labels' in parsed) {
      this.names = parsed.labels;
      return false;
    }
    const row = new Map<string, number>();
    let column = 0;
    for (const s of parsed.samples) {
      const name = s.name ?? this.names[column] ?? `Value ${column + 1}`;
      column++;
      row.set(name, s.value);
    }
    for (const name of row.keys()) {
      if (!this.data.has(name)) {
        this.order.push(name);
        this.data.set(
          name,
          Array.from({ length: this.times.length }, () => Number.NaN),
        );
      }
    }
    for (const name of this.order) (this.data.get(name) as number[]).push(row.get(name) ?? Number.NaN);
    this.times.push(at);
    this.total++;
    const extra = this.times.length - this.capacity;
    if (extra > 0) {
      this.times = this.times.slice(extra);
      for (const name of this.order) this.data.set(name, (this.data.get(name) as number[]).slice(extra));
    }
    return true;
  }

  series(): Series[] {
    return this.order.map((name) => ({ name, values: this.data.get(name) as number[] }));
  }

  get length(): number {
    return this.times.length;
  }

  latest(name: string): number | null {
    const values = this.data.get(name);
    if (!values) return null;
    for (let i = values.length - 1; i >= 0; i--) if (Number.isFinite(values[i])) return values[i] as number;
    return null;
  }

  clear(): void {
    this.order.length = 0;
    this.data.clear();
    this.times = [];
    this.total = 0;
  }

  /** The rows as CSV, with the time each arrived. */
  csv(): string {
    const header = ['time', ...this.order].map((h) => (/[",\n]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(',');
    const rows = this.times.map((t, i) =>
      [new Date(t).toISOString(), ...this.order.map((name) => (this.data.get(name) as number[])[i])].map((v) => (typeof v === 'number' && !Number.isFinite(v) ? '' : String(v))).join(','),
    );
    return `${[header, ...rows].join('\n')}\n`;
  }
}
