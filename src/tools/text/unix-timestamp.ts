import { formatInZone, localZone, parseInstant, timeZones } from '../../lib/datetime';
import { relativeTime } from '../../lib/jwt';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'value',
      label: 'Timestamp or date',
      type: 'text',
      default: '',
      placeholder: 'now · 1700000000 · 2026-11-13 06:32 · 2026-11-13T01:02:00Z',
      mono: true,
      wide: true,
    },
    {
      key: 'unit',
      label: 'Number is in',
      type: 'select',
      choices: [
        { value: 'auto', label: 'Auto-detect' },
        { value: 's', label: 'Seconds' },
        { value: 'ms', label: 'Milliseconds' },
        { value: 'us', label: 'Microseconds' },
        { value: 'ns', label: 'Nanoseconds' },
      ],
      default: 'auto',
    },
    {
      key: 'zone',
      label: 'Time zone',
      type: 'select',
      choices: () => [{ value: 'local', label: `System (${localZone()})` }, ...timeZones().map((zone) => ({ value: zone, label: zone }))],
      default: 'local',
    },
  ],
  action: 'Refresh',
  runOnEmpty: true,
  run(_input, o) {
    const zone = o.zone === 'local' ? localZone() : o.zone;
    const now = Date.now();
    const { epochMs, interpretation } = parseInstant(o.value, zone, o.unit as 'auto' | 's' | 'ms' | 'us' | 'ns', now);
    const inZone = formatInZone(epochMs, zone);
    const utc = formatInZone(epochMs, 'UTC');
    const fields: Field[] = [
      { label: 'Unix seconds', value: String(Math.floor(epochMs / 1000)), mono: true },
      { label: 'Unix milliseconds', value: String(epochMs), mono: true },
      { label: 'ISO 8601 (UTC)', value: utc.iso, mono: true },
      { label: `ISO 8601 (${zone})`, value: inZone.iso, mono: true },
      { label: `Date in ${zone}`, value: `${inZone.weekday}, ${inZone.date} ${inZone.time} (UTC${inZone.offset})` },
      { label: 'RFC 2822', value: new Date(epochMs).toUTCString(), mono: true },
      { label: 'Relative', value: relativeTime(epochMs, now) },
      { label: 'Day of year / ISO week', value: `${inZone.dayOfYear} / ${inZone.isoWeek}` },
    ];
    return { fields, info: `Read as ${interpretation}` };
  },
});
