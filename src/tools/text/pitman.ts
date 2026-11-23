import { pronounce } from '../../lib/cmudict';
import { ToolError } from '../../lib/errors';
import { buildOutline, type Consonant, type Place, renderPage, type Unit, unitsFromPhones, VOWEL_EXAMPLES, VOWEL_SIGNS, type VowelName, type WordInput } from '../../lib/pitman';
import { defineTextTool, type Field, type TextResult } from '../types';

const SAMPLE = 'Welcome to the museum. Please keep your ticket with you and enjoy the galleries.';

const PLACE_NAMES: Record<Place, string> = { 1: 'above the line', 2: 'on the line', 3: 'through the line' };

const CHART: readonly { c: Consonant; example: string; units?: Unit[] }[] = [
  { c: 'P', example: 'pay' },
  { c: 'B', example: 'bay' },
  { c: 'T', example: 'tie' },
  { c: 'D', example: 'die' },
  { c: 'CH', example: 'chew' },
  { c: 'J', example: 'jaw' },
  { c: 'K', example: 'key' },
  { c: 'G', example: 'go' },
  { c: 'F', example: 'fee' },
  { c: 'V', example: 'vow' },
  { c: 'TH', example: 'thigh' },
  { c: 'DH', example: 'thy' },
  { c: 'S', example: 'see' },
  { c: 'Z', example: 'zoo' },
  { c: 'SH', example: 'she' },
  { c: 'ZH', example: 'measure' },
  { c: 'M', example: 'me' },
  { c: 'N', example: 'no' },
  { c: 'NG', example: 'sing' },
  { c: 'L', example: 'lay' },
  {
    c: 'R',
    example: 'ray',
    units: [
      { kind: 'C', c: 'R' },
      { kind: 'V', v: 'ay' },
    ],
  },
  {
    c: 'R',
    example: 'air',
    units: [
      { kind: 'V', v: 'ay' },
      { kind: 'C', c: 'R' },
    ],
  },
  { c: 'W', example: 'way' },
  { c: 'Y', example: 'yea' },
  { c: 'H', example: 'hay' },
];

/** Words, figures and punctuation, in order. */
function tokens(text: string): string[] {
  return text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,:]\d+)*|[.,;:!?"“”()-]/g) ?? [];
}

export default defineTextTool({
  input: { label: 'English text', language: 'text', sample: SAMPLE, placeholder: 'Type or paste English to see it in Pitman shorthand' },
  output: { label: 'SVG', language: 'xml' },
  runOnEmpty: true,
  options: [
    {
      key: 'show',
      label: 'Show',
      type: 'segmented',
      choices: [
        { value: 'text', label: 'Your text' },
        { value: 'chart', label: 'Stroke chart' },
      ],
      default: 'text',
    },
    { key: 'size', label: 'Stroke size', type: 'range', default: 34, min: 16, max: 80, step: 2, unit: 'px' },
    { key: 'vowels', label: 'Vowel signs', type: 'toggle', default: true, help: 'Writers leave most vowels out once they are fluent; the position of the outline still tells the first vowel.' },
    { key: 'circleS', label: 'Circle S at the start and end of words', type: 'toggle', default: true },
    { key: 'ingDot', label: 'Dot for -ing', type: 'toggle', default: true },
    { key: 'lines', label: 'Ruled lines', type: 'toggle', default: true },
    { key: 'labels', label: 'Words under the outlines', type: 'toggle', default: true },
    { key: 'width', label: 'Page width', type: 'number', default: 760, min: 240, max: 4000, step: 20, unit: 'px' },
  ],
  async run(input, o): Promise<TextResult> {
    const page = { unit: o.size, vowels: o.vowels, circleS: o.circleS, ingDot: o.ingDot, lines: o.lines, labels: o.labels, width: o.width, ink: '#1a2027', paper: '#ffffff' };
    if (o.show === 'chart') return chart(page);
    const list = tokens(input);
    if (!list.length) throw new ToolError('Type some English words.');
    if (list.length > 2000) throw new ToolError('That is a lot of text; try 2,000 words or fewer at a time.');
    const words: WordInput[] = [];
    for (const t of list) {
      if (!/[A-Za-z]/.test(t)) {
        words.push({ text: t, units: null, guessed: false });
        continue;
      }
      const p = await pronounce(t);
      words.push({ text: t, units: unitsFromPhones(p.phones), guessed: p.guessed });
    }
    const result = renderPage(words, page);
    const guessed = [...new Set(result.outlines.filter((x) => x.guessed).map((x) => x.text))];
    const fields: Field[] = result.outlines
      .slice(0, 40)
      .map((x) => ({ label: x.text, value: `${x.spelling || 'vowel signs'}, ${PLACE_NAMES[x.position]}${x.guessed ? ' (sounds guessed)' : ''}`, tone: x.guessed ? 'warn' : undefined }));
    const warnings = [
      'Theory outlines: every sound written in full, without short forms, phrasing or most hooks and loops, as in the first lessons. Check against your textbook before relying on them.',
      ...(guessed.length ? [`Not in the pronouncing dictionary, so the sounds were guessed from the spelling: ${guessed.slice(0, 12).join(', ')}${guessed.length > 12 ? '…' : ''}.`] : []),
    ];
    return {
      output: result.svg,
      language: 'xml',
      filename: 'pitman-shorthand.svg',
      preview: { kind: 'svg', svg: result.svg },
      fields,
      info: `${result.outlines.length} outline${result.outlines.length === 1 ? '' : 's'} · American pronunciations from the CMU dictionary, written with British vowel signs`,
      warnings,
    };
  },
});

function chart(page: Parameters<typeof renderPage>[1]): TextResult {
  const u = page.unit;
  const cell = u * 2.6;
  const cols = Math.max(4, Math.floor(page.width / cell));
  const items: string[] = [];
  const f = (n: number) => n.toFixed(1);
  CHART.forEach(({ c, example, units: given }, i) => {
    const units: Unit[] = given ?? [{ kind: 'C', c }];
    const outline = buildOutline(units, { ...page, vowels: false });
    const x = (i % cols) * cell + cell / 2 - (outline.minX + outline.maxX) / 2;
    const row = Math.floor(i / cols);
    const y = u * 1.4 + row * cell * 1.2 - (outline.minY + outline.maxY) / 2;
    items.push(`<g transform="translate(${f(x)} ${f(y)})">${outline.svg}</g>`);
    const name = outline.spelling;
    items.push(
      `<text x="${f((i % cols) * cell + cell / 2)}" y="${f(u * 1.4 + row * cell * 1.2 + u * 1.05)}" text-anchor="middle" font-size="${f(u * 0.36)}" font-family="system-ui, sans-serif" stroke="none">${name}</text>`,
    );
    items.push(
      `<text x="${f((i % cols) * cell + cell / 2)}" y="${f(u * 1.4 + row * cell * 1.2 + u * 1.5)}" text-anchor="middle" font-size="${f(u * 0.3)}" font-family="system-ui, sans-serif" fill="#6b7785" stroke="none">${example}</text>`,
    );
  });
  const rows = Math.ceil(CHART.length / cols);
  const vowelTop = u * 1.4 + rows * cell * 1.2 + u * 0.4;
  // Vowels shown against a Tee in their places.
  const names = Object.keys(VOWEL_SIGNS) as VowelName[];
  names.forEach((name, i) => {
    const v = VOWEL_SIGNS[name];
    const units: Unit[] = [
      { kind: 'C', c: 'T' },
      { kind: 'V', v: name },
    ];
    const outline = buildOutline(units, { ...page, vowels: true, circleS: false, ingDot: false });
    const x = (i % cols) * cell + cell / 2 - (outline.minX + outline.maxX) / 2;
    const row = Math.floor(i / cols);
    const y = vowelTop + u * 1.2 + row * cell * 1.2 - (outline.minY + outline.maxY) / 2;
    items.push(`<g transform="translate(${f(x)} ${f(y)})">${outline.svg}</g>`);
    items.push(
      `<text x="${f((i % cols) * cell + cell / 2)}" y="${f(vowelTop + u * 1.2 + row * cell * 1.2 + u * 1.05)}" text-anchor="middle" font-size="${f(u * 0.34)}" font-family="system-ui, sans-serif" stroke="none">${name} (${v.place}${v.place === 1 ? 'st' : v.place === 2 ? 'nd' : 'rd'})</text>`,
    );
    items.push(
      `<text x="${f((i % cols) * cell + cell / 2)}" y="${f(vowelTop + u * 1.2 + row * cell * 1.2 + u * 1.5)}" text-anchor="middle" font-size="${f(u * 0.3)}" font-family="system-ui, sans-serif" fill="#6b7785" stroke="none">${VOWEL_EXAMPLES[name]}</text>`,
    );
  });
  const height = Math.ceil(vowelTop + u * 1.2 + Math.ceil(names.length / cols) * cell * 1.2 + u * 0.4);
  const width = cols * cell;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(width)}" height="${height}" viewBox="0 0 ${f(width)} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><g fill="#1a2027" stroke="#1a2027">${items.join('')}</g></svg>`;
  return {
    output: svg,
    language: 'xml',
    filename: 'pitman-chart.svg',
    preview: { kind: 'svg', svg },
    info: 'The consonant strokes (with both forms of R), then the vowel signs written after Tee in their first, second and third places',
  };
}
