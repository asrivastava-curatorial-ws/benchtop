import { describe, expect, it } from 'vitest';
import {
  answerText,
  DEFAULT_SETTINGS,
  type Deck,
  deckFile,
  fractionRight,
  guestSlide,
  importQuestions,
  newSlide,
  plain,
  pointsFor,
  problems,
  readAnswer,
  readDeck,
  readDeckFile,
  readSlide,
  rightAnswer,
  sampleDeck,
  starred,
  tally,
} from '../../src/lib/quiz';
import {
  askAgain,
  award,
  close,
  createSession,
  end,
  goTo,
  guestView,
  handle,
  join,
  kick,
  lock,
  makeCode,
  markAnswered,
  moveTo,
  nextStep,
  reportCsv,
  reportData,
  reset,
  reveal,
  type Session,
  setStage,
  showHint,
  spin,
  standings,
  takeStep,
  teamStandings,
  tick,
} from '../../src/lib/quiz-session';

const pick = newSlide('pick', { id: 'p1', title: 'Shortest day?', seconds: 20, options: [{ text: 'Earth' }, { text: 'Jupiter', correct: true }, { text: 'Mars' }] });
const multi = newSlide('pick', { id: 'p2', title: 'Which are gases?', seconds: 10, partial: true, options: [{ text: 'Neon', correct: true }, { text: 'Iron' }, { text: 'Argon', correct: true }] });
const typed = newSlide('type', { id: 't1', title: 'Plants breathe in?', seconds: 30, accepted: ['carbon dioxide', 'CO2'] });
const match = newSlide('match', {
  id: 'm1',
  title: 'Match',
  partial: true,
  pairs: [
    { left: 'Raman', right: 'Light' },
    { left: 'Curie', right: 'Radioactivity' },
    { left: 'Newton', right: 'Motion' },
  ],
});
const order = newSlide('order', { id: 'o1', title: 'Order', items: ['Atom', 'Cell', 'Ant'] });
const sort = newSlide('categorise', {
  id: 'c1',
  title: 'Sort',
  partial: true,
  categories: [
    { name: 'Conductor', items: ['Copper', 'Salt water'] },
    { name: 'Insulator', items: ['Rubber', 'Glass'] },
  ],
});
const poll = newSlide('poll', { id: 'v1', title: 'Favourite?', options: [{ text: 'Engines' }, { text: 'Space' }, { text: 'Dinosaurs' }] });

const deck = (slides = [pick, typed], settings: Partial<Deck['settings']> = {}): Deck => readDeck({ title: 'Test', slides, settings: { ...DEFAULT_SETTINGS, countdown: 0, ...settings } });
const started = (d: Deck, names = ['Asha', 'Ben', 'Chitra']): Session => names.reduce((s, name, i) => join(s, { id: `u${i + 1}`, name }, 0).session, createSession(d, 'ABC234'));

describe('quiz slides and answers', () => {
  it('checks decks read from files, and says what a slide still needs', () => {
    expect(readSlide({ type: 'video' })).toBeNull();
    const odd = readSlide({
      type: 'pick',
      seconds: 2,
      points: { max: 5000, min: 9000 },
      options: [{ text: 'a', correct: true, image: 'https://example.org/x.png' }, 'junk', { text: 7 }],
      hints: ['1', '2', '3', '4'],
    });
    expect(odd).toMatchObject({ seconds: 5, points: { max: 1000, min: 1000, speed: true }, hints: ['1', '2', '3'] });
    expect(odd?.options).toEqual([{ text: 'a', correct: true }, { text: '' }]);
    expect(readSlide({ type: 'poll' })?.seconds).toBe(0);
    expect(problems(pick)).toEqual([]);
    expect(problems(newSlide('pick', { title: '', options: [{ text: 'only' }] }))).toEqual(['Write the question or heading.', 'Give at least two answers.', 'Mark the right answer.']);
    expect(problems(newSlide('wheel', { useNames: false, wheel: ['one'] }))[0]).toContain('at least two entries');
    for (const slide of sampleDeck().slides) expect(problems(slide), slide.title).toEqual([]);
    const again = readDeckFile(deckFile(sampleDeck()));
    expect(again.slides.map((s) => s.type)).toEqual(sampleDeck().slides.map((s) => s.type));
    expect(() => readDeckFile('not json')).toThrow(/not JSON/);
    expect(() => readDeckFile('{"title":"x"}')).toThrow(/no slides/);
  });

  it('hands devices a slide without its answers, shuffled the same way every time for one person', () => {
    const forAsha = guestSlide(pick, 'u1', true);
    expect(JSON.stringify(forAsha)).not.toContain('correct');
    expect((forAsha.options as { i: number }[]).map((o) => o.i).sort()).toEqual([0, 1, 2]);
    expect(guestSlide(pick, 'u1', true)).toEqual(forAsha);
    expect((guestSlide(pick, 'u1', false).options as { i: number }[]).map((o) => o.i)).toEqual([0, 1, 2]);
    expect(guestSlide(multi, 'u1', false).many).toBe(true);
    const rights = guestSlide(match, 'u1', false).rights as { i: number; text: string }[];
    expect(rights.map((r) => r.i).sort()).toEqual([0, 1, 2]);
    expect(guestSlide(match, 'u1', false).lefts).toEqual(['Raman', 'Curie', 'Newton']);
    expect(JSON.stringify(guestSlide(typed, 'u1', false))).not.toContain('carbon');
    const items = guestSlide(sort, 'u1', false).items as { i: number; text: string }[];
    expect(items).toHaveLength(4);
    expect(guestSlide(sort, 'u1', false).categories).toEqual(['Conductor', 'Insulator']);
    // Shuffles differ between people (for at least one of a few).
    const orders = ['u1', 'u2', 'u3', 'u4'].map((id) => JSON.stringify(guestSlide(order, id, false).items));
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it('accepts only answers that fit the slide', () => {
    expect(readAnswer(pick, [1])).toEqual([1]);
    expect(readAnswer(pick, [0, 1])).toBeNull();
    expect(readAnswer(pick, [7])).toBeNull();
    expect(readAnswer(pick, 'Jupiter')).toBeNull();
    expect(readAnswer(multi, [2, 0, 2])).toEqual([0, 2]);
    expect(readAnswer(typed, '  CO2 ')).toBe('CO2');
    expect(readAnswer(typed, '   ')).toBeNull();
    expect(readAnswer(match, [2, 1, 0])).toEqual([2, 1, 0]);
    expect(readAnswer(match, [0, 0, 1])).toBeNull();
    expect(readAnswer(order, [0, 1])).toBeNull();
    expect(readAnswer(sort, [0, 1, 1, 0])).toEqual([0, 1, 1, 0]);
    expect(readAnswer(sort, [0, 1, 2, 0])).toBeNull();
    expect(readAnswer(newSlide('cloud', { entries: 2 }), [' fun ', '', 'loud   and   bright', 'extra'])).toEqual(['fun', 'loud and bright']);
    expect(readAnswer(newSlide('scale', { statements: ['a', 'b'], low: 1, high: 5 }), [5, 1])).toEqual([5, 1]);
    expect(readAnswer(newSlide('scale', { statements: ['a', 'b'], low: 1, high: 5 }), [6, 1])).toBeNull();
    expect(readAnswer(newSlide('content'), 'anything')).toBeNull();
  });

  it('marks answers: whole, part and none', () => {
    expect(fractionRight(pick, [1])).toBe(1);
    expect(fractionRight(pick, [0])).toBe(0);
    // Part marks: half for one of two right answers, nothing once a wrong one is chosen.
    expect(fractionRight(multi, [0])).toBe(0.5);
    expect(fractionRight(multi, [0, 2])).toBe(1);
    expect(fractionRight(multi, [0, 1])).toBe(0);
    expect(fractionRight({ ...multi, partial: false }, [0])).toBe(0);
    expect(fractionRight(typed, 'Carbon   Dioxide')).toBe(1);
    expect(fractionRight(typed, 'co2')).toBe(1);
    expect(fractionRight(typed, 'oxygen')).toBe(0);
    expect(plain('  Café  CRÈME ')).toBe('cafe creme');
    expect(fractionRight(match, [0, 1, 2])).toBe(1);
    expect(fractionRight(match, [1, 0, 2])).toBeCloseTo(1 / 3);
    expect(fractionRight({ ...match, partial: false }, [1, 0, 2])).toBe(0);
    expect(fractionRight(order, [0, 1, 2])).toBe(1);
    expect(fractionRight(order, [0, 2, 1])).toBe(0);
    expect(fractionRight(sort, [0, 0, 1, 1])).toBe(1);
    expect(fractionRight(sort, [0, 1, 1, 1])).toBe(0.75);
  });

  it('gives more points for faster answers, between the least and the most', () => {
    expect(pointsFor(pick, 1, 0)).toBe(100);
    expect(pointsFor(pick, 1, 4000)).toBe(80);
    expect(pointsFor(pick, 1, 20000)).toBe(0);
    expect(pointsFor(pick, 1, 99999)).toBe(0);
    expect(pointsFor(pick, 0, 0)).toBe(0);
    const floor = { ...pick, points: { max: 100, min: 40, speed: true } };
    expect(pointsFor(floor, 1, 10000)).toBe(70);
    expect(pointsFor({ ...pick, points: { max: 100, min: 0, speed: false } }, 1, 19000)).toBe(100);
    expect(pointsFor(multi, 0.5, 0)).toBe(50);
  });

  it('counts responses for the big screen', () => {
    expect(tally(pick, [[1], [1], [0]])).toMatchObject({ answered: 3, counts: [1, 2, 0], right: 2 });
    expect(tally(poll, [[0], [2], [2]]).counts).toEqual([1, 0, 2]);
    const typedTally = tally(typed, ['CO2', 'co2', 'oxygen', 'Carbon dioxide']);
    expect(typedTally.words).toEqual([
      { text: 'CO2', count: 2, right: true },
      { text: 'Carbon dioxide', count: 1, right: true },
      { text: 'oxygen', count: 1, right: false },
    ]);
    expect(typedTally.right).toBe(3);
    const cloud = tally(newSlide('cloud'), [['Fun', 'loud'], ['fun'], ['FUN', 'damn']], ['damn']);
    expect(cloud.words).toEqual([
      { text: 'Fun', count: 3 },
      { text: '****', count: 1 },
      { text: 'loud', count: 1 },
    ]);
    expect(tally(newSlide('open'), ['first', 'second']).texts).toEqual(['second', 'first']);
    expect(
      tally(newSlide('scale', { statements: ['a', 'b'] }), [
        [5, 1],
        [3, 2],
      ]).means,
    ).toEqual([4, 1.5]);
    // Ranking: first place of three counts 3, second 2, third 1.
    expect(
      tally(newSlide('ranking', { options: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }), [
        [2, 0, 1],
        [2, 1, 0],
      ]).counts,
    ).toEqual([3, 3, 6]);
    expect(
      tally(match, [
        [0, 1, 2],
        [1, 0, 2],
      ]).meanShare,
    ).toBeCloseTo(2 / 3);
    expect(starred('What the heck, Heckmondwike?', ['heck'])).toBe('What the ****, Heckmondwike?');
  });

  it('puts answers into words', () => {
    expect(rightAnswer(pick)).toBe('Jupiter');
    expect(rightAnswer(typed)).toBe('carbon dioxide');
    expect(rightAnswer(order)).toBe('Atom → Cell → Ant');
    expect(answerText(pick, [0])).toBe('Earth');
    expect(answerText(match, [1, 0, 2])).toBe('Raman → Radioactivity; Curie → Light; Newton → Motion');
    expect(answerText(sort, [0, 1, 1, 1])).toBe('Copper: Conductor; Salt water: Insulator; Rubber: Insulator; Glass: Insulator');
    expect(answerText(typed, null)).toBe('');
  });

  it('imports questions from a table', () => {
    const made = importQuestions(
      'Question,A,B,C,Right\n"Largest planet?",Mars,"Jupiter, of course",Venus,2\nGases?;Neon;Iron;Argon;A C\nSound is faster in water;true\nCapital of India?\tNew Delhi|Delhi\nNo key here,first,second\n\n,orphan',
    );
    expect(made.map((s) => s.type)).toEqual(['pick', 'pick', 'pick', 'type', 'pick']);
    expect(made[0]?.options).toEqual([{ text: 'Mars' }, { text: 'Jupiter, of course', correct: true }, { text: 'Venus' }]);
    expect(made[1]?.options.map((o) => !!o.correct)).toEqual([true, false, true]);
    expect(made[2]?.options).toEqual([{ text: 'True', correct: true }, { text: 'False' }]);
    expect(made[3]?.accepted).toEqual(['New Delhi', 'Delhi']);
    expect(made[4]?.options).toEqual([{ text: 'first', correct: true }, { text: 'second' }]);
  });
});

describe('a quiz session', () => {
  it('lets people join with their own names, teams and avatars', () => {
    let s = createSession(
      deck([pick], { teams: true, teamNames: ['Comets', 'Rockets'], hidden: ['darn'] }),
      makeCode(() => 0),
    );
    expect(s.code).toBe('AAAAAA');
    s = join(s, { id: 'a', name: '  Asha   Rao ', avatar: '🦊', team: 1 }, 0).session;
    s = join(s, { id: 'b', name: 'asha rao' }, 0).session;
    s = join(s, { id: 'c', name: '' }, 0).session;
    s = join(s, { id: 'd', name: 'darn', avatar: 'x' }, 0).session;
    expect(s.players.map((p) => [p.name, p.team])).toEqual([
      ['Asha Rao', 1],
      ['asha rao 2', 0],
      ['Player 3', 0],
      ['Player 4', 1],
    ]);
    expect(s.players[0]?.avatar).toBe('🦊');
    expect(s.players[3]?.avatar).not.toBe('x');
    // Joining twice changes nothing; a locked quiz takes no one new.
    expect(join(s, { id: 'a', name: 'Other' }, 0).session).toBe(s);
    const refused = join(lock(s, true), { id: 'e', name: 'Late' }, 0);
    expect(refused.error).toMatch(/closed/);
    expect(refused.session.players).toHaveLength(4);
    expect(guestView(s, null)).toMatchObject({ phase: 'join', joined: false, teams: ['Comets', 'Rockets'], avatars: true, players: 4 });
    expect(kick(s, 'b').players.map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });

  it('runs a question: countdown, answers, time up, and points only once answers are shown', () => {
    let s = started(deck([pick, typed], { countdown: 3 }));
    expect(guestView(s, 'u1').phase).toBe('lobby');
    s = goTo(s, 0, 1000);
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'countdown', endsAt: 4000, index: 0 });
    // Nothing is taken before the question opens.
    expect(handle(s, 'u1', { kind: 'answer', answer: [1] }, 2000)).toBe(s);
    s = tick(s, 4000);
    expect(s.runs[0]).toMatchObject({ phase: 'open', openedAt: 4000, closesAt: 24000 });
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'open', endsAt: 24000, answered: false });
    s = handle(s, 'u1', { kind: 'answer', answer: [1] }, 8000);
    s = handle(s, 'u2', { kind: 'answer', answer: [0] }, 9000);
    // The first answer stands, and junk is ignored.
    expect(handle(s, 'u1', { kind: 'answer', answer: [0] }, 9500)).toBe(s);
    expect(handle(s, 'u3', { kind: 'answer', answer: [9] }, 9500)).toBe(s);
    expect(handle(s, 'nobody', { kind: 'answer', answer: [1] }, 9500)).toBe(s);
    expect(s.runs[0]?.responses.u1).toEqual({ answer: [1], ms: 4000, fraction: 1, points: 80 });
    // While the question is open nobody's view says who is right, and no points show.
    const waiting = guestView(s, 'u1');
    expect(waiting).toMatchObject({ answered: true, yours: [1], you: { score: 0 } });
    expect(waiting.result).toBeUndefined();
    expect(tick(s, 10000)).toBe(s);
    s = tick(s, 24000);
    expect(s.runs[0]?.phase).toBe('revealed');
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'revealed', result: { fraction: 1, points: 80, right: 'Jupiter', correct: [1] }, you: { score: 80, rank: 1, streak: 1 } });
    expect(guestView(s, 'u2')).toMatchObject({ result: { fraction: 0, points: 0 }, you: { score: 0, rank: 2, streak: 0 } });
    expect(guestView(s, 'u3')).toMatchObject({ answered: false, you: { rank: 2 } });
    expect(standings(s).map((r) => [r.name, r.score, r.rank])).toEqual([
      ['Asha', 80, 1],
      ['Ben', 0, 2],
      ['Chitra', 0, 2],
    ]);
  });

  it('closes a question early once everyone has answered, and waits for the presenter when asked to', () => {
    let s = goTo(started(deck([pick], { manualReveal: true }), ['Asha', 'Ben']), 0, 0);
    expect(s.runs[0]?.phase).toBe('open');
    s = handle(s, 'u1', { kind: 'answer', answer: [1] }, 1000);
    expect(tick(s, 1500)).toBe(s);
    s = tick(handle(s, 'u2', { kind: 'answer', answer: [1] }, 2000), 2000);
    expect(s.runs[0]?.phase).toBe('closed');
    expect(guestView(s, 'u1').result).toBeUndefined();
    expect(standings(s)[0]?.score).toBe(0);
    s = reveal(s);
    expect(standings(s).map((r) => r.score)).toEqual([95, 90]);
    // The presenter can end a question, and give or take points by hand.
    const cut = close(goTo(started(deck([pick])), 0, 0));
    expect(cut.runs[0]?.phase).toBe('revealed');
    expect(standings(award(award(s, 'u2', 25), 'u1', -5)).map((r) => [r.name, r.score])).toEqual([
      ['Ben', 115],
      ['Asha', 90],
    ]);
  });

  it('keeps streaks, teams and the leaderboard', () => {
    let s = started(deck([pick, multi, newSlide('leaderboard', { id: 'l1' })], { teams: true, teamNames: ['Comets', 'Rockets'], teamRule: 'total' }), ['Asha', 'Ben', 'Chitra']);
    expect(s.players.map((p) => p.team)).toEqual([0, 1, 0]);
    s = goTo(s, 0, 0);
    for (const [id, answer] of [
      ['u1', [1]],
      ['u2', [1]],
      ['u3', [0]],
    ] as const)
      s = handle(s, id, { kind: 'answer', answer }, 0);
    s = tick(s, 0);
    s = goTo(s, 1, 100000);
    for (const [id, answer] of [
      ['u1', [0, 2]],
      ['u2', [0]],
      ['u3', [0, 2]],
    ] as const)
      s = handle(s, id, { kind: 'answer', answer }, 100000);
    s = tick(s, 100000);
    expect(standings(s).map((r) => [r.name, r.score, r.streak, r.right])).toEqual([
      ['Asha', 200, 2, 2],
      ['Ben', 150, 0, 1],
      ['Chitra', 100, 1, 1],
    ]);
    expect(teamStandings(s)).toEqual([
      { name: 'Comets', score: 300, members: 2, rank: 1 },
      { name: 'Rockets', score: 150, members: 1, rank: 2 },
    ]);
    const averaged = { ...s, deck: { ...s.deck, settings: { ...s.deck.settings, teamRule: 'average' as const } } };
    expect(teamStandings(averaged).map((t) => t.score)).toEqual([150, 150]);
    expect(teamStandings({ ...s, deck: { ...s.deck, settings: { ...s.deck.settings, teamRule: 'best' as const } } }).map((t) => t.score)).toEqual([200, 150]);
    s = goTo(s, 2, 200000);
    const view = guestView(s, 'u2');
    expect(view.board).toEqual([
      { name: 'Asha', avatar: s.players[0]?.avatar, score: 200, rank: 1, you: false },
      { name: 'Ben', avatar: s.players[1]?.avatar, score: 150, rank: 2, you: true },
      { name: 'Chitra', avatar: s.players[2]?.avatar, score: 100, rank: 3, you: false },
    ]);
    expect(view.you).toMatchObject({ team: 'Rockets', rank: 2 });
    expect((view.teamBoard as { name: string }[])[0]?.name).toBe('Comets');
    expect(guestView(end(s), 'u1')).toMatchObject({ phase: 'ended' });
    const again = reset(s, 5);
    expect(again.index).toBe(-1);
    expect(standings(again).every((r) => r.score === 0)).toBe(true);
    expect(again.players).toHaveLength(3);
  });

  it('runs polls, hints, questions from the floor, brainstorms and the wheel', () => {
    const hinted = newSlide('pick', { id: 'h1', title: 'Hard one', options: [{ text: 'a', correct: true }, { text: 'b' }], hints: ['First hint', 'Second hint'] });
    let s = started(deck([poll, hinted, newSlide('qa', { id: 'q1' }), newSlide('brainstorm', { id: 'b1', entries: 1 }), newSlide('wheel', { id: 'w1', useNames: true })], { hidden: ['rubbish'] }), [
      'Asha',
      'Ben',
    ]);
    // A poll with no time limit stays open; answers show no result.
    s = goTo(s, 0, 0);
    s = handle(s, 'u1', { kind: 'answer', answer: [2] }, 50);
    expect(tick(s, 999999)).toBe(s);
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'open', answered: true, endsAt: 0 });
    expect(close(s).runs[0]?.phase).toBe('closed');
    s = goTo(s, 1, 0);
    expect(guestView(s, 'u1').hints).toEqual([]);
    s = showHint(showHint(showHint(s)));
    expect(guestView(s, 'u1').hints).toEqual(['First hint', 'Second hint']);
    // Questions: asked, upvoted by others (not by their author), most wanted first.
    s = goTo(s, 2, 0);
    s = handle(s, 'u1', { kind: 'ask', text: 'Is the engine   real?' }, 0);
    s = handle(s, 'u2', { kind: 'ask', text: 'What rubbish is this?' }, 0);
    const [first, second] = s.runs[2]?.questions ?? [];
    s = handle(s, 'u1', { kind: 'upvote', id: second?.id }, 0);
    s = handle(s, 'u2', { kind: 'upvote', id: second?.id }, 0);
    expect((guestView(s, 'u1').questions as { text: string; votes: number; voted: boolean; mine: boolean }[]).map((q) => [q.text, q.votes, q.voted, q.mine])).toEqual([
      ['What ******* is this?', 1, true, false],
      ['Is the engine real?', 0, false, true],
    ]);
    s = markAnswered(s, second?.id ?? '');
    expect((guestView(s, 'u1').questions as { text: string }[])[0]?.text).toBe('Is the engine real?');
    expect(first?.text).toBe('Is the engine real?');
    // Brainstorm: ideas, then one vote each, then the order.
    s = goTo(s, 3, 0);
    s = handle(s, 'u1', { kind: 'idea', text: 'More benches' }, 0);
    s = handle(s, 'u2', { kind: 'idea', text: 'A café' }, 0);
    const ideas = s.runs[3]?.ideas ?? [];
    expect(handle(s, 'u1', { kind: 'vote', id: ideas[1]?.id }, 0)).toBe(s);
    s = setStage(s, 'vote');
    expect(handle(s, 'u1', { kind: 'idea', text: 'Too late' }, 0)).toBe(s);
    s = handle(s, 'u1', { kind: 'vote', id: ideas[1]?.id }, 0);
    // One vote each: a second idea cannot be voted for until the first vote is taken back.
    expect(handle(s, 'u1', { kind: 'vote', id: ideas[0]?.id }, 0)).toBe(s);
    expect(guestView(s, 'u1')).toMatchObject({ stage: 'vote', votesLeft: 0 });
    s = setStage(handle(s, 'u2', { kind: 'vote', id: ideas[1]?.id }, 0), 'results');
    expect((guestView(s, 'u2').ideas as { text: string; votes: number }[]).map((i) => [i.text, i.votes])).toEqual([
      ['A café', 2],
      ['More benches', 0],
    ]);
    // The wheel stops on one of those who joined.
    s = spin(goTo(s, 4, 0), () => 0.99);
    expect(s.runs[4]).toMatchObject({ winner: 'Ben', spins: 1 });
    expect(guestView(s, 'u1').winner).toBe('Ben');
    // Chat is for the lobby.
    expect(handle(s, 'u1', { kind: 'chat', text: 'hello' }, 0)).toBe(s);
    const lobby = handle(goTo(s, -1, 0), 'u1', { kind: 'chat', text: 'hello rubbish' }, 0);
    expect(guestView(lobby, 'u2').messages).toEqual([{ name: 'Asha', text: 'hello *******' }]);
  });

  it('walks the presenter through a quiz one step at a time', () => {
    const wheel = newSlide('wheel', { id: 'w2', useNames: true });
    const storm = newSlide('brainstorm', { id: 'b2' });
    let s = started(deck([pick, poll, wheel, storm], { countdown: 3, manualReveal: true }), ['Asha', 'Ben']);
    const steps: string[] = [];
    const step = (now: number) => {
      steps.push(nextStep(s));
      s = takeStep(s, now, () => 0);
    };
    step(0); // start: the countdown of the first question
    expect(s.runs[0]?.phase).toBe('countdown');
    step(1000); // close, even before it opened
    expect(s.runs[0]?.phase).toBe('closed');
    step(2000); // reveal
    expect(s.runs[0]?.phase).toBe('revealed');
    step(3000); // next: the poll opens, and "next" again closes it on the way out
    expect(s).toMatchObject({ index: 1 });
    expect(s.runs[1]?.phase).toBe('open');
    step(4000);
    expect(s.runs[1]?.phase).toBe('closed');
    expect(s.index).toBe(2);
    step(5000); // spin
    expect(s.runs[2]).toMatchObject({ winner: 'Asha', spins: 1, spunAt: 5000 });
    step(6000); // next
    step(7000); // vote
    step(8000); // results
    expect(s.runs[3]?.stage).toBe('results');
    step(9000); // finish
    expect(s.ended).toBe(true);
    expect(steps).toEqual(['start', 'close', 'reveal', 'next', 'next', 'spin', 'next', 'vote', 'results', 'finish']);
    expect(nextStep(s)).toBe('none');
    expect(takeStep(s, 10000)).toBe(s);
  });

  it('counts a question that is left while open, and can ask one again', () => {
    let s = goTo(started(deck([pick, typed], { manualReveal: true }), ['Asha', 'Ben']), 0, 0);
    s = handle(s, 'u1', { kind: 'answer', answer: [1] }, 1000);
    // Moving on shows nobody the answer on the big screen, but the points must not be lost.
    s = moveTo(s, 1, 5000);
    expect(s.runs[0]?.phase).toBe('revealed');
    expect(standings(s).find((r) => r.name === 'Asha')?.score).toBeGreaterThan(0);
    expect(s.runs[1]?.phase).toBe('open');
    // Back to the first question: it is shown as it ended, until it is asked again.
    s = moveTo(s, 0, 6000);
    expect(s.runs[0]?.phase).toBe('revealed');
    expect(s.runs[1]?.phase).toBe('revealed');
    s = askAgain(s, 7000);
    expect(s.runs[0]).toMatchObject({ phase: 'open', openedAt: 7000, responses: {} });
    expect(standings(s).find((r) => r.name === 'Asha')?.score).toBe(0);
    // The lobby can be gone back to.
    expect(moveTo(s, -1, 8000).index).toBe(-1);
    // A wheel with nobody to pick from offers nothing to spin.
    const empty = goTo(createSession(deck([newSlide('wheel', { id: 'w3', useNames: true })]), 'CODE'), 0, 0);
    expect(nextStep(empty)).toBe('finish');
    expect(nextStep(createSession(deck([]), 'CODE'))).toBe('none');
    expect(nextStep(started(deck([pick], { selfPaced: true })))).toBe('finish');
  });

  it('keeps the whole session as data', () => {
    let s = goTo(started(deck([pick, newSlide('qa', { id: 'q5', title: 'Questions' })]), ['Asha', 'Ben']), 0, 0);
    s = handle(s, 'u1', { kind: 'answer', answer: [1] }, 5000);
    s = moveTo(s, 1, 6000);
    s = handle(s, 'u2', { kind: 'ask', text: 'When does it open?' }, 7000);
    s = handle(s, 'u1', { kind: 'upvote', id: s.runs[1]?.questions[0]?.id }, 7500);
    const data = reportData(s, answerText) as { players: unknown[]; slides: Record<string, unknown>[] };
    expect(data).toMatchObject({ kind: 'benchtop-quiz-results', title: 'Test', code: 'ABC234', ended: false, teams: [] });
    expect(data.players).toEqual([
      { place: 1, name: 'Asha', team: undefined, score: 75, right: 1, answered: 1 },
      { place: 2, name: 'Ben', team: undefined, score: 0, right: 0, answered: 0 },
    ]);
    expect(data.slides[0]).toEqual({ number: 1, type: 'pick', title: 'Shortest day?', rightAnswer: 'Jupiter', answers: [{ name: 'Asha', answer: 'Jupiter', seconds: 5, share: 1, points: 75 }] });
    expect(data.slides[1]).toEqual({ number: 2, type: 'qa', title: 'Questions', answers: [], questions: [{ text: 'When does it open?', by: 'Ben', votes: 1, answered: false }] });
    // It is plain data: it survives being written out and read back.
    expect(JSON.parse(JSON.stringify(data)).slides).toHaveLength(2);
  });

  it('takes pins on a picture, and keeps results back until answering ends when asked to', () => {
    const dot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const pin = newSlide('pin', { id: 'n1', title: 'Where first?', image: dot });
    expect(problems(pin)).toEqual([]);
    expect(problems(newSlide('pin', { id: 'n2' }))).toEqual(['Add the picture people put their pin on.']);
    expect(readAnswer(pin, [0.25, 0.123456])).toEqual([0.25, 0.123]);
    for (const junk of [[0.5], [0.5, 1.2], [-0.1, 0.5], ['a', 'b'], 'x', null, [0.1, 0.2, 0.3], [Number.NaN, 0]]) expect(readAnswer(pin, junk), JSON.stringify(junk)).toBeNull();
    expect(answerText(pin, [0.25, 0.5])).toBe('25% across, 50% down');
    expect(
      tally(pin, [
        [0.25, 0.5],
        [1, 0],
      ]).pins,
    ).toEqual([
      [0.25, 0.5],
      [1, 0],
    ]);
    expect(guestSlide(pin, 'u1', false)).toMatchObject({ type: 'pin', image: dot });

    // Results can be kept back on polls and the like, not on scored questions.
    expect(readSlide({ type: 'poll', hide: true })?.hide).toBe(true);
    expect(readSlide({ type: 'pick', hide: true })?.hide).toBe(false);
    const quiet = newSlide('poll', { id: 'v2', title: 'Secret ballot', hide: true, options: [{ text: 'Yes' }, { text: 'No' }] });
    let s = goTo(started(deck([quiet, pin]), ['Asha', 'Ben']), 0, 0);
    // The big button ends the answering (which shows the results) before it moves on.
    expect(nextStep(s)).toBe('close');
    s = takeStep(handle(s, 'u1', { kind: 'answer', answer: [0] }, 100), 200);
    expect(s.runs[0]?.phase).toBe('closed');
    expect(nextStep(s)).toBe('next');
    s = takeStep(s, 300);
    s = handle(s, 'u2', { kind: 'answer', answer: [0.4, 0.6] }, 400);
    expect(s.runs[1]?.responses.u2).toMatchObject({ answer: [0.4, 0.6], points: 0 });
    expect(reportCsv(s, answerText)).toContain('40% across, 60% down');
  });

  it('lets everyone go at their own pace, each with their own clock', () => {
    let s = started(deck([newSlide('content', { id: 'c0', title: 'Welcome' }), pick, newSlide('qa', { id: 'q9' }), typed], { selfPaced: true }), ['Asha', 'Ben']);
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'idle', index: 0, selfPaced: true });
    s = handle(s, 'u1', { kind: 'next' }, 1000);
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'open', index: 1, endsAt: 21000 });
    expect(guestView(s, 'u2')).toMatchObject({ phase: 'idle', index: 0 });
    s = handle(s, 'u1', { kind: 'answer', answer: [1] }, 5000);
    // The result comes at once, and counts at once.
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'revealed', result: { points: 80, right: 'Jupiter' }, you: { score: 80 } });
    // The next slide a player can do alone: the Q&A is passed over.
    s = handle(s, 'u1', { kind: 'next' }, 6000);
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'open', index: 3 });
    // An answer after the time is up is taken, and earns nothing.
    s = handle(s, 'u1', { kind: 'answer', answer: 'CO2' }, 6000 + 40000);
    expect(s.runs[3]?.responses.u1).toMatchObject({ fraction: 0, points: 0 });
    s = handle(s, 'u1', { kind: 'next' }, 50000);
    expect(guestView(s, 'u1')).toMatchObject({ phase: 'ended', you: { score: 80, rank: 1 } });
    expect(handle(s, 'u1', { kind: 'next' }, 50001)).toBe(s);
    expect(guestView(s, 'u2').phase).toBe('idle');
  });

  it('writes a report a spreadsheet opens safely', () => {
    let s = goTo(started(deck([pick, poll]), ['Asha', '=SUM(A1)']), 0, 0);
    s = handle(s, 'u1', { kind: 'answer', answer: [1] }, 2500);
    s = tick(handle(s, 'u2', { kind: 'answer', answer: [0] }, 3000), 3000);
    s = handle(goTo(s, 1, 0), 'u1', { kind: 'answer', answer: [2] }, 10);
    expect(reportCsv(s, answerText)).toBe(
      ['Place,Name,Score,Right,Answered,Shortest day?,Points,Seconds,Favourite?', '1,Asha,88,1,1,Jupiter,88,2.5,Dinosaurs', "2,'=SUM(A1),0,0,1,Earth,0,3,", ''].join('\r\n'),
    );
  });
});
