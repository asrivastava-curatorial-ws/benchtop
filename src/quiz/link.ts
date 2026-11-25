/**
 * A phone's link to the quiz it has opened from the desktop app's relay: it
 * asks for news and is answered when there is some (a held request, so it
 * works through any browser), and posts what the person does.
 */
import type { GuestLink } from '../lib/quiz-hub';

const KEPT = 'benchtop-quiz-device';

export function relayGuest(onTrouble: (down: boolean) => void): GuestLink {
  let id = '';
  let secret = '';
  let version = 0;
  let closed = false;
  let waiting: AbortController | null = null;
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEPT) ?? 'null') as { id?: unknown; secret?: unknown } | null;
    if (typeof kept?.id === 'string' && typeof kept.secret === 'string') ({ id, secret } = kept as { id: string; secret: string });
  } catch {
    /* A private window may refuse storage: the device then joins afresh after a reload. */
  }
  const headers = (): Record<string, string> => ({ 'content-type': 'application/json', ...(id ? { 'x-quiz-id': id, 'x-quiz-secret': secret } : {}) });
  const forget = () => {
    id = '';
    secret = '';
    try {
      sessionStorage.removeItem(KEPT);
    } catch {
      /* Nothing was kept. */
    }
  };
  const link: GuestLink = {
    onView: null,
    fileUrl: (key) => `./q/file/${encodeURIComponent(key)}`,
    send(message) {
      void (async () => {
        try {
          if (message.kind === 'join') {
            const response = await fetch('./q/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
            if (!response.ok) return;
            ({ id, secret } = (await response.json()) as { id: string; secret: string });
            try {
              sessionStorage.setItem(KEPT, JSON.stringify({ id, secret }));
            } catch {
              /* Kept for this page only. */
            }
            // Ask again as the device that has just joined.
            version = 0;
            waiting?.abort();
          } else await fetch('./q/send', { method: 'POST', headers: headers(), body: JSON.stringify(message) });
        } catch {
          onTrouble(true);
        }
      })();
    },
    close() {
      closed = true;
      waiting?.abort();
    },
  };
  void (async () => {
    let failures = 0;
    while (!closed) {
      waiting = new AbortController();
      try {
        const response = await fetch('./q/poll', { method: 'POST', headers: headers(), body: JSON.stringify({ v: version }), signal: waiting.signal });
        if (!response.ok) throw new Error(String(response.status));
        const news = (await response.json()) as { v: number; now: number; gone: boolean; view: Record<string, unknown> | null };
        version = news.v;
        if (news.gone) forget();
        failures = 0;
        onTrouble(false);
        link.onView?.(news.view, news.now);
      } catch (error) {
        if (closed) return;
        // An aborted request is this page's own doing (it has just joined): ask again at once.
        if ((error as Error).name === 'AbortError') continue;
        failures += 1;
        if (failures > 1) onTrouble(true);
        await new Promise((done) => setTimeout(done, Math.min(8000, 500 * 2 ** failures)));
      }
    }
  })();
  return link;
}
