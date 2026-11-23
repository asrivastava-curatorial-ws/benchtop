import { allNames, nearestNames, normaliseHex } from '../../lib/colour-names';
import { escapeHtml } from '../../lib/text';
import { defineTextTool, type Field, type TextResult } from '../types';

const SAMPLE = '#17694e\nrgb(255, 153, 51)\nhsl(210 60% 40%)\nsky\nindia';

/** One preview row: what was asked on the left, the names as swatches on the right. */
const row = (head: string, chips: readonly string[]) => `<div class="cn-row"><div class="cn-head">${head}</div><ul class="cn-names">${chips.join('')}</ul></div>`;
const chip = (hex: string, name: string, note: string) => `<li title="${hex}"><span class="cn-chip" style="background:${hex}"></span>${escapeHtml(name)}${note ? ` <small>${note}</small>` : ''}</li>`;

const describeDelta = (d: number) => (d < 1 ? 'exact to the eye' : d < 2.5 ? 'very close' : d < 6 ? 'close' : d < 12 ? 'similar' : 'distant');

export default defineTextTool({
  input: { label: 'Colours or names, one per line', language: 'text', sample: SAMPLE, placeholder: '#3a7bd5, rgb(…), hsl(…) or part of a name' },
  output: { label: 'Names' },
  options: [
    {
      key: 'list',
      label: 'Names from',
      type: 'segmented',
      choices: [
        { value: 'both', label: 'CSS and xkcd' },
        { value: 'css', label: 'CSS only' },
        { value: 'xkcd', label: 'xkcd survey' },
      ],
      default: 'both',
    },
    { key: 'count', label: 'Suggestions per colour', type: 'number', default: 3, min: 1, max: 20, step: 1 },
  ],
  async run(input, o): Promise<TextResult> {
    const names = await allNames();
    const out: string[] = [];
    const swatches: string[] = [];
    let firstFields: Field[] | null = null;
    for (const raw of input.split('\n')) {
      const line = raw.trim();
      if (!line) {
        out.push('');
        continue;
      }
      const hex = normaliseHex(line);
      if (hex && !/^[a-z ]+$/i.test(line)) {
        const found = nearestNames(hex, names, o.count, o.list as 'both' | 'css' | 'xkcd');
        out.push(
          `${line} (${hex})`,
          ...found.map((f) => `  ${f.colour.name.padEnd(28)} ${f.colour.hex}  ${f.colour.list === 'css' ? 'CSS ' : 'xkcd'}  ΔE ${f.delta.toFixed(1)}, ${describeDelta(f.delta)}`),
        );
        swatches.push(
          row(
            `<span class="cn-chip cn-chip-big" style="background:${hex}"></span><b>${escapeHtml(line)}</b><code>${hex}</code>`,
            found.map((f) => chip(f.colour.hex, f.colour.name, `ΔE ${f.delta.toFixed(1)}`)),
          ),
        );
        firstFields ??= [
          { label: 'Colour', value: hex, swatch: hex, mono: true },
          ...found.slice(0, 3).map((f) => ({ label: `${f.colour.list === 'css' ? 'CSS' : 'xkcd'} name`, value: `${f.colour.name} (ΔE ${f.delta.toFixed(1)})`, swatch: f.colour.hex })),
        ];
        continue;
      }
      // Otherwise search the names.
      const query = line.toLowerCase();
      const matches = names.filter((n) => (o.list === 'both' || n.list === o.list) && n.name.toLowerCase().includes(query)).slice(0, 60);
      const exact = names.find((n) => n.name.toLowerCase() === query || n.name.replace(/\s/g, '') === query.replace(/\s/g, ''));
      out.push(
        `“${line}”: ${matches.length ? `${matches.length}${matches.length === 60 ? '+' : ''} name${matches.length === 1 ? '' : 's'}` : 'no names found'}`,
        ...matches.map((m) => `  ${m.name.padEnd(28)} ${m.hex}  ${m.list === 'css' ? 'CSS' : 'xkcd'}`),
      );
      swatches.push(
        row(
          `<b>“${escapeHtml(line)}”</b><small>${matches.length ? `${matches.length}${matches.length === 60 ? '+' : ''} found` : 'no names found'}</small>`,
          matches.slice(0, 24).map((m) => chip(m.hex, m.name, m.list === 'css' ? 'CSS' : '')),
        ),
      );
      if (exact) firstFields ??= [{ label: exact.name, value: exact.hex, swatch: exact.hex, mono: true }];
    }
    const html = `<div class="cn-list">${swatches.join('')}</div>`;
    return {
      output: out.join('\n'),
      fields: firstFields ?? [],
      preview: { kind: 'html', html },
      info: `${names.filter((n) => n.list === 'css').length} CSS names and ${names.filter((n) => n.list === 'xkcd').length} names from the xkcd colour survey (CC0)`,
    };
  },
});
