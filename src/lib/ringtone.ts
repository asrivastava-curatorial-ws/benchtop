/**
 * Monophonic ringtones as on the phones of the late 1990s: RTTTL text (the
 * Ring Tone Text Transfer Language that Nokia phones exchanged), the note
 * notation of their composers ("8e2 8d2 4#f1 4-"), and the tones themselves
 * as square waves, saved as WAV or as a MIDI file.
 */

export type Pitch = 'c' | 'c#' | 'd' | 'd#' | 'e' | 'f' | 'f#' | 'g' | 'g#' | 'a' | 'a#' | 'b';
export type Duration = 1 | 2 | 4 | 8 | 16 | 32;

export interface Note {
  /** null for a rest. */
  readonly pitch: Pitch | null;
  /** Octave in scientific pitch notation (A4 = 440 Hz), 4 to 7. */
  readonly octave: number;
  /** 1 a whole note, 4 a quarter, 32 a thirty-second. */
  readonly duration: Duration;
  readonly dotted: boolean;
}

export interface Melody {
  readonly name: string;
  /** Quarter notes a minute. */
  readonly bpm: number;
  readonly notes: readonly Note[];
}

export class RingtoneError extends Error {}

export const PITCHES: readonly Pitch[] = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
export const DURATIONS: readonly Duration[] = [1, 2, 4, 8, 16, 32];
/** The tempos the phones' composers offered. */
export const TEMPOS: readonly number[] = [40, 45, 50, 56, 63, 70, 80, 90, 100, 112, 125, 140, 160, 180, 200, 225, 250, 285, 320, 355, 400, 450, 500, 565, 635, 715, 800, 900];
export const MIN_OCTAVE = 4;
export const MAX_OCTAVE = 7;
export const MAX_NOTES = 2000;

const isDuration = (n: number): n is Duration => (DURATIONS as readonly number[]).includes(n);

/** The MIDI note number of a note (C4 = 60). */
export function midiNumber(note: Note): number {
  if (note.pitch === null) return -1;
  return 12 * (note.octave + 1) + PITCHES.indexOf(note.pitch);
}

export function frequency(note: Note): number {
  return note.pitch === null ? 0 : 440 * 2 ** ((midiNumber(note) - 69) / 12);
}

/** How long a note lasts, in seconds, at a tempo in quarter notes a minute. */
export function seconds(note: Note, bpm: number): number {
  return (60 / bpm) * (4 / note.duration) * (note.dotted ? 1.5 : 1);
}

export function melodySeconds(m: Melody): number {
  return m.notes.reduce((sum, n) => sum + seconds(n, m.bpm), 0);
}

/** Moves every note up or down by semitones; notes that would leave octaves 4 to 7 are an error. */
export function transpose(notes: readonly Note[], semitones: number): Note[] {
  return notes.map((n, i) => {
    if (n.pitch === null) return n;
    const midi = midiNumber(n) + semitones;
    const octave = Math.floor(midi / 12) - 1;
    if (octave < MIN_OCTAVE || octave > MAX_OCTAVE) throw new RingtoneError(`Note ${i + 1} would go outside the four octaves a ringtone can use.`);
    return { ...n, pitch: PITCHES[((midi % 12) + 12) % 12] as Pitch, octave };
  });
}

/* ------------------------------------------------------------------ RTTTL -- */

const cleanName = (name: string) =>
  name
    .replace(/[:,\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Reads RTTTL: "Name:d=4,o=5,b=125:8e6,8d6,f#,g#".  Accepted beyond the
 * strict form: the dot before or after the octave, h for b, octave 8 read
 * as 7, spaces anywhere, and a missing settings section.
 */
export function parseRtttl(text: string): Melody {
  const source = text.trim();
  if (!source) throw new RingtoneError('The RTTTL text is empty.');
  const parts = source.split(':');
  if (parts.length < 2) throw new RingtoneError('RTTTL has a name, settings and notes separated by colons, as in "Tune:d=4,o=5,b=125:c,e,g".');
  const name = cleanName(parts[0] ?? '') || 'Ringtone';
  const notesText = parts.length >= 3 ? parts.slice(2).join(':') : (parts[1] ?? '');
  const settingsText = parts.length >= 3 ? (parts[1] ?? '') : '';
  let d: Duration = 4;
  let o = 6;
  let b = 63;
  for (const raw of settingsText.split(',')) {
    const setting = raw.trim().toLowerCase();
    if (!setting) continue;
    const m = /^([dob])\s*=\s*(\d+)$/.exec(setting);
    if (!m) throw new RingtoneError(`The setting "${raw.trim()}" is not d=, o= or b=.`);
    const value = Number(m[2]);
    if (m[1] === 'd') {
      if (!isDuration(value)) throw new RingtoneError(`d=${value}: the default duration must be 1, 2, 4, 8, 16 or 32.`);
      d = value;
    } else if (m[1] === 'o') {
      if (value < MIN_OCTAVE || value > 8) throw new RingtoneError(`o=${value}: the default octave must be 4 to 7.`);
      o = Math.min(value, MAX_OCTAVE);
    } else {
      if (value < 10 || value > 1000) throw new RingtoneError(`b=${value}: the tempo must be 10 to 1000 beats a minute.`);
      b = value;
    }
  }
  const notes: Note[] = [];
  const tokens = notesText
    .split(',')
    .map((t) => t.replace(/\s+/g, '').toLowerCase())
    .filter(Boolean);
  if (tokens.length > MAX_NOTES) throw new RingtoneError(`The tune has more than ${MAX_NOTES} notes.`);
  tokens.forEach((token, i) => {
    const m = /^(\d{1,2})?([a-hp])(#)?(\.)?(\d)?(\.)?$/.exec(token);
    if (!m) throw new RingtoneError(`Note ${i + 1}, "${token}", is not an RTTTL note such as 8c#6 or 4p.`);
    const duration = m[1] ? Number(m[1]) : d;
    if (!isDuration(duration)) throw new RingtoneError(`Note ${i + 1}, "${token}": durations are 1, 2, 4, 8, 16 or 32.`);
    const letter = m[2] === 'h' ? 'b' : (m[2] as string);
    const octave = m[5] ? Number(m[5]) : o;
    if (octave < MIN_OCTAVE || octave > 8) throw new RingtoneError(`Note ${i + 1}, "${token}": octaves are 4 to 7.`);
    const dotted = Boolean(m[4] || m[6]);
    if (letter === 'p') {
      if (m[3]) throw new RingtoneError(`Note ${i + 1}, "${token}": a rest cannot be sharp.`);
      notes.push({ pitch: null, octave: o, duration, dotted });
      return;
    }
    let pitch = `${letter}${m[3] ? '#' : ''}`;
    let oct = Math.min(octave, MAX_OCTAVE);
    // E# and B# are written by some tunes; they are F and the next C.
    if (pitch === 'e#') pitch = 'f';
    if (pitch === 'b#') {
      pitch = 'c';
      oct = Math.min(oct + 1, MAX_OCTAVE);
    }
    notes.push({ pitch: pitch as Pitch, octave: oct, duration, dotted });
  });
  return { name, bpm: b, notes };
}

const mostCommon = <T>(values: readonly T[], fallback: T): T => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
};

/** Writes RTTTL with the most common duration and octave as the defaults, the shortest text. */
export function toRtttl(m: Melody): string {
  const d = mostCommon(
    m.notes.map((n) => n.duration),
    4 as Duration,
  );
  const o = mostCommon(
    m.notes.filter((n) => n.pitch !== null).map((n) => n.octave),
    6,
  );
  const notes = m.notes.map((n) => `${n.duration === d ? '' : n.duration}${n.pitch ?? 'p'}${n.pitch !== null && n.octave !== o ? n.octave : ''}${n.dotted ? '.' : ''}`);
  return `${cleanName(m.name) || 'Ringtone'}:d=${d},o=${o},b=${Math.round(m.bpm)}:${notes.join(',')}`;
}

/* ------------------------------------------------------- composer notation -- */

/** Octaves 1 to 3 of the phones' composers were octaves 5 to 7. */
const COMPOSER_OFFSET = 4;

/**
 * Reads composer notation: "8e2 8d2 4#f1 4#g1 2- 4.c2".  A token is a
 * duration, a dot for a dotted note, # for sharp, the note and its octave
 * (1 to 3); "-" is a rest.  Octave 0 is accepted for octave 4.
 */
export function parseComposer(text: string): Note[] {
  const tokens = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (tokens.length > MAX_NOTES) throw new RingtoneError(`The tune has more than ${MAX_NOTES} notes.`);
  return tokens.map((token, i) => {
    const m = /^(\d{1,2})(\.)?(?:(-)|(#)?([a-gA-G])([0-3])?)(\.)?$/.exec(token);
    if (!m) throw new RingtoneError(`Note ${i + 1}, "${token}", is not composer notation such as 8#c2 or 4-.`);
    const duration = Number(m[1]);
    if (!isDuration(duration)) throw new RingtoneError(`Note ${i + 1}, "${token}": durations are 1, 2, 4, 8, 16 or 32.`);
    const dotted = Boolean(m[2] || m[7]);
    if (m[3]) return { pitch: null, octave: 5, duration, dotted };
    const letter = (m[5] as string).toLowerCase();
    let pitch = `${letter}${m[4] ? '#' : ''}`;
    let octave = Number(m[6] ?? '1') + COMPOSER_OFFSET;
    if (pitch === 'e#') pitch = 'f';
    if (pitch === 'b#') {
      pitch = 'c';
      octave = Math.min(octave + 1, MAX_OCTAVE);
    }
    return { pitch: pitch as Pitch, octave, duration, dotted };
  });
}

export function composerToken(n: Note): string {
  if (n.pitch === null) return `${n.duration}${n.dotted ? '.' : ''}-`;
  const sharp = n.pitch.length === 2;
  return `${n.duration}${n.dotted ? '.' : ''}${sharp ? '#' : ''}${n.pitch[0]}${n.octave - COMPOSER_OFFSET}`;
}

export function toComposer(notes: readonly Note[]): string {
  return notes.map(composerToken).join(' ');
}

/** Whether the phones' composers could play every note (they had octaves 1 to 3, that is 5 to 7). */
export function composerReady(notes: readonly Note[]): boolean {
  return notes.every((n) => n.pitch === null || (n.octave >= 5 && n.octave <= 7));
}

/* ------------------------------------------------------------------ sound -- */

export interface ToneOptions {
  readonly sampleRate?: number;
  /** 0 to 1. */
  readonly volume?: number;
  /** Silence at the end of each note, as a share of it, so repeated notes are heard apart. */
  readonly gap?: number;
}

/** PolyBLEP: rounds the square wave's steps so high notes do not alias into noise. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** The melody as mono 16-bit samples of a square wave. */
export function renderSamples(m: Melody, o: ToneOptions = {}): Int16Array {
  const rate = o.sampleRate ?? 44100;
  const volume = Math.min(Math.max(o.volume ?? 0.35, 0), 1);
  const gap = Math.min(Math.max(o.gap ?? 0.06, 0), 0.5);
  const total = Math.ceil(melodySeconds(m) * rate) + Math.round(rate * 0.05);
  if (total > rate * 60 * 20) throw new RingtoneError('The tune is longer than 20 minutes.');
  const out = new Int16Array(total);
  const ramp = Math.round(rate * 0.002);
  let at = 0;
  for (const note of m.notes) {
    const length = Math.round(seconds(note, m.bpm) * rate);
    const sounding = note.pitch === null ? 0 : Math.max(1, Math.round(length * (1 - gap)));
    const f = frequency(note);
    const dt = f / rate;
    let phase = 0;
    for (let i = 0; i < sounding && at + i < total; i++) {
      let v = (phase < 0.5 ? 1 : -1) + blep(phase, dt) - blep((phase + 0.5) % 1, dt);
      const edge = Math.min(i, sounding - 1 - i);
      if (edge < ramp) v *= edge / ramp;
      out[at + i] = Math.round(v * volume * 32767);
      phase += dt;
      if (phase >= 1) phase -= 1;
    }
    at += length;
  }
  return out;
}

const ascii = (view: DataView, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
};

/** A WAV file (PCM, mono, 16-bit) of the melody. */
export function toWav(m: Melody, o: ToneOptions = {}): Uint8Array {
  const rate = o.sampleRate ?? 44100;
  const samples = renderSamples(m, { ...o, sampleRate: rate });
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i] as number, true);
  return bytes;
}

/** MIDI's variable-length numbers. */
function varLength(value: number): number[] {
  const out = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return out;
}

export const TICKS_PER_QUARTER = 480;

/** A standard MIDI file (format 0) of the melody, played by General MIDI's square lead. */
export function toMidi(m: Melody): Uint8Array {
  const track: number[] = [];
  const name = Array.from(new TextEncoder().encode(cleanName(m.name).slice(0, 60) || 'Ringtone'));
  track.push(0, 0xff, 0x03, ...varLength(name.length), ...name);
  const tempo = Math.round(60_000_000 / m.bpm);
  track.push(0, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
  track.push(0, 0xff, 0x58, 0x04, 4, 2, 24, 8);
  // Program 81, "Lead 1 (square)".
  track.push(0, 0xc0, 80);
  let wait = 0;
  for (const note of m.notes) {
    const ticks = Math.round(((TICKS_PER_QUARTER * 4) / note.duration) * (note.dotted ? 1.5 : 1));
    if (note.pitch === null) {
      wait += ticks;
      continue;
    }
    const key = midiNumber(note);
    track.push(...varLength(wait), 0x90, key, 100);
    track.push(...varLength(ticks), 0x80, key, 0);
    wait = 0;
  }
  track.push(...varLength(wait), 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff];
  const length = track.length;
  return Uint8Array.from([...header, 0x4d, 0x54, 0x72, 0x6b, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff, ...track]);
}

/* ---------------------------------------------------------------- keypad -- */

export type Key = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0' | '*' | '#';

export interface KeypadState {
  readonly notes: readonly Note[];
  /** Notes are put in after this many notes. */
  readonly cursor: number;
  /** Octave and duration for the next note. */
  readonly octave: number;
  readonly duration: Duration;
}

/**
 * The composer keypad: 1 to 7 put in C to B, 0 a rest, 8 makes the note
 * before the cursor shorter and 9 longer (past a whole note and a 32nd, it
 * toggles the dot), * moves it an octave up (from the top back to the
 * bottom), # makes it sharp or natural.
 */
export function pressKey(s: KeypadState, key: Key): KeypadState {
  const notes = [...s.notes];
  const last = s.cursor - 1;
  const before = notes[last];
  const replace = (n: Note) => {
    notes[last] = n;
    return { ...s, notes, octave: n.pitch === null ? s.octave : n.octave, duration: n.duration };
  };
  if (/^[1-7]$/.test(key) || key === '0') {
    if (notes.length >= MAX_NOTES) return s;
    const pitch = key === '0' ? null : ((['c', 'd', 'e', 'f', 'g', 'a', 'b'] as const)[Number(key) - 1] as Pitch);
    notes.splice(s.cursor, 0, { pitch, octave: s.octave, duration: s.duration, dotted: false });
    return { ...s, notes, cursor: s.cursor + 1 };
  }
  if (!before) return s;
  if (key === '8' || key === '9') {
    const i = DURATIONS.indexOf(before.duration);
    // 8: shorter; past the shortest, the dot comes off.  9: longer.
    if (key === '8') {
      if (before.dotted) return replace({ ...before, dotted: false });
      return i < DURATIONS.length - 1 ? replace({ ...before, duration: DURATIONS[i + 1] as Duration }) : s;
    }
    if (i > 0) return replace({ ...before, duration: DURATIONS[i - 1] as Duration, dotted: false });
    return replace({ ...before, dotted: !before.dotted });
  }
  if (before.pitch === null) return s;
  if (key === '*') return replace({ ...before, octave: before.octave >= MAX_OCTAVE ? MIN_OCTAVE + 1 : before.octave + 1 });
  // '#': sharp, or natural again; E and B have no sharps of their own.
  const index = PITCHES.indexOf(before.pitch);
  const sharp = before.pitch.length === 2;
  if (!sharp && (before.pitch === 'e' || before.pitch === 'b')) return s;
  return replace({ ...before, pitch: PITCHES[sharp ? index - 1 : index + 1] as Pitch });
}

/* --------------------------------------------------------------- examples -- */

/** Melodies in the public domain (composers who died long ago, and traditional tunes). */
export const RINGTONE_EXAMPLES: readonly { readonly id: string; readonly rtttl: string }[] = [
  { id: 'ode-to-joy', rtttl: 'Ode to Joy:d=4,o=5,b=140:e,e,f,g,g,f,e,d,c,c,d,e,e.,8d,2d,e,e,f,g,g,f,e,d,c,c,d,e,d.,8c,2c' },
  { id: 'fur-elise', rtttl: 'Fur Elise:d=8,o=5,b=125:e6,d#6,e6,d#6,e6,b,d6,c6,4a.,c,e,a,4b.,e,g#,b,4c6.,e,e6,d#6,e6,d#6,e6,b,d6,c6,4a.,c,e,a,4b.,e,c6,b,2a' },
  { id: 'mountain-king', rtttl: 'Mountain King:d=8,o=5,b=140:a,b,c6,d6,e6,c6,4e6,d#6,b,4d#6,d6,a#,4d6,a,b,c6,d6,e6,c6,e6,a6,g6,e6,c6,e6,2g6' },
  { id: 'greensleeves', rtttl: 'Greensleeves:d=4,o=5,b=140:a,2c6,d6,e6.,8f6,e6,2d6,b,g.,8a,b,2c6,a,a.,8g#,a,2b,g#,2e,a,2c6,d6,e6.,8f6,e6,2d6,b,g.,8a,b,c6.,8b,a,g#.,8f#,g#,2a.' },
  { id: 'jingle-bells', rtttl: 'Jingle Bells:d=4,o=5,b=180:e,e,2e,e,e,2e,e,g,c.,8d,1e,f,f,f.,8f,f,e,e,8e,8e,e,d,d,e,2d,2g,e,e,2e,e,e,2e,e,g,c.,8d,1e,f,f,f.,8f,f,e,e,8e,8e,g,g,f,d,1c' },
  { id: 'twinkle', rtttl: 'Twinkle Twinkle:d=4,o=5,b=120:c,c,g,g,a,a,2g,f,f,e,e,d,d,2c,g,g,f,f,e,e,2d,g,g,f,f,e,e,2d,c,c,g,g,a,a,2g,f,f,e,e,d,d,2c' },
  { id: 'frere-jacques', rtttl: 'Frere Jacques:d=4,o=5,b=120:c,d,e,c,c,d,e,c,e,f,2g,e,f,2g,8g,8a,8g,8f,e,c,8g,8a,8g,8f,e,c,c,g4,2c,c,g4,2c' },
  { id: 'happy-birthday', rtttl: 'Happy Birthday:d=4,o=5,b=120:g.,8g,a,g,c6,2b,g.,8g,a,g,d6,2c6,g.,8g,g6,e6,c6,b,a,f6.,8f6,e6,c6,d6,2c6' },
];
