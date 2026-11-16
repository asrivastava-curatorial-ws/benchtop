import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: {
    label: 'SCSS, Sass or Less',
    language: 'css',
    sample:
      '$accent: #2f81f7;\n$radius: 6px;\n\n@mixin card($pad: 16px) {\n  padding: $pad;\n  border-radius: $radius;\n}\n\n.gallery {\n  @include card(24px);\n  border: 1px solid rgba($accent, 0.4);\n\n  &:hover { border-color: darken($accent, 10%); }\n  .title { color: $accent; }\n}\n',
  },
  output: { label: 'CSS', language: 'css' },
  options: [
    {
      key: 'syntax',
      label: 'Language',
      type: 'segmented',
      choices: [
        { value: 'scss', label: 'SCSS' },
        { value: 'sass', label: 'Sass (indented)' },
        { value: 'less', label: 'Less' },
      ],
      default: 'scss',
    },
    {
      key: 'style',
      label: 'Output',
      type: 'segmented',
      choices: [
        { value: 'expanded', label: 'Readable' },
        { value: 'compressed', label: 'Minified' },
      ],
      default: 'expanded',
    },
  ],
  async run(input, o) {
    if (input.trim() === '') return '';
    if (o.syntax === 'less') {
      const { default: less } = await import('less');
      try {
        const result = await less.render(input, { compress: o.style === 'compressed', javascriptEnabled: false });
        return { output: result.css };
      } catch (error) {
        const detail = error as { message?: string; line?: number; column?: number };
        throw new ToolError(`Less: ${detail.message ?? String(error)}`, { line: detail.line, column: detail.column !== undefined ? detail.column + 1 : undefined });
      }
    }
    const sass = await import('sass');
    try {
      const result = sass.compileString(input, {
        syntax: o.syntax === 'sass' ? 'indented' : 'scss',
        style: o.style as 'expanded' | 'compressed',
        silenceDeprecations: ['color-functions', 'global-builtin', 'import'] as never,
      });
      return { output: `${result.css}\n` };
    } catch (error) {
      const detail = error as { sassMessage?: string; message?: string; span?: { start?: { line: number; column: number } } };
      throw new ToolError(`Sass: ${detail.sassMessage ?? detail.message ?? String(error)}`, {
        line: (detail.span?.start?.line ?? -1) + 1 || undefined,
        column: (detail.span?.start?.column ?? -1) + 1 || undefined,
      });
    }
  },
});
