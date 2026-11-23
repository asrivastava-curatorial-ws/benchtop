/**
 * Sheet Music Writer: write music in ABC notation (typed, or entered with a
 * piano keyboard and note buttons), see it engraved as you type (abcjs),
 * play it with a built-in synthesiser, transpose it, and save it as ABC, SVG,
 * MIDI, WAV or PDF.
 */
import type { EditorView } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { abcPitch, durationToken, encodeWav, isBlackKey, noteName, playNote, renderNotes, type ScheduledNote, TUNES, unitLength, type Voice } from '../../lib/music';
import { htmlToPdf, isDesktop, saveFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { insertText } from '../../ui/editor-extras';
import { Icon } from '../../ui/icons';
import { printDocument } from '../../ui/print';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Abcjs = typeof import('abcjs');
type Tune = ReturnType<Abcjs['renderAbc']>[0];

let abcjsModule: Promise<Abcjs> | null = null;
const loadAbcjs = () => {
  abcjsModule ??= import('abcjs').then((m) => ((m as unknown as { default?: Abcjs }).default ?? m) as Abcjs);
  return abcjsModule;
};

interface MusicState {
  readonly abc: string;
  readonly voice: Voice;
  readonly tempo: number;
  readonly duration: number;
  readonly dotted: boolean;
  readonly octave: number;
}

const readMusic = (v: Values | undefined): MusicState => ({
  abc: typeof v?.abc === 'string' ? v.abc : (TUNES[0]?.abc ?? ''),
  voice: v?.voice === 'organ' || v?.voice === 'pluck' || v?.voice === 'flute' ? v.voice : 'piano',
  tempo: typeof v?.tempo === 'number' ? v.tempo : 0,
  duration: typeof v?.duration === 'number' ? v.duration : 0.25,
  dotted: v?.dotted === true,
  octave: typeof v?.octave === 'number' ? v.octave : 4,
});

const DURATIONS: readonly [number, string, string][] = [
  [1, '𝅝', 'Whole note'],
  [0.5, '𝅗𝅥', 'Half note'],
  [0.25, '♩', 'Quarter note'],
  [0.125, '♪', 'Eighth note'],
  [0.0625, '𝅘𝅥𝅯', 'Sixteenth note'],
];

/** The notes of a rendered tune with their times in seconds. */
function scheduleOf(tune: Tune, bpm: number | undefined): { notes: ScheduledNote[]; seconds: number } {
  const audio = tune.setUpAudio({} as never) as unknown as { tracks: { cmd: string; pitch: number; start: number; duration: number; volume: number }[][] };
  const meter = tune.getMeterFraction();
  const meterSize = meter.num && meter.den ? meter.num / meter.den : 1;
  const perWhole = tune.millisecondsPerMeasure(bpm) / 1000 / meterSize;
  const notes: ScheduledNote[] = [];
  for (const track of audio.tracks)
    for (const ev of track)
      if (ev.cmd === 'note' && ev.duration > 0) notes.push({ pitch: ev.pitch, start: ev.start * perWhole, duration: ev.duration * perWhole * 0.95, volume: Math.min(1, (ev.volume ?? 90) / 110) });
  return { notes, seconds: Math.max(0, ...notes.map((n) => n.start + n.duration)) };
}

function Keyboard({ octave, onKey }: { octave: number; onKey: (midi: number) => void }) {
  const first = (octave + 1) * 12;
  const keys = Array.from({ length: 25 }, (_, i) => first + i);
  const whites = keys.filter((k) => !isBlackKey(k));
  return (
    <div class="sm-keys" role="group" aria-label="Piano keyboard" data-testid="sm-keys">
      {whites.map((k) => (
        <button key={k} type="button" class="sm-white" onClick={() => onKey(k)} aria-label={noteName(k)} title={`${noteName(k)} (${abcPitch(k)})`}>
          {k % 12 === 0 ? <span>{noteName(k)}</span> : null}
        </button>
      ))}
      {keys.filter(isBlackKey).map((k) => {
        const index = whites.filter((w) => w < k).length;
        return (
          <button
            key={k}
            type="button"
            class="sm-black"
            style={{ left: `calc(${index} * (100% / ${whites.length}) - (100% / ${whites.length}) * 0.3)` }}
            onClick={() => onKey(k)}
            aria-label={noteName(k)}
            title={`${noteName(k)} (${abcPitch(k)})`}
          />
        );
      })}
    </div>
  );
}

function SheetMusic({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readMusic, (s) => ({ ...s }));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const score = useRef<HTMLDivElement>(null);
  const tune = useRef<Tune | null>(null);
  const view = useRef<EditorView | null>(null);
  const audio = useRef<{ context: AudioContext; timer: { stop(): void } | null } | null>(null);
  const set = <K extends keyof MusicState>(k: K, v: MusicState[K]) => setState((s) => ({ ...s, [k]: v }));
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadAbcjs().then((abcjs) => {
        const el = score.current;
        if (cancelled || !el) return;
        const [rendered] = abcjs.renderAbc(el, state.abc, {
          responsive: 'resize',
          add_classes: true,
          foregroundColor: dark ? '#e6edf3' : '#1f2328',
          selectionColor: '#d55e00',
          clickListener: (element: { startChar?: number; endChar?: number }) => {
            const v = view.current;
            if (!v || element.startChar === undefined || element.endChar === undefined) return;
            v.dispatch({ selection: { anchor: element.startChar, head: element.endChar }, scrollIntoView: true });
            v.focus();
          },
        } as never);
        tune.current = rendered ?? null;
        setWarnings(((rendered as unknown as { warnings?: string[] })?.warnings ?? []).map((w) => w.replace(/<[^>]+>/g, '')));
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.abc, dark]);

  const stop = () => {
    audio.current?.timer?.stop();
    void audio.current?.context.close();
    audio.current = null;
    setPlaying(false);
    for (const el of score.current?.querySelectorAll('.sm-playing') ?? []) el.classList.remove('sm-playing');
  };
  useEffect(() => stop, []);

  const play = () =>
    attempt(async () => {
      stop();
      const abcjs = await loadAbcjs();
      const t = tune.current;
      if (!t) return;
      const bpm = state.tempo || undefined;
      const { notes, seconds } = scheduleOf(t, bpm);
      if (notes.length === 0) throw new Error('There are no notes to play yet.');
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 0.9;
      master.connect(context.destination);
      const at = context.currentTime + 0.12;
      for (const n of notes) playNote(context, master, n, state.voice, at);
      const timing = new abcjs.TimingCallbacks(t, {
        qpm: bpm,
        eventCallback: (ev: { elements?: HTMLElement[][] } | null) => {
          for (const el of score.current?.querySelectorAll('.sm-playing') ?? []) el.classList.remove('sm-playing');
          if (!ev) return;
          for (const group of ev.elements ?? []) for (const el of group) el.classList.add('sm-playing');
        },
      } as never);
      setTimeout(() => timing.start(), 120);
      audio.current = { context, timer: timing };
      setPlaying(true);
      setTimeout(
        () => {
          if (audio.current?.context === context) stop();
        },
        (seconds + 1.2) * 1000,
      );
    });

  const keyPressed = (midi: number) => {
    const unit = unitLength(state.abc);
    const length = state.duration * (state.dotted ? 1.5 : 1);
    const token = `${abcPitch(midi)}${durationToken(length, unit)} `;
    const v = view.current;
    if (v) insertText(v, token);
    else set('abc', `${state.abc}${token}`);
    // A short sound for each key.
    const context = new AudioContext();
    playNote(context, context.destination, { pitch: midi, start: 0, duration: 0.35, volume: 0.8 }, state.voice, context.currentTime + 0.01);
    setTimeout(() => void context.close(), 1500);
  };
  const insert = (text: string, offset?: number) => {
    const v = view.current;
    if (v) insertText(v, text, offset);
    else set('abc', state.abc + text);
  };

  const transpose = (steps: number) =>
    attempt(async () => {
      const abcjs = await loadAbcjs();
      const t = tune.current;
      if (!t) return;
      set('abc', abcjs.strTranspose(state.abc, [t] as never, steps));
    });

  const title = useMemo(() => /^T:\s*(.+)$/m.exec(state.abc)?.[1]?.trim() || 'music', [state.abc]);
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'music';
  const svgMarkup = () => {
    const svgs = [...(score.current?.querySelectorAll('svg') ?? [])];
    return svgs.map((svg) => {
      const copy = svg.cloneNode(true) as SVGElement;
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      for (const el of copy.querySelectorAll('.sm-playing')) el.classList.remove('sm-playing');
      return copy.outerHTML.replace(/#e6edf3/gi, '#000000');
    });
  };

  const save = (kind: 'abc' | 'svg' | 'midi' | 'wav' | 'pdf') =>
    attempt(async () => {
      setBusy(kind);
      try {
        let outcome: Awaited<ReturnType<typeof saveFile>> | null = null;
        if (kind === 'abc') outcome = await saveFile(`${safeTitle}.abc`, state.abc, 'text/vnd.abc');
        else if (kind === 'svg') outcome = await saveFile(`${safeTitle}.svg`, svgMarkup()[0] ?? '', 'image/svg+xml');
        else if (kind === 'midi') {
          const abcjs = await loadAbcjs();
          const midi = abcjs.synth.getMidiFile(state.abc, { midiOutputType: 'binary', ...(state.tempo ? { qpm: state.tempo } : {}) } as never) as unknown as Uint8Array[];
          const first = midi[0];
          if (!first) throw new Error('No music to save.');
          outcome = await saveFile(`${safeTitle}.mid`, first, 'audio/midi');
        } else if (kind === 'wav') {
          const t = tune.current;
          if (!t) return;
          const { notes } = scheduleOf(t, state.tempo || undefined);
          if (notes.length === 0) throw new Error('There are no notes to save yet.');
          const buffer = await renderNotes(notes, state.voice);
          outcome = await saveFile(`${safeTitle}.wav`, encodeWav([buffer.getChannelData(0), buffer.getChannelData(1)], buffer.sampleRate), 'audio/wav');
        } else {
          const page = `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>@page { size: A4; margin: 14mm; } body { margin: 0; } svg { width: 100%; height: auto; break-inside: avoid; }</style></head><body>${svgMarkup().join('\n')}</body></html>`;
          if (!isDesktop) {
            printDocument(page);
            return;
          }
          outcome = await saveFile(`${safeTitle}.pdf`, await htmlToPdf(page, { paper: 'A4' }), 'application/pdf');
        }
        if (outcome?.saved) notify(`Saved to ${outcome.location}`);
      } finally {
        setBusy(null);
      }
    });

  return (
    <section class="tool sm-tool" data-testid="tool" data-state={warnings.length ? 'error' : 'done'}>
      <div class="button-row">
        <label class="control control-inline">
          <span class="control-label">Start from</span>
          <select
            class="select"
            value=""
            onChange={(e) => {
              const t = TUNES.find((x) => x.name === e.currentTarget.value);
              if (t) set('abc', t.abc);
              e.currentTarget.value = '';
            }}
            data-testid="sm-template"
          >
            <option value="">Choose an example…</option>
            {TUNES.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {playing ? (
          <button type="button" class="button button-danger" onClick={stop} data-testid="sm-stop">
            Stop
          </button>
        ) : (
          <button type="button" class="button button-primary" onClick={play} data-testid="sm-play">
            <Icon name="play" size={14} /> Play
          </button>
        )}
        <label class="control control-inline">
          <span class="control-label">Sound</span>
          <select class="select" value={state.voice} onChange={(e) => set('voice', e.currentTarget.value as Voice)}>
            <option value="piano">Soft piano</option>
            <option value="organ">Organ</option>
            <option value="flute">Flute</option>
            <option value="pluck">Plucked string</option>
          </select>
        </label>
        <label class="control control-inline">
          <span class="control-label">Tempo</span>
          <input
            class="input input-narrow"
            type="number"
            min={0}
            max={400}
            value={state.tempo || ''}
            placeholder="as written"
            onInput={(e) => set('tempo', Math.max(0, Number(e.currentTarget.value) || 0))}
            aria-label="Beats per minute"
          />
        </label>
        <span class="sm-transpose" role="group" aria-label="Transpose">
          <button type="button" class="button button-small" onClick={() => transpose(-1)} data-testid="sm-down">
            −1 semitone
          </button>
          <button type="button" class="button button-small" onClick={() => transpose(1)} data-testid="sm-up">
            +1 semitone
          </button>
        </span>
      </div>
      <div class="sm-layout">
        <div class="sm-left">
          <div class="pane sm-editor">
            <div class="pane-header">
              <span class="pane-title">ABC notation</span>
              <span class="pane-meta">Click a note on the score to find it here</span>
            </div>
            <div class="pane-body">
              <CodeEditor value={state.abc} onChange={(abc) => set('abc', abc)} label="ABC notation" viewRef={view} testId="sm-abc" />
            </div>
          </div>
          {warnings.length > 0 && (
            <ul class="recipe-error sm-warnings" data-testid="sm-warnings">
              {warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div class="sm-entry">
            <div class="button-row">
              <Segmented
                label="Note length"
                value={String(state.duration)}
                onChange={(v) => set('duration', Number(v))}
                choices={DURATIONS.map(([value, glyph, name]) => ({ value: String(value), label: `${glyph} ${name.replace(' note', '')}` }))}
              />
              <label class="check">
                <input type="checkbox" checked={state.dotted} onChange={(e) => set('dotted', e.currentTarget.checked)} /> Dotted
              </label>
              <label class="control control-inline">
                <span class="control-label">Octave</span>
                <select class="select" value={state.octave} onChange={(e) => set('octave', Number(e.currentTarget.value))}>
                  {[2, 3, 4, 5].map((o) => (
                    <option key={o} value={o}>
                      C{o}–C{o + 2}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Keyboard octave={state.octave} onKey={keyPressed} />
            <div class="button-row sm-symbols">
              <button type="button" class="button button-small" onClick={() => insert(`z${durationToken(state.duration * (state.dotted ? 1.5 : 1), unitLength(state.abc))} `)}>
                Rest
              </button>
              <button type="button" class="button button-small" onClick={() => insert('| ')}>
                Bar line
              </button>
              <button type="button" class="button button-small" onClick={() => insert('|: ')}>
                Repeat start
              </button>
              <button type="button" class="button button-small" onClick={() => insert(':| ')}>
                Repeat end
              </button>
              <button type="button" class="button button-small" onClick={() => insert('-')}>
                Tie
              </button>
              <button type="button" class="button button-small" onClick={() => insert('(3')}>
                Triplet
              </button>
              <button type="button" class="button button-small" onClick={() => insert('[]', 1)}>
                Chord
              </button>
              <button type="button" class="button button-small" onClick={() => insert('\n')}>
                New line
              </button>
              <button type="button" class="button button-small" onClick={() => insert('|]\n')}>
                Final bar
              </button>
            </div>
            <p class="control-help">
              In ABC, C D E are the notes from middle C up, c d e the octave above, C, and c' octaves below and above; ^ is sharp, _ flat. A number after a note makes it longer, /2 shorter. Header
              lines set the title (T:), metre (M:), note length (L:), tempo (Q:) and key (K:).
            </p>
          </div>
        </div>
        <div class="sm-right">
          <div class="sm-score" ref={score} data-testid="sm-score" />
          <div class="button-row">
            <span class="tone-muted">Save as</span>
            {(['abc', 'svg', 'midi', 'wav', 'pdf'] as const).map((k) => (
              <button key={k} type="button" class="button button-small" disabled={busy !== null} onClick={() => save(k)} data-testid={`sm-save-${k}`}>
                {busy === k ? 'Saving…' : k === 'pdf' && !isDesktop ? 'Print / PDF' : k.toUpperCase()}
              </button>
            ))}
          </div>
          <p class="control-help">Engraving by abcjs (MIT). Playback and WAV files use a simple synthesiser built into Benchtop, so nothing is downloaded.</p>
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(SheetMusic);
