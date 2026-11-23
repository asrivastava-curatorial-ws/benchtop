import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool, type Lang } from '../types';

type Type = { kind: 'string' | 'int' | 'float' | 'bool' | 'any' | 'null' } | { kind: 'array'; item: Type } | { kind: 'object'; fields: Map<string, Field> };
interface Field {
  type: Type;
  optional: boolean;
  nullable: boolean;
}
interface Model {
  readonly name: string;
  readonly fields: [string, Field][];
}

function infer(value: unknown): Type {
  if (value === null) return { kind: 'null' };
  if (Array.isArray(value)) return { kind: 'array', item: value.map(infer).reduce<Type | null>((a, b) => (a ? merge(a, b) : b), null) ?? { kind: 'any' } };
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'boolean') return { kind: 'bool' };
  if (typeof value === 'number') return { kind: Number.isInteger(value) ? 'int' : 'float' };
  if (typeof value === 'object')
    return { kind: 'object', fields: new Map(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, { type: infer(item), optional: false, nullable: item === null }])) };
  return { kind: 'any' };
}

function merge(a: Type, b: Type): Type {
  if (a.kind === 'null') return b;
  if (b.kind === 'null') return a;
  if ((a.kind === 'int' && b.kind === 'float') || (a.kind === 'float' && b.kind === 'int')) return { kind: 'float' };
  if (a.kind === 'array' && b.kind === 'array') return { kind: 'array', item: merge(a.item, b.item) };
  if (a.kind === 'object' && b.kind === 'object') {
    const fields = new Map<string, Field>();
    for (const [key, field] of a.fields) {
      const other = b.fields.get(key);
      fields.set(
        key,
        other
          ? { type: merge(field.type, other.type), optional: field.optional || other.optional, nullable: field.nullable || other.nullable || field.type.kind === 'null' || other.type.kind === 'null' }
          : { ...field, optional: true },
      );
    }
    for (const [key, field] of b.fields) if (!a.fields.has(key)) fields.set(key, { ...field, optional: true });
    return { kind: 'object', fields };
  }
  return a.kind === b.kind ? a : { kind: 'any' };
}

const words = (text: string): string[] =>
  text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
export const pascal = (text: string): string =>
  words(text)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join('') || 'Field';
export const camel = (text: string): string => {
  const value = pascal(text);
  return value[0]?.toLowerCase() + value.slice(1);
};
export const snake = (text: string): string =>
  words(text)
    .map((word) => word.toLowerCase())
    .join('_') || 'field';
const singular = (text: string): string => (/ies$/i.test(text) ? text.replace(/ies$/i, 'y') : /(ss|us|is)$/i.test(text) ? text : text.replace(/s$/i, ''));

/** Flattens nested objects into named models, children before parents' first use. */
function collect(root: Type, rootName: string): { models: Model[]; names: Map<Type, string> } {
  const models: Model[] = [];
  const names = new Map<Type, string>();
  const used = new Set<string>();
  const visit = (type: Type, suggested: string) => {
    if (type.kind === 'array') return visit(type.item, singular(suggested));
    if (type.kind !== 'object') return;
    let name = pascal(suggested) || 'Item';
    if (/^\d/.test(name)) name = `Item${name}`;
    for (let n = 2; used.has(name); n++) name = `${pascal(suggested)}${n}`;
    used.add(name);
    names.set(type, name);
    models.push({ name, fields: [...type.fields.entries()] });
    for (const [key, field] of type.fields) visit(field.type, key);
  };
  visit(root, rootName);
  return { models, names };
}

type Emitter = (models: Model[], names: Map<Type, string>, rootIsArray: boolean, value: unknown) => string;

const typeName = (type: Type, names: Map<Type, string>, map: Record<string, string>, list: (inner: string) => string): string => {
  if (type.kind === 'array') return list(typeName(type.item, names, map, list));
  if (type.kind === 'object') return names.get(type) ?? map.any ?? 'object';
  return map[type.kind] ?? map.any ?? 'object';
};

const jsKey = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));
const PYTHON_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

type Dialect = 'mysql' | 'postgres' | 'sqlite';
const SQL: Record<
  Dialect,
  { name: string; string: string; int: string; float: string; bool: string; json: string; serial: string; quote: (name: string) => string; text: (value: string) => string; yes: string; no: string }
> = {
  mysql: {
    name: 'MySQL',
    string: 'VARCHAR(255)',
    int: 'BIGINT',
    float: 'DOUBLE',
    bool: 'BOOLEAN',
    json: 'JSON',
    serial: 'BIGINT AUTO_INCREMENT',
    quote: (name) => `\`${name}\``,
    // MySQL treats backslashes in string literals as escapes.
    text: (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`,
    yes: 'TRUE',
    no: 'FALSE',
  },
  postgres: {
    name: 'PostgreSQL',
    string: 'TEXT',
    int: 'BIGINT',
    float: 'DOUBLE PRECISION',
    bool: 'BOOLEAN',
    json: 'JSONB',
    serial: 'BIGINT GENERATED BY DEFAULT AS IDENTITY',
    quote: (name) => `"${name}"`,
    text: (value) => `'${value.replace(/'/g, "''")}'`,
    yes: 'TRUE',
    no: 'FALSE',
  },
  sqlite: {
    name: 'SQLite',
    string: 'TEXT',
    int: 'INTEGER',
    float: 'REAL',
    bool: 'INTEGER',
    json: 'TEXT',
    serial: 'INTEGER',
    quote: (name) => `"${name}"`,
    text: (value) => `'${value.replace(/'/g, "''")}'`,
    yes: '1',
    no: '0',
  },
};
const SQL_RESERVED = new Set(
  'add all alter and any as asc between by case check column constraint create cross current_date current_time current_timestamp database default delete desc distinct drop else end exists fetch for foreign from full grant group having in index inner insert interval into is join key left like limit match natural not null offset on option or order outer primary procedure range rank read references release return right row rows schema select set show signal table then to trigger union unique update usage user using values view when where window with write'.split(
    ' ',
  ),
);

/** Where each column's value comes from when a record is inserted. */
type Source = { kind: 'id' } | { kind: 'field'; key: string } | { kind: 'object'; key: string; child: Model } | { kind: 'parent' };
const MAX_ROWS = 5000;

/**
 * One table per object: nested objects become a foreign key on the parent,
 * lists of objects a child table pointing back at its parent, and lists of
 * plain values a JSON column.  The sample's records are inserted into every
 * table with explicit ids, so the foreign keys line up.
 */
function sqlEmitter(dialect: Dialect): Emitter {
  return (models, names, rootIsArray, value) => {
    const d = SQL[dialect];
    const ident = (name: string) => (SQL_RESERVED.has(name) ? d.quote(name) : name);
    const byName = new Map(models.map((model) => [model.name, model]));
    const table = new Map(models.map((model) => [model, snake(model.name)]));
    const tableOf = (model: Model) => table.get(model) as string;
    const ownId = (model: Model) => model.fields.find(([key, field]) => key === 'id' && (field.type.kind === 'int' || field.type.kind === 'string'))?.[1];
    const idType = (model: Model) => (ownId(model)?.type.kind === 'string' ? d.string : d.int);
    const childOf = (type: Type) => byName.get(names.get(type.kind === 'array' ? type.item : type) ?? '');

    const definitions = new Map<Model, string[]>(models.map((model) => [model, []]));
    const sources = new Map<Model, { column: string; source: Source }[]>(models.map((model) => [model, []]));
    const parentColumn = new Map<Model, { definition: string; key: string; column: string }>();
    const after = new Map<Model, Set<Model>>(models.map((model) => [model, new Set()]));

    for (const model of models) {
      const columns = definitions.get(model) as string[];
      const from = sources.get(model) as { column: string; source: Source }[];
      columns.push(ownId(model) ? `id ${idType(model)} PRIMARY KEY` : `id ${d.serial} PRIMARY KEY`);
      from.push({ column: 'id', source: { kind: 'id' } });
      for (const [key, field] of model.fields) {
        if (key === 'id' && ownId(model)) continue;
        const column = snake(key);
        const type = field.type;
        const child = type.kind === 'object' || (type.kind === 'array' && type.item.kind === 'object') ? childOf(type) : undefined;
        if (child && type.kind === 'object') {
          const name = `${column}_id`;
          columns.push(`${ident(name)} ${idType(child)}${field.optional || field.nullable ? '' : ' NOT NULL'}`);
          from.push({ column: name, source: { kind: 'object', key, child } });
          after.get(model)?.add(child);
        } else if (child) {
          const name = `${tableOf(model)}_id`;
          parentColumn.set(child, {
            definition: `${ident(name)} ${idType(model)} NOT NULL`,
            key: `FOREIGN KEY (${ident(name)}) REFERENCES ${ident(tableOf(model))} (id) ON DELETE CASCADE`,
            column: name,
          });
          after.get(child)?.add(model);
        } else if (type.kind !== 'object' && type.kind !== 'array') {
          const sqlType = type.kind === 'string' ? d.string : type.kind === 'int' ? d.int : type.kind === 'float' ? d.float : type.kind === 'bool' ? d.bool : d.json;
          const notNull = !(field.optional || field.nullable) && type.kind !== 'null' && type.kind !== 'any';
          columns.push(`${ident(column)} ${sqlType}${notNull ? ' NOT NULL' : ''}`);
          from.push({ column, source: { kind: 'field', key } });
        } else {
          // A list of plain values (or of lists) is kept whole as JSON.
          columns.push(`${ident(column)} ${d.json}`);
          from.push({ column, source: { kind: 'field', key } });
        }
      }
    }
    for (const [child, link] of parentColumn) {
      definitions.get(child)?.push(link.definition);
      sources.get(child)?.push({ column: link.column, source: { kind: 'parent' } });
    }

    // Tables a foreign key points at are created (and filled) first.
    const ordered: Model[] = [];
    const seen = new Set<Model>();
    const visit = (model: Model) => {
      if (seen.has(model)) return;
      seen.add(model);
      for (const dependency of after.get(model) ?? []) visit(dependency);
      ordered.push(model);
    };
    for (const model of models) visit(model);

    const tables = ordered.map((model) => {
      const lines = [...(definitions.get(model) ?? [])];
      for (const [key, field] of model.fields) {
        const child = field.type.kind === 'object' ? childOf(field.type) : undefined;
        if (child) lines.push(`FOREIGN KEY (${ident(`${snake(key)}_id`)}) REFERENCES ${ident(tableOf(child))} (id)`);
      }
      const link = parentColumn.get(model);
      if (link) lines.push(link.key);
      return `CREATE TABLE ${ident(tableOf(model))} (\n  ${lines.join(',\n  ')}\n);`;
    });

    const literal = (item: unknown): string => {
      if (item === null || item === undefined) return 'NULL';
      if (typeof item === 'boolean') return item ? d.yes : d.no;
      if (typeof item === 'number') return Number.isFinite(item) ? String(item) : 'NULL';
      return d.text(typeof item === 'string' ? item : JSON.stringify(item));
    };
    const rows = new Map<Model, string[]>(models.map((model) => [model, []]));
    const counters = new Map<Model, number>();
    let truncated = false;
    const isRecord = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item);
    const insert = (model: Model, record: Record<string, unknown>, parentId?: string): string | null => {
      const list = rows.get(model) as string[];
      if (list.length >= MAX_ROWS) {
        truncated = true;
        return null;
      }
      const next = (counters.get(model) ?? 0) + 1;
      counters.set(model, next);
      const id = ownId(model) ? literal(record.id) : String(next);
      const values = (sources.get(model) ?? []).map(({ source }) => {
        if (source.kind === 'id') return id;
        if (source.kind === 'parent') return parentId ?? 'NULL';
        const item = record[source.key];
        if (source.kind === 'object') return isRecord(item) ? (insert(source.child, item) ?? 'NULL') : 'NULL';
        return literal(item);
      });
      list.push(`(${values.join(', ')})`);
      for (const [key, field] of model.fields) {
        const items = record[key];
        if (field.type.kind !== 'array' || field.type.item.kind !== 'object' || !Array.isArray(items)) continue;
        const child = childOf(field.type);
        if (child) for (const item of items) if (isRecord(item)) insert(child, item, id);
      }
      return id;
    };
    const root = models[0] as Model;
    for (const record of (rootIsArray ? (value as unknown[]) : [value]).filter(isRecord)) insert(root, record);

    const inserts = ordered
      .filter((model) => (rows.get(model) ?? []).length > 0)
      .map((model) => `INSERT INTO ${ident(tableOf(model))} (${(sources.get(model) ?? []).map(({ column }) => ident(column)).join(', ')}) VALUES\n  ${(rows.get(model) ?? []).join(',\n  ')};`);
    // PostgreSQL identity columns do not move past explicit ids on their own.
    const resets =
      dialect === 'postgres'
        ? ordered
            .filter((model) => !ownId(model) && (rows.get(model) ?? []).length > 0)
            .map((model) => `SELECT setval(pg_get_serial_sequence('${ident(tableOf(model))}', 'id'), (SELECT MAX(id) FROM ${ident(tableOf(model))}));`)
        : [];
    const data = [...inserts, ...resets].join('\n\n');
    return `-- ${d.name} tables generated from a JSON sample\n\n${tables.join('\n\n')}${data ? `\n\n${data}` : ''}${truncated ? `\n-- Only the first ${MAX_ROWS} rows of each table are included.` : ''}\n`;
  };
}

const EMITTERS: Record<string, { label: string; language: Lang; extension: string; emit: Emitter }> = {
  csharp: {
    label: 'C# (System.Text.Json)',
    language: 'text',
    extension: 'cs',
    emit: (models, names) =>
      `using System.Collections.Generic;\nusing System.Text.Json;\nusing System.Text.Json.Serialization;\n\n${models
        .map(
          (model) =>
            `public class ${model.name}\n{\n${model.fields
              .map(([key, field]) => {
                const base = typeName(field.type, names, { string: 'string', int: 'long', float: 'double', bool: 'bool', any: 'JsonElement', null: 'object' }, (inner) => `List<${inner}>`);
                return `    [JsonPropertyName("${key}")]\n    public ${base}${field.nullable || field.optional ? '?' : ''} ${pascal(key)} { get; set; }`;
              })
              .join('\n\n')}\n}`,
        )
        .join('\n\n')}\n`,
  },
  java: {
    label: 'Java (records, Jackson)',
    language: 'text',
    extension: 'java',
    emit: (models, names) =>
      `import com.fasterxml.jackson.annotation.JsonProperty;\nimport java.util.List;\n\n${models
        .map(
          (model) =>
            `public record ${model.name}(\n${model.fields
              .map(
                ([key, field]) =>
                  `    @JsonProperty("${key}") ${typeName(
                    field.type,
                    names,
                    {
                      string: 'String',
                      int: field.nullable ? 'Long' : 'long',
                      float: field.nullable ? 'Double' : 'double',
                      bool: field.nullable ? 'Boolean' : 'boolean',
                      any: 'Object',
                      null: 'Object',
                    },
                    (inner) =>
                      `List<${inner
                        .replace(/^long$/, 'Long')
                        .replace(/^double$/, 'Double')
                        .replace(/^boolean$/, 'Boolean')}>`,
                  )} ${camel(key)}`,
              )
              .join(',\n')}\n) {}`,
        )
        .join('\n\n')}\n`,
  },
  go: {
    label: 'Go (structs)',
    language: 'text',
    extension: 'go',
    emit: (models, names) =>
      models
        .map((model) => {
          const rows = model.fields.map(([key, field]) => {
            const base = typeName(field.type, names, { string: 'string', int: 'int64', float: 'float64', bool: 'bool', any: 'any', null: 'any' }, (inner) => `[]${inner}`);
            return [pascal(key), `${field.nullable && !base.startsWith('[]') && base !== 'any' ? '*' : ''}${base}`, `\`json:"${key}${field.optional ? ',omitempty' : ''}"\``];
          });
          const w1 = Math.max(0, ...rows.map((row) => (row[0] as string).length));
          const w2 = Math.max(0, ...rows.map((row) => (row[1] as string).length));
          return `type ${model.name} struct {\n${rows.map(([a, b, c]) => `\t${(a as string).padEnd(w1)} ${(b as string).padEnd(w2)} ${c}`).join('\n')}\n}`;
        })
        .join('\n\n') + '\n',
  },
  python: {
    label: 'Python (dataclasses)',
    language: 'text',
    extension: 'py',
    emit: (models, names) =>
      `from __future__ import annotations\n\nfrom dataclasses import dataclass\nfrom typing import Any, Optional\n\n${[...models]
        .reverse()
        .map((model) => {
          const sorted = [...model.fields].sort((a, b) => Number(a[1].optional || a[1].nullable) - Number(b[1].optional || b[1].nullable));
          return `@dataclass\nclass ${model.name}:\n${
            sorted
              .map(([key, field]) => {
                const base = typeName(field.type, names, { string: 'str', int: 'int', float: 'float', bool: 'bool', any: 'Any', null: 'Any' }, (inner) => `list[${inner}]`);
                const loose = field.optional || field.nullable;
                return `    ${snake(key)}: ${loose ? `Optional[${base}]` : base}${loose ? ' = None' : ''}${snake(key) !== key ? `  # JSON: "${key}"` : ''}`;
              })
              .join('\n') || '    pass'
          }`;
        })
        .join('\n\n\n')}\n`,
  },
  rust: {
    label: 'Rust (serde)',
    language: 'text',
    extension: 'rs',
    emit: (models, names) =>
      `use serde::{Deserialize, Serialize};\n\n${models
        .map(
          (model) =>
            `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${model.name} {\n${model.fields
              .map(([key, field]) => {
                const base = typeName(field.type, names, { string: 'String', int: 'i64', float: 'f64', bool: 'bool', any: 'serde_json::Value', null: 'serde_json::Value' }, (inner) => `Vec<${inner}>`);
                const name = snake(key);
                const reserved = ['type', 'match', 'ref', 'move', 'fn', 'mod', 'use', 'self', 'struct', 'enum', 'impl', 'trait', 'loop', 'where'].includes(name);
                const attributes = [name !== key || reserved ? `rename = "${key}"` : '', field.optional ? 'default' : ''].filter(Boolean);
                return `${attributes.length > 0 ? `    #[serde(${attributes.join(', ')})]\n` : ''}    pub ${reserved ? `r#${name}` : name}: ${field.optional || field.nullable ? `Option<${base}>` : base},`;
              })
              .join('\n')}\n}`,
        )
        .join('\n\n')}\n`,
  },
  kotlin: {
    label: 'Kotlin (kotlinx.serialization)',
    language: 'text',
    extension: 'kt',
    emit: (models, names) =>
      `import kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.json.JsonElement\n\n${models
        .map(
          (model) =>
            `@Serializable\ndata class ${model.name}(\n${model.fields.map(([key, field]) => `    @SerialName("${key}") val ${camel(key)}: ${typeName(field.type, names, { string: 'String', int: 'Long', float: 'Double', bool: 'Boolean', any: 'JsonElement', null: 'JsonElement' }, (inner) => `List<${inner}>`)}${field.optional || field.nullable ? '? = null' : ''}`).join(',\n')}\n)`,
        )
        .join('\n\n')}\n`,
  },
  swift: {
    label: 'Swift (Codable)',
    language: 'text',
    extension: 'swift',
    emit: (models, names) =>
      `import Foundation\n\n${models
        .map((model) => {
          const renames = model.fields.filter(([key]) => camel(key) !== key);
          return `struct ${model.name}: Codable {\n${model.fields.map(([key, field]) => `    let ${camel(key)}: ${typeName(field.type, names, { string: 'String', int: 'Int', float: 'Double', bool: 'Bool', any: 'String', null: 'String' }, (inner) => `[${inner}]`)}${field.optional || field.nullable ? '?' : ''}`).join('\n')}${
            renames.length > 0
              ? `\n\n    enum CodingKeys: String, CodingKey {\n${model.fields.map(([key]) => `        case ${camel(key)}${camel(key) !== key ? ` = "${key}"` : ''}`).join('\n')}\n    }`
              : ''
          }\n}`;
        })
        .join('\n\n')}\n`,
  },
  dart: {
    label: 'Dart (fromJson / toJson)',
    language: 'text',
    extension: 'dart',
    emit: (models, names) =>
      models
        .map((model) => {
          const dartType = (type: Type): string => typeName(type, names, { string: 'String', int: 'int', float: 'double', bool: 'bool', any: 'dynamic', null: 'dynamic' }, (inner) => `List<${inner}>`);
          const read = (type: Type, source: string): string => {
            if (type.kind === 'object') return `${names.get(type)}.fromJson(${source} as Map<String, dynamic>)`;
            if (type.kind === 'array') return `(${source} as List<dynamic>).map((e) => ${read(type.item, 'e')}).toList()`;
            if (type.kind === 'float') return `(${source} as num).toDouble()`;
            return type.kind === 'any' || type.kind === 'null' ? source : `${source} as ${dartType(type)}`;
          };
          const write = (type: Type, source: string): string =>
            type.kind === 'object' ? `${source}.toJson()` : type.kind === 'array' ? `${source}.map((e) => ${write(type.item, 'e')}).toList()` : source;
          const fields = model.fields.map(([key, field]) => ({ key, name: camel(key), field, loose: field.optional || field.nullable }));
          return `class ${model.name} {\n${fields.map((f) => `  final ${dartType(f.field.type)}${f.loose ? '?' : ''} ${f.name};`).join('\n')}\n\n  ${model.name}({${fields.map((f) => `${f.loose ? '' : 'required '}this.${f.name}`).join(', ')}});\n\n  factory ${model.name}.fromJson(Map<String, dynamic> json) => ${model.name}(\n${fields.map((f) => `        ${f.name}: ${f.loose ? `json['${f.key}'] == null ? null : ` : ''}${read(f.field.type, `json['${f.key}']`)},`).join('\n')}\n      );\n\n  Map<String, dynamic> toJson() => {\n${fields.map((f) => `        '${f.key}': ${f.loose && (f.field.type.kind === 'object' || f.field.type.kind === 'array') ? `${f.name} == null ? null : ${write(f.field.type, `${f.name}!`)}` : write(f.field.type, f.name)},`).join('\n')}\n      };\n}`;
        })
        .join('\n\n') + '\n',
  },
  php: {
    label: 'PHP 8 (constructor promotion)',
    language: 'text',
    extension: 'php',
    emit: (models, names) =>
      `<?php\n\ndeclare(strict_types=1);\n\n${models
        .map((model) => {
          const fields = [...model.fields].sort((a, b) => Number(a[1].optional || a[1].nullable) - Number(b[1].optional || b[1].nullable));
          const docs = fields
            .filter(([, field]) => field.type.kind === 'array')
            .map(
              ([key, field]) =>
                ` * @param ${typeName(field.type, names, { string: 'string', int: 'int', float: 'float', bool: 'bool', any: 'mixed', null: 'mixed' }, (inner) => `${inner}[]`)} $${camel(key)}`,
            );
          return `${docs.length > 0 ? `/**\n${docs.join('\n')}\n */\n` : ''}final class ${model.name}\n{\n    public function __construct(\n${fields.map(([key, field]) => `        public ${field.optional || field.nullable ? '?' : ''}${typeName(field.type, names, { string: 'string', int: 'int', float: 'float', bool: 'bool', any: 'mixed', null: 'mixed' }, () => 'array')} $${camel(key)}${field.optional || field.nullable ? ' = null' : ''},`).join('\n')}\n    ) {}\n}`;
        })
        .join('\n\n')}\n`,
  },
  zod: {
    label: 'Zod schemas (TypeScript)',
    language: 'typescript',
    extension: 'ts',
    emit: (models, names, rootIsArray) => {
      const expr = (type: Type): string => {
        switch (type.kind) {
          case 'string':
            return 'z.string()';
          case 'int':
            return 'z.number().int()';
          case 'float':
            return 'z.number()';
          case 'bool':
            return 'z.boolean()';
          case 'null':
            return 'z.null()';
          case 'array':
            return `z.array(${expr(type.item)})`;
          case 'object':
            return names.get(type) ?? 'z.unknown()';
          default:
            return 'z.unknown()';
        }
      };
      const body = [...models]
        .reverse()
        .map(
          (model) =>
            `export const ${model.name} = z.object({\n${model.fields
              .map(([key, field]) => `  ${jsKey(key)}: ${expr(field.type)}${field.nullable && field.type.kind !== 'null' ? '.nullable()' : ''}${field.optional ? '.optional()' : ''},`)
              .join('\n')}\n});\nexport type ${model.name} = z.infer<typeof ${model.name}>;`,
        )
        .join('\n\n');
      const root = models[0]?.name ?? 'Root';
      return `import { z } from 'zod';\n\n${body}\n${rootIsArray ? `\nexport const ${root}List = z.array(${root});\nexport type ${root}List = z.infer<typeof ${root}List>;\n` : ''}`;
    },
  },
  pydantic: {
    label: 'Python (Pydantic models)',
    language: 'python',
    extension: 'py',
    emit: (models, names) => {
      const py = (type: Type) => typeName(type, names, { string: 'str', int: 'int', float: 'float', bool: 'bool', any: 'Any', null: 'Any' }, (inner) => `list[${inner}]`);
      let aliases = false;
      const classes = [...models]
        .reverse()
        .map((model) => {
          let aliased = false;
          const rows = model.fields.map(([key, field]) => {
            const name = snake(key);
            const attribute = PYTHON_KEYWORDS.has(name) ? `${name}_` : name;
            const loose = field.optional || field.nullable;
            const type = loose ? `Optional[${py(field.type)}]` : py(field.type);
            if (attribute === key) return `    ${attribute}: ${type}${loose ? ' = None' : ''}`;
            aliased = true;
            return `    ${attribute}: ${type} = Field(${loose ? 'None, ' : ''}alias=${JSON.stringify(key)})`;
          });
          aliases ||= aliased;
          return `class ${model.name}(BaseModel):\n${aliased ? '    model_config = ConfigDict(populate_by_name=True)\n\n' : ''}${rows.join('\n') || '    pass'}`;
        })
        .join('\n\n\n');
      return `from __future__ import annotations\n\nfrom typing import Any, Optional\n\nfrom pydantic import BaseModel${aliases ? ', ConfigDict, Field' : ''}\n\n\n${classes}\n`;
    },
  },
  graphql: {
    label: 'GraphQL types',
    language: 'text',
    extension: 'graphql',
    emit: (models, names, rootIsArray) => {
      let json = false;
      const loose = (type: Type) => type.kind === 'null' || type.kind === 'any';
      const gql = (type: Type): string => {
        if (type.kind === 'array') return `[${gql(type.item)}${loose(type.item) ? '' : '!'}]`;
        if (type.kind === 'object') return names.get(type) ?? 'JSON';
        const scalar = { string: 'String', int: 'Int', float: 'Float', bool: 'Boolean' }[type.kind as string];
        if (scalar) return scalar;
        json = true;
        return 'JSON';
      };
      const field = (key: string) => (/^[_A-Za-z][_0-9A-Za-z]*$/.test(key) ? key : camel(key));
      const types = models
        .map((model) => `type ${model.name} {\n${model.fields.map(([key, f]) => `  ${field(key)}: ${gql(f.type)}${f.optional || f.nullable || loose(f.type) ? '' : '!'}`).join('\n')}\n}`)
        .join('\n\n');
      const root = models[0]?.name ?? 'Root';
      const query = rootIsArray ? `type Query {\n  ${camel(root)}List: [${root}!]!\n}` : `type Query {\n  ${camel(root)}: ${root}\n}`;
      return `${json ? '"""Any JSON value."""\nscalar JSON\n\n' : ''}${types}\n\n${query}\n`;
    },
  },
  protobuf: {
    label: 'Protocol Buffers (proto3)',
    language: 'text',
    extension: 'proto',
    emit: (models, names) => {
      let struct = false;
      const scalars: Record<string, string> = { string: 'string', int: 'int64', float: 'double', bool: 'bool' };
      const proto = (type: Type): string => {
        if (type.kind === 'object') return names.get(type) ?? 'google.protobuf.Struct';
        const scalar = scalars[type.kind];
        if (scalar) return scalar;
        struct = true;
        return type.kind === 'array' ? 'google.protobuf.ListValue' : 'google.protobuf.Value';
      };
      const messages = models
        .map(
          (model) =>
            `message ${model.name} {\n${model.fields
              .map(([key, field], index) => {
                const name = snake(key);
                const lowerCamel = name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
                const jsonName = lowerCamel === key ? '' : ` [json_name = ${JSON.stringify(key)}]`;
                if (field.type.kind === 'array') return `  repeated ${proto(field.type.item)} ${name} = ${index + 1}${jsonName};`;
                const type = proto(field.type);
                const optional = (field.optional || field.nullable) && scalars[field.type.kind] ? 'optional ' : '';
                return `  ${optional}${type} ${name} = ${index + 1}${jsonName};`;
              })
              .join('\n')}\n}`,
        )
        .join('\n\n');
      return `syntax = "proto3";\n\n${struct ? 'import "google/protobuf/struct.proto";\n\n' : ''}${messages}\n`;
    },
  },
  mongoose: {
    label: 'Mongoose schemas (JavaScript)',
    language: 'javascript',
    extension: 'js',
    emit: (models, names) => {
      const schemaName = (name: string) => `${camel(name)}Schema`;
      const primitive: Record<string, string> = { string: 'String', int: 'Number', float: 'Number', bool: 'Boolean' };
      const typeOf = (type: Type): string => {
        if (type.kind === 'object') return schemaName(names.get(type) ?? 'Item');
        if (type.kind === 'array') return `[${typeOf(type.item)}]`;
        return primitive[type.kind] ?? 'Schema.Types.Mixed';
      };
      const root = models[0] as Model;
      const schemas = [...models]
        .reverse()
        .map((model) => {
          const rows = model.fields.map(([key, field]) => {
            const type = typeOf(field.type);
            if (field.type.kind === 'array') return `    ${jsKey(key)}: ${type},`;
            const required = !(field.optional || field.nullable) && field.type.kind !== 'null' && field.type.kind !== 'any';
            return `    ${jsKey(key)}: { type: ${type}${required ? ', required: true' : ''} },`;
          });
          return `const ${schemaName(model.name)} = new Schema(\n  {\n${rows.join('\n')}\n  }${model === root ? '' : ',\n  { _id: false }'},\n);`;
        })
        .join('\n\n');
      return `import mongoose from 'mongoose';\n\nconst { Schema } = mongoose;\n\n${schemas}\n\nexport const ${root.name} = mongoose.model(${JSON.stringify(root.name)}, ${schemaName(root.name)});\n`;
    },
  },
  mysql: { label: 'SQL tables (MySQL, MariaDB)', language: 'sql', extension: 'sql', emit: sqlEmitter('mysql') },
  postgres: { label: 'SQL tables (PostgreSQL)', language: 'sql', extension: 'sql', emit: sqlEmitter('postgres') },
  sqlite: { label: 'SQL tables (SQLite)', language: 'sql', extension: 'sql', emit: sqlEmitter('sqlite') },
};

export default defineTextTool({
  input: {
    label: 'JSON sample',
    language: 'json',
    sample:
      '{\n  "museum_id": 101,\n  "name": "Example Museum",\n  "rating": 4.6,\n  "open": true,\n  "galleries": [\n    { "title": "Engines", "exhibits": 42, "curator": null },\n    { "title": "Space", "exhibits": 31, "curator": "A. Rao", "tags": ["rockets"] }\n  ]\n}',
  },
  output: { label: 'Code' },
  options: [
    { key: 'language', label: 'Language', type: 'select', choices: Object.entries(EMITTERS).map(([value, { label }]) => ({ value, label })), default: 'csharp' },
    { key: 'rootName', label: 'Root type name', type: 'text', default: 'Root' },
  ],
  run(input, o) {
    if (input.trim() === '') return '';
    const value = parseJson(input);
    if (value === null || typeof value !== 'object') throw new ToolError('Paste a JSON object, or an array of objects.');
    const root = infer(value);
    const { models, names } = collect(root, o.rootName || 'Root');
    if (models.length === 0) throw new ToolError('The JSON has no objects to turn into types.');
    const emitter = EMITTERS[o.language] ?? (EMITTERS.csharp as (typeof EMITTERS)[string]);
    return {
      output: emitter.emit(models, names, Array.isArray(value), value),
      language: emitter.language,
      filename: `${models[0]?.name ?? 'Root'}.${emitter.extension}`,
      info: `${models.length} type${models.length === 1 ? '' : 's'}${Array.isArray(value) ? '; the JSON is a list of ' + (models[0]?.name ?? 'Root') : ''}`,
    };
  },
});
