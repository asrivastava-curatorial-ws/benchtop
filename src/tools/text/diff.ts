import { createTwoFilesPatch, diffChars, diffLines, diffWordsWithSpace } from 'diff';
import { ToolError } from '../../lib/errors';
import { escapeHtml } from '../../lib/text';
import { type DiffRow, defineTextTool, type Values } from '../types';

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

export default defineTextTool({
  input: { label: 'Original', sample: ORIGINAL },
  input2: { label: 'Changed', sample: CHANGED },
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
    { key: 'ignoreWhitespace', label: 'Ignore leading/trailing spaces', type: 'toggle', default: false, showIf: (v: Values) => v.mode === 'lines' },
    { key: 'ignoreCase', label: 'Ignore case', type: 'toggle', default: false },
    { key: 'context', label: 'Patch context', type: 'select', choices: ['0', '3', '5', '10'], default: '3', showIf: (v: Values) => v.mode === 'lines' },
  ],
  runOnEmpty: true,
  run(input, o, ctx) {
    // A missing final newline is not a difference worth showing, so both sides are normalised.
    const normalise = (text: string) => {
      const unix = text.replace(/\r\n?/g, '\n');
      return unix === '' || unix.endsWith('\n') || o.mode !== 'lines' ? unix : `${unix}\n`;
    };
    const before = normalise(input);
    const after = normalise(ctx.input2);
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

    // Rows are rebuilt from the original lines using each part's line count, so options that make
    // lines "equal" (case, whitespace) never change the text that is displayed.
    const beforeLines = toLines(before);
    const afterLines = toLines(after);
    const fold = (text: string) => (o.ignoreCase ? text.toLowerCase() : text);
    const parts = diffLines(fold(before), fold(after), { ignoreWhitespace: o.ignoreWhitespace, timeout: TIME_LIMIT_MS });
    if (!parts) throw tooSlow();
    const rows: DiffRow[] = [];
    let left = 0;
    let right = 0;
    let added = 0;
    let removed = 0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part) continue;
      const count = part.count ?? toLines(part.value).length;
      if (part.removed) {
        const lines = beforeLines.slice(left, left + count);
        const next = parts[index + 1];
        const replacement = next?.added ? afterLines.slice(right, right + (next.count ?? toLines(next.value).length)) : null;
        lines.forEach((text, offset) => {
          const partner = replacement?.[offset];
          rows.push({ type: 'del', left: left + offset + 1, text, spans: partner === undefined ? undefined : changedSpans(text, partner, 'removed') });
        });
        left += count;
        removed += count;
        if (replacement) {
          replacement.forEach((text, offset) => {
            const partner = lines[offset];
            rows.push({ type: 'add', right: right + offset + 1, text, spans: partner === undefined ? undefined : changedSpans(text, partner, 'added') });
          });
          right += replacement.length;
          added += replacement.length;
          index++;
        }
      } else if (part.added) {
        afterLines.slice(right, right + count).forEach((text, offset) => {
          rows.push({ type: 'add', right: right + offset + 1, text });
        });
        right += count;
        added += count;
      } else {
        for (let offset = 0; offset < count; offset++) {
          rows.push({ type: 'same', left: left + offset + 1, right: right + offset + 1, text: afterLines[right + offset] ?? '' });
        }
        left += count;
        right += count;
      }
    }
    const identical = added + removed === 0;
    const patch = identical ? '' : createTwoFilesPatch('original', 'changed', before, after, '', '', { context: Number(o.context), ignoreWhitespace: o.ignoreWhitespace });
    return {
      output: patch,
      preview: { kind: 'diff', rows },
      info: identical ? (before === after ? 'The texts are identical' : 'No differences with the current options') : `${added} line${added === 1 ? '' : 's'} added, ${removed} removed`,
      filename: 'changes.patch',
    };
  },
});
