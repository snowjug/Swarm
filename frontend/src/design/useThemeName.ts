import { useSyncExternalStore } from 'react';

type ThemeName = 'light' | 'dark' | 'high-contrast';

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function read(): ThemeName {
  const name = document.documentElement.dataset.theme;
  return name === 'dark' || name === 'high-contrast' ? name : 'light';
}

/** The theme that is on the page now, which canvases read to choose their own colours. */
export function useThemeName(): ThemeName {
  return useSyncExternalStore(subscribe, read, () => 'light');
}
