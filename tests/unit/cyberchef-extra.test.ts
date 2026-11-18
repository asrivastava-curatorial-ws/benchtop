/**
 * CyberChef's own tests for the operations Benchtop rebuilt natively (Avro,
 * PGP, Template, charts, Show on map, Render PDF, Protobuf), taken from its
 * repository by scripts/cyberchef-tests.mjs into fixtures/cyberchef-extra-cases.json.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalog, findOperation } from '../../src/recipe/catalog';
import { toBytes, toText } from '../../src/recipe/core';
import { bake } from '../../src/recipe/engine';
import { parseRecipe } from '../../src/recipe/format';

interface Case {
  readonly file: string;
  readonly name: string;
  readonly input: string;
  readonly recipe: readonly { op: string; args: unknown[] }[];
  readonly expected?: string;
  readonly match?: { source: string; flags: string };
  readonly unexpected?: { source: string; flags: string };
}

const cases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/cyberchef-extra-cases.json', import.meta.url), 'utf8'));

/** Where Benchtop deliberately differs from CyberChef. */
const DIFFERENT: Record<string, string> = {
  // CyberChef answers with an <iframe> of the PDF; Benchtop passes the PDF on and draws its pages in the preview.
  'RenderPDF:1': 'Render PDF outputs the PDF itself',
  // Show on map parses coordinates with CyberChef's own code, which runs in the browser: see tests/e2e/cyberchef-port.spec.ts.
  'ShowOnMap:0': 'checked in the browser',
  'ShowOnMap:1': 'checked in the browser',
  // CyberChef rejects an empty choice in a list; Benchtop's lists always hold one of their choices.
  'ShowOnMap:2': 'lists cannot be empty',
  'ShowOnMap:3': 'lists cannot be empty',
};

async function output(c: Case): Promise<string> {
  const parsed = parseRecipe(JSON.stringify(c.recipe), findOperation);
  expect(parsed.unknown, c.name).toEqual([]);
  const outcome = await bake(c.input, parsed.steps, catalog);
  if (outcome.error) return outcome.error.message;
  return toText(toBytes(outcome.value));
}

describe('CyberChef’s tests for natively rebuilt operations', () => {
  const seen = new Map<string, number>();
  for (const c of cases) {
    const index = seen.get(c.file) ?? 0;
    seen.set(c.file, index + 1);
    const reason = DIFFERENT[`${c.file}:${index}`];
    it.skipIf(reason !== undefined)(
      `${c.file}: ${c.name}${reason ? ` (${reason})` : ''}`,
      async () => {
        const got = await output(c);
        if (c.expected !== undefined) expect(got).toBe(c.expected);
        if (c.match) expect(got).toMatch(new RegExp(c.match.source, c.match.flags));
        if (c.unexpected) expect(got).not.toMatch(new RegExp(c.unexpected.source, c.unexpected.flags));
      },
      60_000,
    );
  }
});
