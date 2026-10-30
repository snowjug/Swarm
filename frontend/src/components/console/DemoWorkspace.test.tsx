import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_PROJECTS } from '../../../../shared/demo';
import type { ProjectSummary } from '../../../../shared/types';
import { visibleText } from '../../test/provider';
import { DemoWorkspace, POSITIONING_STATEMENT, type DemoHistory } from './DemoWorkspace';

function summary(id: string, overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id,
    name: 'A saved project',
    workflow: 'guided',
    question: 'A question long enough to be valid.',
    status: 'completed',
    stage: 'complete',
    progress: 100,
    mode: 'llm',
    agentCount: 6,
    roundCount: 6,
    currentRound: 6,
    createdAt: '2026-10-29T10:00:00.000Z',
    updatedAt: '2026-10-29T10:30:00.000Z',
    error: null,
    parentId: null,
    ...overrides,
  };
}

function render(history: DemoHistory, busy = false): string {
  return renderToStaticMarkup(
    <DemoWorkspace history={history} busy={busy} onOpen={() => {}} onRetry={() => {}} />,
  );
}

const loaded = (ids: string[]): DemoHistory => ({
  projects: ids.map((id) => summary(id)),
  loading: false,
  error: null,
});

describe('product introduction', () => {
  it('says what Swarm is, and states in the exact words that it does not predict', () => {
    const html = render(loaded([]));
    expect(POSITIONING_STATEMENT).toBe(
      'Swarm explores possible scenarios. It does not predict the future.',
    );
    expect(visibleText(html)).toContain(POSITIONING_STATEMENT);
    expect(html.match(/<h1[ >]/gu)).toHaveLength(1);
    for (const capability of [
      'Evidence ledger',
      'Contradiction review',
      'Assumption register',
      'Audit trail',
    ]) {
      expect(visibleText(html)).toContain(capability);
    }
  });

  it('says that the demonstration is synthetic and was recorded with a real model', () => {
    const text = visibleText(render(loaded([])));
    expect(text).toMatch(/every source, organisation and person is fictional/u);
    expect(text).toMatch(/recorded with a real model/u);
  });
});

describe('demonstration workspace', () => {
  it('offers to open each demonstration project that is in the workspace, by its own name', () => {
    const html = render(loaded(DEMO_PROJECTS.map((demo) => demo.id)));
    for (const demo of DEMO_PROJECTS) {
      expect(html).toContain(`aria-label="Open project: ${demo.title}"`);
      expect(visibleText(html)).toContain(demo.summary);
    }
    expect(html.match(/Open project/gu)?.length).toBeGreaterThanOrEqual(DEMO_PROJECTS.length);
    expect(visibleText(html)).toContain('6 actors · 6 rounds · real model');
    expect(visibleText(html)).not.toContain('Not loaded');
  });

  it('does not pretend a project is there: a missing one says how to restore it and has no button', () => {
    const [base, ...rest] = DEMO_PROJECTS;
    const html = render(loaded([base!.id]));
    expect(html.match(/aria-label="Open project:/gu)).toHaveLength(1);
    expect(visibleText(html).match(/Not loaded in this workspace/gu)).toHaveLength(rest.length);
    expect(visibleText(html)).toContain('npm run demo:seed');
  });

  it('ignores saved projects that are not part of the demonstration', () => {
    const html = render(loaded(['0f0f0f0f-0000-4000-8000-000000000001']));
    expect(html).not.toContain('aria-label="Open project:');
    expect(visibleText(html).match(/Not loaded in this workspace/gu)).toHaveLength(
      DEMO_PROJECTS.length,
    );
  });

  it('disables opening while another operation is running', () => {
    const html = render(loaded(DEMO_PROJECTS.map((demo) => demo.id)), true);
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="Open project:/gu)).toHaveLength(
      DEMO_PROJECTS.length,
    );
  });

  it('says it is reading while the list loads, and then shows an error that can be retried', () => {
    const reading = render({ projects: null, loading: true, error: null });
    expect(visibleText(reading)).toContain('Reading the workspace');
    expect(reading).not.toContain('Not loaded');

    const failed = render({ projects: null, loading: false, error: 'The API did not answer.' });
    expect(visibleText(failed)).toContain('The workspace could not be read');
    expect(visibleText(failed)).toContain('The API did not answer.');
    expect(failed).toContain('Retry');
    expect(failed).not.toContain('Reading the workspace');
  });
});
