import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const minutesOf = (text: string): number => {
  const match = /^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/i.exec(text.trim());
  if (!match) throw new ToolError(`"${text}" is not a time.`);
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

export const hhmm = (minutes: number): string => `${minutes < 0 ? '-' : ''}${Math.floor(Math.abs(minutes) / 60)}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;

export default defineTextTool({
  input: {
    label: 'Days worked',
    placeholder: 'One day per line: label start-end [break minutes]',
    sample: 'Mon 09:00-17:30 30\nTue 9:15-18:00 45\nWed 08:45-17:00 30\nThu 10:00-19:30 60\nFri 9am-1pm',
  },
  output: { label: 'Summary' },
  options: [
    { key: 'standard', label: 'Normal hours per day', type: 'number', default: 8, min: 0, max: 24, step: 0.25, unit: 'h' },
    { key: 'rate', label: 'Hourly rate', type: 'number', default: 0, min: 0, step: 1, help: 'Optional, to total the pay.' },
    { key: 'overtime', label: 'Overtime multiplier', type: 'number', default: 1.5, min: 1, max: 4, step: 0.25 },
  ],
  run(input, o) {
    const rows = input
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line, index) => {
        const match = /^(.*?)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*[-–to]+\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)(?:\s+(\d+))?\s*$/i.exec(line.trim());
        if (!match) throw new ToolError(`Line ${index + 1}: write it as "Mon 09:00-17:30 30".`, { line: index + 1 });
        let worked = minutesOf(match[3] as string) - minutesOf(match[2] as string);
        if (worked < 0) worked += 24 * 60;
        worked -= Number(match[4] ?? 0);
        return { label: (match[1] as string) || `Day ${index + 1}`, worked };
      });
    const total = rows.reduce((sum, row) => sum + row.worked, 0);
    const standard = Math.round(o.standard * 60);
    const overtime = rows.reduce((sum, row) => sum + Math.max(0, row.worked - standard), 0);
    const fields: Field[] = [
      { label: 'Total', value: `${hhmm(total)} (${(total / 60).toFixed(2)} h)`, tone: 'ok' },
      { label: 'Days', value: String(rows.length) },
      { label: 'Average per day', value: hhmm(Math.round(total / Math.max(1, rows.length))) },
      { label: 'Overtime', value: `${hhmm(overtime)} (${(overtime / 60).toFixed(2)} h)`, tone: overtime > 0 ? 'warn' : undefined },
    ];
    if (o.rate > 0) fields.push({ label: 'Pay', value: (((total - overtime) / 60) * o.rate + (overtime / 60) * o.rate * o.overtime).toLocaleString('en-IN', { maximumFractionDigits: 2 }) });
    return { output: rows.map((row) => `${row.label.padEnd(12)} ${hhmm(row.worked).padStart(6)}${row.worked > standard ? `  +${hhmm(row.worked - standard)} overtime` : ''}`).join('\n'), fields };
  },
});
