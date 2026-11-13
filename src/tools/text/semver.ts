import semver from 'semver';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: { label: 'Versions (one per line)', sample: '1.2.3\n2.0.0-rc.1\n1.10.0\n2.0.0\nv1.9.4\n0.9.12\n1.2.3-beta.2\n2.1.0' },
  output: { label: 'Sorted' },
  options: [
    {
      key: 'range',
      label: 'Range to check',
      type: 'text',
      default: '^1.2.0 || >=2.0.0 <2.1.0',
      mono: true,
      wide: true,
      help: 'npm range syntax: ^1.2.3, ~1.2, 1.x, >=1.0.0 <2, 1.2 - 1.4, combined with ||.',
    },
    { key: 'prerelease', label: 'Let prereleases match', type: 'toggle', default: false },
    { key: 'descending', label: 'Newest first', type: 'toggle', default: true },
  ],
  run(input, o) {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const line of lines) {
      const version = semver.valid(semver.clean(line, { loose: true }) ?? line);
      if (version) valid.push(version);
      else invalid.push(line);
    }
    const sorted = o.descending ? semver.rsort([...valid]) : semver.sort([...valid]);
    const range = o.range.trim();
    let validRange: string | null = null;
    if (range !== '') {
      validRange = semver.validRange(range);
      if (validRange === null) throw new ToolError(`"${range}" is not a valid version range.`);
    }
    const matches = (version: string) => validRange !== null && semver.satisfies(version, validRange, { includePrerelease: o.prerelease });
    const fields: Field[] = [];
    if (validRange !== null) {
      fields.push({ label: 'Range means', value: validRange, mono: true });
      fields.push({
        label: 'Highest match',
        value: semver.maxSatisfying(valid, validRange, { includePrerelease: o.prerelease }) ?? 'none',
        tone: semver.maxSatisfying(valid, validRange) ? 'ok' : 'warn',
      });
    }
    if (sorted.length > 0) {
      const latest = semver.rsort([...valid])[0] as string;
      fields.push(
        { label: 'Latest', value: latest },
        { label: 'Next versions', value: `patch ${semver.inc(latest, 'patch')}, minor ${semver.inc(latest, 'minor')}, major ${semver.inc(latest, 'major')}`, mono: true },
      );
    }
    if (valid.length >= 2) fields.push({ label: `${valid[0]} → ${valid[1]}`, value: semver.diff(valid[0] as string, valid[1] as string) ?? 'same version' });
    const output = sorted.map((version) => (validRange === null ? version : `${matches(version) ? '✓' : ' '} ${version}`)).join('\n');
    return { output: `${output}\n`, fields, warnings: invalid.length > 0 ? [`Not semantic versions: ${invalid.join(', ')}`] : [] };
  },
});
