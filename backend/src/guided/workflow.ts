import type { ExecutionStep } from '../../../shared/guided.js';
import { actorCallBudget } from '../agents/actor.js';
import { AppError, throwIfAborted } from '../errors.js';
import type { ModelFactory } from '../orchestration/runner.js';
import { researchServiceFor } from '../research/service.js';
import type { Repository } from '../storage/repository.js';
import { prepareEnvironment } from './environment.js';
import { buildKnowledge } from './knowledge.js';
import { generateGuidedReport } from './reporting.js';
import { runPlatforms } from './simulation.js';
import { beginStage, completeStage, updateConsole } from './state.js';

/**
 * Research found nothing to build knowledge from: the stage goes back to waiting, as it was before it
 * started, so that sources can be added (or research started again) and the stage run again. It is not a
 * failure of the stage, and nothing is built from nothing.
 */
function holdKnowledge(repository: Repository, id: string): void {
  updateConsole(repository, id, (state) => ({
    ...state,
    steps: { ...state.steps, knowledge: 'pending' },
  }));
  repository.update(id, { status: 'draft', stage: 'intake', progress: 0, error: null });
  repository.addEvent(
    id,
    'knowledge',
    'There is nothing to build knowledge from yet. Add a source, or start research again.',
  );
}

export class GuidedWorkflow {
  constructor(
    private readonly repository: Repository,
    private readonly createModel: ModelFactory,
  ) {}

  async execute(
    id: string,
    step: ExecutionStep,
    signal: AbortSignal,
    resume = false,
  ): Promise<void> {
    beginStage(this.repository, id, step);
    const project = this.repository.get(id);
    const platforms = project.console?.environment?.platforms.length ?? 2;
    const maxCalls =
      step === 'simulation'
        ? actorCallBudget(
            project.agents.length || project.settings.agentCount,
            platforms,
            project.settings.rounds,
          )
        : // The report stage runs a plan, interviews, a summary, up to five chapters (each allowed up
          // to three corrective retries) and a grounding check; the rest is headroom.
          step === 'report'
          ? 40
          : 16;
    const model =
      project.mode === 'llm' ? this.createModel(this.repository.modelUse(id), { maxCalls }) : null;
    throwIfAborted(signal);
    switch (step) {
      case 'knowledge':
        // Research is the first phase of grounding: it finds, reads and adds the sources that the
        // knowledge is then built from. A project that has sources of its own, and no run waiting, is
        // grounded exactly as it always was.
        if ((await researchServiceFor(this.repository)?.beforeKnowledge(id, signal)) === 'hold') {
          holdKnowledge(this.repository, id);
          return;
        }
        throwIfAborted(signal);
        await buildKnowledge(this.repository, id, model, signal);
        break;
      case 'environment':
        await prepareEnvironment(this.repository, id, model, signal);
        break;
      case 'simulation':
        await runPlatforms(this.repository, id, model, signal, resume);
        break;
      case 'report':
        await generateGuidedReport(this.repository, id, model, signal);
        break;
      default:
        throw new AppError(400, 'UNKNOWN_STEP', 'The requested workflow step is not executable.');
    }
    throwIfAborted(signal);
    completeStage(this.repository, id, step);
  }
}
