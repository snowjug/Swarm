import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EnvironmentUpdate } from '../../../../../shared/guided';
import type { Workspace } from '../../../app/context';
import { errorMessage } from '../../../api';
import type { EnvironmentDraft, RunActions } from './context';
import { draftChanges, environmentEditable, environmentInput } from './model';
import { checkEnvironment } from './validation';

/**
 * The run's actions, each of which waits for the server one at a time. The shell already tells the person
 * when a request was not confirmed; the message is kept here too, beside the controls it belongs to.
 */
export function useRunActions(
  workspace: Workspace,
  options: { onStarted: () => void; announce: (message: string) => void },
): RunActions {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const latest = useRef(workspace);
  useEffect(() => {
    latest.current = workspace;
  });
  const { onStarted, announce } = options;

  const act = useCallback(
    async (
      name: string,
      work: (ws: Workspace) => Promise<unknown>,
      said: string,
    ): Promise<boolean> => {
      if (lock.current || latest.current.busy) return false;
      lock.current = true;
      setPending(name);
      setError(null);
      try {
        await work(latest.current);
        announce(said);
        return true;
      } catch (failure) {
        setError(errorMessage(failure));
        return false;
      } finally {
        lock.current = false;
        setPending(null);
      }
    },
    [announce],
  );

  return useMemo<RunActions>(
    () => ({
      pending,
      error,
      clearError: () => setError(null),
      prepare: () =>
        void act('prepare', (ws) => ws.run('environment'), 'Preparing the environment.'),
      start: () =>
        void act('start', (ws) => ws.run('simulation'), 'The simulation has started.').then(
          (started) => started && onStarted(),
        ),
      cancel: () => void act('cancel', (ws) => ws.cancel(), 'Cancelling the simulation.'),
      pause: () => void act('pause', (ws) => ws.pause(), 'Pausing at the last saved round.'),
      resume: () =>
        void act('resume', (ws) => ws.resume(), 'The simulation has resumed.').then(
          (resumed) => resumed && onStarted(),
        ),
      restart: () =>
        act('restart', (ws) => ws.run('simulation'), 'The simulation restarted from round 1.').then(
          (restarted) => {
            if (restarted) onStarted();
            return restarted;
          },
        ),
      report: () => void act('report', (ws) => ws.run('report'), 'Writing the detailed report.'),
      openReport: () => latest.current.go('decide', { view: 'report' }),
    }),
    [act, error, onStarted, pending],
  );
}

/**
 * The environment being edited: kept here, above the tabs, so that it survives a change of tab and so that
 * the proxy sheet, the setup and the save bar all edit the same draft. It starts again from the saved
 * environment whenever that changes (a save, or another read of the project that found it different).
 */
export function useEnvironmentDraft(workspace: Workspace): EnvironmentDraft {
  const { project } = workspace;
  const initial = useMemo(() => environmentInput(project), [project]);
  const key = JSON.stringify(initial);
  const [seen, setSeen] = useState(key);
  const [draft, setDraft] = useState<EnvironmentUpdate | null>(initial);
  if (seen !== key) {
    setSeen(key);
    setDraft(initial);
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changes = useMemo(
    () => (initial && draft ? draftChanges(initial, draft) : null),
    [initial, draft],
  );
  const check = useMemo(() => (draft ? checkEnvironment(draft, project) : null), [draft, project]);
  const editable = environmentEditable(project) && !workspace.busy;

  const save = useCallback(async (): Promise<boolean> => {
    if (!check?.ok || !check.data) return false;
    setSaving(true);
    setError(null);
    try {
      await workspace.saveEnvironment(check.data);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setSaving(false);
    }
  }, [check, workspace]);

  const discard = useCallback(() => {
    setDraft(initial);
    setError(null);
  }, [initial]);

  const change = useCallback((next: EnvironmentUpdate) => {
    setDraft(next);
    setError(null);
  }, []);

  return {
    initial,
    draft,
    setDraft: change,
    changes,
    check,
    editable,
    saving,
    error,
    save,
    discard,
  };
}

/** Steps through the recorded rounds on its own, one at a time, for as long as it is asked to. Never faster than a person can read. */
export function usePlayback(
  round: number,
  last: number,
  setRound: (round: number) => void,
  everyMs = 900,
): { playing: boolean; toggle: () => void; stop: () => void } {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    if (round >= last) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setRound(round + 1), everyMs);
    return () => window.clearTimeout(timer);
  }, [playing, round, last, setRound, everyMs]);
  const toggle = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (round >= last) setRound(0);
    setPlaying(true);
  }, [playing, round, last, setRound]);
  const stop = useCallback(() => setPlaying(false), []);
  return { playing, toggle, stop };
}
