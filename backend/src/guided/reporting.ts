import type { EvidenceChunk, ReportSection, SimulationReport } from '../../../shared/types.js';
import type { SimulatedInterview, SimulationMemory } from '../../../shared/guided.js';
import { buildLocalReport, reportMetrics, reviewLimitations } from '../agents/report.js';
import { AppError, throwIfAborted } from '../errors.js';
import { retrieve } from '../knowledge/retrieval.js';
import type { ModelGateway } from '../models/client.js';
import { jsonValidated } from '../models/validated.js';
import {
  reviewClaims,
  splitCoveredClaims,
  validateChapterClaims,
  type ChapterForReview,
} from '../grounding/review.js';
import {
  MAX_REVIEWED_CLAIMS,
  normalizeChapter,
  type ChapterIdentifiers,
} from '../grounding/normalize.js';
import { recordedFigures, type VerificationContext } from '../grounding/verify.js';
import type { Repository } from '../storage/repository.js';
import { interviewProxy } from './interviews.js';
import {
  reportChapterSchema,
  reportPlanSchema,
  summarySchema,
  TARGET_CHAPTER_BODY,
} from './schemas.js';
import { requireConsole, traceOperation, updateConsole } from './state.js';
import { searchMemories, timeline } from './tools.js';

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
    async () =>
      jsonValidated(
        model,
        reportPlanSchema,
        'Plan a conditional scenario report. JSON {title,sections,evidenceQueries,interviewAgentIds,interviewQuestion}. ' +
          'title: 3-180 chars. sections: an array of 3-5 unique chapter TITLES, each a short plain string of 3-100 characters (a heading: never an object, never a paragraph). Never use the words predict, prediction or forecast in a title: this explores possible scenarios and does not predict the future. ' +
          'evidenceQueries: 1-3 plain strings of 3-300 characters that search the local sources. interviewAgentIds: 0-2 unique supplied proxy IDs for optional fictional interviews. interviewQuestion: 5-500 chars. ' +
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
        (result) => {
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
              `The report plan contains duplicate chapters or invalid interview targets; interviewAgentIds must come from: ${project.agents.map((agent) => agent.id).join(', ')}.`,
            );
          }
        },
        // A live model has answered with objects, then with paragraphs, before a plain title list.
        3,
      ),
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
  const verification: VerificationContext = {
    passages: new Map([...sourceMap].map(([sourceId, chunk]) => [sourceId, chunk.text])),
    memories: new Map(
      [...memoryMap].map(([memoryId, memory]) => [
        memoryId,
        `${memory.text} ${memory.rationale ?? ''}`.trim(),
      ]),
    ),
    recorded: recordedFigures(repository.get(id), metrics),
  };
  const reviewChapters: ChapterForReview[] = [];
  const supplied: ChapterIdentifiers = {
    passages: verification.passages,
    memories: verification.memories,
    interviews: new Set(interviews.map((interview) => interview.id)),
  };
  // An interview's own citations point at passages and memories this chapter was not given. Offering
  // them invited a live model to copy identifiers it could not use, so only what it needs is passed.
  const chapterContext = {
    ...context,
    interviews: interviews.map(({ id: interviewId, agentId, question, answer }) => ({
      id: interviewId,
      agentId,
      question,
      answer,
    })),
    allowedIds: {
      sourceIds: [...sourceMap.keys()],
      memoryIds: [...memoryMap.keys()],
      interviewIds: interviews.map((interview) => interview.id),
    },
  };
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
      async () =>
        jsonValidated(
          model,
          reportChapterSchema,
          'Write the requested report chapter from supplied recorded data. JSON {body,sourceIds,memoryIds,interviewIds,claims}. ' +
            `body: plain text of 30-${TARGET_CHAPTER_BODY} characters; aim for 1,000-2,500 and keep it under ${TARGET_CHAPTER_BODY}. Cite only the IDs listed under allowedIds; sourceIds refer to original unverified documents, memoryIds to synthetic activity, interviewIds to generated fictional interviews. ` +
            'Distinguish these categories. Use metrics exactly; no calibrated forecasts, invented statistics or hidden reasoning. ' +
            `claims: 1-${MAX_REVIEWED_CLAIMS} atomic statements that your body makes and that carry its weight, each {text,kind,sourceIds,memoryIds,quote}. text restates something the body says (10-400 chars). ` +
            'kind is one of: source-fact (a passage states it; REQUIRES a quote copied exactly from a cited passage, and is otherwise shown as an extracted-claim), extracted-claim (a paraphrase of what a cited SOURCE passage says; use it only for the source text, never for what happened in the simulation), ' +
            'user-assumption (a setting, intervention or seed post), ai-hypothesis (your own speculation; cite nothing), simulated-event (something that happened in the simulation, such as a proxy posting, replying or changing its opinion; cite its memoryIds and cite no passage), ' +
            'analytical-conclusion (derived from the recorded metrics; use the exact figures). ' +
            "quote: JSON null (never an empty string) for every kind except source-fact and extracted-claim. For those two, use null unless you can copy ONE contiguous excerpt (12-300 characters) exactly from a passage listed in that same claim's sourceIds; never join sentences that are not next to each other, never reword inside a quote, and use null when unsure. " +
            'Each claim cites at most 3 passages and at most 3 memories. Each claim must restate something your body says, in words close to the body. ' +
            'If a supplied passage says anything relevant to this chapter, include at least one claim of kind source-fact or extracted-claim that restates what that passage says about the scenario’s starting conditions (never about the simulation’s results). ' +
            'Copy every ID exactly from allowedIds; never invent, alter or extend an ID (do not guess that a similar-looking memory exists), and never put an interview ID (I1, I2) or a passage ID in memoryIds. ' +
            'If no allowed ID fits a statement, give it a kind that cites nothing (analytical-conclusion or ai-hypothesis). ' +
            'Every number in the body and claims must come from the supplied metrics, timeline, memories or cited passages; do not invent statistics. The claims are independently checked.',
          { title, executiveSummary: summary.summary, ...chapterContext },
          signal,
          2_800,
          (value) => {
            validateChapterClaims(value, verification);
          },
          // Chapters carry the most structure; a live model often needs more than one correction.
          3,
        ),
      (result) => ({ title, ...result }),
    );
    // The same repair the validator applied, taken on the reply that was kept; the review discloses it.
    const normalized = normalizeChapter(chapter, supplied);
    const { claims, ...written } = normalized.chapter;
    const covered = splitCoveredClaims({ body: written.body, claims });
    reviewChapters.push({
      title,
      ...written,
      claims: covered.kept,
      droppedClaims: covered.dropped,
      overflowClaims: normalized.overflow,
      removedCitations: normalized.removedCitations,
      shortenedQuotes: normalized.shortenedQuotes,
      removedQuotes: normalized.removedQuotes,
      relabelledClaims: normalized.relabelled,
    });
    const report = repository.get(id).report;
    if (!report) throw new Error('The draft report disappeared during chapter generation.');
    repository.update(id, {
      report: { ...report, sections: [...report.sections, { title, ...written }] },
    });
    updateConsole(repository, id, (current) => ({
      ...current,
      reportPlan: { ...plan, completedSections: report.sections.length + 1 },
    }));
    repository.update(id, {
      progress: 86 + Math.floor(((report.sections.length + 1) / plan.sections.length) * 12),
    });
  }
  throwIfAborted(signal);
  const grounding = await traceOperation(
    repository,
    id,
    'report',
    'review',
    'Grounding review',
    { statements: reviewChapters.reduce((sum, chapter) => sum + chapter.claims.length, 0) },
    () =>
      reviewClaims({
        model,
        signal,
        chapters: reviewChapters,
        context: verification,
        now: new Date(),
      }),
    (review) => ({
      method: review.method,
      ...review.counts,
      unverifiedFigures: review.unverifiedFigures.length,
    }),
  );
  const drafted = repository.get(id).report;
  if (!drafted) throw new Error('The draft report disappeared before the grounding review.');
  repository.update(id, { report: { ...drafted, grounding }, progress: 99 });
}
