import { ToolError } from '../../lib/errors';
import { capitalize, splitLines } from '../../lib/text';
import { decodeXmlEntities } from '../../lib/xml-scan';
import { defineTextTool, type Field, type Values } from '../types';

const SAMPLE = `Docs | Getting started | https://example.org/docs/start | Install and run in five minutes
Docs | Configuration | https://example.org/docs/config | Every setting, with defaults
API | REST reference | https://example.org/api | Endpoints, parameters and errors
Optional | Changelog | https://example.org/changelog | Release history`;

interface Link {
  section: string;
  title: string;
  url: string;
  notes: string;
}

function render(title: string, summary: string, details: string, links: Link[]): string {
  const out = [`# ${title.trim() || 'Untitled'}`];
  if (summary.trim() !== '') out.push('', `> ${summary.trim().replace(/\s*\n\s*/g, ' ')}`);
  if (details.trim() !== '') out.push('', details.trim());
  const sections = new Map<string, Link[]>();
  for (const link of links) sections.set(link.section, [...(sections.get(link.section) ?? []), link]);
  // The "Optional" section has a defined meaning (may be skipped for short contexts) and goes last.
  const ordered = [...sections].sort(([a], [b]) => Number(a.toLowerCase() === 'optional') - Number(b.toLowerCase() === 'optional'));
  for (const [section, items] of ordered) {
    out.push('', `## ${section}`, '');
    for (const item of items) out.push(`- [${item.title}](${item.url})${item.notes ? `: ${item.notes}` : ''}`);
  }
  return `${out.join('\n')}\n`;
}

function fromLines(input: string): Link[] {
  const links: Link[] = [];
  splitLines(input).forEach((line, index) => {
    if (line.trim() === '' || line.trim().startsWith('#')) return;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3 || cells.length > 4) {
      throw new ToolError(`Line ${index + 1}: expected "Section | Title | URL | Description" (the description is optional).`, { line: index + 1 });
    }
    const [section = '', title = '', url = '', notes = ''] = cells;
    if (section === '' || title === '' || url === '') throw new ToolError(`Line ${index + 1}: section, title and URL are all required.`, { line: index + 1 });
    links.push({ section, title, url, notes });
  });
  return links;
}

function titleFromSlug(slug: string): string {
  const words = decodeURIComponent(slug.replace(/\.(html?|php|aspx?|md)$/i, ''))
    .split(/[-_+\s]+/)
    .filter(Boolean);
  return words.map((word, index) => (index === 0 ? capitalize(word) : word)).join(' ');
}

function fromSitemap(xml: string): Link[] {
  const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeXmlEntities(match[1] as string));
  if (urls.length === 0) throw new ToolError('No <loc> entries found. Paste the XML of a sitemap (the contents of sitemap.xml).');
  const links: Link[] = [];
  for (const url of urls) {
    let path: string[];
    try {
      path = new URL(url).pathname.split('/').filter(Boolean);
    } catch {
      continue;
    }
    if (/\.(xml|xml\.gz)$/i.test(url)) continue; // nested sitemap index entries
    const last = path[path.length - 1];
    links.push({
      section: path.length > 1 ? titleFromSlug(path[0] as string) : 'Pages',
      title: last === undefined ? 'Home' : titleFromSlug(last) || 'Home',
      url,
      notes: '',
    });
  }
  if (links.length === 0) throw new ToolError('The sitemap only lists other sitemaps. Paste one that lists pages.');
  return links;
}

function validate(text: string): { fields: Field[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows = splitLines(text);
  let h1 = 0;
  let sections = 0;
  let links = 0;
  let seenSection = false;
  let summary = false;
  const firstContent = rows.findIndex((row) => row.trim() !== '');
  if (firstContent < 0) throw new ToolError('The file is empty.');
  if (!/^# \S/.test(rows[firstContent] as string)) warnings.push(`Line ${firstContent + 1}: the file must start with an H1 title ("# Project name").`);
  rows.forEach((row, index) => {
    const line = index + 1;
    if (/^# /.test(row)) {
      h1++;
      if (h1 > 1) warnings.push(`Line ${line}: only one H1 title is allowed.`);
    } else if (/^## \S/.test(row)) {
      sections++;
      seenSection = true;
    } else if (/^#{3,} /.test(row)) {
      warnings.push(`Line ${line}: use H2 ("## ") for sections; deeper headings are not part of the format.`);
    } else if (/^>\s?\S/.test(row) && !seenSection) {
      summary = true;
    } else if (/^\s*[-*] /.test(row) && seenSection) {
      const match = /^\s*[-*] \[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?$/.exec(row);
      if (!match) warnings.push(`Line ${line}: list items should look like "- [Title](https://example.org/page): optional notes".`);
      else {
        links++;
        if (!/^https?:\/\//i.test(match[2] as string)) warnings.push(`Line ${line}: "${match[2]}" should be an absolute URL.`);
      }
    } else if (seenSection && row.trim() !== '' && !/^\s/.test(row)) {
      warnings.push(`Line ${line}: sections should contain only a list of links.`);
    }
  });
  if (!summary) warnings.push('No summary found: add a blockquote ("> One-paragraph summary") right after the title.');
  if (sections === 0) warnings.push('No sections found: add at least one "## Section" with a list of links.');
  return {
    fields: [
      { label: 'Result', value: warnings.length === 0 ? 'Valid llms.txt structure' : `${warnings.length} issue${warnings.length === 1 ? '' : 's'} found`, tone: warnings.length === 0 ? 'ok' : 'warn' },
      { label: 'Sections', value: String(sections) },
      { label: 'Links', value: String(links) },
    ],
    warnings,
  };
}

const notValidating = (v: Values): boolean => v.mode !== 'validate';

export default defineTextTool({
  input: { label: 'Input', sample: SAMPLE, placeholder: 'Links (Section | Title | URL | Description), sitemap XML, or an existing llms.txt', language: 'markdown' },
  output: { label: 'llms.txt', language: 'markdown' },
  options: [
    {
      key: 'mode',
      label: 'Build from',
      type: 'select',
      choices: [
        { value: 'links', label: 'A list of links' },
        { value: 'sitemap', label: 'Pasted sitemap XML' },
        { value: 'validate', label: 'Nothing — validate an existing file' },
      ],
      default: 'links',
    },
    { key: 'title', label: 'Site or project name', type: 'text', default: 'Example Project', wide: true, showIf: notValidating },
    {
      key: 'summary',
      label: 'One-paragraph summary',
      type: 'text',
      default: 'Example Project is a toolkit for doing useful things. This file lists the pages that describe it best.',
      multiline: true,
      showIf: notValidating,
    },
    { key: 'details', label: 'Extra notes (optional)', type: 'text', default: '', multiline: true, showIf: notValidating },
  ],
  run(input, o) {
    if (o.mode === 'validate') {
      const { fields, warnings } = validate(input);
      return { output: input, fields, warnings };
    }
    const links = o.mode === 'sitemap' ? fromSitemap(input) : fromLines(input);
    if (links.length === 0) throw new ToolError('Add at least one link.');
    const output = render(o.title, o.summary, o.details, links);
    const check = validate(output);
    return {
      output,
      info: `${links.length} link${links.length === 1 ? '' : 's'} in ${new Set(links.map((link) => link.section)).size} section(s)`,
      warnings: check.warnings,
      filename: 'llms.txt',
    };
  },
});
