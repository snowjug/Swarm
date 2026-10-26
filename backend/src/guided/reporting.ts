import type { EvidenceChunk, ReportSection, SimulationReport } from '../../../shared/types.js';
import type { SimulatedInterview, SimulationMemory } from '../../../shared/guided.js';
import { buildLocalReport, reportMetrics, reviewLimitations } from '../agents/report.js';
import { AppError, throwIfAborted } from '../errors.js';
import { retrieve } from '../knowledge/retrieval.js';
import type { ModelGateway } from '../models/client.js';
import type { Repository } from '../storage/repository.js';
import { interviewProxy } from './interviews.js';
import { reportChapterSchema, reportPlanSchema, summarySchema } from './schemas.js';
import { requireConsole, traceOperation, updateConsole } from './state.js';
import { searchMemories, timeline, validateReferences } from './tools.js';

function limitations(repository: Repository, id: string): string[] {
  return [
    ...reviewLimitations(repository.get(id)),
    'Platform populations are separate fictional copies of the same prepared proxies. Combined inclination is the per-proxy average, not a larger independent human sample.',
    'Synthetic memories and generated interviews are simulated evidence, never real-world source facts.',
    'No tool browses the web, executes code or independently verifies the original documents.',
  ];
}

function platformSection(repository: Repository, id: string): ReportSection {
  const state = requireConsole(repository.get(id));
  return {
    title: 'Platform comparison and time horizon',
    body:
      state.platforms
        .map((run) => {
          const last = run.rounds.at(-1);
          if (!last)
            throw new AppError(
              409,
              'INCOMPLETE_SIMULATION',
              'Every selected platform needs recorded rounds.',
            );
          return (
            `${run.label}: ${run.currentRound} rounds (${run.elapsedMinutes} simulated minutes), final mean inclination ${last.meanOpinion.toFixed(3)}, ` +
            `${Math.round(last.supportShare * run.agents.length)} supportive and ${Math.round(last.oppositionShare * run.agents.length)} opposing fictional proxies, ` +
            `${run.rounds.reduce((sum, round) => sum + round.interactions, 0)} selected peer exposures.`
          );
        })
        .join('\n\n') +
      '\n\nInfo Plaza uses broadcast exposure; Topic Community uses bounded-confidence community exposure. ' +
      'These are independent synthetic contexts, not live social networks. Initial posts with nonzero strength are assumed directional inputs applied at round one in the local engine.',
    sourceIds: [],
    memoryIds: state.memories
      .filter((memory) => memory.kind === 'action')
      .slice(-4)
      .map((memory) => memory.id),
  };
}

export async function generateGuidedReport(
  repository: Repository,
  id: string,
  model: ModelGateway | null,
  signal: AbortSignal,
): Promise<void> {
  const project = repository.get(id);
  const state = requireConsole(project);
  const metrics = reportMetrics(project);
  await traceOperation(
    repository,
    id,
    'report',
    'review',
    'Simulation integrity review',
    { expectedRounds: project.roundCount, platforms: state.platforms.map((run) => run.platform) },
    () => {
      if (
        !state.platforms.length ||
        state.platforms.some(
          (run) => run.status !== 'completed' || run.rounds.length !== project.roundCount,
        )
      ) {
        throw new AppError(
          409,
          'INCOMPLETE_SIMULATION',
          'Finish all selected platforms before generating a report.',
        );
      }
      return limitations(repository, id);
    },
    (result) => ({ limitations: result }),
  );
  repository.update(id, { report: null });
  updateConsole(repository, id, (current) => ({ ...current, reportPlan: null, interviews: [] }));
  if (!model) {
    const report = await traceOperation(
      repository,
      id,
      'report',
      'review',
      'Rules-based report synthesis',
      { method: 'recorded-metric calculation', modelCalls: 0 },
      (): SimulationReport => {
        const base = buildLocalReport(project, repository.chunks(id));
        const comparison = platformSection(repository, id);
        return {
          ...base,
          executiveSummary: `${base.executiveSummary} The combined inclination averages each proxy across ${state.platforms.length} recorded platform context(s); platform-specific results are reported separately.`,
          sections: [base.sections[0]!, base.sections[1]!, comparison, ...base.sections.slice(2)],
          limitations: limitations(repository, id),
        };
      },
      (result) => ({
        title: result.title,
        chapters: result.sections.length,
        metrics: { ...result.metrics },
      }),
    );
    throwIfAborted(signal);
    repository.update(id, { report });
    updateConsole(repository, id, (current) => ({
      ...current,
      reportPlan: {
        title: report.title,
        sections: report.sections.map((section) => section.title),
        evidenceQueries: [project.question],
        interviewAgentIds: [],
        interviewQuestion: 'No generated interview is performed by the rules-based engine.',
        completedSections: report.sections.length,
      },
    }));
    return;
  }
  const plan = await traceOperation(
    repository,
    id,
    'report',
    'model',
    'Report outline and tool plan',
    { availableTools: ['evidence.search', 'memory.search', 'timeline.read', 'proxy.interview'] },
    async () => {
      const result = await model.json(
        reportPlanSchema,
        'Plan a conditional scenario report. JSON {title,sections,evidenceQueries,interviewAgentIds,interviewQuestion}. ' +
          '3-5 unique section titles3-100 chars;1-3 local evidence queries3-300 chars;0-2 unique supplied proxy IDs for optional fictional interviews; question5-500 chars. ' +
          'Tools only search supplied local sources/memories, inspect recorded timelines and interview fictional proxies. No web/shell access. Do not promise real-world prediction.',
        {
          question: project.question,
          metrics,
          platforms: timeline(state),
          agents: project.agents.map(({ id, name, role, opinion }) => ({
            id,
            name,
            role,
            opinion,
          })),
        },
        signal,
        2_000,
      );
      if (
        new Set(result.sections).size !== result.sections.length ||
        new Set(result.interviewAgentIds).size !== result.interviewAgentIds.length ||
        result.interviewAgentIds.some(
          (agentId) => !project.agents.some((agent) => agent.id === agentId),
        )
      ) {
        throw new AppError(
          502,
          'MODEL_OUTPUT_INVALID',
          'The report plan contains duplicate chapters or invalid interview targets.',
        );
      }
      return result;
    },
    (result) => ({ ...result }),
  );
  updateConsole(repository, id, (current) => ({
    ...current,
    reportPlan: { ...plan, completedSections: 0 },
  }));
  const sourceMap = new Map<string, EvidenceChunk>();
  const memoryMap = new Map<string, SimulationMemory>();
  for (const query of plan.evidenceQueries) {
    await traceOperation(
      repository,
      id,
      'report',
      'retrieval',
      'Local source and memory search',
      { query },
      () => ({
        evidence: retrieve(repository.chunks(id), query, 3),
        memories: searchMemories(state.memories, query, 4),
      }),
      (result) => ({
        evidence: result.evidence.map((chunk) => ({
          id: chunk.id,
          documentName: chunk.documentName,
          score: chunk.score,
          text: chunk.text,
        })),
        memories: result.memories.map((memory) => ({
          id: memory.id,
          platform: memory.platform,
          round: memory.round,
          text: memory.text,
        })),
      }),
    ).then((result) => {
      for (const chunk of result.evidence) if (sourceMap.size < 8) sourceMap.set(chunk.id, chunk);
      for (const memory of result.memories)
        if (memoryMap.size < 8) memoryMap.set(memory.id, memory);
    });
  }
  const recordedTimeline = await traceOperation(
    repository,
    id,
    'report',
    'retrieval',
    'Recorded timeline reconstruction',
    {},
    () => timeline(state),
    (result) => ({ platforms: result.map((run) => ({ ...run })) }),
  );
  const interviews: SimulatedInterview[] = [];
  for (const agentId of plan.interviewAgentIds) {
    const interview = await interviewProxy(
      repository,
      id,
      agentId,
      plan.interviewQuestion,
      model,
      signal,
      'report',
      `I${interviews.length + 1}`,
    );
    interviews.push(interview);
    updateConsole(repository, id, (current) => ({ ...current, interviews: [...interviews] }));
  }
  const context = {
    question: project.question,
    metrics,
    settings: project.settings,
    timeline: recordedTimeline,
    evidence: [...sourceMap.values()],
    memories: [...memoryMap.values()],
    interviews,
    limitations: limitations(repository, id),
  };
  const summary = await traceOperation(
    repository,
    id,
    'report',
    'model',
    'Executive summary',
    { recordedMetrics: { ...metrics } },
    () =>
      model.json(
        summarySchema,
        'Write a concise conditional simulation executive summary. JSON {summary};50-2000 chars, plain text. ' +
          'Use supplied recorded metrics exactly. Combined values average each fictional proxy across platforms. Never frame cohort shares as probabilities or simulated messages as real sources.',
        context,
        signal,
        1_200,
      ),
    (result) => ({ summary: result.summary }),
  );
  repository.update(id, {
    report: {
      generatedBy: 'llm',
      title: plan.title,
      executiveSummary: summary.summary,
      sections: [],
      limitations: context.limitations,
      metrics,
    },
  });
  for (const title of plan.sections) {
    throwIfAborted(signal);
    const chapter = await traceOperation(
      repository,
      id,
      'report',
      'model',
      `Write chapter: ${title}`,
      {
        title,
        sourceIds: [...sourceMap.keys()],
        memoryIds: [...memoryMap.keys()],
        interviewIds: interviews.map((interview) => interview.id),
      },
      async () => {
        const chapterResult = await model.json(
          reportChapterSchema,
          'Write the requested report chapter from supplied recorded data. JSON {body,sourceIds,memoryIds,interviewIds}. ' +
            'body30-3500 chars, plain text. Cite only supplied IDs; sourceIds refer to original unverified documents, memoryIds to synthetic activity, interviewIds to generated fictional interviews. ' +
            'Distinguish these categories. Use metrics exactly; no calibrated forecasts, invented statistics or hidden reasoning.',
          { title, executiveSummary: summary.summary, ...context },
          signal,
          2_000,
        );
        validateReferences(chapterResult.sourceIds, new Set(sourceMap.keys()), 'source passages');
        validateReferences(
          chapterResult.memoryIds,
          new Set(memoryMap.keys()),
          'synthetic memories',
        );
        validateReferences(
          chapterResult.interviewIds,
          new Set(interviews.map((interview) => interview.id)),
          'fictional interviews',
        );
        return chapterResult;
      },
      (result) => ({ title, ...result }),
    );
    const report = repository.get(id).report;
    if (!report) throw new Error('The draft report disappeared during chapter generation.');
    repository.update(id, {
      report: { ...report, sections: [...report.sections, { title, ...chapter }] },
    });
    updateConsole(repository, id, (current) => ({
      ...current,
      reportPlan: { ...plan, completedSections: report.sections.length + 1 },
    }));
    repository.update(id, {
      progress: 86 + Math.floor(((report.sections.length + 1) / plan.sections.length) * 13),
    });
  }
}
