/**
 * Protocol Buffers with and without a schema, as CyberChef's Protobuf Decode
 * and Protobuf Encode give them.
 *
 * CyberChef pairs its own schema-less parser with protobuf.js for schemas.
 * protobuf.js generates code at run time, which the app's security policy
 * forbids, so the schema side is done here by reflection over a .proto parser
 * of our own, following protobuf.js's rules: which message is used (the first
 * one declared), field order and defaults in the JSON (toObject with longs as
 * numbers, enums as names, bytes as Base64) and its error messages.
 */

import { fromBase64 } from '../../lib/bytes';
import { b64, bArg, bool, bytesToLatin1, defineOp, OpError, type Operation, sArg, txt, utf8 } from '../core';

/* ------------------------------------------------------- .proto schema --- */

export interface ProtoField {
  name: string;
  id: number;
  type: string;
  rule: 'optional' | 'required' | 'repeated' | '';
  keyType?: string;
  options: Record<string, string | number | boolean>;
  /** Name of the oneof it belongs to (proto3 optional fields get a synthetic one). */
  oneof?: string;
  proto3Optional?: boolean;
  parent: ProtoMessage;
}

export interface ProtoEnum {
  kind: 'enum';
  name: string;
  values: [string, number][];
  parent: Namespace;
}

export interface ProtoMessage {
  kind: 'message';
  name: string;
  fields: ProtoField[];
  nested: (ProtoMessage | ProtoEnum)[];
  parent: Namespace;
}

interface Namespace {
  kind: 'message' | 'package';
  name: string;
  nested: (ProtoMessage | ProtoEnum | PackageSpace)[];
  parent?: Namespace;
}

interface PackageSpace extends Namespace {
  kind: 'package';
}

export interface ProtoSchema {
  syntax: 'proto2' | 'proto3';
  root: PackageSpace;
  /** The package's namespace, or the root when there is no package. */
  top: PackageSpace;
}

const SCALARS = new Set(['double', 'float', 'int32', 'uint32', 'sint32', 'fixed32', 'sfixed32', 'int64', 'uint64', 'sint64', 'fixed64', 'sfixed64', 'bool', 'string', 'bytes']);

class SchemaError extends Error {}

function tokenize(text: string): { tokens: string[]; lines: number[] } {
  const tokens: string[] = [];
  const lines: number[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '\n') {
      line++;
      i++;
    } else if (/\s/.test(ch)) i++;
    else if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      tokens.push(text.slice(i, j + 1));
      lines.push(line);
      i = j + 1;
    } else {
      const m = /^(?:[A-Za-z_][\w.]*|\.[A-Za-z_][\w.]*|[-+]?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|inf|nan)|[{}[\]()<>=;,:])/.exec(text.slice(i));
      if (!m) throw new SchemaError(`illegal token '${ch}' (line ${line})`);
      tokens.push(m[0]);
      lines.push(line);
      i += m[0].length;
    }
  }
  return { tokens, lines };
}

const unquote = (token: string): string =>
  token.slice(1, -1).replace(/\\(x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/g, (_, e: string) => {
    if (e[0] === 'x') return String.fromCharCode(Number.parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(Number.parseInt(e, 8));
    return ({ n: '\n', r: '\r', t: '\t', '0': '\0' } as Record<string, string>)[e] ?? e;
  });

function literal(token: string): string | number | boolean {
  if (token.startsWith('"') || token.startsWith("'")) return unquote(token);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (/^[-+]?(0[xX][0-9a-fA-F]+)$/.test(token)) return Number.parseInt(token, 16);
  if (/^[-+]?\d/.test(token)) return Number(token);
  return token;
}

export function parseProto(text: string): ProtoSchema {
  const { tokens, lines } = tokenize(text);
  let p = 0;
  const where = () => `(line ${lines[Math.min(p, lines.length - 1)] ?? 1})`;
  const peek = () => tokens[p];
  const next = () => {
    const token = tokens[p++];
    if (token === undefined) throw new SchemaError(`illegal end of file ${where()}`);
    return token;
  };
  const expect = (token: string) => {
    const got = next();
    if (got !== token) throw new SchemaError(`illegal token '${got}', '${token}' expected ${where()}`);
  };
  const skipStatement = () => {
    let depth = 0;
    for (;;) {
      const token = next();
      if (token === '{') depth++;
      else if (token === '}') {
        depth--;
        if (depth <= 0) return;
      } else if (token === ';' && depth === 0) return;
    }
  };
  const skipOptions = (): Record<string, string | number | boolean> => {
    const options: Record<string, string | number | boolean> = {};
    if (peek() !== '[') return options;
    next();
    for (;;) {
      let name = next();
      if (name === '(') {
        name = next();
        expect(')');
        while (peek()?.startsWith('.')) name += next();
      }
      expect('=');
      let value: string | number | boolean;
      if (peek() === '{') {
        skipStatement();
        value = '';
      } else value = literal(next());
      options[name] = value;
      const sep = next();
      if (sep === ']') break;
      if (sep !== ',') throw new SchemaError(`illegal token '${sep}' ${where()}`);
    }
    return options;
  };

  const root: PackageSpace = { kind: 'package', name: '', nested: [] };
  let syntax: 'proto2' | 'proto3' = 'proto2';
  let top = root;

  const parseEnum = (parent: Namespace): ProtoEnum => {
    const name = next();
    const en: ProtoEnum = { kind: 'enum', name, values: [], parent };
    expect('{');
    while (peek() !== '}') {
      const token = next();
      if (token === 'option' || token === 'reserved') {
        skipStatement();
        continue;
      }
      if (token === ';') continue;
      expect('=');
      const value = literal(next());
      if (typeof value !== 'number') throw new SchemaError(`illegal value '${String(value)}' ${where()}`);
      skipOptions();
      expect(';');
      en.values.push([token, value]);
    }
    next();
    if (peek() === ';') next();
    return en;
  };

  const parseField = (message: ProtoMessage, rule: ProtoField['rule'], type: string, oneof?: string): void => {
    const name = next();
    expect('=');
    const id = literal(next());
    if (typeof id !== 'number') throw new SchemaError(`illegal id '${String(id)}' ${where()}`);
    const options = skipOptions();
    expect(';');
    const field: ProtoField = { name, id, type, rule, options, oneof, parent: message };
    if (syntax === 'proto3' && rule === 'optional') {
      field.proto3Optional = true;
      field.oneof = `_${name}`;
    }
    message.fields.push(field);
  };

  const parseMessage = (parent: Namespace): ProtoMessage => {
    const name = next();
    const message: ProtoMessage = { kind: 'message', name, fields: [], nested: [], parent };
    expect('{');
    while (peek() !== '}') {
      const token = next();
      switch (token) {
        case ';':
          break;
        case 'message':
          message.nested.push(parseMessage(message as unknown as Namespace));
          break;
        case 'enum':
          message.nested.push(parseEnum(message as unknown as Namespace));
          break;
        case 'option':
        case 'reserved':
        case 'extensions':
        case 'extend':
          skipStatement();
          break;
        case 'oneof': {
          const oneof = next();
          expect('{');
          while (peek() !== '}') {
            const t = next();
            if (t === 'option') {
              skipStatement();
              continue;
            }
            parseField(message, '', t, oneof);
          }
          next();
          break;
        }
        case 'map': {
          expect('<');
          const keyType = next();
          expect(',');
          const valueType = next();
          expect('>');
          parseField(message, '', valueType);
          (message.fields[message.fields.length - 1] as ProtoField).keyType = keyType;
          break;
        }
        case 'optional':
        case 'required':
        case 'repeated': {
          const type = next();
          if (type === 'group') throw new SchemaError(`groups are not supported ${where()}`);
          parseField(message, token, type);
          break;
        }
        default:
          if (token === 'group') throw new SchemaError(`groups are not supported ${where()}`);
          parseField(message, syntax === 'proto3' ? '' : 'optional', token);
      }
    }
    next();
    if (peek() === ';') next();
    return message;
  };

  while (p < tokens.length) {
    const token = next();
    switch (token) {
      case ';':
        break;
      case 'syntax':
      case 'edition': {
        expect('=');
        const value = literal(next());
        syntax = value === 'proto2' ? 'proto2' : 'proto3';
        expect(';');
        break;
      }
      case 'package': {
        const name = next();
        expect(';');
        let space: PackageSpace = root;
        for (const part of name.split('.')) {
          let child = space.nested.find((n): n is PackageSpace => n.kind === 'package' && n.name === part);
          if (!child) {
            child = { kind: 'package', name: part, nested: [], parent: space };
            space.nested.push(child);
          }
          space = child;
        }
        top = space;
        break;
      }
      case 'import':
      case 'option':
      case 'service':
      case 'extend':
        skipStatement();
        break;
      case 'message':
        top.nested.push(parseMessage(top));
        break;
      case 'enum':
        top.nested.push(parseEnum(top));
        break;
      default:
        throw new SchemaError(`illegal token '${token}' ${where()}`);
    }
  }
  // Optional fields in proto2 files declared without a label are already "optional".
  return { syntax, root, top };
}

/** Finds a type by name from a message's scope outwards, as protobuf.js does. */
function lookupType(name: string, from: Namespace, schema: ProtoSchema): ProtoMessage | ProtoEnum | undefined {
  const parts = name.replace(/^\./, '').split('.');
  const search = (space: Namespace): ProtoMessage | ProtoEnum | undefined => {
    let current: Namespace | ProtoMessage | ProtoEnum | undefined = space;
    for (const part of parts) {
      if (!current || current.kind === 'enum') return undefined;
      current = (current.nested as (ProtoMessage | ProtoEnum | PackageSpace)[]).find((n) => n.name === part);
    }
    return current && current.kind !== 'package' ? (current as ProtoMessage | ProtoEnum) : undefined;
  };
  if (name.startsWith('.')) return search(schema.root);
  for (let space: Namespace | undefined = from; space; space = space.parent) {
    const found = search(space);
    if (found) return found;
  }
  return undefined;
}

function resolve(field: ProtoField, schema: ProtoSchema): ProtoMessage | ProtoEnum | undefined {
  if (SCALARS.has(field.type)) return undefined;
  const found = lookupType(field.type, field.parent as unknown as Namespace, schema);
  if (!found) throw new SchemaError(`no such type: ${field.type}`);
  return found;
}

/* ----------------------------------------------- wire format: reading --- */

class RangeFail extends Error {
  constructor(
    message: string,
    readonly byteOffset: number,
  ) {
    super(message);
  }
}

/** A cursor that fails the way protobuf.js's Reader does. */
class Reader {
  pos = 0;
  constructor(
    readonly buf: Uint8Array,
    public len = buf.length,
  ) {}

  private outOfRange(length = 1): never {
    throw new RangeFail(`RangeError: index out of range: ${this.pos} + ${length} > ${this.len}`, this.pos);
  }

  varint(): bigint {
    let value = 0n;
    for (let shift = 0n; ; shift += 7n) {
      if (this.pos >= this.len) this.outOfRange();
      const b = this.buf[this.pos++] as number;
      if (shift < 64n) value |= BigInt(b & 0x7f) << shift;
      if (b < 0x80) return value & 0xffffffffffffffffn;
      if (shift > 63n) throw new RangeFail('Error: invalid varint encoding', this.pos);
    }
  }

  uint32(): number {
    return Number(this.varint() & 0xffffffffn);
  }

  fixed(size: 4 | 8): DataView {
    if (this.pos + size > this.len) this.outOfRange(size);
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, size);
    this.pos += size;
    return view;
  }

  bytes(): Uint8Array {
    const length = this.uint32();
    if (this.pos + length > this.len) this.outOfRange(length);
    const out = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  skip(wire: number, field: number, depth = 0): void {
    if (depth > 100) throw new RangeFail('Error: max depth exceeded', this.pos);
    if (field === 0) throw new RangeFail('Error: illegal tag: field number 0', this.pos);
    switch (wire) {
      case 0:
        this.varint();
        return;
      case 1:
        this.fixed(8);
        return;
      case 2:
        this.bytes();
        return;
      case 3:
        for (;;) {
          const tag = this.uint32();
          const nested = tag >>> 3;
          if (!nested) throw new RangeFail('Error: illegal tag: field number 0', this.pos);
          if ((tag & 7) === 4) {
            if (nested !== field) throw new RangeFail('Error: invalid end group tag', this.pos);
            return;
          }
          this.skip(tag & 7, nested, depth + 1);
        }
      case 5:
        this.fixed(4);
        return;
      default:
        throw new RangeFail(`Error: invalid wire type ${wire} at offset ${this.pos}`, this.pos);
    }
  }
}

const WIRE: Record<string, number> = {
  double: 1,
  float: 5,
  int32: 0,
  uint32: 0,
  sint32: 0,
  fixed32: 5,
  sfixed32: 5,
  int64: 0,
  uint64: 0,
  sint64: 0,
  fixed64: 1,
  sfixed64: 1,
  bool: 0,
  string: 2,
  bytes: 2,
};
const PACKABLE = new Set(['double', 'float', 'int32', 'uint32', 'sint32', 'fixed32', 'sfixed32', 'int64', 'uint64', 'sint64', 'fixed64', 'sfixed64', 'bool']);

const signed64 = (v: bigint): number => Number(BigInt.asIntN(64, v));
const zigzag = (v: bigint): bigint => (v >> 1n) ^ -(v & 1n);

function readScalar(r: Reader, type: string): unknown {
  switch (type) {
    case 'double':
      return r.fixed(8).getFloat64(0, true);
    case 'float':
      return r.fixed(4).getFloat32(0, true);
    case 'int32':
      return Number(BigInt.asIntN(32, r.varint()));
    case 'uint32':
      return Number(BigInt.asUintN(32, r.varint()));
    case 'sint32':
      return Number(BigInt.asIntN(32, zigzag(BigInt.asUintN(32, r.varint()))));
    case 'fixed32':
      return r.fixed(4).getUint32(0, true);
    case 'sfixed32':
      return r.fixed(4).getInt32(0, true);
    case 'int64':
      return signed64(r.varint());
    case 'uint64':
      return Number(r.varint());
    case 'sint64':
      return Number(zigzag(r.varint()));
    case 'fixed64':
      return Number(r.fixed(8).getBigUint64(0, true));
    case 'sfixed64':
      return Number(r.fixed(8).getBigInt64(0, true));
    case 'bool':
      return r.varint() !== 0n;
    case 'string':
      return new TextDecoder().decode(r.bytes());
    case 'bytes':
      return b64(r.bytes());
    default:
      throw new Error(`unknown type ${type}`);
  }
}

type Decoded = Map<ProtoField, unknown>;

/** Decodes one message into field values (repeated fields as arrays, maps as key/value pairs). */
function decodeMessage(type: ProtoMessage, r: Reader, end: number, schema: ProtoSchema, depth: number): Decoded {
  if (depth > 100) throw new RangeFail('Error: max depth exceeded', r.pos);
  const out: Decoded = new Map();
  const savedLen = r.len;
  r.len = end;
  while (r.pos < end) {
    const tag = r.uint32();
    const id = tag >>> 3;
    const wire = tag & 7;
    const field = type.fields.find((f) => f.id === id);
    if (!field) {
      r.skip(wire, id);
      continue;
    }
    const resolved = resolve(field, schema);
    const scalarType = resolved?.kind === 'enum' ? 'int32' : field.type;
    if (field.keyType) {
      if (wire !== 2) {
        r.skip(wire, id);
        continue;
      }
      const length = r.uint32();
      const stop = r.pos + length;
      if (stop > r.len) throw new RangeFail('RangeError: index out of range', r.pos);
      const outer = r.len;
      r.len = stop;
      let key: unknown = field.keyType === 'string' ? '' : field.keyType === 'bool' ? false : 0;
      let value: unknown = resolved?.kind === 'message' ? null : scalarDefault(field, resolved);
      while (r.pos < stop) {
        const t = r.uint32();
        if (t >>> 3 === 1 && (t & 7) === WIRE[field.keyType]) key = readScalar(r, field.keyType);
        else if (t >>> 3 === 2 && resolved?.kind === 'message' && (t & 7) === 2) {
          const length2 = r.uint32();
          value = decodeMessage(resolved, r, r.pos + length2, schema, depth + 1);
        } else if (t >>> 3 === 2 && (t & 7) === WIRE[scalarType]) value = readScalar(r, scalarType);
        else r.skip(t & 7, t >>> 3);
      }
      r.len = outer;
      const entries = (out.get(field) as [unknown, unknown][] | undefined) ?? [];
      entries.push([key, value]);
      out.set(field, entries);
      continue;
    }
    const readOne = (): unknown => {
      if (resolved?.kind === 'message') {
        const length = r.uint32();
        const stop = r.pos + length;
        if (stop > r.len) throw new RangeFail('RangeError: index out of range', r.pos);
        return decodeMessage(resolved, r, stop, schema, depth + 1);
      }
      return readScalar(r, scalarType);
    };
    if (field.rule === 'repeated') {
      const list = (out.get(field) as unknown[] | undefined) ?? [];
      if (wire === 2 && PACKABLE.has(scalarType)) {
        const length = r.uint32();
        const stop = r.pos + length;
        if (stop > r.len) throw new RangeFail(`RangeError: index out of range: ${r.pos} + ${length} > ${r.len}`, r.pos);
        while (r.pos < stop) list.push(readScalar(r, scalarType));
      } else if (wire !== (resolved?.kind === 'message' ? 2 : WIRE[scalarType])) {
        r.skip(wire, id);
        continue;
      } else list.push(readOne());
      out.set(field, list);
      continue;
    }
    if (wire !== (resolved?.kind === 'message' ? 2 : WIRE[scalarType])) {
      r.skip(wire, id);
      continue;
    }
    out.set(field, readOne());
  }
  r.len = savedLen;
  return out;
}

function scalarDefault(field: ProtoField, resolved: ProtoMessage | ProtoEnum | undefined): unknown {
  const explicit = field.options.default;
  if (resolved?.kind === 'enum') {
    if (typeof explicit === 'string') return resolved.values.find(([n]) => n === explicit)?.[1] ?? 0;
    if (typeof explicit === 'number') return explicit;
    return resolved.values[0]?.[1] ?? 0;
  }
  if (explicit !== undefined) {
    if (field.type === 'bytes') return b64(utf8(String(explicit)));
    if (field.type === 'bool') return explicit === true || explicit === 'true';
    if (field.type === 'string') return String(explicit);
    return Number(explicit);
  }
  if (field.type === 'bool') return false;
  if (field.type === 'string' || field.type === 'bytes') return '';
  return 0;
}

const byId = (a: ProtoField, b: ProtoField) => a.id - b.id;

/** protobuf.js's toObject with { longs: Number, enums: String, bytes: String, defaults: true }. */
function toObject(type: ProtoMessage, values: Decoded, schema: ProtoSchema, label: (f: ProtoField) => string): Record<string, unknown> {
  const fields = [...type.fields].sort(byId);
  const out: Record<string, unknown> = {};
  const convert = (field: ProtoField, value: unknown): unknown => {
    const resolved = resolve(field, schema);
    if (resolved?.kind === 'enum') return resolved.values.find(([, n]) => n === value)?.[0] ?? value;
    if (resolved?.kind === 'message') return toObject(resolved, (value as Decoded | null) ?? new Map(), schema, label);
    return value;
  };
  const plain = fields.filter((f) => !f.oneof);
  for (const field of plain) if (field.rule === 'repeated') out[label(field)] = [];
  for (const field of plain) if (field.keyType) out[label(field)] = {};
  for (const field of plain) {
    if (field.rule === 'repeated' || field.keyType) continue;
    const resolved = resolve(field, schema);
    out[label(field)] = resolved?.kind === 'message' ? null : resolved?.kind === 'enum' ? convert(field, scalarDefault(field, resolved)) : scalarDefault(field, resolved);
  }
  for (const field of fields) {
    if (!values.has(field)) continue;
    const value = values.get(field);
    if (field.keyType) {
      const entries = value as [unknown, unknown][];
      const map: Record<string, unknown> = {};
      for (const [k, v] of entries) map[String(k)] = convert(field, v);
      out[label(field)] = map;
    } else if (field.rule === 'repeated') {
      const list = value as unknown[];
      if (list.length) out[label(field)] = list.map((v) => convert(field, v));
    } else if (value != null) out[label(field)] = convert(field, value);
  }
  return out;
}

/* ----------------------------------------------- wire format: writing --- */

class Writer {
  private chunks: number[] = [];

  varint(value: bigint): void {
    let v = BigInt.asUintN(64, value);
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) byte |= 0x80;
      this.chunks.push(byte);
    } while (v > 0n);
  }

  tag(id: number, wire: number): void {
    this.varint(BigInt(((id << 3) | wire) >>> 0));
  }

  raw(bytes: Uint8Array): void {
    for (const b of bytes) this.chunks.push(b);
  }

  fixed(size: 4 | 8, write: (view: DataView) => void): void {
    const buf = new Uint8Array(size);
    write(new DataView(buf.buffer));
    this.raw(buf);
  }

  delimited(bytes: Uint8Array): void {
    this.varint(BigInt(bytes.length));
    this.raw(bytes);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

const toBig = (value: unknown): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  const n = Number(value);
  return Number.isFinite(n) ? BigInt(Math.trunc(n)) : 0n;
};

function writeScalar(w: Writer, type: string, value: unknown): void {
  switch (type) {
    case 'double':
      w.fixed(8, (v) => v.setFloat64(0, Number(value), true));
      return;
    case 'float':
      w.fixed(4, (v) => v.setFloat32(0, Number(value), true));
      return;
    case 'int32':
      w.varint(BigInt(Number(value) | 0));
      return;
    case 'uint32':
      w.varint(BigInt(Number(value) >>> 0));
      return;
    case 'sint32': {
      const n = Number(value) | 0;
      w.varint(BigInt(((n << 1) ^ (n >> 31)) >>> 0));
      return;
    }
    case 'fixed32':
      w.fixed(4, (v) => v.setUint32(0, Number(value) >>> 0, true));
      return;
    case 'sfixed32':
      w.fixed(4, (v) => v.setInt32(0, Number(value) | 0, true));
      return;
    case 'int64':
    case 'uint64':
      w.varint(toBig(value));
      return;
    case 'sint64': {
      const n = BigInt.asIntN(64, toBig(value));
      w.varint((n << 1n) ^ (n >> 63n));
      return;
    }
    case 'fixed64':
      w.fixed(8, (v) => v.setBigUint64(0, BigInt.asUintN(64, toBig(value)), true));
      return;
    case 'sfixed64':
      w.fixed(8, (v) => v.setBigInt64(0, BigInt.asIntN(64, toBig(value)), true));
      return;
    case 'bool':
      w.varint(value ? 1n : 0n);
      return;
    case 'string':
      w.delimited(utf8(String(value)));
      return;
    case 'bytes':
      w.delimited(typeof value === 'string' ? fromBase64(value) : Uint8Array.from(value as ArrayLike<number>));
      return;
  }
}

const fullName = (field: ProtoField): string => {
  const names: string[] = [field.name];
  for (let space: { name: string; parent?: Namespace } | undefined = field.parent; space?.name; space = space.parent) names.unshift(space.name);
  return `.${names.join('.')}`;
};

/** protobuf.js's fromObject (unknown keys ignored, enums by name or number) followed by encode. */
function encodeMessage(type: ProtoMessage, object: unknown, schema: ProtoSchema, depth = 0): Uint8Array {
  if (depth > 100) throw new Error('max depth exceeded');
  const w = new Writer();
  const data = (object ?? {}) as Record<string, unknown>;
  const enumValue = (en: ProtoEnum, value: unknown): number | undefined => {
    const byName = en.values.find(([n]) => n === value);
    if (byName) return byName[1];
    if (typeof value === 'number' && (value | 0) === value) return value;
    return undefined;
  };
  for (const field of [...type.fields].sort(byId)) {
    const value = data[field.name];
    const resolved = resolve(field, schema);
    // As protobuf.js's fromObject: repeated and map fields are skipped when falsy, others when null.
    if ((field.rule === 'repeated' || field.keyType) && !value) continue;
    if (value == null) {
      if (field.rule === 'required') {
        // protobuf.js writes required fields even when unset, with their default.
        if (resolved?.kind === 'message') throw new TypeError(`${fullName(field)}: object expected`);
        w.tag(field.id, WIRE[resolved?.kind === 'enum' ? 'int32' : field.type] ?? 0);
        writeScalar(w, resolved?.kind === 'enum' ? 'int32' : field.type, scalarDefault(field, resolved));
      }
      continue;
    }
    const writeOne = (item: unknown) => {
      if (resolved?.kind === 'message') {
        if (typeof item !== 'object' || item === null) throw new TypeError(`${fullName(field)}: object expected`);
        w.tag(field.id, 2);
        w.delimited(encodeMessage(resolved, item, schema, depth + 1));
      } else if (resolved?.kind === 'enum') {
        const n = enumValue(resolved, item);
        if (n === undefined) return;
        w.tag(field.id, 0);
        writeScalar(w, 'int32', n);
      } else {
        w.tag(field.id, WIRE[field.type] ?? 0);
        writeScalar(w, field.type, item);
      }
    };
    if (field.keyType) {
      if (typeof value !== 'object') throw new TypeError(`${fullName(field)}: object expected`);
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const entry = new Writer();
        entry.tag(1, WIRE[field.keyType] ?? 0);
        writeScalar(entry, field.keyType, field.keyType === 'bool' ? key === 'true' : key);
        if (resolved?.kind === 'message') {
          entry.tag(2, 2);
          entry.delimited(encodeMessage(resolved, item, schema, depth + 1));
        } else {
          const t = resolved?.kind === 'enum' ? 'int32' : field.type;
          entry.tag(2, WIRE[t] ?? 0);
          writeScalar(entry, t, resolved?.kind === 'enum' ? (enumValue(resolved, item) ?? 0) : item);
        }
        w.tag(field.id, 2);
        w.delimited(entry.finish());
      }
    } else if (field.rule === 'repeated') {
      if (!Array.isArray(value)) throw new TypeError(`${fullName(field)}: array expected`);
      const scalar = resolved?.kind === 'enum' ? 'int32' : field.type;
      const packed = PACKABLE.has(scalar) && (field.options.packed === true || (schema.syntax === 'proto3' && field.options.packed !== false));
      if (packed && value.length) {
        const inner = new Writer();
        for (const item of value) {
          const v = resolved?.kind === 'enum' ? enumValue(resolved, item) : item;
          if (v !== undefined) writeScalar(inner, scalar, v);
        }
        w.tag(field.id, 2);
        w.delimited(inner.finish());
      } else for (const item of value) writeOne(item);
    } else writeOne(value);
  }
  return w.finish();
}

/* ------------------------------------------- CyberChef's schema-less parser --- */

type Raw = Record<string, unknown>;
interface FieldTypes {
  [field: string]: number | FieldTypes;
}

class ParseFail extends Error {
  constructor(
    message: string,
    readonly byteOffset: number,
  ) {
    super(message);
  }
}

/** A port of CyberChef's own Protobuf parser (lib/Protobuf.mjs). */
class RawParser {
  offset = 0;
  readonly fieldTypes: FieldTypes = {};

  constructor(readonly data: Uint8Array) {}

  parse(): Raw {
    const object: Raw = {};
    while (this.offset < this.data.length) {
      const { key, value } = this.field();
      const k = String(key);
      object[k] = Object.hasOwn(object, k) ? (Array.isArray(object[k]) ? [...(object[k] as unknown[]), value] : [object[k], value]) : value;
    }
    if (this.offset > this.data.length) throw new ParseFail('Exhausted Buffer', this.data.length);
    return object;
  }

  private exhausted(): never {
    throw new ParseFail('Exhausted Buffer', this.data.length);
  }

  private field(): { key: number; value: unknown } {
    const start = this.offset;
    if (this.offset >= this.data.length) this.exhausted();
    const type = (this.data[this.offset] as number) & 7;
    const key = this.fieldNumber();
    if (typeof this.fieldTypes[key] !== 'object') this.fieldTypes[key] = type;
    switch (type) {
      case 0:
        return { key, value: this.varint() };
      case 1: {
        if (this.offset + 8 > this.data.length) this.exhausted();
        const d = this.data;
        const o = this.offset;
        const lower = (d[o] as number) + (d[o + 1] as number) * 0x100 + (d[o + 2] as number) * 0x10000 + (d[o + 3] as number) * 0x1000000;
        const upper = (d[o + 4] as number) + (d[o + 5] as number) * 0x100 + (d[o + 6] as number) * 0x10000 + (d[o + 7] as number) * 0x1000000;
        this.offset += 8;
        return { key, value: upper * 0x100000000 + lower };
      }
      case 2:
        return { key, value: this.lengthDelimited(key) };
      case 5: {
        if (this.offset + 4 > this.data.length) this.exhausted();
        const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(0, true);
        this.offset += 4;
        return { key, value };
      }
      default:
        throw new ParseFail(`Unknown type 0x${type.toString(16)}`, start);
    }
  }

  private fieldNumber(): number {
    let shift = -3;
    let number = 0;
    let byte: number;
    do {
      if (this.offset >= this.data.length) this.exhausted();
      byte = this.data[this.offset] as number;
      number += shift < 28 ? (shift === -3 ? (byte & 0x78) >> 3 : (byte & 0x7f) << shift) : (byte & 0x7f) * 2 ** shift;
      shift += 7;
      this.offset++;
    } while ((byte & 0x80) === 0x80);
    return number;
  }

  private varint(): number {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      if (this.offset >= this.data.length) this.exhausted();
      byte = this.data[this.offset] as number;
      value += shift < 28 ? (byte & 0x7f) << shift : (byte & 0x7f) * 2 ** shift;
      shift += 7;
      this.offset++;
    } while ((byte & 0x80) === 0x80);
    return value;
  }

  private lengthDelimited(key: number): unknown {
    const length = this.varint();
    if (this.offset + length > this.data.length) this.exhausted();
    const bytes = this.data.slice(this.offset, this.offset + length);
    let value: unknown;
    try {
      const inner = new RawParser(bytes);
      value = inner.parse();
      const previous = this.fieldTypes[key];
      this.fieldTypes[key] = { ...(typeof previous === 'object' ? previous : {}), ...inner.fieldTypes };
    } catch {
      // Not a message: text when it is valid UTF-8, otherwise one character per byte.
      try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        value = bytesToLatin1(bytes);
      }
    }
    this.offset += length;
    return value;
  }
}

const WIRE_NAMES: Record<number, string> = {
  0: 'VarInt (e.g. int32, bool)',
  1: '64-Bit (e.g. fixed64, double)',
  2: 'L-delim (e.g. string, message)',
  5: '32-Bit (e.g. fixed32, float)',
};

function showRawTypes(raw: Raw, types: FieldTypes): Raw {
  const out: Raw = {};
  for (const [field, value] of Object.entries(raw)) {
    const type = types[field];
    let shown = value;
    let wire: number;
    if (typeof type === 'object') {
      wire = 2;
      shown = Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : showRawTypes(v as Raw, type))) : showRawTypes(value as Raw, type);
    } else wire = type ?? 0;
    out[`field #${field}: ${WIRE_NAMES[wire] ?? 'undefined'}`] = shown;
  }
  return out;
}

/** The raw fields the schema does not describe (CyberChef's compareFields). */
function compareFields(raw: Raw, message: ProtoMessage | undefined, schema: ProtoSchema, label: (f: ProtoField) => string): Raw {
  if (!message) return raw;
  const out: Raw = { ...raw };
  for (const key of Object.keys(raw)) {
    const id = /^field #(\d+)/.exec(key)?.[1] ?? key;
    const field = message.fields.find((f) => String(f.id) === id);
    if (!field) continue;
    const name = label(field);
    const data = raw[key];
    if (Array.isArray(data) && field.rule !== 'repeated') out[`(${message.name}) ${name} is a repeated field`] = data;
    const resolved = resolve(field, schema);
    if (resolved?.kind === 'message') {
      let merged: Raw = {};
      if (Array.isArray(data)) for (const instance of data) Object.assign(merged, typeof instance === 'object' ? instance : {});
      else merged = (typeof data === 'object' ? data : {}) as Raw;
      const missing = compareFields(merged, resolved, schema, label);
      if (Object.keys(missing).length) out[`${name} (${field.type}) has missing fields`] = missing;
    }
    delete out[key];
  }
  return out;
}

/* ------------------------------------------------------------ operations --- */

function loadSchema(text: string): ProtoSchema {
  try {
    return parseProto(text);
  } catch (error) {
    throw new OpError(`Schema Error: ${(error as Error).message}`);
  }
}

const mainMessage = (schema: ProtoSchema): ProtoMessage | undefined => schema.top.nested.find((n): n is ProtoMessage => n.kind === 'message');

export function protobufDecode(input: Uint8Array, schemaText: string, showUnknown: boolean, showTypes: boolean): unknown {
  const schema = loadSchema(schemaText);
  const parser = new RawParser(input);
  let raw: Raw;
  try {
    raw = parser.parse();
  } catch (error) {
    const fail = error as ParseFail;
    throw new OpError(`${fail.message}${Number.isInteger(fail.byteOffset) ? ` at byte offset ${fail.byteOffset}` : ''}`);
  }
  if (showTypes) raw = showRawTypes(raw, parser.fieldTypes);
  const message = mainMessage(schema);
  if (!message) return raw;
  const label = (f: ProtoField) => (showTypes ? `${f.name} (${f.type})` : f.name);
  let decoded: Record<string, unknown>;
  try {
    const reader = new Reader(input);
    decoded = toObject(message, decodeMessage(message, reader, input.length, schema, 0), schema, label);
  } catch (error) {
    const offset = error instanceof RangeFail ? error.byteOffset : undefined;
    const text = error instanceof RangeFail ? error.message : `Error: ${(error as Error).message}`;
    throw new OpError(`Input ${text}${offset !== undefined ? ` at byte offset ${offset}` : ''}`);
  }
  if (!showUnknown) return decoded;
  return { [message.name]: decoded, 'Unknown Fields': compareFields(raw, message, schema, label) };
}

export function protobufEncode(input: unknown, schemaText: string): Uint8Array {
  const schema = loadSchema(schemaText);
  const message = mainMessage(schema);
  if (!message) throw new OpError('Schema Error: Schema not defined');
  try {
    return encodeMessage(message, input, schema);
  } catch (error) {
    throw new OpError(`${error instanceof TypeError ? 'TypeError' : 'Error'}: ${(error as Error).message}`);
  }
}

const SCHEMA_HELP = 'The .proto definition. Its first message is the one used; leave empty to decode without a schema.';

export const protobufOps: Operation[] = [
  defineOp({
    name: 'Protobuf Decode',
    category: 'Networking',
    description:
      'Decodes Protocol Buffers data to JSON. Without a schema, fields are shown by number; with a .proto schema they get their names, types and defaults, and fields the schema does not describe can be listed separately.',
    input: 'bytes',
    output: 'text',
    keywords: ['protocol buffers', 'grpc', 'proto'],
    args: [txt('schema', 'Schema (.proto text)', '', { help: SCHEMA_HELP }), bool('unknown', 'Show Unknown Fields'), bool('types', 'Show Types')],
    run: (input, a) => JSON.stringify(protobufDecode(input, sArg(a, 'schema'), bArg(a, 'unknown'), bArg(a, 'types')), null, 4),
  }),
  defineOp({
    name: 'Protobuf Encode',
    category: 'Networking',
    description: 'Encodes JSON as Protocol Buffers using a .proto schema (its first message). Field names must match the schema; enums may be given by name or number and bytes as Base64.',
    input: 'text',
    output: 'bytes',
    keywords: ['protocol buffers', 'grpc', 'proto'],
    args: [txt('schema', 'Schema (.proto text)', '', { help: 'The .proto definition; its first message is the one used.' })],
    run: (input, a) => {
      let data: unknown;
      try {
        data = JSON.parse(input);
      } catch (error) {
        throw new OpError(`The input is not valid JSON: ${(error as Error).message}`);
      }
      return protobufEncode(data, sArg(a, 'schema'));
    },
  }),
];
