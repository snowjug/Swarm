import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScenarioDocument, ScenarioParseResult } from '../../../shared/scenario';
import { errorMessage, isAbort } from '../api';
import { scenarioApi } from '../api/scenario';

export interface ScenarioReading {
  reading: boolean;
  /** Why the last reading failed, in the server's words. */
  error: string | null;
  /** Reads the question. Resolves to the result, or null when it failed or was stopped. */
  read: (
    question: string,
    documents: readonly ScenarioDocument[],
  ) => Promise<ScenarioParseResult | null>;
  /** Stops a reading in progress. */
  cancel: () => void;
  clearError: () => void;
}

/**
 * Reading a question into a scenario. It calls the server only when `read` is called, so a page
 * that never asks makes no request. A reading in progress is stopped when another starts and when
 * the page goes away.
 */
export function useScenarioReading(): ScenarioReading {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const read = useCallback(
    async (
      question: string,
      documents: readonly ScenarioDocument[],
    ): Promise<ScenarioParseResult | null> => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      setReading(true);
      setError(null);
      try {
        const result = await scenarioApi.parse(question, documents, mine.signal);
        return mine.signal.aborted ? null : result;
      } catch (failure) {
        if (!mine.signal.aborted && !isAbort(failure)) setError(errorMessage(failure));
        return null;
      } finally {
        if (controller.current === mine) {
          controller.current = null;
          setReading(false);
        }
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setReading(false);
  }, []);
  const clearError = useCallback(() => setError(null), []);

  return { reading, error, read, cancel, clearError };
}
