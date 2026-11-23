/**
 * Avro to JSON: reads an Avro object container file (header, schema, blocks)
 * and decodes its records with the schema it carries.  Values come out as the
 * avsc library that CyberChef uses gives them: unions unwrapped unless two
 * branches look alike in JSON, bytes and fixed as Node Buffer objects.
 */
import { inflateSync } from 'fflate';
import { bArg, bool, defineOp, OpError, type Operation } from '../core';

type Schema =
  | string
  | Schema[]
  | { type: Schema | string; name?: string; namespace?: string; fields?: { name: string; type: Schema }[]; symbols?: string[]; items?: Schema; values?: Schema; size?: number };

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.bytes.length) throw new Error('truncated');
    return this.bytes[this.pos++] as number;
  }

  /** Zig-zag varint, as a number (exact up to 2^53). */
  long(): number {
    let shift = 0;
    let value = 0n;
    for (;;) {
      const b = this.byte();
      value |= BigInt(b & 0x7f) << BigInt(shift);
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 63) throw new Error('varint too long');
    }
    return Number((value >> 1n) ^ -(value & 1n));
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.pos + length > this.bytes.length) throw new Error('truncated');
    const out = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  float(): number {
    const b = this.take(4);
    return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
  }

  double(): number {
    const b = this.take(8);
    return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true);
  }

  string(): string {
    return new TextDecoder().decode(this.take(this.long()));
  }

  done(): boolean {
    return this.pos >= this.bytes.length;
  }
}

const buffer = (bytes: Uint8Array) => ({ type: 'Buffer', data: Array.from(bytes) });

/** Snappy block decompression (used by the "snappy" codec, which appends a CRC-32). */
export function unsnappy(input: Uint8Array): Uint8Array {
  const r = new Reader(input);
  let length = 0;
  for (let shift = 0; ; shift += 7) {
    const b = r.byte();
    length |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
  }
  const out = new Uint8Array(length);
  let o = 0;
  while (!r.done()) {
    const tag = r.byte();
    const kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) {
        const extra = len - 59;
        len = 0;
        for (let i = 0; i < extra; i++) len |= r.byte() << (8 * i);
      }
      out.set(r.take(len + 1), o);
      o += len + 1;
      continue;
    }
    let len: number;
    let offset: number;
    if (kind === 1) {
      len = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | r.byte();
    } else if (kind === 2) {
      len = (tag >> 2) + 1;
      offset = r.byte() | (r.byte() << 8);
    } else {
      len = (tag >> 2) + 1;
      offset = (r.byte() | (r.byte() << 8) | (r.byte() << 16) | (r.byte() << 24)) >>> 0;
    }
    if (offset === 0 || offset > o) throw new Error('bad snappy offset');
    for (let i = 0; i < len; i++, o++) out[o] = out[o - offset] as number;
  }
  return out;
}

class Decoder {
  readonly names = new Map<string, Exclude<Schema, string | Schema[]>>();

  constructor(root: Schema) {
    this.register(root, '');
  }

  private fullName(name: string, namespace: string): string {
    return name.includes('.') || !namespace ? name : `${namespace}.${name}`;
  }

  private register(schema: Schema, namespace: string): void {
    if (typeof schema === 'string') return;
    if (Array.isArray(schema)) {
      for (const branch of schema) this.register(branch, namespace);
      return;
    }
    const type = schema.type;
    if (typeof type !== 'string') {
      this.register(type, namespace);
      return;
    }
    if (type === 'record' || type === 'error' || type === 'enum' || type === 'fixed') {
      const space = schema.namespace ?? (schema.name?.includes('.') ? schema.name.slice(0, schema.name.lastIndexOf('.')) : namespace);
      if (schema.name) {
        this.names.set(this.fullName(schema.name, space), schema);
        // References may also use the short name.
        const short = schema.name.split('.').pop() as string;
        if (!this.names.has(short)) this.names.set(short, schema);
      }
      for (const field of schema.fields ?? []) this.register(field.type, space);
    }
    if (type === 'array' && schema.items !== undefined) this.register(schema.items, namespace);
    if (type === 'map' && schema.values !== undefined) this.register(schema.values, namespace);
  }

  private resolve(schema: Schema): Schema {
    if (typeof schema === 'string' && !PRIMITIVES.has(schema)) {
      const named = this.names.get(schema) ?? this.names.get(schema.split('.').pop() as string);
      if (!named) throw new Error(`unknown type ${schema}`);
      return named;
    }
    return schema;
  }

  /** The JSON "bucket" avsc sorts union branches into; two branches in one bucket force wrapping. */
  private bucket(schema: Schema): string {
    const s = this.resolve(schema);
    const type = typeof s === 'string' ? s : Array.isArray(s) ? 'union' : typeof s.type === 'string' ? s.type : 'union';
    if (['int', 'long', 'float', 'double'].includes(type)) return 'number';
    if (type === 'bytes' || type === 'fixed') return 'buffer';
    if (type === 'string' || type === 'enum') return 'string';
    if (type === 'record' || type === 'error' || type === 'map') return 'object';
    return type;
  }

  private branchName(schema: Schema): string {
    const s = this.resolve(schema);
    if (typeof s === 'string') return s;
    if (Array.isArray(s)) return 'union';
    if (s.name) return s.namespace && !s.name.includes('.') ? `${s.namespace}.${s.name}` : s.name;
    return typeof s.type === 'string' ? s.type : 'union';
  }

  read(schema: Schema, r: Reader): unknown {
    const s = this.resolve(schema);
    if (Array.isArray(s)) {
      const index = r.long();
      const branch = s[index];
      if (branch === undefined) throw new Error('bad union index');
      const value = this.read(branch, r);
      const buckets = s.map((b) => this.bucket(b));
      const wrapped = new Set(buckets).size !== buckets.length;
      if (!wrapped || value === null) return value;
      return { [this.branchName(branch)]: value };
    }
    const type = typeof s === 'string' ? s : s.type;
    if (typeof type !== 'string') return this.read(type, r);
    switch (type) {
      case 'null':
        return null;
      case 'boolean':
        return r.byte() !== 0;
      case 'int':
      case 'long':
        return r.long();
      case 'float':
        return r.float();
      case 'double':
        return r.double();
      case 'bytes':
        return buffer(r.take(r.long()));
      case 'string':
        return r.string();
      case 'fixed':
        return buffer(r.take((s as { size: number }).size));
      case 'enum': {
        const symbol = (s as { symbols: string[] }).symbols[r.long()];
        if (symbol === undefined) throw new Error('bad enum index');
        return symbol;
      }
      case 'array':
      case 'map': {
        const out: unknown[] = [];
        const map: Record<string, unknown> = {};
        for (let count = r.long(); count !== 0; count = r.long()) {
          if (count < 0) {
            count = -count;
            r.long(); // block size in bytes
          }
          for (let i = 0; i < count; i++) {
            if (type === 'map') {
              const key = r.string();
              map[key] = this.read((s as { values: Schema }).values, r);
            } else out.push(this.read((s as { items: Schema }).items, r));
          }
        }
        return type === 'map' ? map : out;
      }
      case 'record':
      case 'error': {
        const out: Record<string, unknown> = {};
        for (const field of (s as { fields: { name: string; type: Schema }[] }).fields) out[field.name] = this.read(field.type, r);
        return out;
      }
      default:
        throw new Error(`unknown type ${type}`);
    }
  }
}

const PRIMITIVES = new Set(['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string']);

/** The container's schema, codec and other metadata, without decoding the records. */
export function readAvroMeta(bytes: Uint8Array): { schema: unknown; codec: string; meta: Record<string, string> } {
  const r = new Reader(bytes);
  const magic = r.take(4);
  if (magic[0] !== 0x4f || magic[1] !== 0x62 || magic[2] !== 0x6a || magic[3] !== 1) throw new Error('not an Avro container');
  const meta: Record<string, string> = {};
  for (let count = r.long(); count !== 0; count = r.long()) {
    if (count < 0) {
      count = -count;
      r.long();
    }
    for (let i = 0; i < count; i++) meta[r.string()] = new TextDecoder().decode(r.take(r.long()));
  }
  const schema = JSON.parse(meta['avro.schema'] ?? 'null') as unknown;
  return { schema, codec: meta['avro.codec'] ?? 'null', meta };
}

export function readAvroContainer(bytes: Uint8Array): unknown[] {
  const r = new Reader(bytes);
  const magic = r.take(4);
  if (magic[0] !== 0x4f || magic[1] !== 0x62 || magic[2] !== 0x6a || magic[3] !== 1) throw new Error('not an Avro container');
  const meta = new Map<string, Uint8Array>();
  for (let count = r.long(); count !== 0; count = r.long()) {
    if (count < 0) {
      count = -count;
      r.long();
    }
    for (let i = 0; i < count; i++) meta.set(r.string(), r.take(r.long()));
  }
  const sync = r.take(16);
  const schemaBytes = meta.get('avro.schema');
  if (!schemaBytes) throw new Error('no schema');
  const root = JSON.parse(new TextDecoder().decode(schemaBytes)) as Schema;
  const decoder = new Decoder(root);
  const codec = meta.has('avro.codec') ? new TextDecoder().decode(meta.get('avro.codec')) : 'null';
  const records: unknown[] = [];
  while (!r.done()) {
    const count = r.long();
    const size = r.long();
    let block = r.take(size);
    if (codec === 'deflate') block = inflateSync(block);
    else if (codec === 'snappy') block = unsnappy(block.subarray(0, block.length - 4));
    else if (codec !== 'null') throw new Error(`unsupported codec ${codec}`);
    const br = new Reader(block);
    for (let i = 0; i < count; i++) records.push(decoder.read(root, br));
    const marker = r.take(16);
    if (marker.some((b, i) => b !== sync[i])) throw new Error('bad sync marker');
  }
  return records;
}

export const avroOps: Operation[] = [
  defineOp({
    name: 'Avro to JSON',
    category: 'Data format',
    description: 'Converts an Avro object container file (with the null, deflate or snappy codec) to JSON, using the schema stored in the file.',
    input: 'bytes',
    output: 'text',
    keywords: ['apache avro', 'hadoop', 'kafka'],
    args: [bool('force', 'Force Valid JSON', true)],
    run: (input, a) => {
      if (input.length === 0) throw new OpError('Please provide an input.');
      let records: unknown[];
      try {
        records = readAvroContainer(input);
      } catch {
        throw new OpError('Error parsing Avro file.');
      }
      if (bArg(a, 'force')) return records.length === 1 ? JSON.stringify(records[0], null, 4) : JSON.stringify(records, null, 4);
      return records.map((record) => `${JSON.stringify(record)}\n`).join('');
    },
  }),
];
