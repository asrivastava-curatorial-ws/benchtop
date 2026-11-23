/**
 * Subtitles: read SRT, WebVTT, SBV (YouTube) and simple ASS/SSA; shift,
 * stretch between frame rates, tidy and check them; write SRT, WebVTT or SBV.
 */
import { ToolError } from './errors';

export interface Cue {
  /** Milliseconds. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type SubFormat = 'srt' | 'vtt' | 'sbv' | 'ass';

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,:](\d{1,3})/;

/** "01:02:03,456", "02:03.456", "0:02:03.45" (ASS centiseconds) to milliseconds. */
export function parseTime(text: string): number {
  const m = TIME.exec(text.trim());
  if (!m) throw new ToolError(`"${text}" is not a time such as 00:01:02,500.`);
  const frac = (m[4] as string).padEnd(3, '0').slice(0, 3);
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(frac);
}

export function formatTime(ms: number, style: 'srt' | 'vtt' | 'sbv'): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  if (style === 'sbv') return `${h}:${p(m)}:${p(s)}.${p(f, 3)}`;
  return `${p(h)}:${p(m)}:${p(s)}${style === 'srt' ? ',' : '.'}${p(f, 3)}`;
}

export function detectFormat(text: string): SubFormat {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('WEBVTT')) return 'vtt';
  if (/^\[Script Info\]/im.test(t) || /^Dialogue:/m.test(t)) return 'ass';
  if (/^\d+:\d{2}:\d{2}\.\d{3},\d+:\d{2}:\d{2}\.\d{3}/m.test(t)) return 'sbv';
  return 'srt';
}

export function parseSubtitles(text: string): { cues: Cue[]; format: SubFormat } {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const format = detectFormat(source);
  const cues: Cue[] = [];
  if (format === 'ass') {
    let fields: string[] = [];
    for (const line of source.split('\n')) {
      if (/^Format:/i.test(line) && fields.length === 0)
        fields = line
          .slice(7)
          .split(',')
          .map((f) => f.trim().toLowerCase());
      if (!/^Dialogue:/i.test(line)) continue;
      const parts = line.slice(9).split(',');
      const at = (name: string, fallback: number) => {
        const i = fields.indexOf(name);
        return i >= 0 ? i : fallback;
      };
      const textIndex = at('text', 9);
      const start = parts[at('start', 1)];
      const end = parts[at('end', 2)];
      if (!start || !end) continue;
      const body = parts
        .slice(textIndex)
        .join(',')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\N/gi, '\n')
        .trim();
      cues.push({ start: parseTime(start), end: parseTime(end), text: body });
    }
  } else {
    const blocks = source.split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0] as string)) continue;
      const timeLine = lines.findIndex((l) => (format === 'sbv' ? /^\d+:\d{2}:\d{2}\.\d{3},/.test(l) : l.includes('-->')));
      if (timeLine < 0) continue;
      const line = lines[timeLine] as string;
      const [a, b] = format === 'sbv' ? line.split(',') : line.split('-->');
      if (!a || !b) continue;
      // VTT settings may follow the end time: "00:00:05.000 align:start".
      const end = b.trim().split(/\s+/)[0] as string;
      cues.push({ start: parseTime(a), end: parseTime(end), text: lines.slice(timeLine + 1).join('\n') });
    }
  }
  if (!cues.length) throw new ToolError('No subtitles found. Paste SRT, WebVTT, SBV or ASS text.');
  return { cues, format };
}

export function writeSubtitles(cues: readonly Cue[], format: 'srt' | 'vtt' | 'sbv'): string {
  if (format === 'vtt') return `WEBVTT\n\n${cues.map((c) => `${formatTime(c.start, 'vtt')} --> ${formatTime(c.end, 'vtt')}\n${c.text}`).join('\n\n')}\n`;
  if (format === 'sbv') return `${cues.map((c) => `${formatTime(c.start, 'sbv')},${formatTime(c.end, 'sbv')}\n${c.text}`).join('\n\n')}\n`;
  return `${cues.map((c, i) => `${i + 1}\n${formatTime(c.start, 'srt')} --> ${formatTime(c.end, 'srt')}\n${c.text}`).join('\n\n')}\n`;
}

/** Wraps a cue's text into at most `lines` lines of `width` characters, balancing the lines. */
export function wrapText(text: string, width: number, lines = 2): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (text.length <= width) return text.replace(/\s+/g, ' ').trim();
  // Try every break point and pick the most even pair of lines.
  if (lines === 2) {
    let best = '';
    let bestScore = Number.POSITIVE_INFINITY;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' ');
      const b = words.slice(k).join(' ');
      const over = Math.max(0, a.length - width) + Math.max(0, b.length - width);
      const score = over * 1000 + Math.abs(a.length - b.length);
      if (score < bestScore) {
        bestScore = score;
        best = `${a}\n${b}`;
      }
    }
    return best;
  }
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.join('\n');
}

export interface Adjust {
  /** Shift every cue, milliseconds (negative is earlier). */
  readonly shift: number;
  /** Multiply times, e.g. 25 / 23.976 to convert PAL timing to film. */
  readonly factor: number;
  readonly minGap: number;
  readonly minDuration: number;
  readonly wrap: number;
  readonly stripTags: boolean;
}

export function adjust(cues: readonly Cue[], a: Adjust): Cue[] {
  let out = cues
    .map((c) => ({ start: c.start * a.factor + a.shift, end: c.end * a.factor + a.shift, text: c.text }))
    .filter((c) => c.end > 0)
    .map((c) => ({ ...c, start: Math.max(0, c.start) }))
    .sort((x, y) => x.start - y.start);
  if (a.stripTags) out = out.map((c) => ({ ...c, text: c.text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '') }));
  if (a.wrap > 0) out = out.map((c) => ({ ...c, text: wrapText(c.text, a.wrap) }));
  if (a.minDuration > 0) out = out.map((c) => ({ ...c, end: Math.max(c.end, c.start + a.minDuration) }));
  if (a.minGap > 0)
    out = out.map((c, i) => {
      const next = out[i + 1];
      return next && c.end > next.start - a.minGap ? { ...c, end: Math.max(c.start + 1, next.start - a.minGap) } : c;
    });
  return out;
}

export interface CueCheck {
  readonly index: number;
  readonly cps: number;
  readonly longest: number;
  readonly lines: number;
  readonly overlaps: boolean;
  readonly duration: number;
}

/** Reading speed and layout per cue, for the usual limits (17 characters a second, 42 a line, 2 lines). */
export function checkCues(cues: readonly Cue[]): CueCheck[] {
  return cues.map((c, i) => {
    const plain = c.text.replace(/<[^>]+>/g, '');
    const duration = Math.max(1, c.end - c.start);
    const lines = plain.split('\n');
    return {
      index: i,
      cps: plain.replace(/\n/g, ' ').length / (duration / 1000),
      longest: Math.max(...lines.map((l) => [...l].length)),
      lines: lines.length,
      overlaps: !!cues[i + 1] && c.end > (cues[i + 1] as Cue).start,
      duration,
    };
  });
}
