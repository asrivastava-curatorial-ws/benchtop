import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const DAY = 86_400_000;

/** Calendar date (UTC midnight) from "YYYY-MM-DD"; times are ignored. */
export function parseDay(text: string): Date {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) throw new ToolError(`"${text}" is not a date. Use YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCMonth() !== Number(match[2]) - 1) throw new ToolError(`${text} does not exist.`);
  return date;
}

export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Whole years, months and days from `a` to `b` (a ≤ b), counting months on the calendar. */
export function calendarDifference(a: Date, b: Date): { years: number; months: number; days: number } {
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  let months = b.getUTCMonth() - a.getUTCMonth();
  let days = b.getUTCDate() - a.getUTCDate();
  if (days < 0) {
    months--;
    days += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  return { years, months, days };
}

export function workingDays(a: Date, b: Date, weekend: number[]): number {
  let count = 0;
  for (let time = a.getTime(); time < b.getTime(); time += DAY) if (!weekend.includes(new Date(time).getUTCDay())) count++;
  return count;
}

export function addToDate(date: Date, amount: number, unit: string, weekend: number[]): Date {
  const result = new Date(date.getTime());
  switch (unit) {
    case 'years':
      result.setUTCFullYear(result.getUTCFullYear() + amount);
      break;
    case 'months': {
      const day = result.getUTCDate();
      result.setUTCDate(1);
      result.setUTCMonth(result.getUTCMonth() + amount);
      result.setUTCDate(Math.min(day, new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()));
      break;
    }
    case 'weeks':
      result.setUTCDate(result.getUTCDate() + amount * 7);
      break;
    case 'workdays': {
      let left = Math.abs(amount);
      const step = amount < 0 ? -1 : 1;
      while (left > 0) {
        result.setUTCDate(result.getUTCDate() + step);
        if (!weekend.includes(result.getUTCDay())) left--;
      }
      break;
    }
    default:
      result.setUTCDate(result.getUTCDate() + amount);
  }
  return result;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const isoWeek = (date: Date): string => {
  const thursday = new Date(date.getTime() + (3 - ((date.getUTCDay() + 6) % 7)) * DAY);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  return `${thursday.getUTCFullYear()}-W${String(1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};

const today = () => new Date().toISOString().slice(0, 10);

export default defineTextTool({
  input: false,
  output: false,
  options: [
    {
      key: 'mode',
      label: 'Calculate',
      type: 'segmented',
      choices: [
        { value: 'between', label: 'Between dates' },
        { value: 'add', label: 'Add or subtract' },
      ],
      default: 'between',
    },
    { key: 'start', label: 'Start date', type: 'text', default: today(), mono: true, placeholder: 'YYYY-MM-DD' },
    { key: 'end', label: 'End date', type: 'text', default: `${new Date().getFullYear()}-12-31`, mono: true, placeholder: 'YYYY-MM-DD', showIf: (v) => v.mode === 'between' },
    { key: 'includeEnd', label: 'Include the end date', type: 'toggle', default: false, showIf: (v) => v.mode === 'between' },
    { key: 'amount', label: 'Amount', type: 'number', default: 90, step: 1, showIf: (v) => v.mode === 'add', help: 'Negative to go back in time.' },
    { key: 'unit', label: 'Unit', type: 'select', choices: ['days', 'workdays', 'weeks', 'months', 'years'], default: 'days', showIf: (v) => v.mode === 'add' },
    {
      key: 'weekend',
      label: 'Weekend',
      type: 'select',
      choices: [
        { value: '0,6', label: 'Saturday and Sunday' },
        { value: '0', label: 'Sunday only' },
        { value: '5,6', label: 'Friday and Saturday' },
      ],
      default: '0,6',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const weekend = o.weekend.split(',').map(Number);
    const start = parseDay(o.start);
    const fields: Field[] = [];
    if (o.mode === 'add') {
      const result = addToDate(start, Math.trunc(o.amount), o.unit, weekend);
      fields.push(
        { label: 'Result', value: `${isoDay(result)}, ${WEEKDAYS[result.getUTCDay()]}`, tone: 'ok', mono: true },
        { label: 'Days from start', value: String(Math.round((result.getTime() - start.getTime()) / DAY)) },
        { label: 'ISO week', value: isoWeek(result), mono: true },
      );
      return { fields };
    }
    const end = parseDay(o.end);
    const reversed = end < start;
    const [a, b0] = reversed ? [end, start] : [start, end];
    const b = o.includeEnd ? new Date(b0.getTime() + DAY) : b0;
    const days = Math.round((b.getTime() - a.getTime()) / DAY);
    const diff = calendarDifference(a, b);
    fields.push(
      {
        label: 'Difference',
        value: `${diff.years > 0 ? `${diff.years} year${diff.years === 1 ? '' : 's'}, ` : ''}${diff.months} month${diff.months === 1 ? '' : 's'}, ${diff.days} day${diff.days === 1 ? '' : 's'}${reversed ? ' (end is before start)' : ''}`,
        tone: 'ok',
      },
      { label: 'Total days', value: days.toLocaleString('en-IN') },
      { label: 'Weeks', value: `${Math.floor(days / 7)} weeks and ${days % 7} days` },
      { label: 'Working days', value: workingDays(a, b, weekend).toLocaleString('en-IN') },
      { label: 'Hours', value: (days * 24).toLocaleString('en-IN') },
      { label: 'Start', value: `${isoDay(a)}, ${WEEKDAYS[a.getUTCDay()]} (week ${isoWeek(a)})`, mono: true },
    );
    return { fields, info: 'Working days exclude the chosen weekend days but not public holidays.' };
  },
});
