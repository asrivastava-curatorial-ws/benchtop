/** Hash-based routing: works from any origin, including a custom app protocol. */
import { useEffect, useState } from 'preact/hooks';

/** `query` carries what a shared link sets in the tool (a calculator and its values). */
export type Route = { readonly page: 'home' } | { readonly page: 'settings' } | { readonly page: 'tool'; readonly id: string; readonly query?: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'settings') return { page: 'settings' };
  const tool = /^tool\/([a-z0-9-]+)(?:\?([A-Za-z0-9\-_=&.~%+]*))?$/.exec(path);
  if (tool) return tool[2] ? { page: 'tool', id: tool[1] as string, query: tool[2] } : { page: 'tool', id: tool[1] as string };
  return { page: 'home' };
}

/** A link to a tool that opens it with settings, as the desktop app and `benchtop open` accept. */
export const toolLink = (id: string, params: Record<string, string>): string => `#/tool/${id}?${new URLSearchParams(params).toString()}`;

/** Drops the query from the address once the tool has used it, so a reload starts afresh. */
export function clearQuery(id: string): void {
  history.replaceState(history.state, '', `${location.pathname}${location.search}${toolHref(id)}`);
}

export const toolHref = (id: string): string => `#/tool/${id}`;

export function navigate(href: string): void {
  if (location.hash !== href) location.hash = href;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
