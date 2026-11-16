import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { documentText, docxText, odfText, pptxText, xlsxText } from '../../src/lib/documents';
import diff from '../../src/tools/text/diff';
import { field, run } from './helpers';

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));

describe('Diff Checker additions', () => {
  it('ignores blank lines and whitespace runs when asked, keeping original line numbers', async () => {
    const result = await run(diff, 'a\n\nb  c\nd\n', { ignoreBlank: true, ignoreAllSpace: true }, { input2: 'a\nb c\n\n\nd\n' });
    expect(result.info).toBe('No differences with the current options');
    if (result.preview?.kind !== 'diff') throw new Error('expected a diff preview');
    expect(result.preview.rows.map((row) => `${row.left}:${row.right}`)).toEqual(['1:1', '3:2', '4:5']);
  });

  it('counts changed, added and removed lines and similarity', async () => {
    const result = await run(diff, 'one\ntwo\nthree\nfour\n', {}, { input2: 'one\n2\nthree\nfour\nfive\n' });
    expect(field(result, 'Lines changed')).toBe('1');
    expect(field(result, 'Lines added')).toBe('1');
    expect(field(result, 'Lines removed')).toBe('0');
    expect(field(result, 'Similarity')).toBe('66.7%');
  });

  it('compares JSON regardless of key order and formatting', async () => {
    const result = await run(diff, '{"b":1,"a":[1,2]}', { as: 'json' }, { input2: '{\n  "a": [1, 2],\n  "b": 1\n}' });
    expect(result.info).toBe('No differences with the current options');
    const changed = await run(diff, '{"a":1}', { as: 'json' }, { input2: '{"a":2}' });
    expect(changed.info).toBe('1 line added, 1 removed');
    await expect(run(diff, '{oops', { as: 'json' }, { input2: '{}' })).rejects.toThrow(/original text is not valid JSON/);
  });

  it('compares lists in any order', async () => {
    expect((await run(diff, 'pear\napple\n', { as: 'sorted' }, { input2: 'apple\npear\n' })).info).toBe('No differences with the current options');
  });

  it('passes the layout and collapsing choices to the preview', async () => {
    const result = await run(diff, 'a\n', { view: 'unified', onlyChanges: true, context: '1' }, { input2: 'b\n' });
    expect(result.preview).toMatchObject({ kind: 'diff', layout: 'unified', context: 1 });
  });
});

describe('document text', () => {
  it('reads Word paragraphs, tabs and tables', () => {
    const docx = zip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">world &amp; co</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:delText>gone</w:delText><w:t>End</w:t></w:r></w:p></w:body></w:document>',
    });
    expect(docxText(docx)).toBe('Hello\tworld & co\nA1\tB1\nEnd');
  });

  it('reads Excel sheets as tab-separated rows', () => {
    const xlsx = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Tea</t></si><si><r><t>Cof</t></r><r><t>fee</t></r></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="b"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="inlineStr"><is><t>hot</t></is></c></row></sheetData></worksheet>',
    });
    expect(xlsxText(xlsx)).toBe('# Prices\nItem\t\t2\nTea\tTRUE\nCoffee\thot');
  });

  it('reads PowerPoint slides in order', () => {
    const pptx = zip({
      'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Last</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>',
    });
    expect(pptxText(pptx)).toBe('# Slide 1\nSecond\n\n# Slide 2\nLast');
  });

  it('reads OpenDocument text', () => {
    const odt = zip({
      'content.xml':
        '<office:document-content><office:automatic-styles/><office:body><office:text><text:h>Title</text:h><text:p>One<text:tab/>two<text:s text:c="3"/>three</text:p></office:text></office:body></office:document-content>',
    });
    expect(odfText(odt)).toBe('Title\nOne\ttwo   three');
  });

  it('picks the reader by extension and rejects non-documents', async () => {
    await expect(documentText('notes.txt', new Uint8Array())).rejects.toThrow(/not a document/);
    await expect(documentText('broken.docx', new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a valid Word document/);
  });
});
