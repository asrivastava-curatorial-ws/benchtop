/**
 * The Live Quiz session that is running, kept outside the tool's own page so
 * that looking at another tool in the middle of a quiz does not end it.  It
 * holds the session, the link to the devices, and the clock that opens and
 * closes questions; the tool's screens watch it and ask it for changes.
 */
import type { Deck } from '../../lib/quiz';
import { channelHost, type GuestLink, type HostHub, joinHubs, memoryHub, pictureNamer } from '../../lib/quiz-hub';
import { createSession, guestView, handle, join, kick, makeCode, type Session, standings, tick } from '../../lib/quiz-session';
import { isDesktop } from '../../platform';
import { lanHost } from '../../platform/quiz';

export interface Live {
  readonly session: Session;
  /** Devices can reach the session; false once it has been closed (its results stay). */
  readonly open: boolean;
  /** Where people join: this computer's address first, then the network's; or the page for another tab. */
  readonly urls: readonly string[];
  /** Phones on the network through the desktop app, or other tabs of this browser. */
  readonly mode: 'lan' | 'tabs';
}

let live: Live | null = null;
let hub: HostHub | null = null;
let localGuests: ((id: string) => GuestLink) | null = null;
let named: ((view: unknown) => unknown) | null = null;
let clock: ReturnType<typeof setInterval> | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;
let queued = false;
let published = 0;
/** Devices are told at most this often, in milliseconds: a burst of answers is one round of news. */
const PACE = 60;
const watchers = new Set<() => void>();

export const getLive = (): Live | null => live;

export function watchLive(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => void watchers.delete(watcher);
}

const tell = () => {
  for (const watcher of [...watchers]) watcher();
};

/** Sends every device what it should show now. */
function publish(): void {
  clearTimeout(pending);
  pending = undefined;
  queued = false;
  published = Date.now();
  if (!live?.open || !hub || !named) return;
  const { session } = live;
  const rows = standings(session);
  const views: Record<string, unknown> = {};
  for (const player of session.players) views[player.id] = named(guestView(session, player.id, rows));
  hub.publish(views, named(guestView(session, null, rows)));
}

/**
 * Devices are told of a change at once when the last news is a moment old, and otherwise as
 * soon as that moment has passed.  The first does not wait for a timer: a window that is not
 * in front has its timers slowed to one a second, and an answer should not wait that long.
 */
function publishSoon(): void {
  if (queued || pending !== undefined) return;
  const wait = PACE - (Date.now() - published);
  if (wait > 0) pending = setTimeout(publish, wait);
  else {
    queued = true;
    // After everything that changes in this same turn.
    queueMicrotask(publish);
  }
}

/** Changes the session, and tells the tool's screens and the devices. */
export function changeLive(change: (session: Session) => Session): void {
  if (!live) return;
  const next = change(live.session);
  if (next === live.session) return;
  live = { ...live, session: next };
  if (live.open) publishSoon();
  tell();
}

function onMessage(from: string, message: unknown): void {
  if (!live?.open) return;
  const now = Date.now();
  const m = (message && typeof message === 'object' ? message : {}) as Record<string, unknown>;
  if (m.kind === 'join') {
    const joined = join(live.session, { id: from, name: m.name, avatar: m.avatar, team: m.team }, now);
    // A device that was turned away gives its place back.
    if (joined.error) hub?.drop(from);
    else changeLive(() => joined.session);
  } else changeLive((session) => handle(session, from, message, now));
}

/**
 * Starts a session with a deck.  In the desktop app phones reach it through the quiz relay
 * (`lan` opens the relay to the network, otherwise only this computer reaches it); in a
 * browser it is reached from other tabs of the same browser.
 */
export async function startLive(deck: Deck, lan: boolean): Promise<Live> {
  closeLive();
  const code = makeCode();
  const memory = memoryHub();
  let urls: string[];
  let outside: HostHub;
  if (isDesktop) {
    const relay = await lanHost(lan);
    urls = relay.urls;
    outside = relay;
  } else {
    outside = channelHost(code);
    urls = [`${new URL('join.html', document.baseURI).href}#${code}`];
  }
  hub = joinHubs([outside, memory.host]);
  hub.onMessage = onMessage;
  localGuests = memory.guest;
  named = pictureNamer(hub);
  live = { session: createSession(deck, code), open: true, urls, mode: isDesktop ? 'lan' : 'tabs' };
  clock = setInterval(() => changeLive((session) => tick(session, Date.now())), 200);
  publish();
  tell();
  return live;
}

/** Closes the session to devices.  What happened in it stays, for the results. */
export function closeLive(): void {
  clearInterval(clock);
  clearTimeout(pending);
  clock = undefined;
  pending = undefined;
  queued = false;
  hub?.close();
  hub = null;
  localGuests = null;
  named = null;
  if (live?.open) {
    live = { ...live, open: false };
    tell();
  }
}

/** Forgets the session and its results. */
export function clearLive(): void {
  closeLive();
  if (live) {
    live = null;
    tell();
  }
}

export function kickPlayer(id: string): void {
  changeLive((session) => kick(session, id));
  hub?.drop(id);
}

/** A participant inside the presenter's own page, for trying the quiz out. */
export const localGuest = (id: string): GuestLink | null => (live?.open && localGuests ? localGuests(id) : null);
