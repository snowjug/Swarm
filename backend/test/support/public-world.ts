import type { InjectOptions } from 'fastify';
import { scenarioFrameSchema } from '../../../shared/scenario.js';
import { forgetAllSecrets } from '../../src/public/byok/secrets.js';
import { fixtureInput } from '../fixtures.js';
import { FakeGemini } from './fake-gemini.js';
import { FakeFoundry, foundryEnvironment } from './public-foundry.js';
import { NOTES, passagesOf, proposal } from './participants-world.js';
import { publicApp, type PublicHarness } from './public-idp.js';

/**
 * A public edition for the tests of its defences: the operator's model set up behind a fake Azure, a fake Google for a
 * person's own key, a way to sign people in and to ask for things as them, and a record of every answer and every log
 * line, for the tests that look for what must not be in one.
 */
export const csrf = { 'x-swarm-csrf': '1', 'content-type': 'application/json' };

const open: PublicHarness[] = [];

export async function closeWorlds(): Promise<void> {
  await Promise.all(open.splice(0).map((made) => made.close()));
  forgetAllSecrets();
}

export const KEY = 'AIzaSyD-canary0123456789abcdefghijklmn_';
export const own = (key = KEY, model: string | null = 'gemini-2.5-flash') => ({
  'x-swarm-provider': 'gemini',
  'x-swarm-provider-key': key,
  ...(model ? { 'x-swarm-provider-model': model } : {}),
});

export interface WorldOptions {
  environment?: Record<string, string>;
  /** Without the operator's model set up. */
  noModel?: boolean;
  log?: boolean;
  publicOptions?: NonNullable<Parameters<typeof publicApp>[1]>['public'];
  urlFetcher?: NonNullable<Parameters<typeof publicApp>[1]>['urlFetcher'];
  /** The clock of the server, for a test that moves time on. */
  now?: () => number;
}

export async function openWorld(options: WorldOptions = {}) {
  const gemini = new FakeGemini();
  gemini.keys.add(KEY);
  const foundry = new FakeFoundry();
  const logs: string[] = [];
  const h = await publicApp(
    {
      ...(options.noModel ? {} : foundryEnvironment),
      PUBLIC_SIGNUPS_PER_IP_PER_DAY: '1000',
      PUBLIC_SIGNUPS_PER_HOUR: '1000',
      ...options.environment,
    },
    {
      public: {
        modelFetcher: foundry.fetch,
        byokFetcher: gemini.fetch,
        ...(options.publicOptions ?? {}),
      },
      ...(options.urlFetcher ? { urlFetcher: options.urlFetcher } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.log
        ? {
            log: {
              stream: { write: (chunk: string) => logs.push(chunk) },
              level: 'debug' as const,
            },
          }
        : {}),
    },
  );
  open.push(h);
  const context = h.built.publicEdition!.context;
  const answers: string[] = [];
  let counter = 0;

  const person = async (name = `person${(counter += 1)}`, address?: string) => {
    const who = await h.signIn({
      provider: 'google',
      subject: `g-${name}`,
      email: `${name}@example.com`,
      ...(address ? { ip: address } : {}),
    });
    const user = h.built.repository.asSystem(() => context.users.find('google', `g-${name}`)!);
    return { ...who, workspaceId: user.workspaceId, userId: user.id, name, address };
  };
  type Person = Awaited<ReturnType<typeof person>>;

  const raw = async (request: InjectOptions) => {
    const response = await h.app.inject(request);
    answers.push(`${response.statusCode} ${JSON.stringify(response.headers)} ${response.body}`);
    return response;
  };

  /**
   * A request as a signed-in person, from the address they signed in from: the page's own header on a change, and the JSON
   * header only with a body.
   */
  const send = (
    who: Person | null,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS',
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    raw({
      method,
      url,
      ...(who?.address ? { remoteAddress: who.address } : {}),
      headers: {
        ...(who ? { cookie: who.cookie } : {}),
        ...(method === 'GET' || method === 'OPTIONS'
          ? {}
          : payload !== undefined || method === 'POST'
            ? csrf
            : { 'x-swarm-csrf': '1' }),
        ...headers,
      },
      ...(payload !== undefined ? { payload } : method === 'POST' ? { payload: {} } : {}),
    });

  /** A project with a scenario, ready for the participants to be proposed, with the given text as its source. */
  const project = async (
    who: Person,
    source: string = NOTES,
    settings: Record<string, unknown> = { mode: 'llm', agentCount: 4, rounds: 3 },
  ): Promise<string> => {
    const made = await send(
      who,
      'POST',
      '/api/projects',
      fixtureInput({
        workflow: 'guided',
        name: 'Night bus',
        question: 'What could happen if the night bus route moves to a new corridor?',
        documents: [{ name: 'notes.md', content: source }],
        settings,
      }),
    );
    if (made.statusCode !== 201) throw new Error(`project: ${made.statusCode} ${made.body}`);
    const id = made.json().id as string;
    h.built.repository.asTenant(who.workspaceId, () =>
      h.built.repository.artifacts.put(
        id,
        'scenario',
        'default',
        scenarioFrameSchema.parse({
          decision: 'Whether to move the night bus route to a new corridor next spring',
          system: 'Night bus network',
          baseline: 'The night bus stays on the old corridor.',
          likelyStakeholders: ['transit office'],
          origin: 'user',
        }),
      ),
    );
    return id;
  };

  const propose = (who: Person, id: string, mode: 'model' | 'rules' = 'model', headers = {}) =>
    send(who, 'POST', `/api/projects/${id}/stakeholders/propose`, { mode }, headers);

  /** What a model that behaves would answer for the notes. */
  const goodProposal = (source: string = NOTES): string =>
    JSON.stringify(proposal(passagesOf(source)));

  return {
    h,
    context,
    foundry,
    gemini,
    logs,
    answers,
    person,
    raw,
    send,
    project,
    propose,
    goodProposal,
  };
}
export type World = Awaited<ReturnType<typeof openWorld>>;
export type Person = Awaited<ReturnType<World['person']>>;
