import { byteLength, sizeChange } from '../../lib/bytes';
import { formatWithPrettier, prettierIndent } from '../../lib/prettier';
import { defineTextTool } from '../types';
import { INDENT } from './_shared';

const SAMPLE = `const greet=(name="world",{loud=false}={})=>{const msg=\`Hello, \${name}!\`;return loud?msg.toUpperCase():msg}
export default function App({items}){return <ul>{items.map(i=><li key={i.id} onClick={()=>console.log(greet(i.name,{loud:true}))}>{i.name}</li>)}</ul>}`;

export default defineTextTool({
  input: { label: 'Code', language: 'jsx', sample: SAMPLE, accept: '.js,.jsx,.mjs,.cjs,.ts,.tsx,.txt' },
  output: { label: 'Formatted' },
  options: [
    {
      key: 'language',
      label: 'Language',
      type: 'select',
      choices: [
        { value: 'babel', label: 'JavaScript / JSX' },
        { value: 'typescript', label: 'TypeScript / TSX' },
      ],
      default: 'babel',
    },
    INDENT,
    {
      key: 'width',
      label: 'Line width',
      type: 'select',
      choices: ['80', '100', '120'],
      default: '80',
    },
    { key: 'semi', label: 'Semicolons', type: 'toggle', default: true },
    { key: 'singleQuote', label: 'Single quotes', type: 'toggle', default: false },
    {
      key: 'trailingComma',
      label: 'Trailing commas',
      type: 'select',
      choices: [
        { value: 'all', label: 'Everywhere' },
        { value: 'es5', label: 'ES5 (arrays, objects)' },
        { value: 'none', label: 'None' },
      ],
      default: 'all',
    },
  ],
  async run(input, o) {
    const typescript = o.language === 'typescript';
    const output = await formatWithPrettier(input, typescript ? 'typescript' : 'babel', {
      ...prettierIndent(o.indent),
      printWidth: Number(o.width),
      semi: o.semi,
      singleQuote: o.singleQuote,
      trailingComma: o.trailingComma as 'all' | 'es5' | 'none',
    });
    return {
      output,
      language: typescript ? 'typescript' : 'jsx',
      info: sizeChange(byteLength(input), byteLength(output)),
      filename: typescript ? 'code.ts' : 'code.js',
    };
  },
});
