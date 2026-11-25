/**
 * What someone taking part in a Live Quiz sees on their own device: joining,
 * the waiting room, each question with the way to answer it, how they did,
 * and where they stand.  It draws the view the presenter's page sends and
 * reports what the person does; it knows no right answers until they are shown.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { AVATARS } from '../lib/quiz';
import { type GuestLink, pictureUrl } from '../lib/quiz-hub';

type View = Record<string, unknown>;
interface Numbered {
  readonly i: number;
  readonly text: string;
  readonly image?: string;
}
interface You {
  readonly name: string;
  readonly avatar: string;
  readonly team: string;
  readonly score: number;
  readonly rank: number;
  readonly streak: number;
}
interface BoardRow {
  readonly name: string;
  readonly avatar: string;
  readonly score: number;
  readonly rank: number;
  readonly you: boolean;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const arr = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const place = (rank: number) => `${rank}${rank % 10 === 1 && rank % 100 !== 11 ? 'st' : rank % 10 === 2 && rank % 100 !== 12 ? 'nd' : rank % 10 === 3 && rank % 100 !== 13 ? 'rd' : 'th'}`;

/**
 * Seconds left until a moment on the presenter's clock (0 for "no time limit"); `ahead` is
 * how far that clock is ahead of this device's.
 */
function useSecondsLeft(endsAt: number, ahead: number): number {
  const left = () => (endsAt > 0 ? Math.max(0, Math.ceil((endsAt - (Date.now() + ahead)) / 1000)) : 0);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (endsAt <= 0) return;
    const timer = setInterval(() => setSeconds(left()), 200);
    return () => clearInterval(timer);
  }, [endsAt, ahead]);
  return seconds;
}

function JoinForm({ view, send }: { view: View; send: GuestLink['send'] }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(() => AVATARS[Math.floor(Math.random() * AVATARS.length)] as string);
  const [team, setTeam] = useState(-1);
  const [sent, setSent] = useState(false);
  const teams = arr<string>(view.teams);
  if (view.locked) return <p class="qz-note">This quiz has started and is closed to new players.</p>;
  if (view.full) return <p class="qz-note">This quiz is full.</p>;
  return (
    <form
      class="qz-join"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSent(true);
        send({ kind: 'join', name, avatar: view.avatars ? avatar : '', team: team >= 0 ? team : null });
        // Should the presenter's page not answer (a full or closed quiz), the form comes back.
        setTimeout(() => setSent(false), 4000);
      }}
    >
      <h1>{str(view.title)}</h1>
      <label class="qz-field">
        <span>Your name</span>
        <input class="qz-input" value={name} maxLength={24} autocomplete="nickname" onInput={(e) => setName(e.currentTarget.value)} data-testid="qz-name" />
      </label>
      {view.avatars === true && (
        <fieldset class="qz-avatars">
          <legend>Pick a face</legend>
          {AVATARS.map((face) => (
            <button key={face} type="button" class={face === avatar ? 'is-on' : ''} aria-pressed={face === avatar} aria-label={`Face ${face}`} onClick={() => setAvatar(face)}>
              {face}
            </button>
          ))}
        </fieldset>
      )}
      {teams.length > 0 && (
        <label class="qz-field">
          <span>Team</span>
          <select class="qz-input" value={String(team)} onChange={(e) => setTeam(Number(e.currentTarget.value))} data-testid="qz-team">
            <option value="-1">Put me in a team</option>
            {teams.map((t, i) => (
              <option key={t} value={i}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" class="qz-button qz-primary" disabled={!name.trim() || sent} data-testid="qz-join">
        {sent ? 'Joining…' : 'Join'}
      </button>
    </form>
  );
}

function Lobby({ view, send }: { view: View; send: GuestLink['send'] }) {
  const [text, setText] = useState('');
  const messages = arr<{ name: string; text: string }>(view.messages);
  return (
    <div class="qz-card" data-testid="qz-lobby">
      <h1>You are in.</h1>
      <p>
        {num(view.players)} {num(view.players) === 1 ? 'player' : 'players'} so far. The quiz starts when the presenter is ready.
      </p>
      {view.chat === true && (
        <div class="qz-chat">
          <ol aria-label="Messages">
            {messages.map((m, i) => (
              <li key={`${i}:${m.name}:${m.text}`}>
                <strong>{m.name}</strong> {m.text}
              </li>
            ))}
          </ol>
          <form
            class="qz-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              send({ kind: 'chat', text });
              setText('');
            }}
          >
            <input class="qz-input" value={text} maxLength={200} placeholder="Say hello" aria-label="Message" onInput={(e) => setText(e.currentTarget.value)} />
            <button type="submit" class="qz-button">
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** A list put in order with up and down buttons (dragging is fiddly on a phone, and buttons work for everyone). */
function Sorter({ items, onChange }: { items: Numbered[]; onChange: (items: Numbered[]) => void }) {
  const move = (from: number, step: number) => {
    const to = from + step;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to] as Numbered, next[from] as Numbered];
    onChange(next);
  };
  return (
    <ol class="qz-sorter">
      {items.map((item, index) => (
        <li key={item.i}>
          <span class="qz-place">{index + 1}</span>
          <span class="qz-grow">{item.text}</span>
          <button type="button" class="qz-button qz-small" aria-label={`Move ${item.text} up`} disabled={index === 0} onClick={() => move(index, -1)}>
            ↑
          </button>
          <button type="button" class="qz-button qz-small" aria-label={`Move ${item.text} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}

function AnswerPad({ slide, link, onSend }: { slide: View; link: GuestLink; onSend: (answer: unknown) => void }) {
  const type = str(slide.type);
  const options = arr<Numbered>(slide.options);
  const [chosen, setChosen] = useState<number[]>([]);
  const [text, setText] = useState('');
  const [words, setWords] = useState<string[]>(() => Array.from({ length: num(slide.entries) || 1 }, () => ''));
  const [order, setOrder] = useState<Numbered[]>(() => (type === 'order' ? arr<Numbered>(slide.items) : options));
  const lefts = arr<string>(slide.lefts);
  const rights = arr<Numbered>(slide.rights);
  const [pairs, setPairs] = useState<number[]>(() => lefts.map(() => -1));
  const items = arr<Numbered>(slide.items);
  const categories = arr<string>(slide.categories);
  const [sorted, setSorted] = useState<Record<number, number>>({});
  const statements = arr<string>(slide.statements);
  const [ratings, setRatings] = useState<number[]>(() => statements.map(() => Number.NaN));
  const [pin, setPin] = useState<[number, number] | null>(null);
  const send = (answer: unknown, ready: boolean, label = 'Send') => (
    <button type="button" class="qz-button qz-primary" disabled={!ready} onClick={() => onSend(answer)} data-testid="qz-send">
      {label}
    </button>
  );
  if (type === 'pick' || type === 'poll') {
    const many = slide.many === true;
    return (
      <div class="qz-pad">
        {many && <p class="qz-hint">Choose every one that applies.</p>}
        <div class={`qz-options${options.some((o) => o.image) ? ' has-pictures' : ''}`}>
          {options.map((option) => {
            const on = chosen.includes(option.i);
            const picture = pictureUrl(link, option.image);
            return (
              <button
                key={option.i}
                type="button"
                class={`qz-option${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => setChosen(many ? (on ? chosen.filter((i) => i !== option.i) : [...chosen, option.i]) : [option.i])}
                data-testid="qz-option"
              >
                {picture && <img src={picture} alt="" />}
                {option.text && <span>{option.text}</span>}
              </button>
            );
          })}
        </div>
        {send(chosen, chosen.length > 0)}
      </div>
    );
  }
  if (type === 'type' || type === 'open') {
    return (
      <form
        class="qz-pad"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSend(text);
        }}
      >
        {type === 'type' ? (
          <input class="qz-input" value={text} maxLength={120} autocomplete="off" aria-label="Your answer" onInput={(e) => setText(e.currentTarget.value)} data-testid="qz-text" />
        ) : (
          <textarea class="qz-input" rows={4} value={text} maxLength={500} aria-label="Your reply" onInput={(e) => setText(e.currentTarget.value)} data-testid="qz-text" />
        )}
        {send(text, text.trim() !== '')}
      </form>
    );
  }
  if (type === 'cloud') {
    return (
      <div class="qz-pad">
        {words.map((word, index) => (
          <input
            key={index}
            class="qz-input"
            value={word}
            maxLength={30}
            autocomplete="off"
            aria-label={`Word ${index + 1}`}
            onInput={(e) => setWords(words.map((w, i) => (i === index ? e.currentTarget.value : w)))}
            data-testid="qz-word"
          />
        ))}
        {send(
          words,
          words.some((w) => w.trim()),
        )}
      </div>
    );
  }
  if (type === 'order' || type === 'ranking') {
    return (
      <div class="qz-pad">
        <p class="qz-hint">{type === 'order' ? 'Put these in the right order, first at the top.' : 'Put your favourite at the top.'}</p>
        <Sorter items={order} onChange={setOrder} />
        {send(
          order.map((item) => item.i),
          true,
        )}
      </div>
    );
  }
  if (type === 'match') {
    const used = new Set(pairs.filter((p) => p >= 0));
    return (
      <div class="qz-pad">
        {lefts.map((left, index) => (
          <label key={left} class="qz-pair">
            <span>{left}</span>
            <select class="qz-input" value={String(pairs[index])} onChange={(e) => setPairs(pairs.map((p, i) => (i === index ? Number(e.currentTarget.value) : p)))} data-testid="qz-pair">
              <option value="-1">Choose…</option>
              {rights.map((right) => (
                <option key={right.i} value={right.i} disabled={used.has(right.i) && pairs[index] !== right.i}>
                  {right.text}
                </option>
              ))}
            </select>
          </label>
        ))}
        {send(pairs, pairs.every((p) => p >= 0) && used.size === pairs.length)}
      </div>
    );
  }
  if (type === 'categorise') {
    // Answers go back in the deck's own order of items, whatever order they are shown in here.
    const answer = [...items].sort((a, b) => a.i - b.i).map((item) => sorted[item.i] ?? -1);
    return (
      <div class="qz-pad">
        {items.map((item) => (
          <fieldset key={item.i} class="qz-sort">
            <legend>{item.text}</legend>
            {categories.map((category, c) => (
              <button
                key={category}
                type="button"
                class={`qz-button qz-small${sorted[item.i] === c ? ' is-on' : ''}`}
                aria-pressed={sorted[item.i] === c}
                onClick={() => setSorted({ ...sorted, [item.i]: c })}
                data-testid="qz-category"
              >
                {category}
              </button>
            ))}
          </fieldset>
        ))}
        {send(
          answer,
          answer.every((c) => c >= 0),
        )}
      </div>
    );
  }
  if (type === 'pin') {
    const within = (n: number) => Math.min(1, Math.max(0, n));
    return (
      <div class="qz-pad">
        <p class="qz-hint">Tap the picture where you want your pin. Tap again to move it.</p>
        <button
          type="button"
          class="qz-pin-area"
          aria-label={
            pin
              ? `Your pin is ${Math.round(pin[0] * 100)}% across and ${Math.round(pin[1] * 100)}% down. Tap or use the arrow keys to move it.`
              : 'The picture: tap where you want your pin, or press an arrow key to start from the middle.'
          }
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            // A click from the keyboard has no place of its own: the pin starts in the middle.
            if (e.detail === 0 || box.width === 0 || box.height === 0) setPin((old) => old ?? [0.5, 0.5]);
            else setPin([within((e.clientX - box.left) / box.width), within((e.clientY - box.top) / box.height)]);
          }}
          onKeyDown={(e) => {
            const step = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] }[e.key];
            if (!step) return;
            e.preventDefault();
            setPin((old) => {
              const [x, y] = old ?? [0.5, 0.5];
              return [within(x + (step[0] as number)), within(y + (step[1] as number))];
            });
          }}
          data-testid="qz-pin-area"
        >
          <img src={pictureUrl(link, slide.image)} alt="" draggable={false} />
          {pin && <span class="qz-pin" style={{ left: `${pin[0] * 100}%`, top: `${pin[1] * 100}%` }} />}
        </button>
        {send(pin, pin !== null)}
      </div>
    );
  }
  if (type === 'scale') {
    const low = num(slide.low);
    const high = num(slide.high);
    const steps = Array.from({ length: high - low + 1 }, (_, i) => low + i);
    return (
      <div class="qz-pad">
        {statements.map((statement, s) => (
          <fieldset key={statement} class="qz-scale">
            <legend>{statement}</legend>
            <div>
              {steps.map((step) => (
                <button
                  key={step}
                  type="button"
                  class={`qz-button qz-small${ratings[s] === step ? ' is-on' : ''}`}
                  aria-pressed={ratings[s] === step}
                  onClick={() => setRatings(ratings.map((r, i) => (i === s ? step : r)))}
                  data-testid="qz-rate"
                >
                  {step}
                </button>
              ))}
            </div>
            <p class="qz-ends">
              <span>{str(slide.lowLabel)}</span>
              <span>{str(slide.highLabel)}</span>
            </p>
          </fieldset>
        ))}
        {send(
          ratings,
          ratings.every((r) => Number.isFinite(r)),
        )}
      </div>
    );
  }
  return null;
}

function Questions({ view, send }: { view: View; send: GuestLink['send'] }) {
  const [text, setText] = useState('');
  const questions = arr<{ id: string; text: string; votes: number; voted: boolean; mine: boolean; answered: boolean }>(view.questions);
  return (
    <div class="qz-pad">
      <form
        class="qz-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send({ kind: 'ask', text });
          setText('');
        }}
      >
        <input class="qz-input" value={text} maxLength={300} placeholder="Ask a question" aria-label="Your question" onInput={(e) => setText(e.currentTarget.value)} data-testid="qz-ask" />
        <button type="submit" class="qz-button qz-primary">
          Ask
        </button>
      </form>
      <ul class="qz-list" data-testid="qz-questions">
        {questions.map((q) => (
          <li key={q.id} class={q.answered ? 'is-done' : ''}>
            <span class="qz-grow">
              {q.text}
              {q.answered && <em> (answered)</em>}
            </span>
            <button
              type="button"
              class={`qz-button qz-small${q.voted ? ' is-on' : ''}`}
              aria-pressed={q.voted}
              disabled={q.mine}
              aria-label={`Vote for: ${q.text}`}
              onClick={() => send({ kind: 'upvote', id: q.id })}
            >
              ▲ {q.votes}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ideas({ view, send }: { view: View; send: GuestLink['send'] }) {
  const [text, setText] = useState('');
  const stage = str(view.stage);
  const ideas = arr<{ id: string; text: string; votes: number; voted: boolean; mine: boolean }>(view.ideas);
  return (
    <div class="qz-pad">
      {stage === 'collect' && (
        <form
          class="qz-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            send({ kind: 'idea', text });
            setText('');
          }}
        >
          <input class="qz-input" value={text} maxLength={200} placeholder="An idea" aria-label="Your idea" onInput={(e) => setText(e.currentTarget.value)} data-testid="qz-idea" />
          <button type="submit" class="qz-button qz-primary">
            Add
          </button>
        </form>
      )}
      {stage === 'vote' && <p class="qz-hint">Vote for the ideas you like best: {num(view.votesLeft)} left.</p>}
      <ul class="qz-list" data-testid="qz-ideas">
        {(stage === 'collect' ? ideas.filter((i) => i.mine) : ideas).map((idea) => (
          <li key={idea.id}>
            <span class="qz-grow">{idea.text}</span>
            {stage === 'vote' && (
              <button
                type="button"
                class={`qz-button qz-small${idea.voted ? ' is-on' : ''}`}
                aria-pressed={idea.voted}
                aria-label={`Vote for: ${idea.text}`}
                onClick={() => send({ kind: 'vote', id: idea.id })}
              >
                {idea.voted ? '★' : '☆'}
              </button>
            )}
            {stage === 'results' && <strong>{idea.votes}</strong>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Board({ view }: { view: View }) {
  const rows = arr<BoardRow>(view.board);
  const teams = arr<{ name: string; score: number; rank: number }>(view.teamBoard);
  return (
    <div class="qz-board" data-testid="qz-board">
      {teams.length > 0 && (
        <ol>
          {teams.map((team) => (
            <li key={team.name}>
              <span class="qz-place">{team.rank}</span>
              <span class="qz-grow">{team.name}</span>
              <strong>{team.score}</strong>
            </li>
          ))}
        </ol>
      )}
      <ol>
        {rows.map((row) => (
          <li key={row.name} class={row.you ? 'is-you' : ''}>
            <span class="qz-place">{row.rank}</span>
            <span class="qz-grow">
              {row.avatar} {row.name}
            </span>
            <strong>{row.score}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GuestView({ view, ahead, link }: { view: View | null; ahead: number; link: GuestLink }) {
  const slide = (view?.slide ?? null) as View | null;
  const slideId = str(slide?.id);
  const [sentFor, setSentFor] = useState('');
  const seconds = useSecondsLeft(num(view?.endsAt), ahead);
  // The spinner wheel's choice is told once the wheel on the big screen has come to rest.
  const rested = useSecondsLeft(num(view?.winnerAt), ahead) === 0;
  if (!view) return <p class="qz-note">Connecting to the quiz…</p>;
  const phase = str(view.phase);
  const you = (view.you ?? null) as You | null;
  const type = str(slide?.type);
  const result = (view.result ?? null) as { fraction: number; points: number; right: string } | null;
  const answered = view.answered === true || sentFor === slideId;
  // (A picture to pin on is shown where the pin goes, not above it as well.)
  const picture = type === 'pin' && phase === 'open' && !answered ? '' : pictureUrl(link, slide?.image);
  const hints = arr<string>(view.hints);
  const next =
    view.selfPaced === true ? (
      <button type="button" class="qz-button qz-primary" onClick={() => link.send({ kind: 'next' })} data-testid="qz-next">
        Next
      </button>
    ) : null;

  let body: ComponentChildren;
  if (phase === 'join') body = <JoinForm view={view} send={link.send} />;
  else if (phase === 'lobby') body = <Lobby view={view} send={link.send} />;
  else if (phase === 'ended') {
    body = (
      <div class="qz-card" data-testid="qz-ended">
        <h1>That is the end.</h1>
        {you && you.rank > 0 ? (
          <p class="qz-big">
            {place(you.rank)} place · {you.score} points
          </p>
        ) : (
          <p>Thank you for taking part.</p>
        )}
        <Board view={view} />
      </div>
    );
  } else if (slide) {
    const heading = (
      <>
        <p class="qz-count">
          {num(view.index) + 1} of {num(view.total)}
        </p>
        <h1 data-testid="qz-title">{str(slide.title)}</h1>
        {picture && <img class="qz-picture" src={picture} alt="" />}
      </>
    );
    if (phase === 'countdown') {
      body = (
        <div class="qz-card">
          {heading}
          <p class="qz-big" aria-live="polite">
            Get ready… {seconds}
          </p>
        </div>
      );
    } else if (type === 'qa') {
      body = (
        <div class="qz-card">
          {heading}
          <Questions view={view} send={link.send} />
        </div>
      );
    } else if (type === 'brainstorm') {
      body = (
        <div class="qz-card">
          {heading}
          <Ideas view={view} send={link.send} />
        </div>
      );
    } else if (type === 'content') {
      body = (
        <div class="qz-card">
          {heading}
          <p class="qz-text">{str(slide.text)}</p>
          {next}
        </div>
      );
    } else if (type === 'wheel') {
      body = (
        <div class="qz-card">
          {heading}
          <p class="qz-big" data-testid="qz-winner">
            {str(view.winner) && rested ? `The wheel stopped on ${str(view.winner)}.` : 'Watch the big screen.'}
          </p>
        </div>
      );
    } else if (type === 'leaderboard') {
      body = (
        <div class="qz-card">
          {heading}
          <Board view={view} />
        </div>
      );
    } else if (phase === 'revealed' && result) {
      const share = result.fraction;
      body = (
        <div class={`qz-card qz-result ${share === 1 ? 'is-right' : share > 0 ? 'is-part' : 'is-wrong'}`} data-testid="qz-result">
          {heading}
          <p class="qz-big">{!answered ? 'No answer' : share === 1 ? 'Right!' : share > 0 ? 'Partly right' : 'Not this time'}</p>
          <p>
            +{result.points} points{you && you.streak > 1 ? ` · ${you.streak} right in a row` : ''}
          </p>
          <p class="qz-text">
            The answer: <strong>{result.right}</strong>
          </p>
          {next}
        </div>
      );
    } else if (phase === 'open' && !answered) {
      body = (
        <div class="qz-card">
          {heading}
          {num(view.endsAt) > 0 && (
            <p class={`qz-timer${seconds <= 5 ? ' is-low' : ''}`} role="timer" aria-label={`${seconds} seconds left`} data-testid="qz-timer">
              {seconds}
            </p>
          )}
          {hints.map((hint) => (
            <p key={hint} class="qz-hint">
              Hint: {hint}
            </p>
          ))}
          <AnswerPad
            key={slideId}
            slide={slide}
            link={link}
            onSend={(answer) => {
              setSentFor(slideId);
              link.send({ kind: 'answer', answer });
            }}
          />
        </div>
      );
    } else {
      body = (
        <div class="qz-card" data-testid="qz-waiting">
          {heading}
          <p class="qz-big">{answered ? 'Your answer is in.' : phase === 'open' ? '' : 'Time is up.'}</p>
          <p>{phase === 'open' ? 'Waiting for the others…' : 'Watch the big screen.'}</p>
          {phase !== 'open' && next}
        </div>
      );
    }
  } else body = <p class="qz-note">Waiting for the presenter…</p>;

  return (
    <div class="qz" data-phase={phase}>
      {you && phase !== 'join' && (
        <header class="qz-you">
          <span class="qz-grow">
            {you.avatar} {you.name}
            {you.team && <em> · {you.team}</em>}
          </span>
          <span data-testid="qz-score">{you.score} points</span>
          {you.rank > 0 && <span>{place(you.rank)}</span>}
        </header>
      )}
      {body}
    </div>
  );
}
