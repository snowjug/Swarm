import { useEffect } from 'react';

/** Names the page for the tab while it is shown, and puts back what was there when it goes. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}
