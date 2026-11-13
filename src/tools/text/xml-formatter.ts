import { byteLength, sizeChange } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { loadXmlFormatter } from '../../lib/xml-format';
import { defineTextTool, type Values } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?><catalog xmlns:dc="http://purl.org/dc/elements/1.1/"><!-- two books --><book id="bk101" available="true"><dc:title>XML Developer's Guide</dc:title><price currency="USD">44.95</price><notes><![CDATA[Keeps <CDATA> & comments intact]]></notes></book><book id="bk102"><dc:title>Midnight Rain</dc:title><price currency="USD">5.95</price><empty/></book></catalog>`;

/** Validates well-formedness and throws a positioned error when the XML is broken. */
export async function assertWellFormedXml(xml: string): Promise<void> {
  const { XMLValidator } = await import('fast-xml-parser');
  const verdict = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (verdict !== true) {
    const { msg, line, col } = verdict.err;
    throw new ToolError(`${msg.replace(/\.$/, '')} (line ${line}, column ${col}).`, { line, column: col });
  }
}

export default defineTextTool({
  input: { label: 'XML', language: 'xml', sample: SAMPLE, accept: '.xml,.svg,.xsd,.xsl,.rss,.atom,.plist,.txt,text/xml' },
  output: { label: 'Result', language: 'xml' },
  options: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'segmented',
      choices: [
        { value: 'format', label: 'Format' },
        { value: 'minify', label: 'Minify' },
      ],
      default: 'format',
    },
    { ...INDENT, showIf: (v: Values) => v.mode === 'format' },
    {
      key: 'collapse',
      label: 'Keep short text on one line',
      type: 'toggle',
      default: true,
      showIf: (v: Values) => v.mode === 'format',
    },
    { key: 'comments', label: 'Remove comments', type: 'toggle', default: false, showIf: (v: Values) => v.mode === 'minify' },
  ],
  async run(input, o) {
    if (input.trim() === '') throw new ToolError('Input is empty.');
    await assertWellFormedXml(input);
    const xmlFormat = await loadXmlFormatter();
    let output: string;
    try {
      output =
        o.mode === 'minify'
          ? xmlFormat.minify(input, { collapseContent: true, filter: o.comments ? (node) => node.type !== 'Comment' : undefined })
          : xmlFormat(input, {
              indentation: o.indent === 'tab' ? '\t' : ' '.repeat(Number.parseInt(o.indent, 10)),
              collapseContent: o.collapse,
              lineSeparator: '\n',
              throwOnFailure: true,
            });
    } catch (error) {
      throw new ToolError(`The XML could not be formatted: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { output, info: `Well-formed XML · ${sizeChange(byteLength(input), byteLength(output))}`, filename: 'document.xml' };
  },
});
