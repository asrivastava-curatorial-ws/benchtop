/**
 * Entity–relationship diagrams from SQL: reads CREATE TABLE statements
 * (PostgreSQL, MySQL, SQLite and SQL Server styles) and writes a Mermaid
 * erDiagram with columns, primary and foreign keys and the relationships.
 */

export interface Column {
  readonly name: string;
  readonly type: string;
  readonly primary: boolean;
  readonly unique: boolean;
  readonly nullable: boolean;
  readonly references?: { readonly table: string; readonly column: string };
}

export interface Table {
  readonly name: string;
  columns: Column[];
}

const unquote = (name: string): string => name.trim().replace(/^[`"[]|[`"\]]$/g, '');

/** The last part of a qualified name (schema.table → table). */
const bare = (name: string): string => unquote(name.split('.').pop() ?? name);

/** Splits on commas that are not inside parentheses or quotes. */
function splitTop(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const list = (text: string): string[] => text.split(',').map((c) => bare(c));

export function parseTables(sql: string): Table[] {
  const cleaned = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const tables: Table[] = [];
  const pattern = /create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([`"[\]\w.]+)\s*\(/gi;
  for (let match = pattern.exec(cleaned); match; match = pattern.exec(cleaned)) {
    // Find the matching closing parenthesis.
    let depth = 1;
    let i = pattern.lastIndex;
    for (; i < cleaned.length && depth > 0; i++) {
      if (cleaned[i] === '(') depth++;
      else if (cleaned[i] === ')') depth--;
    }
    const body = cleaned.slice(pattern.lastIndex, i - 1);
    const table: Table = { name: bare(match[1] as string), columns: [] };
    const primaries = new Set<string>();
    const uniques = new Set<string>();
    const foreign: { columns: string[]; table: string; targets: string[] }[] = [];
    for (const part of splitTop(body)) {
      const lower = part.toLowerCase();
      const constraint = lower.replace(/^constraint\s+\S+\s+/, '');
      if (constraint.startsWith('primary key')) {
        for (const c of list(/\(([^)]*)\)/.exec(part)?.[1] ?? '')) primaries.add(c.toLowerCase());
      } else if (constraint.startsWith('foreign key')) {
        const m = /foreign\s+key\s*\(([^)]*)\)\s*references\s+([`"[\]\w.]+)\s*(?:\(([^)]*)\))?/i.exec(part);
        if (m) foreign.push({ columns: list(m[1] as string), table: bare(m[2] as string), targets: m[3] ? list(m[3]) : [] });
      } else if (constraint.startsWith('unique')) {
        const cols = list(/\(([^)]*)\)/.exec(part)?.[1] ?? '');
        if (cols.length === 1) uniques.add((cols[0] as string).toLowerCase());
      } else if (/^(check|index|key|fulltext|spatial|exclude)\b/.test(constraint)) {
        // Not shown in the diagram.
      } else {
        const m = /^([`"[][^`"\]]+[`"\]]|\S+)\s+(.*)$/s.exec(part);
        if (!m) continue;
        const name = unquote(m[1] as string);
        const rest = m[2] as string;
        const type = (
          /^([A-Za-z_][\w ]*?(?:\([^)]*\))?(?:\[\])?)(?=\s+(?:not|null|primary|unique|references|default|check|constraint|generated|auto_increment|identity|collate)\b|\s*$)/i.exec(rest)?.[1] ??
          rest.split(/\s+/)[0] ??
          ''
        ).trim();
        const ref = /references\s+([`"[\]\w.]+)\s*(?:\(([^)]*)\))?/i.exec(rest);
        table.columns.push({
          name,
          type,
          primary: /primary\s+key/i.test(rest),
          unique: /\bunique\b/i.test(rest),
          nullable: !/not\s+null/i.test(rest) && !/primary\s+key/i.test(rest),
          references: ref ? { table: bare(ref[1] as string), column: ref[2] ? bare(ref[2]) : '' } : undefined,
        });
      }
    }
    table.columns = table.columns.map((c) => {
      const key = c.name.toLowerCase();
      const fk = foreign.find((f) => f.columns.some((col) => col.toLowerCase() === key));
      const index = fk?.columns.findIndex((col) => col.toLowerCase() === key) ?? -1;
      return {
        ...c,
        primary: c.primary || primaries.has(key),
        unique: c.unique || uniques.has(key),
        nullable: c.nullable && !primaries.has(key),
        references: c.references ?? (fk ? { table: fk.table, column: fk.targets[index] ?? '' } : undefined),
      };
    });
    tables.push(table);
  }
  return tables;
}

/** Mermaid identifiers: letters, digits, underscores and hyphens. */
const ident = (name: string): string => name.replace(/[^\w-]/g, '_') || '_';

/** A Mermaid type token: no spaces or brackets (varchar(255) → varchar_255). */
const typeToken = (type: string): string =>
  (
    type
      .replace(/[()[\],\s]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/_+$/, '') || 'column'
  ).replace(/^(\d)/, '_$1');

export function toMermaid(tables: readonly Table[]): string {
  const lines = ['erDiagram'];
  for (const table of tables) {
    lines.push(`  ${ident(table.name)} {`);
    for (const c of table.columns) {
      const keys = [c.primary ? 'PK' : '', c.references ? 'FK' : '', c.unique && !c.primary ? 'UK' : ''].filter(Boolean).join(', ');
      lines.push(`    ${typeToken(c.type)} ${ident(c.name)}${keys ? ` ${keys}` : ''}`);
    }
    lines.push('  }');
  }
  const known = new Set(tables.map((t) => t.name.toLowerCase()));
  for (const table of tables)
    for (const c of table.columns) {
      if (!c.references || !known.has(c.references.table.toLowerCase())) continue;
      // Child to parent: many (or one, when unique) to exactly one (or zero-or-one, when nullable).
      const child = c.unique || c.primary ? '|o' : '}o';
      const parent = c.nullable ? 'o|' : '||';
      lines.push(`  ${ident(table.name)} ${child}--${parent} ${ident(c.references.table)} : "${c.name.replace(/"/g, "'")}"`);
    }
  return lines.join('\n');
}
