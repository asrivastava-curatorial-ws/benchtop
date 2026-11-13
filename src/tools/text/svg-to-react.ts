import { svgToReact } from '../../lib/svg-to-jsx';
import { defineTextTool } from '../types';
import { SVG_SAMPLE } from './svg-minifier';

export default defineTextTool({
  input: { label: 'SVG', language: 'xml', sample: SVG_SAMPLE, accept: '.svg,image/svg+xml' },
  output: { label: 'React component', language: 'jsx' },
  options: [
    { key: 'name', label: 'Component name', type: 'text', default: 'Icon', mono: true },
    { key: 'typescript', label: 'TypeScript', type: 'toggle', default: true },
    {
      key: 'dimensions',
      label: 'Width / height',
      type: 'select',
      choices: [
        { value: 'keep', label: 'Keep as written' },
        { value: 'remove', label: 'Remove (size with CSS)' },
        { value: 'em', label: 'Set to 1em (icon)' },
      ],
      default: 'keep',
    },
    { key: 'currentColor', label: 'Colours → currentColor', type: 'toggle', default: false },
    { key: 'memo', label: 'Wrap in memo()', type: 'toggle', default: false },
    {
      key: 'exports',
      label: 'Export',
      type: 'select',
      choices: [
        { value: 'default', label: 'Default' },
        { value: 'named', label: 'Named' },
      ],
      default: 'default',
    },
  ],
  run(input, o) {
    const output = svgToReact(input, {
      componentName: o.name.trim(),
      typescript: o.typescript,
      dimensions: o.dimensions as 'keep' | 'remove' | 'em',
      currentColor: o.currentColor,
      memo: o.memo,
      exportDefault: o.exports === 'default',
    });
    return { output, language: o.typescript ? 'typescript' : 'jsx', filename: `${o.name.trim()}.${o.typescript ? 'tsx' : 'jsx'}` };
  },
});
