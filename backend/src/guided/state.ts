import { randomUUID } from 'node:crypto';
import type {
  ConsoleStep,
  ExecutionStep,
  GuidedConsoleState,
  JsonValue,
  OperationTrace,
} from '../../../shared/guided.js';
import type { ProjectDetail, Stage } from '../../../shared/types.js';
import { AppError, publicFailure } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import { readCheckpoint } from './checkpoint.js';

export const stepStage: Record<ExecutionStep, Stage> = {
  knowledge: 'knowledge',
  environment: 'personas',
  simulation: 'simulation',
  report: 'report',
};
const prerequisite: Record<ExecutionStep, ExecutionStep | null> = {
  knowledge: null,
  environment: 'knowledge',
  simulation: 'environment',
  report: 'simulation',
};

export function requireConsole(project: ProjectDetail): GuidedConsoleState {
  if (project.workflow !== 'guided' || !project.console) {
    throw new AppError(
      409,
      'GUIDED_PROJECT_REQUIRED',
      'Create or duplicate this project as a guided scenario first.',
    );
  }
  return project.console;
}

export function validateStep(project: ProjectDetail, step: ExecutionStep, resume = false): void {
  const state = requireConsole(project);
  if (project.status === 'completed') {
    throw new AppError(
      409,
      'PROJECT_READ_ONLY',
      'Completed scenarios are read-only. Duplicate the inputs to run another scenario.',
    );
  }
  const startable =
    step === 'simulation'
      ? ['pending', 'failed', 'cancelled', 'paused']
      : ['pending', 'failed', 'cancelled'];
  if (!startable.includes(state.steps[step])) {
    throw new AppError(
      409,
      'STEP_ALREADY_STARTED',
      'This stage is already active or ready. Inspect its result or continue to the next stage.',
    );
  }
  const previous = prerequisite[step];
  if (previous && state.steps[previous] !== 'ready') {
    throw new AppError(409, 'STEP_PREREQUISITE', `Complete ${previous} before starting ${step}.`);
  }
  if (resume && (step !== 'simulation' || readCheckpoint(project) === null)) {
    throw new AppError(
      409,
      'NO_CHECKPOINT',
      'There is no saved, consistent simulation round to resume from. Restart the simulation instead.',
    );
  }
}

export function updateConsole(
  repository: Repository,
  id: string,
  transform: (state: GuidedConsoleState) => GuidedConsoleState,
): ProjectDetail {
  return repository.update(id, { console: transform(requireConsole(repository.get(id))) });
}

export function beginStage(repository: Repository, id: string, step: ExecutionStep): void {
  updateConsole(repository, id, (state) => ({
    ...state,
    activeStep: step,
    steps: { ...state.steps, [step]: 'running' },
  }));
  repository.update(id, {
    status: 'running',
    stage: stepStage[step],
    error: null,
    progress: { knowledge: 5, environment: 25, simulation: 40, report: 85 }[step],
  });
  repository.addEvent(
    id,
    stepStage[step],
    `${step} started. This stage runs independently and persists its result before continuing.`,
  );
}

export function completeStage(repository: Repository, id: string, step: ExecutionStep): void {
  updateConsole(repository, id, (state) => ({
    ...state,
    steps: {
      ...state.steps,
      [step]: 'ready',
      ...(step === 'report' ? { interaction: 'ready' as const } : {}),
    },
  }));
  repository.update(id, {
    status: step === 'report' ? 'completed' : 'ready',
    stage: step === 'report' ? 'complete' : stepStage[step],
    progress: { knowledge: 25, environment: 40, simulation: 85, report: 100 }[step],
    error: null,
  });
  repository.addEvent(
    id,
    stepStage[step],
    `${step} complete. Results are persisted; the next stage requires your explicit action.`,
  );
}

export function failStage(
  repository: Repository,
  id: string,
  step: ExecutionStep,
  error: unknown,
): void {
  const safe = publicFailure(error);
  const cancelled = safe.code === 'RUN_CANCELLED';
  // A pause is only resumable when at least one complete, consistent round was saved.
  const paused =
    safe.code === 'RUN_PAUSED' &&
    step === 'simulation' &&
    readCheckpoint(repository.get(id)) !== null;
  const interrupted = cancelled || safe.code === 'RUN_PAUSED';
  updateConsole(repository, id, (state) => ({
    ...state,
    steps: {
      ...state.steps,
      [step]: paused ? 'paused' : interrupted ? 'cancelled' : 'failed',
    },
    platforms: state.platforms.map((platform) => ({
      ...platform,
      status:
        platform.status === 'running'
          ? paused
            ? 'paused'
            : interrupted
              ? 'cancelled'
              : 'failed'
          : platform.status,
    })),
    traces: state.traces.map((trace) =>
      trace.status === 'running'
        ? { ...trace, status: 'failed', completedAt: new Date().toISOString(), error: safe.message }
        : trace,
    ),
  }));
}

export async function traceOperation<T>(
  repository: Repository,
  id: string,
  step: ConsoleStep,
  kind: OperationTrace['kind'],
  name: string,
  input: JsonValue,
  operation: () => Promise<T> | T,
  summarize: (result: T) => JsonValue,
): Promise<T> {
  const trace: OperationTrace = {
    id: randomUUID(),
    step,
    kind,
    name,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    input,
    output: null,
    error: null,
  };
  updateConsole(repository, id, (state) => ({
    ...state,
    traces: [...state.traces, trace].slice(-120),
  }));
  try {
    const result = await operation();
    updateConsole(repository, id, (state) => ({
      ...state,
      traces: state.traces.map((item) =>
        item.id === trace.id
          ? {
              ...item,
              status: 'completed',
              completedAt: new Date().toISOString(),
              output: summarize(result),
            }
          : item,
      ),
    }));
    return result;
  } catch (error) {
    updateConsole(repository, id, (state) => ({
      ...state,
      traces: state.traces.map((item) =>
        item.id === trace.id
          ? {
              ...item,
              status: 'failed',
              completedAt: new Date().toISOString(),
              error: publicFailure(error).message,
            }
          : item,
      ),
    }));
    throw error;
  }
}
