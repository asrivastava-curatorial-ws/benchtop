/** Loads xml-formatter (a CommonJS package) in a way that works under every module loader. */
import type xmlFormatType from 'xml-formatter';

type XmlFormat = typeof xmlFormatType;

export async function loadXmlFormatter(): Promise<XmlFormat> {
  const imported = (await import('xml-formatter')) as unknown as { default: XmlFormat | { default: XmlFormat } };
  const candidate = imported.default;
  return typeof candidate === 'function' ? candidate : candidate.default;
}
