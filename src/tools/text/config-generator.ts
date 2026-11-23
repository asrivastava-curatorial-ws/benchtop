import { FIELDS, type Field, fileOf, TEMPLATE_BY_ID, TEMPLATES } from '../../lib/config-templates';
import { defineTextTool, type OptionDef, type Values } from '../types';

/** Templates in group order, so each group is one block in the list. */
const GROUPS = [...new Set(TEMPLATES.map((t) => t.group))];
const ORDERED = GROUPS.flatMap((group) => TEMPLATES.filter((t) => t.group === group));
const FALLBACK = ORDERED[0] as (typeof ORDERED)[number];

const usedBy = (key: string) => (v: Values) => TEMPLATE_BY_ID.get(String(v.template))?.fields.includes(key) ?? false;

function control(field: Field): OptionDef {
  const base = { key: field.key, label: field.label, showIf: usedBy(field.key), ...(field.help ? { help: field.help } : {}) };
  switch (field.kind) {
    case 'number':
      return { ...base, type: 'number', default: Number(field.default), min: 0, max: 65535, step: 1 };
    case 'toggle':
      return { ...base, type: 'toggle', default: field.default === true };
    case 'choice':
      return { ...base, type: 'select', choices: (field.choices ?? []).map(([value, label]) => ({ value, label })), default: String(field.default) };
    case 'lines':
      return { ...base, type: 'text', default: String(field.default), multiline: true, mono: true, wide: true };
    default:
      return { ...base, type: 'text', default: String(field.default), mono: true, ...(field.secret ? { secret: true } : {}) };
  }
}

const options: OptionDef[] = [
  {
    key: 'template',
    label: 'File',
    type: 'select',
    choices: ORDERED.map((t) => ({ value: t.id, label: t.name, group: t.group })),
    default: 'gha-node',
  },
  ...FIELDS.map(control),
];

export default defineTextTool({
  input: false,
  output: { label: 'File' },
  options,
  runOnEmpty: true,
  run(_input, values) {
    const v = values as Values;
    const template = TEMPLATE_BY_ID.get(String(v.template)) ?? FALLBACK;
    const file = fileOf(template, v);
    return {
      output: template.render(v),
      language: template.lang,
      filename: file.split('/').pop() || file,
      info: `${template.about} Save it as ${file}.`,
    };
  },
});
