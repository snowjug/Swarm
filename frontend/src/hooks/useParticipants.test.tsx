// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actorSetFixture,
  stakeholderFixture,
  stakeholderSetFixture,
} from '../../../shared/lab-fixtures';
import type { StakeholderSet, StakeholdersView } from '../../../shared/stakeholders';
import { ToastProvider } from '../design/ui';
import { mergeStakeholders } from '../lib/stakeholders/review';
import { useParticipants } from './useParticipants';
import type { StakeholderState } from './useStakeholders';

afterEach(() => vi.unstubAllGlobals());

const MODEL = { available: false, reason: null };
const viewOf = (set: StakeholderSet, revision: number): StakeholdersView => ({
  stakeholders: set,
  revision,
  model: MODEL,
  may: { edit: true, run: true },
});

/** A server that answers each `METHOD path` with the view it is told to, and the actors as they stand. */
function serve(replies: Record<string, StakeholdersView>): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    const key = `${(init.method ?? 'GET').toUpperCase()} ${path}`;
    asked.push(key);
    const body = key.endsWith('/actors')
      ? { actors: actorSetFixture(), revision: 1, stale: false, model: MODEL, may: {} }
      : replies[key];
    if (!body) throw new Error(`Nothing is scripted for ${key}.`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return asked;
}

function setup(set: StakeholderSet | null, revision: number | null = 3) {
  const state = {
    exec: vi.fn(async (_kind: string, work: () => Promise<unknown>) => {
      await work();
      return true;
    }),
    save: vi.fn(async () => true),
  };
  const focus = vi.fn();
  const say = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ToastProvider, null, children);
  const { result } = renderHook(
    () =>
      useParticipants({
        projectId: 'p',
        state: state as unknown as StakeholderState,
        set,
        revision,
        say,
        focus,
      }),
    { wrapper },
  );
  return { actions: result.current, state, focus, say };
}

const proposedSet = (): StakeholderSet => ({
  ...stakeholderSetFixture(),
  approvedAt: null,
  stakeholders: stakeholderSetFixture().stakeholders.map((item) => ({
    ...item,
    status: 'proposed' as const,
  })),
});

describe('what a person does to the participants', () => {
  it('makes a change against the revision they saw, as the one piece of work the page does', async () => {
    const asked = serve({ 'POST /api/projects/p/stakeholders/accept': viewOf(proposedSet(), 4) });
    const { actions, state } = setup(proposedSet());
    expect(await actions.accept()).toBe(true);
    expect(state.exec).toHaveBeenCalledWith('reviewing', expect.any(Function));
    expect(asked).toEqual([
      'POST /api/projects/p/stakeholders/accept',
      'GET /api/projects/p/actors',
    ]);
  });

  it('makes no change without a list to make it against', async () => {
    const asked = serve({});
    const { actions, state } = setup(null, null);
    expect(await actions.accept()).toBe(false);
    expect(await actions.remove('provider')).toBe(false);
    expect(state.exec).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
  });

  it('keeps focus on the card of one participant that was accepted, and sends the person to the summary after several', async () => {
    serve({ 'POST /api/projects/p/stakeholders/accept': viewOf(proposedSet(), 4) });
    const one = setup(proposedSet());
    await one.actions.accept(['regulator']);
    expect(one.focus).toHaveBeenCalledWith(['rv:regulator', 'rv:top']);
    expect(one.say).toHaveBeenCalledWith('Accepted Regulator.');

    const many = setup(proposedSet());
    await many.actions.accept();
    expect(many.focus).toHaveBeenCalledWith(['rv:top']);
    expect(many.say).toHaveBeenCalledWith('Accepted 5 participants.');
  });

  it('says so, and moves nothing, when nothing was waiting to be accepted', async () => {
    const accepted = {
      ...proposedSet(),
      stakeholders: proposedSet().stakeholders.map((item) => ({
        ...item,
        status: 'accepted' as const,
      })),
    };
    serve({ 'POST /api/projects/p/stakeholders/accept': viewOf(accepted, 4) });
    const { actions, say } = setup(accepted);
    await actions.accept();
    expect(say).toHaveBeenCalledWith('Nothing was waiting to be accepted.');
  });

  it('puts focus on the participant that was added, which only the answer knows the id of', async () => {
    const before = proposedSet();
    const after: StakeholderSet = {
      ...before,
      stakeholders: [
        ...before.stakeholders,
        stakeholderFixture('night-neighbours', 'other', { origin: 'user', status: 'added' }),
      ],
    };
    serve({ 'POST /api/projects/p/stakeholders/add-missing': viewOf(after, 4) });
    const { actions, focus, say } = setup(before);
    await actions.addMissing({ role: 'indirectly-affected', name: 'Night neighbours' });
    expect(focus).toHaveBeenCalledWith(['rv:night-neighbours', 'rv:top']);
    expect(say).toHaveBeenCalledWith(
      'Added Night neighbours. It carries no evidence: it is your own.',
    );
  });

  it('brings a removed participant back by the whole-list save, and undoes a merge instead of only restoring', async () => {
    const base = proposedSet();
    const removed = {
      ...base,
      stakeholders: base.stakeholders.map((item) =>
        item.id === 'resellers' ? { ...item, status: 'removed' as const } : item,
      ),
    };
    const plain = setup(removed);
    await plain.actions.restore('resellers');
    const [list] = plain.state.save.mock.calls[0] as unknown as [StakeholderSet['stakeholders']];
    expect(list.find((item) => item.id === 'resellers')?.status).toBe('proposed');

    const merged = mergeStakeholders(base.stakeholders, base.relations, 'resellers', 'provider');
    const folded = setup({
      ...base,
      stakeholders: merged.stakeholders,
      relations: merged.relations,
    });
    await folded.actions.restore('resellers');
    const [undone] = folded.state.save.mock.calls[0] as unknown as [StakeholderSet['stakeholders']];
    expect(undone.find((item) => item.id === 'provider')?.mergedFrom).toEqual([]);
    expect(undone.find((item) => item.id === 'resellers')?.status).toBe('proposed');
  });
});
