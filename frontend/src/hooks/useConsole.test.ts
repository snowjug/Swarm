// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectInput } from '../../../shared/types';
import { ApiError, api } from '../api';
import { researchApi } from '../api/research';
import { run, view } from '../scenes/ground/research/fixtures';
import { projectFixture } from '../test/project';
import { useConsole } from './useConsole';

// How a question becomes a project, and what starts: with sources of its own, its evidence is read; with none,
// research is what starts, and the page that shows it opens once it has. Only the network is replaced.

const QUESTION =
  'What could happen if the harbour office doubles the mooring fee for visiting boats?';
const created = { ...projectFixture(), id: 'new-project', documents: [] };

const withSources: CreateProjectInput = {
  name: 'Harbour fees',
  question: QUESTION,
  documents: [{ name: 'notes.md', content: 'x'.repeat(120) }],
};
const questionOnly: CreateProjectInput = {
  name: 'Harbour fees',
  question: QUESTION,
  documents: [],
  research: { auto: true, guidance: 'Harbour office rules only' },
};

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(api, 'config').mockResolvedValue({} as Awaited<ReturnType<typeof api.config>>);
  vi.spyOn(api, 'projects').mockResolvedValue({ projects: [], total: 0 });
  vi.spyOn(api, 'project').mockResolvedValue(created);
  vi.spyOn(api, 'create').mockResolvedValue(created);
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

async function open() {
  const hook = renderHook(() => useConsole());
  await act(async () => {
    await Promise.resolve();
  });
  return hook;
}

describe('a question that brings its own sources', () => {
  it('opens its page as soon as the project exists, and reads its evidence; nothing is researched', async () => {
    const step = vi.spyOn(api, 'step').mockResolvedValue(created);
    const start = vi.spyOn(researchApi, 'start');
    const { result } = await open();

    await act(async () => {
      await result.current.create(withSources);
    });
    expect(api.create).toHaveBeenCalledWith(
      { ...withSources, workflow: 'guided' },
      expect.any(AbortSignal),
    );
    expect(step).toHaveBeenCalledWith('new-project', 'knowledge', expect.any(AbortSignal));
    expect(start).not.toHaveBeenCalled();
    expect(result.current.selectedId).toBe('new-project');
  });

  it('says so, with the way to try again, when its evidence could not be started, and keeps the project', async () => {
    vi.spyOn(api, 'step').mockRejectedValue(new Error('The queue is full.'));
    const { result } = await open();
    await act(async () => {
      await result.current.create(withSources);
    });
    expect(result.current.selectedId).toBe('new-project');
    expect(result.current.actionError).toEqual({
      id: 'new-project',
      message: expect.stringContaining('press “Ground it”'),
    });
  });
});

describe('a question that brings none', () => {
  it('starts its research, with what was asked, and not its evidence', async () => {
    const step = vi.spyOn(api, 'step');
    const start = vi
      .spyOn(researchApi, 'start')
      .mockResolvedValue(view(run({ status: 'queued', stage: 'planning', plan: null })));
    const { result } = await open();

    await act(async () => {
      await result.current.create(questionOnly);
    });
    expect(start).toHaveBeenCalledWith(
      'new-project',
      { intake: { auto: true, guidance: 'Harbour office rules only' } },
      expect.any(AbortSignal),
    );
    expect(step).not.toHaveBeenCalled();
    expect(result.current.selectedId).toBe('new-project');
    expect(result.current.actionError).toBeNull();
  });

  it('opens its page only once the run exists, so that the page never says it has not started', async () => {
    let started: () => void = () => undefined;
    vi.spyOn(researchApi, 'start').mockReturnValue(
      new Promise((resolve) => {
        started = () => resolve(view(run({ status: 'queued', stage: 'planning', plan: null })));
      }),
    );
    const { result } = await open();

    let creating: Promise<void> = Promise.resolve();
    act(() => {
      creating = result.current.create(questionOnly);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.create).toHaveBeenCalled();
    expect(result.current.selectedId).toBeNull();

    await act(async () => {
      started();
      await creating;
    });
    expect(result.current.selectedId).toBe('new-project');
  });

  it('takes a run that is already under way as the one that was asked for', async () => {
    vi.spyOn(researchApi, 'start').mockRejectedValue(
      new ApiError('Research is already running.', 'RESEARCH_ACTIVE'),
    );
    const { result } = await open();
    await act(async () => {
      await result.current.create(questionOnly);
    });
    expect(result.current.selectedId).toBe('new-project');
    expect(result.current.actionError).toBeNull();
  });

  it('keeps the project and says how to start the research again when it could not be started', async () => {
    vi.spyOn(researchApi, 'start').mockRejectedValue(
      new ApiError('Research is switched off on this server.', 'RESEARCH_DISABLED'),
    );
    const { result } = await open();
    await act(async () => {
      await result.current.create(questionOnly);
    });
    expect(result.current.selectedId).toBe('new-project');
    expect(result.current.actionError).toEqual({
      id: 'new-project',
      message: expect.stringMatching(
        /could not start researching\. Research is switched off on this server\..*“Start research”/u,
      ),
    });
  });

  it('does not research for a question with no source when it did not ask for research', async () => {
    const start = vi.spyOn(researchApi, 'start');
    const step = vi.spyOn(api, 'step').mockResolvedValue(created);
    const { result } = await open();
    await act(async () => {
      await result.current.create({ ...questionOnly, research: { auto: false } });
    });
    expect(start).not.toHaveBeenCalled();
    expect(step).toHaveBeenCalled();
  });
});
