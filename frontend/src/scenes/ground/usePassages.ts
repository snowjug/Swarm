import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvidenceChunk } from '../../../../shared/types';
import { api, errorMessage, isAbort } from '../../api';
import { indexPassages, type PassageIndex } from './passages';

const cache = new Map<string, EvidenceChunk[]>();

export interface PassagesState {
  index: PassageIndex | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface Loaded {
  key: string;
  passages: EvidenceChunk[] | null;
  error: string | null;
}

/**
 * Every passage of the project's sources (S1 … Sn). The server lists them all for an empty search, which is
 * how the page learns how many there are, where each sits in its document and what each says. They are cut
 * when the sources are taken in and never change after, so they are read once for a project.
 */
export function usePassages(projectId: string, documentCount: number): PassagesState {
  const key = `${projectId}:${documentCount}`;
  const [loaded, setLoaded] = useState<Loaded>(() => ({
    key,
    passages: cache.get(key) ?? null,
    error: null,
  }));
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (documentCount === 0) return undefined;
    const known = cache.get(key);
    if (known && revision === 0) {
      setLoaded({ key, passages: known, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setLoaded((old) =>
      old.key === key ? { ...old, error: null } : { key, passages: null, error: null },
    );
    void api.evidence(projectId, '', controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        const passages = result.matches.map(({ score: _score, ...chunk }) => chunk);
        cache.set(key, passages);
        setLoaded({ key, passages, error: null });
      },
      (failure: unknown) => {
        if (controller.signal.aborted || isAbort(failure)) return;
        setLoaded((old) => ({
          key,
          passages: old.key === key ? old.passages : null,
          error: errorMessage(failure),
        }));
      },
    );
    return () => controller.abort();
  }, [key, projectId, documentCount, revision]);

  const current =
    loaded.key === key ? loaded : { key, passages: cache.get(key) ?? null, error: null };
  const index = useMemo(
    () => (current.passages ? indexPassages(current.passages) : null),
    [current.passages],
  );
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const loading = documentCount > 0 && current.passages === null && current.error === null;
  const error = current.error;
  return useMemo(() => ({ index, loading, error, reload }), [index, loading, error, reload]);
}
