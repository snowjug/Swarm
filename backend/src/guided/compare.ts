import type { ComparedRun, RoundMetrics, RunComparison } from '../../../shared/guided.js';
import type { ProjectDetail, RoundSnapshot } from '../../../shared/types.js';
import { AppError } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import { requireConsole } from './state.js';

const METRIC_KEYS = [
  'meanOpinion',
  'supportShare',
  'oppositionShare',
  'undecidedShare',
  'polarization',
  'activityCount',
] as const satisfies readonly (keyof RoundMetrics)[];

function metrics(snapshot: RoundSnapshot | undefined): RoundMetrics | null {
  if (!snapshot) return null;
  return {
    meanOpinion: snapshot.meanOpinion,
    supportShare: snapshot.supportShare,
    oppositionShare: snapshot.oppositionShare,
    undecidedShare: snapshot.undecidedShare,
    polarization: snapshot.polarization,
    activityCount: snapshot.activityCount,
  };
}

function delta(base: RoundMetrics | null, other: RoundMetrics | null): RoundMetrics | null {
  if (!base || !other) return null;
  return Object.fromEntries(
    METRIC_KEYS.map((key) => [key, other[key] - base[key]]),
  ) as unknown as RoundMetrics;
}

function describe(project: ProjectDetail): ComparedRun {
  const branch = project.console?.branch ?? null;
  return {
    id: project.id,
    name: project.name,
    status: project.console?.steps.simulation ?? project.status,
    seed: project.settings.seed,
    completedRounds: project.rounds.length,
    totalRounds: project.settings.rounds,
    branchFromRound: branch?.fromRound ?? null,
    intervention: project.settings.intervention,
  };
}

function sameState(left: RoundSnapshot, right: RoundSnapshot): boolean {
  return (
    left.meanOpinion === right.meanOpinion &&
    JSON.stringify(left.opinions) === JSON.stringify(right.opinions)
  );
}

/** Compares the recorded combined round history of two guided scenarios. */
export function compareRuns(
  repository: Repository,
  baseId: string,
  otherId: string,
): RunComparison {
  if (baseId === otherId) {
    throw new AppError(400, 'COMPARE_SAME_RUN', 'Choose a different scenario to compare with.');
  }
  const base = repository.get(baseId);
  const other = repository.get(otherId);
  const baseState = requireConsole(base);
  const otherState = requireConsole(other);
  if (!base.rounds.length || !other.rounds.length) {
    throw new AppError(
      409,
      'COMPARE_NO_ROUNDS',
      'Both scenarios need at least one saved simulation round to be compared.',
    );
  }
  let identicalThroughRound = 0;
  const shared = Math.min(base.rounds.length, other.rounds.length);
  while (identicalThroughRound < shared) {
    const left = base.rounds[identicalThroughRound];
    const right = other.rounds[identicalThroughRound];
    if (!left || !right || !sameState(left, right)) break;
    identicalThroughRound += 1;
  }

  const baseRoot = baseState.branch?.rootId ?? base.id;
  const otherRoot = otherState.branch?.rootId ?? other.id;
  const lineage: RunComparison['lineage'] =
    otherState.branch?.parentId === base.id
      ? 'base-is-parent'
      : baseState.branch?.parentId === other.id
        ? 'other-is-parent'
        : baseRoot === otherRoot
          ? 'siblings'
          : 'unrelated';
  const declaredChanges =
    lineage === 'base-is-parent'
      ? (otherState.branch?.changes ?? [])
      : lineage === 'other-is-parent'
        ? (baseState.branch?.changes ?? [])
        : [];

  const notes = [
    'These differences describe two recorded simulations under their stated assumptions. They are not forecasts, and a difference is not a causal estimate for any real population.',
  ];
  if (lineage === 'unrelated') {
    notes.push(
      'These scenarios do not share a branch lineage, so differences may come from different sources, seeds, populations, or settings.',
    );
  } else if (lineage === 'siblings') {
    notes.push(
      'These scenarios branch from the same root with possibly different changes; compare each against the root to attribute differences.',
    );
  } else if (!declaredChanges.length) {
    notes.push(
      'The branch declared no assumption changes. In local deterministic mode the rounds after the branch point are expected to be identical.',
    );
  }
  if (base.rounds.length < base.settings.rounds || other.rounds.length < other.settings.rounds) {
    notes.push('At least one scenario is incomplete; only recorded rounds are compared.');
  }
  if (base.mode === 'llm' || other.mode === 'llm') {
    notes.push(
      'Model-assisted rounds are not reproducible even from the same checkpoint, so differences can include model variability.',
    );
  }

  const length = Math.max(base.rounds.length, other.rounds.length);
  return {
    base: describe(base),
    other: describe(other),
    lineage,
    identicalThroughRound,
    rounds: Array.from({ length }, (_, index) => {
      const left = metrics(base.rounds[index]);
      const right = metrics(other.rounds[index]);
      return { round: index + 1, base: left, other: right, delta: delta(left, right) };
    }),
    declaredChanges,
    notes,
  };
}
