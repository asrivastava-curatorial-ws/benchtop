import { byteLength, sizeChange } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { formatWithPrettier, type PrettierParser, prettierIndent } from '../../lib/prettier';
import { defineTextTool, type Values } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `:root{--brand:#3b82f6;--gap:1rem}
.card{display:flex;gap:var(--gap);padding:calc(var(--gap)*1.5);border:1px solid rgba(0,0,0,.1);border-radius:.5rem}
.card:hover,.card:focus-within{box-shadow:0 4px 12px rgba(0,0,0,.15)}
@media (min-width:768px){.card{flex-direction:row}}`;

export default defineTextTool({
  input: { label: 'Stylesheet', language: 'css', sample: SAMPLE, accept: '.css,.scss,.less,.txt,text/css' },
  output: { label: 'Result', language: 'css' },
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
    {
      key: 'syntax',
      label: 'Syntax',
      type: 'select',
      choices: [
        { value: 'css', label: 'CSS' },
        { value: 'scss', label: 'SCSS' },
        { value: 'less', label: 'Less' },
      ],
      default: 'css',
      showIf: (v: Values) => v.mode === 'format',
    },
    { ...INDENT, showIf: (v: Values) => v.mode === 'format' },
    {
      key: 'restructure',
      label: 'Merge and reorder rules',
      type: 'toggle',
      default: true,
      showIf: (v: Values) => v.mode === 'minify',
      help: 'Structural optimisation gives smaller output; turn it off to keep the rule order exactly as written.',
    },
    {
      key: 'comments',
      label: 'Comments',
      type: 'select',
      choices: [
        { value: 'none', label: 'Remove all' },
        { value: 'exclamation', label: 'Keep /*! ... */' },
      ],
      default: 'exclamation',
      showIf: (v: Values) => v.mode === 'minify',
    },
  ],
  async run(input, o) {
    if (o.mode === 'format') {
      const output = await formatWithPrettier(input, o.syntax as PrettierParser, prettierIndent(o.indent));
      return { output, info: sizeChange(byteLength(input), byteLength(output)), filename: `styles.${o.syntax}` };
    }
    const { minify } = await import('csso');
    let output: string;
    try {
      output = minify(input, {
        restructure: o.restructure,
        comments: o.comments === 'none' ? false : 'exclamation',
      }).css;
    } catch (error) {
      throw new ToolError(`The CSS could not be minified: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { output, info: sizeChange(byteLength(input), byteLength(output)), filename: 'styles.min.css' };
  },
});
