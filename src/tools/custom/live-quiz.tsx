/**
 * Live Quiz: build a deck of quiz questions, polls, word clouds and the rest,
 * present it on the big screen while people answer on their phones, and keep
 * the results.  In the desktop app, phones on the same network join through a
 * small server the app runs for the session; in a browser, other tabs of the
 * same browser can join.  Nothing leaves the network the quiz is played on.
 */
import '../../quiz/guest.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { answerText, type Deck, deckFile, importQuestions, isAnswered, isQuiz, problems, readDeck, readDeckFile, SLIDE_NAMES, sampleDeck } from '../../lib/quiz';
import type { GuestLink } from '../../lib/quiz-hub';
import {
  askAgain,
  award,
  close,
  lock,
  markAnswered,
  moveTo,
  nextStep,
  reportCsv,
  reportData,
  reset,
  reveal,
  type Step,
  setStage,
  showHint,
  spin,
  standings,
  takeStep,
  teamStandings,
} from '../../lib/quiz-session';
import { copyText, isDesktop, pickFile, readTextFile, saveFile } from '../../platform';
import { GuestView } from '../../quiz/GuestView';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { changeLive, clearLive, closeLive, getLive, kickPlayer, type Live, localGuest, startLive, watchLive } from './_quiz-live';
import { Segmented, Sure, usePersistentState } from './_shared';
import { QuizBuilder } from './quiz-builder';
import { Board, QuizStage, SlideOutcome } from './quiz-stage';

type Tab = 'build' | 'present' | 'results';

interface Kept {
  readonly deck: Deck;
  readonly chosen: number;
  /** Desktop app: phones on the network may join (otherwise only this computer reaches the quiz). */
  readonly lan: boolean;
}

/** A deck heavier than this (its pictures, mostly) is kept between sessions without its pictures. */
const MAX_KEPT = 300_000;

const withoutPictures = (deck: Deck): Deck => ({
  ...deck,
  slides: deck.slides.map(({ image: _image, ...slide }) => ({ ...slide, options: slide.options.map(({ image: _picture, ...option }) => option) })),
});
const read = (v: Values | undefined): Kept => {
  const deck = v?.deck && typeof v.deck === 'object' ? readDeck(v.deck) : sampleDeck();
  return { deck, chosen: typeof v?.chosen === 'number' && Number.isInteger(v.chosen) ? Math.min(Math.max(v.chosen, 0), Math.max(deck.slides.length - 1, 0)) : 0, lan: v?.lan !== false };
};
const write = (kept: Kept): Values => ({ ...kept, deck: JSON.stringify(kept.deck).length > MAX_KEPT ? withoutPictures(kept.deck) : kept.deck });

const fileBase = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'quiz';

function useLive(): Live | null {
  const [live, setLive] = useState(getLive);
  useEffect(() => {
    setLive(getLive());
    return watchLive(() => setLive(getLive()));
  }, []);
  return live;
}

const STEP_LABELS: Record<Step, string> = {
  start: 'Start the quiz',
  close: 'End the question',
  reveal: 'Show the answer',
  spin: 'Spin the wheel',
  vote: 'Start the vote',
  results: 'Show the votes',
  next: 'Next slide',
  finish: 'Finish the quiz',
  none: 'Finished',
};

const PHASES: Record<string, string> = { idle: '', countdown: 'counting down', open: 'open for answers', closed: 'closed', revealed: 'answer shown' };

/** A participant's screen beside the stage, joined to the session inside this page: for trying a quiz out alone. */
function TryPane({ code }: { code: string }) {
  const [link, setLink] = useState<GuestLink | null>(null);
  const [shown, setShown] = useState<{ view: Record<string, unknown> | null; ahead: number }>({ view: null, ahead: 0 });
  useEffect(() => {
    const made = localGuest('local-participant');
    if (!made) return;
    made.onView = (view, now) => setShown({ view, ahead: now - Date.now() });
    setLink(made);
    return () => {
      made.close();
      setLink(null);
    };
  }, [code]);
  if (!link) return null;
  return (
    <div class="lq-try" {...scrollRegion('A participant’s screen')} data-testid="lq-try-pane">
      <GuestView view={shown.view} ahead={shown.ahead} link={link} />
    </div>
  );
}

function Presenting({ live }: { live: Live }) {
  const { session } = live;
  const { settings } = session.deck;
  const stage = useRef<HTMLDivElement>(null);
  const [trying, setTrying] = useState(false);
  const [full, setFull] = useState(false);
  const slide = session.deck.slides[session.index];
  const run = session.runs[session.index];
  const step = nextStep(session);
  // Ending the answers of a poll whose results were kept back is what shows them.
  const stepLabel = step === 'close' && slide && !isQuiz(slide.type) ? 'Show the results' : STEP_LABELS[step];
  const network = live.urls.find((url) => !url.includes('127.0.0.1')) ?? null;
  const address = live.mode === 'lan' ? (network ?? live.urls[0] ?? '') : (live.urls[0] ?? '');
  const spinning = slide?.type === 'wheel' && !!run && run.spins > 0;

  useEffect(() => {
    const onFull = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
  }, []);

  const advance = () => changeLive((s) => takeStep(s, Date.now()));
  const back = () => changeLive((s) => (s.index >= 0 ? moveTo(s, s.index - 1, Date.now()) : s));
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.().catch(() => notify('Full screen is not available here.', 'error'));
  };
  const onKey = (event: KeyboardEvent) => {
    // Keys belong to the big screen itself, not to a button or a box inside it.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(event.key)) advance();
    else if (['ArrowLeft', 'PageUp'].includes(event.key)) back();
    else if (event.key.toLowerCase() === 'f') toggleFull();
    else if (event.key.toLowerCase() === 'h') changeLive(showHint);
    else return;
    event.preventDefault();
  };

  const status = session.ended
    ? 'The quiz has ended. People see the final standings.'
    : settings.selfPaced
      ? 'Everyone is going through the slides at their own pace.'
      : !slide || !run
        ? 'In the lobby: people can join.'
        : `Slide ${session.index + 1} of ${session.deck.slides.length}: ${SLIDE_NAMES[slide.type]}${PHASES[run.phase] ? `, ${PHASES[run.phase]}` : ''}.`;

  return (
    <div class={`lq-present${trying ? ' is-trying' : ''}`}>
      <div
        ref={stage}
        class="lq-stage"
        role="region"
        aria-label="The big screen. Right arrow or space for the next step, left arrow to go back, F for full screen."
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the keys above need the big screen to take the focus
        tabIndex={0}
        onKeyDown={onKey}
        data-testid="lq-stage"
      >
        <QuizStage live={live}>
          <div class="qs-controls">
            <button type="button" class="button button-small" onClick={back} disabled={session.index < 0 || session.ended || settings.selfPaced}>
              <Icon name="left" size={14} /> Back
            </button>
            <button type="button" class="button button-small button-primary" onClick={advance} disabled={step === 'none'}>
              {stepLabel}
            </button>
            <button type="button" class="button button-small" onClick={toggleFull}>
              {full ? 'Leave full screen' : 'Full screen'}
            </button>
          </div>
        </QuizStage>
      </div>

      <div class="lq-panel">
        <p class="lq-status" role="status" data-testid="lq-status">
          {status}
        </p>
        <div class="button-row">
          <button type="button" class="button" onClick={back} disabled={session.index < 0 || session.ended || settings.selfPaced} data-testid="lq-prev">
            <Icon name="left" size={15} /> Back
          </button>
          <button type="button" class="button button-primary lq-step" onClick={advance} disabled={step === 'none'} data-testid="lq-next">
            {stepLabel}
          </button>
        </div>

        {slide && run && !session.ended && !settings.selfPaced && (
          <div class="button-row lq-more">
            {step !== 'next' && step !== 'finish' && session.index < session.deck.slides.length - 1 && (
              <button type="button" class="button button-small" onClick={() => changeLive((s) => moveTo(s, s.index + 1, Date.now()))} data-testid="lq-skip">
                Skip to the next slide
              </button>
            )}
            {!isQuiz(slide.type) && isAnswered(slide.type) && run.phase === 'open' && (
              <button type="button" class="button button-small" onClick={() => changeLive(close)} data-testid="lq-close">
                Stop taking answers
              </button>
            )}
            {isQuiz(slide.type) && run.phase === 'open' && settings.manualReveal && (
              <button type="button" class="button button-small" onClick={() => changeLive((s) => reveal(close(s)))} data-testid="lq-reveal-now">
                End and show the answer
              </button>
            )}
            {slide.type === 'pick' && run.phase === 'open' && slide.hints.length > 0 && (
              <button type="button" class="button button-small" disabled={run.hints >= slide.hints.length} onClick={() => changeLive(showHint)} data-testid="lq-hint">
                Show a hint ({run.hints} of {slide.hints.length} shown)
              </button>
            )}
            {spinning && (
              <button type="button" class="button button-small" onClick={() => changeLive((s) => spin(s, Math.random, Date.now()))} data-testid="lq-spin">
                Spin again
              </button>
            )}
            {slide.type === 'brainstorm' && (
              <Segmented
                value={run.stage}
                label="Brainstorm"
                onChange={(next) => changeLive((s) => setStage(s, next))}
                choices={[
                  { value: 'collect', label: 'Ideas' },
                  { value: 'vote', label: 'Vote' },
                  { value: 'results', label: 'Results' },
                ]}
              />
            )}
            {isAnswered(slide.type) && slide.type !== 'qa' && slide.type !== 'brainstorm' && (run.phase === 'closed' || run.phase === 'revealed') && (
              <Sure sure="Clear the answers and ask again?" onConfirm={() => changeLive((s) => askAgain(s, Date.now()))} testId="lq-again">
                Ask again
              </Sure>
            )}
          </div>
        )}

        {slide?.type === 'qa' && run && run.questions.length > 0 && (
          <div class="lq-box">
            <span class="pane-title">Questions</span>
            <div class="lq-scroll" {...scrollRegion('Questions asked')}>
              <ul class="lq-list">
                {[...run.questions]
                  .sort((a, b) => Number(a.answered) - Number(b.answered) || b.votes.length - a.votes.length)
                  .map((question) => (
                    <li key={question.id} class={question.answered ? 'is-done' : ''}>
                      <span class="lq-grow">
                        {question.text} <span class="tone-muted">({session.players.find((p) => p.id === question.by)?.name ?? 'someone who left'})</span>
                      </span>
                      <button type="button" class="button button-small" aria-pressed={question.answered} onClick={() => changeLive((s) => markAnswered(s, question.id))} data-testid="lq-answered">
                        {question.answered ? 'Answered' : 'Mark answered'}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}

        <div class="lq-box" data-testid="lq-join">
          <span class="pane-title">How people join</span>
          {live.mode === 'lan' ? (
            <>
              <p class="lq-address">
                <code data-testid="lq-url">{address}</code>
                <button
                  type="button"
                  class="button button-small button-quiet"
                  onClick={() =>
                    attempt(async () => {
                      await copyText(address);
                      notify('Address copied');
                    })
                  }
                >
                  <Icon name="copy" size={12} /> Copy
                </button>
              </p>
              <p class="control-help">
                {network
                  ? 'Phones on the same Wi-Fi open this address, or scan the code on the lobby screen. If a phone cannot open it, allow Benchtop through this computer’s firewall.'
                  : 'Only this computer can open the address. To let phones join, connect to a network and start again with “phones on this network may join” ticked.'}
              </p>
            </>
          ) : (
            <>
              <p class="lq-address">
                Code <code data-testid="lq-code">{session.code}</code>
                <a class="button button-small" href={address} target="_blank" rel="noopener" data-testid="lq-url">
                  Open a participant tab
                </a>
              </p>
              <p class="control-help">In a browser the quiz reaches other tabs of this browser only. The desktop app lets phones on the Wi-Fi join.</p>
            </>
          )}
          <label class="check">
            <input type="checkbox" checked={trying} onChange={(e) => setTrying(e.currentTarget.checked)} data-testid="lq-try" />
            Take part myself, beside the big screen
          </label>
        </div>

        <div class="lq-box">
          <span class="lq-box-head">
            <span class="pane-title" data-testid="lq-count">
              {session.players.length === 1 ? '1 player' : `${session.players.length} players`}
            </span>
            <button type="button" class="button button-small" aria-pressed={session.locked} onClick={() => changeLive((s) => lock(s, !s.locked))} data-testid="lq-lock">
              {session.locked ? 'Closed to new players' : 'Close to new players'}
            </button>
          </span>
          {session.players.length > 0 && (
            <div class="lq-scroll" {...scrollRegion('Players')}>
              <ul class="lq-list" data-testid="lq-players">
                {session.players.slice(0, 150).map((player) => (
                  <li key={player.id}>
                    <span class="lq-grow">
                      {player.avatar && <span aria-hidden="true">{player.avatar} </span>}
                      {player.name}
                      {settings.teams && <span class="tone-muted"> · {settings.teamNames[player.team] ?? ''}</span>}
                    </span>
                    <Sure sure="Remove?" onConfirm={() => kickPlayer(player.id)} class="button button-small button-quiet" testId="lq-kick">
                      Remove
                    </Sure>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {session.players.length > 150 && <p class="control-help">The first 150 are listed.</p>}
        </div>

        <div class="button-row">
          <button type="button" class="button button-small" onClick={toggleFull} data-testid="lq-full">
            <Icon name="monitor" size={14} /> Full screen
          </button>
          <Sure sure="Close it? Devices are cut off." onConfirm={closeLive} testId="lq-stop">
            Close the session
          </Sure>
        </div>
        <p class="control-help">The results stay after the session is closed, until a new one starts.</p>
      </div>

      {trying && <TryPane code={session.code} />}
    </div>
  );
}

function StartPanel({ deck, lan, setLan, previous, onFix }: { deck: Deck; lan: boolean; setLan: (lan: boolean) => void; previous: Live | null; onFix: (index: number) => void }) {
  const [busy, setBusy] = useState(false);
  const unready = deck.slides.map((slide, index) => ({ index, found: problems(slide) })).filter((item) => item.found.length > 0);
  const questions = deck.slides.filter((slide) => isQuiz(slide.type)).length;
  const start = () =>
    attempt(async () => {
      setBusy(true);
      try {
        await startLive(deck, lan);
      } finally {
        setBusy(false);
      }
    });
  const ready = deck.slides.length > 0 && unready.length === 0;
  return (
    <div class="lq-start" data-testid="lq-start-panel">
      <h3>Present “{deck.title}”</h3>
      <p>
        {deck.slides.length === 1 ? '1 slide' : `${deck.slides.length} slides`}, {questions === 1 ? '1 scored question' : `${questions} scored questions`}
        {deck.settings.selfPaced ? '; everyone goes at their own pace' : ''}
        {deck.settings.teams ? `; played in ${deck.settings.teamNames.length} teams` : ''}.
      </p>
      {deck.slides.length === 0 && <p class="recipe-error">Add a slide first, in Build.</p>}
      {unready.length > 0 && (
        <div class="lq-unready" data-testid="lq-unready">
          <p class="recipe-error">{unready.length === 1 ? 'One slide is not ready:' : `${unready.length} slides are not ready:`}</p>
          <ul>
            {unready.slice(0, 12).map((item) => (
              <li key={item.index}>
                <button type="button" class="button button-small button-quiet" onClick={() => onFix(item.index)}>
                  Slide {item.index + 1}
                </button>{' '}
                {item.found.join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {isDesktop ? (
        <label class="check">
          <input type="checkbox" checked={lan} onChange={(e) => setLan(e.currentTarget.checked)} data-testid="lq-lan" />
          Phones and other devices on this network may join
        </label>
      ) : (
        <p class="control-help">
          In a browser, a quiz can be joined from other tabs of this browser only: good for trying it out. Present from the Benchtop desktop app to let phones on the Wi-Fi join.
        </p>
      )}
      <div class="button-row">
        {previous && previous.session.players.length > 0 ? (
          <Sure sure="Start, and drop the last session’s results?" onConfirm={start} class="button button-primary" testId="lq-start" disabled={!ready || busy}>
            Start a new session
          </Sure>
        ) : (
          <button type="button" class="button button-primary" onClick={start} disabled={!ready || busy} data-testid="lq-start">
            <Icon name="play" size={15} /> Start
          </button>
        )}
      </div>
      <p class="control-help">
        People join with a name on their own device; you move through the slides here. Nothing is sent to the internet:{' '}
        {isDesktop ? 'the app serves the quiz to this network itself.' : 'the tabs talk inside this browser.'}
      </p>
    </div>
  );
}

function Results({ live }: { live: Live }) {
  const { session } = live;
  const [points, setPoints] = useState(10);
  const rows = standings(session);
  const teams = teamStandings(session);
  const asked = session.deck.slides
    .map((slide, index) => ({ slide, index, run: session.runs[index] }))
    .filter(({ slide, run }) => !!run && isAnswered(slide.type) && (Object.keys(run.responses).length > 0 || run.questions.length > 0 || run.ideas.length > 0));
  const scores = rows.map((row) => row.score);
  const name = fileBase(session.deck.title);
  return (
    <div class="lq-results" data-testid="lq-results">
      <div class="button-row">
        <button
          type="button"
          class="button button-small button-primary"
          onClick={() => attempt(async () => void (await saveFile(`${name}-results.csv`, reportCsv(session, answerText), 'text/csv')))}
          data-testid="lq-csv"
        >
          <Icon name="save" size={14} /> Results as a table (CSV)
        </button>
        <button
          type="button"
          class="button button-small"
          onClick={() => attempt(async () => void (await saveFile(`${name}-results.json`, JSON.stringify(reportData(session, answerText), null, 1), 'application/json')))}
          data-testid="lq-json"
        >
          <Icon name="save" size={14} /> Everything (JSON)
        </button>
        {live.open && (
          <Sure sure="Clear every answer and score?" onConfirm={() => changeLive((s) => reset(s, Date.now()))} testId="lq-reset">
            Clear the answers
          </Sure>
        )}
        <Sure sure="Forget this session and its results?" onConfirm={clearLive} testId="lq-forget">
          Forget this session
        </Sure>
      </div>

      <dl class="lq-tiles">
        <div>
          <dt>Players</dt>
          <dd data-testid="lq-total-players">{rows.length}</dd>
        </div>
        <div>
          <dt>Slides answered</dt>
          <dd>{asked.length}</dd>
        </div>
        <div>
          <dt>Top score</dt>
          <dd>{scores.length ? Math.max(...scores) : 0}</dd>
        </div>
        <div>
          <dt>Average score</dt>
          <dd>{scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0}</dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <p class="control-help">Nobody joined this session.</p>
      ) : (
        <div class="lq-table-wrap" {...scrollRegion('Standings')}>
          <table class="lq-table" data-testid="lq-table">
            <caption>
              Standings
              <label class="lq-points">
                Points to give or take
                <input
                  class="input input-number"
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={points}
                  onChange={(e) => setPoints(Math.min(1000, Math.max(1, Math.round(Number(e.currentTarget.value)) || 10)))}
                  data-testid="lq-points"
                />
              </label>
            </caption>
            <thead>
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Name</th>
                {teams.length > 0 && <th scope="col">Team</th>}
                <th scope="col">Score</th>
                <th scope="col">Right</th>
                <th scope="col">Answered</th>
                <th scope="col">By hand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-testid="lq-row">
                  <td>{row.rank}</td>
                  <th scope="row">
                    {row.avatar && <span aria-hidden="true">{row.avatar} </span>}
                    {row.name}
                  </th>
                  {teams.length > 0 && <td>{session.deck.settings.teamNames[row.team] ?? ''}</td>}
                  <td data-testid="lq-score">{row.score}</td>
                  <td>{row.right}</td>
                  <td>{row.answered}</td>
                  <td>
                    <span class="button-row">
                      <button
                        type="button"
                        class="button button-small"
                        aria-label={`Give ${row.name} ${points} points`}
                        onClick={() => changeLive((s) => award(s, row.id, points))}
                        data-testid="lq-give"
                      >
                        +{points}
                      </button>
                      <button
                        type="button"
                        class="button button-small"
                        aria-label={`Take ${points} points from ${row.name}`}
                        onClick={() => changeLive((s) => award(s, row.id, -points))}
                        data-testid="lq-take"
                      >
                        −{points}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {teams.length > 0 && (
        <div class="lq-outcome">
          <h3>Teams</h3>
          <Board session={session} limit={0} />
        </div>
      )}

      {asked.map(({ slide, index }) => (
        <div class="lq-outcome" key={slide.id} data-testid="lq-outcome">
          <h3>
            {index + 1}. {slide.title} <span class="tone-muted">· {SLIDE_NAMES[slide.type]}</span>
          </h3>
          <SlideOutcome session={session} index={index} />
        </div>
      ))}
    </div>
  );
}

function LiveQuiz() {
  const [kept, setKept] = usePersistentState<Kept>('live-quiz', read, write);
  const [tab, setTab] = useState<Tab>(() => (getLive()?.open ? 'present' : 'build'));
  const live = useLive();
  const { deck } = kept;
  const setDeck = (next: Deck) => setKept((old) => ({ ...old, deck: next }));
  const heavy = useMemo(() => JSON.stringify(deck).length > MAX_KEPT, [deck]);
  const replace = (next: Deck) => setKept((old) => ({ ...old, deck: next, chosen: 0 }));

  const open = () =>
    attempt(async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      replace(readDeckFile(await readTextFile(file)));
      setTab('build');
    });
  const bringIn = () =>
    attempt(async () => {
      const file = await pickFile('.csv,.tsv,.txt,text/csv,text/plain');
      if (!file) return;
      const slides = importQuestions(await readTextFile(file));
      if (slides.length === 0) throw new Error('No questions were found. Each row needs a question, then its answers, then the number or letter of the right one.');
      const room = Math.max(0, 200 - deck.slides.length);
      setKept((old) => ({ ...old, deck: { ...old.deck, slides: [...old.deck.slides, ...slides.slice(0, room)] }, chosen: old.deck.slides.length }));
      setTab('build');
      notify(`${Math.min(slides.length, room)} ${Math.min(slides.length, room) === 1 ? 'question' : 'questions'} added`);
    });

  return (
    <section class="tool lq-tool" data-testid="tool" data-state={live ? 'done' : 'idle'}>
      <div class="lq-bar">
        <label class="lq-title">
          <span class="visually-hidden">Title of the quiz</span>
          <input class="input" value={deck.title} maxLength={120} placeholder="Title of the quiz" onInput={(e) => setDeck({ ...deck, title: e.currentTarget.value })} data-testid="lq-title" />
        </label>
        <span class="button-row">
          {deck.slides.length > 0 ? (
            <Sure sure="Start an empty quiz?" onConfirm={() => replace(readDeck({ title: 'Quiz', slides: [], settings: deck.settings }))} class="button button-small button-quiet" testId="lq-new">
              <Icon name="file" size={14} /> New
            </Sure>
          ) : (
            <button type="button" class="button button-small button-quiet" disabled data-testid="lq-new">
              <Icon name="file" size={14} /> New
            </button>
          )}
          <button type="button" class="button button-small button-quiet" onClick={open} data-testid="lq-open">
            <Icon name="open" size={14} /> Open
          </button>
          <button
            type="button"
            class="button button-small button-quiet"
            onClick={() => attempt(async () => void (await saveFile(`${fileBase(deck.title)}.quiz.json`, deckFile(deck), 'application/json')))}
            data-testid="lq-save"
          >
            <Icon name="save" size={14} /> Save
          </button>
          <button type="button" class="button button-small button-quiet" onClick={bringIn} data-testid="lq-import">
            <Icon name="paste" size={14} /> Import questions
          </button>
          {deck.slides.length > 0 ? (
            <Sure sure="Replace this quiz with the sample?" onConfirm={() => replace(sampleDeck())} class="button button-small button-quiet" testId="lq-sample">
              <Icon name="sample" size={14} /> Sample
            </Sure>
          ) : (
            <button type="button" class="button button-small button-quiet" onClick={() => replace(sampleDeck())} data-testid="lq-sample">
              <Icon name="sample" size={14} /> Sample
            </button>
          )}
        </span>
        <Segmented
          value={tab}
          label="Part"
          onChange={setTab}
          choices={[
            { value: 'build', label: 'Build' },
            { value: 'present', label: live?.open ? 'Present (live)' : 'Present' },
            { value: 'results', label: 'Results' },
          ]}
        />
      </div>

      {tab === 'build' && (
        <>
          {live?.open && (
            <p class="control-help lq-note" data-testid="lq-live-note">
              A session is running with the quiz as it was when it started: changes made here take effect in the next session.
            </p>
          )}
          {heavy && (
            <p class="control-help lq-note" data-testid="lq-heavy-note">
              With its pictures, this quiz is too large to be kept here in full between sessions: save it as a file. Without the file, it comes back without its pictures.
            </p>
          )}
          <QuizBuilder deck={deck} chosen={kept.chosen} onChoose={(chosen) => setKept((old) => ({ ...old, chosen }))} onChange={setDeck} />
          <details class="lq-help">
            <summary>Importing questions from a table</summary>
            <p>
              A CSV file (or text with commas, semicolons or tabs) with one question on each row: the question, then its answers, then which answer is right, by number or letter. More than one right
              answer is written as <code>1,3</code> in quotes or <code>A|C</code>.
            </p>
            <pre>{'Which planet has the shortest day?,Earth,Jupiter,Mars,2\nSound travels faster in water than in air,true\nWhat gas do plants take in?,carbon dioxide|CO2'}</pre>
            <p>A row with a single answer becomes a question people type the answer to (other spellings after a bar); “true” or “false” alone becomes a true-or-false question.</p>
          </details>
        </>
      )}

      {tab === 'present' &&
        (live?.open ? (
          <Presenting live={live} />
        ) : (
          <StartPanel
            deck={deck}
            lan={kept.lan}
            setLan={(lan) => setKept((old) => ({ ...old, lan }))}
            previous={live}
            onFix={(index) => {
              setKept((old) => ({ ...old, chosen: index }));
              setTab('build');
            }}
          />
        ))}

      {tab === 'results' &&
        (live ? (
          <Results live={live} />
        ) : (
          <p class="lq-empty" data-testid="lq-no-results">
            No session yet. Present the quiz, and what people answered is kept here until the next session starts.
          </p>
        ))}
    </section>
  );
}

export default defineCustomTool(LiveQuiz);
