import { buildGitignore, GITIGNORE_TEMPLATES } from '../../lib/gitignore';
import { defineTextTool, type OptionDef } from '../types';

const DEFAULTS = new Set(['node', 'vscode', 'linux', 'windows', 'macos', 'secrets', 'logs']);

const groups = [...new Set(GITIGNORE_TEMPLATES.map((template) => template.group))];
const options: OptionDef[] = groups.flatMap((group) => [
  { key: `heading-${group}`, label: group, type: 'heading' } as OptionDef,
  ...GITIGNORE_TEMPLATES.filter((template) => template.group === group).map(
    (template) => ({ key: template.id, label: template.label, type: 'toggle', default: DEFAULTS.has(template.id) }) as OptionDef,
  ),
]);

export default defineTextTool({
  input: { label: 'Your own patterns (optional)', placeholder: 'uploads/\n*.sqlite' },
  output: { label: '.gitignore' },
  options: options as readonly OptionDef[],
  runOnEmpty: true,
  run(input, o) {
    const values = o as Record<string, unknown>;
    const chosen = GITIGNORE_TEMPLATES.filter((template) => values[template.id] === true).map((template) => template.id);
    const output = buildGitignore(chosen, input);
    return {
      output,
      filename: '.gitignore',
      info:
        chosen.length === 0 ? 'Turn on the languages, tools and systems this project uses.' : `${chosen.length} templates. Patterns starting with ! re-include files that an earlier pattern ignored.`,
    };
  },
});
