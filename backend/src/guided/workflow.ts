import type { ExecutionStep } from '../../../shared/guided.js';
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

  async execute(id: string, step: ExecutionStep, signal: AbortSignal): Promise<void> {
    beginStage(this.repository, id, step);
    const project = this.repository.get(id);
    const model =
      project.mode === 'llm'
        ? this.createModel(
            (usage) => this.repository.recordUsage(id, usage.inputTokens, usage.outputTokens),
            { maxCalls: step === 'simulation' ? 24 : 16 },
          )
        : null;
    throwIfAborted(signal);
    switch (step) {
      case 'knowledge':
        await buildKnowledge(this.repository, id, model, signal);
        break;
      case 'environment':
        await prepareEnvironment(this.repository, id, model, signal);
        break;
      case 'simulation':
        await runPlatforms(this.repository, id, model, signal);
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
