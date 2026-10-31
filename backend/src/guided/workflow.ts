import type { ExecutionStep } from '../../../shared/guided.js';
import { actorCallBudget } from '../agents/actor.js';
import { AppError, throwIfAborted } from '../errors.js';
import type { ModelFactory } from '../orchestration/runner.js';
import type { Repository } from '../storage/repository.js';
import { prepareEnvironment } from './environment.js';
import { buildKnowledge } from './knowledge.js';
import { generateGuidedReport } from './reporting.js';
import { runPlatforms } from './simulation.js';
import { beginStage, completeStage } from './state.js';

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
