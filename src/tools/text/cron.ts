import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';
import { formatInZone, localZone, timeZones } from '../../lib/datetime';
import { ToolError } from '../../lib/errors';
import { relativeTime } from '../../lib/jwt';
import { defineTextTool, type Field } from '../types';

const FIELD_NAMES = ['Minute', 'Hour', 'Day of month', 'Month', 'Day of week'];
const FIELD_RANGES = ['0-59', '0-23', '1-31', '1-12 or JAN-DEC', '0-7 or SUN-SAT (0 and 7 are Sunday)'];
const NICKNAMES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export default defineTextTool({
  input: false,
  output: { label: 'Upcoming runs' },
  options: [
    { key: 'expression', label: 'Cron expression', type: 'text', default: '*/15 9-17 * * 1-5', mono: true, wide: true, placeholder: 'minute hour day month weekday' },
    {
      key: 'zone',
      label: 'Time zone',
      type: 'select',
      choices: () => [{ value: 'local', label: `System (${localZone()})` }, ...timeZones().map((zone) => ({ value: zone, label: zone }))],
      default: 'local',
    },
    { key: 'count', label: 'Show next', type: 'select', choices: ['5', '10', '25', '50'], default: '10' },
    { key: 'clock24', label: '24-hour times', type: 'toggle', default: true },
  ],
  presets: [
    { name: 'Every minute', values: { expression: '* * * * *' } },
    { name: 'Every 5 minutes', values: { expression: '*/5 * * * *' } },
    { name: 'Hourly', values: { expression: '0 * * * *' } },
    { name: 'Daily at 02:30', values: { expression: '30 2 * * *' } },
    { name: 'Weekdays at 09:00', values: { expression: '0 9 * * 1-5' } },
    { name: 'Mondays at 08:00', values: { expression: '0 8 * * 1' } },
    { name: 'First of the month', values: { expression: '0 0 1 * *' } },
    { name: 'Quarterly', values: { expression: '0 0 1 */3 *' } },
  ],
  action: 'Refresh',
  runOnEmpty: true,
  run(_input, o) {
    const typed = o.expression.trim().replace(/\s+/g, ' ');
    if (typed === '') throw new ToolError('Enter a cron expression, for example "0 9 * * 1-5".');
    const expression = NICKNAMES[typed.toLowerCase()] ?? typed;
    const parts = expression.split(' ');
    if (typed.startsWith('@') && !NICKNAMES[typed.toLowerCase()]) {
      throw new ToolError(`Unknown shortcut "${typed}". Supported: ${Object.keys(NICKNAMES).join(', ')}.`);
    }
    if (parts.length !== 5) {
      throw new ToolError(
        `A cron expression has 5 fields (minute hour day-of-month month day-of-week); this one has ${parts.length}.${parts.length === 6 ? ' Six-field expressions with seconds are a Quartz/Spring extension, not standard cron.' : ''}`,
      );
    }
    const zone = o.zone === 'local' ? localZone() : o.zone;
    const now = Date.now();
    let description: string;
    let runs: number[];
    try {
      description = cronstrue.toString(expression, { use24HourTimeFormat: o.clock24 });
      const schedule = CronExpressionParser.parse(expression, { currentDate: new Date(now), tz: zone });
      runs = schedule.take(Number(o.count)).map((date) => date.getTime());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolError(`Invalid cron expression: ${message.replace(/^Error:\s*/, '').replace(/\.$/, '')}.`);
    }
    const fields: Field[] = [
      { label: 'Meaning', value: description, tone: 'ok' },
      ...parts.map((part, index) => ({ label: `${FIELD_NAMES[index]} (${FIELD_RANGES[index]})`, value: part, mono: true })),
    ];
    const lines = runs.map((time) => {
      const at = formatInZone(time, zone);
      return `${at.date} ${at.time}  ${at.weekday.slice(0, 3)}  UTC${at.offset}  (${relativeTime(time, now)})`;
    });
    return {
      output: lines.join('\n'),
      fields,
      info: `Times shown in ${zone}`,
      warnings: runs.length === 0 ? ['This expression never matches a real date.'] : undefined,
    };
  },
});
