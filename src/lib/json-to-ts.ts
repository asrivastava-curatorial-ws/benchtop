/**
 * Infers TypeScript declarations from a JSON sample.
 *
 * Shapes seen in the same position (for example every element of an array)
 * are merged: keys missing from some objects become optional, and differing
 * value types become unions.  Structurally identical objects share one type.
 */
import { capitalize, splitWords } from './text';

type Shape =
  | { readonly kind: 'unknown' | 'null' | 'boolean' | 'number' | 'string' }
  | { readonly kind: 'array'; readonly item: Shape }
  | { readonly kind: 'object'; readonly fields: Map<string, Field> }
  | { readonly kind: 'union'; readonly members: Shape[] };

interface Field {
  readonly shape: Shape;
  readonly optional: boolean;
}

type ObjectShape = Extract<Shape, { kind: 'object' }>;

export interface JsonToTsOptions {
  readonly rootName: string;
  /** Emit `type X = {...}` instead of `interface X {...}`. */
  readonly typeAliases: boolean;
  readonly exportTypes: boolean;
  /** Treat `null` values as "may be absent": `key?: T` instead of `key: T | null`. */
  readonly nullAsOptional: boolean;
  readonly indent: string;
}

const UNKNOWN: Shape = { kind: 'unknown' };

function infer(value: unknown): Shape {
  if (value === null) return { kind: 'null' };
  if (Array.isArray(value)) return { kind: 'array', item: value.map(infer).reduce(merge, UNKNOWN) };
  switch (typeof value) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'number':
      return { kind: 'number' };
    case 'string':
      return { kind: 'string' };
    case 'object': {
      const fields = new Map<string, Field>();
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        fields.set(key, { shape: infer(item), optional: false });
      }
      return { kind: 'object', fields };
    }
    default:
      return UNKNOWN;
  }
}

function mergeObjects(a: ObjectShape, b: ObjectShape): ObjectShape {
  const fields = new Map<string, Field>();
  for (const [key, field] of a.fields) {
    const other = b.fields.get(key);
    fields.set(key, other ? { shape: merge(field.shape, other.shape), optional: field.optional || other.optional } : { shape: field.shape, optional: true });
  }
  for (const [key, field] of b.fields) {
    if (!a.fields.has(key)) fields.set(key, { shape: field.shape, optional: true });
  }
  return { kind: 'object', fields };
}

function merge(a: Shape, b: Shape): Shape {
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;
  const byKind = new Map<string, Shape>();
  for (const member of [...(a.kind === 'union' ? a.members : [a]), ...(b.kind === 'union' ? b.members : [b])]) {
    const existing = byKind.get(member.kind);
    if (!existing) byKind.set(member.kind, member);
    else if (member.kind === 'array' && existing.kind === 'array') {
      byKind.set('array', { kind: 'array', item: merge(existing.item, member.item) });
    } else if (member.kind === 'object' && existing.kind === 'object') {
      byKind.set('object', mergeObjects(existing, member));
    }
  }
  const members = [...byKind.values()];
  return members.length === 1 ? (members[0] as Shape) : { kind: 'union', members };
}

function singular(word: string): string {
  if (/ies$/i.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/(ss|us|is)$/i.test(word) && word.length > 2) return word.slice(0, -1);
  return word;
}

function pascalCase(text: string): string {
  const name = splitWords(text).map(capitalize).join('');
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

function signature(shape: Shape): string {
  switch (shape.kind) {
    case 'array':
      return `[${signature(shape.item)}]`;
    case 'union':
      return shape.members.map(signature).sort().join('|');
    case 'object':
      return `{${[...shape.fields]
        .map(([key, field]) => `${JSON.stringify(key)}${field.optional ? '?' : ''}:${signature(field.shape)}`)
        .sort()
        .join(';')}}`;
    default:
      return shape.kind;
  }
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function jsonToTypeScript(value: unknown, options: JsonToTsOptions): string {
  const rootName = pascalCase(options.rootName) || 'Root';
  const declarations: { name: string; body: string[] }[] = [];
  const namesBySignature = new Map<string, string>();
  const used = new Set<string>();
  const exportPrefix = options.exportTypes ? 'export ' : '';

  const reserve = (hint: string): string => {
    const base = pascalCase(hint) || 'Type';
    let name = base;
    for (let suffix = 2; used.has(name); suffix++) name = `${base}${suffix}`;
    used.add(name);
    return name;
  };

  const declare = (shape: ObjectShape, hint: string): string => {
    const key = signature(shape);
    const existing = namesBySignature.get(key);
    if (existing !== undefined) return existing;
    const name = reserve(hint);
    namesBySignature.set(key, name);
    const declaration = { name, body: [] as string[] };
    declarations.push(declaration);
    for (const [property, field] of shape.fields) {
      let fieldShape = field.shape;
      let optional = field.optional;
      if (options.nullAsOptional && fieldShape.kind === 'union' && fieldShape.members.some((member) => member.kind === 'null')) {
        const rest = fieldShape.members.filter((member) => member.kind !== 'null');
        fieldShape = rest.length === 1 ? (rest[0] as Shape) : { kind: 'union', members: rest };
        optional = true;
      }
      const label = IDENTIFIER.test(property) ? property : JSON.stringify(property);
      declaration.body.push(`${options.indent}${label}${optional ? '?' : ''}: ${render(fieldShape, property)};`);
    }
    return name;
  };

  const render = (shape: Shape, hint: string): string => {
    switch (shape.kind) {
      case 'unknown':
        return 'unknown';
      case 'array': {
        const item = render(shape.item, singular(hint) === hint ? `${hint}Item` : singular(hint));
        return shape.item.kind === 'union' ? `(${item})[]` : `${item}[]`;
      }
      case 'object':
        return shape.fields.size === 0 ? 'Record<string, unknown>' : declare(shape, hint);
      case 'union': {
        const ordered = [...shape.members].sort((a, b) => Number(a.kind === 'null') - Number(b.kind === 'null'));
        return ordered.map((member) => render(member, hint)).join(' | ');
      }
      default:
        return shape.kind;
    }
  };

  const root = infer(value);
  const blocks: string[] = [];
  if (root.kind === 'object' && root.fields.size > 0) {
    declare(root, rootName);
  } else {
    used.add(rootName);
    blocks.push(`${exportPrefix}type ${rootName} = ${render(root, rootName)};`);
  }
  for (const { name, body } of declarations) {
    blocks.push(options.typeAliases ? `${exportPrefix}type ${name} = {\n${body.join('\n')}\n};` : `${exportPrefix}interface ${name} {\n${body.join('\n')}\n}`);
  }
  return `${blocks.join('\n\n')}\n`;
}
