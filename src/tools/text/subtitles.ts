import { adjust, checkCues, parseSubtitles, writeSubtitles } from '../../lib/subtitles';
import { defineTextTool, type TextResult } from '../types';

const SAMPLE = `1
00:00:01,200 --> 00:00:03,900
Welcome to the Engine Hall.

2
00:00:04,100 --> 00:00:06,000
This steam engine powered a textile mill in Bengaluru for forty years.

3
00:00:05,800 --> 00:00:09,500
<i>Please stay behind the rail.</i>
`;

const FPS = [
  { value: '1', label: 'No change' },
  { value: '25/23.976', label: '25 → 23.976 fps (PAL to film)' },
  { value: '23.976/25', label: '23.976 → 25 fps (film to PAL)' },
  { value: '25/24', label: '25 → 24 fps' },
  { value: '24/25', label: '24 → 25 fps' },
  { value: '30/29.97', label: '30 → 29.97 fps' },
  { value: '29.97/30', label: '29.97 → 30 fps' },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default defineTextTool({
  input: { label: 'Subtitles (SRT, WebVTT, SBV or ASS)', language: 'text', sample: SAMPLE, accept: '.srt,.vtt,.sbv,.ass,.ssa,.txt' },
  output: { label: 'Subtitles', language: 'text' },
  options: [
    {
      key: 'to',
      label: 'Save as',
      type: 'segmented',
      choices: [
        { value: 'srt', label: 'SRT' },
        { value: 'vtt', label: 'WebVTT' },
        { value: 'sbv', label: 'SBV (YouTube)' },
      ],
      default: 'srt',
    },
    { key: 'shift', label: 'Move all subtitles', type: 'number', default: 0, min: -3_600_000, max: 3_600_000, step: 100, unit: 'ms', help: 'Negative numbers show them earlier.' },
    { key: 'fps', label: 'Frame rate change', type: 'select', choices: FPS, default: '1', help: 'For subtitles timed to a video at a different speed.' },
    { key: 'wrap', label: 'Line length', type: 'number', default: 0, min: 0, max: 80, step: 1, unit: 'characters', help: '0 keeps the lines as they are; 42 is the usual limit for television.' },
    {
      key: 'minGap',
      label: 'Gap between subtitles',
      type: 'number',
      default: 0,
      min: 0,
      max: 2000,
      step: 10,
      unit: 'ms',
      help: 'Ends a subtitle early if it runs into the next one; 80 to 120 ms is common.',
    },
    { key: 'minDuration', label: 'Shortest time on screen', type: 'number', default: 0, min: 0, max: 10_000, step: 100, unit: 'ms' },
    { key: 'stripTags', label: 'Remove italics and other formatting', type: 'toggle', default: false },
    { key: 'maxCps', label: 'Warn above', type: 'number', default: 17, min: 5, max: 40, step: 1, unit: 'characters a second' },
  ],
  run(input, o): TextResult {
    const { cues, format } = parseSubtitles(input);
    const [a, b] = String(o.fps).split('/').map(Number);
    const factor = a && b ? a / b : 1;
    const result = adjust(cues, { shift: o.shift, factor, minGap: o.minGap, minDuration: o.minDuration, wrap: o.wrap, stripTags: o.stripTags });
    const checks = checkCues(result);
    const fast = checks.filter((c) => c.cps > o.maxCps).length;
    const long = checks.filter((c) => c.longest > 42).length;
    const tall = checks.filter((c) => c.lines > 2).length;
    const overlaps = checks.filter((c) => c.overlaps).length;
    const warnings = [
      fast ? `${fast} subtitle${fast === 1 ? ' is' : 's are'} faster than ${o.maxCps} characters a second; viewers may not finish reading.` : '',
      long ? `${long} subtitle${long === 1 ? ' has' : 's have'} a line over 42 characters; set a line length to wrap them.` : '',
      tall ? `${tall} subtitle${tall === 1 ? ' has' : 's have'} more than two lines.` : '',
      overlaps ? `${overlaps} subtitle${overlaps === 1 ? ' overlaps' : 's overlap'} the next one; set a gap to fix ${overlaps === 1 ? 'it' : 'them'}.` : '',
    ].filter(Boolean);
    const rows = result
      .slice(0, 400)
      .map((c, i) => {
        const k = checks[i];
        const flag = (bad: boolean | undefined) => (bad ? ' class="sub-bad"' : '');
        return `<tr><td>${i + 1}</td><td>${(c.start / 1000).toFixed(2)}</td><td>${((c.end - c.start) / 1000).toFixed(2)}s</td><td${flag(k && k.cps > o.maxCps)}>${k ? k.cps.toFixed(1) : ''}</td><td${flag((k?.longest ?? 0) > 42 || (k?.lines ?? 0) > 2 || k?.overlaps)}>${esc(c.text).replace(/\n/g, '<br>')}</td></tr>`;
      })
      .join('');
    const html = `<table class="sub-table"><thead><tr><th>#</th><th>Starts (s)</th><th>Length</th><th>Chars/s</th><th>Text</th></tr></thead><tbody>${rows}</tbody></table>`;
    return {
      output: writeSubtitles(result, o.to as 'srt' | 'vtt' | 'sbv'),
      filename: `subtitles.${o.to}`,
      info: `${result.length} subtitles read as ${format.toUpperCase()}; ${((result[result.length - 1]?.end ?? 0) / 60000).toFixed(1)} minutes`,
      warnings,
      preview: { kind: 'html', html },
    };
  },
});
