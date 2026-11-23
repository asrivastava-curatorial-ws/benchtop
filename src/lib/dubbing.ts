/**
 * Video dubbing: timed lines (from transcription), their translations, and a
 * voice-over assembled from synthesised speech placed at each line's time,
 * plus subtitles.  Pure functions; the tool runs the models and FFmpeg.
 */

export interface Line {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The translation, edited by hand or filled by a translator. */
  readonly translation: string;
}

export interface Language {
  readonly code: string;
  readonly name: string;
  /** ISO 639-2 code, for audio and subtitle track labels. */
  readonly iso3: string;
  /** FLORES-200 code (language and script), as IndicTrans2 names languages. */
  readonly flores: string;
}

/** The languages offered as targets: India's scheduled languages first, then widely used others. */
export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', iso3: 'eng', flores: 'eng_Latn' },
  { code: 'hi', name: 'Hindi', iso3: 'hin', flores: 'hin_Deva' },
  { code: 'kn', name: 'Kannada', iso3: 'kan', flores: 'kan_Knda' },
  { code: 'ta', name: 'Tamil', iso3: 'tam', flores: 'tam_Taml' },
  { code: 'te', name: 'Telugu', iso3: 'tel', flores: 'tel_Telu' },
  { code: 'ml', name: 'Malayalam', iso3: 'mal', flores: 'mal_Mlym' },
  { code: 'bn', name: 'Bengali', iso3: 'ben', flores: 'ben_Beng' },
  { code: 'mr', name: 'Marathi', iso3: 'mar', flores: 'mar_Deva' },
  { code: 'gu', name: 'Gujarati', iso3: 'guj', flores: 'guj_Gujr' },
  { code: 'pa', name: 'Punjabi', iso3: 'pan', flores: 'pan_Guru' },
  { code: 'or', name: 'Odia', iso3: 'ori', flores: 'ory_Orya' },
  { code: 'as', name: 'Assamese', iso3: 'asm', flores: 'asm_Beng' },
  { code: 'ur', name: 'Urdu', iso3: 'urd', flores: 'urd_Arab' },
  { code: 'ne', name: 'Nepali', iso3: 'nep', flores: 'npi_Deva' },
  { code: 'sa', name: 'Sanskrit', iso3: 'san', flores: 'san_Deva' },
  { code: 'kok', name: 'Konkani', iso3: 'kok', flores: 'gom_Deva' },
  { code: 'mai', name: 'Maithili', iso3: 'mai', flores: 'mai_Deva' },
  { code: 'fr', name: 'French', iso3: 'fre', flores: 'fra_Latn' },
  { code: 'de', name: 'German', iso3: 'ger', flores: 'deu_Latn' },
  { code: 'es', name: 'Spanish', iso3: 'spa', flores: 'spa_Latn' },
  { code: 'ja', name: 'Japanese', iso3: 'jpn', flores: 'jpn_Jpan' },
  { code: 'zh', name: 'Chinese', iso3: 'chi', flores: 'zho_Hans' },
  { code: 'ar', name: 'Arabic', iso3: 'ara', flores: 'arb_Arab' },
  { code: 'ru', name: 'Russian', iso3: 'rus', flores: 'rus_Cyrl' },
];

export const languageOf = (code: string): Language => LANGUAGES.find((l) => l.code === code) ?? { code, name: code, iso3: 'und', flores: '' };

/** Piper voices are named by locale (hi_IN-…): the voices that speak a language. */
export const voiceSpeaks = (voiceId: string, code: string): boolean => voiceId.startsWith(`piper-${code}_`);

/* ---------------------------------------------------------------- timing -- */

/** The speed to speak a line at so it fits its slot: 1 when it fits, faster up to `limit` when not. */
export function fitRate(spoken: number, slot: number, limit = 1.6): number {
  if (spoken <= 0 || slot <= 0 || spoken <= slot) return 1;
  return Math.min(limit, spoken / slot);
}

/** How long each line may run: until the next line starts (or `total`), never less than its own span. */
export function slots(lines: readonly Pick<Line, 'start' | 'end'>[], total: number): number[] {
  return lines.map((line, i) => {
    const next = lines[i + 1]?.start ?? Math.max(total, line.end);
    return Math.max(line.end - line.start, next - line.start, 0.2);
  });
}

/** Places clips (mono samples at `rate`) at their start times in one track `seconds` long; later clips overlapping earlier ones are pushed back. */
export function assemble(clips: readonly { start: number; samples: Float32Array }[], rate: number, seconds: number): Float32Array {
  const end = clips.reduce((m, c) => Math.max(m, Math.round(c.start * rate) + c.samples.length), Math.round(seconds * rate));
  const track = new Float32Array(end);
  let cursor = 0;
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    const at = Math.max(Math.round(clip.start * rate), cursor);
    track.set(clip.samples.subarray(0, Math.max(0, track.length - at)), at);
    cursor = at + clip.samples.length;
  }
  return track;
}

/* ------------------------------------------------------------------- WAV -- */

/** Reads a PCM WAV (8, 16, 24 or 32-bit integer, or 32-bit float), mixing channels to mono. */
export function decodeWav(bytes: Uint8Array): { rate: number; samples: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let at = 12;
  let format = 1;
  let channels = 1;
  let rate = 22_050;
  let bits = 16;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      format = view.getUint16(at + 8, true);
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      const width = bits / 8;
      const frames = Math.floor(Math.min(size, bytes.length - at - 8) / (width * channels));
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = at + 8 + (f * channels + c) * width;
          if (format === 3 && bits === 32) sum += view.getFloat32(p, true);
          else if (bits === 16) sum += view.getInt16(p, true) / 32768;
          else if (bits === 8) sum += ((bytes[p] ?? 128) - 128) / 128;
          else if (bits === 24) sum += (((bytes[p + 2] ?? 0) << 24) | ((bytes[p + 1] ?? 0) << 16) | ((bytes[p] ?? 0) << 8)) / 2147483648;
          else if (bits === 32) sum += view.getInt32(p, true) / 2147483648;
        }
        samples[f] = sum / channels;
      }
      return { rate, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('The WAV file has no audio.');
}

export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i] as number)) * 32767), true);
  return out;
}

/* ------------------------------------------------------------- subtitles -- */

const stamp = (seconds: number, sep: string) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};

export function toSrt(lines: readonly Line[], which: 'text' | 'translation'): string {
  return `${lines
    .filter((l) => l[which].trim())
    .map((l, i) => `${i + 1}\n${stamp(l.start, ',')} --> ${stamp(l.end, ',')}\n${l[which].trim()}\n`)
    .join('\n')}`;
}

export function toVtt(lines: readonly Line[], which: 'text' | 'translation'): string {
  return `WEBVTT\n\n${lines
    .filter((l) => l[which].trim())
    .map((l) => `${stamp(l.start, '.')} --> ${stamp(l.end, '.')}\n${l[which].trim()}\n`)
    .join('\n')}`;
}

/** Reads SRT or WebVTT into lines (the text goes in `text`). */
export function parseSubtitles(source: string): Line[] {
  const time = (t: string) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(t);
    if (!m) return Number.NaN;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000;
  };
  const lines: Line[] = [];
  for (const block of source.replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = block.split('\n').filter((r) => r.trim() !== '');
    const at = rows.findIndex((r) => r.includes('-->'));
    if (at < 0) continue;
    const [a, b] = (rows[at] as string).split('-->');
    const start = time(a ?? '');
    const end = time(b ?? '');
    const text = rows
      .slice(at + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && text) lines.push({ start, end, text, translation: '' });
  }
  return lines;
}

/* ------------------------------------------------------------ translation -- */

/** The request to an OpenAI-compatible chat server (Ollama, LM Studio, llama.cpp) for a batch of lines. */
export function chatRequest(model: string, lines: readonly string[], from: string, to: string, context: string, codes?: { from: string; to: string }): object {
  return {
    model,
    // Read by Benchtop's IndicTrans2 server (scripts/indictrans2-server.py); other servers ignore it.
    ...(codes ? { benchtop: { lines, from: codes.from, to: codes.to } } : {}),
    temperature: 0.2,
    stream: false,
    messages: [
      {
        role: 'system',
        content: `You translate narration for museum and science-centre videos from ${from} into ${to}. Keep the meaning, names and numbers; use natural spoken ${to} that a visitor understands; keep each line about as long as the original so it fits the same time.${context ? ` Context: ${context}` : ''}`,
      },
      {
        role: 'user',
        content: `Translate each item of this JSON array into ${to}. Reply with only a JSON array of the translated strings, in the same order, with exactly ${lines.length} items.\n\n${JSON.stringify(lines)}`,
      },
    ],
  };
}

/** The translated lines in a chat reply, or null when the reply is not a JSON array of `count` strings. */
export function parseChatReply(body: string, count: number): string[] | null {
  let content = body;
  try {
    const json = JSON.parse(body) as { choices?: { message?: { content?: string } }[]; message?: { content?: string } };
    content = json.choices?.[0]?.message?.content ?? json.message?.content ?? body;
  } catch {
    // A bare reply.
  }
  const text = content.replace(/^[\s\S]*?(\[)/, '$1').replace(/\][^\]]*$/, ']');
  try {
    const list = JSON.parse(text) as unknown;
    if (Array.isArray(list) && list.length === count && list.every((x) => typeof x === 'string')) return list as string[];
  } catch {
    return null;
  }
  return null;
}
