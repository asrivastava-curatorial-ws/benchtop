import { cleanText, inspectText, visible } from '../../lib/unicode';
import { defineTextTool, type Field, type Values } from '../types';

export default defineTextTool({
  input: { label: 'Text', sample: 'Ｐａｙ\u200Bpal café — résumé \u202Egnp.exe 👩🏽\u200D💻 раураl' },
  output: { label: 'Characters' },
  options: [
    {
      key: 'mode',
      label: 'Show',
      type: 'segmented',
      choices: [
        { value: 'inspect', label: 'Every character' },
        { value: 'clean', label: 'Cleaned text' },
      ],
      default: 'inspect',
    },
    {
      key: 'form',
      label: 'Normalise to',
      type: 'select',
      choices: [
        { value: 'NFC', label: 'NFC (composed)' },
        { value: 'NFKC', label: 'NFKC (also folds look-alike forms)' },
        { value: 'none', label: 'No normalisation' },
      ],
      default: 'NFC',
      showIf: (v: Values) => v.mode === 'clean',
    },
    { key: 'keepJoiners', label: 'Keep emoji joiners', type: 'toggle', default: true, showIf: (v: Values) => v.mode === 'clean' },
  ],
  run(input, o) {
    const report = inspectText(input);
    const fields: Field[] = [
      { label: 'Code points', value: [...input].length.toLocaleString('en-US') },
      { label: 'Characters as seen', value: report.graphemes.toLocaleString('en-US') },
      { label: 'UTF-8 bytes', value: report.utf8Bytes.toLocaleString('en-US') },
      { label: 'UTF-16 units', value: report.utf16Units.toLocaleString('en-US') },
      {
        label: 'Hidden characters',
        value: report.invisible.length === 0 ? 'none' : report.invisible.map((c) => `${c.hex} ${c.name || c.category}`).join(', '),
        tone: report.invisible.length > 0 ? 'warn' : 'ok',
      },
      { label: 'Scripts', value: report.scripts.join(', ') || 'none', tone: report.scripts.length > 1 ? 'warn' : undefined },
      { label: 'Normalised (NFC)', value: report.nfc ? 'yes' : 'no', tone: report.nfc ? undefined : 'warn' },
    ];
    const warnings: string[] = [];
    if (report.bidi.length > 0) warnings.push('Bidirectional control characters can make text display in a different order than it is stored (used in "Trojan Source" attacks).');
    if (report.scripts.length > 1 && report.scripts.includes('Latin') && report.scripts.some((s) => s === 'Cyrillic' || s === 'Greek'))
      warnings.push('Latin mixed with Cyrillic or Greek letters: some may be look-alikes (homoglyphs).');
    if (report.nfkcChanges) warnings.push('Some characters have compatibility forms (full-width letters, ligatures, superscripts); NFKC would replace them.');
    if (o.mode === 'clean') return { output: cleanText(input, o.form as 'NFC', o.keepJoiners), fields, warnings };
    const rows = report.chars.map((c) => `${visible(c).padEnd(3)} ${c.hex.padEnd(8)} ${c.utf8.padEnd(12)} ${c.category.padEnd(20)} ${c.script.padEnd(11)} ${c.name}`);
    const header = `${'Chr'.padEnd(3)} ${'Code'.padEnd(8)} ${'UTF-8'.padEnd(12)} ${'Category'.padEnd(20)} ${'Script'.padEnd(11)} Name`;
    const more = [...input].length > report.chars.length ? `\n... ${[...input].length - report.chars.length} more` : '';
    return { output: `${header}\n${rows.join('\n')}${more}\n`, fields, warnings };
  },
});
