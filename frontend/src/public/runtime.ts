/**
 * What the rest of the page needs to know about the public edition, in a module that imports nothing: the API client
 * reads it on every request, so it has to stay small and must not pull the public pages in with it.
 *
 * The switch is off. The page turns it on once, at start-up, when it finds the edition tag (see `edition.ts`). Until
 * then, and always in the pilot, the API client does what it did before the public edition existed.
 */

let publicEdition = false;

export function setPublicEdition(on: boolean): void {
  publicEdition = on;
}

export function inPublicEdition(): boolean {
  return publicEdition;
}

/** What the API client tells the public page when an answer shows that something changed for the person. */
export type PublicSignal =
  { kind: 'signed-out'; reason: 'expired' | 'disabled' } | { kind: 'refused'; code: string };

type Listener = (signal: PublicSignal) => void;

const listeners = new Set<Listener>();

export function onPublicSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function signalPublic(signal: PublicSignal): void {
  for (const listener of [...listeners]) listener(signal);
}
