import { createRequire } from 'node:module';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import tool from '../../src/tools/text/json-to-code';

const SAMPLE = JSON.stringify({
  museum_id: 101,
  name: "O'Brien Hall",
  rating: 4.6,
  open: true,
  address: { city: 'Bengaluru', pin: '560001' },
  galleries: [
    { title: 'Engines', exhibits: 42, curator: null },
    { title: 'Space', exhibits: 31, curator: 'A. Rao', tags: ['rockets'] },
  ],
});

async function convert(language: string, input = SAMPLE, rootName = 'Museum'): Promise<string> {
  const result = await tool.run(input, { language, rootName } as never, { input2: '', file: null, nonce: 0 });
  return typeof result === 'string' ? result : (result.output ?? '');
}

describe('JSON to Code: schemas and tables', () => {
  it('builds SQLite tables that SQLite accepts, parents first, with the rows inserted', async () => {
    const sql = await convert('sqlite');
    // node:sqlite is built into Node 22; load it lazily so other runtimes skip cleanly.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(sql);
    expect(db.prepare('SELECT name, open, address_id FROM museum').all()).toEqual([{ name: "O'Brien Hall", open: 1, address_id: 1 }]);
    expect(db.prepare('SELECT city FROM address').all()).toEqual([{ city: 'Bengaluru' }]);
    expect(db.prepare('SELECT title, curator, tags, museum_id FROM gallery ORDER BY id').all()).toEqual([
      { title: 'Engines', curator: null, tags: null, museum_id: 1 },
      { title: 'Space', curator: 'A. Rao', tags: '["rockets"]', museum_id: 1 },
    ]);
    const columns = (db.prepare('PRAGMA table_info(gallery)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(['id', 'title', 'exhibits', 'curator', 'tags', 'museum_id']);
    expect(sql.indexOf('CREATE TABLE address')).toBeLessThan(sql.indexOf('CREATE TABLE museum'));
    expect(sql.indexOf('CREATE TABLE museum')).toBeLessThan(sql.indexOf('CREATE TABLE gallery'));
  });

  it('quotes reserved words, keeps an own id and escapes MySQL strings', async () => {
    const sql = await convert('mysql', '[{"id": 7, "order": 1, "note": "a\\\\b \'c\'"}]', 'Rows');
    expect(sql).toContain('id BIGINT PRIMARY KEY');
    expect(sql).toContain('`order` BIGINT NOT NULL');
    expect(sql).toContain("(7, 1, 'a\\\\b ''c''')");
    const pg = await convert('postgres');
    expect(pg).toContain('tags JSONB');
    expect(pg).toContain("SELECT setval(pg_get_serial_sequence('gallery', 'id'), (SELECT MAX(id) FROM gallery));");
  });

  it('writes Zod schemas that type-check, children first', async () => {
    const code = await convert('zod');
    expect(code.indexOf('export const Gallery')).toBeLessThan(code.indexOf('export const Museum'));
    expect(code).toContain('curator: z.string().nullable(),');
    expect(code).toContain('tags: z.array(z.string()).optional(),');
    // acorn reads JavaScript, so drop the type-only lines first.
    expect(() => parse(code.replace(/^export type .*$/gm, ''), { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow();
  });

  it('writes Pydantic, GraphQL, Protocol Buffers and Mongoose', async () => {
    const py = await convert('pydantic', '{"first-name": "A", "class": 3, "nick": null}', 'Person');
    expect(py).toContain('first_name: str = Field(alias="first-name")');
    expect(py).toContain('class_: int = Field(alias="class")');
    expect(py).toContain('nick: Optional[Any] = None');
    expect(py).toContain('model_config = ConfigDict(populate_by_name=True)');

    const gql = await convert('graphql');
    expect(gql).toContain('galleries: [Gallery!]!');
    expect(gql).toContain('curator: String\n');
    expect(gql).toContain('type Query {\n  museum: Museum\n}');

    const proto = await convert('protobuf');
    expect(proto).toContain('int64 museum_id = 1 [json_name = "museum_id"];');
    expect(proto).toContain('optional string curator = 3;');
    expect(proto).toContain('repeated Gallery galleries = 6;');
    expect(await convert('protobuf', '{"meta": null, "rows": [[1, 2]]}', 'Doc')).toContain('import "google/protobuf/struct.proto";');

    const mongoose = await convert('mongoose');
    expect(mongoose).toContain('address: { type: addressSchema, required: true },');
    expect(mongoose).toContain('galleries: [gallerySchema],');
    expect(mongoose).toContain('export const Museum = mongoose.model("Museum", museumSchema);');
    expect(() => parse(mongoose, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow();
  });
});
