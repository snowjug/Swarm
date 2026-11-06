import { clearByok } from './byokStore';
import { isNoteKind, type NoteKind } from './problems';

const NOTE_KEY = 'swarm.public.note';
const WELCOME_KEY = 'swarm.public.welcome';

function tab(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Everything this tab remembers about the person is gone: the key first, then the rest of the tab's storage. */
export function clearTabState(): void {
  clearByok();
  try {
    tab()?.clear();
  } catch {
    // Nothing the tab could not clear is a key: that was removed above.
  }
}

/** One line for the landing page to show once, after a sign-out or a deletion has sent the person back to it. */
export function rememberNote(kind: NoteKind): void {
  try {
    tab()?.setItem(NOTE_KEY, kind);
  } catch {
    // The note is a courtesy.
  }
}

export function takeNote(): NoteKind | null {
  try {
    const store = tab();
    const value = store?.getItem(NOTE_KEY);
    store?.removeItem(NOTE_KEY);
    return isNoteKind(value) ? value : null;
  } catch {
    return null;
  }
}

export function welcomeDismissed(): boolean {
  try {
    return tab()?.getItem(WELCOME_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export function dismissWelcome(): void {
  try {
    tab()?.setItem(WELCOME_KEY, 'dismissed');
  } catch {
    // It shows again next time: no harm.
  }
}
