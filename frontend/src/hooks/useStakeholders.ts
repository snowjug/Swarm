import { useCallback, useEffect, useRef, useState } from 'react';
import {
  proposalWasStopped,
  type ModelFailureCode,
  type ProposalStop,
} from '../../../shared/model-failure';
import type {
  Actor,
  ActorsView,
  Stakeholder,
  StakeholderRelation,
  StakeholdersView,
} from '../../../shared/stakeholders';
import { errorMessage } from '../api';
import { approveFlow, discoverFlow, saveFlow, type Shown } from '../api/stakeholderFlows';
import { participantsApi, thenActors } from '../api/participants';
import { stakeholdersApi } from '../api/stakeholders';

export type StakeholderWork =
  | 'finding'
  | 'proposing'
  | 'reviewing'
  | 'saving'
  | 'approving'
  | 'making-actors'
  | 'saving-actors';

/**
 * A step the model was asked to do and could not, which the person is to choose what to do about. Nothing
 * was kept: the list is as it was. `confirm` is what they confirmed when they asked, so that asking again,
 * or going on with rules, is asking for the same thing.
 */
export interface ModelStop {
  step: 'propose' | 'regenerate';
  stop: ProposalStop;
  confirm: boolean;
  /** The participant that was being proposed again, for `regenerate`. */
  participantId?: string;
}

/** What a change to the participants answers with: the list and its actors, or the model's failure. */
export type Outcome = Shown | { stopped: ModelStop };

export interface StakeholderState {
  view: StakeholdersView | null;
  actors: ActorsView | null;
  loading: boolean;
  /** Why the first reading failed; the page then offers a retry. */
  error: string | null;
  /** What the server is being asked to do, or null. Only one thing at a time. */
  working: StakeholderWork | null;
  /** Why the last change was refused, in a sentence for the person. */
  problem: string | null;
  /** The step the model could not do, until the person has chosen what to do about it; null when there is none. */
  stopped: ModelStop | null;
  reload: () => void;
  dismissProblem: () => void;
  dismissStop: () => void;
  discover: (mode: 'rules' | 'model', confirm?: boolean) => Promise<boolean>;
  /**
   * Proposes the participants of the decision, by rules or by the model; the person reviews them next. False
   * when nothing was proposed, because the model could not be used (see `stopped`) or the change was refused.
   * `fallbackFrom` is the failure the person is going on from, when they chose rules after the model's.
   */
  propose: (
    mode: 'rules' | 'model',
    confirm?: boolean,
    fallbackFrom?: ModelFailureCode,
  ) => Promise<boolean>;
  /**
   * Runs one change to the participants under the same rules as every other: one thing at a time, a refusal
   * becomes a sentence, a conflict reads the page again. What it answers with is what the page then shows.
   */
  exec: (kind: StakeholderWork, work: () => Promise<Outcome>) => Promise<boolean>;
  save: (stakeholders: Stakeholder[], relations: StakeholderRelation[]) => Promise<boolean>;
  /** Approves the list, then makes the actors from it. */
  approve: (options: { model: boolean }) => Promise<boolean>;
  makeActors: (options: {
    model: boolean;
    confirm: boolean;
    /** The list changed after it was approved: approve it as it is now, then make the actors from it. */
    approveFirst?: boolean;
  }) => Promise<boolean>;
  saveActors: (actors: Actor[]) => Promise<boolean>;
}

/**
 * The stakeholders and actors of one project. They are read when the page opens (a project that never
 * used this gets an answer with nothing in it, not an error), and every change answers with the new
 * state. `onChanged` is called when a change alters what the next stages will use.
 */
export function useStakeholders(projectId: string, onChanged: () => void): StakeholderState {
  const [view, setView] = useState<StakeholdersView | null>(null);
  const [actors, setActors] = useState<ActorsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<StakeholderWork | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stopped, setStopped] = useState<ModelStop | null>(null);
  const [revision, setRevision] = useState(0);
  const changed = useRef(onChanged);
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      stakeholdersApi.get(projectId, controller.signal),
      stakeholdersApi.actors(projectId, controller.signal),
    ]).then(
      ([stakeholders, made]) => {
        if (controller.signal.aborted) return;
        setView(stakeholders);
        setActors(made);
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
  }, [projectId, revision]);

  const reload = useCallback(() => setRevision((old) => old + 1), []);
  const dismissProblem = useCallback(() => setProblem(null), []);
  const dismissStop = useCallback(() => setStopped(null), []);

  /**
   * One piece of work at a time; a refusal becomes a sentence, and a conflict reads the page again. Work
   * that ends without doing what was asked (a model that could not be used) answers `false`.
   */
  const run = useCallback(
    async (kind: StakeholderWork, work: () => Promise<void | false>): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setWorking(kind);
      setProblem(null);
      try {
        return (await work()) !== false;
      } catch (failure) {
        if (mounted.current) {
          setProblem(errorMessage(failure));
          if (
            failure instanceof Error &&
            'code' in failure &&
            failure.code === 'ARTIFACT_CONFLICT'
          ) {
            setRevision((old) => old + 1);
          }
        }
        return false;
      } finally {
        busy.current = false;
        if (mounted.current) setWorking(null);
      }
    },
    [],
  );

  const discover = useCallback(
    (mode: 'rules' | 'model', confirm = false) =>
      run('finding', async () => {
        const shown = await discoverFlow(projectId, mode, confirm);
        if (!mounted.current) return;
        setStopped(null);
        setView(shown.view);
        setActors(shown.actors);
        changed.current();
      }),
    [projectId, run],
  );

  const exec = useCallback(
    (kind: StakeholderWork, work: () => Promise<Outcome>) =>
      run(kind, async () => {
        const outcome = await work();
        if (!mounted.current) return;
        if ('stopped' in outcome) {
          setStopped(outcome.stopped);
          return false;
        }
        setStopped(null);
        setView(outcome.view);
        setActors(outcome.actors);
        changed.current();
      }),
    [run],
  );

  const propose = useCallback(
    (mode: 'rules' | 'model', confirm = false, fallbackFrom?: ModelFailureCode) =>
      exec('proposing', async () => {
        const answer = await participantsApi.propose(projectId, {
          mode,
          confirm,
          ...(fallbackFrom ? { fallbackFrom } : {}),
        });
        return proposalWasStopped(answer)
          ? { stopped: { step: 'propose', stop: answer.stopped, confirm } }
          : thenActors(projectId, Promise.resolve(answer));
      }),
    [exec, projectId],
  );

  const save = useCallback(
    (stakeholders: Stakeholder[], relations: StakeholderRelation[]) =>
      run('saving', async () => {
        if (!view) throw new Error('There are no stakeholders to save.');
        const shown = await saveFlow(projectId, view, stakeholders, relations);
        if (!mounted.current) return;
        setView(shown.view);
        setActors(shown.actors);
        changed.current();
      }),
    [projectId, run, view],
  );

  const approve = useCallback(
    (options: { model: boolean }) =>
      run('approving', async () => {
        if (!view) throw new Error('There are no stakeholders to approve.');
        const shown = await approveFlow(projectId, view, actors, options, (approved, making) => {
          if (!mounted.current) return;
          setView(approved);
          if (making) setWorking('making-actors');
        });
        if (!mounted.current) return;
        setView(shown.view);
        setActors(shown.actors);
        changed.current();
      }),
    [actors, projectId, run, view],
  );

  const makeActors = useCallback(
    (options: { model: boolean; confirm: boolean; approveFirst?: boolean }) =>
      run('making-actors', async () => {
        if (options.approveFirst) {
          if (!view || view.revision === null)
            throw new Error('There are no stakeholders to approve.');
          const approved = await stakeholdersApi.approve(projectId, view.revision);
          if (!mounted.current) return;
          setView(approved);
        }
        const made = await stakeholdersApi.makeActors(projectId, {
          model: options.model,
          confirm: options.confirm,
        });
        if (!mounted.current) return;
        setActors(made);
        changed.current();
      }),
    [projectId, run, view],
  );

  const saveActors = useCallback(
    (next: Actor[]) =>
      run('saving-actors', async () => {
        if (!actors || actors.revision === null) throw new Error('There are no actors to save.');
        const saved = await stakeholdersApi.saveActors(projectId, {
          actors: next,
          expectedRevision: actors.revision,
        });
        if (!mounted.current) return;
        setActors(saved);
        changed.current();
      }),
    [actors, projectId, run],
  );

  return {
    view,
    actors,
    loading,
    error,
    working,
    problem,
    stopped,
    reload,
    dismissProblem,
    dismissStop,
    discover,
    propose,
    exec,
    save,
    approve,
    makeActors,
    saveActors,
  };
}
