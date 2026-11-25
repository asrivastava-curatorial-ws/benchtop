import { describe, expect, it } from 'vitest';
import {
  composerReady,
  frequency,
  type KeypadState,
  type Melody,
  melodySeconds,
  parseComposer,
  parseRtttl,
  pressKey,
  RINGTONE_EXAMPLES,
  seconds,
  TICKS_PER_QUARTER,
  toComposer,
  toMidi,
  toRtttl,
  toWav,
  transpose,
} from '../../src/lib/ringtone';

describe('RTTTL', () => {
  it('reads notes with their defaults, sharps, dots and octaves', () => {
    const m = parseRtttl('Test Tune:d=4,o=5,b=140:8e6,d#,c.6,4c6.,2p,16h,32g#4');
    expect(m.name).toBe('Test Tune');
    expect(m.bpm).toBe(140);
    expect(m.notes).toEqual([
      { pitch: 'e', octave: 6, duration: 8, dotted: false },
      { pitch: 'd#', octave: 5, duration: 4, dotted: false },
      { pitch: 'c', octave: 6, duration: 4, dotted: true },
      { pitch: 'c', octave: 6, duration: 4, dotted: true },
      { pitch: null, octave: 5, duration: 2, dotted: false },
      { pitch: 'b', octave: 5, duration: 16, dotted: false },
      { pitch: 'g#', octave: 4, duration: 32, dotted: false },
    ]);
  });

  it('uses the standard defaults when settings are missing', () => {
    const m = parseRtttl('Bare::c,e,g');
    expect(m.bpm).toBe(63);
    expect(m.notes[0]).toEqual({ pitch: 'c', octave: 6, duration: 4, dotted: false });
  });

  it('writes the shortest RTTTL and reads it back unchanged', () => {
    for (const example of RINGTONE_EXAMPLES) {
      const m = parseRtttl(example.rtttl);
      const again = parseRtttl(toRtttl(m));
      // Rests have no octave of their own, so only the sounding notes' octaves are compared.
      const plain = (notes: Melody['notes']) => notes.map((n) => (n.pitch === null ? { ...n, octave: 0 } : n));
      expect(plain(again.notes), example.id).toEqual(plain(m.notes));
      expect(again.bpm).toBe(m.bpm);
      expect(again.name).toBe(m.name);
    }
    expect(toRtttl(parseRtttl('X:d=8,o=5,b=100:c,c,c,4d6,c.'))).toBe('X:d=8,o=5,b=100:c,c,c,4d6,c.');
  });

  it('explains what is wrong', () => {
    expect(() => parseRtttl('no colons here')).toThrow(/separated by colons/);
    expect(() => parseRtttl('T:d=3:c')).toThrow(/d=3/);
    expect(() => parseRtttl('T:d=4:c,x,e')).toThrow(/Note 2, "x"/);
    expect(() => parseRtttl('T:d=4:c,3c')).toThrow(/Note 2.*durations/);
    expect(() => parseRtttl('T:d=4:4p#')).toThrow(/rest cannot be sharp/);
  });
});

describe('composer notation', () => {
  it('reads and writes the phones’ notation (octaves 1 to 3 are 5 to 7)', () => {
    const notes = parseComposer('8e2 8d2 4#f1 4.#g1 2- 16.c3');
    expect(notes).toEqual([
      { pitch: 'e', octave: 6, duration: 8, dotted: false },
      { pitch: 'd', octave: 6, duration: 8, dotted: false },
      { pitch: 'f#', octave: 5, duration: 4, dotted: false },
      { pitch: 'g#', octave: 5, duration: 4, dotted: true },
      { pitch: null, octave: 5, duration: 2, dotted: false },
      { pitch: 'c', octave: 7, duration: 16, dotted: true },
    ]);
    expect(toComposer(notes)).toBe('8e2 8d2 4#f1 4.#g1 2- 16.c3');
    expect(toComposer(parseRtttl(RINGTONE_EXAMPLES[1]?.rtttl ?? '').notes).startsWith('8e2 8#d2 8e2 8#d2 8e2 8b1 8d2 8c2 4.a1')).toBe(true);
    expect(composerReady(notes)).toBe(true);
    expect(composerReady(parseRtttl('T:d=4,o=4,b=100:c').notes)).toBe(false);
    expect(() => parseComposer('8e2 9x')).toThrow(/Note 2, "9x"/);
  });
});

describe('sound', () => {
  it('tunes A4 to 440 Hz and times notes by the tempo', () => {
    expect(frequency({ pitch: 'a', octave: 4, duration: 4, dotted: false })).toBe(440);
    expect(frequency({ pitch: 'c', octave: 4, duration: 4, dotted: false })).toBeCloseTo(261.626, 3);
    expect(frequency({ pitch: 'a', octave: 7, duration: 4, dotted: false })).toBe(3520);
    expect(seconds({ pitch: 'c', octave: 5, duration: 4, dotted: false }, 120)).toBe(0.5);
    expect(seconds({ pitch: 'c', octave: 5, duration: 8, dotted: true }, 120)).toBe(0.375);
    expect(seconds({ pitch: null, octave: 5, duration: 1, dotted: false }, 60)).toBe(4);
  });

  it('saves WAV files of the right length', () => {
    const m: Melody = { name: 'Two', bpm: 120, notes: parseComposer('4a0 4-') };
    const wav = toWav(m, { sampleRate: 8000 });
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 16))).toBe('WAVEfmt ');
    expect(view.getUint32(24, true)).toBe(8000);
    const samples = view.getUint32(40, true) / 2;
    expect(samples).toBe(Math.ceil(melodySeconds(m) * 8000) + 400);
    // The note sounds, the rest is silent.
    let loud = 0;
    for (let i = 100; i < 3000; i++) loud = Math.max(loud, Math.abs(view.getInt16(44 + i * 2, true)));
    expect(loud).toBeGreaterThan(10000);
    for (let i = 4100; i < 7900; i++) expect(view.getInt16(44 + i * 2, true)).toBe(0);
  });

  it('saves MIDI files with the tempo, the square lead and every note', () => {
    const m = parseRtttl('Midi:d=4,o=5,b=120:c,8p,e.');
    const bytes = toMidi(m);
    const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(text.slice(0, 4)).toBe('MThd');
    expect(bytes[12]).toBe(TICKS_PER_QUARTER >> 8);
    expect(text.includes('MTrk')).toBe(true);
    // 120 beats a minute is 500 000 microseconds a quarter note (07 A1 20).
    expect(Array.from(bytes)).toEqual(expect.arrayContaining([0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]));
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
    // C5 (72) for a quarter (480 = 83 60), then E5 (76) after an eighth rest (240 = 81 70), dotted (720 = 85 50).
    expect(hex).toContain('00 90 48 64 83 60 80 48 00 81 70 90 4c 64 85 50 80 4c 00 00 ff 2f 00');
  });

  it('moves a tune up or down, within the four octaves', () => {
    const notes = parseComposer('4c1 4b1 4-');
    expect(toComposer(transpose(notes, 1))).toBe('4#c1 4c2 4-');
    expect(toComposer(transpose(notes, 12))).toBe('4c2 4b2 4-');
    expect(() => transpose(notes, 36)).toThrow(/outside the four octaves/);
  });
});

describe('keypad', () => {
  it('works like the composer on the phones', () => {
    let s: KeypadState = { notes: [], cursor: 0, octave: 5, duration: 4 };
    const press = (...keys: Parameters<typeof pressKey>[1][]) => {
      for (const k of keys) s = pressKey(s, k);
    };
    press('1');
    expect(toComposer(s.notes)).toBe('4c1');
    press('9', '#', '*');
    expect(toComposer(s.notes)).toBe('2#c2');
    press('3', '#');
    // E has no sharp of its own.
    expect(toComposer(s.notes)).toBe('2#c2 2e2');
    press('8', '8', '0', '9');
    expect(toComposer(s.notes)).toBe('2#c2 8e2 4-');
    press('1', '9', '9', '9');
    // Past a whole note the dot goes on, and 8 takes it off again.
    expect(toComposer(s.notes)).toBe('2#c2 8e2 4- 1.c2');
    press('8');
    expect(toComposer(s.notes)).toBe('2#c2 8e2 4- 1c2');
    press('*', '*');
    expect(toComposer(s.notes).endsWith('1c1')).toBe(true);
    // Notes go in at the cursor.
    s = { ...s, cursor: 1 };
    press('7');
    expect(toComposer(s.notes)).toBe('2#c2 1b1 8e2 4- 1c1');
  });
});
