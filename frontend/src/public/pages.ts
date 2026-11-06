import { useSyncExternalStore } from 'react';

/** The pages of the public edition that are not the application. Each has a path of its own. */
export type PublicPage = 'status' | 'faq' | 'terms' | 'privacy' | 'admin';

export const PAGE_PATHS: Record<PublicPage, string> = {
  status: '/status',
  faq: '/faq',
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  admin: '/admin',
};

/** Which page a path is, or null for the application (the path `/`, and any other the server also serves it at). */
export function pageOfPath(pathname: string): PublicPage | null {
  const path = (pathname.replace(/\/+$/u, '') || '/').toLowerCase();
  return (
    (Object.keys(PAGE_PATHS) as PublicPage[]).find((page) => PAGE_PATHS[page] === path) ?? null
  );
}

/** A path on this site that a link may carry: one slash first, no second slash, no backslash, no space. */
export function sitePath(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\/(?!\/)[^\s\\]*$/u.test(value) ? value : fallback;
}

const ROUTE_EVENT = 'swarm:public-route';

/** Where a sign-in should bring the person back to: the page they were on, when that is the application. */
export function returnPathOf(location: { pathname: string; search: string }): string | undefined {
  if (location.pathname !== '/') return undefined;
  const params = new URLSearchParams(location.search);
  params.delete('signin');
  const query = params.toString();
  const path = query ? `/?${query}` : '/';
  return path === '/' || path.length > 600 ? undefined : path;
}

/** The address a sign-in answer sends the browser to, if it is a web address and not something a script could be. */
export function navigationTarget(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const { protocol } = new URL(url, window.location.origin);
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function goTo(path: string, options: { replace?: boolean } = {}): void {
  const here = `${window.location.pathname}${window.location.search}`;
  if (path !== here) {
    if (options.replace) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new Event(ROUTE_EVENT));
  window.scrollTo({ top: 0 });
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(ROUTE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(ROUTE_EVENT, listener);
  };
}

const snapshot = (): string => `${window.location.pathname}${window.location.search}`;

/** The address the page is at (the path and the query), so that what depends on it is drawn again when it changes. */
export function usePublicAddress(): string {
  return useSyncExternalStore(subscribe, snapshot, () => '/');
}
