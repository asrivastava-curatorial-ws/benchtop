import { compareSpecificity, type Specificity, specificity, splitSelectors } from '../../lib/css-specificity';
import { escapeHtml } from '../../lib/text';
import { defineTextTool } from '../types';

const SAMPLE = `#gallery .exhibit-card:hover
.exhibit-card > h3::first-line
nav a[aria-current="page"]
:is(#main, .sidebar) li:nth-child(2n of .featured)
:where(.theme-dark) .button
ul li:not(.sold-out, #closed)
.ticket .price, .ticket .price:focus-visible`;

const format = (v: Specificity) => `${v[0]},${v[1]},${v[2]}`;

export default defineTextTool({
  input: { label: 'Selectors (one per line; comma lists are split)', language: 'css', sample: SAMPLE },
  output: { label: 'Specificity' },
  options: [
    {
      key: 'order',
      label: 'Order',
      type: 'segmented',
      choices: [
        { value: 'input', label: 'As written' },
        { value: 'strongest', label: 'Strongest first' },
      ],
      default: 'strongest',
    },
  ],
  run(input, o) {
    const selectors = input
      .split('\n')
      .map((line) =>
        line
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\{[\s\S]*$/, '')
          .trim(),
      )
      .filter(Boolean)
      .flatMap((line) => splitSelectors(line));
    if (selectors.length === 0) return '';
    const rows = selectors.map((selector, index) => ({ selector, index, ...specificity(selector) }));
    const strongest = rows.reduce((best, row) => (compareSpecificity(row.value, best) > 0 ? row.value : best), [0, 0, 0] as Specificity);
    const shown = o.order === 'strongest' ? [...rows].sort((x, y) => compareSpecificity(y.value, x.value) || x.index - y.index) : rows;
    const width = Math.max(...shown.map((row) => format(row.value).length));
    const output = shown.map((row) => `${format(row.value).padEnd(width)}  ${row.selector}${compareSpecificity(row.value, strongest) === 0 ? '  ← strongest' : ''}`).join('\n');
    const html = `<table class="lint-table"><thead><tr><th>ID</th><th>Class</th><th>Type</th><th>Selector</th></tr></thead><tbody>${shown
      .map(
        (row) =>
          `<tr${compareSpecificity(row.value, strongest) === 0 ? ' class="is-strongest"' : ''}><td>${row.value[0]}</td><td>${row.value[1]}</td><td>${row.value[2]}</td><td><code>${escapeHtml(row.selector)}</code></td></tr>`,
      )
      .join('')}</tbody></table>`;
    const warnings = rows.some((row) => row.nested) ? ['& takes the specificity of the parent rule’s selector, which is not counted here.'] : undefined;
    return {
      output,
      preview: { kind: 'html', html },
      warnings,
      info: 'Compared column by column from the left: one ID beats any number of classes. When two selectors tie, the later rule wins. Inline styles beat every selector, and !important beats both.',
    };
  },
});
