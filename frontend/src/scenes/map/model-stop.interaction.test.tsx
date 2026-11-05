// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorSetFixture, stakeholderSetFixture } from '../../../../shared/lab-fixtures';
import type { StakeholderSet, StakeholdersView } from '../../../../shared/stakeholders';
import { renderWithApp, screen, setMedia, waitFor } from '../../test/dom';
import { projectFixture } from '../../test/project';
import { MapScene } from './MapScene';

// The page is the real one, with the real hooks, and the server is a script: what the person is told when
// the model could not propose the participants, what each of the three ways on asks the server, and what the
// page then calls the list. Nothing here is a model: it is evidence about the page.

const ID = projectFixture().id;
const BASE = `/api/projects/${ID}`;
const MODEL = { available: true, reason: null };
const MAY = { edit: true, run: true };

const STOP = {
  stopped: {
    code: 'MODEL_TRUNCATED',
    detail: 'The model’s answer was cut short.',
    retryable: true,
  },
};

const fellBack = (): StakeholderSet => {
  const set = stakeholderSetFixture();
  return {
    ...set,
    approvedAt: null,
    stakeholders: set.stakeholders.map((item) => ({ ...item, status: 'proposed' as const })),
    discovery: {
      ...set.discovery,
      mode: 'rules',
      note: 'Participants from the rules fallback. The model’s answer was cut short. Swarm read the text for roles instead, so no model proposed these; expect gaps.',
    },
    proposal: {
      version: 1,
      generatedAt: set.discovery.generatedAt,
      source: 'rules',
      model: null,
      failure: {
        code: 'MODEL_TRUNCATED',
        detail: 'The model’s answer was cut short, so rules were used.',
      },
      evidence: { shown: 1, of: 1 },
      flaggedPassages: [],
      usedResearch: false,
      usedConstraints: false,
      merged: 0,
      dropped: [],
      missingVoices: [],
      notes: [],
    },
  };
};

const viewOf = (set: StakeholderSet | null, revision: number | null): StakeholdersView => ({
  stakeholders: set,
  revision,
  model: MODEL,
  may: MAY,
});

interface Asked {
  method: string;
  path: string;
  body: unknown;
}

/** A server that answers each `METHOD path` from a queue, in order, and keeps what it was asked. */
function serve(script: Record<string, unknown[]>): Asked[] {
  const asked: Asked[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    asked.push({
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const queue = script[`${method} ${path}`];
    const body = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (body === undefined) throw new Error(`Nothing is scripted for ${method} ${path}.`);
    return new Response(JSON.stringify(body), {
      status: method === 'POST' && !(body as { stopped?: unknown }).stopped ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return asked;
}

const noActors = { actors: null, revision: null, stale: false, model: MODEL, may: MAY };
const proposals = (asked: Asked[]) =>
  asked.filter((call) => call.path === `${BASE}/stakeholders/propose`).map((call) => call.body);

beforeEach(() => setMedia('(min-width: 64rem)', true));
afterEach(() => vi.unstubAllGlobals());

const find = async (user: ReturnType<typeof renderWithApp>['user']) =>
  user.click(await screen.findByRole('button', { name: 'Find who is affected' }));

describe('when the model could not propose the participants', () => {
  it('stops, says what failed, keeps nothing, and offers the three ways on', async () => {
    const asked = serve({
      [`GET ${BASE}/stakeholders`]: [viewOf(null, null)],
      [`GET ${BASE}/actors`]: [noActors],
      [`POST ${BASE}/stakeholders/propose`]: [STOP],
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    await find(user);

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('The model could not propose the participants');
    expect(notice.textContent).toContain('The model’s answer was cut short.');
    expect(notice.textContent).toContain('Nothing was made: there are no participants yet.');
    expect(notice.textContent).toContain('“Participants from the rules fallback”');
    for (const name of ['Retry with the model', 'Edit participants', 'Continue with rules']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // Nothing is on the map, and nothing was proposed in the model's place.
    expect(screen.getByRole('button', { name: 'Find who is affected' })).toBeTruthy();
    expect(proposals(asked)).toEqual([{ mode: 'model', confirm: false }]);
    expect(screen.queryByText('Rules fallback')).toBeNull();
  });

  it('asks the model again as it was asked when the person chooses to retry', async () => {
    const asked = serve({
      [`GET ${BASE}/stakeholders`]: [viewOf(null, null)],
      [`GET ${BASE}/actors`]: [noActors],
      [`POST ${BASE}/stakeholders/propose`]: [STOP, STOP],
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    await find(user);
    await user.click(await screen.findByRole('button', { name: 'Retry with the model' }));
    await waitFor(() => expect(proposals(asked)).toHaveLength(2));
    expect(proposals(asked)).toEqual([
      { mode: 'model', confirm: false },
      { mode: 'model', confirm: false },
    ]);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('goes on with rules when the person chooses them, says which failure it goes on from, and then calls the list the rules fallback', async () => {
    const asked = serve({
      [`GET ${BASE}/stakeholders`]: [viewOf(null, null)],
      [`GET ${BASE}/actors`]: [noActors],
      [`POST ${BASE}/stakeholders/propose`]: [STOP, viewOf(fellBack(), 1)],
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    await find(user);
    await user.click(await screen.findByRole('button', { name: 'Continue with rules' }));

    await waitFor(() => expect(proposals(asked)).toHaveLength(2));
    expect(proposals(asked)[1]).toEqual({
      mode: 'rules',
      confirm: false,
      fallbackFrom: 'MODEL_TRUNCATED',
    });
    // The stop is gone, and what is on the page says how the list was made: by rules, after the model failed.
    expect(await screen.findByText('Rules fallback')).toBeTruthy();
    expect(screen.getAllByText('Participants from the rules fallback').length).toBeGreaterThan(0);
    expect(screen.queryByText('Found by a model')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry with the model' })).toBeNull();
  });

  it('opens the way to add the first participant by hand when the person chooses to edit, and asks the server for nothing more', async () => {
    const asked = serve({
      [`GET ${BASE}/stakeholders`]: [viewOf(null, null)],
      [`GET ${BASE}/actors`]: [noActors],
      [`POST ${BASE}/stakeholders/propose`]: [STOP],
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    await find(user);
    await user.click(await screen.findByRole('button', { name: 'Edit participants' }));
    expect(await screen.findByRole('dialog', { name: 'Add the first stakeholder' })).toBeTruthy();
    expect(proposals(asked)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry with the model' })).toBeNull();
  });

  it('says that asking again is unlikely to help when the deployment or the budget is the trouble', async () => {
    serve({
      [`GET ${BASE}/stakeholders`]: [viewOf(null, null)],
      [`GET ${BASE}/actors`]: [noActors],
      [`POST ${BASE}/stakeholders/propose`]: [
        {
          stopped: {
            code: 'MODEL_AUTH',
            detail: 'The model rejected the server’s credentials.',
            retryable: false,
          },
        },
      ],
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    await find(user);
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('Asking again is unlikely to help until this is fixed.');
    expect(screen.getByRole('button', { name: 'Continue with rules' })).toBeTruthy();
  });

  it('leaves a list that was there as it was, and says so', async () => {
    const reviewed = { ...fellBack(), proposal: undefined };
    serve({
      [`GET ${BASE}/stakeholders`]: [viewOf(reviewed, 4)],
      [`GET ${BASE}/actors`]: [{ ...noActors, actors: actorSetFixture(), revision: 2 }],
      [`POST ${BASE}/stakeholders/propose`]: [STOP],
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: /Find stakeholders again/u }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain('Nothing was changed: your list is as it was.');
  });

  it('asks the model again, and not the rules again, for a list the rules made only because the model could not be used', async () => {
    const asked = serve({
      [`GET ${BASE}/stakeholders`]: [viewOf(fellBack(), 4)],
      [`GET ${BASE}/actors`]: [{ ...noActors, actors: actorSetFixture(), revision: 2 }],
      [`POST ${BASE}/stakeholders/propose`]: [STOP],
    });
    const { user } = renderWithApp(<MapScene />, { workspace: { scene: 'map' } });
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: /Find stakeholders again/u }));
    await waitFor(() => expect(proposals(asked).length).toBeGreaterThan(0));
    expect(proposals(asked)[0]).toMatchObject({ mode: 'model' });
  });
});
