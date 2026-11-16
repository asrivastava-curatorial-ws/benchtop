import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

const XML = `<?xml version="1.0"?>
<galleries>
  <gallery floor="0"><name>Engines</name><exhibits>42</exhibits></gallery>
  <gallery floor="1"><name>Space</name><exhibits>31</exhibits></gallery>
</galleries>`;

const XSL = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" indent="yes"/>
  <xsl:template match="/">
    <table>
      <tr><th>Gallery</th><th>Floor</th><th>Exhibits</th></tr>
      <xsl:for-each select="galleries/gallery">
        <xsl:sort select="exhibits" data-type="number" order="descending"/>
        <tr><td><xsl:value-of select="name"/></td><td><xsl:value-of select="@floor"/></td><td><xsl:value-of select="exhibits"/></td></tr>
      </xsl:for-each>
    </table>
  </xsl:template>
</xsl:stylesheet>`;

function parse(text: string, what: string): Document {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const error = document.querySelector('parsererror');
  if (error) throw new ToolError(`The ${what} is not well-formed XML: ${error.textContent?.trim().split('\n')[0] ?? ''}`);
  return document;
}

export default defineTextTool({
  input: { label: 'XML', language: 'xml', sample: XML },
  input2: { label: 'XSLT stylesheet', language: 'xml', sample: XSL },
  output: { label: 'Result', language: 'xml' },
  options: [],
  mainThread: true,
  run(input, _o, ctx) {
    if (input.trim() === '' || ctx.input2.trim() === '') return '';
    const source = parse(input, 'XML');
    const stylesheet = parse(ctx.input2, 'stylesheet');
    const processor = new XSLTProcessor();
    try {
      processor.importStylesheet(stylesheet);
    } catch (error) {
      throw new ToolError(`The stylesheet could not be compiled: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = processor.transformToDocument(source);
    if (!result?.documentElement) throw new ToolError('The transformation produced nothing. Check the template matches.');
    const output = new XMLSerializer().serializeToString(result).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    return { output, info: 'XSLT 1.0, run by this computer’s web engine.' };
  },
});
