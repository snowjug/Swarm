// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig, ProjectDetail } from '../../../shared/types';
import { projectFixture } from '../test/project';
import { renderWithApp, screen, waitFor } from '../test/dom';
import { AskSheet } from './AskSheet';
import { HistorySheet } from './HistorySheet';
import { PanelBoundary } from './shared/PanelBoundary';

// A panel that has nothing to show must not be a dead end: it says what opens it, and offers the way there.

const config = {
  provider: { configured: false },
  capabilities: { modelAssisted: false, surveys: true },
  limits: { maxSurveyTargets: 5 },
} as unknown as AppConfig;

const withSteps = (
  steps: Partial<NonNullable<ProjectDetail['console']>['steps']>,
): ProjectDetail => {
  const base = projectFixture();
  return { ...base, console: { ...base.console!, steps: { ...base.console!.steps, ...steps } } };
};

function ask(project: ProjectDetail, onDeepDive: (() => void) | null) {
  return renderWithApp(
    <AskSheet
      open
      onOpenChange={() => undefined}
      project={project}
      config={config}
      onSurvey={() => undefined}
      onDeepDive={onDeepDive}
    />,
  );
}

describe('Ask, where the report it reads from is not written', () => {
  it('opens the deep dive, where the report is made, from a button', async () => {
    const open = vi.fn();
    const { user } = ask(projectFixture(), open);
    expect(
      await screen.findByRole('heading', { name: 'Ask opens after the deep dive' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open the deep dive' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('says what the deep dive is doing, and offers to watch it while it runs', async () => {
    ask(withSteps({ simulation: 'running' }), () => undefined);
    expect(await screen.findByRole('heading', { name: 'The deep dive is running' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Watch it run' })).toBeTruthy();
  });

  it('offers no way that is shut: until the actors are made it says what opens the deep dive', async () => {
    ask(projectFixture(), null);
    expect(
      await screen.findByRole('heading', { name: 'Ask opens after the deep dive' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /deep dive|Watch/u })).toBeNull();
    expect(screen.getByText(/The deep dive opens once the actors are made\./u)).toBeTruthy();
  });
});

describe('the history, when there is nothing in it', () => {
  it('offers to ask a question instead of ending in a sentence', async () => {
    const onNew = vi.fn();
    const { user } = renderWithApp(
      <HistorySheet
        open
        onOpenChange={() => undefined}
        projects={[]}
        total={0}
        loading={false}
        error={null}
        selectedId={null}
        busy={false}
        onSelect={() => undefined}
        whatIf={false}
        onCompare={() => undefined}
        onRefresh={() => undefined}
        onDelete={() => Promise.resolve()}
        onNew={onNew}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Ask a question' }));
    await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
  });
});

describe('a panel that cannot be drawn', () => {
  it('is told to its owner and draws nothing, and the page beside it is not taken with it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFail = vi.fn();
    const Broken = (): never => {
      throw new Error('The code of the panel did not arrive.');
    };
    renderWithApp(
      <>
        <p>The page</p>
        <PanelBoundary onFail={onFail}>
          <Broken />
        </PanelBoundary>
      </>,
    );
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The page')).toBeTruthy();
  });
});
