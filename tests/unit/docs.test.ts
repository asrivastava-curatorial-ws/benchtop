/**
 * docs/TOOLS.md is generated from the registry so it cannot drift from the app.
 * Run `UPDATE_DOCS=1 pnpm test docs` after adding or renaming a tool.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, NOT_INCLUDED, TOOLS } from '../../src/tools/registry';

const PATH = new URL('../../docs/TOOLS.md', import.meta.url);

/** Table cells may not contain raw pipes or tags. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(): string {
  const lines: string[] = [
    '# Tools',
    '',
    '<!-- Generated from src/tools/registry.ts by tests/unit/docs.test.ts. Do not edit by hand. -->',
    '',
    `Benchtop has ${TOOLS.length} tools. Every one of them works without a network connection.`,
    '',
  ];
  for (const category of CATEGORIES) {
    const tools = TOOLS.filter((tool) => tool.category === category.id);
    if (tools.length === 0) continue;
    lines.push(`## ${category.name}`, '', '| Tool | What it does | Replaces |', '| --- | --- | --- |');
    for (const tool of tools) lines.push(`| ${cell(tool.name)} | ${cell(tool.description)} | ${cell((tool.covers ?? []).join(', '))} |`);
    lines.push('');
  }
  const covered = TOOLS.flatMap((tool) => (tool.covers ?? []).map((name) => [name, tool.name] as const)).sort((a, b) => a[0].localeCompare(b[0]));
  lines.push('## Coverage of the original web tools', '', `${covered.length} web tools map onto Benchtop tools:`, '', '| Web tool | Benchtop tool |', '| --- | --- |');
  for (const [web, local] of covered) lines.push(`| ${cell(web)} | ${cell(local)} |`);
  lines.push('', '### Not included', '');
  for (const item of NOT_INCLUDED) lines.push(`- **${item.name}**: ${item.reason}`);
  lines.push(
    '',
    '### Differences from the web versions',
    '',
    '- **llms.txt Generator** cannot fetch a sitemap; paste the sitemap XML instead.',
    '- **HTML Playground** previews HTML and CSS, but scripts do not run in the preview (Bootstrap styles work; its interactive components need your real page).',
    '- **CSS to Tailwind** converts declarations to utility classes but does not render the result to compare it visually.',
    '- **Bootstrap Theme Builder** compiles Bootstrap 5.3.9 itself with Dart Sass; it ships five original starting themes rather than third-party theme galleries.',
    '',
  );
  return lines.join('\n');
}

describe('generated documentation', () => {
  it('docs/TOOLS.md matches the registry', () => {
    const expected = render();
    if (process.env.UPDATE_DOCS) writeFileSync(PATH, expected);
    expect(existsSync(PATH), 'docs/TOOLS.md is missing: run UPDATE_DOCS=1 pnpm test docs').toBe(true);
    expect(readFileSync(PATH, 'utf8')).toBe(expected);
  });

  it('gives every tool a unique id, a category and a description', () => {
    const ids = TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of TOOLS) {
      expect(tool.id).toMatch(/^[a-z0-9-]+$/);
      expect(CATEGORIES.some((category) => category.id === tool.category)).toBe(true);
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});
