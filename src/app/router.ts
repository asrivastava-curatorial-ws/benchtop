/** Hash-based routing: works from any origin, including a custom app protocol. */
import { useEffect, useState } from 'preact/hooks';

export type Route = { readonly page: 'home' } | { readonly page: 'settings' } | { readonly page: 'tool'; readonly id: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'settings') return { page: 'settings' };
  const tool = /^tool\/([a-z0-9-]+)$/.exec(path);
  if (tool) return { page: 'tool', id: tool[1] as string };
  return { page: 'home' };
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
