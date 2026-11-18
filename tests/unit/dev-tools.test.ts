import { x25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { fromBase64 } from '../../src/lib/bytes';
import { bandsFor, formatOhms, nearest, parseOhms, readBands, readCapacitor, readSmd } from '../../src/lib/components';
import { apiMarkdown, findAll, inspect, parseHar, parseHexPattern, parseOpenApi } from '../../src/lib/dev-formats';
import { instantIn, offsetMinutes, publicFor, wireguardKeys } from '../../src/lib/engineering';
import { parseGcode } from '../../src/lib/gcode';
import { parseTables, toMermaid } from '../../src/lib/sql-er';

describe('SQL to ER diagram', () => {
  const sql = `
    CREATE TABLE "public"."users" (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, created_at TIMESTAMP WITH TIME ZONE DEFAULT now());
    -- comment
    CREATE TABLE IF NOT EXISTS orders (
      id INT NOT NULL,
      user_id INT NOT NULL REFERENCES users(id),
      coupon_id INT,
      total NUMERIC(10, 2) CHECK (total >= 0),
      PRIMARY KEY (id),
      CONSTRAINT fk_coupon FOREIGN KEY (coupon_id) REFERENCES coupons (id)
    );
    CREATE TABLE coupons (id INT PRIMARY KEY, code TEXT);`;
  it('reads tables, keys and references', () => {
    const tables = parseTables(sql);
    expect(tables.map((t) => t.name)).toEqual(['users', 'orders', 'coupons']);
    const orders = tables[1];
    expect(orders?.columns.map((c) => `${c.name}:${c.type}`)).toEqual(['id:INT', 'user_id:INT', 'coupon_id:INT', 'total:NUMERIC(10, 2)']);
    expect(orders?.columns[0]?.primary).toBe(true);
    expect(orders?.columns[1]?.references).toEqual({ table: 'users', column: 'id' });
    expect(orders?.columns[2]?.references).toEqual({ table: 'coupons', column: 'id' });
    expect(tables[0]?.columns[2]?.type).toBe('TIMESTAMP WITH TIME ZONE');
  });
  it('writes a Mermaid erDiagram with cardinalities', () => {
    const text = toMermaid(parseTables(sql));
    expect(text).toContain('erDiagram');
    expect(text).toContain('NUMERIC_10_2 total');
    expect(text).toContain('VARCHAR_255 email UK');
    expect(text).toContain('orders }o--|| users : "user_id"');
    expect(text).toContain('orders }o--o| coupons : "coupon_id"');
  });
});

describe('component codes', () => {
  it('reads resistor bands', () => {
    expect(readBands(['yellow', 'violet', 'red', 'gold'])).toEqual({ ohms: 4700, tolerance: 5, tempco: undefined });
    expect(readBands(['brown', 'black', 'black', 'red', 'brown']).ohms).toBe(10000);
    expect(readBands(['red', 'red', 'gold', 'gold']).ohms).toBe(2.2);
    expect(readBands(['orange', 'orange', 'black', 'black', 'brown', 'red']).tempco).toBe(50);
  });
  it('turns values into bands and finds preferred values', () => {
    expect(bandsFor(4700, 2)).toEqual(['yellow', 'violet', 'red']);
    expect(bandsFor(0.47, 2)).toEqual(['yellow', 'violet', 'silver']);
    expect(bandsFor(10000, 3)).toEqual(['brown', 'black', 'black', 'red']);
    expect(parseOhms('4k7')).toBe(4700);
    expect(parseOhms('2M2')).toBe(2200000);
    expect(parseOhms('0R47')).toBe(0.47);
    expect(parseOhms('1.5k')).toBe(1500);
    expect(formatOhms(4700)).toBe('4.7 kΩ');
    expect(nearest(5000, 'E12')).toEqual({ below: 4700, above: 5600, closest: 4700 });
    expect(nearest(100, 'E24').closest).toBe(100);
  });
  it('reads SMD resistor codes', () => {
    expect(readSmd('103').ohms).toBe(10000);
    expect(readSmd('4702').ohms).toBe(47000);
    expect(readSmd('4R7').ohms).toBe(4.7);
    expect(readSmd('R10').ohms).toBe(0.1);
    expect(readSmd('01C').ohms).toBe(10000);
    expect(readSmd('68X').ohms).toBe(49.9);
    expect(() => readSmd('ZZZ')).toThrow();
  });
  it('reads capacitor codes', () => {
    expect(readCapacitor('104')).toEqual({ picofarads: 100000, tolerance: undefined, volts: undefined });
    expect(readCapacitor('104K').tolerance).toBe('±10%');
    expect(readCapacitor('2A104J')).toEqual({ picofarads: 100000, tolerance: '±5%', volts: 100 });
    expect(readCapacitor('4n7').picofarads).toBe(4700);
    expect(readCapacitor('0.1').picofarads).toBe(100000);
    expect(readCapacitor('47').picofarads).toBe(47);
    expect(readCapacitor('229').picofarads).toBe(2.2);
  });
});

describe('OpenAPI, HAR and hex', () => {
  const swagger = JSON.stringify({
    swagger: '2.0',
    info: { title: 'Pets', version: '1' },
    host: 'api.example.org',
    basePath: '/v2',
    paths: {
      '/pets/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, type: 'integer' }],
        get: { summary: 'One pet', responses: { 200: { description: 'ok', schema: { $ref: '#/definitions/Pet' } } } },
        post: { parameters: [{ in: 'body', name: 'pet', required: true, schema: { $ref: '#/definitions/Pet' } }], responses: { 201: { description: 'made' } } },
      },
    },
    definitions: { Pet: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } },
  });
  it('reads Swagger 2 with shared parameters, bodies and references', () => {
    const api = parseOpenApi(swagger);
    expect(api.servers).toEqual(['https://api.example.org/v2']);
    expect(api.operations.map((o) => `${o.method} ${o.path}`)).toEqual(['GET /pets/{id}', 'POST /pets/{id}']);
    expect(api.operations[0]?.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true, type: 'integer' });
    expect(api.operations[0]?.responses[0]?.schema).toBe('Pet');
    expect(api.operations[1]?.body).toEqual({ types: ['application/json'], schema: 'Pet', required: true });
    expect(api.schemas[0]?.properties).toEqual([
      { name: 'name', type: 'string', required: true, description: '' },
      { name: 'tags', type: 'array of string', required: false, description: '' },
    ]);
    expect(apiMarkdown(api)).toContain('## GET `/pets/{id}`');
    expect(() => parseOpenApi('{"hello": 1}')).toThrow(/not an OpenAPI/);
  });
  it('reads a HAR file', () => {
    const har = parseHar(
      JSON.stringify({
        log: {
          creator: { name: 'Firefox', version: '120' },
          entries: [
            {
              startedDateTime: '2026-01-01T00:00:00.000Z',
              time: 120,
              request: { method: 'GET', url: 'https://a.example/', headers: [] },
              response: { status: 200, headers: [{ name: 'content-type', value: 'text/html' }], content: { mimeType: 'text/html; charset=utf-8', size: 1000, text: '<p>hi</p>' }, bodySize: 400 },
              timings: { wait: 80, receive: 40, blocked: -1 },
            },
            {
              startedDateTime: '2026-01-01T00:00:00.050Z',
              time: 30,
              request: { method: 'POST', url: 'https://a.example/api', headers: [], postData: { text: '{}' } },
              response: { status: 500, headers: [], content: { mimeType: 'application/json', size: 10 } },
            },
          ],
        },
      }),
    );
    expect(har.entries).toHaveLength(2);
    expect(har.entries[0]).toMatchObject({ kind: 'document', size: 400, start: 0, timings: { wait: 80, receive: 40 } });
    expect(har.entries[1]).toMatchObject({ kind: 'xhr', start: 50, requestBody: '{}', status: 500 });
    expect(har.total).toBe(120);
    expect(har.creator).toBe('Firefox 120');
  });
  it('inspects and searches bytes', () => {
    const bytes = Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef, 0xde, 0xad]);
    const little = Object.fromEntries(inspect(bytes, 0, true).map((r) => [r.label, r.value]));
    expect(little['uint32 / int32']).toBe('1 / 1');
    expect(Object.fromEntries(inspect(bytes, 0, false).map((r) => [r.label, r.value]))['uint32 / int32']).toBe('16777216 / 16777216');
    expect(findAll(bytes, parseHexPattern('DE AD'))).toEqual([4, 8]);
    expect(findAll(bytes, parseHexPattern('0xDEADBEEF'))).toEqual([4]);
    expect(() => parseHexPattern('XYZ')).toThrow();
  });
});

describe('G-code, WireGuard and time zones', () => {
  it('follows G-code moves, arcs and relative mode', () => {
    const path = parseGcode('G21\nG90\nG0 X0 Y0 Z0.2\nG1 X10 Y0 E1\nG1 X10 Y10 E2 ; side\nG2 X0 Y10 I-5 J0 E3\nG91\nG1 Z0.2\nG90\nG1 X0 Y0 E4');
    expect(path.layers).toBe(2);
    expect(path.box.slice(0, 2)).toEqual([0, 0]);
    expect(path.box[3]).toBeCloseTo(10, 5);
    expect(path.box[4]).toBeGreaterThanOrEqual(10);
    expect(path.length).toBeGreaterThan(20 + Math.PI * 5 - 0.5);
    expect(path.segments.length % 6).toBe(0);
  });
  it('makes WireGuard keys like wg genkey and wg pubkey', () => {
    const keys = wireguardKeys();
    expect(fromBase64(keys.privateKey)).toHaveLength(32);
    expect(keys.publicKey).toBe(publicFor(keys.privateKey));
    // RFC 7748 test vector (Alice).
    const alice = Uint8Array.from(Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex'));
    expect(Buffer.from(x25519.getPublicKey(alice)).toString('hex')).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
    expect(publicFor(Buffer.from(alice).toString('base64'))).toBe(Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'hex').toString('base64'));
  });
  it('converts wall-clock times between zones, with daylight saving', () => {
    expect(offsetMinutes('Asia/Kolkata', new Date('2026-07-01T00:00:00Z'))).toBe(330);
    expect(offsetMinutes('Europe/London', new Date('2026-07-01T00:00:00Z'))).toBe(60);
    expect(offsetMinutes('Europe/London', new Date('2026-01-01T00:00:00Z'))).toBe(0);
    expect(instantIn('Asia/Kolkata', '2026-11-17T09:30').toISOString()).toBe('2026-11-17T04:00:00.000Z');
    expect(instantIn('America/New_York', '2026-07-04T12:00').toISOString()).toBe('2026-07-04T16:00:00.000Z');
  });
});
