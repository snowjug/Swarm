import type { EnvironmentUpdate, SeedPost } from '../../../shared/guided.js';
import { environmentSchema } from '../../../shared/guided.js';
import { settingsSchema } from '../../../shared/types.js';
import { createLocalAgents } from '../agents/local.js';
import { modelPersonas } from '../agents/model.js';
import { AppError, throwIfAborted } from '../errors.js';
import { validateCitations } from '../knowledge/graph.js';
import { selectContext } from '../knowledge/retrieval.js';
import type { ModelGateway } from '../models/client.js';
import { jsonValidated } from '../models/validated.js';
import { agentsFromActors } from '../stakeholders/agents.js';
import type { Repository } from '../storage/repository.js';
import { generatedEnvironmentSchema } from './schemas.js';
import { requireConsole, traceOperation, updateConsole } from './state.js';

export async function prepareEnvironment(
  repository: Repository,
  id: string,
  model: ModelGateway | null,
  signal: AbortSignal,
): Promise<void> {
  const project = repository.get(id);
  if (!project.graph)
    throw new AppError(409, 'GRAPH_NOT_READY', 'Build the knowledge graph first.');
  const graph = project.graph;
  const chunks = repository.chunks(id);
  // Actors the person approved replace the generated population; without them nothing changes.
  const actors = repository.artifacts.get(id, 'actors');
  const fromActors = actors ? agentsFromActors(actors.data, graph, project.settings) : null;
  const agents = await traceOperation(
    repository,
    id,
    'environment',
    model && !fromActors ? 'model' : 'review',
    fromActors
      ? 'Fictional persona preparation from approved actors'
      : 'Fictional persona preparation',
    { population: fromActors?.agents.length ?? project.agentCount, mode: project.mode },
    () =>
      fromActors
        ? fromActors.agents
        : model
          ? modelPersonas(model, project, graph, chunks, signal)
          : createLocalAgents(graph, project.settings),
    (result) => ({
      count: result.length,
      agentIds: result.map((agent) => agent.id),
      fictional: true,
    }),
  );
  throwIfAborted(signal);
  repository.update(id, {
    agents,
    progress: 32,
    ...(fromActors
      ? { agentCount: agents.length, settings: { ...project.settings, agentCount: agents.length } }
      : {}),
  });
  if (fromActors) {
    repository.addEvent(
      id,
      'personas',
      `Agents made from approved actors: ${fromActors.keyActors} key actors and ${fromActors.representatives} cohort representatives${fromActors.omitted.length > 0 ? `; ${fromActors.omitted.length} more key actors did not fit the engine's limit` : ''}. Cohorts are not simulated at their size here.`,
    );
  }
  const evidence = selectContext(chunks, project.question, 5_000);
  const config = await traceOperation(
    repository,
    id,
    'environment',
    model ? 'model' : 'review',
    'Environment configuration',
    {
      rounds: project.settings.rounds,
      seed: project.settings.seed,
      platforms: ['plaza', 'community'],
    },
    async () => {
      let minutesPerRound = 60;
      let initialPosts: SeedPost[];
      if (model) {
        const allowed = new Set(evidence.map((chunk) => chunk.id));
        const generated = await jsonValidated(
          model,
          generatedEnvironmentSchema,
          'Prepare initial scenario inputs. JSON {minutesPerRound,initialPosts:[{text,platform,stance,strength,sourceIds}]}. ' +
            'minutesPerRound5-180; 1-4 seed posts, text10-500 chars, platform plaza/community/both, assumed stance -1..1, assumed strength0..1, sourceIds0-5 supplied IDs. ' +
            'Clearly describe these as scenario assumptions, not measured public opinion or real people speaking.',
          { question: project.question, rounds: project.settings.rounds, evidence },
          signal,
          2_500,
          (value) => {
            for (const post of value.initialPosts) validateCitations(post.sourceIds, allowed);
          },
        );
        minutesPerRound = generated.minutesPerRound;
        initialPosts = generated.initialPosts.map((post, index) => ({
          ...post,
          id: `P${index + 1}`,
        }));
      } else {
        const first = evidence[0] || chunks[0];
        if (!first)
          throw new AppError(422, 'INSUFFICIENT_SOURCE', 'No source passage is available.');
        initialPosts = [
          {
            id: 'P1',
            text: `Source context, not a simulated opinion: ${first.text.slice(0, 400)}`,
            platform: 'both',
            stance: 0,
            strength: 0,
            sourceIds: [first.id],
          },
        ];
      }
      for (const post of initialPosts)
        validateCitations(post.sourceIds, new Set(evidence.map((chunk) => chunk.id)));
      return environmentSchema.parse({
        minutesPerRound,
        platforms: ['plaza', 'community'],
        initialPosts,
        generatedBy: project.mode,
        edited: false,
      });
    },
    (result) => ({
      minutesPerRound: result.minutesPerRound,
      platforms: result.platforms,
      initialPosts: result.initialPosts.map((post) => ({ ...post })),
    }),
  );
  throwIfAborted(signal);
  updateConsole(repository, id, (state) => ({ ...state, environment: config }));
}

export function editEnvironment(repository: Repository, id: string, input: EnvironmentUpdate) {
  const project = repository.get(id);
  const state = requireConsole(project);
  if (
    project.status === 'completed' ||
    state.steps.environment !== 'ready' ||
    state.steps.simulation !== 'pending'
  ) {
    throw new AppError(
      409,
      'ENVIRONMENT_LOCKED',
      'Edit a prepared environment before starting its simulation. Duplicate a completed scenario to change it.',
    );
  }
  const settings = settingsSchema.parse({ ...project.settings, rounds: input.rounds });
  const ids = new Set(project.agents.map((agent) => agent.id));
  if (
    input.agents.length !== ids.size ||
    new Set(input.agents.map((agent) => agent.id)).size !== ids.size ||
    input.agents.some((agent) => !ids.has(agent.id))
  ) {
    throw new AppError(
      400,
      'INVALID_POPULATION',
      'Keep exactly the prepared population IDs; duplicate the scenario to change population size.',
    );
  }
  if (new Set(input.initialPosts.map((post) => post.id)).size !== input.initialPosts.length) {
    throw new AppError(400, 'INVALID_SEEDS', 'Initial post IDs must be unique.');
  }
  const sourceIds = new Set(repository.chunks(id).map((chunk) => chunk.id));
  for (const post of input.initialPosts) {
    if (post.sourceIds.some((source) => !sourceIds.has(source))) {
      throw new AppError(
        400,
        'INVALID_CITATION',
        'Initial posts must reference source passages from this project.',
      );
    }
  }
  const agents = project.agents.map((agent) => {
    const edited = input.agents.find((item) => item.id === agent.id);
    if (!edited) throw new Error('The validated population edit is incomplete.');
    return { ...agent, ...edited, opinion: edited.initialOpinion, memory: [] };
  });
  const environment = environmentSchema.parse({
    minutesPerRound: input.minutesPerRound,
    platforms: input.platforms,
    initialPosts: input.initialPosts,
    generatedBy: state.environment?.generatedBy || project.mode,
    edited: true,
  });
  const result = repository.update(id, {
    settings,
    roundCount: settings.rounds,
    agents,
    console: { ...state, environment },
  });
  repository.addEvent(
    id,
    'personas',
    'Environment and fictional persona assumptions edited by the user before simulation.',
  );
  return { ...result, events: repository.get(id).events };
}
