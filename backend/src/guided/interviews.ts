import type { ConsoleStep, SimulatedInterview } from '../../../shared/guided.js';
import { AppError, throwIfAborted } from '../errors.js';
import { retrieve } from '../knowledge/retrieval.js';
import type { ModelGateway } from '../models/client.js';
import type { Repository } from '../storage/repository.js';
import { interviewSchema } from './schemas.js';
import { requireConsole, traceOperation } from './state.js';
import { searchMemories, validateReferences } from './tools.js';

export async function interviewProxy(
  repository: Repository,
  id: string,
  agentId: string,
  question: string,
  model: ModelGateway,
  signal: AbortSignal,
  step: ConsoleStep,
  referenceId: string,
): Promise<SimulatedInterview> {
  const project = repository.get(id);
  const agent = project.agents.find((item) => item.id === agentId);
  if (!agent)
    throw new AppError(
      404,
      'TARGET_NOT_FOUND',
      'This fictional proxy does not belong to the scenario.',
    );
  const state = requireConsole(project);
  const evidence = retrieve(repository.chunks(id), question, 4);
  const relevant = state.memories.filter(
    (memory) => memory.agentId === agentId || memory.peerIds.includes(agentId),
  );
  const memories = searchMemories(relevant, question, 6);
  const result = await traceOperation(
    repository,
    id,
    step,
    'interview',
    'Fictional proxy interview',
    {
      agentId,
      question,
      sourceIds: evidence.map((chunk) => chunk.id),
      memoryIds: memories.map((memory) => memory.id),
    },
    async () => {
      const answer = await model.json(
        interviewSchema,
        'Answer as an EXPLICITLY FICTIONAL proxy in this recorded simulation, not a real person. ' +
          'JSON {answer,sourceIds,memoryIds}. Answer10-2500 chars, plain text, no hidden reasoning. ' +
          'Use supplied recorded state/memory and distinguish assumptions from source evidence. Do not pretend to know real private beliefs. ' +
          'Only cite provided source and synthetic-memory IDs. If evidence is absent, say so. Do not claim an actual survey of real people.',
        {
          scenario: project.question,
          question,
          agent,
          platformStates: state.platforms.map((run) => ({
            platform: run.platform,
            state: run.agents.find((item) => item.id === agentId) || null,
          })),
          evidence,
          memories,
        },
        signal,
        1_800,
      );
      validateReferences(
        answer.sourceIds,
        new Set(evidence.map((chunk) => chunk.id)),
        'source evidence',
      );
      validateReferences(
        answer.memoryIds,
        new Set(memories.map((memory) => memory.id)),
        'simulation memories',
      );
      return answer;
    },
    (answer) => ({
      agentId,
      answer: answer.answer,
      sourceIds: answer.sourceIds,
      memoryIds: answer.memoryIds,
      synthetic: true,
    }),
  );
  throwIfAborted(signal);
  return {
    id: referenceId,
    agentId,
    question,
    answer: result.answer,
    sourceIds: result.sourceIds,
    memoryIds: result.memoryIds,
  };
}
