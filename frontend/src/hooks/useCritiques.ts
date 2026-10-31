import { useCallback, useEffect, useRef, useState } from 'react';
import type { CritiqueResponseInput, CritiquesView } from '../../../shared/critique';
import { ApiError, errorMessage } from '../api';
import { criticsApi } from '../api/critics';

/** What a person says to a critique. The revision of the review they were looking at is added from what the page shows. */
export type CritiqueAnswer = Omit<CritiqueResponseInput, 'expectedRevision'>;

/** Said when the review changed under a person who was writing a response, and the page has read it again. */
export const REVIEW_CHANGED_WHILE_WRITING =
  'This review changed while you were writing: someone else responded, or the review was run again. It has been read again below. What you wrote is still here; choose again what it means to save it.';

export type AnswerOutcome =
  | { saved: true; view: CritiquesView }
  | {
      saved: false;
      message: string;
      /** The review is not the one the person was looking at, so it has to be read again. */
      moved: boolean;
    };

/**
 * Sends a response to the review as the person is looking at it, which is what the revision says, and
 * tells what became of it. A review that changed since is refused by the server and said here in the
 * words the page uses for it; any other refusal is said in the server's own.
 */
export async function sendAnswer(
  projectId: string,
  critiqueId: string,
  input: CritiqueAnswer,
  shownRevision: number,
): Promise<AnswerOutcome> {
  try {
    const view = await criticsApi.respond(projectId, critiqueId, {
      ...input,
      expectedRevision: shownRevision,
    });
    return { saved: true, view };
  } catch (failure) {
    const moved = failure instanceof ApiError && failure.code === 'CRITIQUES_CHANGED';
    return {
      saved: false,
      moved,
      message: moved ? REVIEW_CHANGED_WHILE_WRITING : errorMessage(failure),
    };
  }
}

export interface CritiquesState {
  view: CritiquesView | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  runError: string | null;
  /** The critique being answered, while the answer is on its way. */
  answering: string | null;
  answerError: { id: string; message: string } | null;
  reload: () => void;
  run: (useModel: boolean) => Promise<void>;
  /** Resolves true when the server took the response. */
  respond: (critiqueId: string, input: CritiqueAnswer) => Promise<boolean>;
}

export interface CritiquesOptions {
  /** The review is read again whenever this changes: a fresh read of the project, or a change to the lab's record. */
  refreshOn?: string;
  /** Told after the server took a change to the review, so that what rests on it can be read again. */
  onChanged?: () => void;
}

/**
 * The independent review of one project. It is read once when the page opens, which never fails for a
 * project that has not used it, and again on request or when `refreshOn` changes; running it and
 * answering a critique are the person's own acts and each replaces what is shown with what the server
 * now holds. A response carries the revision of the review the person is looking at: when it has
 * changed since, the response is refused, the review is read again and what the person wrote stays.
 */
export function useCritiques(projectId: string, options: CritiquesOptions = {}): CritiquesState {
  const { refreshOn = '', onChanged } = options;
  const [view, setView] = useState<CritiquesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<{ id: string; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void criticsApi.read(projectId, controller.signal).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        setView(loaded);
        setError(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [projectId, refreshOn, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);

  const run = useCallback(
    async (useModel: boolean): Promise<void> => {
      setRunning(true);
      setRunError(null);
      try {
        setView(await criticsApi.run(projectId, { useModel }));
        changed.current?.();
      } catch (failure) {
        setRunError(errorMessage(failure));
      } finally {
        setRunning(false);
      }
    },
    [projectId],
  );

  const shownRevision = view?.revision ?? null;
  const respond = useCallback(
    async (critiqueId: string, input: CritiqueAnswer): Promise<boolean> => {
      if (shownRevision === null) return false;
      setAnswering(critiqueId);
      setAnswerError(null);
      const outcome = await sendAnswer(projectId, critiqueId, input, shownRevision);
      setAnswering(null);
      if (outcome.saved) {
        setView(outcome.view);
        changed.current?.();
        return true;
      }
      setAnswerError({ id: critiqueId, message: outcome.message });
      if (outcome.moved) setRevision((old) => old + 1);
      return false;
    },
    [projectId, shownRevision],
  );

  return { view, loading, error, running, runError, answering, answerError, reload, run, respond };
}
