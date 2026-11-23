/**
 * SMPTE timecode arithmetic at any frame rate, with drop-frame counting for
 * 29.97 and 59.94 fps (frame numbers 00 and 01, or 00 to 03, are skipped at
 * the start of every minute except each tenth).
 */
import { ToolError } from './errors';

export interface Rate {
  readonly fps: number;
  /** Frames counted per second in the timecode (30 for 29.97). */
  readonly base: number;
  readonly drop: boolean;
}

export function rateOf(id: string): Rate {
  switch (id) {
    case '23.976':
      return { fps: 24000 / 1001, base: 24, drop: false };
    case '29.97':
      return { fps: 30000 / 1001, base: 30, drop: false };
    case '29.97df':
      return { fps: 30000 / 1001, base: 30, drop: true };
    case '59.94':
      return { fps: 60000 / 1001, base: 60, drop: false };
    case '59.94df':
      return { fps: 60000 / 1001, base: 60, drop: true };
    default: {
      const n = Number(id);
      if (!(n > 0)) throw new ToolError('Choose a frame rate.');
      return { fps: n, base: Math.round(n), drop: false };
    }
  }
}

/** Frame count for HH:MM:SS:FF (";" before the frames marks drop-frame). */
export function toFrames(tc: string, rate: Rate): number {
  const m = /^(-)?(\d{1,3}):(\d{2}):(\d{2})[:;.](\d{2,3})$/.exec(tc.trim());
  if (!m) throw new ToolError(`"${tc}" is not a timecode such as 01:00:10:12.`);
  const [h, mi, s, f] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (mi > 59 || s > 59) throw new ToolError(`"${tc}" has more than 59 minutes or seconds.`);
  if (f >= rate.base) throw new ToolError(`"${tc}" has frame ${f}, but there are only ${rate.base} a second.`);
  let frames = (h * 3600 + mi * 60 + s) * rate.base + f;
  if (rate.drop) {
    const dropped = rate.base === 60 ? 4 : 2;
    const minutes = h * 60 + mi;
    frames -= dropped * (minutes - Math.floor(minutes / 10));
  }
  return m[1] ? -frames : frames;
}

export function fromFrames(frames: number, rate: Rate): string {
  const sign = frames < 0 ? '-' : '';
  let n = Math.abs(Math.round(frames));
  if (rate.drop) {
    const dropped = rate.base === 60 ? 4 : 2;
    const perTen = Math.round(rate.fps * 600);
    const perMinute = rate.base * 60 - dropped;
    const tens = Math.floor(n / perTen);
    const rest = n % perTen;
    n += dropped * 9 * tens;
    if (rest > dropped) n += dropped * Math.floor((rest - dropped) / perMinute);
  }
  const f = n % rate.base;
  const totalSeconds = Math.floor(n / rate.base);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${sign}${p(h)}:${p(m)}:${p(s)}${rate.drop ? ';' : ':'}${p(f)}`;
}

export const framesToSeconds = (frames: number, rate: Rate) => frames / rate.fps;
export const secondsToFrames = (seconds: number, rate: Rate) => Math.round(seconds * rate.fps);

/** Reads one value: a timecode, "250f" frames, or seconds such as "12.5s" or "1m30s". */
export function readValue(text: string, rate: Rate): number {
  const t = text.trim();
  if (/^-?\d+f$/i.test(t)) return Number(t.slice(0, -1));
  const hms = /^(-)?(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/i.exec(t);
  if (hms && (hms[2] || hms[3] || hms[4])) {
    const seconds = Number(hms[2] ?? 0) * 3600 + Number(hms[3] ?? 0) * 60 + Number(hms[4] ?? 0);
    return (hms[1] ? -1 : 1) * secondsToFrames(seconds, rate);
  }
  return toFrames(t, rate);
}

/** Evaluates "tc + tc - 10s * 2" left to right; × and ÷ take plain numbers. */
export function evaluate(expression: string, rate: Rate): number {
  const tokens = expression.match(/\d{1,3}:\d{2}:\d{2}[:;.]\d{2,3}|\d+(?:\.\d+)?(?:[hms]|f)?(?:\d+(?:\.\d+)?[ms])*|[-+*/×÷x]/gi);
  if (!tokens?.length) throw new ToolError('Type a timecode, or a sum such as 01:00:00:00 + 00:00:10:12.');
  let total = readValue(tokens[0] as string, rate);
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i] as string;
    const value = tokens[i + 1];
    if (value === undefined) throw new ToolError(`Nothing after "${op}".`);
    if (op === '+') total += readValue(value, rate);
    else if (op === '-') total -= readValue(value, rate);
    else if (op === '*' || op === '×' || op.toLowerCase() === 'x') total = Math.round(total * Number(value));
    else if (op === '/' || op === '÷') total = Math.round(total / Number(value));
  }
  return total;
}
