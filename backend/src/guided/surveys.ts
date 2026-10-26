import type { SurveyResponse } from '../../../shared/guided.js';
import { AppError, throwIfAborted } from '../errors.js';
import type { ModelGateway } from '../models/client.js';
import type { Repository } from '../storage/repository.js';
import { interviewProxy } from './interviews.js';
import { requireConsole, traceOperation, updateConsole } from './state.js';

export function recordedPosition(opinion: number): SurveyResponse['position'] {
  return opinion >= 0.2 ? 'supportive' : opinion <= -0.2 ? 'opposing' : 'undecided';
}

export async function executeSurvey(
  repository: Repository,
  id: string,
  surveyId: string,
  model: ModelGateway | null,
  signal: AbortSignal,
): Promise<void> {
  const state = requireConsole(repository.get(id));
  const survey = state.surveys.find((item) => item.id === surveyId);
  if (!survey) throw new Error('The queued survey is missing.');
  updateConsole(repository, id, (current) => ({
    ...current,
    surveys: current.surveys.map((item) =>
      item.id === surveyId ? { ...item, status: 'running' } : item,
    ),
  }));
  for (const agentId of survey.agentIds) {
    throwIfAborted(signal);
    const project = repository.get(id);
    const agent = project.agents.find((item) => item.id === agentId);
    if (!agent)
      throw new AppError(404, 'TARGET_NOT_FOUND', 'A survey target is not in this scenario.');
    let response: SurveyResponse;
    if (survey.kind === 'interview') {
      if (!model)
        throw new AppError(503, 'MODEL_REQUIRED', 'Generated surveys require a configured model.');
      const answer = await interviewProxy(
        repository,
        id,
        agentId,
        survey.question,
        model,
        signal,
        'interaction',
        `survey-${surveyId}-${agentId}`,
      );
      response = {
        agentId,
        answer: answer.answer,
        opinion: agent.opinion,
        position: recordedPosition(agent.opinion),
        sourceIds: answer.sourceIds,
        memoryIds: answer.memoryIds,
      };
    } else {
      response = await traceOperation(
        repository,
        id,
        'interaction',
        'review',
        'Recorded-state survey snapshot',
        { agentId, surveyId, generatedAnswer: false },
        (): SurveyResponse => ({
          agentId,
          answer: null,
          opinion: agent.opinion,
          position: recordedPosition(agent.opinion),
          sourceIds: agent.sourceIds,
          memoryIds: requireConsole(project)
            .memories.filter((memory) => memory.agentId === agentId)
            .slice(-4)
            .map((memory) => memory.id),
        }),
        (result) => ({ ...result }),
      );
    }
    throwIfAborted(signal);
    updateConsole(repository, id, (current) => ({
      ...current,
      surveys: current.surveys.map((item) =>
        item.id === surveyId ? { ...item, responses: [...item.responses, response] } : item,
      ),
    }));
  }
  updateConsole(repository, id, (current) => ({
    ...current,
    surveys: current.surveys.map((item) =>
      item.id === surveyId
        ? { ...item, status: 'completed', completedAt: new Date().toISOString() }
        : item,
    ),
  }));
}
