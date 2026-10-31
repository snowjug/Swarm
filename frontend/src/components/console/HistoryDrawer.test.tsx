import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '../../../../shared/types';
import { projectFixture } from '../../test/project';
import { HistoryDrawer } from './HistoryDrawer';

const summary = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => {
  const { id, name, workflow, question, status, stage, progress, mode } = projectFixture();
  return {
    id,
    name,
    workflow,
    question,
    status,
    stage,
    progress,
    mode,
    agentCount: 4,
    roundCount: 3,
    currentRound: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    error: null,
    parentId: null,
    ...overrides,
  };
};

const render = (projects: ProjectSummary[], whatIf = false): string =>
  renderToStaticMarkup(
    <HistoryDrawer
      projects={projects}
      total={projects.length}
      loading={false}
      error={null}
      selectedId={null}
      busy={false}
      onClose={() => {}}
      onSelect={() => {}}
      onRefresh={() => {}}
      onDelete={async () => {}}
      whatIf={whatIf}
      onCompare={() => {}}
    />,
  );

describe('the saved projects in the history', () => {
  it('opens a project by its title and by a button that says so, so that an icon is not the only cue', () => {
    const html = render([summary({ name: 'Fictional library hours' })]);
    expect(html).toMatch(/<button[^>]*class="history-open"[^>]*><strong>Fictional library hours/u);
    expect(html).toMatch(
      /<button[^>]*class="button button-secondary button-small"[^>]*aria-label="Open Fictional library hours"[^>]*>Open<\/button>/u,
    );
  });

  it('puts Open before Compare, and offers Compare only to a guided project that has a saved round', () => {
    const guided = summary({ name: 'Ran', currentRound: 2 });
    const html = render([guided, summary({ id: 'other', name: 'Not run' })], true);
    const cards = html.split('<article').slice(1);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.indexOf('>Open</button>')).toBeLessThan(
      cards[0]!.indexOf('>Compare</button>'),
    );
    expect(cards[1]).toContain('>Open</button>');
    expect(cards[1]).not.toContain('Compare');
  });
});
