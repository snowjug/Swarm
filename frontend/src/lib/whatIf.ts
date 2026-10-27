import { branchInputSchema, interventionUpdateSchema } from '../../../shared/guided';
import type { BranchChange, BranchInput, RunComparison } from '../../../shared/guided';
import type { Intervention, ProjectDetail, ProjectSummary } from '../../../shared/types';
import { isBusy, isGuided, stepStatus } from './console';
import { signed } from './format';

export function resumeActionLabel(
  project: Pick<ProjectDetail, 'currentRound' | 'roundCount'>,
): string {
  const first = project.currentRound + 1;
  if (first > project.roundCount) return 'Resume — no rounds remaining';
  return first === project.roundCount
    ? `Resume — simulate round ${first}`
    : `Resume — simulate rounds ${first}–${project.roundCount}`;
}

export function hasCheckpoint(project: ProjectDetail): boolean {
  return project.rounds.length > 0 && project.currentRound > 0;
}

export function canResume(project: ProjectDetail): boolean {
  return (
    isGuided(project) &&
    !isBusy(project) &&
    hasCheckpoint(project) &&
    project.currentRound < project.roundCount &&
    ['paused', 'failed', 'cancelled'].includes(stepStatus(project, 'simulation') ?? '')
  );
}

export function canBranch(project: ProjectDetail): boolean {
  return (
    isGuided(project) &&
    !isBusy(project) &&
    ['paused', 'ready', 'failed'].includes(stepStatus(project, 'simulation') ?? '')
  );
}

export function canEditIntervention(project: ProjectDetail): boolean {
  const status = stepStatus(project, 'simulation');
  return (
    isGuided(project) &&
    !isBusy(project) &&
    (status === 'paused' || (status === 'failed' && hasCheckpoint(project))) &&
    project.currentRound < project.roundCount
  );
}

export function maxBranchRound(project: ProjectDetail): number {
  return Math.max(0, Math.min(project.rounds.length, project.currentRound, project.roundCount - 1));
}

export function historyStatus(project: ProjectSummary): ProjectSummary['status'] | 'paused' {
  return project.workflow === 'guided' &&
    project.status === 'ready' &&
    project.stage === 'simulation' &&
    project.currentRound > 0 &&
    project.currentRound < project.roundCount
    ? 'paused'
    : project.status;
}

export function validateIntervention(
  value: unknown,
  project: ProjectDetail,
): { data: Intervention | null; error?: never } | { error: string; data?: never } {
  const parsed = interventionUpdateSchema.safeParse(value);
  if (!parsed.success)
    return { error: parsed.error.issues.map((issue) => issue.message).join(' ') };
  if (
    parsed.data &&
    (parsed.data.round <= project.currentRound || parsed.data.round > project.roundCount)
  )
    return {
      error: `Choose a future round from ${project.currentRound + 1} through ${project.roundCount}.`,
    };
  return { data: parsed.data };
}

export function validateBranch(
  value: unknown,
  project: ProjectDetail,
): { data: BranchInput; error?: never } | { error: string; data?: never } {
  const parsed = branchInputSchema.safeParse(value);
  if (!parsed.success)
    return { error: parsed.error.issues.map((issue) => issue.message).join(' ') };
  const input = parsed.data;
  if (input.fromRound > maxBranchRound(project))
    return { error: `Choose a checkpoint from round 0 through ${maxBranchRound(project)}.` };
  if (input.agentEdits.some((edit) => !project.agents.some((agent) => agent.id === edit.id)))
    return { error: 'Choose proxies that exist in the source run.' };
  if (
    input.intervention &&
    (input.intervention.round <= input.fromRound || input.intervention.round > project.roundCount)
  )
    return {
      error: `The replacement intervention must occur after round ${input.fromRound} and no later than round ${project.roundCount}.`,
    };
  const alreadyApplied = project.rounds.some(
    (round) => round.round <= input.fromRound && round.intervention,
  );
  if (input.intervention !== undefined && alreadyApplied)
    return {
      error:
        'The copied rounds already contain this run’s intervention. Inherit it, or branch from before it was applied to remove or replace it.',
    };
  return { data: input };
}

function describeIntervention(value: Intervention | null): string {
  return value
    ? `round ${value.round}: “${value.label}” (stance ${signed(value.stance)}, strength ${value.strength.toFixed(2)})`
    : 'none';
}

export function describeChange(change: BranchChange, project?: ProjectDetail): string {
  if (change.kind === 'intervention')
    return `Scheduled intervention: ${describeIntervention(change.from)} → ${describeIntervention(change.to)}.`;
  const name = project?.agents.find((agent) => agent.id === change.agentId)?.name ?? change.agentId;
  const label = change.field === 'opinion' ? 'inclination' : change.field;
  return `${name} — ${label}: ${change.from.toFixed(2)} → ${change.to.toFixed(2)}.`;
}

export function lineageSentence(comparison: RunComparison): string {
  const { base, other, lineage } = comparison;
  if (lineage === 'base-is-parent') return `${base.name} is the parent run of ${other.name}.`;
  if (lineage === 'other-is-parent') return `${other.name} is the parent run of ${base.name}.`;
  if (lineage === 'siblings') return `${base.name} and ${other.name} share a parent run.`;
  return `${base.name} and ${other.name} are not in the same recorded parent/sibling relationship.`;
}
