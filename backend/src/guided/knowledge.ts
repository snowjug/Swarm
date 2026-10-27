import type { KnowledgeGraph } from '../../../shared/types.js';
import type { Ontology } from '../../../shared/guided.js';
import { buildLocalGraph, validateCitations } from '../knowledge/graph.js';
import { selectContext } from '../knowledge/retrieval.js';
import type { ModelGateway } from '../models/client.js';
import { jsonValidated } from '../models/validated.js';
import { validateNodeQuotes } from '../grounding/graph.js';
import type { Repository } from '../storage/repository.js';
import { AppError, throwIfAborted } from '../errors.js';
import { guidedGraphSchema, ontologySchema, type GuidedGraph } from './schemas.js';
import { traceOperation, updateConsole } from './state.js';

function assertUniqueTypes(ontology: Ontology): void {
  const typeNames = new Set(ontology.entityTypes.map((type) => type.name));
  const relationNames = new Set(ontology.relationshipTypes.map((type) => type.name));
  if (
    typeNames.size !== ontology.entityTypes.length ||
    relationNames.size !== ontology.relationshipTypes.length
  ) {
    throw new AppError(
      502,
      'MODEL_OUTPUT_INVALID',
      'The ontology contains duplicate type names; every entity and relationship name must be unique.',
    );
  }
}

export async function buildKnowledge(
  repository: Repository,
  id: string,
  model: ModelGateway | null,
  signal: AbortSignal,
): Promise<void> {
  const project = repository.get(id);
  const chunks = repository.chunks(id);
  const evidence = selectContext(chunks, project.question);
  const ontology = await traceOperation(
    repository,
    id,
    'knowledge',
    model ? 'model' : 'review',
    'Ontology definition',
    { mode: project.mode, sourceIds: evidence.map((chunk) => chunk.id) },
    async (): Promise<Ontology> =>
      model
        ? jsonValidated(
            model,
            ontologySchema,
            'Define a small ontology for the supplied sources and scenario question. JSON {entityTypes:[{name,description}],relationshipTypes:[{name,description}]}. ' +
              '1-12 entity types, 1-16 relationship types; names2-60 chars, descriptions5-400. Use source-grounded categories, not executable schemas or private personal beliefs.',
            { question: project.question, evidence },
            signal,
            2_500,
            assertUniqueTypes,
          )
        : {
            entityTypes: [
              {
                name: 'Topic',
                description:
                  'An informative term extracted lexically from the supplied passages, not a verified semantic entity.',
              },
            ],
            relationshipTypes: [
              {
                name: 'co-occurs with',
                description:
                  'Terms mentioned in the same overlapping passage; this is not a causal claim.',
              },
            ],
          },
    (result) => ({
      entityTypes: result.entityTypes.map((type) => ({ ...type })),
      relationshipTypes: result.relationshipTypes.map((type) => ({ ...type })),
    }),
  );
  const typeNames = new Set(ontology.entityTypes.map((type) => type.name));
  const relationNames = new Set(ontology.relationshipTypes.map((type) => type.name));
  assertUniqueTypes(ontology);
  throwIfAborted(signal);
  updateConsole(repository, id, (state) => ({ ...state, ontology }));
  repository.update(id, { progress: 14 });
  const graph = await traceOperation(
    repository,
    id,
    'knowledge',
    model ? 'model' : 'retrieval',
    'Source graph construction',
    {
      passages: chunks.length,
      selectedPassages: evidence.length,
      method: model ? 'llm' : 'lexical',
    },
    async (): Promise<KnowledgeGraph> => {
      if (!model) {
        const local = buildLocalGraph(chunks, project.question);
        return { ...local, nodes: local.nodes.map((node) => ({ ...node, entityType: 'Topic' })) };
      }
      const allowed = new Set(evidence.map((chunk) => chunk.id));
      const passages = new Map(evidence.map((chunk) => [chunk.id, chunk.text]));
      const validateGraph = (value: GuidedGraph): void => {
        const ids = new Set(value.nodes.map((node) => node.id));
        if (ids.size !== value.nodes.length)
          throw new AppError(
            502,
            'MODEL_OUTPUT_INVALID',
            'The graph has duplicate node IDs; every node id must be unique.',
          );
        for (const node of value.nodes) {
          if (!typeNames.has(node.entityType))
            throw new AppError(
              502,
              'MODEL_OUTPUT_INVALID',
              `A graph node uses an unknown ontology type; entityType must be one of: ${[...typeNames].join(', ')}.`,
            );
          validateCitations(node.sourceIds, allowed);
        }
        validateNodeQuotes(value.nodes, passages);
        for (const edge of value.edges) {
          if (
            !ids.has(edge.source) ||
            !ids.has(edge.target) ||
            edge.source === edge.target ||
            !relationNames.has(edge.label)
          ) {
            throw new AppError(
              502,
              'MODEL_OUTPUT_INVALID',
              `The graph contains an invalid relation or endpoint; edge labels must be one of: ${[...relationNames].join(', ')} and endpoints must be distinct node ids.`,
            );
          }
          validateCitations(edge.sourceIds, allowed);
        }
      };
      const extracted = await jsonValidated(
        model,
        guidedGraphSchema,
        'Extract a source-grounded graph under the supplied ontology. JSON {nodes:[{id,label,kind,entityType,summary,weight,sourceIds,quote}],edges:[{source,target,label,weight,sourceIds}]}. ' +
          '2-16 unique nodes, at most40 edges. IDs use letters/numbers/_/-. kind is topic/person/organization/group. entityType must be a supplied ontology entity type; edge label must be a supplied relationship name. ' +
          'Every node/edge cites1-5 supplied source IDs. Weights0.1-1. No invented causal links or inferred private beliefs. ' +
          'Every node also needs quote: an EXACT excerpt (12-240 characters) copied from one of that node’s cited passages showing the source describes it. The quote is checked character by character.',
        { question: project.question, ontology, evidence },
        signal,
        7_000,
        validateGraph,
      );
      return {
        method: 'llm',
        ...extracted,
        notes: [
          `Model extraction used ${evidence.length} selected passages of ${chunks.length}; long sources are excerpted.`,
          'Citations establish provenance, not source truth or semantic entailment.',
          'Simulation memory is stored separately from seed evidence and is explicitly synthetic.',
        ],
      };
    },
    (result) => ({
      nodes: result.nodes.length,
      edges: result.edges.length,
      nodeTypes: [...new Set(result.nodes.map((node) => node.entityType || node.kind))],
    }),
  );
  throwIfAborted(signal);
  repository.update(id, { graph });
}
