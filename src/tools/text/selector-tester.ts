import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const describe = (node: Node): string => {
  if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).outerHTML;
  if (node.nodeType === Node.ATTRIBUTE_NODE) return `${(node as Attr).name}="${(node as Attr).value}"`;
  return node.textContent ?? '';
};

export default defineTextTool({
  input: {
    label: 'HTML or XML',
    language: 'html',
    sample:
      '<ul id="galleries">\n  <li class="hall" data-floor="0"><a href="/engines">Engines</a></li>\n  <li class="hall" data-floor="1"><a href="/space">Space</a></li>\n  <li class="hall closed" data-floor="1"><a href="/kids">Kids</a></li>\n</ul>',
  },
  output: { label: 'Matches', language: 'html' },
  options: [
    {
      key: 'mode',
      label: 'Query with',
      type: 'segmented',
      choices: [
        { value: 'css', label: 'CSS selector' },
        { value: 'xpath', label: 'XPath' },
      ],
      default: 'css',
    },
    { key: 'query', label: 'Expression', type: 'text', default: 'li.hall:not(.closed) > a', mono: true, wide: true, placeholder: 'li.hall > a   or   //li[@data-floor="1"]/a/text()' },
    {
      key: 'as',
      label: 'Parse as',
      type: 'segmented',
      choices: [
        { value: 'text/html', label: 'HTML' },
        { value: 'application/xml', label: 'XML' },
      ],
      default: 'text/html',
    },
    {
      key: 'show',
      label: 'Show',
      type: 'select',
      choices: [
        { value: 'outer', label: 'Whole element' },
        { value: 'text', label: 'Text only' },
      ],
      default: 'outer',
    },
  ],
  mainThread: true,
  run(input, o) {
    if (input.trim() === '' || o.query.trim() === '') return '';
    const document = new DOMParser().parseFromString(input, o.as as DOMParserSupportedType);
    const error = document.querySelector('parsererror');
    if (error) throw new ToolError(`The XML is not well-formed: ${error.textContent?.split('\n')[0] ?? ''}`);
    let nodes: Node[] = [];
    let scalar: string | null = null;
    if (o.mode === 'css') {
      try {
        nodes = [...document.querySelectorAll(o.query)];
      } catch {
        throw new ToolError(`"${o.query}" is not a valid CSS selector.`);
      }
    } else {
      let result: XPathResult;
      try {
        result = document.evaluate(o.query, document, document.createNSResolver?.(document.documentElement) ?? null, XPathResult.ANY_TYPE, null);
      } catch (cause) {
        throw new ToolError(`"${o.query}" is not a valid XPath expression${cause instanceof Error ? `: ${cause.message}` : ''}.`);
      }
      if (result.resultType === XPathResult.NUMBER_TYPE) scalar = String(result.numberValue);
      else if (result.resultType === XPathResult.STRING_TYPE) scalar = result.stringValue;
      else if (result.resultType === XPathResult.BOOLEAN_TYPE) scalar = String(result.booleanValue);
      else for (let node = result.iterateNext(); node; node = result.iterateNext()) nodes.push(node);
    }
    if (scalar !== null) return { output: scalar, fields: [{ label: 'Result', value: scalar, mono: true }] };
    const fields: Field[] = [{ label: 'Matches', value: String(nodes.length), tone: nodes.length > 0 ? 'ok' : 'warn' }];
    const output = nodes.map((node) => (o.show === 'text' ? (node.textContent ?? '').trim() : describe(node))).join('\n');
    return { output, fields };
  },
});
