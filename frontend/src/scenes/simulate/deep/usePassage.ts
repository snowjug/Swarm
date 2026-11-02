import { useCallback, useEffect, useState } from 'react';
import type { EvidenceChunk } from '../../../../../shared/types';
import { api, errorMessage, isAbort } from '../../../api';

export type PassageState =
  | { status: 'idle' | 'loading' | 'missing' }
  | { status: 'ready'; passage: EvidenceChunk }
  | { status: 'error'; message: string };

/** What has been read already, so that a passage opened twice is not asked for twice. `null`: there is none. */
const cache = new Map<string, EvidenceChunk | null>();

function known(key: string): PassageState {
  if (!cache.has(key)) return { status: 'idle' };
  const passage = cache.get(key);
  return passage ? { status: 'ready', passage } : { status: 'missing' };
}

/**
 * One source passage, read when it is wanted (a citation was opened) and not before. Asking the server
 * for an exact identifier returns that passage first.
 */
export function usePassage(projectId: string, id: string, enabled: boolean) {
  const key = `${projectId}:${id}`;
  const [state, setState] = useState<PassageState>(() => known(key));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    if (cache.has(key)) {
      setState(known(key));
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void api.evidence(projectId, id, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        cache.set(key, result.matches.find((match) => match.id === id) ?? null);
        setState(known(key));
      },
      (failure: unknown) => {
        if (controller.signal.aborted || isAbort(failure)) return;
        setState({ status: 'error', message: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [enabled, id, key, projectId, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, retry };
}
