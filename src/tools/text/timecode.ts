import { trimNumber } from '../../lib/color';
import { evaluate, framesToSeconds, fromFrames, rateOf } from '../../lib/timecode';
import { defineTextTool, type Field } from '../types';

const SAMPLE = `01:00:00:00 + 00:00:10:12
00:59:58:00 + 250f
01:02:03:04 - 00:58:00:00
00:00:30:00 * 3
90s
1m30s + 12f`;

const RATES = [
  { value: '23.976', label: '23.976 (film for video)' },
  { value: '24', label: '24 (cinema)' },
  { value: '25', label: '25 (PAL, India and Europe)' },
  { value: '29.97df', label: '29.97 drop-frame (NTSC)' },
  { value: '29.97', label: '29.97 non-drop' },
  { value: '30', label: '30' },
  { value: '50', label: '50' },
  { value: '59.94df', label: '59.94 drop-frame' },
  { value: '60', label: '60' },
];

const clock = (seconds: number) => {
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
};

export default defineTextTool({
  input: { label: 'Timecodes and sums, one per line', language: 'text', sample: SAMPLE, placeholder: '01:00:00:00 + 00:00:10:12' },
  output: { label: 'Results' },
  options: [
    { key: 'rate', label: 'Frame rate', type: 'select', choices: RATES, default: '25' },
    {
      key: 'show',
      label: 'Show',
      type: 'segmented',
      choices: [
        { value: 'tc', label: 'Timecode' },
        { value: 'frames', label: 'Frames' },
        { value: 'all', label: 'All' },
      ],
      default: 'all',
    },
  ],
  run(input, o) {
    const rate = rateOf(o.rate);
    const lines = input.split('\n');
    const out: string[] = [];
    const fields: Field[] = [];
    let firstFrames: number | null = null;
    for (const line of lines) {
      if (!line.trim()) {
        out.push('');
        continue;
      }
      try {
        const frames = evaluate(line, rate);
        firstFrames ??= frames;
        const tc = fromFrames(frames, rate);
        out.push(o.show === 'tc' ? tc : o.show === 'frames' ? `${frames}` : `${tc}   ${String(frames).padStart(8)} f   ${clock(framesToSeconds(frames, rate))}`);
      } catch (error) {
        out.push(`! ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (firstFrames !== null) {
      const seconds = framesToSeconds(firstFrames, rate);
      fields.push(
        { label: 'Timecode', value: fromFrames(firstFrames, rate), mono: true },
        { label: 'Frames', value: String(firstFrames), mono: true },
        { label: 'Real time', value: clock(seconds), mono: true },
        { label: 'Seconds', value: trimNumber(seconds, 4), mono: true },
      );
      if (rate.fps % 1 !== 0 && !rate.drop)
        fields.push({ label: 'Note', value: 'Non-drop timecode at this rate runs slow against the clock: one hour of timecode lasts 3.6 seconds longer.', tone: 'warn' });
    }
    return { output: out.join('\n'), fields, info: `${trimNumber(rate.fps, 3)} frames a second${rate.drop ? ', drop-frame' : ''}` };
  },
});
