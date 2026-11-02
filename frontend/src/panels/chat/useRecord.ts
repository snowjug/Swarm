import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClaimDetail } from '../../../../shared/evidence';
import type { EvidenceMatch } from '../../../../shared/types';
import { api, errorMessage } from '../../api';

export interface RecordState<T> {
  data: T | null;
  /** Being read now. */
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/** How long a record that was read is trusted before it is read again: reviews can change a statement. */
const FRESH_MS = 120_000;
const cache = new Map<string, { at: number; value: unknown }>();

const kept = <T>(key: string): { value: T } | null => {
  const entry = cache.get(key);
  return entry && Date.now() - entry.at < FRESH_MS ? { value: entry.value as T } : null;
};

/**
 * One record that a chip points at, read when the chip is opened and kept for a while, so that opening
 * it again is immediate. A record that is not there is a result too (null), not an error.
 */
export function useRecord<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  enabled: boolean,
): RecordState<T> {
  const [data, setData] = useState<T | null>(() => kept<T>(key)?.value ?? null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [, settle] = useState(0);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const hit = kept<T>(key);
    if (hit) {
      setData(hit.value);
      return undefined;
    }
    const controller = new AbortController();
    setError(null);
    void loader.current(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        cache.set(key, { at: Date.now(), value });
        setData(value);
        settle((count) => count + 1);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
      },
    );
    return () => controller.abort();
  }, [key, enabled, revision]);

  const retry = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading: enabled && error === null && kept(key) === null, error, retry };
}

/** The passage a source chip names: the exact one, or null where the project's record has no such passage. */
export async function fetchPassage(
  projectId: string,
  id: string,
  signal: AbortSignal,
): Promise<EvidenceMatch | null> {
  const result = await api.evidence(projectId, id, signal);
  return result.matches.find((match) => match.id === id) ?? null;
}

export const fetchClaim = (
  projectId: string,
  id: string,
  signal: AbortSignal,
): Promise<ClaimDetail> => api.claim(projectId, id, signal);
