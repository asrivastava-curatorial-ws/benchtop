import { byteLength, formatBytes, sizeChange } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { gzipSize } from '../../lib/prettier';
import { defineTextTool } from '../types';

const SAMPLE = `// Returns the n-th Fibonacci number.
function fibonacci(position) {
  const sequence = [0, 1];
  for (let index = 2; index <= position; index++) {
    sequence.push(sequence[index - 1] + sequence[index - 2]);
  }
  return sequence[position];
}

if (false) { console.log('dead code is removed'); }
console.log(fibonacci(20));`;

export default defineTextTool({
  input: { label: 'JavaScript', language: 'javascript', sample: SAMPLE, accept: '.js,.mjs,.cjs,.txt' },
  output: { label: 'Minified', language: 'javascript' },
  options: [
    { key: 'compress', label: 'Compress', type: 'toggle', default: true, help: 'Simplify code and drop dead branches.' },
    { key: 'mangle', label: 'Shorten names', type: 'toggle', default: true },
    {
      key: 'toplevel',
      label: 'Top-level names too',
      type: 'toggle',
      default: false,
      help: 'Only safe when no other script relies on these global names.',
    },
    { key: 'module', label: 'ES module', type: 'toggle', default: false },
    {
      key: 'comments',
      label: 'Comments',
      type: 'select',
      choices: [
        { value: 'none', label: 'Remove all' },
        { value: 'some', label: 'Keep licences (/*! @license)' },
      ],
      default: 'some',
    },
  ],
  async run(input, o) {
    const { minify } = await import('terser');
    let code: string;
    try {
      const result = await minify(input, {
        compress: o.compress,
        mangle: o.mangle,
        toplevel: o.toplevel,
        module: o.module,
        format: { comments: o.comments === 'some' ? 'some' : false },
      });
      code = result.code ?? '';
    } catch (error) {
      const detail = error as { message?: string; line?: number; col?: number };
      throw new ToolError(`${detail.message ?? 'Syntax error'}${detail.line ? ` at line ${detail.line}, column ${(detail.col ?? 0) + 1}` : ''}.`, {
        line: detail.line,
        column: detail.col === undefined ? undefined : detail.col + 1,
      });
    }
    const [before, after] = await Promise.all([gzipSize(input), gzipSize(code)]);
    const gzip = before !== undefined && after !== undefined ? ` · gzip ${formatBytes(before)} → ${formatBytes(after)}` : '';
    return { output: code, info: `${sizeChange(byteLength(input), byteLength(code))}${gzip}`, filename: 'script.min.js' };
  },
});
