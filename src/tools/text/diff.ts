import { createTwoFilesPatch, diffArrays, diffChars, diffWordsWithSpace } from 'diff';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { escapeHtml } from '../../lib/text';
import { loadXmlFormatter } from '../../lib/xml-format';
import { type DiffRow, defineTextTool, type Field, type Values } from '../types';

const ORIGINAL = `function greet(name) {
  console.log("Hello, " + name);
  return true;
}

greet("world");
`;

const CHANGED = `function greet(name, punctuation = "!") {
  console.log(\`Hello, \${name}\${punctuation}\`);
  return true;
}

// say hello
greet("Benchtop");
`;

const TIME_LIMIT_MS = 8000;

function toLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Character ranges of `line` that differ from `other`, at word granularity. */
function changedSpans(line: string, other: string, side: 'removed' | 'added'): [number, number][] {
  if (line.length > 2000 || other.length > 2000) return [];
  const parts = side === 'removed' ? diffWordsWithSpace(line, other) : diffWordsWithSpace(other, line);
  const spans: [number, number][] = [];
  let offset = 0;
  for (const part of parts) {
    const mine = side === 'removed' ? part.removed : part.added;
    const theirs = side === 'removed' ? part.added : part.removed;
    if (theirs) continue;
    if (mine) spans.push([offset, offset + part.value.length]);
    offset += part.value.length;
  }
  // When nearly everything changed, highlighting adds nothing.
  const covered = spans.reduce((total, [start, end]) => total + end - start, 0);
  return covered > line.length * 0.8 ? [] : spans;
}

/** JSON with keys sorted at every level, so key order never shows as a difference. */
function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortedJson((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

async function normalise(text: string, as: string, side: string): Promise<string> {
  if (text.trim() === '') return text;
  if (as === 'json') {
    try {
      return `${JSON.stringify(sortedJson(parseJson(text)), null, 2)}\n`;
    } catch (error) {
      throw new ToolError(`The ${side} text is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (as === 'xml') {
    const format = await loadXmlFormatter();
    try {
      return `${format(text, { indentation: '  ', collapseContent: true, lineSeparator: '\n' })}\n`;
    } catch (error) {
      throw new ToolError(`The ${side} text is not well-formed XML: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (as === 'sorted')
    return `${toLines(text.replace(/\r\n?/g, '\n'))
      .sort((a, b) => a.localeCompare(b))
      .join('\n')}\n`;
  return text;
}

const isLines = (values: Values): boolean => values.mode === 'lines';

export default defineTextTool({
  input: { label: 'Original', sample: ORIGINAL, documents: true },
  input2: { label: 'Changed', sample: CHANGED, documents: true },
  output: { label: 'Unified patch' },
  options: [
    {
      key: 'mode',
      label: 'Compare by',
      type: 'segmented',
      choices: [
        { value: 'lines', label: 'Lines' },
        { value: 'words', label: 'Words' },
        { value: 'chars', label: 'Characters' },
      ],
      default: 'lines',
    },
    {
      key: 'view',
      label: 'View',
      type: 'segmented',
      choices: [
        { value: 'split', label: 'Side by side' },
        { value: 'unified', label: 'One column' },
      ],
      default: 'split',
      showIf: isLines,
    },
    { key: 'onlyChanges', label: 'Only show changes', type: 'toggle', default: false, showIf: isLines, help: 'Collapses unchanged lines, keeping a few around each change.' },
    {
      key: 'as',
      label: 'Compare as',
      type: 'select',
      choices: [
        { value: 'text', label: 'Text' },
        { value: 'json', label: 'JSON (formatted, keys sorted)' },
        { value: 'xml', label: 'XML (formatted)' },
        { value: 'sorted', label: 'Sorted lines (order ignored)' },
      ],
      default: 'text',
    },
    { key: 'ignoreWhitespace', label: 'Ignore leading/trailing spaces', type: 'toggle', default: false, showIf: isLines },
    { key: 'ignoreAllSpace', label: 'Ignore all whitespace changes', type: 'toggle', default: false, showIf: isLines, help: 'Treats "a  b" and "a b" as the same, and ignores spaces at line ends.' },
    { key: 'ignoreBlank', label: 'Ignore blank lines', type: 'toggle', default: false, showIf: isLines },
    { key: 'ignoreCase', label: 'Ignore case', type: 'toggle', default: false },
    {
      key: 'context',
      label: 'Context lines',
      type: 'select',
      choices: ['0', '1', '3', '5', '10'],
      default: '3',
      showIf: isLines,
      help: 'Around each change, in the patch and when only changes are shown.',
    },
  ],
  runOnEmpty: true,
  async run(input, o, ctx) {
    // A missing final newline is not a difference worth showing, so both sides are normalised.
    const finish = (text: string) => {
      const unix = text.replace(/\r\n?/g, '\n');
      return unix === '' || unix.endsWith('\n') || o.mode !== 'lines' ? unix : `${unix}\n`;
    };
    const rawSame = finish(input) === finish(ctx.input2);
    const before = finish(await normalise(input, o.as, 'original'));
    const after = finish(await normalise(ctx.input2, o.as, 'changed'));
    const tooSlow = () => new ToolError('These texts are too different to compare within the time limit. Try comparing smaller sections.');

    if (o.mode !== 'lines') {
      const parts = (o.mode === 'words' ? diffWordsWithSpace : diffChars)(before, after, { ignoreCase: o.ignoreCase, timeout: TIME_LIMIT_MS });
      if (!parts) throw tooSlow();
      let added = 0;
      let removed = 0;
      const html = parts
        .map((part) => {
          const text = escapeHtml(part.value);
          if (part.added) {
            added++;
            return `<ins>${text}</ins>`;
          }
          if (part.removed) {
            removed++;
            return `<del>${text}</del>`;
          }
          return text;
        })
        .join('');
      const unit = o.mode === 'words' ? 'word run' : 'character run';
      return {
        preview: { kind: 'html', html: `<pre class="inline-diff">${html}</pre>` },
        info: added + removed === 0 ? 'The texts are identical' : `${added} ${unit}${added === 1 ? '' : 's'} added, ${removed} removed`,
      };
    }

    // Lines are compared through a folded key (case, spaces) but displayed as typed.
    const fold = (line: string) => {
      let key = o.ignoreCase ? line.toLowerCase() : line;
      if (o.ignoreAllSpace) key = key.replace(/\s+/g, ' ').trim();
      else if (o.ignoreWhitespace) key = key.trim();
      return key;
    };
    const number = (lines: string[]) => lines.map((text, index) => ({ text, line: index + 1, key: fold(text) })).filter((item) => !o.ignoreBlank || item.text.trim() !== '');
    const left = number(toLines(before));
    const right = number(toLines(after));
    const parts = diffArrays(left, right, { comparator: (a, b) => a.key === b.key, timeout: TIME_LIMIT_MS });
    if (!parts) throw tooSlow();

    const rows: DiffRow[] = [];
    let l = 0;
    let r = 0;
    let added = 0;
    let removed = 0;
    let changed = 0;
    let same = 0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part) continue;
      const count = part.count ?? part.value.length;
      if (part.removed) {
        const lines = left.slice(l, l + count);
        const next = parts[index + 1];
        const replacement = next?.added ? right.slice(r, r + (next.count ?? next.value.length)) : null;
        lines.forEach((item, offset) => {
          const partner = replacement?.[offset];
          rows.push({ type: 'del', left: item.line, text: item.text, spans: partner === undefined ? undefined : changedSpans(item.text, partner.text, 'removed') });
        });
        l += count;
        removed += count;
        if (replacement) {
          replacement.forEach((item, offset) => {
            const partner = lines[offset];
            rows.push({ type: 'add', right: item.line, text: item.text, spans: partner === undefined ? undefined : changedSpans(item.text, partner.text, 'added') });
          });
          changed += Math.min(lines.length, replacement.length);
          r += replacement.length;
          added += replacement.length;
          index++;
        }
      } else if (part.added) {
        for (const item of right.slice(r, r + count)) rows.push({ type: 'add', right: item.line, text: item.text });
        r += count;
        added += count;
      } else {
        for (let offset = 0; offset < count; offset++) {
          const mine = left[l + offset];
          const theirs = right[r + offset];
          rows.push({ type: 'same', left: mine?.line, right: theirs?.line, text: theirs?.text ?? '' });
        }
        l += count;
        r += count;
        same += count;
      }
    }
    const identical = added + removed === 0;
    const patch = identical ? '' : createTwoFilesPatch('original', 'changed', before, after, '', '', { context: Number(o.context), ignoreWhitespace: o.ignoreWhitespace });
    const total = left.length + right.length;
    const similarity = total === 0 ? 100 : Math.round(((2 * same) / total) * 1000) / 10;
    const fields: Field[] = identical
      ? []
      : [
          { label: 'Lines removed', value: String(removed - changed), tone: removed - changed > 0 ? 'bad' : undefined },
          { label: 'Lines added', value: String(added - changed), tone: added - changed > 0 ? 'ok' : undefined },
          { label: 'Lines changed', value: String(changed), tone: changed > 0 ? 'warn' : undefined },
          { label: 'Unchanged lines', value: String(same) },
          { label: 'Similarity', value: `${similarity}%` },
        ];
    return {
      output: patch,
      preview: { kind: 'diff', rows, layout: o.view === 'unified' ? 'unified' : 'split', context: o.onlyChanges ? Number(o.context) : undefined, titles: ['Original', 'Changed'] },
      fields,
      info: identical ? (rawSame ? 'The texts are identical' : 'No differences with the current options') : `${added} line${added === 1 ? '' : 's'} added, ${removed} removed`,
      filename: 'changes.patch',
    };
  },
});
