/** Stopwatch with laps, a countdown timer and a Pomodoro cycle, timed with performance.now(). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { defineCustomTool } from '../types';
import { Segmented } from './_shared';

type Mode = 'stopwatch' | 'timer' | 'pomodoro';

export function formatClock(ms: number, hundredths = true): string {
  const total = Math.max(0, ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const fraction = Math.floor((total % 1000) / 10);
  const clock = `${hours > 0 ? `${hours}:` : ''}${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}:${String(seconds).padStart(2, '0')}`;
  return hundredths ? `${clock}.${String(fraction).padStart(2, '0')}` : clock;
}

/** A short beep made with the Web Audio API (no sound files). */
function beep(times = 3) {
  try {
    const context = new AudioContext();
    for (let i = 0; i < times; i++) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, context.currentTime + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + i * 0.35 + 0.25);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + i * 0.35);
      oscillator.stop(context.currentTime + i * 0.35 + 0.3);
    }
    setTimeout(() => void context.close(), times * 400 + 200);
  } catch {
    // No audio device: the screen still shows that time is up.
  }
}

const POMODORO = [
  { label: 'Focus', minutes: 25 },
  { label: 'Short break', minutes: 5 },
  { label: 'Focus', minutes: 25 },
  { label: 'Short break', minutes: 5 },
  { label: 'Focus', minutes: 25 },
  { label: 'Short break', minutes: 5 },
  { label: 'Focus', minutes: 25 },
  { label: 'Long break', minutes: 15 },
] as const;

function Stopwatch() {
  const [mode, setMode] = useState<Mode>('stopwatch');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState<readonly number[]>([]);
  const [minutes, setMinutes] = useState(5);
  const [phase, setPhase] = useState(0);
  const started = useRef(0);
  const before = useRef(0);

  const target = mode === 'timer' ? minutes * 60_000 : mode === 'pomodoro' ? (POMODORO[phase % POMODORO.length]?.minutes ?? 25) * 60_000 : Number.POSITIVE_INFINITY;
  const remaining = target - elapsed;

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const now = before.current + performance.now() - started.current;
      setElapsed(now);
      if (now >= target) {
        setRunning(false);
        setElapsed(target);
        before.current = target;
        beep();
        if (mode === 'pomodoro') {
          setPhase((value) => value + 1);
          setElapsed(0);
          before.current = 0;
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, target, mode]);

  useEffect(() => {
    document.title = running && mode !== 'stopwatch' ? `${formatClock(remaining, false)} · Benchtop` : 'Benchtop';
    return () => {
      document.title = 'Benchtop';
    };
  }, [running, remaining, mode]);

  const start = () => {
    started.current = performance.now();
    setRunning(true);
  };
  const pause = () => {
    before.current += performance.now() - started.current;
    setRunning(false);
  };
  const reset = () => {
    setRunning(false);
    setElapsed(0);
    before.current = 0;
    setLaps([]);
  };
  const switchMode = (next: Mode) => {
    reset();
    setPhase(0);
    setMode(next);
  };

  const display = mode === 'stopwatch' ? formatClock(elapsed) : formatClock(Math.max(0, remaining), false);
  const lapTimes = laps.map((lap, index) => lap - (laps[index + 1] ?? 0));
  const fastest = lapTimes.length > 1 ? Math.min(...lapTimes) : -1;
  const slowest = lapTimes.length > 1 ? Math.max(...lapTimes) : -1;
  return (
    <section class="tool tool-stopwatch" data-testid="tool" data-state={running ? 'busy' : 'done'}>
      <div class="stopwatch-bar">
        <Segmented<Mode>
          label="Mode"
          value={mode}
          onChange={switchMode}
          choices={[
            { value: 'stopwatch', label: 'Stopwatch' },
            { value: 'timer', label: 'Timer' },
            { value: 'pomodoro', label: 'Pomodoro' },
          ]}
        />
        {mode === 'timer' && !running && elapsed === 0 && (
          <label class="control control-inline">
            <span class="control-label">Minutes</span>
            <input
              class="input input-mono stopwatch-minutes"
              type="number"
              min={0.1}
              max={1440}
              step={0.5}
              value={minutes}
              onInput={(event) => setMinutes(Math.max(0.1, Number(event.currentTarget.value) || 1))}
            />
          </label>
        )}
      </div>
      <div class="pane stopwatch-face">
        {mode === 'pomodoro' && (
          <div class="stopwatch-phase">
            {POMODORO[phase % POMODORO.length]?.label} · round {Math.floor(phase / 2) + 1}
          </div>
        )}
        <div class="stopwatch-time" data-testid="stopwatch-time" role="timer">
          {display}
        </div>
        {mode !== 'stopwatch' && (
          <div class="stopwatch-progress" aria-hidden="true">
            <div style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }} />
          </div>
        )}
        <div class="stopwatch-actions">
          {running ? (
            <button type="button" class="button button-primary" onClick={pause}>
              Pause
            </button>
          ) : (
            <button type="button" class="button button-primary" onClick={start} disabled={mode !== 'stopwatch' && remaining <= 0} data-testid="stopwatch-start">
              {elapsed > 0 ? 'Resume' : 'Start'}
            </button>
          )}
          {mode === 'stopwatch' && (
            <button type="button" class="button" disabled={!running} onClick={() => setLaps((previous) => [elapsed, ...previous])}>
              Lap
            </button>
          )}
          {mode === 'pomodoro' && (
            <button
              type="button"
              class="button"
              onClick={() => {
                reset();
                setPhase((value) => value + 1);
              }}
            >
              Skip
            </button>
          )}
          <button type="button" class="button button-quiet" onClick={reset} disabled={elapsed === 0 && laps.length === 0}>
            Reset
          </button>
        </div>
      </div>
      {laps.length > 0 && (
        <ol class="stopwatch-laps" reversed>
          {laps.map((lap, index) => (
            <li key={index} class={lapTimes[index] === fastest ? 'tone-ok' : lapTimes[index] === slowest ? 'tone-bad' : ''}>
              <span>Lap {laps.length - index}</span>
              <span class="mono">{formatClock(lapTimes[index] ?? 0)}</span>
              <span class="mono muted">{formatClock(lap)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default defineCustomTool(Stopwatch);
