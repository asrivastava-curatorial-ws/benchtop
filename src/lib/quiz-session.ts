/**
 * A running Live Quiz: who has joined, which slide is showing, what everyone
 * answered and what it earned them.  The presenter's page keeps the session
 * and is the only judge; devices send messages and are sent a view that holds
 * no right answers until they are shown.  Every function returns a new session
 * (or the same one when nothing changed), and takes the time as a number, so
 * the whole of it runs in tests without a clock.
 */
import { AVATARS, type Deck, fractionRight, guestSlide, isAnswered, isQuiz, newId, pointsFor, readAnswer, rightAnswer, type Slide, starred } from './quiz';

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  /** Index into the deck's team names, or -1 when there are no teams. */
  readonly team: number;
  /** Points the presenter gave or took by hand. */
  readonly bonus: number;
  /** Self-paced play: the slide this player is on, and when they got to it. */
  readonly at: number;
  readonly opened: number;
}

export interface Response {
  readonly answer: unknown;
  /** Milliseconds from the question opening to the answer. */
  readonly ms: number;
  readonly fraction: number;
  readonly points: number;
}

export interface Question {
  readonly id: string;
  readonly by: string;
  readonly text: string;
  readonly votes: readonly string[];
  readonly answered: boolean;
}

export interface Idea {
  readonly id: string;
  readonly by: string;
  readonly text: string;
  readonly votes: readonly string[];
}

export type Phase = 'idle' | 'countdown' | 'open' | 'closed' | 'revealed';

/** What has happened on one slide. */
export interface Run {
  readonly phase: Phase;
  readonly opensAt: number;
  readonly openedAt: number;
  /** 0 when the slide has no time limit. */
  readonly closesAt: number;
  readonly responses: Readonly<Record<string, Response>>;
  readonly questions: readonly Question[];
  readonly ideas: readonly Idea[];
  /** Brainstorm: ideas are collected, then voted on, then shown in order. */
  readonly stage: 'collect' | 'vote' | 'results';
  /** Hints shown so far. */
  readonly hints: number;
  /** Spinner wheel: who it stopped on, how many times it has been spun, and when the last spin began. */
  readonly winner: string;
  readonly spins: number;
  readonly spunAt: number;
}

export interface Session {
  readonly deck: Deck;
  readonly code: string;
  /** The slide showing; -1 is the lobby before the first slide. */
  readonly index: number;
  readonly runs: readonly Run[];
  readonly players: readonly Player[];
  readonly chat: readonly { readonly name: string; readonly text: string }[];
  /** No one new may join. */
  readonly locked: boolean;
  readonly ended: boolean;
}

const BLANK: Run = { phase: 'idle', opensAt: 0, openedAt: 0, closesAt: 0, responses: {}, questions: [], ideas: [], stage: 'collect', hints: 0, winner: '', spins: 0, spunAt: 0 };
/** How long the spinner wheel turns before it rests: devices keep the name to themselves until then. */
export const SPIN_MS = 4200;
export const MAX_PLAYERS = 300;

export const createSession = (deck: Deck, code: string): Session => ({ deck, code, index: -1, runs: deck.slides.map(() => BLANK), players: [], chat: [], locked: false, ended: false });

/** A code people can read out and type: no letters or digits that look alike. */
export function makeCode(random: () => number = Math.random): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => letters[Math.floor(random() * letters.length)]).join('');
}

const slideAt = (session: Session, index: number): Slide | undefined => session.deck.slides[index];
const withRun = (session: Session, index: number, change: (run: Run) => Run): Session => {
  const run = session.runs[index];
  if (!run) return session;
  const next = change(run);
  return next === run ? session : { ...session, runs: session.runs.map((r, i) => (i === index ? next : r)) };
};
const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/* ------------------------------------------------------ people -- */

export function join(session: Session, who: { id: string; name?: unknown; avatar?: unknown; team?: unknown }, now: number): { session: Session; error?: string } {
  if (session.players.some((p) => p.id === who.id)) return { session };
  if (session.locked || session.ended) return { session, error: 'This quiz is closed to new players.' };
  if (session.players.length >= MAX_PLAYERS) return { session, error: 'This quiz is full.' };
  const { settings } = session.deck;
  let name = starred(clean(who.name, 24), settings.hidden).replace(/\*+/g, '').trim() || `Player ${session.players.length + 1}`;
  const taken = new Set(session.players.map((p) => p.name.toLowerCase()));
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${name.replace(/ \d+$/, '')} ${n}`;
  const avatar =
    settings.avatars && typeof who.avatar === 'string' && (AVATARS as readonly string[]).includes(who.avatar)
      ? who.avatar
      : settings.avatars
        ? (AVATARS[session.players.length % AVATARS.length] as string)
        : '';
  let team = -1;
  if (settings.teams) {
    const sizes = settings.teamNames.map((_, i) => session.players.filter((p) => p.team === i).length);
    // The chosen team, or the smallest when none was chosen.
    team = typeof who.team === 'number' && Number.isInteger(who.team) && who.team >= 0 && who.team < sizes.length ? who.team : sizes.indexOf(Math.min(...sizes));
  }
  return { session: { ...session, players: [...session.players, { id: who.id, name, avatar, team, bonus: 0, at: 0, opened: now }] } };
}

export function kick(session: Session, id: string): Session {
  if (!session.players.some((p) => p.id === id)) return session;
  return {
    ...session,
    players: session.players.filter((p) => p.id !== id),
    runs: session.runs.map((run) => {
      const { [id]: _gone, ...responses } = run.responses;
      return { ...run, responses, questions: run.questions.filter((q) => q.by !== id), ideas: run.ideas.filter((i) => i.by !== id) };
    }),
  };
}

export const lock = (session: Session, locked: boolean): Session => (session.locked === locked ? session : { ...session, locked });
export const award = (session: Session, id: string, points: number): Session => ({
  ...session,
  players: session.players.map((p) => (p.id === id ? { ...p, bonus: Math.max(-100000, Math.min(100000, p.bonus + Math.round(points))) } : p)),
});
/** Clears every answer and score; the players stay. */
export const reset = (session: Session, now: number): Session => ({
  ...session,
  index: -1,
  ended: false,
  runs: session.deck.slides.map(() => BLANK),
  chat: [],
  players: session.players.map((p) => ({ ...p, bonus: 0, at: 0, opened: now })),
});
export const end = (session: Session): Session => (session.ended ? session : { ...session, ended: true });

/* ----------------------------------------------------- slides -- */

const opened = (run: Run, slide: Slide, at: number): Run => ({ ...run, phase: 'open', openedAt: at, closesAt: slide.seconds > 0 ? at + slide.seconds * 1000 : 0 });
const closed = (session: Session, run: Run, slide: Slide): Run => ({ ...run, phase: isQuiz(slide.type) && !session.deck.settings.manualReveal ? 'revealed' : 'closed' });

/** Shows a slide.  A question that has not been asked yet starts: a countdown first for quiz questions, when the deck has one. */
export function goTo(session: Session, index: number, now: number): Session {
  const to = Math.min(Math.max(Math.round(index), -1), session.deck.slides.length - 1);
  const slide = slideAt(session, to);
  let next: Session = { ...session, index: to, locked: session.locked };
  if (!slide || session.deck.settings.selfPaced) return next;
  next = withRun(next, to, (run) => {
    if (run.phase !== 'idle' || !isAnswered(slide.type)) return run;
    const wait = isQuiz(slide.type) ? session.deck.settings.countdown : 0;
    return wait > 0 ? { ...run, phase: 'countdown', opensAt: now + wait * 1000 } : opened(run, slide, now);
  });
  return next;
}

/** Lets time pass: countdowns open, time limits close, and a quiz question closes early once everyone has answered. */
export function tick(session: Session, now: number): Session {
  const slide = slideAt(session, session.index);
  if (!slide || session.deck.settings.selfPaced) return session;
  return withRun(session, session.index, (run) => {
    if (run.phase === 'countdown' && now >= run.opensAt) return tickOpen(session, opened(run, slide, run.opensAt), slide, now);
    return tickOpen(session, run, slide, now);
  });
}

function tickOpen(session: Session, run: Run, slide: Slide, now: number): Run {
  if (run.phase !== 'open') return run;
  const everyone = isQuiz(slide.type) && session.players.length > 0 && session.players.every((p) => run.responses[p.id]);
  return (run.closesAt > 0 && now >= run.closesAt) || everyone ? closed(session, run, slide) : run;
}

/** The presenter ends the question now. */
export function close(session: Session): Session {
  const slide = slideAt(session, session.index);
  return slide ? withRun(session, session.index, (run) => (run.phase === 'open' || run.phase === 'countdown' ? closed(session, run, slide) : run)) : session;
}

/** The presenter shows the right answers (and with them, the points). */
export const reveal = (session: Session): Session => withRun(session, session.index, (run) => (run.phase === 'closed' || run.phase === 'open' ? { ...run, phase: 'revealed' } : run));
export const showHint = (session: Session): Session =>
  withRun(session, session.index, (run) => (run.hints < (slideAt(session, session.index)?.hints.length ?? 0) ? { ...run, hints: run.hints + 1 } : run));
export const setStage = (session: Session, stage: Run['stage']): Session => withRun(session, session.index, (run) => (run.stage === stage ? run : { ...run, stage }));
export const markAnswered = (session: Session, id: string): Session =>
  withRun(session, session.index, (run) => ({ ...run, questions: run.questions.map((q) => (q.id === id ? { ...q, answered: !q.answered } : q)) }));

/** What the wheel can stop on. */
export const wheelEntries = (session: Session, slide: Slide): string[] => (slide.useNames ? session.players.map((p) => p.name) : slide.wheel.filter((entry) => entry.trim()));

export function spin(session: Session, random: () => number = Math.random, now = 0): Session {
  const slide = slideAt(session, session.index);
  if (slide?.type !== 'wheel') return session;
  const entries = wheelEntries(session, slide);
  if (entries.length === 0) return session;
  return withRun(session, session.index, (run) => ({ ...run, winner: entries[Math.floor(random() * entries.length)] ?? '', spins: run.spins + 1, spunAt: now }));
}

/** Clears what was answered on the slide showing, and asks it again. */
export const askAgain = (session: Session, now: number): Session =>
  goTo(
    withRun(session, session.index, () => BLANK),
    session.index,
    now,
  );

/** The slide showing is left: a question still open is closed, and a quiz question's answers count from here on. */
function leave(session: Session): Session {
  const slide = slideAt(session, session.index);
  if (!slide) return session;
  const closedNow = close(session);
  return isQuiz(slide.type) ? withRun(closedNow, closedNow.index, (run) => (run.phase === 'closed' ? { ...run, phase: 'revealed' } : run)) : closedNow;
}

/** To another slide (or back to the lobby, -1), leaving the one showing in order. */
export const moveTo = (session: Session, index: number, now: number): Session => goTo(leave(session), index, now);

export type Step = 'start' | 'close' | 'reveal' | 'spin' | 'vote' | 'results' | 'next' | 'finish' | 'none';

/** The natural next thing for the presenter to do: what the one big button, and the keys, stand for. */
export function nextStep(session: Session): Step {
  if (session.ended) return 'none';
  if (session.deck.settings.selfPaced) return 'finish';
  if (session.index < 0) return session.deck.slides.length > 0 ? 'start' : 'none';
  const slide = slideAt(session, session.index);
  const run = session.runs[session.index];
  if (!slide || !run) return 'none';
  if (isQuiz(slide.type) && (run.phase === 'countdown' || run.phase === 'open')) return 'close';
  // Results kept off the big screen are shown by ending the answering.
  if (slide.hide && run.phase === 'open') return 'close';
  if (isQuiz(slide.type) && run.phase === 'closed') return 'reveal';
  if (slide.type === 'wheel' && run.spins === 0 && wheelEntries(session, slide).length > 0) return 'spin';
  if (slide.type === 'brainstorm' && run.stage === 'collect') return 'vote';
  if (slide.type === 'brainstorm' && run.stage === 'vote') return 'results';
  return session.index >= session.deck.slides.length - 1 ? 'finish' : 'next';
}

export function takeStep(session: Session, now: number, random: () => number = Math.random): Session {
  switch (nextStep(session)) {
    case 'start':
      return goTo(session, 0, now);
    case 'close':
      return close(session);
    case 'reveal':
      return reveal(session);
    case 'spin':
      return spin(session, random, now);
    case 'vote':
      return setStage(session, 'vote');
    case 'results':
      return setStage(session, 'results');
    case 'next':
      return moveTo(session, session.index + 1, now);
    case 'finish':
      return end(leave(session));
    default:
      return session;
  }
}

/* ---------------------------------------------------- answers -- */

/** A message from a player's device.  Anything that does not fit the moment is ignored. */
export function handle(session: Session, from: string, message: unknown, now: number): Session {
  if (!message || typeof message !== 'object' || session.ended) return session;
  const m = message as Record<string, unknown>;
  const player = session.players.find((p) => p.id === from);
  if (!player) return session;
  const selfPaced = session.deck.settings.selfPaced;
  const index = selfPaced ? player.at : session.index;
  const slide = slideAt(session, index);
  const { hidden } = session.deck.settings;
  switch (m.kind) {
    case 'answer': {
      if (!slide) return session;
      return withRun(session, index, (run) => {
        if (run.responses[from] || (!selfPaced && run.phase !== 'open')) return run;
        const answer = readAnswer(slide, m.answer);
        if (answer === null) return run;
        const ms = Math.max(0, now - (selfPaced ? player.opened : run.openedAt));
        // A self-paced answer after the time is up counts as given, and earns nothing.
        const late = selfPaced && slide.seconds > 0 && ms > slide.seconds * 1000 + 1500;
        const fraction = isQuiz(slide.type) && !late ? fractionRight(slide, answer) : 0;
        return { ...run, responses: { ...run.responses, [from]: { answer, ms, fraction, points: pointsFor(slide, fraction, ms) } } };
      });
    }
    case 'next': {
      if (!selfPaced || player.at >= session.deck.slides.length) return session;
      let at = player.at + 1;
      // Slides that need a presenter are passed over.
      while (at < session.deck.slides.length && ['qa', 'brainstorm', 'wheel', 'leaderboard'].includes(session.deck.slides[at]?.type ?? '')) at++;
      return { ...session, players: session.players.map((p) => (p.id === from ? { ...p, at, opened: now } : p)) };
    }
    case 'ask': {
      const said = clean(m.text, 300);
      if (slide?.type !== 'qa' || !said) return session;
      return withRun(session, index, (run) =>
        run.questions.filter((q) => q.by === from).length >= 20
          ? run
          : { ...run, questions: [...run.questions, { id: newId('q'), by: from, text: starred(said, hidden), votes: [], answered: false }] },
      );
    }
    case 'upvote':
      if (slide?.type !== 'qa') return session;
      return withRun(session, index, (run) => {
        const wanted = run.questions.find((q) => q.id === m.id);
        // Nobody votes for their own question.
        if (!wanted || wanted.by === from) return run;
        return { ...run, questions: run.questions.map((q) => (q === wanted ? { ...q, votes: q.votes.includes(from) ? q.votes.filter((v) => v !== from) : [...q.votes, from] } : q)) };
      });
    case 'idea': {
      const said = clean(m.text, 200);
      if (slide?.type !== 'brainstorm' || !said) return session;
      return withRun(session, index, (run) =>
        run.stage !== 'collect' || run.ideas.filter((i) => i.by === from).length >= 10 ? run : { ...run, ideas: [...run.ideas, { id: newId('i'), by: from, text: starred(said, hidden), votes: [] }] },
      );
    }
    case 'vote':
      if (slide?.type !== 'brainstorm') return session;
      return withRun(session, index, (run) => {
        const wanted = run.ideas.find((i) => i.id === m.id);
        if (run.stage !== 'vote' || !wanted) return run;
        const voted = wanted.votes.includes(from);
        // A vote can be taken back; a new one needs a vote to spare.
        if (!voted && run.ideas.filter((i) => i.votes.includes(from)).length >= slide.entries) return run;
        return { ...run, ideas: run.ideas.map((i) => (i === wanted ? { ...i, votes: voted ? i.votes.filter((v) => v !== from) : [...i.votes, from] } : i)) };
      });
    case 'chat': {
      const said = clean(m.text, 200);
      if (!session.deck.settings.chat || session.index !== -1 || !said) return session;
      return { ...session, chat: [...session.chat.slice(-49), { name: player.name, text: starred(said, hidden) }] };
    }
    default:
      return session;
  }
}

/* ----------------------------------------------------- scores -- */

export interface Standing {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly team: number;
  readonly score: number;
  /** Right answers in a row, up to the last question shown. */
  readonly streak: number;
  readonly right: number;
  readonly answered: number;
  /** 1 for the leader; players level on points share a place. */
  readonly rank: number;
}

/** Which questions count: those whose answers have been shown (all that a self-paced player has answered). */
const counted = (session: Session, run: Run, slide: Slide, id: string): boolean => isQuiz(slide.type) && (session.deck.settings.selfPaced ? !!run.responses[id] : run.phase === 'revealed');

export function standings(session: Session): Standing[] {
  const rows = session.players.map((p) => {
    let score = p.bonus;
    let streak = 0;
    let right = 0;
    let answered = 0;
    session.deck.slides.forEach((slide, i) => {
      const run = session.runs[i];
      if (!run || !counted(session, run, slide, p.id)) return;
      const response = run.responses[p.id];
      if (response) {
        answered += 1;
        score += response.points;
      }
      if (response?.fraction === 1) {
        right += 1;
        streak += 1;
      } else streak = 0;
    });
    return { id: p.id, name: p.name, avatar: p.avatar, team: p.team, score, streak, right, answered, rank: 0 };
  });
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows.map((row) => ({ ...row, rank: 1 + rows.findIndex((other) => other.score === row.score) }));
}

export interface TeamStanding {
  readonly name: string;
  readonly score: number;
  readonly members: number;
  readonly rank: number;
}

export function teamStandings(session: Session): TeamStanding[] {
  const { settings } = session.deck;
  if (!settings.teams) return [];
  const rows = standings(session);
  const teams = settings.teamNames.map((name, team) => {
    const scores = rows.filter((r) => r.team === team).map((r) => r.score);
    const total = scores.reduce((sum, s) => sum + s, 0);
    const score = scores.length === 0 ? 0 : settings.teamRule === 'total' ? total : settings.teamRule === 'best' ? Math.max(...scores) : Math.round(total / scores.length);
    return { name, score, members: scores.length, rank: 0 };
  });
  teams.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return teams.map((team) => ({ ...team, rank: 1 + teams.findIndex((other) => other.score === team.score) }));
}

/* ------------------------------------------------- the device's view -- */

/**
 * Everything a device needs to draw its screen.  `id` is null for a device that has not joined yet.
 * Times are given as moments on the presenter's clock (`endsAt`), not as time left, so that a view
 * stays the same until something happens; `rows` are the standings, when the caller has them already.
 */
export function guestView(session: Session, id: string | null, rows: readonly Standing[] = standings(session)): Record<string, unknown> {
  const { deck } = session;
  const { settings } = deck;
  const player = id ? session.players.find((p) => p.id === id) : undefined;
  const base: Record<string, unknown> = {
    code: session.code,
    title: deck.title,
    teams: settings.teams ? settings.teamNames : [],
    avatars: settings.avatars,
    chat: settings.chat,
    locked: session.locked,
    full: session.players.length >= MAX_PLAYERS,
    joined: !!player,
    players: session.players.length,
    total: deck.slides.length,
    selfPaced: settings.selfPaced,
  };
  if (!player) return { ...base, phase: session.ended ? 'ended' : 'join' };
  const mine = rows.find((r) => r.id === player.id);
  // A place means something once a question has counted (or points were given by hand).
  const placed = rows.some((r) => r.answered > 0 || r.score !== 0);
  const you = {
    name: player.name,
    avatar: player.avatar,
    team: settings.teams ? (settings.teamNames[player.team] ?? '') : '',
    score: mine?.score ?? 0,
    rank: placed ? (mine?.rank ?? 0) : 0,
    streak: mine?.streak ?? 0,
  };
  const board = () => ({ board: rows.slice(0, 5).map((r) => ({ name: r.name, avatar: r.avatar, score: r.score, rank: r.rank, you: r.id === player.id })), teamBoard: teamStandings(session) });
  const index = settings.selfPaced ? player.at : session.index;
  const slide = slideAt(session, index);
  const run = session.runs[index];
  if (session.ended || (settings.selfPaced && index >= deck.slides.length)) return { ...base, you, phase: 'ended', ...board() };
  if (!slide || !run) return { ...base, you, phase: 'lobby', messages: settings.chat ? session.chat.slice(-30) : [] };
  const response = run.responses[player.id];
  const phase = settings.selfPaced ? (isAnswered(slide.type) ? (response ? 'revealed' : 'open') : 'idle') : run.phase;
  const view: Record<string, unknown> = {
    ...base,
    you,
    phase,
    index,
    slide: guestSlide(slide, player.id, settings.shuffle),
    endsAt: settings.selfPaced ? (slide.seconds > 0 && !response ? player.opened + slide.seconds * 1000 : 0) : run.phase === 'countdown' ? run.opensAt : run.phase === 'open' ? run.closesAt : 0,
    answered: !!response,
    yours: response?.answer ?? null,
    hints: slide.hints.slice(0, run.hints),
  };
  if (isQuiz(slide.type) && phase === 'revealed') {
    view.result = {
      fraction: response?.fraction ?? 0,
      points: response?.points ?? 0,
      right: rightAnswer(slide),
      // Which options were right, by their number in the deck.
      correct: slide.type === 'pick' ? slide.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0) : [],
    };
  }
  if (slide.type === 'qa') {
    view.questions = [...run.questions]
      .sort((a, b) => Number(a.answered) - Number(b.answered) || b.votes.length - a.votes.length)
      .map((q) => ({ id: q.id, text: q.text, votes: q.votes.length, voted: q.votes.includes(player.id), mine: q.by === player.id, answered: q.answered }));
  }
  if (slide.type === 'brainstorm') {
    view.stage = run.stage;
    view.votesLeft = Math.max(0, slide.entries - run.ideas.filter((i) => i.votes.includes(player.id)).length);
    view.ideas = (run.stage === 'results' ? [...run.ideas].sort((a, b) => b.votes.length - a.votes.length) : run.ideas).map((i) => ({
      id: i.id,
      text: i.text,
      votes: run.stage === 'collect' ? 0 : i.votes.length,
      voted: i.votes.includes(player.id),
      mine: i.by === player.id,
    }));
  }
  if (slide.type === 'wheel') {
    view.winner = run.winner;
    // The moment the wheel on the big screen comes to rest.
    view.winnerAt = run.spunAt + SPIN_MS;
  }
  if (slide.type === 'leaderboard') Object.assign(view, board());
  return view;
}

/* ----------------------------------------------------- report -- */

const csvCell = (value: string | number): string => {
  const cell = String(value);
  // A cell that a spreadsheet would run as a formula is made plain text.
  const safe = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The session as a table: a row for every player, with their place, their score and what they answered to each slide. */
export function reportCsv(session: Session, answerText: (slide: Slide, answer: unknown) => string): string {
  const asked = session.deck.slides.map((slide, i) => ({ slide, run: session.runs[i] as Run })).filter(({ slide }) => isAnswered(slide.type) && slide.type !== 'qa' && slide.type !== 'brainstorm');
  const teams = session.deck.settings.teams;
  const head = ['Place', 'Name', ...(teams ? ['Team'] : []), 'Score', 'Right', 'Answered', ...asked.flatMap(({ slide }) => (isQuiz(slide.type) ? [slide.title, 'Points', 'Seconds'] : [slide.title]))];
  const rows = standings(session).map((row) => [
    row.rank,
    row.name,
    ...(teams ? [session.deck.settings.teamNames[row.team] ?? ''] : []),
    row.score,
    row.right,
    row.answered,
    ...asked.flatMap(({ slide, run }) => {
      const response = run.responses[row.id];
      const said = response ? answerText(slide, response.answer) : '';
      return isQuiz(slide.type) ? [said, response ? response.points : '', response ? Math.round(response.ms / 100) / 10 : ''] : [said];
    }),
  ]);
  return `${[head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** The whole session as data, for keeping: the standings, and for every slide who answered what. */
export function reportData(session: Session, answerText: (slide: Slide, answer: unknown) => string): Record<string, unknown> {
  const { deck } = session;
  const names = new Map(session.players.map((p) => [p.id, p.name]));
  const team = (index: number) => (deck.settings.teams ? (deck.settings.teamNames[index] ?? '') : undefined);
  return {
    kind: 'benchtop-quiz-results',
    version: 1,
    title: deck.title,
    code: session.code,
    ended: session.ended,
    players: standings(session).map((row) => ({ place: row.rank, name: row.name, team: team(row.team), score: row.score, right: row.right, answered: row.answered })),
    teams: teamStandings(session),
    slides: deck.slides.map((slide, i) => {
      const run = session.runs[i] ?? BLANK;
      return {
        number: i + 1,
        type: slide.type,
        title: slide.title,
        ...(isQuiz(slide.type) ? { rightAnswer: rightAnswer(slide) } : {}),
        answers: Object.entries(run.responses).map(([id, response]) => ({
          name: names.get(id) ?? '',
          answer: answerText(slide, response.answer),
          seconds: Math.round(response.ms / 100) / 10,
          ...(isQuiz(slide.type) ? { share: response.fraction, points: response.points } : {}),
        })),
        ...(slide.type === 'qa' ? { questions: run.questions.map((q) => ({ text: q.text, by: names.get(q.by) ?? '', votes: q.votes.length, answered: q.answered })) } : {}),
        ...(slide.type === 'brainstorm' ? { ideas: run.ideas.map((idea) => ({ text: idea.text, by: names.get(idea.by) ?? '', votes: idea.votes.length })) } : {}),
        ...(slide.type === 'wheel' && run.winner ? { winner: run.winner } : {}),
      };
    }),
  };
}
