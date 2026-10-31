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

/** What each stage is for, in words that need no knowledge of the engine. Shown under the stage name. */
export const stepHelp: Record<ConsoleStep, string> = {
  knowledge: 'Understand the evidence',
  environment: 'Review stakeholders and actors',
  simulation: 'Run and compare scenarios',
  report: 'Decision brief',
  interaction: 'Ask questions',
};

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

export type JourneyId =
  | 'question'
  | 'evidence'
  | 'stakeholders'
  | 'actors'
  | 'scenarios'
  | 'run'
  | 'progress'
  | 'results'
  | 'explore'
  | 'change'
  | 'compare'
  | 'export';

/** The path from a question to a result that can be shared, and the stage in which each step happens. */
export const journey: readonly { id: JourneyId; label: string; stage: ConsoleStep }[] = [
  { id: 'question', label: 'Question', stage: 'knowledge' },
  { id: 'evidence', label: 'Evidence', stage: 'knowledge' },
  { id: 'stakeholders', label: 'Stakeholders', stage: 'environment' },
  { id: 'actors', label: 'Actors', stage: 'environment' },
  { id: 'scenarios', label: 'Scenarios', stage: 'environment' },
  { id: 'run', label: 'Run', stage: 'simulation' },
  { id: 'progress', label: 'Progress', stage: 'simulation' },
  { id: 'results', label: 'Results', stage: 'report' },
  { id: 'explore', label: 'Explore', stage: 'interaction' },
  { id: 'change', label: 'Change', stage: 'simulation' },
  { id: 'compare', label: 'Compare', stage: 'report' },
  { id: 'export', label: 'Export', stage: 'report' },
];

const reached = (project: ProjectDetail, step: ConsoleStep): boolean =>
  ['running', 'paused', 'ready'].includes(stepStatus(project, step) ?? '');
const finished = (project: ProjectDetail, step: ConsoleStep): boolean =>
  stepStatus(project, step) === 'ready';

/**
 * A step is done only when the project's own record shows it. Exploring, comparing and exporting leave
 * no mark on the project, so they are never claimed as done.
 */
const journeyDone: Record<JourneyId, (project: ProjectDetail) => boolean> = {
  question: () => true,
  evidence: (project) => finished(project, 'knowledge'),
  stakeholders: (project) => finished(project, 'environment'),
  actors: (project) => finished(project, 'environment'),
  scenarios: (project) => finished(project, 'environment'),
  run: (project) => reached(project, 'simulation'),
  progress: (project) => finished(project, 'simulation'),
  results: (project) => finished(project, 'report'),
  explore: () => false,
  change: (project) => project.parentId !== null || project.settings.intervention !== null,
  compare: () => false,
  export: () => false,
};

/** The steps a stage is mainly about, in order, and the one to show when all of them are done. */
const stageJourney: Record<ConsoleStep, { own: readonly JourneyId[]; rest: JourneyId }> = {
  knowledge: { own: ['evidence'], rest: 'evidence' },
  environment: { own: ['stakeholders', 'actors', 'scenarios'], rest: 'actors' },
  simulation: { own: ['run', 'progress'], rest: 'progress' },
  report: { own: ['results'], rest: 'results' },
  interaction: { own: ['explore'], rest: 'explore' },
};

export interface JourneyItem {
  id: JourneyId;
  label: string;
  stage: ConsoleStep;
  done: boolean;
  /** The step the stage in view is about. Exactly one step is current. */
  current: boolean;
}

/** The journey for the stage in view. Empty for a record that has no guided stages to place it in. */
export function journeyItems(project: ProjectDetail, viewed: ConsoleStep): JourneyItem[] {
  if (!isGuided(project)) return [];
  const { own, rest } = stageJourney[viewed];
  const done = new Set(journey.filter((item) => journeyDone[item.id](project)).map((i) => i.id));
  const current = own.find((id) => !done.has(id)) ?? rest;
  return journey.map((item) => ({
    ...item,
    done: done.has(item.id),
    current: item.id === current,
  }));
}
