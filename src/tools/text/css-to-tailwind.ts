import { cssToTailwind } from '../../lib/css-to-tailwind';
import { plural } from '../../lib/text';
import { defineTextTool } from '../types';

const SAMPLE = `.card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 2rem;
  max-width: 28rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background-color: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition-duration: 150ms;
}

.card:hover {
  transform: translateY(-2px);
}

.card > .title {
  font-size: 1.125rem;
  line-height: 1.75rem;
  font-weight: 600;
  color: #111827;
}

@media (min-width: 768px) {
  .card {
    flex-direction: row;
    padding: 2rem;
  }
}`;

export default defineTextTool({
  input: { label: 'CSS', language: 'css', sample: SAMPLE, accept: '.css,.txt,text/css' },
  output: { label: 'Tailwind classes' },
  options: [
    {
      key: 'format',
      label: 'Output',
      type: 'select',
      choices: [
        { value: 'classes', label: 'Class lists' },
        { value: 'apply', label: '@apply rules' },
        { value: 'html', label: 'HTML class attributes' },
      ],
      default: 'classes',
    },
    {
      key: 'snapColors',
      label: 'Snap close colours to the palette',
      type: 'toggle',
      default: false,
      help: 'On: colours very close to a palette colour get its name (Tailwind v3 hex values map to their v4 names). Off: only exact matches are named.',
    },
  ],
  run(input, o) {
    const result = cssToTailwind(input, { snapColors: o.snapColors });
    const blocks = result.groups.map(({ selector, classes }) => {
      const list = classes.join(' ');
      if (o.format === 'apply') return `${selector} {\n  @apply ${list};\n}`;
      if (o.format === 'html') return `<!-- ${selector} -->\nclass="${list.replace(/"/g, "'")}"`;
      return `/* ${selector} */\n${list}`;
    });
    return {
      output: `${blocks.join('\n\n')}\n`,
      language: o.format === 'html' ? 'html' : 'css',
      info: `${plural(result.declarations, 'declaration')} → ${plural(result.groups.length, 'selector')} · ${result.arbitrary} written as arbitrary values`,
      warnings: [
        ...(result.skipped.length > 0 ? [`Not convertible to utilities (keep these in your CSS): ${result.skipped.join(', ')}`] : []),
        ...result.problems.map((problem) => `Skipped a part that could not be parsed: ${problem}`),
      ],
    };
  },
});
