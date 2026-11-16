import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

const duration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [days && `${days} d`, (days || hours) && `${hours} h`, (days || hours || minutes) && `${minutes} min`, `${seconds} s`].filter(Boolean).join(' ');
};

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'total', label: 'Total amount of work', type: 'number', default: 1200, min: 0, step: 1, help: 'Files, items, megabytes: any unit.' },
    { key: 'done', label: 'Done so far', type: 'number', default: 150, min: 0, step: 1 },
    { key: 'elapsed', label: 'Time taken so far', type: 'number', default: 25, min: 0, step: 1 },
    {
      key: 'unit',
      label: 'Time unit',
      type: 'select',
      choices: [
        { value: '1000', label: 'Seconds' },
        { value: '60000', label: 'Minutes' },
        { value: '3600000', label: 'Hours' },
      ],
      default: '60000',
    },
    { key: 'start', label: 'Started at', type: 'text', default: '', placeholder: 'Optional, e.g. 2026-11-16 09:30; empty means "time taken" ago' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.done <= 0) throw new ToolError('Enter how much is done so far.');
    if (o.done > o.total) throw new ToolError('Done cannot be more than the total.');
    const elapsedMs = o.elapsed * Number(o.unit);
    const started = o.start.trim() === '' ? Date.now() - elapsedMs : Date.parse(o.start.replace(' ', 'T'));
    if (Number.isNaN(started)) throw new ToolError('The start time is not a date and time.');
    const rate = o.done / elapsedMs;
    const remainingMs = (o.total - o.done) / rate;
    const end = new Date(started + elapsedMs + remainingMs);
    return {
      fields: [
        { label: 'Progress', value: `${((o.done / o.total) * 100).toFixed(1)}%` },
        { label: 'Time left', value: duration(remainingMs), tone: 'ok' },
        { label: 'Finishes at', value: end.toLocaleString(), mono: true },
        { label: 'Total duration', value: duration(elapsedMs + remainingMs) },
        { label: 'Rate', value: `${(rate * Number(o.unit)).toFixed(2)} per ${{ 1000: 'second', 60000: 'minute', 3600000: 'hour' }[o.unit as '1000'] ?? 'unit'}` },
      ],
    };
  },
});
