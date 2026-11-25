/**
 * Live Quiz: the deck of slides (quiz questions, polls, word clouds and the
 * rest), how answers are scored and how responses are counted for the big
 * screen.  Nothing here knows about the network or the page: the session
 * (quiz-session.ts) and the screens build on it.
 */

export type SlideType = 'content' | 'pick' | 'type' | 'match' | 'order' | 'categorise' | 'poll' | 'cloud' | 'open' | 'scale' | 'ranking' | 'pin' | 'qa' | 'brainstorm' | 'wheel' | 'leaderboard';

export const SLIDE_NAMES: Record<SlideType, string> = {
  pick: 'Pick answer',
  type: 'Type answer',
  match: 'Match pairs',
  order: 'Correct order',
  categorise: 'Categorise',
  poll: 'Poll',
  cloud: 'Word cloud',
  open: 'Open ended',
  scale: 'Rating scale',
  ranking: 'Ranking',
  pin: 'Pin on image',
  qa: 'Q&A',
  brainstorm: 'Brainstorm',
  wheel: 'Spinner wheel',
  content: 'Content',
  leaderboard: 'Leaderboard',
};

export const QUIZ_TYPES: readonly SlideType[] = ['pick', 'type', 'match', 'order', 'categorise'];
export const POLL_TYPES: readonly SlideType[] = ['poll', 'cloud', 'open', 'scale', 'ranking', 'pin', 'qa', 'brainstorm'];
/** Slides whose results can be kept off the big screen until answering has ended. */
export const HIDEABLE: readonly SlideType[] = ['poll', 'cloud', 'open', 'scale', 'ranking', 'pin'];
export const isQuiz = (type: SlideType) => QUIZ_TYPES.includes(type);
/** Slides people answer on their own device. */
export const isAnswered = (type: SlideType) => isQuiz(type) || POLL_TYPES.includes(type);

export interface Option {
  readonly text: string;
  readonly image?: string;
  readonly correct?: boolean;
}

export interface Slide {
  readonly id: string;
  readonly type: SlideType;
  /** The question, or the heading of a content slide. */
  readonly title: string;
  readonly image?: string;
  /** Seconds to answer; quiz questions always have a limit, other slides may have none (0). */
  readonly seconds: number;
  /** Quiz questions: the most and the fewest points a right answer earns, and whether faster answers earn more. */
  readonly points: { readonly max: number; readonly min: number; readonly speed: boolean };
  /** Pick answer, poll and ranking. */
  readonly options: readonly Option[];
  /** Pick answer, match pairs and categorise: part marks for a partly right answer. */
  readonly partial: boolean;
  /** Pick answer: up to three hints the presenter can reveal. */
  readonly hints: readonly string[];
  /** Type answer: every spelling that counts as right; the first is the one shown. */
  readonly accepted: readonly string[];
  readonly pairs: readonly { readonly left: string; readonly right: string }[];
  /** Correct order: the items in their right order. */
  readonly items: readonly string[];
  readonly categories: readonly { readonly name: string; readonly items: readonly string[] }[];
  /** Poll: more than one option may be chosen. */
  readonly multiple: boolean;
  readonly chart: 'bar' | 'donut' | 'pie';
  /** Word cloud: words each person may send.  Brainstorm: votes each person has. */
  readonly entries: number;
  readonly statements: readonly string[];
  readonly low: number;
  readonly high: number;
  readonly lowLabel: string;
  readonly highLabel: string;
  /** Spinner wheel: its own entries, or the names of the people who joined. */
  readonly wheel: readonly string[];
  readonly useNames: boolean;
  /** Content: the text under the heading. */
  readonly text: string;
  /** Polls and the like: the results stay off the big screen until answering has ended. */
  readonly hide: boolean;
}

export interface Settings {
  readonly teams: boolean;
  readonly teamNames: readonly string[];
  /** A team's score: the average of its members, their total, or its best member's. */
  readonly teamRule: 'average' | 'total' | 'best';
  /** Seconds counted down before each quiz question opens (0 for none). */
  readonly countdown: number;
  /** Options in a different order for each person. */
  readonly shuffle: boolean;
  /** Right answers stay hidden until the presenter shows them. */
  readonly manualReveal: boolean;
  readonly avatars: boolean;
  readonly sounds: boolean;
  /** People can write to each other while they wait in the lobby. */
  readonly chat: boolean;
  /** Everyone goes through the questions at their own pace, without a presenter. */
  readonly selfPaced: boolean;
  /** Words that are starred out in what people write. */
  readonly hidden: readonly string[];
}

export interface Deck {
  readonly title: string;
  readonly slides: readonly Slide[];
  readonly settings: Settings;
}

export const AVATARS = ['🦊', '🐼', '🦉', '🐯', '🐸', '🐙', '🦄', '🐝', '🦋', '🐢', '🦁', '🐧', '🐬', '🦜', '🐘', '🦒'] as const;

let serial = 0;
export const newId = (prefix = 's'): string => {
  serial += 1;
  return `${prefix}${Date.now().toString(36)}${serial.toString(36)}`;
};

const text = (value: unknown, max: number, fallback = ''): string => (typeof value === 'string' ? value.slice(0, max) : fallback);
const whole = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;
const list = <T>(value: unknown, max: number, read: (item: unknown) => T | null): T[] =>
  Array.isArray(value)
    ? value
        .slice(0, max)
        .map(read)
        .filter((item): item is T => item !== null)
    : [];
const picture = (value: unknown): string | undefined => (typeof value === 'string' && /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(value) && value.length < 3_000_000 ? value : undefined);
const line = (max: number) => (item: unknown) => (typeof item === 'string' ? item.slice(0, max) : null);

export const DEFAULT_SETTINGS: Settings = {
  teams: false,
  teamNames: ['Red', 'Blue'],
  teamRule: 'average',
  countdown: 3,
  shuffle: false,
  manualReveal: false,
  avatars: true,
  sounds: true,
  chat: true,
  selfPaced: false,
  hidden: [],
};

export function readSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const names = list(s.teamNames, 12, line(24)).filter((name) => name.trim());
  return {
    teams: s.teams === true,
    teamNames: names.length >= 2 ? names : DEFAULT_SETTINGS.teamNames,
    teamRule: s.teamRule === 'total' || s.teamRule === 'best' ? s.teamRule : 'average',
    countdown: whole(s.countdown, 3, 0, 30),
    shuffle: s.shuffle === true,
    manualReveal: s.manualReveal === true,
    avatars: s.avatars !== false,
    sounds: s.sounds !== false,
    chat: s.chat !== false,
    selfPaced: s.selfPaced === true,
    hidden: list(s.hidden, 200, line(40)).filter((word) => word.trim()),
  };
}

/** A slide as it was stored, checked and completed: decks come from files. */
export function readSlide(raw: unknown): Slide | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const type = typeof s.type === 'string' && s.type in SLIDE_NAMES ? (s.type as SlideType) : null;
  if (!type) return null;
  const points = (s.points && typeof s.points === 'object' ? s.points : {}) as Record<string, unknown>;
  const max = whole(points.max, 100, 1, 1000);
  const image = picture(s.image);
  return {
    id: typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) ? s.id : newId(),
    type,
    title: text(s.title, 300),
    ...(image ? { image } : {}),
    seconds: isQuiz(type) ? whole(s.seconds, 20, 5, 1200) : whole(s.seconds, 0, 0, 1200),
    points: { max, min: whole(points.min, 0, 0, max), speed: points.speed !== false },
    options: list(s.options, type === 'pick' ? 8 : 12, (item): Option | null => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const optionImage = picture(o.image);
      return { text: text(o.text, 200), ...(optionImage ? { image: optionImage } : {}), ...(o.correct === true ? { correct: true } : {}) };
    }),
    partial: s.partial === true,
    hints: list(s.hints, 3, line(200)),
    accepted: list(s.accepted, 20, line(120)),
    pairs: list(s.pairs, 8, (item) => {
      if (!item || typeof item !== 'object') return null;
      const p = item as Record<string, unknown>;
      return { left: text(p.left, 120), right: text(p.right, 120) };
    }),
    items: list(s.items, 10, line(120)),
    categories: list(s.categories, 4, (item) => {
      if (!item || typeof item !== 'object') return null;
      const c = item as Record<string, unknown>;
      return { name: text(c.name, 60), items: list(c.items, 10, line(80)) };
    }),
    multiple: s.multiple === true,
    chart: s.chart === 'donut' || s.chart === 'pie' ? s.chart : 'bar',
    entries: whole(s.entries, 3, 1, 10),
    statements: list(s.statements, 8, line(160)),
    low: whole(s.low, 1, 0, 10),
    high: Math.max(whole(s.low, 1, 0, 10) + 1, whole(s.high, 5, 1, 10)),
    lowLabel: text(s.lowLabel, 40),
    highLabel: text(s.highLabel, 40),
    wheel: list(s.wheel, 60, line(40)),
    useNames: s.useNames === true,
    text: text(s.text, 3000),
    hide: s.hide === true && HIDEABLE.includes(type),
  };
}

export function readDeck(raw: unknown): Deck {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { title: text(d.title, 120, 'Quiz') || 'Quiz', slides: list(d.slides, 200, readSlide), settings: readSettings(d.settings) };
}

export const deckFile = (deck: Deck): string => JSON.stringify({ kind: 'benchtop-quiz', version: 1, ...deck }, null, 1);

export function readDeckFile(source: string): Deck {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new Error('This is not a quiz file (it is not JSON).');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { slides?: unknown }).slides)) throw new Error('This file has no slides: it is not a Benchtop quiz.');
  return readDeck(raw);
}

/** A new slide of a kind, with sensible things to replace. */
export function newSlide(type: SlideType, more: Record<string, unknown> = {}): Slide {
  const starts: Record<SlideType, Record<string, unknown>> = {
    pick: { title: 'Which one is right?', options: [{ text: 'First answer', correct: true }, { text: 'Second answer' }, { text: 'Third answer' }, { text: 'Fourth answer' }] },
    type: { title: 'Type the answer', accepted: ['answer'] },
    match: {
      title: 'Match the pairs',
      pairs: [
        { left: 'First', right: 'One' },
        { left: 'Second', right: 'Two' },
        { left: 'Third', right: 'Three' },
      ],
    },
    order: { title: 'Put these in order', items: ['First', 'Second', 'Third'] },
    categorise: {
      title: 'Sort these',
      categories: [
        { name: 'Group A', items: ['One', 'Two'] },
        { name: 'Group B', items: ['Three', 'Four'] },
      ],
    },
    poll: { title: 'What do you think?', options: [{ text: 'Yes' }, { text: 'No' }, { text: 'Not sure' }] },
    cloud: { title: 'One word for today?' },
    open: { title: 'What would you like to ask or say?' },
    scale: { title: 'How much do you agree?', statements: ['The session was useful'], low: 1, high: 5, lowLabel: 'Not at all', highLabel: 'Completely' },
    ranking: { title: 'Rank these', options: [{ text: 'First option' }, { text: 'Second option' }, { text: 'Third option' }] },
    pin: { title: 'Where would you go first?' },
    qa: { title: 'Your questions' },
    brainstorm: { title: 'Ideas, please' },
    wheel: { title: 'Who is next?', useNames: true, wheel: [] },
    content: { title: 'A heading', text: 'Something to say or show.' },
    leaderboard: { title: 'Leaderboard' },
  };
  return readSlide({ type, id: newId(), ...starts[type], ...more }) as Slide;
}

/** What is wrong with a slide, for the builder to show: an empty list when it can be played. */
export function problems(slide: Slide): string[] {
  const found: string[] = [];
  const filled = (items: readonly string[]) => items.filter((item) => item.trim()).length;
  if (!slide.title.trim() && slide.type !== 'leaderboard') found.push('Write the question or heading.');
  if (slide.type === 'pick') {
    if (slide.options.length < 2) found.push('Give at least two answers.');
    if (!slide.options.some((o) => o.correct)) found.push('Mark the right answer.');
    if (slide.options.some((o) => !o.text.trim() && !o.image)) found.push('Every answer needs words or a picture.');
  }
  if ((slide.type === 'poll' || slide.type === 'ranking') && slide.options.filter((o) => o.text.trim()).length < 2) found.push('Give at least two options.');
  if (slide.type === 'type' && filled(slide.accepted) < 1) found.push('Give the right answer.');
  if (slide.type === 'match' && slide.pairs.filter((p) => p.left.trim() && p.right.trim()).length < 2) found.push('Give at least two pairs.');
  if (slide.type === 'order' && filled(slide.items) < 2) found.push('Give at least two items to order.');
  if (slide.type === 'categorise') {
    if (slide.categories.length < 2) found.push('Give at least two categories.');
    if (slide.categories.reduce((sum, c) => sum + filled(c.items), 0) < 2) found.push('Give at least two items to sort.');
  }
  if (slide.type === 'scale' && filled(slide.statements) < 1) found.push('Give at least one statement to rate.');
  if (slide.type === 'pin' && !slide.image) found.push('Add the picture people put their pin on.');
  if (slide.type === 'wheel' && !slide.useNames && filled(slide.wheel) < 2) found.push('Give the wheel at least two entries, or use the names of those who joined.');
  return found;
}

/* ---------------------------------------------------- answers -- */

/** How answers are compared: case, accents and extra spaces do not matter. */
export const plain = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, ' ')
    .trim();

/** A small repeatable random source, so that each person's shuffled order can be worked out again. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The items of a categorise slide in one list, with the category each belongs to. */
export const sortItems = (slide: Slide): { text: string; category: number }[] =>
  slide.categories.flatMap((c, category) => c.items.filter((item) => item.trim()).map((item) => ({ text: item, category })));

/**
 * A slide as a participant's device gets it: no right answers, and the parts to arrange
 * in a shuffled order (each keeps the number it has in the deck, which is what answers refer to).
 */
export function guestSlide(slide: Slide, seed: string, shuffleOptions: boolean): Record<string, unknown> {
  const random = seeded(`${slide.id}:${seed}`);
  const numbered = <T>(items: readonly T[]) => items.map((item, i) => ({ i, item }));
  const base: Record<string, unknown> = { id: slide.id, type: slide.type, title: slide.title, image: slide.image ?? '', seconds: slide.seconds };
  switch (slide.type) {
    case 'pick': {
      const options = numbered(slide.options).map(({ i, item }) => ({ i, text: item.text, image: item.image ?? '' }));
      return { ...base, options: shuffleOptions ? shuffled(options, random) : options, many: slide.options.filter((o) => o.correct).length > 1 };
    }
    case 'poll':
      return { ...base, options: numbered(slide.options).map(({ i, item }) => ({ i, text: item.text, image: item.image ?? '' })), many: slide.multiple };
    case 'ranking':
      return {
        ...base,
        options: shuffled(
          numbered(slide.options).map(({ i, item }) => ({ i, text: item.text })),
          random,
        ),
      };
    case 'match':
      return {
        ...base,
        lefts: slide.pairs.map((p) => p.left),
        rights: shuffled(
          numbered(slide.pairs).map(({ i, item }) => ({ i, text: item.right })),
          random,
        ),
      };
    case 'order':
      return {
        ...base,
        items: shuffled(
          numbered(slide.items).map(({ i, item }) => ({ i, text: item })),
          random,
        ),
      };
    case 'categorise':
      return {
        ...base,
        categories: slide.categories.map((c) => c.name),
        items: shuffled(
          numbered(sortItems(slide)).map(({ i, item }) => ({ i, text: item.text })),
          random,
        ),
      };
    case 'cloud':
    case 'brainstorm':
      return { ...base, entries: slide.entries };
    case 'scale':
      return { ...base, statements: slide.statements, low: slide.low, high: slide.high, lowLabel: slide.lowLabel, highLabel: slide.highLabel };
    case 'content':
      return { ...base, text: slide.text };
    default:
      return base;
  }
}

const indexes = (value: unknown, count: number, max: number): number[] | null => {
  if (!Array.isArray(value) || value.length > max) return null;
  const out = value.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count);
  return out.length === value.length ? out : null;
};

/** An answer as it arrived from a device, checked against its slide: null when it is not an answer to it. */
export function readAnswer(slide: Slide, raw: unknown): unknown {
  switch (slide.type) {
    case 'pick':
    case 'poll': {
      const chosen = indexes(raw, slide.options.length, slide.options.length);
      const many = slide.type === 'poll' ? slide.multiple : slide.options.filter((o) => o.correct).length > 1;
      if (!chosen || chosen.length === 0 || (!many && chosen.length > 1)) return null;
      return [...new Set(chosen)].sort((a, b) => a - b);
    }
    case 'type':
    case 'open': {
      const said = typeof raw === 'string' ? raw.trim().slice(0, slide.type === 'type' ? 120 : 500) : '';
      return said ? said : null;
    }
    case 'match': {
      const chosen = indexes(raw, slide.pairs.length, slide.pairs.length);
      return chosen && chosen.length === slide.pairs.length && new Set(chosen).size === chosen.length ? chosen : null;
    }
    case 'order': {
      const chosen = indexes(raw, slide.items.length, slide.items.length);
      return chosen && chosen.length === slide.items.length && new Set(chosen).size === chosen.length ? chosen : null;
    }
    case 'ranking': {
      const chosen = indexes(raw, slide.options.length, slide.options.length);
      return chosen && chosen.length === slide.options.length && new Set(chosen).size === chosen.length ? chosen : null;
    }
    case 'categorise': {
      const count = sortItems(slide).length;
      const chosen = indexes(raw, slide.categories.length, count);
      return chosen && chosen.length === count ? chosen : null;
    }
    case 'cloud': {
      if (!Array.isArray(raw)) return null;
      const words = raw
        .filter((w): w is string => typeof w === 'string')
        .map((w) => w.trim().replace(/\s+/g, ' ').slice(0, 30))
        .filter(Boolean)
        .slice(0, slide.entries);
      return words.length ? words : null;
    }
    case 'scale': {
      if (!Array.isArray(raw) || raw.length !== slide.statements.length) return null;
      return raw.every((n) => Number.isInteger(n) && n >= slide.low && n <= slide.high) ? raw : null;
    }
    case 'pin': {
      // A place on the picture: across and down, each from 0 to 1.
      if (!Array.isArray(raw) || raw.length !== 2 || !raw.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
      return raw.map((n) => Math.round((n as number) * 1000) / 1000);
    }
    default:
      return null;
  }
}

/** How right an answer is: 1 for wholly right, 0 for wrong, and part marks between when the slide gives them. */
export function fractionRight(slide: Slide, answer: unknown): number {
  const share = (right: number, of: number) => (of === 0 ? 0 : slide.partial ? right / of : right === of ? 1 : 0);
  switch (slide.type) {
    case 'pick': {
      const chosen = answer as number[];
      const correct = slide.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
      // One wrong choice loses everything, with part marks or without.
      if (chosen.some((i) => !slide.options[i]?.correct)) return 0;
      return share(chosen.length, correct.length);
    }
    case 'type':
      return slide.accepted.some((a) => a.trim() && plain(a) === plain(answer as string)) ? 1 : 0;
    case 'match': {
      const chosen = answer as number[];
      return share(chosen.filter((right, left) => right === left || plain(slide.pairs[right]?.right ?? '') === plain(slide.pairs[left]?.right ?? '')).length, slide.pairs.length);
    }
    case 'order': {
      const chosen = answer as number[];
      return chosen.every((item, place) => item === place || plain(slide.items[item] ?? '') === plain(slide.items[place] ?? '')) ? 1 : 0;
    }
    case 'categorise': {
      const items = sortItems(slide);
      const chosen = answer as number[];
      return share(chosen.filter((category, i) => category === items[i]?.category).length, items.length);
    }
    default:
      return 0;
  }
}

/** The points an answer earns: all of them at once, fewer as the time runs out (when the slide says so), part of them for part marks. */
export function pointsFor(slide: Slide, fraction: number, elapsedMs: number): number {
  if (fraction <= 0) return 0;
  const { max, min, speed } = slide.points;
  const left = slide.seconds > 0 ? Math.min(Math.max(1 - elapsedMs / (slide.seconds * 1000), 0), 1) : 1;
  return Math.round((speed ? min + (max - min) * left : max) * fraction);
}

/** The right answer in words, for showing after a question. */
export function rightAnswer(slide: Slide): string {
  switch (slide.type) {
    case 'pick':
      return slide.options
        .filter((o) => o.correct)
        .map((o) => o.text || 'the picture')
        .join(', ');
    case 'type':
      return slide.accepted[0] ?? '';
    case 'match':
      return slide.pairs.map((p) => `${p.left} → ${p.right}`).join('; ');
    case 'order':
      return slide.items.join(' → ');
    case 'categorise':
      return slide.categories.map((c) => `${c.name}: ${c.items.filter((i) => i.trim()).join(', ')}`).join('; ');
    default:
      return '';
  }
}

/** An answer in words, for reports. */
export function answerText(slide: Slide, answer: unknown): string {
  if (answer === null || answer === undefined) return '';
  switch (slide.type) {
    case 'pick':
    case 'poll':
      return (answer as number[]).map((i) => slide.options[i]?.text || `option ${i + 1}`).join(', ');
    case 'ranking':
      return (answer as number[]).map((i) => slide.options[i]?.text ?? '').join(' > ');
    case 'match':
      return (answer as number[]).map((right, left) => `${slide.pairs[left]?.left ?? ''} → ${slide.pairs[right]?.right ?? ''}`).join('; ');
    case 'order':
      return (answer as number[]).map((i) => slide.items[i] ?? '').join(' → ');
    case 'categorise': {
      const items = sortItems(slide);
      return (answer as number[]).map((category, i) => `${items[i]?.text ?? ''}: ${slide.categories[category]?.name ?? ''}`).join('; ');
    }
    case 'cloud':
      return (answer as string[]).join(', ');
    case 'scale':
      return (answer as number[]).join(', ');
    case 'pin':
      return (answer as number[]).map((n) => `${Math.round(n * 100)}%`).join(' across, ') + ' down';
    default:
      return String(answer);
  }
}

/** Words on the hidden list are starred out, whole words only. */
export function starred(value: string, hidden: readonly string[]): string {
  let out = value;
  for (const word of hidden) {
    const clean = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (clean) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${clean}(?![\\p{L}\\p{N}])`, 'giu'), (found) => '*'.repeat(found.length));
  }
  return out;
}

/* ----------------------------------------------------- counting -- */

export interface Tally {
  /** How many people answered. */
  readonly answered: number;
  /** Pick answer and poll: votes for each option.  Ranking: each option's score (first place counts most). */
  readonly counts: number[];
  /** Type answer and word cloud: what was written, most frequent first. */
  readonly words: { text: string; count: number; right?: boolean }[];
  /** Open ended: everything written, newest first. */
  readonly texts: string[];
  /** Rating scale: the mean for each statement. */
  readonly means: number[];
  /** Pin on image: every pin, across and down from 0 to 1. */
  readonly pins: [number, number][];
  /** Quiz questions: how many were wholly right, and the mean share right. */
  readonly right: number;
  readonly meanShare: number;
}

export function tally(slide: Slide, answers: readonly unknown[], hidden: readonly string[] = []): Tally {
  const counts = slide.options.map(() => 0);
  const words = new Map<string, { text: string; count: number; right?: boolean }>();
  const texts: string[] = [];
  const sums = slide.statements.map(() => 0);
  const pins: [number, number][] = [];
  let right = 0;
  let share = 0;
  const note = (word: string) => {
    const key = plain(word);
    const seen = words.get(key);
    if (seen) seen.count += 1;
    else words.set(key, { text: starred(word, hidden), count: 1, ...(slide.type === 'type' ? { right: fractionRight(slide, word) === 1 } : {}) });
  };
  for (const answer of answers) {
    if (isQuiz(slide.type)) {
      const fraction = fractionRight(slide, answer);
      share += fraction;
      if (fraction === 1) right += 1;
    }
    if (slide.type === 'pick' || slide.type === 'poll') for (const i of answer as number[]) counts[i] = (counts[i] ?? 0) + 1;
    else if (slide.type === 'ranking')
      (answer as number[]).forEach((option, place) => {
        counts[option] = (counts[option] ?? 0) + slide.options.length - place;
      });
    else if (slide.type === 'type') note(answer as string);
    else if (slide.type === 'cloud') for (const word of answer as string[]) note(word);
    else if (slide.type === 'open') texts.unshift(starred(answer as string, hidden));
    else if (slide.type === 'pin') pins.push(answer as [number, number]);
    else if (slide.type === 'scale')
      (answer as number[]).forEach((n, i) => {
        sums[i] = (sums[i] ?? 0) + n;
      });
  }
  return {
    answered: answers.length,
    counts,
    words: [...words.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
    texts,
    means: sums.map((sum) => (answers.length ? sum / answers.length : 0)),
    pins,
    right,
    meanShare: answers.length ? share / answers.length : 0,
  };
}

/* ------------------------------------------------------ import -- */

/** One row of a CSV file (quoted fields may hold commas, line breaks and doubled quotes). */
function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

/**
 * Questions from a table: a question, then its answers, with the right one(s) named in the
 * last column by number ("2", "1,3") or by letter ("B").  A row with one answer becomes a
 * type-answer question; "true" or "false" as the only answer becomes a true-or-false question.
 */
export function importQuestions(source: string): Slide[] {
  const rows = csvRows(source);
  const slides: Slide[] = [];
  for (const [index, row] of rows.entries()) {
    const cells = row.map((cell) => cell.trim());
    const question = cells[0] ?? '';
    if (!question || (index === 0 && /^question$/i.test(question))) continue;
    const rest = cells.slice(1).filter(Boolean);
    if (rest.length === 0) continue;
    if (rest.length === 1) {
      const only = rest[0] as string;
      if (/^(true|false)$/i.test(only))
        slides.push(
          newSlide('pick', {
            title: question,
            options: [
              { text: 'True', correct: /^true$/i.test(only) },
              { text: 'False', correct: /^false$/i.test(only) },
            ],
          }),
        );
      else
        slides.push(
          newSlide('type', {
            title: question,
            accepted: only
              .split('|')
              .map((a) => a.trim())
              .filter(Boolean),
          }),
        );
      continue;
    }
    const key = rest[rest.length - 1] as string;
    const answers = rest.slice(0, -1).slice(0, 8);
    const named = key
      .split(/[\s,|/]+/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) - 1 : /^[a-h]$/i.test(part) ? part.toLowerCase().charCodeAt(0) - 97 : -1))
      .filter((n) => n >= 0 && n < answers.length);
    // No key that names an answer: the last column is an answer too, and the first answer is the right one.
    const options = named.length ? answers : rest.slice(0, 8);
    const correct = new Set(named.length ? named : [0]);
    slides.push(newSlide('pick', { title: question, options: options.map((answer, i) => ({ text: answer, correct: correct.has(i) })) }));
  }
  return slides;
}

/* ------------------------------------------------------ sample -- */

export function sampleDeck(): Deck {
  return readDeck({
    title: 'Science museum quiz',
    slides: [
      newSlide('content', { title: 'Science museum quiz', text: 'Join on your phone, pick a name, and get ready.\nFaster right answers earn more points.' }),
      newSlide('poll', {
        title: 'Which gallery are you looking forward to most?',
        options: [{ text: 'Engine Hall' }, { text: 'Space' }, { text: 'Electricity' }, { text: 'Dinosaurs' }],
        chart: 'bar',
      }),
      newSlide('pick', {
        title: 'Which planet has the shortest day?',
        seconds: 20,
        options: [{ text: 'Earth' }, { text: 'Jupiter', correct: true }, { text: 'Mars' }, { text: 'Venus' }],
        hints: ['It is a gas giant.', 'It is the largest planet.'],
      }),
      newSlide('pick', { title: 'True or false: sound travels faster in water than in air.', seconds: 15, options: [{ text: 'True', correct: true }, { text: 'False' }] }),
      newSlide('type', { title: 'What gas do plants take in from the air to make food?', seconds: 30, accepted: ['carbon dioxide', 'CO2', 'carbondioxide'] }),
      newSlide('match', {
        title: 'Match the scientist to the discovery',
        seconds: 40,
        partial: true,
        pairs: [
          { left: 'C. V. Raman', right: 'Scattering of light' },
          { left: 'Marie Curie', right: 'Radioactivity' },
          { left: 'Isaac Newton', right: 'Laws of motion' },
        ],
      }),
      newSlide('order', { title: 'Order these from smallest to largest', seconds: 30, items: ['Atom', 'Cell', 'Ant', 'Elephant'] }),
      newSlide('categorise', {
        title: 'Conductor or insulator?',
        seconds: 40,
        partial: true,
        categories: [
          { name: 'Conductor', items: ['Copper', 'Salt water'] },
          { name: 'Insulator', items: ['Rubber', 'Glass'] },
        ],
      }),
      newSlide('leaderboard', { title: 'Leaderboard' }),
      newSlide('cloud', { title: 'One word for the museum today?' }),
      newSlide('scale', { title: 'How was the visit?', statements: ['I learned something new', 'I would come again'], low: 1, high: 5, lowLabel: 'Not at all', highLabel: 'Very much' }),
      newSlide('qa', { title: 'Questions for the guide' }),
      newSlide('wheel', { title: 'Who gets the souvenir?', useNames: true }),
    ],
    settings: DEFAULT_SETTINGS,
  });
}
