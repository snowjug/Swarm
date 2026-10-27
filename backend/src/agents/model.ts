import type {
  Agent,
  EvidenceChunk,
  KnowledgeGraph,
  ProjectDetail,
  SimulationReport,
} from '../../../shared/types.js';
import { AppError } from '../errors.js';
import { validateCitations } from '../knowledge/graph.js';
import { selectContext } from '../knowledge/retrieval.js';
import type { ModelGateway } from '../models/client.js';
import {
  extractedGraphSchema,
  generatedReportSchema,
  personasSchema,
  type ExtractedGraph,
  type GeneratedPersonas,
  type GeneratedReport,
} from '../models/schemas.js';
import { jsonValidated } from '../models/validated.js';
import { validateNodeQuotes } from '../grounding/graph.js';
import { reportMetrics, reviewLimitations } from './report.js';

function invalid(message: string): never {
  throw new AppError(502, 'MODEL_OUTPUT_INVALID', message);
}

function validateReportCitations(report: GeneratedReport, allowed: Set<string>): void {
  for (const section of report.sections) validateCitations(section.sourceIds, allowed);
}

export async function modelGraph(
  model: ModelGateway,
  project: ProjectDetail,
  chunks: EvidenceChunk[],
  signal: AbortSignal,
): Promise<KnowledgeGraph> {
  const evidence = selectContext(chunks, project.question);
  const allowed = new Set(evidence.map((chunk) => chunk.id));
  const passages = new Map(evidence.map((chunk) => [chunk.id, chunk.text]));
  const validate = (value: ExtractedGraph): void => {
    const nodeIds = new Set(value.nodes.map((node) => node.id));
    if (nodeIds.size !== value.nodes.length)
      invalid('The model returned duplicate graph node IDs.');
    for (const node of value.nodes) validateCitations(node.sourceIds, allowed);
    validateNodeQuotes(value.nodes, passages);
    for (const edge of value.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
        invalid('The model returned an invalid graph edge reference.');
      }
      validateCitations(edge.sourceIds, allowed);
    }
  };
  const extracted = await jsonValidated(
    model,
    extractedGraphSchema,
    'Extract a source-grounded graph. JSON: {nodes:[{id,label,kind,summary,weight,sourceIds,quote}],edges:[{source,target,label,weight,sourceIds}]}. ' +
      'Use 2-16 nodes, at most 40 edges, short unique IDs, kinds topic/person/organization/group, weights 0.1-1. ' +
      'Every node and edge needs 1-5 actual supplied evidence IDs. Describe only evidence-supported relations; no invented causal certainty. ' +
      'Every node also needs quote: an EXACT excerpt (12-240 characters) copied from one of that node’s cited passages showing the source describes it. The quote is checked character by character.',
    { question: project.question, evidence },
    signal,
    7_000,
    validate,
  );
  return {
    method: 'llm',
    ...extracted,
    notes: [
      `Model inspected ${evidence.length} selected passages out of ${chunks.length}; long sources are excerpted.`,
      'Citation IDs were validated; semantic entailment and source truth were not independently verified.',
      'Graph entities are source descriptions. Any subsequent personas remain fictional proxies.',
    ],
  };
}

export async function modelPersonas(
  model: ModelGateway,
  project: ProjectDetail,
  graph: KnowledgeGraph,
  chunks: EvidenceChunk[],
  signal: AbortSignal,
): Promise<Agent[]> {
  const evidence = selectContext(chunks, project.question, 7_000);
  const count = project.settings.agentCount;
  const expected = new Set(Array.from({ length: count }, (_, index) => `agent-${index + 1}`));
  const topics = new Set(graph.nodes.map((node) => node.id));
  const allowed = new Set(evidence.map((chunk) => chunk.id));
  const validate = (value: GeneratedPersonas): void => {
    if (
      value.agents.length !== count ||
      new Set(value.agents.map((agent) => agent.id)).size !== count
    ) {
      invalid(
        `The model must return exactly ${count} proxies with unique ids agent-1 to agent-${count}.`,
      );
    }
    for (const agent of value.agents) {
      if (!expected.has(agent.id) || agent.topicIds.some((id) => !topics.has(id))) {
        invalid(
          `Proxy ids must be agent-1 to agent-${count} and topicIds must be graph node ids (${[...topics].slice(0, 16).join(', ')}).`,
        );
      }
      validateCitations(agent.sourceIds, allowed);
    }
  };
  const result = await jsonValidated(
    model,
    personasSchema,
    `Construct exactly ${count} diverse FICTIONAL stakeholder proxies, IDs agent-1 through agent-${count}. ` +
      'Do not impersonate any source individual. JSON {agents:[{id,name,role,persona,goals,constraints,topicIds,initialOpinion,influence,openness,sourceIds}]}. ' +
      'Persona 30-500 chars; topicIds reference graph nodes; sourceIds reference 1-5 supplied evidence passages. ' +
      'goals: 1-3 short strings for what this proxy is trying to achieve; constraints: 1-3 short strings for what limits it (budget, time, mandate, information). Make each proxy want something different. ' +
      'initialOpinion -1..1 is an ASSUMED inclination toward the question, not an inferred real belief; influence 0.1..2; openness 0..1. ' +
      'Use short fictional proxy names and a mix of positions; explain assumptions in persona text.',
    { question: project.question, graph, evidence, seed: project.settings.seed },
    signal,
    undefined,
    validate,
  );
  return result.agents.map((agent) => ({
    ...agent,
    name: `Proxy ${agent.id.slice(6)}: ${agent.name}`,
    persona: `Fictional proxy; not a real person's beliefs. ${agent.persona}`,
    opinion: agent.initialOpinion,
    memory: [],
  }));
}

export async function modelReport(
  model: ModelGateway,
  project: ProjectDetail,
  chunks: EvidenceChunk[],
  signal: AbortSignal,
): Promise<SimulationReport> {
  const metrics = reportMetrics(project);
  const limitations = reviewLimitations(project);
  const evidence = selectContext(chunks, project.question, 7_000);
  const allowed = new Set(evidence.map((chunk) => chunk.id));
  const result = await jsonValidated(
    model,
    generatedReportSchema,
    'Write a conditional simulation report using the recorded metrics exactly, not invented statistics. ' +
      'JSON {title,executiveSummary,sections:[{title,body,sourceIds}],limitations:[string]}. ' +
      '3-6 sections, bodies 30-3500 chars, summary 50-2000 chars; plain text. Cite only supplied passages. ' +
      'Explain scenario assumptions, trajectory, disagreement, intervention if any, evidence limitations, and useful control experiments. ' +
      'Do not claim predictive accuracy, causation or factual real-person intentions. Distinguish simulated messages from source evidence.',
    {
      question: project.question,
      settings: project.settings,
      metrics,
      trajectory: project.rounds.map(
        ({ actions: _actions, opinions: _opinions, ...summary }) => summary,
      ),
      agents: project.agents.map(({ id, name, role, initialOpinion, opinion }) => ({
        id,
        name,
        role,
        initialOpinion,
        opinion,
      })),
      finalActions: project.rounds.at(-1)?.actions,
      limitations,
      evidence,
    },
    signal,
    6_000,
    (value) => validateReportCitations(value, allowed),
  );
  return {
    ...result,
    generatedBy: 'llm',
    limitations: [...new Set([...limitations, ...result.limitations])],
    metrics,
  };
}
