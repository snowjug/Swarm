import { useSyncExternalStore } from 'react';

/** What the person chose about motion: follow the device (the default), always reduce, or always play. */
export const MOTION_PREFERENCES = ['system', 'reduced', 'full'] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

/** Where the choice is kept. It holds one of the names above and nothing else. */
export const MOTION_STORAGE_KEY = 'swarm.motion';

export const MOTION_LABELS: Record<MotionPreference, string> = {
  system: 'Follow device',
  reduced: 'Reduced',
  full: 'Full',
};

export function parseMotionPreference(value: unknown): MotionPreference {
  return typeof value === 'string' && (MOTION_PREFERENCES as readonly string[]).includes(value)
    ? (value as MotionPreference)
    : 'system';
}

const listeners = new Set<() => void>();
let current: MotionPreference = 'system';
let started = false;

function read(): MotionPreference {
  try {
    return parseMotionPreference(window.localStorage.getItem(MOTION_STORAGE_KEY));
  } catch {
    // Storage can be blocked; the device's setting is then what counts.
    return 'system';
  }
}

function apply(preference: MotionPreference): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset.motion;
  else root.dataset.motion = preference;
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  current = read();
  apply(current);
}

export function setMotionPreference(next: MotionPreference): void {
  start();
  current = next;
  apply(next);
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, next);
  } catch {
    // The choice then lasts until the page is closed.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The person's own setting for motion. */
export function useMotionPreference(): MotionPreference {
  return useSyncExternalStore(
    subscribe,
    () => (started ? current : 'system'),
    () => 'system',
  );
}

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeSystem(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const systemReduces = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;

/**
 * Whether motion should be reduced: the person's choice if they made one, else the device's. Canvas and
 * script animations ask this; stylesheets and `motion` components follow the same rule by themselves.
 */
export function useReducedMotion(): boolean {
  const preference = useMotionPreference();
  const system = useSyncExternalStore(subscribeSystem, systemReduces, () => false);
  return preference === 'reduced' || (preference === 'system' && system);
}
