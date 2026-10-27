import type { ConsoleStep, ExecutionStep, StepStatus } from '../../../shared/guided';
import type { ProjectDetail } from '../../../shared/types';

export const stepLabels: Record<ConsoleStep, string> = {
  knowledge: 'Graph Build',
  environment: 'Env Setup',
  simulation: 'Simulation',
  report: 'Report',
  interaction: 'Interaction',
};

export const stepOrder: ConsoleStep[] = [
  'knowledge',
  'environment',
  'simulation',
  'report',
  'interaction',
];

export const platformNames = { plaza: 'Info Plaza', community: 'Topic Community' } as const;

export function isGuided(project: ProjectDetail): boolean {
  return project.workflow === 'guided' && Boolean(project.console);
}

export function isBusy(project: ProjectDetail): boolean {
  return project.status === 'queued' || project.status === 'running';
}

export function needsPolling(project: ProjectDetail): boolean {
  return (
    isBusy(project) ||
    Boolean(
      project.console?.surveys?.some((survey) => ['queued', 'running'].includes(survey.status)),
    )
  );
}

export function stepStatus(project: ProjectDetail, step: ConsoleStep): StepStatus | null {
  return isGuided(project) ? project.console!.steps[step] : null;
}

export function stepAvailable(project: ProjectDetail, step: ConsoleStep): boolean {
  if (!isGuided(project)) return true;
  if (step === 'knowledge') return true;
  const index = stepOrder.indexOf(step);
  const previous = stepOrder[index - 1]!;
  return project.console!.steps[step] !== 'pending' || project.console!.steps[previous] === 'ready';
}

export function canExecute(project: ProjectDetail, step: ExecutionStep): boolean {
  if (!isGuided(project) || isBusy(project) || project.status === 'completed') return false;
  const state = project.console!;
  const status = state.steps[step];
  if (status === 'ready' || status === 'running' || status === 'queued' || status === 'paused')
    return false;
  if (status === 'failed' || status === 'cancelled') return state.activeStep === step;
  const index = stepOrder.indexOf(step);
  return index === 0 || state.steps[stepOrder[index - 1]!] === 'ready';
}

export function statusLabel(status: StepStatus | null): string {
  return status ?? 'not recorded';
}

export function initialStep(project: ProjectDetail): ConsoleStep {
  if (isGuided(project)) return project.console!.activeStep;
  if (project.report) return 'report';
  if (project.rounds.length) return 'simulation';
  if (project.agents.length) return 'environment';
  return 'knowledge';
}

export function actionLabel(type: string, local: boolean): string {
  if (type === 'seed') return 'Assumed seed input';
  if (local && type === 'update') return 'Local state update';
  if (local && type === 'observe') return 'Local observation';
  return type === 'reply' ? 'Simulated reply' : type === 'post' ? 'Simulated post' : type;
}
