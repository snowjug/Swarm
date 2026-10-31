import type { ConsoleStep, ExecutionStep, StepStatus } from '../../../shared/guided';
import type { LabProgress } from '../../../shared/lab';
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

/**
 * Whether a stage can be opened. The engine's own order holds, and the scenario lab opens two stages
 * that it does not need the engine for: Simulation as soon as there are simulated actors to compare,
 * and Report once a comparison has finished, so that the brief is not behind a run the lab never
 * asks for. Running a stage is a different question, and `canExecute` is unchanged.
 */
export function stepAvailable(project: ProjectDetail, step: ConsoleStep): boolean {
  if (!isGuided(project)) return true;
  if (step === 'knowledge') return true;
  if (step === 'simulation' && (project.lab?.actors ?? 0) > 0) return true;
  if (step === 'report' && project.lab?.analysis === 'completed') return true;
  const index = stepOrder.indexOf(step);
  const previous = stepOrder[index - 1]!;
  return project.console!.steps[step] !== 'pending' || project.console!.steps[previous] === 'ready';
}

/**
 * The small label under a stage's name: the engine's status, or, where the engine has not run the
 * stage but the lab has done its work, what that was. Nothing is shown that the project's record
 * does not hold.
 */
export function stepStatusLabel(project: ProjectDetail, step: ConsoleStep): string {
  const status = stepStatus(project, step);
  if (status === null) return 'historical view';
  const lab = project.lab;
  if (status !== 'pending' || !lab) return status;
  if (step === 'environment' && lab.actors > 0) return 'actors ready';
  if (step === 'simulation' && lab.analysis === 'running') return 'comparing';
  if (step === 'simulation' && lab.analysis === 'completed') return 'compared';
  if (step === 'report' && lab.brief) return 'brief written';
  if (step === 'report' && lab.analysis === 'completed') return 'ready to write';
  return status;
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

const comparing = (lab: LabProgress): boolean =>
  lab.analysis === 'running' || lab.analysis === 'completed';

/**
 * What the scenario lab's own record adds. Approving the stakeholders and making the actors, running
 * and finishing a comparison, and writing the brief are all stored, so they count whether or not the
 * engine's stages ran. The brief stands for Export because it is what there is to share.
 */
const labDone: Partial<Record<JourneyId, (lab: LabProgress) => boolean>> = {
  stakeholders: (lab) => lab.stakeholders === 'approved',
  actors: (lab) => lab.actors > 0,
  scenarios: comparing,
  run: comparing,
  progress: (lab) => lab.analysis === 'completed',
  results: (lab) => lab.analysis === 'completed',
  export: (lab) => lab.brief,
};

/** Done by either record: a project that never used the lab keeps the engine's alone. */
const isDone = (project: ProjectDetail, id: JourneyId): boolean =>
  journeyDone[id](project) || (project.lab !== undefined && labDone[id]?.(project.lab) === true);

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
  const done = new Set(journey.filter((item) => isDone(project, item.id)).map((item) => item.id));
  const current = own.find((id) => !done.has(id)) ?? rest;
  return journey.map((item) => ({
    ...item,
    done: done.has(item.id),
    current: item.id === current,
  }));
}

export interface NextStep {
  /** The sentence beside the button. */
  text: string;
  /** The button, which opens `to`. */
  label: string;
  to: ConsoleStep;
}

/**
 * The one move to offer once a comparison has finished: from the comparison to the decision brief, and
 * back. Nothing is offered while there is no finished comparison, or in any other stage, where the
 * stage itself says what to do.
 */
export function nextStep(step: ConsoleStep, lab: LabProgress | undefined): NextStep | null {
  if (lab?.analysis !== 'completed') return null;
  if (step === 'simulation') {
    return {
      text: 'The comparison has finished. The decision brief says what it shows and what to do about it.',
      label: 'See the decision brief',
      to: 'report',
    };
  }
  if (step === 'report') {
    return {
      text: 'The brief is written from the comparison. Open the comparison for its charts, or to run another.',
      label: 'Back to the comparison',
      to: 'simulation',
    };
  }
  return null;
}

/**
 * Whether to read the project again every few seconds: while a comparison is running and the person
 * is in a stage that shows its result. The comparison runs on the server, and the project's progress
 * is not otherwise read again until something is done.
 */
export function labPollingNeeded(project: ProjectDetail, step: ConsoleStep): boolean {
  return (step === 'simulation' || step === 'report') && project.lab?.analysis === 'running';
}

/**
 * The view the workspace starts in. A project with simulated actors starts with the workbench alone:
 * the map beside it is drawn from the words of the evidence and says nothing about the actors. The
 * person can still open it.
 */
export function defaultView(project: ProjectDetail): 'split' | 'workbench' {
  return isGuided(project) && (project.lab?.actors ?? 0) > 0 ? 'workbench' : 'split';
}

/**
 * A project that came back from something the person did (a run, a branch) has no `lab`, because only
 * reading one project adds it. The last one read stays until the next read, which follows at once, so
 * that nothing the person is looking at jumps in between.
 */
export function keepLab(next: ProjectDetail, previous: ProjectDetail | null): ProjectDetail {
  if (next.lab || !previous?.lab || previous.id !== next.id) return next;
  return { ...next, lab: previous.lab };
}
