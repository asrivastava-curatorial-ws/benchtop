/**
 * How a Live Quiz presenter and the devices of those taking part reach each
 * other.  Three ways, one shape: inside one page (the "try it as a
 * participant" pane, and tests), between tabs of one browser (the web
 * version), and through the desktop app's relay for phones on the network
 * (platform/quiz.ts for the presenter, quiz/link.ts for the phones).
 */

export interface HostHub {
  /** Sends every joined device its view, and the devices that have not joined the view for anyone. */
  publish(views: Record<string, unknown>, anyone: unknown): void;
  /** A picture a view refers to as "img:KEY". */
  file(key: string, dataUrl: string): void;
  /** Stops a device from taking part. */
  drop(id: string): void;
  /** Called for everything a device sends; "join" comes with the name the person chose. */
  onMessage: ((from: string, message: unknown) => void) | null;
  close(): void;
}

export interface GuestLink {
  send(message: Record<string, unknown>): void;
  /**
   * Called with each new view, and with the time on the presenter's clock as the view was
   * handed over: the times a view names (when a question closes) are moments on that clock.
   */
  onView: ((view: Record<string, unknown> | null, now: number) => void) | null;
  /** The address of a picture a view names as "img:KEY". */
  fileUrl(key: string): string;
  close(): void;
}

/** A picture's address as a view gives it: its own data, or a name to ask the link about. */
export const pictureUrl = (link: Pick<GuestLink, 'fileUrl'>, src: unknown): string => (typeof src !== 'string' || !src ? '' : src.startsWith('img:') ? link.fileUrl(src.slice(4)) : src);

/** A presenter and any number of devices in one page. */
export function memoryHub(): { host: HostHub; guest: (id: string) => GuestLink } {
  const guests = new Map<string, GuestLink>();
  const files = new Map<string, string>();
  let last: { views: Record<string, unknown>; anyone: unknown } = { views: {}, anyone: null };
  const host: HostHub = {
    onMessage: null,
    publish(views, anyone) {
      last = { views, anyone };
      for (const [id, link] of guests) link.onView?.(((views[id] ?? anyone) as Record<string, unknown>) ?? null, Date.now());
    },
    file: (key, dataUrl) => void files.set(key, dataUrl),
    drop: (id) => void guests.delete(id),
    close: () => guests.clear(),
  };
  return {
    host,
    guest(id) {
      const link: GuestLink = {
        onView: null,
        send: (message) => queueMicrotask(() => host.onMessage?.(id, message)),
        fileUrl: (key) => files.get(key) ?? '',
        // Only its own place: the same participant may have been opened again since.
        close: () => {
          if (guests.get(id) === link) guests.delete(id);
        },
      };
      guests.set(id, link);
      // A device that arrives late is shown how things stand.
      queueMicrotask(() => link.onView?.(((last.views[id] ?? last.anyone) as Record<string, unknown>) ?? null, Date.now()));
      return link;
    },
  };
}

const channelName = (code: string) => `benchtop-quiz-${code.toUpperCase()}`;

/** The presenter's end between tabs of one browser. */
export function channelHost(code: string): HostHub {
  const channel = new BroadcastChannel(channelName(code));
  const files: Record<string, string> = {};
  let last: { views: Record<string, unknown>; anyone: unknown } | null = null;
  const hub: HostHub = {
    onMessage: null,
    publish(views, anyone) {
      last = { views, anyone };
      channel.postMessage({ to: 'guests', views, anyone });
    },
    file(key, dataUrl) {
      files[key] = dataUrl;
      channel.postMessage({ to: 'guests', files: { [key]: dataUrl } });
    },
    drop: (id) => channel.postMessage({ to: 'guests', dropped: id }),
    close: () => channel.close(),
  };
  channel.onmessage = (event) => {
    const data = event.data as { to?: string; from?: unknown; message?: unknown; hello?: boolean } | null;
    if (data?.to !== 'host' || typeof data.from !== 'string') return;
    // A tab that has just opened is sent the pictures and how things stand.
    if (data.hello) {
      channel.postMessage({ to: 'guests', files });
      if (last) channel.postMessage({ to: 'guests', ...last });
    } else hub.onMessage?.(data.from, data.message);
  };
  return hub;
}

/** A participant's end between tabs of one browser. */
export function channelGuest(code: string, id: string): GuestLink {
  const channel = new BroadcastChannel(channelName(code));
  const files = new Map<string, string>();
  const link: GuestLink = {
    onView: null,
    send: (message) => channel.postMessage({ to: 'host', from: id, message }),
    fileUrl: (key) => files.get(key) ?? '',
    close: () => channel.close(),
  };
  channel.onmessage = (event) => {
    const data = event.data as { to?: string; views?: Record<string, unknown>; anyone?: unknown; files?: Record<string, string>; dropped?: string } | null;
    if (data?.to !== 'guests') return;
    if (data.files) for (const [key, value] of Object.entries(data.files)) files.set(key, value);
    // Tabs of one browser share a clock.
    if (data.views) link.onView?.(((data.views[id] ?? data.anyone) as Record<string, unknown>) ?? null, Date.now());
  };
  channel.postMessage({ to: 'host', from: id, hello: true });
  return link;
}

/**
 * Views with their pictures taken out: each picture (a long data URL) is given a short name
 * once, handed to the hub, and named in the views from then on, so that a picture travels once
 * and not with every change.
 */
export function pictureNamer(hub: Pick<HostHub, 'file'>): (view: unknown) => unknown {
  const names = new Map<string, string>();
  const name = (src: string): string => {
    let key = names.get(src);
    if (!key) {
      key = `p${names.size + 1}`;
      names.set(src, key);
      hub.file(key, src);
    }
    return `img:${key}`;
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return value.startsWith('data:image/') ? name(value) : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  return walk;
}

/** Several hubs as one: say, the devices on the network and the participant pane in the presenter's own page. */
export function joinHubs(hubs: readonly HostHub[]): HostHub {
  const all: HostHub = {
    onMessage: null,
    publish: (views, anyone) => {
      for (const hub of hubs) hub.publish(views, anyone);
    },
    file: (key, dataUrl) => {
      for (const hub of hubs) hub.file(key, dataUrl);
    },
    drop: (id) => {
      for (const hub of hubs) hub.drop(id);
    },
    close: () => {
      for (const hub of hubs) hub.close();
    },
  };
  for (const hub of hubs) hub.onMessage = (from, message) => all.onMessage?.(from, message);
  return all;
}
