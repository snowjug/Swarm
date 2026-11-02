import { useEffect, useState } from 'react';

/** The time, once a second while `enabled`: for a count that runs while the engine works. */
export function useNow(enabled: boolean, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [enabled, interval]);
  return now;
}
