/**
 * Helpers for the sheet music writer: ABC note and duration tokens, a small
 * WebAudio synthesiser that plays the notes abcjs works out (no sound fonts
 * to download), and WAV files.
 */

/** The default note length from an ABC header (L:1/8 → 1/8), or ABC's rule of thumb when absent. */
export function unitLength(abc: string): number {
  const m = /^L:\s*(\d+)\s*\/\s*(\d+)/m.exec(abc);
  if (m) return Number(m[1]) / Number(m[2]);
  const meter = /^M:\s*(\d+)\s*\/\s*(\d+)/m.exec(abc);
  if (meter && Number(meter[1]) / Number(meter[2]) < 0.75) return 1 / 16;
  return 1 / 8;
}

/** The ABC length suffix for a duration (in whole notes) given the unit length: 1/4 with L:1/8 → "2". */
export function durationToken(duration: number, unit: number): string {
  const ratio = duration / unit;
  if (Math.abs(ratio - 1) < 1e-9) return '';
  if (ratio > 1) return Number.isInteger(ratio) ? String(ratio) : `${Math.round(ratio * 2)}/2`;
  const inverse = 1 / ratio;
  if (Number.isInteger(Math.round(inverse * 1e6) / 1e6)) return inverse === 2 ? '/' : `/${Math.round(inverse)}`;
  // Dotted values below the unit, such as 3/4 of it.
  for (const d of [2, 4, 8, 16, 32]) {
    const n = ratio * d;
    if (Math.abs(n - Math.round(n)) < 1e-9) return `${Math.round(n)}/${d}`;
  }
  return `${Math.round(ratio * 32)}/32`;
}

const NAMES = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];

/** ABC pitch for a MIDI note number, with sharps for black keys: 60 → "C", 61 → "^C", 72 → "c", 48 → "C,". */
export function abcPitch(midi: number): string {
  const name = NAMES[((midi % 12) + 12) % 12] as string;
  const octave = Math.floor(midi / 12) - 1;
  const letter = name.replace('^', '');
  const accidental = name.startsWith('^') ? '^' : '';
  if (octave >= 5) return accidental + letter.toLowerCase() + "'".repeat(octave - 5);
  return accidental + letter + ','.repeat(Math.max(0, 4 - octave));
}

export const isBlackKey = (midi: number): boolean => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

export function noteName(midi: number): string {
  return `${(NAMES[((midi % 12) + 12) % 12] as string).replace('^', '')}${[1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12) ? '♯' : ''}${Math.floor(midi / 12) - 1}`;
}

/* -------------------------------------------------------------------- synth -- */

export type Voice = 'piano' | 'organ' | 'pluck' | 'flute';

export interface ScheduledNote {
  /** MIDI note number. */
  readonly pitch: number;
  /** Seconds from the start. */
  readonly start: number;
  readonly duration: number;
  /** 0–1. */
  readonly volume: number;
}

const frequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

/** Schedules one note on a context (live or offline) and returns when its sound ends. */
export function playNote(context: BaseAudioContext, destination: AudioNode, note: ScheduledNote, voice: Voice, at: number): number {
  const start = at + note.start;
  const f = frequency(note.pitch);
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.connect(destination);
  gain.connect(filter);
  const level = 0.22 * note.volume;
  const end = start + Math.max(0.05, note.duration);
  const oscillators: OscillatorNode[] = [];
  const add = (type: OscillatorType, ratio: number, amount: number, detune = 0) => {
    const o = context.createOscillator();
    o.type = type;
    o.frequency.value = f * ratio;
    o.detune.value = detune;
    const g = context.createGain();
    g.gain.value = amount;
    o.connect(g).connect(gain);
    oscillators.push(o);
  };
  let stop = end;
  if (voice === 'organ') {
    add('sine', 1, 0.6);
    add('sine', 2, 0.3);
    add('sine', 3, 0.15);
    add('sine', 4, 0.08);
    filter.frequency.value = 6000;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.02);
    gain.gain.setValueAtTime(level, end);
    gain.gain.linearRampToValueAtTime(0, end + 0.06);
    stop = end + 0.08;
  } else if (voice === 'flute') {
    add('sine', 1, 0.85);
    add('triangle', 2, 0.08);
    const vibrato = context.createOscillator();
    const depth = context.createGain();
    vibrato.frequency.value = 5.2;
    depth.gain.value = f * 0.006;
    vibrato.connect(depth);
    for (const o of oscillators) depth.connect(o.frequency);
    oscillators.push(vibrato);
    filter.frequency.value = 3500;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.06);
    gain.gain.setValueAtTime(level * 0.9, end);
    gain.gain.linearRampToValueAtTime(0, end + 0.1);
    stop = end + 0.12;
  } else if (voice === 'pluck') {
    add('sawtooth', 1, 0.5);
    add('triangle', 1, 0.5, 4);
    filter.frequency.setValueAtTime(Math.min(12000, f * 12), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), start + 0.4);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(level * 0.02, start + 1.2);
    gain.gain.setTargetAtTime(0, end, 0.05);
    stop = Math.min(start + 1.3, end + 0.3);
  } else {
    // A soft piano: bright attack, fading tone, short release.
    add('triangle', 1, 0.7);
    add('sine', 2, 0.25, 3);
    add('sine', 3, 0.08, -3);
    filter.frequency.setValueAtTime(Math.min(9000, f * 8), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2), start + 1.5);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(level * 0.35, start + 0.6);
    gain.gain.setValueAtTime(level * 0.35, Math.max(end, start + 0.6));
    gain.gain.setTargetAtTime(0, Math.max(end, start + 0.05), 0.08);
    stop = Math.max(end, start + 0.05) + 0.5;
  }
  for (const o of oscillators) {
    o.start(start);
    o.stop(stop);
  }
  return stop;
}

/** Renders notes to audio samples offline (for saving as WAV). */
export async function renderNotes(notes: readonly ScheduledNote[], voice: Voice, sampleRate = 44100): Promise<AudioBuffer> {
  const length = Math.max(...notes.map((n) => n.start + n.duration), 0) + 1.5;
  const context = new OfflineAudioContext(2, Math.ceil(length * sampleRate), sampleRate);
  const master = context.createGain();
  master.gain.value = 0.9;
  master.connect(context.destination);
  for (const note of notes) playNote(context, master, note, voice, 0);
  return context.startRendering();
}

/** 16-bit PCM WAV from channels of samples. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const bytes = new Uint8Array(44 + frames * count * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * count * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * count * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const v = Math.max(-1, Math.min(1, channel[i] ?? 0));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return bytes;
}

/** Example tunes (traditional or long out of copyright). */
export const TUNES: readonly { readonly name: string; readonly abc: string }[] = [
  {
    name: 'Ode to Joy (Beethoven)',
    abc: `X:1
T:Ode to Joy
C:Ludwig van Beethoven, Symphony No. 9
M:4/4
L:1/4
Q:1/4=120
K:D
|: F F G A | A G F E | D D E F | F>E E2 |
F F G A | A G F E | D D E F | E>D D2 :|
E E F D | E F/G/ F D | E F/G/ F E | D E A,2 |
F F G A | A G F E | D D E F | E>D D2 |]`,
  },
  {
    name: 'Twinkle, twinkle (traditional)',
    abc: `X:2
T:Twinkle, Twinkle, Little Star
C:Traditional
M:2/4
L:1/8
Q:1/4=100
K:C
C2 C2 | G2 G2 | A2 A2 | G4 | F2 F2 | E2 E2 | D2 D2 | C4 |
G2 G2 | F2 F2 | E2 E2 | D4 | G2 G2 | F2 F2 | E2 E2 | D4 |
C2 C2 | G2 G2 | A2 A2 | G4 | F2 F2 | E2 E2 | D2 D2 | C4 |]`,
  },
  {
    name: 'Raga Yaman scale',
    abc: `X:3
T:Raga Yaman: aroha and avaroha
C:Ascending and descending scale (tivra Ma)
M:none
L:1/4
Q:1/4=80
K:C
"^Ni"B, "^Re"D "^Ga"E "^Ma"^F "^Dha"A "^Ni"B "^Sa"c2 |
"^Sa"c "^Ni"B "^Dha"A "^Pa"G "^Ma"^F "^Ga"E "^Re"D "^Sa"C2 |]`,
  },
  {
    name: 'Two voices (exercise)',
    abc: `X:4
T:Two-voice exercise
M:3/4
L:1/8
Q:1/4=96
K:G
V:1 clef=treble
V:2 clef=bass
[V:1] d2 G2 A2 | B2 c2 d2 | e2 d2 c2 | B6 |
[V:2] G,4 B,2 | G,4 F,2 | E,2 F,2 G,2 | D,6 |
[V:1] c2 B2 A2 | B2 A2 G2 | A2 F2 D2 | G6 |]
[V:2] A,4 D,2 | G,4 B,2 | C2 D2 D,2 | G,,6 |]`,
  },
  {
    name: 'Blank page',
    abc: `X:1
T:Untitled
C:
M:4/4
L:1/8
Q:1/4=100
K:C
|`,
  },
];
