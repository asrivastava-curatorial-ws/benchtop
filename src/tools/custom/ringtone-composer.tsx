/**
 * Ringtone Composer: write monophonic ringtones on a keypad like the
 * composer of the phones of the late 1990s, or type RTTTL or composer
 * notation; play them as the phones did (a square wave) and save WAV, MIDI
 * or RTTTL.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  composerReady,
  composerToken,
  type Duration,
  frequency,
  type Key,
  type Melody,
  midiNumber,
  type Note,
  parseComposer,
  parseRtttl,
  pressKey,
  RINGTONE_EXAMPLES,
  seconds,
  TEMPOS,
  toComposer,
  toMidi,
  toRtttl,
  toWav,
  transpose,
} from '../../lib/ringtone';
import { copyText, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

interface ComposerState {
  readonly rtttl: string;
  readonly cursor: number;
  readonly octave: number;
  readonly duration: Duration;
}

const FIRST = RINGTONE_EXAMPLES[0]?.rtttl ?? 'Tune:d=4,o=5,b=125:c,e,g';
const melodyOf = (rtttl: string): Melody => {
  try {
    return parseRtttl(rtttl);
  } catch {
    return parseRtttl(FIRST);
  }
};
const read = (v: Values | undefined): ComposerState => {
  const rtttl = typeof v?.rtttl === 'string' && v.rtttl.length < 40_000 ? v.rtttl : FIRST;
  const count = melodyOf(rtttl).notes.length;
  const cursor = typeof v?.cursor === 'number' && Number.isInteger(v.cursor) ? Math.min(Math.max(v.cursor, 0), count) : count;
  const octave = typeof v?.octave === 'number' && v.octave >= 4 && v.octave <= 7 ? v.octave : 5;
  const duration = [1, 2, 4, 8, 16, 32].includes(Number(v?.duration)) ? (Number(v?.duration) as Duration) : 4;
  return { rtttl, cursor, octave, duration };
};
const write = (s: ComposerState): Values => ({ rtttl: s.rtttl, cursor: s.cursor, octave: s.octave, duration: s.duration });

/** Each key shows its digit and what it does; `more` is read out after them, for screen readers. */
const KEYS: readonly { key: Key; sub: string; more?: string }[] = [
  { key: '1', sub: 'C', more: 'note' },
  { key: '2', sub: 'D', more: 'note' },
  { key: '3', sub: 'E', more: 'note' },
  { key: '4', sub: 'F', more: 'note' },
  { key: '5', sub: 'G', more: 'note' },
  { key: '6', sub: 'A', more: 'note' },
  { key: '7', sub: 'B', more: 'note' },
  { key: '8', sub: 'shorter' },
  { key: '9', sub: 'longer' },
  { key: '*', sub: 'octave', more: 'up' },
  { key: '0', sub: 'rest' },
  { key: '#', sub: 'sharp' },
];

const NAMES: Readonly<Record<string, string>> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: 'sixteenth', 32: 'thirty-second' };
const describe = (n: Note | undefined) =>
  !n
    ? 'Start of the tune'
    : n.pitch === null
      ? `${n.dotted ? 'dotted ' : ''}${NAMES[n.duration]} rest`
      : `${n.pitch.toUpperCase().replace('#', ' sharp')} in octave ${n.octave - 4}, ${n.dotted ? 'dotted ' : ''}${NAMES[n.duration]} note`;

/* --------------------------------------------------------------- sound -- */

interface Playback {
  readonly context: AudioContext;
  readonly start: number;
  readonly starts: readonly number[];
  readonly end: number;
}

function schedule(context: AudioContext, notes: readonly Note[], bpm: number, volume: number): Playback {
  const master = context.createGain();
  master.gain.value = volume;
  master.connect(context.destination);
  const start = context.currentTime + 0.06;
  let t = start;
  const starts: number[] = [];
  for (const note of notes) {
    starts.push(t);
    const length = seconds(note, bpm);
    if (note.pitch !== null) {
      const sounding = Math.max(0.01, length * 0.94);
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.value = frequency(note);
      const env = context.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.22, t + 0.003);
      env.gain.setValueAtTime(0.22, t + sounding - 0.004);
      env.gain.linearRampToValueAtTime(0, t + sounding);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + sounding + 0.01);
    }
    t += length;
  }
  return { context, start, starts, end: t };
}

/* --------------------------------------------------------------- tool -- */

function RingtoneComposer({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, read, write);
  const melody = useMemo(() => melodyOf(state.rtttl), [state.rtttl]);
  const [playing, setPlaying] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [composerDraft, setComposerDraft] = useState<string | null>(null);
  const [rtttlDraft, setRtttlDraft] = useState<string | null>(null);
  const [composerError, setComposerError] = useState('');
  const [rtttlError, setRtttlError] = useState('');
  const playback = useRef<Playback | null>(null);
  const lcd = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  /** A text box shows what was typed into it until the tune changes some other way. */
  const forget = (except?: 'composer' | 'rtttl') => {
    if (except !== 'composer') {
      setComposerDraft(null);
      setComposerError('');
    }
    if (except !== 'rtttl') {
      setRtttlDraft(null);
      setRtttlError('');
    }
  };

  const update = (next: Partial<Melody>, cursor?: number, extra: Partial<ComposerState> = {}, source?: 'composer') => {
    forget(source);
    setState((s) => {
      const m = melodyOf(s.rtttl);
      const merged: Melody = { ...m, ...next };
      return { ...s, ...extra, rtttl: toRtttl(merged), cursor: Math.min(Math.max(cursor ?? s.cursor, 0), merged.notes.length) };
    });
  };

  const stop = () => {
    cancelAnimationFrame(frame.current);
    const p = playback.current;
    playback.current = null;
    if (p) void p.context.close();
    setPlaying(null);
  };
  useEffect(() => stop, []);

  const play = (notes: readonly Note[] = melody.notes, from = 0) => {
    stop();
    if (!notes.length) return;
    const context = new AudioContext();
    const p = schedule(context, notes, melody.bpm, volume);
    playback.current = p;
    const tick = () => {
      const now = playback.current;
      if (now !== p) return;
      const t = p.context.currentTime;
      if (t >= p.end) {
        if (loopRef.current && notes === melody.notes) {
          play(notes, from);
          return;
        }
        stop();
        return;
      }
      let index = 0;
      while (index + 1 < p.starts.length && (p.starts[index + 1] as number) <= t) index++;
      setPlaying(from + index);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  /** A short beep of one note, as the phones gave on each key. */
  const preview = (note: Note | undefined) => {
    if (!note || note.pitch === null || playback.current) return;
    const context = new AudioContext();
    const p = schedule(context, [{ ...note, duration: 8, dotted: false }], Math.max(melody.bpm, 100), volume);
    setTimeout(() => void context.close(), (p.end - p.start) * 1000 + 300);
  };

  const press = (key: Key) => {
    const before = { notes: melody.notes, cursor: state.cursor, octave: state.octave, duration: state.duration };
    const after = pressKey(before, key);
    if (after === before) return;
    update({ notes: after.notes }, after.cursor, { octave: after.octave, duration: after.duration });
    preview(after.notes[after.cursor - 1]);
  };

  const remove = () => {
    if (state.cursor === 0) return;
    const notes = [...melody.notes];
    notes.splice(state.cursor - 1, 1);
    update({ notes }, state.cursor - 1);
  };

  const move = (to: number) => setState((s) => ({ ...s, cursor: Math.min(Math.max(to, 0), melody.notes.length) }));

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    if (/^[0-9*#]$/.test(key)) {
      e.preventDefault();
      press(key as Key);
    } else if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      remove();
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      move(state.cursor + (key === 'ArrowLeft' ? -1 : 1));
    } else if (key === 'Home' || key === 'End') {
      e.preventDefault();
      move(key === 'Home' ? 0 : melody.notes.length);
    } else if ((key === ' ' || key === 'Enter') && e.target === lcd.current) {
      e.preventDefault();
      if (playing === null) play();
      else stop();
    }
  };

  const shift = (semitones: number) =>
    attempt(async () => {
      update({ notes: transpose(melody.notes, semitones) });
    });

  const save = (kind: 'wav' | 'midi' | 'rtttl' | 'copy') =>
    attempt(async () => {
      const base = melody.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'ringtone';
      if (kind === 'copy') {
        await copyText(toRtttl(melody));
        notify('RTTTL copied');
        return;
      }
      const outcome =
        kind === 'wav'
          ? await saveFile(`${base}.wav`, toWav(melody), 'audio/wav')
          : kind === 'midi'
            ? await saveFile(`${base}.mid`, toMidi(melody), 'audio/midi')
            : await saveFile(`${base}.txt`, `${toRtttl(melody)}\n`, 'text/plain');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  // What the display shows: the notes around the cursor.
  const span = 6;
  const first = Math.max(0, Math.min(state.cursor - span + 1, melody.notes.length - span));
  const shown = melody.notes.slice(first, first + span);
  const total = melody.notes.reduce((sum, n) => sum + seconds(n, melody.bpm), 0);

  return (
    <section class="tool rt-tool" data-testid="tool" data-state={playing === null ? 'idle' : 'playing'}>
      <div class="rt-main">
        <div class="rt-phone" onKeyDown={onKey} data-testid="rt-phone">
          <div
            ref={lcd}
            class="rt-lcd"
            role="textbox"
            tabIndex={0}
            aria-label="Melody. Type 1 to 7 for notes C to B, 0 for a rest, 8 and 9 to change the length, star for the octave, hash for a sharp; arrows move, Backspace deletes, Space plays."
            aria-readonly="false"
            data-testid="rt-lcd"
          >
            <div class="rt-lcd-top">
              <span class="rt-lcd-name">{melody.name}</span>
              <span>♩={melody.bpm}</span>
            </div>
            <div class="rt-lcd-notes" aria-hidden="true">
              {first > 0 && <span class="rt-lcd-more">‹</span>}
              {shown.map((n, i) => (
                <span key={`${first + i}:${composerToken(n)}`} class={`rt-lcd-note${first + i === playing ? ' is-playing' : ''}${first + i === state.cursor - 1 ? ' is-current' : ''}`}>
                  {composerToken(n)}
                </span>
              ))}
              {first + span < melody.notes.length && <span class="rt-lcd-more">›</span>}
            </div>
            <div class="rt-lcd-bottom">
              <span>
                {state.cursor}/{melody.notes.length}
              </span>
              <span>{total.toFixed(1)} s</span>
            </div>
          </div>
          <p class="visually-hidden" aria-live="polite">
            {describe(melody.notes[state.cursor - 1])}
          </p>
          <div class="rt-nav">
            <button type="button" class="rt-soft" onClick={() => (playing === null ? play() : stop())} data-testid="rt-play" aria-label={playing === null ? 'Play' : 'Stop'}>
              <Icon name={playing === null ? 'play' : 'pause'} size={14} /> {playing === null ? 'Play' : 'Stop'}
            </button>
            <button type="button" class="rt-soft" onClick={() => move(state.cursor - 1)} aria-label="Cursor left">
              <Icon name="left" size={14} />
            </button>
            <button type="button" class="rt-soft" onClick={() => move(state.cursor + 1)} aria-label="Cursor right">
              <Icon name="right" size={14} />
            </button>
            <button type="button" class="rt-soft" onClick={remove} aria-label="Delete the note before the cursor" data-testid="rt-delete">
              C
            </button>
          </div>
          <div class="rt-keys">
            {KEYS.map((k) => (
              <button key={k.key} type="button" class="rt-key" onClick={() => press(k.key)} data-testid={`rt-key-${k.key === '*' ? 'star' : k.key === '#' ? 'hash' : k.key}`}>
                <span class="rt-key-main">{k.key}</span> <span class="rt-key-sub">{k.sub}</span>
                {k.more && <span class="visually-hidden"> {k.more}</span>}
              </button>
            ))}
          </div>
        </div>

        <div class="rt-side">
          <div class="control-row rt-settings">
            <label class="rt-field">
              <span class="control-label">Name</span>
              <input class="input" value={melody.name} maxLength={40} onChange={(e) => update({ name: e.currentTarget.value || 'Ringtone' })} data-testid="rt-name" />
            </label>
            <label class="rt-field">
              <span class="control-label">Tempo (beats a minute)</span>
              <select class="select" value={String(melody.bpm)} onChange={(e) => update({ bpm: Number(e.currentTarget.value) })} data-testid="rt-tempo">
                {[...new Set([...TEMPOS, melody.bpm])]
                  .sort((a, b) => a - b)
                  .map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
              </select>
            </label>
            <label class="rt-field">
              <span class="control-label">Example</span>
              <select
                class="select"
                value=""
                onChange={(e) => {
                  const example = RINGTONE_EXAMPLES.find((x) => x.id === e.currentTarget.value);
                  e.currentTarget.value = '';
                  if (!example) return;
                  stop();
                  forget();
                  const m = parseRtttl(example.rtttl);
                  setState((s) => ({ ...s, rtttl: toRtttl(m), cursor: m.notes.length }));
                }}
                data-testid="rt-example"
              >
                <option value="">Open an example…</option>
                {RINGTONE_EXAMPLES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {parseRtttl(x.rtttl).name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <PianoRoll notes={melody.notes} bpm={melody.bpm} cursor={state.cursor} playing={playing} onPick={(i) => move(i + 1)} />

          <div class="button-row rt-row">
            <button type="button" class="button button-small" onClick={() => shift(-12)} title="Every note an octave lower">
              Octave down
            </button>
            <button type="button" class="button button-small" onClick={() => shift(-1)} title="Every note a semitone lower">
              Semitone down
            </button>
            <button type="button" class="button button-small" onClick={() => shift(1)} title="Every note a semitone higher">
              Semitone up
            </button>
            <button type="button" class="button button-small" onClick={() => shift(12)} title="Every note an octave higher">
              Octave up
            </button>
            <label class="check">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.currentTarget.checked)} /> Repeat
            </label>
            <label class="rt-volume">
              <span class="control-label">Volume</span>
              <input type="range" min={0.05} max={1} step={0.05} value={volume} onInput={(e) => setVolume(Number(e.currentTarget.value))} />
            </label>
            <button
              type="button"
              class="button button-small button-quiet"
              onClick={() => {
                stop();
                update({ notes: [] }, 0);
              }}
            >
              <Icon name="trash" size={13} /> Clear
            </button>
          </div>

          <label class="rt-text">
            <span class="control-label">Composer notation (as typed into the phones: 8#c2 is an eighth-note C sharp in octave 2, 4- a quarter rest)</span>
            <textarea
              class="input rt-code"
              rows={3}
              spellcheck={false}
              value={composerDraft ?? toComposer(melody.notes)}
              onInput={(e) => {
                const text = e.currentTarget.value;
                setComposerDraft(text);
                try {
                  const notes = parseComposer(text);
                  setComposerError('');
                  update({ notes }, notes.length, {}, 'composer');
                } catch (error) {
                  setComposerError(error instanceof Error ? error.message : String(error));
                }
              }}
              onBlur={() => {
                setComposerDraft(null);
                setComposerError('');
              }}
              data-testid="rt-composer"
            />
            {composerError ? (
              <span class="tone-error rt-error">{composerError}</span>
            ) : (
              !composerReady(melody.notes) && <span class="tone-muted rt-error">Notes in octave 4 are written with octave 0: the phones themselves played octaves 1 to 3.</span>
            )}
          </label>
          <label class="rt-text">
            <span class="control-label">RTTTL (ring tone text, read by phones, Arduino and Flipper Zero players)</span>
            <textarea
              class="input rt-code"
              rows={3}
              spellcheck={false}
              value={rtttlDraft ?? toRtttl(melody)}
              onInput={(e) => {
                const text = e.currentTarget.value;
                setRtttlDraft(text);
                try {
                  const m = parseRtttl(text);
                  forget('rtttl');
                  setState((s) => ({ ...s, rtttl: toRtttl(m), cursor: m.notes.length }));
                } catch (error) {
                  setRtttlError(error instanceof Error ? error.message : String(error));
                }
              }}
              onBlur={() => {
                setRtttlDraft(null);
                setRtttlError('');
              }}
              data-testid="rt-rtttl"
            />
            {rtttlError && <span class="tone-error rt-error">{rtttlError}</span>}
          </label>
          <div class="button-row">
            <span class="control-label">Save as</span>
            <button type="button" class="button button-small" onClick={() => save('wav')} data-testid="rt-save-wav">
              WAV
            </button>
            <button type="button" class="button button-small" onClick={() => save('midi')} data-testid="rt-save-midi">
              MIDI
            </button>
            <button type="button" class="button button-small" onClick={() => save('rtttl')} data-testid="rt-save-rtttl">
              RTTTL text
            </button>
            <button type="button" class="button button-small button-quiet" onClick={() => save('copy')}>
              <Icon name="copy" size={13} /> Copy RTTTL
            </button>
          </div>
        </div>
      </div>
      <p class="control-help">
        Click the keypad or type on it: 1 to 7 put in C to B after the cursor, 0 a rest, 8 and 9 make the note before the cursor shorter or longer (beyond a whole note, 9 adds a dot), * moves it an
        octave up and # makes it sharp. Arrow keys move the cursor, Backspace deletes and Space plays. The examples are tunes in the public domain.
      </p>
    </section>
  );
}

function PianoRoll({ notes, bpm, cursor, playing, onPick }: { notes: readonly Note[]; bpm: number; cursor: number; playing: number | null; onPick: (index: number) => void }) {
  const pitched = notes.filter((n) => n.pitch !== null).map(midiNumber);
  const lo = (pitched.length ? Math.min(...pitched) : 72) - 2;
  const hi = (pitched.length ? Math.max(...pitched) : 84) + 2;
  const rows = hi - lo + 1;
  const row = 9;
  const scale = 90; // pixels a second
  const beat = 60 / bpm;
  let t = 0;
  const placed = notes.map((n) => {
    const start = t;
    t += seconds(n, bpm);
    return { n, start, length: t - start };
  });
  const width = Math.max(600, t * scale + 20);
  const height = rows * row;
  const cursorX = (placed[cursor - 1] ? (placed[cursor - 1]?.start ?? 0) + (placed[cursor - 1]?.length ?? 0) : 0) * scale;
  const lines: JSX.Element[] = [];
  for (let b = 0; b * beat <= t + 1e-9; b++) lines.push(<line key={`b${b}`} x1={b * beat * scale} x2={b * beat * scale} y1={0} y2={height} class={b % 4 === 0 ? 'rt-bar' : 'rt-beat'} />);
  for (let m = lo; m <= hi; m++) if ([1, 3, 6, 8, 10].includes(m % 12)) lines.push(<rect key={`k${m}`} x={0} y={(hi - m) * row} width={width} height={row} class="rt-black-row" />);
  return (
    <div
      class="rt-roll"
      role="region"
      aria-label="Piano roll (scroll with the arrow keys)"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable from the keyboard
      tabIndex={0}
      data-testid="rt-roll"
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Piano roll of ${notes.length} notes`}>
        {lines}
        {placed.map(({ n, start, length }, i) =>
          n.pitch === null ? null : (
            <rect
              key={`${i}:${start}`}
              x={start * scale + 0.5}
              y={(hi - midiNumber(n)) * row + 1}
              width={Math.max(2, length * scale * 0.94 - 1)}
              height={row - 2}
              rx={2}
              class={`rt-roll-note${i === playing ? ' is-playing' : ''}${i === cursor - 1 ? ' is-current' : ''}`}
              onClick={() => onPick(i)}
            >
              <title>{composerToken(n)}</title>
            </rect>
          ),
        )}
        <line x1={cursorX} x2={cursorX} y1={0} y2={height} class="rt-cursor" />
      </svg>
    </div>
  );
}

export default defineCustomTool(RingtoneComposer);
