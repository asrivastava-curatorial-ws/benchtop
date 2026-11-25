/**
 * Tests for the libraries and tools added in 4.0: data, maths and the tools
 * built on them.  Later sections cover the rest of the release.
 */
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { analogFilter, analogResponse, crossings, firResponse, firTaps, iirResponse, iirSections, ladder, ladderValues, logSpace, minimumOrder, opAmpStages, sections } from '../../src/lib/filters';
import { detectKind, lintInfra, parseHcl } from '../../src/lib/infra-lint';
import { applyPatch, describeChanges, diffJson, escapePointer, toJsonPatch } from '../../src/lib/json-diff';
import { devicesCsv, formatRate, guessDevice, normaliseMac, webAddress } from '../../src/lib/lan';
import { filterLines, indexLog, LEVELS, levelAt, levelOf, readLines } from '../../src/lib/log-index';
import { fieldsUsed, fillTemplate, findPhoto, type Layout, mergePdf, PRESETS, pageCount, sheetProblems, starterItems } from '../../src/lib/mail-merge';
import { documentTitle, extractMath, outline, renderMarkdown, standaloneHtml, toDocx, toEpub } from '../../src/lib/markdown-doc';
import { cond, formatMatrix, nullSpace, parseInput, parseMatrix, rank, rref, svd, transpose } from '../../src/lib/matrix';
import {
  emptyNote,
  fileKind,
  mimeOf,
  type Note,
  noteHtml,
  noteMarkdownZip,
  noteText,
  noteTitle,
  packNote,
  pruneAttachments,
  readNote,
  safeName,
  sha256Hex,
  unpackNote,
} from '../../src/lib/notes-format';
import { routesFromOpenApi, sampleFor } from '../../src/lib/openapi-mock';
import { isRandomMac, setOuiTable, vendorOf } from '../../src/lib/oui';
import { fileRows, parsePatch, patchStats } from '../../src/lib/patch';
import { setFontLoader } from '../../src/lib/pdf-text';
import { clashes, DEFAULT_RULES, formatDate, planRenames, regexProblem, splitName } from '../../src/lib/rename';
import { formatSi, parseSi } from '../../src/lib/si';
import { alongLine, lMatches, loadFacts, matchedImpedance } from '../../src/lib/smith';
import { describe as describeStats, fUpper, linearRegression, oneWayAnova, pairedTTest, pearson, quantile, ranks, spearman, tCritical, tTwoSided, welchTTest } from '../../src/lib/statistics';
import { chartSvg, histogram, niceScale } from '../../src/lib/svg-chart';
import { looksLikeHeader, readTableFile } from '../../src/lib/table-files';
import { columnsFromObjects, columnsFromRows, inferType, jsonRows, tableName, toDelimited, toMarkdown, uniqueNames } from '../../src/lib/tabular';
import { texToSvg } from '../../src/lib/tex';
import { squarify } from '../../src/lib/treemap';
import { excelDate, readXlsx } from '../../src/lib/xlsx-read';
import jsonDiffTool from '../../src/tools/text/json-diff';
import matrixTool from '../../src/tools/text/matrix-calculator';
import statisticsTool from '../../src/tools/text/statistics';
import { field, out, run } from './helpers';

setFontLoader(async (file) => new Uint8Array(readFileSync(new URL(`../../public/fonts/${file}`, import.meta.url))));

/* -------------------------------------------------------------- JSON diff -- */

describe('JSON diff', () => {
  const before = { name: 'VITM', galleries: ['Engine', 'Electro', 'Space'], open: '09:30', closed: ['Diwali'] };
  const after = { name: 'VITM', galleries: ['Engine', 'Kids', 'Electro', 'Space'], open: '10:00', tickets: { adult: 90 } };

  it('finds inserted, removed and changed values, and the patch rebuilds the second document', () => {
    const changes = diffJson(before, after, { arrays: 'lcs' });
    expect(describeChanges(changes)).toContain('+ /galleries/1: "Kids"');
    expect(describeChanges(changes)).toContain('~ /open: "09:30" → "10:00"');
    expect(describeChanges(changes)).toContain('- /closed: ["Diwali"]');
    expect(applyPatch(before, toJsonPatch(changes) as never)).toEqual(after);
  });

  it('rebuilds documents through every kind of list edit', () => {
    const cases: [unknown, unknown][] = [
      [
        [1, 2, 3, 4, 5],
        [2, 3, 9, 5, 6],
      ],
      [
        [{ a: 1 }, { a: 2 }],
        [{ a: 1, b: 2 }, { a: 3 }, { a: 2 }],
      ],
      [{ x: [[1, 2], [3]] }, { x: [[1], [3, 4], []] }],
      [[], [1]],
      ['text', { now: 'object' }],
    ];
    for (const [a, b] of cases) {
      for (const arrays of ['lcs', 'index'] as const) expect(applyPatch(a, toJsonPatch(diffJson(a, b, { arrays })) as never), `${arrays} ${JSON.stringify(a)}`).toEqual(b);
    }
  });

  it('pairs list items by key, ignores order, keys, case and small number differences', () => {
    const a = [
      { id: 1, n: 'Engine', v: 10 },
      { id: 2, n: 'Electro', v: 20 },
    ];
    const b = [
      { id: 2, n: 'Electro', v: 21 },
      { id: 1, n: 'Engine', v: 10 },
    ];
    expect(describeChanges(diffJson(a, b, { arrays: 'lcs', matchKey: 'id' }))).toBe('~ /1/v: 20 → 21');
    expect(diffJson([1, 2, 3], [3, 1, 2], { arrays: 'unordered' })).toEqual([]);
    expect(diffJson({ a: 1, t: 5 }, { a: 1, t: 9 }, { arrays: 'lcs', ignoreKeys: ['t'] })).toEqual([]);
    expect(diffJson({ v: 1.0001 }, { v: 1.0002 }, { arrays: 'lcs', tolerance: 0.001 })).toEqual([]);
    expect(diffJson({ s: 'Hall' }, { s: 'HALL' }, { arrays: 'lcs', ignoreCase: true })).toEqual([]);
    expect(escapePointer('a/b~c')).toBe('a~1b~0c');
  });

  it('reports through the tool', async () => {
    const result = await run(jsonDiffTool, '{"a":1,"b":[1,2]}', {}, { input2: '{"a":2,"b":[1,2,3]}' });
    expect(result.output).toBe('~ /a: 1 → 2\n+ /b/2: 3\n');
    expect(field(result, 'Added')).toBe('1');
    const patch = await out(jsonDiffTool, '{"a":1}', { view: 'patch' }, { input2: '{"a":1,"b":true}' });
    expect(JSON.parse(patch)).toEqual([{ op: 'add', path: '/b', value: true }]);
  });
});

/* ----------------------------------------------------------------- matrix -- */

const multiply = (a: number[][], b: number[][]) => a.map((r) => (b[0] ?? []).map((_, j) => r.reduce((s, x, k) => s + x * ((b[k] as number[])[j] as number), 0)));

describe('Matrices', () => {
  it('reads definitions in several forms and keeps other lines as expressions', () => {
    const { matrices, expressions } = parseInput('A = 1 2; 3 4\nB = [[1,0],[0,1]]\nC =\n1 2 3\n4 5 6\n\ninv(A)\nA * B');
    expect(matrices.get('A')).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(matrices.get('B')?.[1]).toEqual([0, 1]);
    expect(matrices.get('C')).toHaveLength(2);
    expect(expressions).toEqual(['inv(A)', 'A * B']);
    expect(() => parseMatrix('1 2; 3')).toThrow(/same number of values/);
  });

  it('reduces to row echelon form and finds rank and null space', () => {
    const a = [
      [1, 2, 3],
      [2, 4, 6],
      [1, 0, 1],
    ];
    expect(rank(a)).toBe(2);
    expect(rref(a).matrix).toEqual([
      [1, 0, 1],
      [0, 1, 1],
      [0, 0, 0],
    ]);
    const n = nullSpace(a);
    expect(n[0]).toHaveLength(1);
    for (const row of multiply(a, n)) for (const x of row) expect(Math.abs(x)).toBeLessThan(1e-12);
  });

  it('decomposes tall and wide matrices exactly (U·S·Vᵀ)', () => {
    for (const a of [
      [
        [4, 0],
        [3, -5],
        [1, 2],
      ],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    ]) {
      const { U, S, V } = svd(a);
      const us = U.map((r) => r.map((x, j) => x * (S[j] as number)));
      const back = multiply(us, transpose(V));
      for (const [i, r] of back.entries()) for (const [j, x] of r.entries()) expect(x).toBeCloseTo((a[i] as number[])[j] as number, 10);
      expect(S[0]).toBeGreaterThanOrEqual(S[1] as number);
    }
    expect(
      cond([
        [2, 0],
        [0, 2],
      ]),
    ).toBeCloseTo(1, 12);
    expect(
      cond([
        [1, 2],
        [2, 4],
      ]),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      formatMatrix([
        [1, 10],
        [100, -2.5],
      ]),
    ).toBe('  1    10\n100  -2.5');
  });

  it('evaluates expressions through the tool', async () => {
    const result = await out(matrixTool, 'A = 4 -2 1; 3 6 -4; 2 1 8\nb = 12; -25; 32\ndet(A)\nA \\ b\nrank(A)');
    expect(result).toContain('det(A) =\n263');
    expect(result).toMatch(/A \\ b =\n\s*1\n\s*-2\n\s*4/);
    expect(result).toContain('rank(A) =\n3');
  });
});

/* -------------------------------------------------------------- statistics -- */

describe('Statistics', () => {
  it('describes a sample as spreadsheets do', () => {
    const d = describeStats([2, 4, 4, 4, 5, 5, 7, 9, null]);
    expect(d.n).toBe(8);
    expect(d.missing).toBe(1);
    expect(d.mean).toBe(5);
    expect(d.median).toBe(4.5);
    expect(d.modes).toEqual([4]);
    expect(d.sd).toBeCloseTo(2.13809, 5);
    expect(d.skewness).toBeCloseTo(0.81848, 4);
    expect(d.kurtosis).toBeCloseTo(0.940625, 4);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('matches published t and F tables', () => {
    expect(tTwoSided(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(tTwoSided(2, 10)).toBeCloseTo(0.07339, 4);
    expect(fUpper(3.885, 2, 12)).toBeCloseTo(0.05, 3);
    expect(tCritical(0.95, 10)).toBeCloseTo(2.2281, 3);
  });

  it('correlates, regresses and compares groups', () => {
    const x = [1, 2, 3, 4, 5];
    expect(pearson(x, [2, 4, 6, 8, 10]).r).toBeCloseTo(1, 12);
    expect(spearman(x, [1, 4, 9, 16, 25]).rho).toBeCloseTo(1, 12);
    const r = linearRegression(x, [3.1, 4.9, 7.2, 8.8, 11.1]);
    expect(r.slope).toBeCloseTo(1.99, 2);
    expect(r.intercept).toBeCloseTo(1.05, 2);
    expect(r.r2).toBeGreaterThan(0.99);
    const w = welchTTest([20, 22, 19, 24, 25], [28, 30, 27, 26, 31]);
    expect(w.difference).toBeCloseTo(-6.4, 6);
    expect(w.p).toBeLessThan(0.01);
    const pt = pairedTTest([10, 12, 9, 11], [11, 14, 10, 13]);
    expect(pt.difference).toBeCloseTo(-1.5, 6);
    const a = oneWayAnova(
      new Map([
        ['a', [1, 2, 3]],
        ['b', [4, 5, 6]],
        ['c', [7, 8, 9]],
      ]),
    );
    expect(a.f).toBeCloseTo(27, 9);
    expect(a.dfBetween).toBe(2);
    expect(a.dfWithin).toBe(6);
    expect(a.p).toBeCloseTo(0.001, 3);
  });

  it('reports through the tool with a chart', async () => {
    const result = await run(statisticsTool, 'x,y\n1,3.1\n2,4.9\n3,7.2\n4,8.8\n5,11.1', { analysis: 'regression' });
    expect(result.output).toMatch(/^y = 1\.05 \+ 1\.99 × x/);
    expect(result.preview?.kind).toBe('svg');
    const anova = await out(statisticsTool, statisticsTool.input && typeof statisticsTool.input === 'object' ? ((statisticsTool.input as { sample?: string }).sample ?? '') : '', {
      analysis: 'anova',
    });
    expect(anova).toContain('One-way ANOVA: visit_minutes by gallery');
  });
});

/* ------------------------------------------------------------ tables, charts -- */

describe('Tables and charts', () => {
  it('infers column types and names', () => {
    expect(inferType([1, 2, null])).toBe('integer');
    expect(inferType([1, 2.5])).toBe('number');
    expect(inferType(['2026-01-02', '2026-03-04 10:00'])).toBe('timestamp');
    expect(inferType([true, 'x'])).toBe('text');
    expect(uniqueNames(['a', '', 'a', 'A'])).toEqual(['a', 'column_2', 'a_2', 'A_3']);
    expect(tableName('2026 Visits (final).csv')).toBe('t_2026_visits_final');
    expect(tableName('visits.csv', new Set(['visits']))).toBe('visits_2');
    const cols = columnsFromObjects([
      { a: 1, nested: { b: 2 } },
      { a: 2, c: 'x' },
    ]);
    expect(cols.map((c) => `${c.name}:${c.type}`)).toEqual(['a:integer', 'nested:text', 'c:text']);
    expect(cols[1]?.values[0]).toBe('{"b":2}');
    expect(
      columnsFromRows(
        [
          ['h1', 'h2'],
          [1, 'x'],
        ],
        true,
      ).map((c) => c.name),
    ).toEqual(['h1', 'h2']);
  });

  it('reads JSON arrays, NDJSON and wrapped arrays', () => {
    expect(jsonRows('[{"a":1},{"a":2}]')).toHaveLength(2);
    expect(jsonRows('{"a":1}\n{"a":2}\n')).toHaveLength(2);
    expect(jsonRows('{"meta":1,"items":[{"a":1}]}')).toEqual([{ a: 1 }]);
    expect(
      looksLikeHeader([
        ['name', 'visitors'],
        ['Engine', 412],
      ]),
    ).toBe(true);
    expect(
      looksLikeHeader([
        [1, 2],
        [3, 4],
      ]),
    ).toBe(false);
  });

  it('writes CSV, Markdown and charts', () => {
    expect(toDelimited(['a', 'b'], [['x,y', 'say "hi"']])).toBe('a,b\r\n"x,y","say ""hi"""\r\n');
    expect(toMarkdown(['a'], [['x|y']])).toBe('| a |\n| --- |\n| x\\|y |');
    expect(niceScale(0, 97, true).ticks).toEqual([0, 20, 40, 60, 80, 100]);
    const h = histogram([1, 2, 2, 3, 3, 3, 4, 4, 5]);
    expect(h.counts.reduce((s, c) => s + c, 0)).toBe(9);
    const svg = chartSvg(['a', 'b'], [{ name: 'v', values: [1, 2] }], { kind: 'bar', title: 'T & U' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('T &amp; U');
    expect(chartSvg(['a', 'b'], [{ name: 'v', values: [1, 3] }], { kind: 'pie' })).toContain('75.0%');
  });

  it('reads Excel workbooks with shared strings, booleans and dates', () => {
    const xml = (s: string) => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${s}`);
    const book = zipSync({
      'xl/workbook.xml': xml('<workbook xmlns:r="r"><sheets><sheet name="Visits" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': xml('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': xml('<sst><si><t>gallery</t></si><si><t>visitors</t></si><si><t>day</t></si><si><t>Engine &amp; Hall</t></si></sst>'),
      'xl/styles.xml': xml('<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': xml(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>open</t></is></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>412</v></c><c r="C2" s="1"><v>46327</v></c><c r="D2" t="b"><v>1</v></c></row></sheetData></worksheet>',
      ),
    });
    const [sheet] = readXlsx(book);
    expect(sheet?.name).toBe('Visits');
    expect(sheet?.rows).toEqual([
      ['gallery', 'visitors', 'day', 'open'],
      ['Engine & Hall', 412, '2026-11-01', true],
    ]);
    expect(excelDate(45658.5)).toBe('2025-01-01 12:00:00');
  });

  it('opens Parquet and JSON files as tables', async () => {
    const parquet = new Uint8Array(readFileSync(new URL('../e2e/fixtures/galleries.parquet', import.meta.url)));
    const [source] = await readTableFile('galleries.parquet', parquet);
    expect(source?.kind).toBe('columns');
    if (source?.kind !== 'columns') throw new Error('unexpected');
    expect(source.columns.map((c) => `${c.name}:${c.type}`)).toEqual(['gallery:text', 'visitors:integer', 'rating:number', 'outdoor:boolean']);
    expect(source.columns[0]?.values).toContain('Kids Science');
    const [json] = await readTableFile('rows.json', new TextEncoder().encode('[{"a":1}]'));
    expect(json?.name).toBe('rows');
    await expect(readTableFile('notes.docx', new Uint8Array())).rejects.toThrow(/open CSV/);
  });
});

/* --------------------------------------------------------------- documents -- */

describe('Markdown documents', () => {
  const doc = '# Guide\n\nCosts $5 and $10, while $E = mc^2$ holds.\n\n$$\n\\frac{a}{b}\n$$\n\n`$not maths$`\n\n# Second\n\n- [x] done\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';

  it('takes maths out before Markdown so prices and code keep their dollar signs', () => {
    const { text, math } = extractMath(doc);
    expect(math).toEqual([
      { tex: '\\frac{a}{b}', display: true },
      { tex: 'E = mc^2', display: false },
    ]);
    expect(text).toContain('Costs $5 and $10');
    expect(text).toContain('`$not maths$`');
  });

  it('renders maths as pictures, with errors shown as code', () => {
    const html = renderMarkdown(doc, (tex, display) => (tex.includes('frac') ? { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', error: null } : { svg: '', error: display ? 'x' : 'Bad maths' }));
    expect(html).toContain('<span class="md-math-display"><img class="md-math md-math-block" alt="\\frac{a}{b}" src="data:image/svg+xml;base64,');
    expect(html).toContain('<code class="md-math-error" title="Bad maths">E = mc^2</code>');
    expect(html).toContain('<code>$not maths$</code>');
    expect(html).toContain('<td>2</td>');
    expect(outline(doc).map((h) => `${h.depth}:${h.text}:${h.line}`)).toEqual(['1:Guide:1', '1:Second:11']);
    expect(documentTitle('no heading')).toBe('Document');
    expect(standaloneHtml('A & B', '<p>x</p>')).toContain('<title>A &amp; B</title>');
  });

  it('draws LaTeX with MathJax and reports mistakes', () => {
    const good = texToSvg('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', { display: true, scale: 20, color: '#ff0000' });
    expect(good.error).toBeNull();
    expect(good.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(good.svg).toContain('fill="#ff0000"');
    // Named with its TeX, so a screen reader has something to read.
    expect(texToSvg('\\displaystyle a < b', { display: false }).svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" aria-label="a &lt; b"/);
    expect(good.width).toBeGreaterThan(good.height);
    expect(good.mathml).toContain('<mfrac>');
    const inline = texToSvg('y_i', { display: false, scale: 16 });
    expect(inline.depth).toBeGreaterThan(0);
    expect(texToSvg('\\frac{a}{', { display: true }).error).toMatch(/Missing close brace/);
    expect(texToSvg('\\ce{H2O}', { display: false }).error).toBeNull();
  });

  it('makes an EPUB with one chapter per top-level heading and the pictures as files', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const zip = toEpub(`${doc}\n![dot](data:image/png;base64,${png})\n`, () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', error: null }), { title: 'Guide', author: 'VITM' });
    expect(strFromU8(zip.subarray(30, 38))).toBe('mimetype');
    expect(strFromU8(zip.subarray(38, 58))).toBe('application/epub+zip');
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/chapter1.xhtml', 'OEBPS/chapter2.xhtml', 'OEBPS/images/image2.png']),
    );
    const opf = strFromU8(files['OEBPS/content.opf'] as Uint8Array);
    expect(opf).toContain('<dc:creator>VITM</dc:creator>');
    expect(opf).toContain('media-type="image/svg+xml"');
    const second = strFromU8(files['OEBPS/chapter2.xhtml'] as Uint8Array);
    expect(second).toContain('<img src="images/image2.png" alt="dot" />');
    expect(second).toContain('checked="checked"');
  });

  it('makes a Word document with headings, lists, tables and code', async () => {
    const bytes = await toDocx(`${doc}\n\n1. one\n2. two\n\n\`\`\`\ncode line\n\`\`\`\n\n> quoted **bold**\n`, async () => null);
    const files = unzipSync(bytes);
    const xml = strFromU8(files['word/document.xml'] as Uint8Array);
    expect(xml).toContain('Guide');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('code line');
    expect(xml).toContain('Costs $5 and $10');
    expect(xml).toContain('☑ ');
    expect(strFromU8(files['word/numbering.xml'] as Uint8Array)).toContain('decimal');
  });
});

/* -------------------------------------------------------------- mail merge -- */

describe('Mail merge', () => {
  const rows = [
    { Name: 'ananya rao', School: 'KV Hebbal', ID: 'VITM-1', Photo: 'Ananya.JPG' },
    { Name: 'Rahul Menon', School: 'NPS', ID: 'VITM-2', Photo: '' },
  ];

  it('fills fields in any case, with case filters, row numbers and missing columns left empty', () => {
    expect(fillTemplate('{{name|title}} of {{ SCHOOL }} (#{{#}}) {{Nope}}!', rows[0] as never, 0)).toBe('Ananya Rao of KV Hebbal (#1) !');
    expect(fillTemplate('{{Name|upper}}', rows[1] as never, 1)).toBe('RAHUL MENON');
    expect(fillTemplate('{{today}}', {}, 0, new Date(2026, 10, 22))).toBe('22 November 2026');
    expect(findPhoto(new Map([['ananya.jpg', { bytes: new Uint8Array(), type: 'jpg' as const }]]), 'photos/Ananya.JPG')).not.toBeNull();
  });

  it('places every preset sheet inside its paper', () => {
    for (const preset of PRESETS) {
      const layout: Layout = { card: preset.card, sheet: preset.sheet, items: starterItems(preset), cutMarks: false, outlines: false };
      expect(sheetProblems(layout), preset.id).toEqual([]);
      for (const it of layout.items) {
        expect(it.x, `${preset.id} ${it.text}`).toBeGreaterThanOrEqual(-0.01);
        expect(it.x + it.w, `${preset.id} ${it.text}`).toBeLessThanOrEqual(preset.card.w + 0.01);
        expect(it.y + it.h, `${preset.id} ${it.text}`).toBeLessThanOrEqual(preset.card.h + 0.01);
      }
    }
    const l7160 = PRESETS.find((p) => p.id === 'l7160');
    if (!l7160) throw new Error('missing preset');
    const labels: Layout = { card: l7160.card, sheet: l7160.sheet, items: [], cutMarks: false, outlines: false };
    expect(pageCount(labels, 25)).toBe(2);
    expect(pageCount(labels, 25, 20)).toBe(3);
    expect(sheetProblems({ ...labels, sheet: { ...(l7160.sheet as NonNullable<typeof l7160.sheet>), cols: 4 } })[0]).toMatch(/past the paper's width/);
  });

  it('makes one certificate page per row, with a QR code, and Hindi text in an embedded font', async () => {
    const preset = PRESETS.find((p) => p.id === 'cert-a4');
    if (!preset) throw new Error('missing preset');
    const layout: Layout = { card: preset.card, sheet: null, items: starterItems(preset), cutMarks: false, outlines: false };
    expect(fieldsUsed(layout)).toEqual(['Name', 'School', 'Event', 'Date', 'ID']);
    const pdf = await PDFDocument.load(await mergePdf(layout, [...rows, { Name: 'प्रिया शर्मा', ID: 'VITM-3' }], {}));
    expect(pdf.getPageCount()).toBe(3);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(842);
    const fonts = pdf.context
      .enumerateIndirectObjects()
      .map(([, o]) => String(o))
      .filter((o) => o.includes('/FontFile2'));
    expect(fonts.length).toBeGreaterThan(0);
  });

  it('puts labels on sheets, skipping used positions, with cut marks', async () => {
    const preset = PRESETS.find((p) => p.id === 'l7163');
    if (!preset) throw new Error('missing preset');
    const layout: Layout = { card: preset.card, sheet: preset.sheet, items: starterItems(preset), cutMarks: true, outlines: true };
    const many = Array.from({ length: 15 }, (_, i) => ({ Name: `Visitor ${i + 1}`, Address: 'Kasturba Road', City: 'Bengaluru', PIN: '560001' }));
    const pdf = await PDFDocument.load(await mergePdf(layout, many, {}, { skip: 3 }));
    expect(pdf.getPageCount()).toBe(2);
    expect(Math.round(pdf.getPage(0).getHeight())).toBe(842);
    const single = await PDFDocument.load(await mergePdf(layout, many, {}, { only: [4], single: true }));
    expect(single.getPageCount()).toBe(1);
    expect(Math.round(single.getPage(0).getWidth())).toBe(Math.round((99.1 * 72) / 25.4));
  });
});

/* -------------------------------------------------------------------- notes -- */

describe('Notes and the .bnote format', () => {
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const pdf = strToU8('%PDF-1.4 fake');

  async function sample(): Promise<{ note: Note; files: Map<string, Uint8Array> }> {
    const imageId = await sha256Hex(png);
    const pdfId = await sha256Hex(pdf);
    const base = emptyNote('Gallery visit');
    const note: Note = {
      ...base,
      blocks: [
        { id: 'b1', type: 'text', html: '<p>Steam <b>engine</b> &amp; boilers</p><script>x()</script>' },
        { id: 'b2', type: 'file', file: imageId, caption: 'Beam engine' },
        {
          id: 'b3',
          type: 'checklist',
          items: [
            { text: 'Photograph label', done: true },
            { text: 'Measure', done: false },
          ],
        },
        { id: 'b4', type: 'link', url: 'https://example.org/engines', title: 'Engines', note: 'background', snapshot: pdfId, savedAt: '2026-11-22T10:00:00Z' },
        { id: 'b5', type: 'code', source: 'print("hi")', language: 'python' },
        { id: 'b6', type: 'link', url: 'javascript:alert(1)', title: 'Bad', note: '' },
      ],
      attachments: [
        { id: imageId, name: 'beam engine.png', type: 'image/png', size: png.length },
        { id: pdfId, name: 'engines.pdf', type: 'application/pdf', size: pdf.length },
        { id: 'f'.repeat(64), name: 'unused.bin', type: 'application/octet-stream', size: 3 },
      ],
    };
    return {
      note,
      files: new Map([
        [imageId, png],
        [pdfId, pdf],
      ]),
    };
  }

  it('packs a note with copies of its files and reads it back', async () => {
    const { note, files } = await sample();
    const zip = packNote(note, files, (h) => h.replace(/<script>.*?<\/script>/g, ''));
    expect(strFromU8(zip.subarray(30, 38))).toBe('mimetype');
    expect(strFromU8(zip.subarray(38, 71))).toBe('application/vnd.benchtop.note+zip');
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual(['index.html', 'mimetype', 'note.json', `files/${note.attachments[0]?.id}/beam engine.png`, `files/${note.attachments[1]?.id}/engines.pdf`].sort());
    const index = strFromU8(entries['index.html'] as Uint8Array);
    expect(index).toContain('<img src="files/');
    expect(index).toContain('beam%20engine.png');
    expect(index).not.toContain('<script>');
    expect(index).not.toContain('href="javascript:');
    const { note: back, files: bytes } = unpackNote(zip);
    expect(back.title).toBe('Gallery visit');
    expect(back.blocks).toHaveLength(6);
    expect(back.attachments.map((a) => a.name)).toEqual(['beam engine.png', 'engines.pdf']);
    expect([...(bytes.get(note.attachments[0]?.id as string) ?? [])]).toEqual([...png]);
  });

  it('refuses archives that are not notes, are damaged or come from a newer version', async () => {
    expect(() => unpackNote(strToU8('hello'))).toThrow(/could not be opened as an archive/);
    expect(() => unpackNote(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/no note.json/);
    expect(() => unpackNote(zipSync({ 'note.json': strToU8('{"format":"benchtop-note","version":9,"note":{}}') }))).toThrow(/newer version/);
    const { note, files } = await sample();
    const zip = unzipSync(packNote(note, files));
    delete zip[`files/${note.attachments[0]?.id}/beam engine.png`];
    expect(() => unpackNote(zipSync(zip))).toThrow(/missing its copy of beam engine.png/);
  });

  it('reads stored notes defensively and lists what they contain', async () => {
    const read = readNote({ title: 'x', blocks: [{ type: 'text', html: '<p>Hi</p>' }, { type: 'mystery' }, { type: 'file' }], attachments: [{ id: 'not-a-hash', name: 'a' }] });
    expect(read.blocks.map((b) => b.type)).toEqual(['text']);
    expect(read.attachments).toEqual([]);
    expect(() => readNote(null)).toThrow(/not a Benchtop note/);
    const { note } = await sample();
    expect(pruneAttachments(note).map((a) => a.name)).toEqual(['beam engine.png', 'engines.pdf']);
    expect(noteText(note)).toContain('Steam engine & boilers');
    expect(noteText(note)).toContain('Photograph label');
    expect(noteTitle({ ...note, title: '' })).toBe('Steam engine & boilers');
    expect(noteTitle(emptyNote(''))).toBe('Untitled note');
  });

  it('knows kinds of files and keeps file names safe', () => {
    expect(fileKind({ name: 'clip.MP4', type: '' })).toBe('video');
    expect(fileKind({ name: 'part.stl', type: 'application/octet-stream' })).toBe('model');
    expect(fileKind({ name: 'scan.pdf', type: '' })).toBe('pdf');
    expect(fileKind({ name: 'notes.md', type: '' })).toBe('text');
    expect(fileKind({ name: 'x.svg', type: 'image/svg+xml' })).toBe('image');
    expect(fileKind({ name: 'data.bin', type: 'application/octet-stream' })).toBe('other');
    expect(mimeOf('song.mp3')).toBe('audio/mpeg');
    expect(mimeOf('a.png', 'image/webp')).toBe('image/webp');
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('a:b*c?.txt')).toBe('a_b_c_.txt');
    expect(safeName('...')).toBe('file');
  });

  it('exports HTML with embedded files and Markdown with files beside it', async () => {
    const { note, files } = await sample();
    const html = noteHtml(
      note,
      (a) => `data:${a.type};base64,AAAA`,
      (h) => h,
    );
    expect(html).toContain('<figure><img src="data:image/png;base64,AAAA" alt="Beam engine"><figcaption>Beam engine</figcaption></figure>');
    expect(html).toContain('<ul class="checklist"><li class="done">☑ Photograph label</li>');
    expect(html).toContain('href="#"');
    const zip = unzipSync(noteMarkdownZip(note, files, (h) => h.replace(/<[^>]+>/g, '')));
    const md = strFromU8(zip['note.md'] as Uint8Array);
    expect(md).toContain('# Gallery visit');
    expect(md).toMatch(/!\[Beam engine\]\(files\/[0-9a-f]{8}-beam%20engine\.png\)/);
    expect(md).toContain('- [x] Photograph label');
    expect(md).toContain('```python');
    expect(Object.keys(zip).filter((k) => k.startsWith('files/'))).toHaveLength(2);
  });
});

/* ------------------------------------------------------------ files tools -- */

describe('Bulk rename rules', () => {
  const t = new Date(2026, 10, 22, 9, 5, 7).getTime();
  const files = [
    { path: 'IMG_0002.JPG', size: 2000, modified: t + 1000 },
    { path: 'IMG_0001.JPG', size: 1000, modified: t },
    { path: 'trip/notes  final .txt', size: 10, modified: t },
  ];
  const plan = (rules: Partial<typeof DEFAULT_RULES>) => planRenames(files, { ...DEFAULT_RULES, ...rules }).map((p) => p.problem ?? p.to);

  it('splits names and formats dates', () => {
    expect(splitName('a/b/archive.tar.gz')).toEqual({ dir: 'a/b/', stem: 'archive.tar', ext: 'gz' });
    expect(splitName('.bashrc')).toEqual({ dir: '', stem: '.bashrc', ext: '' });
    expect(formatDate(t, 'YYYYMMDD_hhmmss')).toBe('20261122_090507');
  });

  it('applies templates, numbers in the chosen order, and tidies', () => {
    expect(plan({})).toEqual(['IMG_0002.JPG', 'IMG_0001.JPG', 'trip/notes final.txt']);
    expect(plan({ template: '{folder} {n:2}', sort: 'name' })).toEqual([' 02.JPG'.trim(), '01.JPG', 'trip/trip 03.txt'].map((x, i) => (i === 0 ? '02.JPG' : x)));
    expect(plan({ template: 'Gallery {n:3}', start: 10, step: 5, sort: 'modified', ext: 'lower' })).toEqual(['Gallery 020.jpg', 'Gallery 010.jpg', 'trip/Gallery 015.txt']);
    expect(plan({ template: '{date:YYYY-MM-DD} {name}', spaces: 'underscore', caseRule: 'lower' })).toEqual(['2026-11-22_img_0002.JPG', '2026-11-22_img_0001.JPG', 'trip/2026-11-22_notes_final.txt']);
  });

  it('finds and replaces, with regular expressions and groups', () => {
    expect(plan({ find: 'img_', replace: 'Engine ' })).toEqual(['Engine 0002.JPG', 'Engine 0001.JPG', 'trip/notes final.txt']);
    expect(plan({ find: 'IMG_0*(\\d+)', replace: 'photo-$1', regex: true, matchCase: true })).toEqual(['photo-2.JPG', 'photo-1.JPG', 'trip/notes final.txt']);
    expect(regexProblem({ find: '(', regex: true, matchCase: false })).toMatch(/./);
  });

  it('flags names that clash or cannot be used', () => {
    expect(plan({ template: 'same' })).toEqual(['Another file would get the same name.', 'Another file would get the same name.', 'trip/same.txt']);
    expect(plan({ template: 'a:b' })[0]).toMatch(/cannot contain/);
    expect(plan({ template: ' ', tidy: true })[0]).toBe('The new name is empty.');
    const planned = planRenames([files[0] as (typeof files)[number]], { ...DEFAULT_RULES, template: 'IMG_0001' });
    expect(
      clashes(
        planned,
        files.map((f) => f.path),
      )[0]?.problem,
    ).toMatch(/already there/);
  });
});

describe('Treemap layout', () => {
  it('fills the rectangle with areas in proportion to the values', () => {
    const items = [6, 6, 4, 3, 2, 2, 1];
    const boxes = squarify(items, (v) => v, { x: 0, y: 0, w: 600, h: 400 });
    expect(boxes).toHaveLength(7);
    const total = boxes.reduce((s, b) => s + b.w * b.h, 0);
    expect(total).toBeCloseTo(240_000, 3);
    for (const b of boxes) {
      expect((b.w * b.h) / 240_000).toBeCloseTo(b.item / 24, 6);
      expect(b.x).toBeGreaterThanOrEqual(-1e-9);
      expect(b.y + b.h).toBeLessThanOrEqual(400 + 1e-9);
      expect(Math.max(b.w / b.h, b.h / b.w)).toBeLessThan(4);
    }
    expect(squarify([], (v: number) => v, { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
  });
});

/* ------------------------------------------------------------ infra checks -- */

describe('Kubernetes, Compose and Terraform checks', () => {
  const rules = (text: string) => lintInfra(text).findings.map((f) => `${f.severity}:${f.rule}:${f.line}`);

  it('finds risky Kubernetes settings with their lines', () => {
    const k8s = `apiVersion: extensions/v1beta1
kind: Deployment
metadata: { name: web }
spec:
  replicas: 1
  template:
    spec:
      hostNetwork: true
      containers:
        - name: app
          image: nginx
          env:
            - name: API_TOKEN
              value: abc
          securityContext:
            privileged: true
            capabilities: { add: [SYS_ADMIN] }
`;
    expect(detectKind(k8s)).toBe('kubernetes');
    const found = rules(k8s);
    expect(found).toEqual(
      expect.arrayContaining([
        'error:removed-api:1',
        'error:host-network:8',
        'error:privileged:16',
        'error:dangerous-capability:17',
        'error:secret-in-env:14',
        'warning:image-tag:11',
        'note:single-replica:5',
      ]),
    );
    const good = `apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  replicas: 3
  template:
    spec:
      securityContext: { runAsNonRoot: true }
      containers:
        - name: app
          image: nginx:1.27.2
          resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { memory: 128Mi } }
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true }
          readinessProbe: { httpGet: { path: /, port: 80 } }
          livenessProbe: { httpGet: { path: /, port: 80 } }
`;
    expect(rules(good)).toEqual([]);
  });

  it('checks Compose services', () => {
    const compose = `version: "3.8"
services:
  db:
    image: postgres
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: secret
  agent:
    image: portainer/agent:2.21.0
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
    restart: always
    healthcheck: { test: ["CMD", "true"] }
`;
    expect(detectKind(compose)).toBe('compose');
    expect(rules(compose)).toEqual(expect.arrayContaining(['error:docker-socket:10', 'warning:database-port:5', 'warning:secret-in-env:7', 'warning:image-tag:4', 'note:obsolete-version:1']));
    expect(rules(compose).filter((r) => r.includes('agent') || r.includes(':restart-policy:8'))).toEqual([]);
  });

  it('reads HCL and checks Terraform resources', () => {
    const tf = `terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}
/* the database */
resource "aws_db_instance" "main" {
  password            = "plain-text"
  publicly_accessible = true
  storage_encrypted   = true
  deletion_protection = true
}
resource "aws_security_group" "ssh" {
  ingress {
    from_port   = 22
    to_port     = 22
    cidr_blocks = ["0.0.0.0/0"]
  }
  description = <<EOT
multi
line
EOT
}
module "vpc" {
  source = "git::https://example.org/vpc.git"
}
`;
    expect(detectKind(tf)).toBe('terraform');
    const root = parseHcl(tf);
    expect(root.blocks.map((b) => `${b.type}:${b.labels.join(',')}:${b.line}`)).toEqual(['terraform::1', 'resource:aws_db_instance,main:7', 'resource:aws_security_group,ssh:13', 'module:vpc:24']);
    expect(root.blocks[2]?.blocks[0]?.attrs.map((a) => a.name)).toEqual(['from_port', 'to_port', 'cidr_blocks']);
    expect(rules(tf)).toEqual(
      expect.arrayContaining(['error:hardcoded-secret:8', 'error:db-public:9', 'error:open-ingress:14', 'warning:provider-version:3', 'warning:module-ref:25', 'note:required-version:1']),
    );
  });
});

/* ---------------------------------------------------------- logs, patches -- */

describe('Large logs', () => {
  it('indexes lines across chunks, knows their levels and reads them back', async () => {
    const lines = Array.from({ length: 30_000 }, (_, i) => (i % 1000 === 0 ? `2026-11-22 ERROR request ${i} failed` : i % 7 === 0 ? `WARN slow ${i}` : `INFO ok ${i} ${'x'.repeat(i % 200)}`));
    const text = `${lines.join('\n')}\r\nlast line without newline`;
    const index = await indexLog(new Blob([text]));
    expect(index.lineCount).toBe(30_001);
    expect(index.counts.error).toBe(30);
    expect(levelAt(index, 1000)).toBe('error');
    expect(await readLines(index, 999, 1002)).toEqual([lines[999], lines[1000], lines[1001]]);
    expect(await readLines(index, 30_000, 30_001)).toEqual(['last line without newline']);
    const errors = await filterLines(index, { text: '', regex: false, matchCase: false, exclude: '', levels: new Set(['error']) });
    expect(errors?.length).toBe(30);
    const found = await filterLines(index, { text: 'request \\d+5000 ', regex: true, matchCase: true, exclude: '', levels: new Set(LEVELS) });
    expect([...(found ?? [])]).toEqual([15000, 25000]);
    const plain = await filterLines(index, { text: 'request 15000', regex: false, matchCase: false, exclude: 'nothing', levels: new Set(LEVELS) });
    expect([...(plain ?? [])]).toEqual([15000]);
    expect(await filterLines(index, { text: '', regex: false, matchCase: false, exclude: '', levels: new Set(LEVELS) })).toBeNull();
  });

  it('recognises levels in common formats', () => {
    expect(levelOf('[2026-11-22T10:00:00Z] FATAL: out of memory')).toBe('error');
    expect(levelOf('{"time":"x","level":"warn","msg":"m"}')).toBe('warn');
    expect(levelOf('time=x level=debug msg=m')).toBe('debug');
    expect(levelOf('Traceback (most recent call last):')).toBe('error');
    expect(levelOf('plain text')).toBe('other');
  });
});

describe('Patches', () => {
  const patch = `From 3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f Mon Sep 17 00:00:00 2001
From: A Curator <curator@example.org>
Date: Sun, 22 Nov 2026 10:15:00 +0530
Subject: [PATCH 1/2] Show the queue
 on the kiosk

Body line.
---
 a.py | 2 +-

diff --git a/a.py b/a.py
index 1..2 100644
--- a/a.py
+++ b/a.py
@@ -1,3 +1,3 @@ def f():
 one
-two
+TWO
 three
diff --git a/img.png b/img.png
new file mode 100644
Binary files /dev/null and b/img.png differ
diff --git a/old.txt b/new.txt
similarity index 90%
rename from old.txt
rename to new.txt
--
2.47.1

From 9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b Mon Sep 17 00:00:00 2001
From: B <b@example.org>
Subject: [PATCH 2/2] Add notes

diff --git a/notes.md b/notes.md
new file mode 100644
--- /dev/null
+++ b/notes.md
@@ -0,0 +1,2 @@
+# Notes
+Second line
`;

  it('reads commits, files, statuses and line numbers', () => {
    const commits = parsePatch(patch);
    expect(commits.map((c) => c.subject)).toEqual(['Show the queue on the kiosk', 'Add notes']);
    expect(commits[0]?.author).toBe('A Curator <curator@example.org>');
    expect(commits[0]?.message.trim()).toBe('Body line.');
    expect(commits[0]?.files.map((f) => `${f.status}:${f.oldPath}>${f.newPath}`)).toEqual(['modified:a.py>a.py', 'binary:img.png>img.png', 'renamed:old.txt>new.txt']);
    expect(commits[1]?.files.map((f) => `${f.status}:${f.newPath}:+${f.additions}`)).toEqual(['added:notes.md:+2']);
    expect(patchStats(commits)).toEqual({ files: 4, additions: 3, deletions: 1 });
    const rows = fileRows(commits[0]?.files[0] as never);
    expect(rows.map((r) => `${r.type}:${r.left ?? ''}:${r.right ?? ''}:${r.text}`)).toEqual(['same:::⋯ @@ -1,3 +1,3 @@ def f():', 'same:1:1:one', 'del:2::two', 'add::2:TWO', 'same:3:3:three']);
  });

  it('reads plain diff -u output', () => {
    const commits = parsePatch('--- before.txt\t2026-11-22\n+++ after.txt\t2026-11-22\n@@ -1 +1 @@\n-a\n+b\n');
    expect(commits[0]?.files.map((f) => `${f.oldPath}>${f.newPath}:${f.additions}/${f.deletions}`)).toEqual(['before.txt>after.txt:1/1']);
  });
});

describe('Mock routes from OpenAPI', () => {
  it('makes one route per operation with examples or schema samples', () => {
    const doc = `openapi: 3.0.3
info: { title: Tickets, version: "1" }
paths:
  /shows/{showId}:
    get:
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Show" }
  /bookings:
    post:
      responses:
        "201":
          content:
            application/json:
              example: { booking: "B-1" }
components:
  schemas:
    Show:
      type: object
      properties:
        id: { type: integer }
        title: { type: string, example: Journey to the Stars }
        starts: { type: string, format: date-time }
        tags: { type: array, items: { type: string, enum: [dome, kids] } }
`;
    const routes = routesFromOpenApi(doc);
    expect(routes.map((r) => `${r.method} ${r.path} ${r.status}`)).toEqual(['GET /shows/:showId 200', 'POST /bookings 201']);
    expect(JSON.parse(routes[0]?.body ?? '')).toEqual({ id: 1, title: 'Journey to the Stars', starts: '2026-11-22T10:00:00Z', tags: ['dome'] });
    expect(JSON.parse(routes[1]?.body ?? '')).toEqual({ booking: 'B-1' });
    expect(sampleFor({}, { type: 'string', format: 'email' })).toBe('visitor@example.org');
    expect(() => routesFromOpenApi('{"info": {}}')).toThrow(/no "paths"/);
  });
});

/* -------------------------------------------------------------- LAN tools -- */

describe('LAN tools', () => {
  it('finds makers in the bundled IEEE table, longest prefix first', async () => {
    const table = JSON.parse(readFileSync(new URL('../../public/oui.json', import.meta.url), 'utf8'));
    setOuiTable(table);
    expect(await vendorOf('B8:27:EB:12:34:56')).toMatch(/Raspberry Pi/);
    expect(await vendorOf('24-0A-C4-00-11-22')).toMatch(/Espressif/);
    expect(await vendorOf('00:00:00:00:00:00')).not.toBeNull();
    // Locally administered (random) addresses have no maker.
    expect(isRandomMac('DA:A1:19:00:00:01')).toBe(true);
    expect(await vendorOf('DA:A1:19:00:00:01')).toBeNull();
    expect(await vendorOf('nonsense')).toBeNull();
  });

  it('guesses devices, tidies MAC addresses and exports CSV', () => {
    expect(guessDevice({ ip: '192.168.1.40', open: [80, 9100] })).toBe('Printer');
    expect(guessDevice({ ip: '192.168.1.1', open: [53, 80] })).toBe('Router');
    expect(guessDevice({ ip: '192.168.1.9', open: [], vendor: 'Espressif Inc.' })).toBe('ESP8266 or ESP32 board');
    expect(guessDevice({ ip: '192.168.1.9', open: [] })).toBeNull();
    expect(normaliseMac('3c-52-82-1a-2b-3c')).toBe('3C:52:82:1A:2B:3C');
    expect(normaliseMac('3C52821A2B3C')).toBe('3C:52:82:1A:2B:3C');
    expect(normaliseMac('3C:52:82')).toBeNull();
    expect(normaliseMac('zz:52:82:1a:2b:3c:00')).toBeNull();
    expect(webAddress('10.0.0.5', [22, 8080])).toBe('http://10.0.0.5:8080/');
    expect(webAddress('10.0.0.5', [22])).toBeNull();
    expect(formatRate(940.4)).toBe('940 Mbit/s');
    expect(formatRate(1234)).toBe('1.23 Gbit/s');
    const csv = devicesCsv([{ ip: '192.168.1.40', name: 'printer, office', mac: 'aa:bb:cc:dd:ee:ff', vendor: null, open: [9100], rtt: 3 }]);
    expect(csv.split('\n')[1]).toBe('192.168.1.40,"printer, office",aa:bb:cc:dd:ee:ff,,Printer,9100 Printer (raw),3');
  });
});

/* ------------------------------------------------- filters and Smith chart -- */

describe('Filter design', () => {
  const lp = { kind: 'lowpass', rippleDb: 0.5, f1: 1, f2: 1 } as const;
  const close = (a: number, b: number, digits = 4) => expect(a).toBeCloseTo(b, digits);

  it('matches the standard tables of stage frequencies and Q', () => {
    expect(sections({ ...lp, family: 'butterworth', order: 4 }).map((s) => s.q.toFixed(4))).toEqual(['0.5412', '1.3066']);
    const cheb = sections({ ...lp, family: 'chebyshev', order: 2 })[0];
    close(cheb?.f0 ?? 0, 1.2313);
    close(cheb?.q ?? 0, 0.8637);
    const bessel = sections({ ...lp, family: 'bessel', order: 2 })[0];
    close(bessel?.f0 ?? 0, 1.272);
    close(bessel?.q ?? 0, 0.5774);
    // Bessel filters are normalised for −3 dB at the cutoff.
    const response = analogResponse(analogFilter({ ...lp, family: 'bessel', order: 5, f1: 1000 }), logSpace(100, 10000, 600));
    close((crossings(response, -3.0103)[0] ?? 0) / 1000, 1, 3);
    const hp = sections({ ...lp, kind: 'highpass', family: 'butterworth', order: 3 });
    expect(hp.map((s) => [s.order, s.type])).toEqual([
      [1, 'highpass'],
      [2, 'highpass'],
    ]);
  });

  it('makes digital biquads that agree with SciPy', () => {
    const [q] = iirSections({ kind: 'lowpass', family: 'butterworth', order: 2, rippleDb: 1, f1: 1000, f2: 1000 }, 48000);
    close(q?.b[0] ?? 0, 0.0039161267, 8);
    close(q?.a[1] ?? 0, -1.8153410827, 8);
    close(q?.a[2] ?? 0, 0.8310055893, 8);
    const bp = iirSections({ kind: 'bandpass', family: 'butterworth', order: 2, rippleDb: 1, f1: 900, f2: 1100 }, 48000);
    const levels = iirResponse(bp, 48000, [900, Math.sqrt(900 * 1100), 1100]).map((p) => p.db);
    close(levels[0] ?? 0, -3.0103, 3);
    close(levels[1] ?? 0, 0, 6);
    close(levels[2] ?? 0, -3.0103, 3);
    const hp = iirSections({ kind: 'highpass', family: 'chebyshev', order: 4, rippleDb: 1, f1: 1000, f2: 1000 }, 48000);
    close(iirResponse(hp, 48000, [1000])[0]?.db ?? 0, -1, 4);
    expect(() => iirSections({ kind: 'lowpass', family: 'butterworth', order: 2, rippleDb: 1, f1: 30000, f2: 0 }, 48000)).toThrow(/half the sample rate/);
  });

  it('finds the order, LC ladder values and op-amp parts', () => {
    expect(minimumOrder({ kind: 'lowpass', family: 'butterworth', rippleDb: 1, f1: 1000, f2: 1000 }, 2000, 40)).toBe(7);
    expect(minimumOrder({ kind: 'lowpass', family: 'chebyshev', rippleDb: 1, f1: 1000, f2: 1000 }, 2000, 40)).toBe(5);
    expect(ladderValues('chebyshev', 2, 0.5)?.map((g) => g.toFixed(4))).toEqual(['1.4029', '0.7071', '1.9841']);
    const net = ladder({ kind: 'lowpass', family: 'butterworth', order: 3, rippleDb: 1, f1: 1e6, f2: 1e6 }, 50, 'shunt');
    expect(net?.parts.map((p) => `${p.name} ${p.role}`)).toEqual(['C1 shunt', 'L1 series', 'C2 shunt']);
    close((net?.parts[1]?.value ?? 0) * 1e6, 15.9155, 3);
    const stages = opAmpStages(sections({ kind: 'lowpass', family: 'butterworth', order: 4, rippleDb: 1, f1: 1000, f2: 1000 }), 10e-9, 'E24');
    expect(stages.map((s) => s.circuit)).toEqual(['Sallen-Key', 'Sallen-Key']);
    expect(stages[1]?.parts).toEqual({ R1: 6200, R2: 6200, C1: 6.8e-8, C2: 1e-8 });
    for (const s of stages) expect(Math.abs(s.actualF0 / 1000 - 1)).toBeLessThan(0.05);
  });

  it('makes FIR filters with the expected response', () => {
    const lowpass = firTaps('lowpass', 1000, 1000, 48000, 101, 'hamming');
    expect(lowpass).toHaveLength(101);
    const [pass, edge, stop] = firResponse(lowpass, 48000, [100, 1000, 5000]).map((p) => p.db);
    close(pass ?? 1, 0, 1);
    expect(edge).toBeCloseTo(-6.02, 0);
    expect(stop).toBeLessThan(-50);
  });
});

describe('Smith chart', () => {
  it('works out reflection, VSWR and losses', () => {
    const f = loadFacts({ re: 100, im: 0 }, 50);
    expect(f.magnitude).toBeCloseTo(1 / 3, 9);
    expect(f.vswr).toBeCloseTo(2, 9);
    expect(f.returnLoss).toBeCloseTo(9.542, 3);
    expect(f.mismatchLoss).toBeCloseTo(0.512, 3);
    // A quarter wave turns 100 Ω into 25 Ω on a 50 Ω line.
    const quarter = alongLine({ re: 100, im: 0 }, 50, 0.25);
    expect(quarter.re).toBeCloseTo(25, 6);
    expect(quarter.im).toBeCloseTo(0, 6);
  });

  it('finds L networks that really match', () => {
    for (const load of [
      { re: 25, im: -30 },
      { re: 200, im: 100 },
      { re: 10, im: 80 },
    ]) {
      const matches = lMatches(load, 50, 100e6);
      expect(matches.length).toBeGreaterThanOrEqual(2);
      for (const m of matches) {
        const z = matchedImpedance(load, m);
        expect(z.re).toBeCloseTo(50, 6);
        expect(z.im).toBeCloseTo(0, 6);
      }
    }
    expect(lMatches({ re: 0, im: 20 }, 50, 1e6)).toEqual([]);
  });
});

describe('SI numbers', () => {
  it('reads and writes prefixes', () => {
    expect(parseSi('4k7', 'Ω')).toBe(4700);
    expect(parseSi('47R', 'Ω')).toBe(47);
    expect(parseSi('10 nF', 'F')).toBeCloseTo(1e-8, 20);
    expect(parseSi('2.2µ', 'F')).toBeCloseTo(2.2e-6, 18);
    expect(parseSi('100 MHz', 'Hz')).toBe(1e8);
    expect(parseSi('1.5m', 'H')).toBeCloseTo(0.0015, 12);
    expect(parseSi('abc')).toBeNull();
    expect(formatSi(4700, 'Ω')).toBe('4.7 kΩ');
    expect(formatSi(1e-8, 'F')).toBe('10 nF');
    expect(formatSi(999.96, 'Hz')).toBe('1 kHz');
  });
});

describe('Serial plotter', () => {
  it('reads the Arduino plotter format', async () => {
    const { PlotBuffer, parsePlotLine } = await import('../../src/lib/plotter');
    expect(parsePlotLine('1 2.5 -3e2')).toEqual({
      samples: [
        { name: null, value: 1 },
        { name: null, value: 2.5 },
        { name: null, value: -300 },
      ],
    });
    expect(parsePlotLine('temp:21.5,humidity: 40')).toEqual({
      samples: [
        { name: 'temp', value: 21.5 },
        { name: 'humidity', value: 40 },
      ],
    });
    expect(parsePlotLine('Left Right')).toEqual({ labels: ['Left', 'Right'] });
    expect(parsePlotLine('   ')).toBeNull();
    const buffer = new PlotBuffer(3);
    buffer.feed(new TextEncoder().encode('Left Right\n1 2\n3'));
    buffer.feed(new TextEncoder().encode(' 4\r\nextra:9\n5 6\n7 8\n'));
    expect(buffer.series().map((s) => s.name)).toEqual(['Left', 'Right', 'extra']);
    // Three rows kept; the "extra" series is padded where it had no value.
    expect(buffer.series()[0]?.values).toEqual([Number.NaN, 5, 7]);
    expect(buffer.series()[2]?.values).toEqual([9, Number.NaN, Number.NaN]);
    expect(buffer.total).toBe(5);
    expect(buffer.latest('Right')).toBe(8);
    expect(buffer.csv().split('\n')[0]).toBe('time,Left,Right,extra');
  });
});

describe('Periodic table', () => {
  it('places every element and reads shells and states', async () => {
    const { ELEMENTS, elementBySymbol, molarMass, phaseAt, shells } = await import('../../src/lib/elements');
    expect(ELEMENTS).toHaveLength(118);
    const at = (s: string) => {
      const e = elementBySymbol(s);
      return e ? [e.row, e.column, e.group] : null;
    };
    expect(at('H')).toEqual([1, 1, 1]);
    expect(at('He')).toEqual([1, 18, 18]);
    expect(at('B')).toEqual([2, 13, 13]);
    expect(at('Fe')).toEqual([4, 8, 8]);
    expect(at('Hf')).toEqual([6, 4, 4]);
    expect(at('La')).toEqual([9, 3, null]);
    expect(at('Lu')).toEqual([9, 17, null]);
    expect(at('Og')).toEqual([7, 18, 18]);
    // No two elements share a cell.
    expect(new Set(ELEMENTS.map((e) => `${e.row},${e.column}`)).size).toBe(118);
    expect(shells(elementBySymbol('Fe') as never)).toEqual([2, 8, 14, 2]);
    expect(shells(elementBySymbol('Au') as never)).toEqual([2, 8, 18, 32, 18, 1]);
    const mercury = elementBySymbol('Hg') as never;
    expect(phaseAt(mercury, 298)).toBe('liquid');
    expect(phaseAt(mercury, 200)).toBe('solid');
    expect(phaseAt(mercury, 700)).toBe('gas');
    expect(molarMass('H2O').mass).toBeCloseTo(18.015, 2);
    expect(molarMass('Ca(OH)2').mass).toBeCloseTo(74.09, 1);
    expect(molarMass('CuSO4·5H2O').mass).toBeCloseTo(249.68, 1);
    expect(molarMass('CuSO4.5H2O').pretty).toBe('CuSO₄·5H₂O');
    expect(molarMass('K4[Fe(CN)6]').composition.find((c) => c.symbol === 'N')?.count).toBe(6);
    expect(molarMass('SO4^2-').mass).toBeCloseTo(96.06, 1);
    expect(() => molarMass('Xx2')).toThrow(/not an element/);
    expect(() => molarMass('Ca(OH2')).toThrow(/never closed/);
  });
});

describe('Sun, Moon and sky', () => {
  it('finds sunrise, sunset and twilight', async () => {
    const { sunMoonDay, formatTime, zonedToUtc, utcToZoned, seasons, horizontal, skyRotation, moonFacts } = await import('../../src/lib/sky');
    // Bengaluru on the June solstice: sunrise about 05:53, sunset about 18:50 IST.
    const day = sunMoonDay({ lat: 12.9716, lon: 77.5946 }, '2026-06-21', 'Asia/Kolkata');
    const minutes = (d: Date | null) => {
      const [h, m] = formatTime(d, 'Asia/Kolkata').split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };
    expect(Math.abs(minutes(day.sunrise) - (5 * 60 + 53))).toBeLessThanOrEqual(3);
    expect(Math.abs(minutes(day.sunset) - (18 * 60 + 50))).toBeLessThanOrEqual(3);
    expect(day.noonAltitude).toBeGreaterThan(79);
    expect(minutes(day.civil[0])).toBeLessThan(minutes(day.sunrise));
    // Tromsø in December: polar night.
    expect(sunMoonDay({ lat: 69.6492, lon: 18.9553 }, '2026-12-21', 'Europe/Oslo').polar).toBe('night');
    // Wall-clock conversions survive a daylight-saving change.
    expect(utcToZoned(zonedToUtc('2026-03-29T03:30', 'Europe/London'), 'Europe/London')).toBe('2026-03-29T03:30');
    expect(zonedToUtc('2026-11-23T05:30', 'Asia/Kolkata').toISOString()).toBe('2026-11-23T00:00:00.000Z');
    const s = seasons(2026);
    expect(s[1]?.date.toISOString().slice(0, 10)).toBe('2026-06-21');
    // Polaris stays near the altitude of the latitude.
    const polaris = horizontal(skyRotation({ lat: 28.6, lon: 77.2 }, new Date('2026-11-23T15:00:00Z')), 37.95, 89.26);
    expect(Math.abs(polaris.altitude - 28.6)).toBeLessThan(1.5);
    expect(moonFacts(new Date('2026-11-24T00:00:00Z')).name).toMatch(/moon|quarter|crescent|gibbous/i);
  });
});

describe('Molecule files', () => {
  it('reads XYZ, Molfile, PDB and MOL2, and finds bonds', async () => {
    const { parseMolecule, hillFormula, molecularMass, angle, distance } = await import('../../src/lib/molecules');
    const water = parseMolecule('3\nwater\nO 0 0 0\nH 0.757 0.586 0\nH -0.757 0.586 0\n', 'water.xyz');
    expect(water.bonds).toHaveLength(2);
    expect(hillFormula(water.atoms)).toBe('H2O');
    expect(molecularMass(water.atoms)).toBeCloseTo(18.015, 2);
    expect(angle(water.atoms[1] as never, water.atoms[0] as never, water.atoms[2] as never)).toBeCloseTo(104.5, 0);
    const molfile = `ethene
  test

  2  1  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.3300    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  2  0  0  0  0
M  END
`;
    const ethene = parseMolecule(molfile, 'ethene.mol');
    expect(ethene.bonds).toEqual([[0, 1, 2]]);
    const pdb = [
      'HEADER    TEST PEPTIDE',
      'ATOM      1  N   GLY A   1       0.000   0.000   0.000  1.00  0.00           N',
      'ATOM      2  CA  GLY A   1       1.458   0.000   0.000  1.00  0.00           C',
      'ATOM      3  C   GLY A   1       2.009   1.420   0.000  1.00  0.00           C',
      'HETATM    4 FE   HEM A   2      10.000  10.000  10.000  1.00  0.00          FE',
      'END',
    ].join('\n');
    const peptide = parseMolecule(pdb, 'test.pdb');
    expect(peptide.atoms.map((a) => a.element)).toEqual(['N', 'C', 'C', 'Fe']);
    expect(peptide.atoms[1]?.name).toBe('CA');
    expect(peptide.bonds).toHaveLength(2);
    expect(distance(peptide.atoms[0] as never, peptide.atoms[1] as never)).toBeCloseTo(1.458, 3);
    const mol2 = '@<TRIPOS>MOLECULE\nmethanol\n2 1\n@<TRIPOS>ATOM\n1 C1 0 0 0 C.3\n2 O1 1.43 0 0 O.3\n@<TRIPOS>BOND\n1 1 2 1\n';
    expect(parseMolecule(mol2, 'm.mol2').atoms.map((a) => a.element)).toEqual(['C', 'O']);
    expect(() => parseMolecule('nothing here', 'x.xyz')).toThrow(/No atoms/);
  });
});

describe('Map files', () => {
  it('reads GPX, KML and CSV, measures, and writes them back', async () => {
    const { DOMParser } = await import('@xmldom/xmldom');
    const geo = await import('../../src/lib/geo');
    geo.setXmlParser((text) => new DOMParser().parseFromString(text, 'text/xml') as unknown as Document);
    const gpxText = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Walk</name><trkseg>
<trkpt lat="12.9716" lon="77.5946"><ele>900</ele><time>2026-11-01T06:00:00Z</time></trkpt>
<trkpt lat="12.9806" lon="77.5946"><ele>910</ele><time>2026-11-01T06:10:00Z</time></trkpt>
<trkpt lat="12.9806" lon="77.6046"><ele>905</ele><time>2026-11-01T06:20:00Z</time></trkpt></trkseg></trk></gpx>`;
    const track = geo.rewindForD3(await geo.readGeo('walk.gpx', new TextEncoder().encode(gpxText)));
    const facts = geo.geoFacts(track);
    expect(facts.lines).toBe(1);
    // 0.009° of latitude is about 1.0 km; 0.01° of longitude at 13° N is about 1.08 km.
    expect(facts.lengthKm).toBeCloseTo(2.084, 1);
    const profile = geo.trackProfile(track.features[0] as never);
    expect(profile?.gain).toBe(10);
    expect(profile?.loss).toBe(5);
    expect(profile?.duration).toBe(1200);
    expect(geo.toGpx(track)).toContain('<time>2026-11-01T06:10:00Z</time>');
    const csv = geo.fromCsv('name,lat,lon\nVITM,12.9752,77.5964\nBad,x,y\n');
    expect(csv.features).toHaveLength(1);
    expect(geo.toCsv(csv).split('\n')[1]).toBe('VITM,12.9752,77.5964,,VITM');
    // An anticlockwise (RFC 7946) square is rewound for d3 and measures about 1.2 km².
    const square = geo.rewindForD3({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [77.59, 12.97],
                [77.6, 12.97],
                [77.6, 12.98],
                [77.59, 12.98],
                [77.59, 12.97],
              ],
            ],
          },
        },
      ],
    });
    expect(geo.geoFacts(square).areaKm2).toBeCloseTo(1.2, 1);
    const kml = geo.toKml(square, 'Square');
    const back = await geo.readGeo('square.kml', new TextEncoder().encode(kml));
    expect(back.features[0]?.geometry?.type).toBe('Polygon');
    expect(() => geo.fromCsv('a,b\n1,2\n')).toThrow(/latitude and longitude/);
  });
});

describe('Music helpers', () => {
  it('writes ABC pitches and lengths and WAV files', async () => {
    const m = await import('../../src/lib/music');
    expect(m.abcPitch(60)).toBe('C');
    expect(m.abcPitch(61)).toBe('^C');
    expect(m.abcPitch(72)).toBe('c');
    expect(m.abcPitch(84)).toBe("c'");
    expect(m.abcPitch(48)).toBe('C,');
    expect(m.abcPitch(36)).toBe('C,,');
    expect(m.unitLength('X:1\nM:4/4\nL:1/8\nK:C')).toBe(1 / 8);
    expect(m.unitLength('X:1\nM:2/4\nK:C')).toBe(1 / 16);
    expect(m.durationToken(0.25, 1 / 8)).toBe('2');
    expect(m.durationToken(0.125, 1 / 8)).toBe('');
    expect(m.durationToken(0.0625, 1 / 8)).toBe('/');
    expect(m.durationToken(0.375, 1 / 8)).toBe('3');
    expect(m.durationToken(0.0625 * 1.5, 1 / 8)).toBe('3/4');
    const wav = m.encodeWav([new Float32Array([0, 1, -1])], 8000);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(44 + 6);
    expect(m.TUNES.every((t) => /^X:\d+$/m.test(t.abc) && /^K:/m.test(t.abc))).toBe(true);
  });
});

describe('video dubbing helpers', async () => {
  const d = await import('../../src/lib/dubbing');
  it('fits speech into its slot by speaking faster, within a limit', () => {
    expect(d.fitRate(2, 3)).toBe(1);
    expect(d.fitRate(3, 2)).toBeCloseTo(1.5);
    expect(d.fitRate(10, 2)).toBe(1.6);
    expect(
      d.slots(
        [
          { start: 0, end: 1 },
          { start: 2.5, end: 3 },
        ],
        10,
      ),
    ).toEqual([2.5, 7.5]);
  });
  it('places clips on a track without overlapping', () => {
    const one = new Float32Array(10).fill(0.5);
    const track = d.assemble(
      [
        { start: 0, samples: one },
        { start: 0.5, samples: one },
      ],
      10,
      3,
    );
    expect(track.length).toBe(30);
    expect(track[9]).toBeCloseTo(0.5);
    expect(track[10]).toBeCloseTo(0.5);
    expect(track[19]).toBeCloseTo(0.5);
    expect(track[20]).toBe(0);
  });
  it('round-trips WAV and subtitles', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const back = d.decodeWav(d.encodeWav(samples, 22050));
    expect(back.rate).toBe(22050);
    expect(back.samples[1]).toBeCloseTo(0.5, 3);
    const lines = [
      { start: 1.5, end: 3.25, text: 'Hello', translation: 'नमस्ते' },
      { start: 62, end: 64, text: 'Welcome', translation: '' },
    ];
    const srt = d.toSrt(lines, 'text');
    expect(srt).toContain('00:00:01,500 --> 00:00:03,250');
    expect(srt).toContain('00:01:02,000 --> 00:01:04,000');
    expect(d.parseSubtitles(srt).map((l) => [l.start, l.end, l.text])).toEqual([
      [1.5, 3.25, 'Hello'],
      [62, 64, 'Welcome'],
    ]);
    expect(d.toSrt(lines, 'translation').match(/-->/g)?.length).toBe(1);
    expect(d.parseSubtitles(d.toVtt(lines, 'translation'))[0]?.text).toBe('नमस्ते');
  });
  it('reads translations from chat replies', () => {
    const reply = JSON.stringify({ choices: [{ message: { content: 'Here you go:\n```json\n["एक", "दो"]\n```' } }] });
    expect(d.parseChatReply(reply, 2)).toEqual(['एक', 'दो']);
    expect(d.parseChatReply(reply, 3)).toBeNull();
    expect(d.parseChatReply('not json at all', 1)).toBeNull();
    const request = d.chatRequest('gemma3', ['One', 'Two'], 'English', 'Hindi', 'a science museum') as { messages: { content: string }[] };
    expect(request.messages[1]?.content).toContain('exactly 2 items');
    expect(d.voiceSpeaks('piper-hi_IN-pratham-medium', 'hi')).toBe(true);
    expect(d.voiceSpeaks('piper-hi_IN-pratham-medium', 'en')).toBe(false);
  });
});

describe('hash tool: Subresource Integrity', () => {
  it('gives the integrity value browsers check for script and link tags', async () => {
    const { default: hash } = await import('../../src/tools/text/hash');
    const { createHash } = await import('node:crypto');
    const result = await hash.run('alert(1)', { algorithm: 'sha384', encoding: 'hex', key: '', keyEncoding: 'utf8', expected: '' } as never, { input2: '', file: null, nonce: 0 });
    const fields = typeof result === 'string' ? [] : (result.fields ?? []);
    expect(fields.find((f) => f.label === 'Subresource Integrity')?.value).toBe(`sha384-${createHash('sha384').update('alert(1)').digest('base64')}`);
    const md5 = await hash.run('x', { algorithm: 'md5', encoding: 'hex', key: '', keyEncoding: 'utf8', expected: '' } as never, { input2: '', file: null, nonce: 0 });
    expect(typeof md5 === 'string' ? [] : (md5.fields ?? []).map((f) => f.label)).not.toContain('Subresource Integrity');
  });
});

describe('Dockerfile checks', () => {
  const rules = (text: string) => lintInfra(text).findings.map((f) => `${f.severity}:${f.rule}:${f.line}`);

  it('finds the usual Dockerfile problems with their lines', () => {
    const bad = `# syntax=docker/dockerfile:1
FROM node AS build
MAINTAINER someone@example.org
WORKDIR app
RUN apt-get update
RUN apt-get install python3-yaml curl \\
    git
ENV DB_PASSWORD=hunter2
ADD https://example.org/tool.tgz /opt/
ADD src/ /app/src/
RUN curl -fsSL https://example.org/install.sh | sh && cd /tmp && chmod -R 777 /app
RUN pip install flask && npm install
EXPOSE 99999
CMD node server.js
CMD ["node", "other.js"]
`;
    expect(detectKind(bad)).toBe('dockerfile');
    expect(rules(bad)).toEqual(
      expect.arrayContaining([
        'warning:untagged-image:2',
        'note:maintainer:3',
        'warning:relative-workdir:4',
        'warning:apt-update-alone:5',
        'warning:apt-yes:6',
        'note:apt-recommends:6',
        'note:apt-lists:6',
        'error:secret-env:8',
        'warning:add-url:9',
        'note:add-copy:10',
        'warning:pipe-to-shell:11',
        'note:cd:11',
        'warning:chmod-777:11',
        'note:pip-cache:12',
        'note:npm-ci:12',
        'error:expose-port:13',
        'note:shell-form:14',
        'warning:multiple-cmd:14',
        'warning:root-user:2',
        'note:healthcheck:2',
      ]),
    );
  });

  it('passes a careful multi-stage Dockerfile', () => {
    const good = `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache tini && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000/tcp
HEALTHCHECK CMD wget -qO- http://localhost:3000/ || exit 1
CMD ["node", "dist/server.js"]
`;
    expect(lintInfra(good).findings).toEqual([]);
    expect(rules('FROM gcr.io/distroless/static-debian12:nonroot\nCOPY app /app\nENTRYPOINT ["/app"]\n')).toEqual([]);
    expect(rules('RUN echo hi\nFROM alpine:3.20\nUSER root\n')).toEqual(expect.arrayContaining(['error:from-first:1', 'warning:root-user:3']));
  });
});

describe('CSS specificity and hash identification', () => {
  it('counts specificity the way Selectors Level 4 does', async () => {
    const { specificity, maxSpecificity, splitSelectors } = await import('../../src/lib/css-specificity');
    const s = (selector: string) => specificity(selector).value;
    expect(s('#gallery .card:hover')).toEqual([1, 2, 0]);
    expect(s('.card > h3::first-line')).toEqual([0, 1, 2]);
    expect(s('a:before')).toEqual([0, 0, 2]);
    expect(s('nav a[aria-current="page"]')).toEqual([0, 1, 2]);
    expect(s(':is(#main, .side) li')).toEqual([1, 0, 1]);
    expect(s(':where(#main) .button')).toEqual([0, 1, 0]);
    expect(s('ul li:not(.sold, #closed)')).toEqual([1, 0, 2]);
    expect(s('li:nth-child(2n+1 of .featured, p)')).toEqual([0, 2, 1]);
    expect(s('*|* > svg|circle *')).toEqual([0, 0, 1]);
    expect(s('a[href*="a,b"]:has(> img)')).toEqual([0, 1, 2]);
    expect(s('::slotted(span.x)')).toEqual([0, 1, 2]);
    expect(specificity('& .x').nested).toBe(true);
    expect(splitSelectors('a, b:is(c, d), [x=","]')).toEqual(['a', 'b:is(c, d)', '[x=","]']);
    expect(maxSpecificity('a, #b, .c')).toEqual([1, 0, 0]);
  });

  it('identifies hashes by prefix and length', async () => {
    const { identifyHash } = await import('../../src/lib/hash-identify');
    expect(identifyHash('5f4dcc3b5aa765d61d8327deb882cf99')?.names[0]).toBe('MD5');
    expect(identifyHash('8846F7EAEE8FB117AD06BDD830B7586C')?.names[0]).toBe('NTLM');
    expect(identifyHash('5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8')?.names[0]).toBe('SHA-1');
    expect(identifyHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')?.names).toContain('SHA-256');
    const bcrypt = identifyHash(`$2b$12$${'a'.repeat(53)}`);
    expect(bcrypt?.names).toEqual(['bcrypt']);
    expect(bcrypt?.password).toBe(true);
    expect(identifyHash('$argon2id$v=19$m=65536,t=3,p=4$abc$def')?.names).toEqual(['Argon2']);
    expect(identifyHash('$6$salt$hash')?.names).toEqual(['SHA-512 crypt']);
    expect(identifyHash('sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC')?.names).toEqual(['Subresource Integrity']);
    expect(identifyHash('XUFAKrxLKna5cZ2REBfFkg==')?.names).toEqual(['MD5 (Base64)']);
    expect(identifyHash('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')?.names).toEqual(['JSON Web Token']);
    expect(identifyHash('abc')?.names).toEqual([]);
    expect(identifyHash('   ')).toBeNull();
  });
});

describe('requests to programs on this computer', () => {
  it('treat loopback addresses as local, so they need no online-checks permission', async () => {
    const { isLoopback } = await import('../../src/platform/net');
    for (const address of ['http://127.0.0.1:8800/v1/chat/completions', 'http://localhost:11434/api/chat', 'http://[::1]:1234/', 'http://127.4.5.6/', 'http://ollama.localhost/'])
      expect(isLoopback(address), address).toBe(true);
    for (const address of ['http://192.168.1.5:8800/', 'https://example.org/', 'http://127.0.0.1.example.org/', 'not a url', 'http://localhost.example.org/'])
      expect(isLoopback(address), address).toBe(false);
  });
});
