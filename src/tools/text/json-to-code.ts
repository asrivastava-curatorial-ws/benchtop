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

type Emitter = (models: Model[], names: Map<Type, string>, rootIsArray: boolean) => string;

const typeName = (type: Type, names: Map<Type, string>, map: Record<string, string>, list: (inner: string) => string): string => {
  if (type.kind === 'array') return list(typeName(type.item, names, map, list));
  if (type.kind === 'object') return names.get(type) ?? map.any ?? 'object';
  return map[type.kind] ?? map.any ?? 'object';
};

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
      output: emitter.emit(models, names, Array.isArray(value)),
      language: emitter.language,
      filename: `${models[0]?.name ?? 'Root'}.${emitter.extension}`,
      info: `${models.length} type${models.length === 1 ? '' : 's'}${Array.isArray(value) ? '; the JSON is a list of ' + (models[0]?.name ?? 'Root') : ''}`,
    };
  },
});
