/**
 * The Live Quiz's big screen: what the room looks at.  It shows how to join,
 * each slide as it runs, and what people answered, drawn from the session
 * (and from nothing else: it holds no state of its own beyond the clock).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isAnswered, isQuiz, rightAnswer, SLIDE_NAMES, type Slide, seeded, shuffled, sortItems, tally } from '../../lib/quiz';
import { arcPath, cloudBox, layoutCloud, percents, sharesOf, wheelTurn } from '../../lib/quiz-draw';
import { type Run, type Session, SPIN_MS, standings, teamStandings, wheelEntries } from '../../lib/quiz-session';
import { Icon } from '../../ui/icons';
import type { Live } from './_quiz-live';

/** The time now, read again a few times a second while something on screen depends on it. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function useQr(text: string | null): string | null {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!text) {
      setQr(null);
      return;
    }
    let cancelled = false;
    import('bwip-js/generic').then(
      ({ toSVG }) => {
        const svg = toSVG({ bcid: 'qrcode', text, scale: 4, backgroundcolor: 'FFFFFF', paddingwidth: 4, paddingheight: 4 } as never);
        if (!cancelled) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      },
      () => setQr(null),
    );
    return () => {
      cancelled = true;
    };
  }, [text]);
  return qr;
}

/* ------------------------------------------------------- sounds -- */

let audio: AudioContext | null = null;
type Sound = 'tick' | 'open' | 'closed' | 'reveal' | 'spin';
const NOTES: Record<Sound, readonly (readonly [frequency: number, start: number, length: number])[]> = {
  tick: [[660, 0, 0.07]],
  open: [
    [523, 0, 0.1],
    [784, 0.1, 0.16],
  ],
  closed: [
    [440, 0, 0.12],
    [330, 0.12, 0.2],
  ],
  reveal: [
    [523, 0, 0.1],
    [659, 0.1, 0.1],
    [784, 0.2, 0.24],
  ],
  spin: [
    [392, 0, 0.08],
    [494, 0.08, 0.08],
  ],
};

/** A few plain notes, made here: nothing is loaded. */
function play(sound: Sound): void {
  try {
    audio ??= new AudioContext();
    const context = audio;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    for (const [frequency, start, length] of NOTES[sound]) {
      const tone = context.createOscillator();
      const level = context.createGain();
      const at = context.currentTime + start;
      tone.type = 'triangle';
      tone.frequency.value = frequency;
      level.gain.setValueAtTime(0.0001, at);
      level.gain.exponentialRampToValueAtTime(0.16, at + 0.015);
      level.gain.exponentialRampToValueAtTime(0.0001, at + length);
      tone.connect(level).connect(context.destination);
      tone.start(at);
      tone.stop(at + length + 0.02);
    }
  } catch {
    /* No sound here (no audio device, or the page may not play yet): the quiz goes on without. */
  }
}

/* ------------------------------------------------------- charts -- */

interface Row {
  readonly key: string | number;
  readonly label: string;
  readonly picture?: string | undefined;
  readonly count: number;
  /** Quiz questions, once the answers are shown. */
  readonly right?: boolean | undefined;
}

/** Bars from one baseline, one colour: the value stands at the tip of each. */
function Bars({ rows, marked, unit }: { rows: readonly Row[]; marked: boolean; unit?: (row: Row, percent: number) => string }) {
  const most = Math.max(1, ...rows.map((row) => row.count));
  const shares = percents(rows.map((row) => row.count));
  return (
    <ul class={`qs-bars${marked ? ' is-marked' : ''}`} data-testid="qs-bars">
      {rows.map((row, index) => (
        <li key={row.key} class={marked ? (row.right ? 'is-right' : 'is-other') : ''} data-testid="qs-bar">
          <span class="qs-bar-label">
            {row.picture && <img src={row.picture} alt="" />}
            <span>{row.label}</span>
            {marked && row.right && (
              <span class="qs-right">
                <Icon name="check" size={16} /> Right answer
              </span>
            )}
          </span>
          <span class="qs-bar-track">
            <span class="qs-bar-fill" style={{ width: `${(row.count / most) * 100}%` }} />
            <span class="qs-bar-value">{unit ? unit(row, shares[index] ?? 0) : `${row.count} · ${shares[index] ?? 0}%`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Parts of a whole as a ring or a pie, for up to six parts; the list beside it carries every name and number. */
function Ring({ rows, pie }: { rows: readonly Row[]; pie: boolean }) {
  const parts = sharesOf(rows.map((row) => row.count));
  const shares = percents(rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const summary = rows.map((row, i) => `${row.label}: ${row.count} (${shares[i] ?? 0}%)`).join('; ');
  return (
    <div class="qs-ring" data-testid="qs-ring">
      <svg viewBox="0 0 200 200" role="img" aria-label={total ? summary : 'No votes yet'}>
        {total === 0 && <path class="qs-ring-empty" d={arcPath(100, 100, 92, pie ? 0 : 56, 0, 1)} />}
        {parts.map((part) =>
          part.share > 0 ? (
            <path key={rows[part.index]?.key} class={`qs-series-${part.index + 1}`} d={arcPath(100, 100, 92, pie ? 0 : 56, part.from, part.to)}>
              <title>{`${rows[part.index]?.label ?? ''}: ${part.count} (${shares[part.index] ?? 0}%)`}</title>
            </path>
          ) : null,
        )}
        {!pie && (
          <text x="100" y="100" class="qs-ring-total">
            <tspan x="100" dy="0.1em">
              {total}
            </tspan>
            <tspan x="100" dy="1.5em" class="qs-ring-unit">
              {total === 1 ? 'vote' : 'votes'}
            </tspan>
          </text>
        )}
      </svg>
      <ul class="qs-legend">
        {rows.map((row, index) => (
          <li key={row.key}>
            <span class={`qs-swatch qs-series-${index + 1}`} aria-hidden="true" />
            {row.picture && <img src={row.picture} alt="" />}
            <span class="qs-legend-label">{row.label}</span>
            <strong>{row.count}</strong>
            <span class="qs-legend-share">{shares[index] ?? 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CLOUD_W = 900;
const CLOUD_H = 420;

function Cloud({ words }: { words: readonly { text: string; count: number }[] }) {
  const box = useRef<SVGSVGElement>(null);
  const [family, setFamily] = useState('sans-serif');
  useEffect(() => {
    if (box.current) setFamily(getComputedStyle(box.current).fontFamily || 'sans-serif');
  }, []);
  const placed = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d');
    // The page's own letters are measured; without a canvas, a fair guess per letter.
    if (context) context.font = `600 100px ${family}`;
    const measure = (text: string) => (context ? context.measureText(text).width / 100 : [...text].length * 0.58);
    return layoutCloud(words, CLOUD_W, CLOUD_H, measure);
  }, [words, family]);
  const top = placed[0]?.count ?? 0;
  // The sheet is cut to the words, so that a few words are shown as large as the screen allows.
  // (Not closer than to a little under half the sheet: one word alone need not be a wall of letters.)
  const cut = cloudBox(placed) ?? { x: 0, y: 0, width: CLOUD_W, height: CLOUD_H };
  const width = Math.max(cut.width, CLOUD_W * 0.45);
  const height = Math.max(cut.height, CLOUD_H * 0.45);
  const frame = { x: cut.x - (width - cut.width) / 2, y: cut.y - (height - cut.height) / 2, width, height };
  return (
    <div class="qs-cloud" data-testid="qs-cloud">
      <svg ref={box} viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`} role="img" aria-label={`Word cloud: ${words.map((w) => `${w.text} (${w.count})`).join(', ')}`}>
        {placed.map((word) => (
          <text key={word.text} x={word.x} y={word.y} font-size={word.size} class={word.count === top ? 'is-top' : ''} data-testid="qs-word">
            {word.text}
          </text>
        ))}
      </svg>
    </div>
  );
}

function Wheel({ entries, run, now }: { entries: readonly string[]; run: Run; now: number }) {
  const count = entries.length;
  const index = Math.max(0, entries.indexOf(run.winner));
  const rested = run.spins > 0 && now >= run.spunAt + SPIN_MS;
  const labelled = count <= 24;
  return (
    <div class="qs-wheel" data-testid="qs-wheel">
      <div class="qs-wheel-face">
        <svg viewBox="0 0 400 400" role="img" aria-label={`A wheel with ${count} ${count === 1 ? 'entry' : 'entries'}`}>
          <g class="qs-wheel-turn" style={{ transform: `rotate(${wheelTurn(index, count, run.spins)}deg)` }}>
            {count === 0 && <circle cx="200" cy="200" r="178" class="qs-wheel-tone-0" />}
            {entries.map((entry, i) => {
              const middle = (i + 0.5) / count;
              // Two tones in turn; a third closes an odd wheel, so that no two neighbours match.
              const tone = count % 2 === 1 && i === count - 1 && count > 1 ? 2 : i % 2;
              return (
                <g key={i}>
                  <path class={`qs-wheel-tone-${tone}`} d={arcPath(200, 200, 178, 0, i / count, (i + 1) / count)} />
                  {labelled && (
                    <text x="200" y="200" transform={`rotate(${middle * 360 - 90} 200 200) translate(150 0)`} font-size={count <= 8 ? 20 : count <= 16 ? 15 : 12} class="qs-wheel-name">
                      {entry.length > 16 ? `${entry.slice(0, 15)}…` : entry}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
          <path class="qs-wheel-pointer" d="M200 34 L187 4 L213 4 Z" />
          <circle cx="200" cy="200" r="14" class="qs-wheel-hub" />
        </svg>
      </div>
      <p class="qs-wheel-result" aria-live="polite" data-testid="qs-winner">
        {count === 0 ? 'Nothing to pick from yet.' : run.spins === 0 ? `${count} ${count === 1 ? 'entry' : 'entries'}. Spin when you are ready.` : rested ? run.winner : 'Spinning…'}
      </p>
    </div>
  );
}

export function Board({ session, limit = 10 }: { session: Session; limit?: number }) {
  const rows = standings(session);
  const teams = teamStandings(session);
  const best = Math.max(1, ...rows.map((row) => row.score));
  const bestTeam = Math.max(1, ...teams.map((team) => team.score));
  const names = session.deck.settings.teamNames;
  return (
    <div class="qs-board" data-testid="qs-board">
      {teams.length > 0 && (
        <ol class="qs-standings qs-teams">
          {teams.map((team) => (
            <li key={team.name}>
              <span class="qs-rank">{team.rank}</span>
              <span class="qs-name">
                {team.name} <span class="qs-team">{team.members === 1 ? '1 player' : `${team.members} players`}</span>
              </span>
              <span class="qs-score-track">
                <span class="qs-bar-fill" style={{ width: `${(Math.max(0, team.score) / bestTeam) * 100}%` }} />
              </span>
              <strong class="qs-score">{team.score}</strong>
            </li>
          ))}
        </ol>
      )}
      {rows.length === 0 ? (
        <p class="qs-wait">Nobody has joined yet.</p>
      ) : (
        <ol class="qs-standings">
          {rows.slice(0, limit).map((row) => (
            <li key={row.id} data-testid="qs-standing">
              <span class="qs-rank">{row.rank}</span>
              <span class="qs-name">
                {row.avatar && <span aria-hidden="true">{row.avatar} </span>}
                {row.name}
                {teams.length > 0 && <span class="qs-team"> {names[row.team] ?? ''}</span>}
              </span>
              <span class="qs-score-track">
                <span class="qs-bar-fill" style={{ width: `${(Math.max(0, row.score) / best) * 100}%` }} />
              </span>
              <strong class="qs-score">{row.score}</strong>
            </li>
          ))}
        </ol>
      )}
      {rows.length > limit && <p class="qs-more">and {rows.length - limit} more</p>}
    </div>
  );
}

/* ------------------------------------------------------- slides -- */

const LETTERS = 'ABCDEFGHIJKL';
const shown = (address: string) => address.replace(/^https?:\/\//, '').replace(/\/$/, '');

function Lobby({ live }: { live: Live }) {
  const { session } = live;
  const network = live.urls.find((url) => !url.includes('127.0.0.1')) ?? null;
  const address = live.mode === 'lan' ? (network ?? live.urls[0] ?? '') : (live.urls[0] ?? '');
  const qr = useQr(live.mode === 'lan' ? network : null);
  return (
    <div class="qs-lobby" data-testid="qs-lobby">
      <div class="qs-join">
        {qr && <img class="qs-qr" src={qr} alt={`QR code for ${network}`} />}
        <div class="qs-join-text">
          {live.mode === 'lan' ? (
            <>
              <h2 class="qs-join-lead">Join on your phone</h2>
              <p class="qs-join-url" data-testid="qs-url">
                {shown(address)}
              </p>
              <p class="qs-join-help">
                {network
                  ? 'Connect to the same Wi-Fi as this computer, then scan the code or type the address into your browser.'
                  : 'Only this computer can open the address: it is not on a network, or the quiz was not opened to the network.'}
              </p>
            </>
          ) : (
            <>
              <h2 class="qs-join-lead">Join from another tab</h2>
              <p class="qs-join-url" data-testid="qs-url">
                Code {session.code}
              </p>
              <p class="qs-join-help">In a browser the quiz reaches other tabs of this browser only. Present from the Benchtop desktop app to let phones on the Wi-Fi join.</p>
            </>
          )}
        </div>
      </div>
      <div class="qs-people">
        <p class="qs-people-count" data-testid="qs-joined">
          {session.players.length === 0 ? 'Waiting for the first player…' : session.players.length === 1 ? '1 player is in' : `${session.players.length} players are in`}
        </p>
        <ul class="qs-chips">
          {session.players.slice(-80).map((player) => (
            <li key={player.id}>
              {player.avatar && <span aria-hidden="true">{player.avatar} </span>}
              {player.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The parts of a question as the room sees them before the answer: nothing here says which is right. */
function Asked({ slide }: { slide: Slide }) {
  const random = seeded(`stage:${slide.id}`);
  if (slide.type === 'pick')
    return (
      <ul class={`qs-options${slide.options.some((o) => o.image) ? ' has-pictures' : ''}`} data-testid="qs-options">
        {slide.options.map((option, index) => (
          <li key={index}>
            <span class="qs-letter">{LETTERS[index]}</span>
            {option.image && <img src={option.image} alt="" />}
            <span>{option.text}</span>
          </li>
        ))}
      </ul>
    );
  if (slide.type === 'type') return <p class="qs-wait">Type your answer on your phone.</p>;
  if (slide.type === 'match')
    return (
      <div class="qs-columns">
        <ul class="qs-tiles">
          {slide.pairs.map((pair) => (
            <li key={pair.left}>{pair.left}</li>
          ))}
        </ul>
        <ul class="qs-tiles">
          {shuffled(slide.pairs, random).map((pair) => (
            <li key={pair.right}>{pair.right}</li>
          ))}
        </ul>
      </div>
    );
  if (slide.type === 'order')
    return (
      <ul class="qs-tiles qs-tiles-row">
        {shuffled(slide.items, random).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  if (slide.type === 'categorise')
    return (
      <div class="qs-sorting">
        <ul class="qs-tiles qs-tiles-row">
          {shuffled(sortItems(slide), random).map((item) => (
            <li key={item.text}>{item.text}</li>
          ))}
        </ul>
        <ul class="qs-bins">
          {slide.categories.map((category) => (
            <li key={category.name}>{category.name}</li>
          ))}
        </ul>
      </div>
    );
  return null;
}

/** The right answer, laid out by the kind of question. */
function Answer({ slide }: { slide: Slide }) {
  if (slide.type === 'match')
    return (
      <ul class="qs-tiles qs-answer" data-testid="qs-answer">
        {slide.pairs.map((pair) => (
          <li key={pair.left}>
            {pair.left} <span aria-hidden="true">→</span> <strong>{pair.right}</strong>
          </li>
        ))}
      </ul>
    );
  if (slide.type === 'order')
    return (
      <ol class="qs-tiles qs-answer qs-numbered" data-testid="qs-answer">
        {slide.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    );
  if (slide.type === 'categorise')
    return (
      <ul class="qs-bins qs-answer" data-testid="qs-answer">
        {slide.categories.map((category) => (
          <li key={category.name}>
            <strong>{category.name}</strong>
            <span>{category.items.filter((item) => item.trim()).join(', ')}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <p class="qs-answer qs-answer-line" data-testid="qs-answer">
      The answer: <strong>{rightAnswer(slide)}</strong>
    </p>
  );
}

function Notes({ items, empty }: { items: readonly { key: string; text: string; votes?: number | undefined; done?: boolean | undefined }[]; empty: string }) {
  if (items.length === 0) return <p class="qs-wait">{empty}</p>;
  return (
    <ul class="qs-notes" data-testid="qs-notes">
      {items.slice(0, 60).map((item) => (
        <li key={item.key} class={item.done ? 'is-done' : ''}>
          <span>{item.text}</span>
          {item.votes !== undefined && (
            <span class="qs-votes">
              {item.votes} {item.votes === 1 ? 'vote' : 'votes'}
              {item.done ? ' · answered' : ''}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SlideBody({ session, slide, run, now }: { session: Session; slide: Slide; run: Run; now: number }) {
  const { hidden } = session.deck.settings;
  const answers = useMemo(() => Object.values(run.responses).map((response) => response.answer), [run.responses]);
  const counted = useMemo(() => tally(slide, answers, hidden), [slide, answers, hidden]);
  const optionRows = (marked: boolean): Row[] =>
    slide.options.map((option, index) => ({
      key: index,
      label: option.text || `Picture ${LETTERS[index]}`,
      picture: option.image,
      count: counted.counts[index] ?? 0,
      right: marked ? option.correct === true : undefined,
    }));

  if (isQuiz(slide.type)) {
    if (run.phase === 'countdown') {
      return (
        <p class="qs-countdown" aria-live="polite" data-testid="qs-countdown">
          <span>Get ready</span>
          <strong>{Math.max(1, Math.ceil((run.opensAt - now) / 1000))}</strong>
        </p>
      );
    }
    if (run.phase === 'open' || run.phase === 'idle') {
      return (
        <>
          <Asked slide={slide} />
          {slide.hints.slice(0, run.hints).map((hint) => (
            <p key={hint} class="qs-hint" data-testid="qs-hint">
              Hint: {hint}
            </p>
          ))}
        </>
      );
    }
    const revealed = run.phase === 'revealed';
    return (
      <>
        {slide.type === 'pick' ? (
          <Bars rows={optionRows(revealed)} marked={revealed} />
        ) : slide.type === 'type' && counted.words.length > 0 ? (
          <Bars rows={counted.words.slice(0, 8).map((word) => ({ key: word.text, label: word.text, count: word.count, right: revealed ? word.right === true : undefined }))} marked={revealed} />
        ) : !revealed ? (
          <p class="qs-wait">Time is up.</p>
        ) : null}
        {revealed && slide.type !== 'pick' && <Answer slide={slide} />}
        {revealed && (
          <p class="qs-summary" data-testid="qs-summary">
            {counted.answered === 0
              ? 'Nobody answered.'
              : `${counted.right} of ${counted.answered} got it right${slide.partial && counted.meanShare > 0 ? ` · ${Math.round(counted.meanShare * 100)}% of the marks on average` : ''}`}
          </p>
        )}
        {!revealed && <p class="qs-summary">The answers are in. The right answer comes next.</p>}
      </>
    );
  }

  if (slide.hide && (run.phase === 'open' || run.phase === 'idle')) {
    return (
      <p class="qs-wait" data-testid="qs-hidden">
        {counted.answered === 0 ? 'Answer on your phone.' : counted.answered === 1 ? '1 answer is in.' : `${counted.answered} answers are in.`} The results are shown when answering ends.
      </p>
    );
  }

  switch (slide.type) {
    case 'pin':
      return (
        <div class="qs-pins" data-testid="qs-pins">
          <div class="qs-pins-picture">
            {slide.image && <img src={slide.image} alt="" />}
            {counted.pins.map(([x, y], index) => (
              <span key={`${index}:${x}:${y}`} class="qs-pin" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} data-testid="qs-pin" />
            ))}
          </div>
          <p class="qs-summary">{counted.pins.length === 0 ? 'Waiting for the first pin…' : counted.pins.length === 1 ? '1 pin' : `${counted.pins.length} pins`}</p>
        </div>
      );
    case 'poll': {
      const rows = optionRows(false);
      return slide.chart !== 'bar' && rows.length <= 6 ? <Ring rows={rows} pie={slide.chart === 'pie'} /> : <Bars rows={rows} marked={false} />;
    }
    case 'ranking': {
      const rows = optionRows(false).sort((a, b) => b.count - a.count);
      return counted.answered === 0 ? (
        <p class="qs-wait">Waiting for the first ranking…</p>
      ) : (
        <Bars rows={rows} marked={false} unit={(row) => `${row.count} ${row.count === 1 ? 'point' : 'points'}`} />
      );
    }
    case 'cloud':
      return counted.words.length === 0 ? <p class="qs-wait">Waiting for the first words…</p> : <Cloud words={counted.words} />;
    case 'open':
      return <Notes items={counted.texts.map((text, index) => ({ key: `${counted.texts.length - index}`, text }))} empty="Waiting for the first reply…" />;
    case 'scale': {
      const span = Math.max(1, slide.high - slide.low);
      return (
        <div class="qs-scale" data-testid="qs-scale">
          <ul>
            {slide.statements.map((statement, index) => {
              const mean = counted.means[index] ?? 0;
              return (
                <li key={statement}>
                  <span class="qs-scale-label">{statement}</span>
                  <span class="qs-meter">
                    <span class="qs-meter-fill" style={{ width: counted.answered ? `${((mean - slide.low) / span) * 100}%` : '0%' }} />
                  </span>
                  <strong class="qs-scale-mean">{counted.answered ? mean.toFixed(1) : '–'}</strong>
                </li>
              );
            })}
          </ul>
          <p class="qs-scale-ends">
            <span>
              {slide.low}
              {slide.lowLabel ? ` · ${slide.lowLabel}` : ''}
            </span>
            <span>
              {slide.highLabel ? `${slide.highLabel} · ` : ''}
              {slide.high}
            </span>
          </p>
        </div>
      );
    }
    case 'qa':
      return (
        <Notes
          items={[...run.questions]
            .sort((a, b) => Number(a.answered) - Number(b.answered) || b.votes.length - a.votes.length)
            .map((q) => ({ key: q.id, text: q.text, votes: q.votes.length, done: q.answered }))}
          empty="Ask on your phone; vote for the questions you want answered."
        />
      );
    case 'brainstorm': {
      const ideas = run.stage === 'results' ? [...run.ideas].sort((a, b) => b.votes.length - a.votes.length) : run.ideas;
      return (
        <>
          <p class="qs-stage-name" data-testid="qs-stage-name">
            {run.stage === 'collect' ? 'Send your ideas' : run.stage === 'vote' ? `Vote for the best: ${slide.entries} ${slide.entries === 1 ? 'vote' : 'votes'} each` : 'The ideas, by votes'}
          </p>
          <Notes items={ideas.map((idea) => ({ key: idea.id, text: idea.text, votes: run.stage === 'results' ? idea.votes.length : undefined }))} empty="Waiting for the first idea…" />
        </>
      );
    }
    case 'wheel':
      return <Wheel entries={wheelEntries(session, slide)} run={run} now={now} />;
    case 'leaderboard':
      return <Board session={session} />;
    case 'content':
      return slide.text ? <p class="qs-text">{slide.text}</p> : null;
    default:
      return null;
  }
}

/** Everyone at their own pace: how far each has got. */
function Progress({ session }: { session: Session }) {
  const total = session.deck.slides.length;
  const rows = standings(session);
  return (
    <div class="qs-progress" data-testid="qs-progress">
      {rows.length === 0 ? (
        <p class="qs-wait">Nobody has joined yet.</p>
      ) : (
        <ol class="qs-standings">
          {rows.slice(0, 12).map((row) => {
            const at = session.players.find((p) => p.id === row.id)?.at ?? 0;
            return (
              <li key={row.id}>
                <span class="qs-rank">{row.rank}</span>
                <span class="qs-name">
                  {row.avatar && <span aria-hidden="true">{row.avatar} </span>}
                  {row.name}
                  <span class="qs-team"> {at >= total ? 'finished' : `slide ${at + 1} of ${total}`}</span>
                </span>
                <span class="qs-score-track">
                  <span class="qs-bar-fill" style={{ width: `${(Math.min(at, total) / Math.max(total, 1)) * 100}%` }} />
                </span>
                <strong class="qs-score">{row.score}</strong>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function QuizStage({ live, quiet = false, children }: { live: Live; quiet?: boolean; children?: ComponentChildren }) {
  const { session } = live;
  const { settings } = session.deck;
  const slide = session.deck.slides[session.index];
  const run = session.runs[session.index];
  const timed = !!run && (run.phase === 'countdown' || (run.phase === 'open' && run.closesAt > 0));
  const spinning = !!run && slide?.type === 'wheel' && run.spins > 0;
  const now = useNow(timed || spinning);
  const left = run && run.phase === 'open' && run.closesAt > 0 ? Math.max(0, Math.ceil((run.closesAt - now) / 1000)) : null;
  const answered = run ? Object.keys(run.responses).length : 0;
  const network = live.urls.find((url) => !url.includes('127.0.0.1')) ?? live.urls[0] ?? '';

  // Sounds mark the turns of a question, for the room; none on the way in.
  const sounds = settings.sounds && !quiet && live.open;
  const moment = `${session.index}:${run?.phase ?? ''}:${run?.spins ?? 0}:${session.ended}`;
  const last = useRef<string | null>(null);
  useEffect(() => {
    const before = last.current;
    last.current = moment;
    if (before === null || before === moment || !sounds || !run) return;
    if (slide?.type === 'wheel' && run.spins > 0) play('spin');
    else if (run.phase === 'open' && isAnswered(slide?.type ?? 'content')) play('open');
    else if (run.phase === 'closed') play('closed');
    else if (run.phase === 'revealed') play('reveal');
  }, [moment]);
  const beat = run?.phase === 'countdown' ? Math.ceil((run.opensAt - now) / 1000) : left !== null && left <= 5 ? left : null;
  useEffect(() => {
    if (sounds && beat !== null && beat > 0) play('tick');
  }, [beat]);

  let body: ComponentChildren;
  if (session.ended) {
    body = (
      <>
        <h2 class="qs-title" data-testid="qs-title">
          Final results
        </h2>
        <Board session={session} />
      </>
    );
  } else if (settings.selfPaced) {
    body = (
      <>
        <Lobby live={live} />
        <Progress session={session} />
      </>
    );
  } else if (!slide || !run) body = <Lobby live={live} />;
  else {
    const hideTitle = isQuiz(slide.type) && run.phase === 'countdown';
    body = (
      <>
        {!hideTitle && (
          <h2 class="qs-title" data-testid="qs-title">
            {slide.title}
          </h2>
        )}
        {!hideTitle && slide.image && slide.type !== 'pin' && <img class="qs-picture" src={slide.image} alt="" />}
        <SlideBody session={session} slide={slide} run={run} now={now} />
      </>
    );
  }

  return (
    <div class="qs" data-testid="qs" data-phase={session.ended ? 'ended' : (run?.phase ?? 'lobby')} data-type={slide?.type ?? 'lobby'}>
      <div class="qs-top">
        <span class="qs-top-join">
          {!live.open
            ? `${session.deck.title} · this session is closed`
            : session.index >= 0 && !session.ended && !settings.selfPaced
              ? live.mode === 'lan'
                ? `Join at ${shown(network)}`
                : `Join with code ${session.code}`
              : session.deck.title}
        </span>
        {slide && !session.ended && !settings.selfPaced && (
          <span class="qs-top-kind">
            {session.index + 1} of {session.deck.slides.length} · {SLIDE_NAMES[slide.type]}
          </span>
        )}
        {slide && run && isAnswered(slide.type) && slide.type !== 'qa' && slide.type !== 'brainstorm' && !session.ended && !settings.selfPaced && (
          <span class="qs-top-count" data-testid="qs-answered">
            {answered} of {session.players.length} answered
          </span>
        )}
        {left !== null && (
          <span class={`qs-clock${left <= 5 ? ' is-low' : ''}`} role="timer" aria-label={`${left} seconds left`} data-testid="qs-clock">
            {left}
          </span>
        )}
      </div>
      {run && left !== null && slide && slide.seconds > 0 && (
        <div class="qs-timebar" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(1, (run.closesAt - now) / (slide.seconds * 1000))) * 100}%` }} />
        </div>
      )}
      <div class="qs-main">{body}</div>
      {children}
    </div>
  );
}

/** How a slide came out, as the big screen showed it at the end: for the results. */
export function SlideOutcome({ session, index }: { session: Session; index: number }) {
  const slide = session.deck.slides[index];
  const run = session.runs[index];
  if (!slide || !run) return null;
  // A question that was never closed is shown as it stands, answers and all.
  const ended: Run = isQuiz(slide.type) ? { ...run, phase: 'revealed' } : run;
  return (
    <div class="qs qs-outcome">
      <div class="qs-main">
        <SlideBody session={session} slide={slide} run={ended} now={Number.MAX_SAFE_INTEGER} />
      </div>
    </div>
  );
}
