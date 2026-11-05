// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorSetFixture, stakeholderSetFixture } from '../../../../shared/lab-fixtures';
import type { ActorsView, StakeholdersView } from '../../../../shared/stakeholders';
import { renderWithApp, screen, setMedia, waitFor, within } from '../../test/dom';
import { projectFixture } from '../../test/project';
import { MapScene } from './MapScene';

// The page is the real one, with the real hooks, and the server is a script. What is proven is what the page asks
// of the server when the person says "Use these actors" on a model-assisted project, what it tells them of what the
// model did about the constraints, and that nothing that goes wrong there undoes the approval. Nothing here is a
// model: it is evidence about the page.

const ID = projectFixture().id;
const BASE = `/api/projects/${ID}`;
const MODEL = { available: true, reason: null };
const MAY = { edit: true, run: true };

const proposed = () => {
  const set = stakeholderSetFixture();
  return {
    ...set,
    approvedAt: null,
    stakeholders: set.stakeholders.map((item) => ({ ...item, status: 'proposed' as const })),
  };
};
const stakeholders = (approved: boolean): StakeholdersView => ({
  stakeholders: {
    ...proposed(),
    approvedAt: approved ? '2026-01-15T10:00:00.000Z' : null,
  },
  revision: approved ? 2 : 1,
  model: MODEL,
  may: MAY,
});
const noActors: ActorsView = { actors: null, revision: null, stale: false, model: MODEL, may: MAY };
const madeActors: ActorsView = {
  actors: actorSetFixture(),
  revision: 1,
  stale: false,
  model: MODEL,
  may: MAY,
};

const none = { constraints: null };
const held = (count: number, modelFailure?: { code: string; detail: string }) => ({
  constraints: {
    constraints: Array.from({ length: count }, (_, at) => ({ id: `c-${at}` })),
    ...(modelFailure ? { modelFailure } : {}),
  },
});

interface Asked {
  method: string;
  path: string;
  body: unknown;
}
type Reply = { status?: number; body: unknown };

function serve(script: Record<string, Reply>): Asked[] {
  const asked: Asked[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    asked.push({
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const reply = script[`${method} ${path}`];
    if (!reply) throw new Error(`Nothing is scripted for ${method} ${path}.`);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return asked;
}

const standard = (constraints: Record<string, Reply>): Record<string, Reply> => ({
  [`GET ${BASE}/stakeholders`]: { body: stakeholders(false) },
  [`GET ${BASE}/actors`]: { body: noActors },
  [`POST ${BASE}/stakeholders/approve`]: { body: stakeholders(true) },
  [`POST ${BASE}/actors/generate`]: { status: 201, body: madeActors },
  ...constraints,
});
const constraintCalls = (asked: Asked[]) =>
  asked.filter((call) => call.path.startsWith(`${BASE}/constraints`));

beforeEach(() => setMedia('(min-width: 64rem)', true));
afterEach(() => vi.unstubAllGlobals());

async function openOffer(user: ReturnType<typeof renderWithApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Approve & create actors' }));
  return screen.findByRole('dialog');
}
const notifications = () => screen.getByRole('region', { name: 'Notifications' });

describe('the model reads the constraints once the actors are made', () => {
  it('offers it, switched on, beside reading the key actors, and says what it sends and what it does not do', async () => {
    serve(standard({}));
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    const offer = await openOffer(user);
    const constraints = within(offer).getByRole('switch', {
      name: /^Let the model read the constraints/u,
    }) as HTMLInputElement;
    expect(constraints.checked).toBe(true);
    expect(
      (
        within(offer).getByRole('switch', {
          name: /^Let the model read the key actors/u,
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(offer.textContent).toContain('Nothing it proposes is used by a simulation until you');
    expect(offer.textContent).toContain('if the model fails, rules read them and say so');
  });

  it('asks the model for the constraints after the approval and the actors, and says that it proposed them', async () => {
    const asked = serve(
      standard({
        [`GET ${BASE}/constraints`]: { body: none },
        [`POST ${BASE}/constraints/propose`]: { status: 201, body: held(5) },
      }),
    );
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    const offer = await openOffer(user);
    await user.click(within(offer).getByRole('button', { name: 'Create actors' }));

    await screen.findByText('Constraints proposed');
    expect(notifications().textContent).toContain('5 constraints proposed by the model');
    expect(notifications().textContent).toContain('A simulation does not use them until you have');
    // In order: the list is approved, the actors are made, and only then is the model asked.
    expect(asked.map((call) => `${call.method} ${call.path.replace(BASE, '')}`)).toEqual([
      'GET /stakeholders',
      'GET /actors',
      'POST /stakeholders/approve',
      'POST /actors/generate',
      'GET /constraints',
      'POST /constraints/propose',
    ]);
    expect(constraintCalls(asked)[1]?.body).toEqual({ mode: 'model' });
  });

  it('asks nothing of the model about the constraints when the person switched that off', async () => {
    const asked = serve(standard({}));
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    const offer = await openOffer(user);
    await user.click(
      within(offer).getByRole('switch', { name: /^Let the model read the constraints/u }),
    );
    await user.click(within(offer).getByRole('button', { name: 'Create actors' }));
    await screen.findByText('Approved');
    await waitFor(() =>
      expect(asked.some((call) => call.path.endsWith('/actors/generate'))).toBe(true),
    );
    expect(constraintCalls(asked)).toEqual([]);
  });

  it('says why, and that rules read them instead, when the model could not be used', async () => {
    serve(
      standard({
        [`GET ${BASE}/constraints`]: { body: none },
        [`POST ${BASE}/constraints/propose`]: {
          status: 201,
          body: held(3, {
            code: 'MODEL_TRUNCATED',
            detail: 'The model’s answer was cut short, so rules were used.',
          }),
        },
      }),
    );
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    const offer = await openOffer(user);
    await user.click(within(offer).getByRole('button', { name: 'Create actors' }));

    await screen.findByText('The model could not read the constraints');
    expect(notifications().textContent).toContain('The model’s answer was cut short.');
    expect(notifications().textContent).toContain(
      'Rules read 3 constraints instead, so no model proposed them.',
    );
    expect(notifications().textContent).not.toContain('so rules were used');
    // The approval stands: it is told as well.
    expect(screen.getByText('Approved')).toBeTruthy();
  });

  it('keeps the approval and the actors when the constraints could not be asked for at all, and says so', async () => {
    const asked = serve(
      standard({
        [`GET ${BASE}/constraints`]: {
          status: 500,
          body: { error: { code: 'INTERNAL_ERROR', message: 'An internal operation failed.' } },
        },
      }),
    );
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    const offer = await openOffer(user);
    await user.click(within(offer).getByRole('button', { name: 'Create actors' }));

    await screen.findByText('The constraints could not be read');
    expect(notifications().textContent).toContain('Nothing was proposed.');
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(asked.some((call) => call.path.endsWith('/stakeholders/approve'))).toBe(true);
    // No error banner on the page: the approval did not fail.
    expect(screen.queryByText('That did not work')).toBeNull();
  });

  it('leaves constraints that are already there alone, and says nothing of them', async () => {
    const asked = serve(standard({ [`GET ${BASE}/constraints`]: { body: held(6) } }));
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    const offer = await openOffer(user);
    await user.click(within(offer).getByRole('button', { name: 'Create actors' }));
    await screen.findByText('Approved');
    await waitFor(() => expect(constraintCalls(asked)).toHaveLength(1));
    expect(constraintCalls(asked)[0]?.method).toBe('GET');
    expect(screen.queryByText('Constraints proposed')).toBeNull();
  });

  it('says that the model is reading them while it does, so that the wait is not mistaken for a stall', async () => {
    const hold: { release: (() => void) | null } = { release: null };
    const script = standard({
      [`GET ${BASE}/constraints`]: { body: none },
      [`POST ${BASE}/constraints/propose`]: { status: 201, body: held(2) },
    });
    vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path.endsWith('/constraints/propose')) {
        await new Promise<void>((resolve) => (hold.release = resolve));
      }
      const reply = script[`${method} ${path}`]!;
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    const offer = await openOffer(user);
    await user.click(within(offer).getByRole('button', { name: 'Create actors' }));
    expect(await screen.findByText('The model is reading the constraints…')).toBeTruthy();
    hold.release?.();
    await screen.findByText('Constraints proposed');
  });
});
