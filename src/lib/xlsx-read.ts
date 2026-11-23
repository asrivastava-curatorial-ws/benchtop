/**
 * Excel workbooks (.xlsx, .xlsm) read as tables: one array of rows per sheet,
 * with numbers as numbers, TRUE/FALSE as booleans, and cells formatted as
 * dates as ISO dates.  Formulas give their last calculated value.
 */
import { unzipSync } from 'fflate';
import { utf8Decode } from './bytes';
import { ToolError } from './errors';

export type Cell = string | number | boolean | null;

export interface Sheet {
  readonly name: string;
  readonly rows: Cell[][];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (/^#x/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });

const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1] as string)).join('');

/** "AB" → 27 (0-based column index). */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Built-in number formats that show dates or times. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** An Excel serial date (1900 system) as an ISO date, or date and time. */
export function excelDate(serial: number, date1904 = false): string {
  const days = serial + (date1904 ? 1462 : 0);
  // Serial 60 is the fictitious 29 February 1900; Excel counts from 1899-12-30 after it.
  const ms = Math.round((days - 25569) * 86400000);
  const d = new Date(ms);
  const iso = d.toISOString();
  return Math.abs(days - Math.round(days)) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

const MAX_UNZIPPED = 300 * 1024 * 1024;

export function readXlsx(bytes: Uint8Array): Sheet[] {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_UNZIPPED) throw new ToolError('This workbook expands to more than 300 MB.');
        return /\.(xml|rels)$/i.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('This is not an Excel workbook (.xlsx files are ZIP archives).');
  }
  const part = (name: string) => (files[name] ? utf8Decode(files[name] as Uint8Array) : '');
  const workbook = part('xl/workbook.xml');
  if (!workbook) throw new ToolError('This is not an Excel workbook: xl/workbook.xml is missing.');
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);

  const shared: string[] = [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1] as string));

  // Which cell styles are dates.
  const styles = part('xl/styles.xml');
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decode(m[2] as string));
  const isDateFormat = (id: number) => {
    if (DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    if (!code) return false;
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return /[dmyhs]/i.test(bare) && !/^[#0.,%E+\- ]*$/.test(bare);
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].map((m) => isDateFormat(Number(/numFmtId="(\d+)"/.exec(m[1] as string)?.[1] ?? 0)));

  // Sheet names and their parts, through the workbook's relationships.
  const rels = new Map<string, string>();
  for (const m of part('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1] as string)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1] as string)?.[1];
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }
  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1] as string;
    const name = decode(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? `Sheet${sheets.length + 1}`);
    const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const path = rels.get(rid) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = part(path);
    if (!xml) continue;
    const rows: Cell[][] = [];
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const rowNumber = Number(/\br="(\d+)"/.exec(row[1] ?? row[3] ?? '')?.[1] ?? rows.length + 1) - 1;
      while (rows.length < rowNumber) rows.push([]);
      const cells: Cell[] = [];
      for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cell[1] as string;
        const content = cell[2] ?? '';
        const ref = /\br="([A-Z]+)\d+"/.exec(a)?.[1];
        const type = /\bt="(\w+)"/.exec(a)?.[1] ?? 'n';
        const style = Number(/\bs="(\d+)"/.exec(a)?.[1] ?? 0);
        const raw = /<v>([\s\S]*?)<\/v>/.exec(content)?.[1];
        let value: Cell = null;
        if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = textOf(content);
        else if (type === 'str') value = raw === undefined ? null : decode(raw);
        else if (type === 'b') value = raw === '1';
        else if (type === 'e') value = raw === undefined ? null : decode(raw);
        else if (raw !== undefined) {
          const n = Number(raw);
          value = Number.isFinite(n) ? (dateStyle[style] ? excelDate(n, date1904) : n) : decode(raw);
        }
        const column = ref ? columnIndex(ref) : cells.length;
        while (cells.length < column) cells.push(null);
        cells[column] = value;
      }
      rows[rowNumber] = cells;
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new ToolError('This workbook has no worksheets.');
  return sheets;
}
